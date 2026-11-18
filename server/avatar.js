// Profile picture thumbnails, made once and kept, so a 4000 px avatar is
// never sent to a 40 px circle.
//
// GET /api/avatar.webp?src=<source>&v=<n> (avatarRoute). <source> is
// read the way the page reads it (avatarSource in ../avatarsrc.js): a
// Hashinal through hcs1.js, an IPFS file through the page's gateway order
// (../ipfsimage.js), any other http(s) link fetched as below. The first
// frame is drawn (an animated GIF or WebP is a still, as avatars already
// are on the page), turned the way the camera held it, cropped to the
// centre square every avatar shows (object-fit: cover, centred) and
// written as an AVATAR_EDGE WebP. Transparency is kept.
//
// Kept in R2 under avatars/v<n>/<sha256 of the source>.webp, and the
// recent ones in memory; two requests for one picture share the work.
// Served immutable, with the same file headers as /api/hcs1. One nobody
// asked for in 90 days is deleted from R2 (avatarsweep.js).
//
// What a request can make this process do:
// - Only a profile's picture (isProfileSource, createProfileSources): any
//   other source is a 404 before R2 or the network is touched, and the
//   page draws the link itself.
// - createAvatarRateLimit: one budget per client IP for the whole route.
// - AVATAR_BUILD_RATE_MAX new thumbnails per client IP per window. A
//   thumbnail already made is not counted.
// - Two sets of slots across all requests: AVATAR_MAX_FETCHES sources
//   being read, and AVATAR_MAX_BUILDS thumbnails being decoded and written.
//   A slow source holds only a fetch slot, so it never keeps a quick one
//   from being made. A request finding its slots full waits up to
//   AVATAR_QUEUE_MS (at most AVATAR_QUEUE_MAX waiting per set), then 503.
// - A fetch: http(s) on ports 80/443 only, no user:password, every
//   address the name resolves to checked when the connection is made
//   (isBlockedAddress: private, loopback, link-local and the like), each
//   redirect checked again, at most AVATAR_MAX_REDIRECTS, AVATAR_MAX_BYTES
//   and AVATAR_FETCH_MS per fetch, AVATAR_TOTAL_MS per source however it
//   is read (its fetch slot is free again by then).
// - A decode: at most AVATAR_MAX_PIXELS, still formats only.
// - A source that is refused, missing or not a picture is remembered for
//   AVATAR_MISS_MS, one that is down or too slow for AVATAR_DOWN_MS, twice
//   as long each time it fails again, up to AVATAR_DOWN_MAX_MS (all in at
//   most AVATAR_MISS_ENTRIES). No user makes it fetch the source before
//   then. A busy server or a rate limit is not the source's: not kept.
//
// Any failure is an error answer; the page then draws the original link,
// and after that the default avatar (loopmedia.js). The browser keeps an
// error answer a short while (avatarFailureCacheControl), so a page that
// draws the picture again does not ask again.

import crypto from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { AVATAR_VERSION, avatarSource } from "../avatarsrc.js";
import { ipfsGatewayUrls } from "../ipfsimage.js";
import { getHcs1File } from "./hcs1.js";

export const AVATAR_EDGE = 384;
export const AVATAR_QUALITY = 80;
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_MAX_PIXELS = 50 * 1000 * 1000;
export const AVATAR_FETCH_MS = 5 * 1000;
export const AVATAR_TOTAL_MS = 10 * 1000;
export const AVATAR_MAX_REDIRECTS = 3;
export const AVATAR_MAX_FETCHES = 6;
export const AVATAR_MAX_BUILDS = 3;
export const AVATAR_QUEUE_MS = 2 * 1000;
export const AVATAR_QUEUE_MAX = 6;
export const AVATAR_RATE_MAX = 300;
export const AVATAR_BUILD_RATE_MAX = 30;
export const AVATAR_RATE_WINDOW_MS = 60 * 1000;
export const AVATAR_MISS_MS = 10 * 60 * 1000;
export const AVATAR_DOWN_MS = 60 * 1000;
export const AVATAR_DOWN_MAX_MS = AVATAR_MISS_MS;
export const AVATAR_MISS_ENTRIES = 5000;
export const AVATAR_CACHE_ENTRIES = 500;
export const AVATAR_RETRY_AFTER_S = 10;
export const AVATAR_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const AVATAR_FAIL_CACHE_S = 60;

