// One-time stills for public marker videos already in R2.
//
// posterSrc (videoposter.js) uses siblingPosterUrl (mediaurl.js) when the
// sender did not pass an explicit poster. That keeps a
// markers/<digits>-<alnum>[-d<digits>].mp4|webm suffix and replaces the
// extension with .poster.jpg. posterTargetKey is the same object key the
// upload route stores. This script writes that key and does not change
// the client.
//
// It lists markers/ only. A video whose poster object is already there is
// skipped, so a stopped run continues without rewriting a still. Nothing
// about uploaders, accounts, or topics is read or stored: the only pair
// is the video key and the poster key from that name.
//
// A new sealed chat object is markers/<digits>-<alnum> with no extension,
// so posterKeyFor does not select it and no poster is written. Older
// sealed uploads were real mp4 or webm files at the usual key. Those are
// still listed. Bytes that are not an mp4 (ftyp) or webm (EBML) container
// are skipped, which is how a non-video blob is told apart from a public
// video.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { posterTargetKey } from "../../mediaurl.js";

const PUBLIC_BASE = "https://poster.invalid";
const FTYP = Buffer.from("ftyp");
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

export const CONCURRENCY = 2;
export const FIRST_BYTES = 4 * 1024 * 1024;
export const POSTER_EDGE = 512;
// ffmpeg's mjpeg -q:v is 2 (best, about JPEG 86) through 31 (worst).
// Passing 80 would clamp toward the worst step. Quality 80 is the next
// step down from that best setting.
export const JPEG_QUALITY = 80;
export const MJPEG_QSCALE = 3;

export function posterKeyFor(videoKey) {
  if (typeof videoKey !== "string") return "";
  const key = videoKey.replace(/^\/+/, "");
  if (!key || key.includes("..") || key.includes("\\") || key.includes("\0")) return "";
  return posterTargetKey(PUBLIC_BASE, `${PUBLIC_BASE}/${key}`);
}

export function videoContainerKind(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return "";
  if (bytes.subarray(4, 8).equals(FTYP)) return "mp4";
  if (bytes.subarray(0, 4).equals(EBML)) {
    const head = bytes.subarray(0, Math.min(bytes.length, 128)).toString("latin1");
    if (head.includes("webm")) return "webm";
  }
  return "";
}

export function classifyKeys(keys) {
  const listed = [];
  for (const key of keys || []) {
    if (typeof key === "string" && key) listed.push(key);
  }
  const have = new Set(listed);
  const counts = { objects: listed.length, videos: 0, already: 0, skipped: 0, pending: 0 };
  const pending = [];
  for (const key of listed) {
    const posterKey = posterKeyFor(key);
    if (!posterKey) {
      counts.skipped += 1;
      continue;
    }
    counts.videos += 1;
    if (have.has(posterKey)) {
      counts.already += 1;
      continue;
    }
    counts.pending += 1;
    pending.push({ videoKey: key, posterKey });
  }
  pending.sort((a, b) => (a.videoKey < b.videoKey ? -1 : a.videoKey > b.videoKey ? 1 : 0));
  return { counts, pending };
}

export function formatCounts(counts) {
  const lines = [
    `objects ${counts.objects}`,
    `videos ${counts.videos}`,
    `already ${counts.already}`,
    `skipped ${counts.skipped}`,
    `pending ${counts.pending}`,
  ];
  if (Object.prototype.hasOwnProperty.call(counts, "uploaded")) {
    lines.push(`uploaded ${counts.uploaded}`, `encrypted ${counts.encrypted}`, `failed ${counts.failed}`);
  }
  return `${lines.join("\n")}\n`;
}

export function frameArgs(inputPath, outputPath) {
  const edge = String(POSTER_EDGE);
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-ss", "0",
    "-i", inputPath,
    "-frames:v", "1",
    "-vf", `scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease`,
    "-q:v", String(MJPEG_QSCALE),
    outputPath,
  ];
}

