// ffmpeg turns an uploaded GIF into an MP4 plus a poster, or a JPEG when
// the GIF has a single frame. The GIF bytes are never stored.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lookup } from "node:dns/promises";
import net from "node:net";
import {
  applyGifTranscode,
  ffmpegStillArgs,
  ffmpegVideoArgs,
} from "../mediaurl.js";

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("ffmpeg", args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    let errText = "";
    child.stderr.on("data", (chunk) => {
      errText += chunk.toString();
      if (errText.length > 4000) errText = errText.slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errText.trim() || `ffmpeg exited ${code}`));
    });
  });
}

async function ffmpegKind(kind, job) {
  const dir = await mkdtemp(path.join(tmpdir(), "gif-"));
  try {
    const input = path.join(dir, "in.gif");
    const output = path.join(dir, kind === "video" ? "out.mp4" : "out.jpg");
    await writeFile(input, job.bytes);
    const args = kind === "video"
      ? ffmpegVideoArgs(input, output, job.maxEdge)
      : ffmpegStillArgs(input, output, job.maxEdge);
    await runFfmpeg(args);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function convertGifBytes(bytes, role, options) {
  const opts = options || {};
  return applyGifTranscode({
    bytes,
    role,
    forceVideo: opts.forceVideo === true,
    run: ffmpegKind,
  });
}

function blockedAddress(address) {
  const ip = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (ip === "::1" || ip === "0.0.0.0") return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const kind = net.isIP(v4);
  if (kind === 4) {
    const parts = v4.split(".").map((n) => Number(n));
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (kind === 6) {
    if (ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  }
  return false;
}

function blockedHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "metadata.google.internal") return true;
  if (net.isIP(host) && blockedAddress(host)) return true;
  return false;
}

// Remote GIF fetches stay on public hosts. A private or link-local
// address, including one hidden behind DNS, is refused.
export async function remoteGifAllowed(urlString) {
  let parsed;
  try { parsed = new URL(urlString); } catch { return false; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.username || parsed.password) return false;
  if (blockedHost(parsed.hostname)) return false;
  try {
    const records = await lookup(parsed.hostname, { all: true });
    if (!records.length) return false;
    if (records.some((row) => blockedAddress(row.address))) return false;
  } catch {
    return false;
  }
  return true;
}
