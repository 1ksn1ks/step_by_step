// One-off. Transcode every stored .gif to <same name>.mp4 and
// <same name>.poster.jpg next to it. Run by hand. Not imported by boot.
//
//   node scripts/transcode-stored-gifs.mjs
//
// Needs R2_* in server/.env and ffmpeg on PATH. Leaves the .gif in place
// so /api/media/gif can redirect old URLs. Skips a key whose MP4 and
// poster are already there.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { siblingKeys } from "../mediaurl.js";
import { convertGifBytes } from "../server/giftranscode.js";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "../server/.env") });

const bucket = process.env.R2_BUCKET;
const account = process.env.R2_ACCOUNT_ID;
if (!bucket || !account || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  console.error("R2 is not configured. Set R2_* in server/.env.");
  process.exit(1);
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function exists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function readKey(key) {
  const out = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await out.Body.transformToByteArray());
}

async function put(key, body, type) {
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: type,
    CacheControl: "public, max-age=31536000, immutable",
  }));
}

let token = undefined;
let seen = 0;
let wrote = 0;
let skipped = 0;
let failed = 0;
do {
  const page = await r2.send(new ListObjectsV2Command({
    Bucket: bucket,
    ContinuationToken: token,
  }));
  for (const item of page.Contents || []) {
    const key = item.Key || "";
    if (!/\.gif$/i.test(key)) continue;
    seen += 1;
    const sib = siblingKeys(key);
    if (await exists(sib.video) && await exists(sib.poster)) {
      skipped += 1;
      console.log(`skip ${key}`);
      continue;
    }
    try {
      const bytes = await readKey(key);
      const converted = await convertGifBytes(bytes, "media", { forceVideo: true });
      if (!converted.ok || converted.ext === ".gif") {
        failed += 1;
        console.log(`fail ${key} ${converted.error || "not converted"}`);
        continue;
      }
      await put(sib.video, converted.body, "video/mp4");
      await put(sib.poster, converted.poster, "image/jpeg");
      wrote += 1;
      console.log(`ok ${key} -> ${sib.video}`);
    } catch (err) {
      failed += 1;
      console.log(`fail ${key} ${err && err.message ? err.message : "error"}`);
    }
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

console.log(`gifs ${seen}, wrote ${wrote}, skipped ${skipped}, failed ${failed}`);
if (failed) process.exitCode = 1;