// An error answer is kept by this browser only (private), AVATAR_FAIL_CACHE_S,
// or until Retry-After when the answer says when to ask again (busy, rate
// limited, the source down).
export function avatarFailureCacheControl(retryAfter) {
  const wait = Number(retryAfter);
  const seconds = Number.isFinite(wait) && wait > 0 ? Math.min(Math.ceil(wait), AVATAR_FAIL_CACHE_S) : AVATAR_FAIL_CACHE_S;
  return `private, max-age=${seconds}`;
}
// The same file headers as /api/hcs1: never run as a page, usable from
// other origins.
export const AVATAR_CSP = "sandbox; default-src 'none'";
export const AVATAR_CORP = "cross-origin";
export const AVATAR_PORTS = Object.freeze(["", "80", "443"]);
const USER_AGENT = "Mozilla/5.0 (compatible; AvatarThumbnail/1.0)";
// sharp's names. AVIF reads as "heif".
const PICTURE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "heif"]);

// Never fetched: this machine, private and shared networks, link-local
// (cloud metadata), documentation, benchmark, multicast and reserved
// ranges, and IPv6 forms that carry an IPv4 address inside. Two lists: a
// BlockList also matches an IPv4 address against IPv6 rules in its
// mapped form, so one list with ::ffff:0:0/96 would refuse every IPv4.
const BLOCKED_V4 = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) BLOCKED_V4.addSubnet(address, prefix, "ipv4");
const BLOCKED_V6 = new net.BlockList();
for (const [address, prefix] of [
  ["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10],
  ["fec0::", 10], ["ff00::", 8],
]) BLOCKED_V6.addSubnet(address, prefix, "ipv6");

export function isBlockedAddress(address) {
  const ip = String(address || "").replace(/^\[|\]$/g, "");
  const kind = net.isIP(ip);
  if (kind === 4) return BLOCKED_V4.check(ip, "ipv4");
  if (kind === 6) return BLOCKED_V6.check(ip, "ipv6");
  return true;
}

function fail(status, error, extra = {}) {
  return { ok: false, status, error, ...extra };
}

class AvatarError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// A link this route may fetch, as a URL. Throws 403 for a scheme, port,
// credentials or IP address it never fetches. A host name is checked when
// it resolves (guardedLookup).
export function checkSourceUrl(url, { isBlocked = isBlockedAddress, ports = AVATAR_PORTS } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    throw new AvatarError(400, "bad source");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new AvatarError(403, "source not allowed");
  if (parsed.username || parsed.password) throw new AvatarError(403, "source not allowed");
  if (!ports.includes(parsed.port)) throw new AvatarError(403, "source not allowed");
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new AvatarError(400, "bad source");
  if (net.isIP(host) && isBlocked(host, host)) throw new AvatarError(403, "source not allowed");
  return parsed;
}

// dns.lookup for one connection: every address the name has is checked,
// at the moment the socket is opened, so a name cannot pass a check and
// then point somewhere else.
export function guardedLookup({ lookup = dns.lookup, isBlocked = isBlockedAddress } = {}) {
  return function avatarLookup(hostname, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const opts = typeof options === "number" ? { family: options } : { ...(options || {}) };
    lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = (Array.isArray(addresses) ? addresses : [])
        .filter((entry) => entry && typeof entry.address === "string");
      if (!list.length) {
        const missing = new Error(`no address for ${hostname}`);
        missing.code = "ENOTFOUND";
        return callback(missing);
      }
      if (list.some((entry) => isBlocked(entry.address, hostname))) {
        const blocked = new Error("source not allowed");
        blocked.code = "EAVATARBLOCKED";
        return callback(blocked);
      }
      if (opts.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

function readCapped(stream, maxBytes, declared) {
  return new Promise((resolve, reject) => {
    if (Number.isFinite(declared) && declared > maxBytes) {
      stream.destroy();
      reject(new AvatarError(413, "source too large"));
      return;
    }
    const parts = [];
    let size = 0;
    stream.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy();
        reject(new AvatarError(413, "source too large"));
        return;
      }
      parts.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(parts)));
    stream.on("error", (err) => reject(err));
  });
}

function requestOnce(target, { lookup, maxBytes, signal }) {
  return new Promise((resolve, reject) => {
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(target, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
      },
      lookup,
      signal,
      agent: false,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: String(res.headers.location) });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        if (status === 404 || status === 410) reject(new AvatarError(404, "source not found"));
        else if (status === 429 || status >= 500) reject(new AvatarError(502, "source unavailable"));
        else reject(new AvatarError(404, "source refused"));
        return;
      }
      readCapped(res, maxBytes, Number(res.headers["content-length"])).then(
        (body) => resolve({ body }),
        reject,
      );
    });
    req.on("error", (err) => {
      if (err && err.code === "EAVATARBLOCKED") reject(new AvatarError(403, "source not allowed"));
      else if (err instanceof AvatarError) reject(err);
      else if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) reject(new AvatarError(502, "source timeout"));
      else if (err && err.code === "ENOTFOUND") reject(new AvatarError(404, "source not found"));
      else reject(new AvatarError(502, "source unavailable"));
    });
    req.end();
  });
}

