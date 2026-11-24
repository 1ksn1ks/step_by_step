// Hashinal files (HCS-1), rebuilt from their topic on the mirror node, so
// the app does not depend on a third-party inscription CDN.
//
// An HCS-1 topic's memo is "<sha256 hex>:zstd:base64". Its messages are
// JSON { o, c }: o is the chunk's place, c a piece of one text. Sorted by
// o and joined, the text is "data:<mime>;base64,<base64>" (the data: part
// is optional); the base64 is the zstd-compressed file, and the memo's
// hash is the SHA-256 of the file itself. A file whose hash does not match
// is never served.
//
// GET /api/hcs1/:topicId (hcs1Route). A file is rebuilt once: the bytes go
// to R2 under hcs1/<topicId> (immutable) when its type is one we keep
// (HCS1_R2_TYPES), and a small in-memory LRU keeps the recent ones. Later
// requests read memory, then R2, and only then the mirror. Two requests for
// one topic while it is rebuilt share the work.
//
// What one client, or all of them, can make this process do:
// - createHcs1RateLimit: one budget per client IP for the whole route,
//   whatever the topic, apart from the other public limits.
// - HCS1_MAX_REBUILDS rebuilds from the mirror at once, across all
//   requests. Past that the answer is 503 with Retry-After, and the app
//   falls back to Kiloscribe (hashinalurl.js).
// - HCS1_NEW_REBUILD_PER_IP_HOUR new mirror rebuilds per client IP per
//   hour (env HCS1_NEW_REBUILD_PER_IP_HOUR). A memory or R2 hit does not
//   count. The route passes the client IP; past the cap the answer is
//   429 with Retry-After. A call with no IP is not this budget.
// - New hcs1/ R2 writes: HCS1_R2_DAILY_IP_MB per IP per day and
//   HCS1_R2_DAILY_TOTAL_MB for every IP together (env
//   HCS1_R2_DAILY_IP_MB, HCS1_R2_DAILY_TOTAL_MB). Over either budget the
//   file is still served and the write is skipped.
// - HCS1_MAX_BYTES / HCS1_MAX_MESSAGES per rebuild.
// - HCS1_MISS_ENTRIES remembered misses, the oldest dropped first.

import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

export const HCS1_MIRROR = "https://mainnet.mirrornode.hedera.com";
// Caps on one rebuild. Real Hashinals reach 3–4 MB in about 4000
// messages (0.0.4841271 has 3931). One HCS message holds at most about
// 1 KB, so the message cap is the byte cap's worth of messages.
export const HCS1_MAX_BYTES = 10 * 1024 * 1024;
export const HCS1_MAX_MESSAGES = 12000;
// Rebuilds from the mirror at once, across every request.
export const HCS1_MAX_REBUILDS = 2;
// Topics remembered as having no file (or a bad one).
export const HCS1_MISS_ENTRIES = 5000;
// The route's own rate limit: requests per client IP per window, all
// topics together.
export const HCS1_RATE_MAX = 120;
export const HCS1_RATE_WINDOW_MS = 60 * 1000;
export const HCS1_RATE_SCOPE = "/api/hcs1";

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// New mirror rebuilds per client IP per hour. Modelled on
// AVATAR_BUILD_RATE_MAX: a file already made (memory or R2) is not counted.
export const HCS1_NEW_REBUILD_PER_IP_HOUR = envNumber("HCS1_NEW_REBUILD_PER_IP_HOUR", 10);
export const HCS1_NEW_REBUILD_WINDOW_MS = 60 * 60 * 1000;
// New hcs1/ objects written to R2. Over either budget the file is still
// served and the put is skipped.
export const HCS1_R2_DAILY_IP_MB = envNumber("HCS1_R2_DAILY_IP_MB", 50);
export const HCS1_R2_DAILY_TOTAL_MB = envNumber("HCS1_R2_DAILY_TOTAL_MB", 200);
export const HCS1_R2_DAY_MS = 24 * 60 * 60 * 1000;
// The types a rebuilt file is saved to R2 under: pictures, video, sound and
// 3D models. Never SVG, text/*, JavaScript or HTML. Any other type is
// still served (hcs1ServeType), from memory or rebuilt again, but not kept.
export const HCS1_R2_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "model/gltf-binary",
  "model/gltf+json",
]);
// Sent with every file: never run as a page, even opened on its own, and
// loadable from other origins (a wallet showing the app's icon).
export const HCS1_CSP = "sandbox; default-src 'none'";
export const HCS1_CORP = "cross-origin";
export const HCS1_CACHE_ENTRIES = 100;
export const HCS1_CACHE_BYTES = 100 * 1024 * 1024;
// A file bigger than this is not kept in memory; it streams from R2.
export const HCS1_CACHE_ITEM_BYTES = 16 * 1024 * 1024;
// A topic with no file (or a bad one) is not asked about again for a while.
export const HCS1_MISS_MS = 10 * 60 * 1000;
export const HCS1_PAGE_TIMEOUT_MS = 20 * 1000;
export const HCS1_RETRY_AFTER_S = 10;
export const HCS1_CACHE_CONTROL = "public, max-age=31536000, immutable";