export function r2Config(env) {
  const source = env || {};
  const bucket = String(source.R2_BUCKET || "").trim();
  const account = String(source.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = String(source.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(source.R2_SECRET_ACCESS_KEY || "").trim();
  if (!bucket || !account || !accessKeyId || !secretAccessKey) return null;
  return { bucket, account, accessKeyId, secretAccessKey };
}

export function invokedDirectly(argv = process.argv, url = import.meta.url) {
  const entry = argv && argv[1];
  if (!entry) return false;
  try {
    return url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

function isJpeg(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function* iterateBody(body) {
  if (!body) return;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    yield body;
    return;
  }
  if (typeof body[Symbol.asyncIterator] === "function") {
    yield* body;
    return;
  }
  if (typeof body.transformToByteArray === "function") {
    yield Buffer.from(await body.transformToByteArray());
  }
}

export async function readFirstBytes(client, bucket, key) {
  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    Range: `bytes=0-${FIRST_BYTES - 1}`,
  }));
  const body = response && response.Body;
  const chunks = [];
  let total = 0;
  try {
    for await (const piece of iterateBody(body)) {
      const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      if (!buf.length) continue;
      const room = FIRST_BYTES - total;
      if (buf.length > room) {
        chunks.push(buf.subarray(0, room));
        total += room;
        break;
      }
      chunks.push(buf);
      total += buf.length;
      if (total >= FIRST_BYTES) break;
    }
  } finally {
    if (body && typeof body.destroy === "function") {
      try { body.destroy(); } catch { /* already closed */ }
    }
  }
  return Buffer.concat(chunks);
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const status = err && err.$metadata && err.$metadata.httpStatusCode;
    const name = err && err.name ? err.name : "";
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
    throw err;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    child.on("error", () => reject(new Error("ffmpeg")));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("ffmpeg"));
    });
  });
}

export async function extractFrame(bytes) {
  const kind = videoContainerKind(bytes);
  if (!kind) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sbs-poster-"));
  const input = path.join(dir, kind === "webm" ? "in.webm" : "in.mp4");
  const output = path.join(dir, "out.jpg");
  try {
    await fs.writeFile(input, bytes);
    await runFfmpeg(frameArgs(input, output));
    const jpeg = await fs.readFile(output);
    return isJpeg(jpeg) ? jpeg : null;
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function listMarkerKeys(client, bucket) {
  const keys = [];
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: "markers/",
      ContinuationToken: token,
    }));
    for (const item of page.Contents || []) {
      if (item && typeof item.Key === "string" && item.Key) keys.push(item.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function runPool(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const width = Math.min(Math.max(1, limit | 0), list.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      await fn(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()));
}

export async function backfillOne(client, bucket, job, extract) {
  try {
    if (!job || posterKeyFor(job.videoKey) !== job.posterKey) return "failed";
    if (await objectExists(client, bucket, job.posterKey)) return "already";
    const bytes = await readFirstBytes(client, bucket, job.videoKey);
    if (!videoContainerKind(bytes)) return "encrypted";
    const jpeg = await extract(bytes);
    if (!isJpeg(jpeg)) return "failed";
    if (await objectExists(client, bucket, job.posterKey)) return "already";
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: job.posterKey,
      Body: jpeg,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }));
    return "uploaded";
  } catch {
    return "failed";
  }
}

export async function runBackfill({ client, bucket, keys, dryRun, extract = extractFrame, onResult }) {
  const { counts, pending } = classifyKeys(keys);
  if (dryRun) return { counts, pending };
  const live = { ...counts, uploaded: 0, encrypted: 0, failed: 0 };
  await runPool(pending, CONCURRENCY, async (job) => {
    let outcome = "failed";
    try {
      outcome = await backfillOne(client, bucket, job, extract);
    } catch {
      outcome = "failed";
    }
    if (outcome === "uploaded") live.uploaded += 1;
    else if (outcome === "encrypted") live.encrypted += 1;
    else if (outcome === "already") live.already += 1;
    else live.failed += 1;
    if (onResult) onResult(job, outcome);
  });
  return { counts: live, pending };
}

function clientFor(config) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.account}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dotenv = await import("dotenv");
  const here = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.join(here, "..", ".env") });
  const config = r2Config(process.env);
  if (!config) {
    console.error("R2 is not configured");
    process.exitCode = 1;
    return;
  }
  const client = clientFor(config);
  const keys = await listMarkerKeys(client, config.bucket);
  const outcome = await runBackfill({
    client,
    bucket: config.bucket,
    keys,
    dryRun,
    onResult(job, status) {
      if (status === "uploaded") console.log(`${job.videoKey} ${job.posterKey}`);
      else if (status === "encrypted" || status === "failed") console.error(`${status} ${job.videoKey}`);
    },
  });
  process.stdout.write(formatCounts(outcome.counts));
  if (!dryRun && outcome.counts.failed > 0) process.exitCode = 1;
}

if (invokedDirectly()) {
  main().catch(() => {
    console.error("backfill failed");
    process.exitCode = 1;
  });
}