// One http(s) file, following redirects, every hop checked again.
export async function fetchAvatarSource(url, {
  lookup = dns.lookup,
  isBlocked = isBlockedAddress,
  ports = AVATAR_PORTS,
  maxBytes = AVATAR_MAX_BYTES,
  timeoutMs = AVATAR_FETCH_MS,
  maxRedirects = AVATAR_MAX_REDIRECTS,
  signal,
} = {}) {
  const resolver = guardedLookup({ lookup, isBlocked });
  let current = String(url || "");
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const target = checkSourceUrl(current, { isBlocked, ports });
    const timer = AbortSignal.timeout(timeoutMs);
    const each = signal ? AbortSignal.any([signal, timer]) : timer;
    const answer = await requestOnce(target, { lookup: resolver, maxBytes, signal: each });
    if (answer.body) return answer.body;
    current = new URL(answer.redirect, target).href;
  }
  throw new AvatarError(502, "too many redirects");
}

async function streamBytes(body, maxBytes) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === "function") {
    const bytes = Buffer.from(await body.transformToByteArray());
    if (bytes.length > maxBytes) throw new AvatarError(413, "source too large");
    return bytes;
  }
  return readCapped(body, maxBytes);
}

// The source's bytes, read the way the page would read the link.
async function loadSource(source, opts) {
  if (source.startsWith("hcs://1/")) {
    const topicId = source.slice("hcs://1/".length);
    const file = await getHcs1File(topicId, opts.hcs1 || {});
    if (!file.ok) {
      const transient = file.status >= 500;
      throw new AvatarError(transient ? 502 : file.status, file.error || "hashinal unavailable", transient ? { retryAfter: file.retryAfter || AVATAR_RETRY_AFTER_S } : {});
    }
    if (file.size > opts.maxBytes) throw new AvatarError(413, "source too large");
    return file.bytes || streamBytes(await file.open(), opts.maxBytes);
  }
  const fetchOne = (url) => opts.fetchSource(url, {
    lookup: opts.lookup,
    isBlocked: opts.isBlocked,
    ports: opts.ports,
    maxBytes: opts.maxBytes,
    timeoutMs: opts.fetchMs,
    signal: opts.signal,
  });
  if (source.startsWith("ipfs://")) {
    // The page's gateway order. A miss on one gateway tries the next.
    let last = new AvatarError(404, "source not found");
    for (const url of ipfsGatewayUrls(source)) {
      if (opts.signal && opts.signal.aborted) break;
      try {
        return await fetchOne(url);
      } catch (err) {
        if (err instanceof AvatarError && err.status === 413) throw err;
        last = err instanceof AvatarError ? err : new AvatarError(502, "source unavailable");
      }
    }
    throw last;
  }
  return fetchOne(source);
}

