// One media address for every renderer. A GIF is never painted as an
// <img> src or a CSS background. Callers ask classifyImageUrl before they
// draw: Content-Type when it names a real type, otherwise the first six
// bytes (GIF87a / GIF89a). The answer is cached in memory and localStorage.

const GIF_URL = /\.gif(?=$|[?#])/i;
const VIDEO_URL = /\.(mp4|webm|mov|m4v)(?=$|[?#])/i;
const STILL_EXT = /\.(jpe?g|png|webp|avif|bmp|svg|ico)(?=$|[?#])/i;
const POSTER_KEY = /^markers\/\d+-[a-z0-9]+(?:-d\d+)?\.(mp4|webm)$/i;
const DATA_GIF = /^data:image\/gif/i;
const DATA_IMAGE = /^data:image\//i;
const STORE_KEY = "sbs-gif-sniff";
const STORE_MAX = 200;
const GENERIC_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
  "application/unknown",
  "text/plain",
  "application/x-download",
]);

const memory = new Map();
const byteCache = new Map();

export function isGifUrl(url) {
  return typeof url === "string" && GIF_URL.test(url);
}

export function isVideoUrl(url) {
  return typeof url === "string" && VIDEO_URL.test(url);
}

// True when the bytes are not a known still or video. Those wait for
// classifyImageUrl. A .gif suffix is already a GIF.
export function needsGifCheck(url) {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw || isVideoUrl(raw)) return false;
  if (isGifUrl(raw) || DATA_GIF.test(raw)) return true;
  if (DATA_IMAGE.test(raw)) return false;
  if (STILL_EXT.test(raw)) return false;
  return true;
}

export function gifMagic(bytes) {
  let view = bytes;
  if (bytes instanceof ArrayBuffer) view = new Uint8Array(bytes);
  if (!view || typeof view.length !== "number" || view.length < 6) return false;
  return view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38
    && ((view[4] === 0x37 && view[5] === 0x61) || (view[4] === 0x39 && view[5] === 0x61));
}

// "gif" or "other" when the header names a real media type. Generic
// types (octet-stream on IPFS) are "unknown" and the bytes decide.
export function contentTypeVerdict(header) {
  const raw = String(header || "").split(";")[0].trim().toLowerCase();
  if (!raw || GENERIC_TYPES.has(raw)) return "unknown";
  if (raw === "image/gif") return "gif";
  if (raw.startsWith("image/") || raw.startsWith("video/") || raw.startsWith("audio/")) return "other";
  return "unknown";
}

function defaultStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode */
  }
  return null;
}

function storeOf(options) {
  if (options && Object.prototype.hasOwnProperty.call(options, "storage")) return options.storage;
  return defaultStorage();
}

export function resetGifCache() {
  memory.clear();
  byteCache.clear();
}

export function readGifCache(url, storage) {
  const key = typeof url === "string" ? url.trim() : "";
  if (!key) return null;
  if (memory.has(key)) return memory.get(key);
  const box = storage === undefined ? defaultStorage() : storage;
  if (!box || key.startsWith("blob:") || key.startsWith("data:")) return null;
  try {
    const parsed = JSON.parse(box.getItem(STORE_KEY) || "null");
    if (!parsed || (parsed[key] !== 0 && parsed[key] !== 1)) return null;
    const value = parsed[key] === 1;
    memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function writeGifCache(url, isGif, storage) {
  const key = typeof url === "string" ? url.trim() : "";
  if (!key) return;
  const value = !!isGif;
  memory.set(key, value);
  if (key.startsWith("blob:") || key.startsWith("data:")) return;
  const box = storage === undefined ? defaultStorage() : storage;
  if (!box) return;
  try {
    const parsed = JSON.parse(box.getItem(STORE_KEY) || "{}") || {};
    parsed[key] = value ? 1 : 0;
    const keys = Object.keys(parsed);
    if (keys.length > STORE_MAX) {
      for (const drop of keys.slice(0, keys.length - STORE_MAX)) delete parsed[drop];
    }
    box.setItem(STORE_KEY, JSON.stringify(parsed));
  } catch {
    /* quota or private mode: memory still holds the answer */
  }
}

function headerType(response) {
  if (!response || !response.headers || typeof response.headers.get !== "function") return "";
  return response.headers.get("content-type") || "";
}

async function quietCancel(response) {
  const body = response && response.body;
  if (body && typeof body.cancel === "function") {
    try { await body.cancel(); } catch { /* already closed */ }
  }
}

async function firstSix(response) {
  const body = response && response.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const parts = [];
    let got = 0;
    try {
      while (got < 6) {
        const step = await reader.read();
        if (step.done) break;
        if (step.value && step.value.length) {
          parts.push(step.value);
          got += step.value.length;
        }
      }
    } finally {
      try { await reader.cancel(); } catch { /* already closed */ }
    }
    const out = new Uint8Array(Math.min(6, got));
    let off = 0;
    for (const part of parts) {
      const n = Math.min(part.length, out.length - off);
      if (n > 0) out.set(part.subarray(0, n), off);
      off += n;
      if (off >= out.length) break;
    }
    return out;
  }
  if (response && typeof response.arrayBuffer === "function") {
    const buf = new Uint8Array(await response.arrayBuffer());
    return buf.subarray(0, 6);
  }
  return new Uint8Array();
}

function usable(response, ranged) {
  if (!response) return false;
  const status = Number(response.status);
  if (ranged) return status === 200 || status === 206;
  return status === 200 || response.ok === true;
}

// Range: bytes=0-5 first. A throw, or a status other than 200/206, falls
// through to a normal GET. null means the check failed: do not paint.
async function sniff(url, fetchImpl, ranged) {
  let response;
  try {
    response = await fetchImpl(url, ranged ? { headers: { Range: "bytes=0-5" } } : {});
  } catch {
    if (ranged) return sniff(url, fetchImpl, false);
    return null;
  }
  if (!usable(response, ranged)) {
    await quietCancel(response);
    if (ranged) return sniff(url, fetchImpl, false);
    return null;
  }
  const verdict = contentTypeVerdict(headerType(response));
  if (verdict === "gif" || verdict === "other") {
    await quietCancel(response);
    return verdict === "gif";
  }
  let bytes;
  try {
    bytes = await firstSix(response);
  } catch {
    if (ranged) return sniff(url, fetchImpl, false);
    return null;
  }
  if (!bytes || bytes.length < 6) {
    if (ranged) return sniff(url, fetchImpl, false);
    return null;
  }
  return gifMagic(bytes);
}

// true GIF, false still, null when the check could not finish.
// A failed check is not cached, so a later paint can try again.
export async function classifyImageUrl(url, options) {
  const raw = typeof url === "string" ? url.trim() : "";
  const storage = storeOf(options);
  if (!raw) return false;
  if (!needsGifCheck(raw)) return false;
  if (isGifUrl(raw) || DATA_GIF.test(raw)) {
    writeGifCache(raw, true, storage);
    return true;
  }
  const cached = readGifCache(raw, storage);
  if (cached === true || cached === false) return cached;
  const fetchImpl = (options && options.fetch) || globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;
  const found = await sniff(raw, fetchImpl, true);
  if (found == null) return null;
  writeGifCache(raw, found, storage);
  return found;
}

// Full body for a still frame or an in-memory playback. Not stored in
// localStorage. A failed fetch is dropped so the next tap can retry.
export function loadImageBytes(url, options) {
  const key = typeof url === "string" ? url.trim() : "";
  if (!key) return Promise.reject(new Error("empty"));
  if (byteCache.has(key)) return byteCache.get(key);
  const fetchImpl = (options && options.fetch) || globalThis.fetch;
  const pending = Promise.resolve()
    .then(() => fetchImpl(key))
    .then(async (response) => {
      if (!response || response.ok === false) throw new Error("fetch failed");
      return response.arrayBuffer();
    })
    .catch((err) => {
      byteCache.delete(key);
      throw err;
    });
  byteCache.set(key, pending);
  return pending;
}

export function resolveMediaUrl(url) {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw || isGifUrl(raw)) return { kind: "image", src: "", poster: "" };
  if (isVideoUrl(raw)) return { kind: "video", src: raw, poster: "" };
  return { kind: "image", src: raw, poster: "" };
}

// The sibling poster object for a video this bucket just stored.
// Anything else (another host, a gif, a path escape) is refused.
export function posterTargetKey(publicBase, videoUrl) {
  const base = String(publicBase || "").replace(/\/+$/, "");
  const raw = typeof videoUrl === "string" ? videoUrl.trim() : "";
  if (!base || !raw) return "";
  let parsed;
  let root;
  try {
    parsed = new URL(raw);
    root = new URL(base);
  } catch {
    return "";
  }
  if (parsed.origin !== root.origin) return "";
  const prefix = root.pathname.replace(/\/+$/, "");
  let path = parsed.pathname;
  try { path = decodeURIComponent(parsed.pathname); } catch { return ""; }
  if (prefix && path !== prefix && !path.startsWith(prefix + "/")) return "";
  const key = path.slice(prefix.length).replace(/^\/+/, "");
  if (!key || key.includes("..") || !POSTER_KEY.test(key)) return "";
  return key.replace(/\.(mp4|webm)$/i, ".poster.jpg");
}