const TOPIC_ID = /^0\.0\.\d+$/;
const MEMO = /^([0-9a-f]{64}):zstd:base64$/i;
const DATA_URI = /^data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*)((?:;[a-z0-9_.+-]+=[^;,]*)*);base64,/i;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
// Types sent as themselves (besides image/*, video/* and audio/*).
const INLINE_TYPES = new Set(["model/gltf-binary", "model/gltf+json"]);
const DOWNLOAD = Object.freeze({ contentType: "application/octet-stream", attachment: true });

export function isHcs1TopicId(value) {
  return typeof value === "string" && value.length <= 32 && TOPIC_ID.test(value);
}

// { sha256 } from an HCS-1 memo, or null.
export function parseHcs1Memo(memo) {
  const match = MEMO.exec(typeof memo === "string" ? memo.trim() : "");
  return match ? { sha256: match[1].toLowerCase() } : null;
}

// How the file is sent. An allowlist: pictures (not SVG), video, sound and
// glTF models go as their own type; everything else, unknown and
// application/octet-stream included, is a download of application/
// octet-stream. Any XML-based type is a download too, so no image/*+xml
// can render as a document.
export function hcs1ServeType(mime) {
  const type = typeof mime === "string" ? mime.trim().toLowerCase() : "";
  if (!MIME.test(type) || type.endsWith("+xml")) return { ...DOWNLOAD };
  const [top] = type.split("/");
  if (top === "image" || top === "video" || top === "audio" || INLINE_TYPES.has(type)) {
    return { contentType: type, attachment: false };
  }
  return { ...DOWNLOAD };
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fail(status, error, extra = {}) {
  return { ok: false, status, error, ...extra };
}

// Mirror rows to the joined text: each message is base64 of JSON { o, c }.
// Anything else in the topic is skipped; the first chunk for a place wins.
// { ok, text } or a failure.
export function joinHcs1Messages(messages, { maxText = textCap(HCS1_MAX_BYTES) } = {}) {
  const chunks = new Map();
  let size = 0;
  for (const row of messages || []) {
    if (!row || typeof row.message !== "string") continue;
    let part;
    try {
      part = JSON.parse(Buffer.from(row.message, "base64").toString("utf8"));
    } catch {
      continue;
    }
    if (!part || typeof part !== "object" || !Number.isInteger(part.o) || part.o < 0 || typeof part.c !== "string") continue;
    if (chunks.has(part.o)) continue;
    chunks.set(part.o, part.c);
    size += part.c.length;
    if (size > maxText) return fail(413, "too large");
  }
  if (!chunks.size) return fail(404, "no hcs-1 messages");
  const order = [...chunks.keys()].sort((a, b) => a - b);
  return { ok: true, text: order.map((o) => chunks.get(o)).join("") };
}

// The joined text to the file. The hash must match the memo's.
// { ok, bytes, mime, sha256 } or a failure (422 for a file that is not
// what the memo says, 413 past the cap).
export function decodeHcs1Text(text, expectedSha256, { maxBytes = HCS1_MAX_BYTES } = {}) {
  let body = String(text || "");
  let mime = "application/octet-stream";
  const head = DATA_URI.exec(body.slice(0, 512));
  if (head) {
    mime = head[1].toLowerCase();
    body = body.slice(head[0].length);
  }
  body = body.replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return fail(422, "not base64");
  const compressed = Buffer.from(body, "base64");
  if (compressed.length > maxBytes) return fail(413, "too large");
  let bytes;
  try {
    bytes = zlib.zstdDecompressSync(compressed, { maxOutputLength: maxBytes });
  } catch (err) {
    if (err && (err.code === "ERR_BUFFER_TOO_LARGE" || err instanceof RangeError)) return fail(413, "too large");
    return fail(422, "not zstd");
  }
  const hash = sha256(bytes);
  if (hash !== String(expectedSha256 || "").toLowerCase()) return fail(422, "hash mismatch");
  return { ok: true, bytes, mime, sha256: hash };
}

function textCap(maxBytes) {
  // Base64 of the compressed file, plus room for the data: part.
  return Math.ceil(maxBytes / 3) * 4 + 512;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mirror timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// A mirror error as an answer: rate limited or down is 502 with a retry
// hint; a topic the mirror does not know is 404.
function mirrorFailure(err) {
  const message = String((err && err.message) || "");
  if (/\bHTTP (400|404)\b/.test(message)) return fail(404, "no such topic");
  return fail(502, err && err.rateLimited ? "mirror rate limited" : "mirror unavailable", {
    retryAfter: HCS1_RETRY_AFTER_S,
  });
}

// Every message of the topic, oldest first, following links.next. A mirror
// message is at most 1 KB, so the message cap also caps what is held here;
// joinHcs1Messages caps the text itself.
async function readTopicMessages(topicId, { mirrorFetch, mirror, maxMessages, pageTimeoutMs }) {
  const rows = [];
  let url = `${mirror}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
  const nextPrefix = `/api/v1/topics/${topicId}/messages`;
  while (url) {
    const page = await withTimeout(Promise.resolve(mirrorFetch(url)), pageTimeoutMs);
    for (const row of (page && Array.isArray(page.messages) ? page.messages : [])) {
      rows.push(row);
      if (rows.length > maxMessages) return fail(413, "too many messages");
    }
    const next = page && page.links && typeof page.links.next === "string" ? page.links.next : "";
    url = next && next.startsWith(nextPrefix) ? mirror + next : "";
  }
  return { ok: true, rows };
}

// A small LRU by entries and bytes. A read moves the topic to the end.
export function createHcs1Memory({ maxEntries = HCS1_CACHE_ENTRIES, maxBytes = HCS1_CACHE_BYTES } = {}) {
  const map = new Map();
  let bytes = 0;
  return {
    get(id) {
      const hit = map.get(id);
      if (!hit) return null;
      map.delete(id);
      map.set(id, hit);
      return hit;
    },
    set(id, entry) {
      if (map.has(id)) {
        bytes -= map.get(id).bytes.length;
        map.delete(id);
      }
      map.set(id, entry);
      bytes += entry.bytes.length;
      while (map.size > maxEntries || bytes > maxBytes) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        bytes -= map.get(oldest).bytes.length;
        map.delete(oldest);
      }
    },
    clear() {
      map.clear();
      bytes = 0;
    },
    get size() {
      return map.size;
    },
    get bytes() {
      return bytes;
    },
  };
}

// Topics with no file, each with when to ask again. At most maxEntries:
// past that the oldest is dropped first (they also expire first).
export function createHcs1Misses({ maxEntries = HCS1_MISS_ENTRIES } = {}) {
  const map = new Map();
  return {
    get(id) {
      return map.get(id) || null;
    },
    set(id, miss) {
      map.delete(id);
      map.set(id, miss);
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },
    delete(id) {
      map.delete(id);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

// Whether a rebuilt file of this type is saved to R2.
export function hcs1Storable(mime, types = HCS1_R2_TYPES) {
  const type = typeof mime === "string" ? mime.trim().toLowerCase() : "";
  return !!type && types.has(type);
}

// The rate-limit key: the client's IP and the route, never the topic, so
// asking for many topics spends one budget.
export function hcs1RateKey(ip) {
  return `${ip || "unknown"} ${HCS1_RATE_SCOPE}`;
}

// The route's limiter, with its own counters and budget: max requests per
// client IP per windowMs, all topics together. clientIp is the server's
// own (index.js), which knows which proxy headers to trust.
export function createHcs1RateLimit({
  clientIp = (req) => req.ip,
  max = HCS1_RATE_MAX,
  windowMs = HCS1_RATE_WINDOW_MS,
  now = Date.now,
} = {}) {
  const hits = new Map();
  return function hcs1RateLimit(req, res, next) {
    const at = now();
    if (hits.size > 4000) {
      for (const [key, bucket] of hits) {
        if (at >= bucket.reset) hits.delete(key);
      }
    }
    const key = hcs1RateKey(clientIp(req));
    let bucket = hits.get(key);
    if (!bucket || at >= bucket.reset) {
      bucket = { reset: at + windowMs, count: 0 };
      hits.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.reset - at) / 1000))));
      res.setHeader("Access-Control-Expose-Headers", "Retry-After");
      res.setHeader("Cache-Control", "no-store");
      return res.status(429).json({ ok: false, error: "rate limit" });
    }
    next();
  };
}

const memory = createHcs1Memory();
const flights = new Map();
const misses = createHcs1Misses();
let rebuilding = 0;
// Per-IP new rebuilds, and per-IP plus total R2 write bytes. Pruned the
// same way as createHcs1RateLimit: once the map is large, expired windows
// are dropped. A key's own window also ends at bucket.reset.
const rebuildHits = new Map();
const r2Writes = new Map();
const R2_TOTAL_KEY = "*";

function pruneBuckets(map, at) {
  if (map.size <= 4000) return;
  for (const [key, bucket] of map) {
    if (at >= bucket.reset) map.delete(key);
  }
}

function bucketAt(map, key, at, windowMs) {
  pruneBuckets(map, at);
  let bucket = map.get(key);
  if (!bucket || at >= bucket.reset) {
    bucket = { reset: at + windowMs, count: 0, bytes: 0 };
    map.set(key, bucket);
  }
  return bucket;
}

// One new mirror rebuild. over is true once count passes max. The window
// stays the one opened by the first rebuild in it.
function takeRebuild(ip, max, windowMs, at) {
  const bucket = bucketAt(rebuildHits, `${ip} hcs1-rebuild`, at, windowMs);
  bucket.count += 1;
  return {
    over: bucket.count > max,
    retryAfter: Math.max(1, Math.ceil((bucket.reset - at) / 1000)),
  };
}

// True when this many bytes still fit in both the IP's day and the
// process-wide day. A refusal adds nothing.
function allowR2Write(ip, size, { ipMax, totalMax, windowMs, at }) {
  const ipBucket = bucketAt(r2Writes, `${ip} hcs1-r2`, at, windowMs);
  const totalBucket = bucketAt(r2Writes, R2_TOTAL_KEY, at, windowMs);
  if (ipBucket.bytes + size > ipMax || totalBucket.bytes + size > totalMax) return false;
  ipBucket.bytes += size;
  totalBucket.bytes += size;
  return true;
}

function r2WriteAllowed(entry, opts) {
  const ipMax = Number.isFinite(opts.r2DailyIpBytes) ? opts.r2DailyIpBytes : HCS1_R2_DAILY_IP_MB * 1024 * 1024;
  const totalMax = Number.isFinite(opts.r2DailyTotalBytes) ? opts.r2DailyTotalBytes : HCS1_R2_DAILY_TOTAL_MB * 1024 * 1024;
  const windowMs = opts.r2DayMs > 0 ? opts.r2DayMs : HCS1_R2_DAY_MS;
  return allowR2Write(opts.ip || "unknown", entry.size, {
    ipMax,
    totalMax,
    windowMs,
    at: opts.now(),
  });
}

// Forget everything held in this process (tests). A rebuild still running
// keeps its place in the rebuild count until it ends. counters: false
// drops the files but keeps the rebuild and R2 budgets.
export function clearHcs1Cache(options = {}) {
  memory.clear();
  flights.clear();
  misses.clear();
  if (!options || options.counters !== false) {
    rebuildHits.clear();
    r2Writes.clear();
  }
}

function r2Key(topicId) {
  return `hcs1/${topicId}`;
}

function notFoundInR2(err) {
  const status = err && err.$metadata && err.$metadata.httpStatusCode;
  const name = String((err && (err.name || err.Code)) || "");
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}

async function bodyBytes(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const parts = [];
  for await (const part of body) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}

// The file from R2, if it was stored before. Small files are read and kept
// in memory; big ones stream from R2 for each request.
async function fromR2(topicId, { s3, bucket, maxBytes }) {
  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: r2Key(topicId) }));
  } catch (err) {
    if (!notFoundInR2(err)) console.error("hcs1 r2 head", topicId, err && err.message);
    return null;
  }
  const meta = (head && head.Metadata) || {};
  const hash = String(meta.sha256 || "").toLowerCase();
  const size = Number(head && head.ContentLength);
  if (!/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(size) || size > maxBytes) return null;
  const mime = MIME.test(String(meta.mime || "")) ? String(meta.mime).toLowerCase() : "application/octet-stream";
  const open = async () => {
    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key(topicId) }));
    return got.Body;
  };
  if (size <= HCS1_CACHE_ITEM_BYTES) {
    try {
      const bytes = await bodyBytes(await open());
      // What was stored was checked when it was stored; check it again.
      if (sha256(bytes) !== hash) {
        console.error("hcs1 r2 copy does not match its hash", topicId);
        return null;
      }
      const entry = { bytes, mime, sha256: hash, size: bytes.length };
      memory.set(topicId, entry);
      return { ok: true, status: 200, source: "r2", ...entry };
    } catch (err) {
      console.error("hcs1 r2 get", topicId, err && err.message);
      return null;
    }
  }
  return { ok: true, status: 200, source: "r2", mime, sha256: hash, size, open };
}

async function toR2(topicId, file, { s3, bucket }) {
  const type = hcs1ServeType(file.mime);
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: r2Key(topicId),
      Body: file.bytes,
      ContentType: type.contentType,
      ...(type.attachment ? { ContentDisposition: `attachment; filename="${topicId}"` } : {}),
      CacheControl: HCS1_CACHE_CONTROL,
      Metadata: { sha256: file.sha256, mime: file.mime },
    }));
  } catch (err) {
    // The file is still served; it is rebuilt again next time.
    console.error("hcs1 r2 put", topicId, err && err.message);
  }
}

async function rebuild(topicId, opts) {
  const { mirrorFetch, mirror, maxBytes, maxMessages, pageTimeoutMs } = opts;
  let topic;
  try {
    topic = await withTimeout(Promise.resolve(mirrorFetch(`${mirror}/api/v1/topics/${topicId}`)), pageTimeoutMs);
  } catch (err) {
    return mirrorFailure(err);
  }
  const memo = parseHcs1Memo(topic && topic.memo);
  if (!memo) return fail(404, "not an hcs-1 topic");
  const maxText = textCap(maxBytes);
  let read;
  try {
    read = await readTopicMessages(topicId, { mirrorFetch, mirror, maxMessages, pageTimeoutMs });
  } catch (err) {
    return mirrorFailure(err);
  }
  if (!read.ok) return read;
  const joined = joinHcs1Messages(read.rows, { maxText });
  if (!joined.ok) return joined;
  const file = decodeHcs1Text(joined.text, memo.sha256, { maxBytes });
  if (!file.ok) return file;
  const entry = { bytes: file.bytes, mime: file.mime, sha256: file.sha256, size: file.bytes.length };
  if (entry.size <= HCS1_CACHE_ITEM_BYTES) memory.set(topicId, entry);
  // Over the daily budget the file is still served; the put is skipped.
  if (opts.s3 && opts.bucket && hcs1Storable(file.mime, opts.storeTypes) && r2WriteAllowed(entry, opts)) {
    await toR2(topicId, file, opts);
  }
  return { ok: true, status: 200, source: "mirror", ...entry };
}

async function load(topicId, opts) {
  if (opts.s3 && opts.bucket) {
    const stored = await fromR2(topicId, opts);
    if (stored) return stored;
  }
  // Only so many rebuilds at once: past that, busy, and the app takes
  // Kiloscribe's copy for now. Checked before the per-IP budget, so a
  // busy answer does not spend an hourly rebuild.
  if (rebuilding >= opts.maxRebuilds) {
    return fail(503, "busy", { retryAfter: HCS1_RETRY_AFTER_S });
  }
  // The route passes the client IP. A call with no IP (a server-side read,
  // a test of the miss map) is not this budget. Memory and R2 already
  // returned above, so a hit never reaches here.
  if (opts.ip) {
    const max = Number.isFinite(opts.newRebuildMax) ? opts.newRebuildMax : HCS1_NEW_REBUILD_PER_IP_HOUR;
    const windowMs = opts.newRebuildWindowMs > 0 ? opts.newRebuildWindowMs : HCS1_NEW_REBUILD_WINDOW_MS;
    const gate = takeRebuild(opts.ip, max, windowMs, opts.now());
    if (gate.over) return fail(429, "rate limit", { retryAfter: gate.retryAfter });
  }
  rebuilding += 1;
  let result;
  try {
    result = await rebuild(topicId, opts);
  } finally {
    rebuilding -= 1;
  }
  // A topic with no file, or a file that does not match its memo, is not
  // looked up again for a while. A mirror outage, a busy server, or this
  // IP's rebuild cap is not the topic's.
  if (!result.ok && result.status < 500 && result.status !== 429) {
    misses.set(topicId, { until: opts.now() + HCS1_MISS_MS, result });
  }
  return result;
}

// The file of an HCS-1 topic.
// { ok: true, status: 200, mime, sha256, size, bytes } (bytes in memory), or
// { ok: true, ..., open } (a big file in R2: open() gives a stream), or
// { ok: false, status, error, retryAfter? }: 400 bad id, 404 no HCS-1 file,
// 413 over the caps, 422 not the file the memo names, 429 too many new
// rebuilds from this IP, 502 mirror trouble, 503 too many rebuilds at once.
export async function getHcs1File(topicId, {
  mirrorFetch,
  s3 = null,
  bucket = "",
  mirror = HCS1_MIRROR,
  maxBytes = HCS1_MAX_BYTES,
  maxMessages = HCS1_MAX_MESSAGES,
  maxRebuilds = HCS1_MAX_REBUILDS,
  storeTypes = HCS1_R2_TYPES,
  pageTimeoutMs = HCS1_PAGE_TIMEOUT_MS,
  now = Date.now,
  ip = "",
  newRebuildMax,
  newRebuildWindowMs,
  r2DailyIpBytes,
  r2DailyTotalBytes,
  r2DayMs,
} = {}) {
  if (!isHcs1TopicId(topicId)) return fail(400, "bad topic id");
  const hit = memory.get(topicId);
  if (hit) return { ok: true, status: 200, source: "memory", ...hit };
  const miss = misses.get(topicId);
  if (miss) {
    if (now() < miss.until) return miss.result;
    misses.delete(topicId);
  }
  let flight = flights.get(topicId);
  if (!flight) {
    const types = storeTypes instanceof Set ? storeTypes : new Set([...(storeTypes || [])].map((t) => String(t).toLowerCase()));
    const opts = {
      mirrorFetch, s3, bucket, mirror, maxBytes, maxMessages, maxRebuilds, storeTypes: types, pageTimeoutMs, now,
      ip, newRebuildMax, newRebuildWindowMs, r2DailyIpBytes, r2DailyTotalBytes, r2DayMs,
    };
    flight = load(topicId, opts).finally(() => flights.delete(topicId));
    flights.set(topicId, flight);
  }
  return flight;
}

function etagMatches(header, etag) {
  if (typeof header !== "string" || !header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
}

// GET /api/hcs1/:topicId
export function hcs1Route(opts = {}) {
  const clientIp = typeof opts.clientIp === "function" ? opts.clientIp : (req) => req && req.ip;
  return async function hcs1(req, res) {
    const topicId = String((req.params && req.params.topicId) || "");
    let file;
    try {
      file = await getHcs1File(topicId, { ...opts, ip: clientIp(req) || "unknown" });
    } catch (err) {
      console.error("hcs1", topicId, err && err.message);
      file = fail(502, "hashinal unavailable", { retryAfter: HCS1_RETRY_AFTER_S });
    }
    if (res.headersSent) return;
    if (!file.ok) {
      if (file.retryAfter) {
        res.setHeader("Retry-After", String(file.retryAfter));
        res.setHeader("Access-Control-Expose-Headers", "Retry-After");
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(file.status).json({ ok: false, error: file.error });
    }
    const etag = `"${file.sha256}"`;
    const type = hcs1ServeType(file.mime);
    res.setHeader("Content-Type", type.contentType);
    if (type.attachment) res.setHeader("Content-Disposition", `attachment; filename="${topicId}"`);
    res.setHeader("Cache-Control", HCS1_CACHE_CONTROL);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Every file answer (200, and the 304 that revalidates it): never a
    // page with scripts or requests of its own, and usable cross-origin.
    res.setHeader("Content-Security-Policy", HCS1_CSP);
    res.setHeader("Cross-Origin-Resource-Policy", HCS1_CORP);
    res.setHeader("ETag", etag);
    if (etagMatches(req.headers && req.headers["if-none-match"], etag)) return res.status(304).end();
    res.setHeader("Content-Length", String(file.size));
    if (req.method === "HEAD") return res.status(200).end();
    if (file.bytes) return res.status(200).end(file.bytes);
    let body;
    try {
      body = await file.open();
    } catch (err) {
      console.error("hcs1 r2 open", topicId, err && err.message);
      for (const name of ["Content-Type", "Content-Disposition", "Cache-Control", "ETag", "Content-Length", "X-Content-Type-Options", "Content-Security-Policy", "Cross-Origin-Resource-Policy"]) res.removeHeader(name);
      res.setHeader("Retry-After", String(HCS1_RETRY_AFTER_S));
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).json({ ok: false, error: "hashinal unavailable" });
    }
    try {
      res.status(200);
      await pipeline(body instanceof Readable ? body : Readable.from(body), res);
    } catch (err) {
      console.error("hcs1 stream", topicId, err && err.message);
      res.destroy(err);
    }
  };
}