// The thumbnail of one picture: its first frame, turned upright, the
// centre square (never enlarged) at most edge px, WebP.
export async function makeAvatarThumb(bytes, {
  edge = AVATAR_EDGE,
  quality = AVATAR_QUALITY,
  maxPixels = AVATAR_MAX_PIXELS,
} = {}) {
  // As lenient as a browser: a slightly truncated JPEG still shows there.
  const input = { limitInputPixels: maxPixels, animated: false, failOn: "none" };
  let meta;
  try {
    meta = await sharp(bytes, input).metadata();
  } catch (err) {
    if (/pixel limit/i.test(String(err && err.message))) throw new AvatarError(413, "source too large");
    throw new AvatarError(415, "not a picture");
  }
  if (!PICTURE_FORMATS.has(meta.format)) throw new AvatarError(415, "not a picture");
  const width = Number(meta.width) || 0;
  const height = Number(meta.pageHeight || meta.height) || 0;
  if (!width || !height) throw new AvatarError(415, "not a picture");
  const side = Math.min(width, height, edge);
  try {
    return await sharp(bytes, input)
      .rotate()
      .resize(side, side, { fit: "cover", position: "centre" })
      .webp({ quality, effort: 4 })
      .toBuffer();
  } catch (err) {
    if (/pixel limit/i.test(String(err && err.message))) throw new AvatarError(413, "source too large");
    throw new AvatarError(415, "not a picture");
  }
}

// A small LRU by entries.
function createMemory(maxEntries) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      map.delete(key);
      map.set(key, hit);
      return hit;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

function createWindowCounter() {
  const hits = new Map();
  return function count(key, max, windowMs, at) {
    if (hits.size > 4000) {
      for (const [name, bucket] of hits) {
        if (at >= bucket.reset) hits.delete(name);
      }
    }
    let bucket = hits.get(key);
    if (!bucket || at >= bucket.reset) {
      bucket = { reset: at + windowMs, count: 0 };
      hits.set(key, bucket);
    }
    bucket.count += 1;
    return { over: bucket.count > max, retryAfter: Math.max(1, Math.ceil((bucket.reset - at) / 1000)) };
  };
}

// A set of slots: take() answers true once one is held, after waiting at
// most waitMs behind at most queueMax others, or false. A slot given back
// goes straight to the first one waiting.
function createSlots() {
  let busy = 0;
  const waiting = [];
  return {
    take(max, waitMs, queueMax) {
      if (busy < max) {
        busy += 1;
        return Promise.resolve(true);
      }
      if (!(waitMs > 0) || waiting.length >= queueMax) return Promise.resolve(false);
      return new Promise((resolve) => {
        const entry = { resolve, timer: null };
        entry.timer = setTimeout(() => {
          const at = waiting.indexOf(entry);
          if (at !== -1) waiting.splice(at, 1);
          resolve(false);
        }, waitMs);
        if (typeof entry.timer.unref === "function") entry.timer.unref();
        waiting.push(entry);
      });
    },
    release() {
      const next = waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(true);
        return;
      }
      busy = Math.max(0, busy - 1);
    },
    get busy() {
      return busy;
    },
    get waiting() {
      return waiting.length;
    },
  };
}

const memory = createMemory(AVATAR_CACHE_ENTRIES);
const misses = createMemory(AVATAR_MISS_ENTRIES);
const flights = new Map();
const buildCounter = createWindowCounter();
const fetchSlots = createSlots();
const buildSlots = createSlots();

// Slots in use and requests waiting for one (tests, the console).
export function avatarWorkState() {
  return {
    fetching: fetchSlots.busy,
    building: buildSlots.busy,
    waiting: fetchSlots.waiting + buildSlots.waiting,
  };
}

// Forget everything held in this process (tests).
export function clearAvatarCache() {
  memory.clear();
  misses.clear();
  flights.clear();
}

export function avatarKey(source) {
  return `avatars/v${AVATAR_VERSION}/${sha256(source)}.webp`;
}

// The pictures this route makes thumbnails of (server/index.js): every
// account's current profile picture and the default avatar, each by its
// one spelling (avatarSource), so any link the page draws for it matches.
// Counted: several accounts can show one picture, and one changing theirs
// leaves it allowed for the others. has(source) takes that spelling.
export function createProfileSources(links = []) {
  const counts = new Map();
  const spelling = (link) => avatarSource(typeof link === "string" ? link : "");
  const add = (link) => {
    const source = spelling(link);
    if (source) counts.set(source, (counts.get(source) || 0) + 1);
  };
  const remove = (link) => {
    const source = spelling(link);
    const count = counts.get(source);
    if (!count) return;
    if (count > 1) counts.set(source, count - 1);
    else counts.delete(source);
  };
  for (const link of links) add(link);
  return {
    add,
    remove,
    // One account's picture changed from before to after.
    replace(before, after) {
      if (before === after) return;
      remove(before);
      add(after);
    },
    has: (source) => typeof source === "string" && counts.has(source),
    get size() {
      return counts.size;
    },
  };
}

function notFoundInR2(err) {
  const status = err && err.$metadata && err.$metadata.httpStatusCode;
  const name = String((err && (err.name || err.Code)) || "");
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}

async function fromR2(key, { s3, bucket }) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    if (!notFoundInR2(err)) console.error("avatar r2 head", err && err.message);
    return null;
  }
  try {
    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await streamBytes(got.Body, AVATAR_MAX_BYTES);
    return bytes.length ? bytes : null;
  } catch (err) {
    console.error("avatar r2 get", err && err.message);
    return null;
  }
}

async function toR2(key, bytes, { s3, bucket }) {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: "image/webp",
      CacheControl: AVATAR_CACHE_CONTROL,
    }));
  } catch (err) {
    // Still served; it is made again next time.
    console.error("avatar r2 put", err && err.message);
  }
}

function entryOf(bytes, source) {
  return { ok: true, status: 200, bytes, etag: `"${sha256(bytes)}"`, from: source };
}

// Settles with work, or rejects as a timeout once signal aborts, whichever
// comes first: a source that never answers (a Hashinal read cannot be
// aborted) still gives its slot back.
function withDeadline(work, signal) {
  if (signal.aborted) return Promise.reject(new AvatarError(502, "source timeout"));
  return new Promise((resolve, reject) => {
    const stop = () => reject(new AvatarError(502, "source timeout"));
    signal.addEventListener("abort", stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", stop);
        reject(err);
      },
    );
  });
}

function busy() {
  return fail(503, "busy", { retryAfter: AVATAR_RETRY_AFTER_S });
}

// A remembered failure as answered now. One that is the source being down
// says when it is asked again.
function missAnswer(miss, at) {
  if (!miss.strikes) return miss.result;
  return { ...miss.result, retryAfter: Math.max(1, Math.ceil((miss.until - at) / 1000)) };
}

// A failure that is the source's, answered and remembered so no request
// fetches the source again before its time. Refused, missing, too big or
// not a picture: AVATAR_MISS_MS. Down, too slow, or anything unexpected:
// AVATAR_DOWN_MS, twice as long each time it fails again within
// AVATAR_DOWN_MAX_MS of the last wait ending, up to AVATAR_DOWN_MAX_MS.
function sourceFailed(key, err, opts) {
  let result;
  if (err instanceof AvatarError) {
    result = fail(err.status, err.message);
  } else {
    console.error("avatar build", err && err.message);
    result = fail(502, "avatar unavailable");
  }
  const at = opts.now();
  if (result.status < 500) {
    misses.set(key, { until: at + AVATAR_MISS_MS, result, strikes: 0 });
    return result;
  }
  const before = misses.get(key);
  const again = !!(before && before.strikes && at - before.until <= AVATAR_DOWN_MAX_MS);
  const strikes = again ? Math.min(before.strikes + 1, 32) : 1;
  const wait = Math.min(AVATAR_DOWN_MS * 2 ** (strikes - 1), AVATAR_DOWN_MAX_MS);
  const miss = { until: at + wait, result, strikes };
  misses.set(key, miss);
  return missAnswer(miss, at);
}

// R2 first, with no slot. Then the source is read in a fetch slot, and the
// thumbnail made in a build slot.
async function build(source, key, opts) {
  if (opts.s3 && opts.bucket) {
    const stored = await fromR2(key, opts);
    if (stored) {
      const entry = entryOf(stored, "r2");
      memory.set(key, entry);
      misses.delete(key);
      return entry;
    }
  }
  const budget = buildCounter(`${opts.ip || "unknown"} build`, opts.buildRateMax, opts.windowMs, opts.now());
  if (budget.over) return fail(429, "rate limit", { retryAfter: budget.retryAfter });

  if (!(await fetchSlots.take(opts.maxFetches, opts.queueMs, opts.queueMax))) return busy();
  let bytes;
  try {
    const deadline = AbortSignal.timeout(opts.totalMs);
    bytes = await withDeadline(loadSource(source, { ...opts, signal: deadline }), deadline);
  } catch (err) {
    return sourceFailed(key, err, opts);
  } finally {
    fetchSlots.release();
  }

  if (!(await buildSlots.take(opts.maxBuilds, opts.queueMs, opts.queueMax))) return busy();
  let thumb;
  try {
    thumb = await makeAvatarThumb(bytes, { edge: opts.edge, quality: opts.quality, maxPixels: opts.maxPixels });
  } catch (err) {
    return sourceFailed(key, err, opts);
  } finally {
    buildSlots.release();
  }
  const entry = entryOf(thumb, "built");
  memory.set(key, entry);
  misses.delete(key);
  if (opts.s3 && opts.bucket) await toR2(key, thumb, opts);
  return entry;
}

// The thumbnail for a src link.
// { ok: true, status: 200, bytes, etag, from: "memory" | "r2" | "built" }
// or { ok: false, status, error, retryAfter? }: 400 bad src, 403 not a
// source this route fetches, 404 missing or refused, 413 too large, 415 not
// a picture, 429 too many new thumbnails, 502 the source is down or too
// slow (retryAfter: when it is fetched again), 503 no slot came free.
// isProfileSource(source): only a source it accepts is looked up in R2,
// fetched or made; anything else is a 404 (not remembered: it is made once
// it becomes a profile's picture). A thumbnail already in memory is still
// served. seen(key) is told of every thumbnail answered (the R2 sweep).
export async function getAvatarThumb(src, {
  isProfileSource = null,
  seen = null,
  ip = "",
  s3 = null,
  bucket = "",
  hcs1 = {},
  fetchSource = fetchAvatarSource,
  lookup = dns.lookup,
  isBlocked = isBlockedAddress,
  ports = AVATAR_PORTS,
  maxBytes = AVATAR_MAX_BYTES,
  maxPixels = AVATAR_MAX_PIXELS,
  edge = AVATAR_EDGE,
  quality = AVATAR_QUALITY,
  fetchMs = AVATAR_FETCH_MS,
  totalMs = AVATAR_TOTAL_MS,
  maxFetches = AVATAR_MAX_FETCHES,
  maxBuilds = AVATAR_MAX_BUILDS,
  queueMs = AVATAR_QUEUE_MS,
  queueMax = AVATAR_QUEUE_MAX,
  buildRateMax = AVATAR_BUILD_RATE_MAX,
  windowMs = AVATAR_RATE_WINDOW_MS,
  now = Date.now,
} = {}) {
  const source = avatarSource(typeof src === "string" ? src : "");
  if (!source) return fail(400, "bad src");
  // An http(s) source this route never fetches is refused before anything
  // else, remembered or not.
  if (/^https?:/i.test(source)) {
    try {
      checkSourceUrl(source, { isBlocked, ports });
    } catch (err) {
      return fail(err.status || 400, err.message);
    }
  }
  const key = avatarKey(source);
  const served = (result) => {
    if (result.ok && typeof seen === "function") {
      try {
        seen(key);
      } catch (err) {
        console.error("avatar seen", err && err.message);
      }
    }
    return result;
  };
  const hit = memory.get(key);
  if (hit) return served({ ...hit, from: "memory" });
  if (typeof isProfileSource === "function" && !isProfileSource(source)) return fail(404, "not a profile picture");
  const miss = misses.get(key);
  if (miss) {
    const at = now();
    if (at < miss.until) return missAnswer(miss, at);
    // A source that was down keeps its count of failures: failing again
    // soon after waits longer.
    if (!miss.strikes) misses.delete(key);
  }
  let flight = flights.get(key);
  if (!flight) {
    const opts = {
      ip, s3, bucket, hcs1, fetchSource, lookup, isBlocked, ports, maxBytes, maxPixels, edge, quality,
      fetchMs, totalMs, maxFetches, maxBuilds, queueMs, queueMax, buildRateMax, windowMs, now,
    };
    flight = build(source, key, opts).finally(() => flights.delete(key));
    flights.set(key, flight);
  }
  return served(await flight);
}

// One budget per client IP for the whole route, every picture together.
export function createAvatarRateLimit({
  clientIp = (req) => req.ip,
  max = AVATAR_RATE_MAX,
  windowMs = AVATAR_RATE_WINDOW_MS,
  now = Date.now,
} = {}) {
  const count = createWindowCounter();
  return function avatarRateLimit(req, res, next) {
    const verdict = count(`${clientIp(req) || "unknown"} /api/avatar`, max, windowMs, now());
    if (verdict.over) {
      res.setHeader("Retry-After", String(verdict.retryAfter));
      res.setHeader("Access-Control-Expose-Headers", "Retry-After");
      res.setHeader("Cache-Control", avatarFailureCacheControl(verdict.retryAfter));
      return res.status(429).json({ ok: false, error: "rate limit" });
    }
    next();
  };
}

function etagMatches(header, etag) {
  if (typeof header !== "string" || !header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
}

// GET /api/avatar.webp?src=<source>&v=<n>
// opts.isProfileSource is required: the route makes thumbnails of profile
// pictures only, never of any link it is handed.
export function avatarRoute(opts = {}) {
  if (typeof opts.isProfileSource !== "function") throw new TypeError("avatarRoute needs isProfileSource");
  const clientIp = opts.clientIp || ((req) => req.ip);
  return async function avatar(req, res) {
    const src = req.query && typeof req.query.src === "string" ? req.query.src : "";
    let thumb;
    try {
      thumb = await getAvatarThumb(src, { ...opts, ip: clientIp(req) });
    } catch (err) {
      console.error("avatar", err && err.message);
      thumb = fail(502, "avatar unavailable", { retryAfter: AVATAR_RETRY_AFTER_S });
    }
    if (res.headersSent) return;
    if (!thumb.ok) {
      if (thumb.retryAfter) {
        res.setHeader("Retry-After", String(thumb.retryAfter));
        res.setHeader("Access-Control-Expose-Headers", "Retry-After");
      }
      res.setHeader("Cache-Control", avatarFailureCacheControl(thumb.retryAfter));
      return res.status(thumb.status).json({ ok: false, error: thumb.error });
    }
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", AVATAR_CACHE_CONTROL);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", AVATAR_CSP);
    res.setHeader("Cross-Origin-Resource-Policy", AVATAR_CORP);
    res.setHeader("ETag", thumb.etag);
    if (etagMatches(req.headers && req.headers["if-none-match"], thumb.etag)) return res.status(304).end();
    res.setHeader("Content-Length", String(thumb.bytes.length));
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).end(thumb.bytes);
  };
}
