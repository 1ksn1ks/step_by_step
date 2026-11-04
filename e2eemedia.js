// Device-side secretstream for E2EE chat files. The server and R2 only
// ever see the ciphertext blob. The 32-byte file key and the stream
// header stay inside the topic-key sealed message.
import _sodium from "libsodium-wrappers-sumo";

await _sodium.ready;
const sodium = _sodium;

export const STREAM_CHUNK = 64 * 1024;
export const POSTER_EMBED_MAX = 24 * 1024;
export const SEALED_CONTENT_TYPE = "application/octet-stream";
export const SEALED_SLACK = 1024 * 1024;
export const SEALED_MAX = (100 * 1024 * 1024) + SEALED_SLACK;
export const CHAT_IMAGE_PREFIX = "\u001echat1\n";

const KEY_BYTES = sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES;
const HEADER_BYTES = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
const TAG_MESSAGE = sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;

function concat(left, right) {
  const extra = right instanceof Uint8Array ? right : new Uint8Array(right);
  if (!left.length) return extra;
  const out = new Uint8Array(left.length + extra.length);
  out.set(left, 0);
  out.set(extra, left.length);
  return out;
}

function readerOf(source) {
  if (source && typeof source.getReader === "function") return source.getReader();
  if (source && source.body && typeof source.body.getReader === "function") return source.body.getReader();
  if (source && typeof source.stream === "function") return source.stream().getReader();
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source || []);
  return new Blob([bytes]).stream().getReader();
}

function plainSizeOf(source) {
  if (source && typeof source.size === "number") return source.size;
  if (source instanceof Uint8Array) return source.byteLength;
  return 0;
}

// One plaintext chunk at a time. The ciphertext pieces become one blob
// and the plaintext chunk is dropped. A full chunk is never held twice.
export async function encryptStream(source, keyBytes) {
  const key = keyBytes instanceof Uint8Array && keyBytes.length === KEY_BYTES
    ? keyBytes
    : sodium.crypto_secretstream_xchacha20poly1305_keygen();
  const opened = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  const state = opened.state;
  const header = opened.header;
  const parts = [];
  const push = (chunk, final) => {
    parts.push(sodium.crypto_secretstream_xchacha20poly1305_push(
      state,
      chunk,
      null,
      final ? TAG_FINAL : TAG_MESSAGE,
    ));
  };
  const reader = readerOf(source);
  let carry = new Uint8Array(0);
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    if (!step.value || !step.value.length) continue;
    carry = concat(carry, step.value);
    while (carry.length > STREAM_CHUNK) {
      push(carry.subarray(0, STREAM_CHUNK), false);
      carry = carry.subarray(STREAM_CHUNK);
    }
  }
  push(carry, true);
  return {
    blob: new Blob(parts, { type: SEALED_CONTENT_TYPE }),
    fileKey: sodium.to_base64(key),
    header: sodium.to_base64(header),
    plainSize: plainSizeOf(source),
  };
}

// Frames are STREAM_CHUNK + ABYTES, except the last which is shorter and
// carries the final tag. Ciphertext is not kept after each frame opens.
export async function decryptStream(source, fileKeyB64, headerB64) {
  const key = sodium.from_base64(fileKeyB64);
  const header = sodium.from_base64(headerB64);
  if (key.length !== KEY_BYTES || header.length !== HEADER_BYTES) throw new Error("decrypt");
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
  const frameBytes = STREAM_CHUNK + sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
  const parts = [];
  let sawFinal = false;
  const pull = (frame) => {
    if (sawFinal) throw new Error("decrypt");
    const opened = sodium.crypto_secretstream_xchacha20poly1305_pull(state, frame);
    if (!opened || !opened.message) throw new Error("decrypt");
    parts.push(opened.message);
    if (opened.tag === TAG_FINAL) sawFinal = true;
  };
  const reader = readerOf(source);
  let carry = new Uint8Array(0);
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    if (!step.value || !step.value.length) continue;
    carry = concat(carry, step.value);
    while (carry.length >= frameBytes) {
      const frame = carry.slice(0, frameBytes);
      carry = carry.subarray(frameBytes);
      pull(frame);
    }
  }
  if (!sawFinal) {
    if (!carry.length) throw new Error("decrypt");
    pull(carry.slice());
  } else if (carry.length) {
    throw new Error("decrypt");
  }
  if (!sawFinal) throw new Error("decrypt");
  return new Blob(parts);
}

export async function decryptSealedPart({ url, b64, fileKey, header, mime }) {
  if (!fileKey || !header) throw new Error("decrypt");
  let source;
  if (typeof b64 === "string" && b64) {
    source = new Blob([sodium.from_base64(b64)]);
  } else if (typeof url === "string" && url) {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error("decrypt");
    source = response.body;
  } else {
    throw new Error("decrypt");
  }
  const plain = await decryptStream(source, fileKey, header);
  const type = typeof mime === "string" && mime ? mime : SEALED_CONTENT_TYPE;
  return new Blob([plain], { type });
}

// Headers a sealed upload is allowed to send. No filename, duration,
// role, poster target, or original mime. Account is only the auth header.
export function sealedUploadHeaders(extra) {
  const headers = {
    "Content-Type": SEALED_CONTENT_TYPE,
    "X-Sealed": "1",
  };
  if (extra && extra.account) headers["X-Account"] = extra.account;
  if (extra && extra.uploadToken) headers["X-Upload-Token"] = extra.uploadToken;
  if (extra && extra.turnstile) headers["CF-Turnstile-Response"] = extra.turnstile;
  return headers;
}

function safeHttp(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function b64Field(value, bytes) {
  if (typeof value !== "string" || !value || value.length > 80) return "";
  try {
    const raw = sodium.from_base64(value);
    if (raw.length !== bytes) return "";
    return value;
  } catch {
    return "";
  }
}

function cleanMime(value) {
  if (typeof value !== "string") return "";
  const mime = value.trim().toLowerCase();
  if (!mime || mime.length > 80 || mime === SEALED_CONTENT_TYPE) return "";
  if (!/^(video|image)\/[a-z0-9.+-]+$/.test(mime)) return "";
  return mime;
}

function cleanSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return 0;
  return Math.min(Math.floor(size), SEALED_MAX);
}

function cleanEdge(value) {
  const edge = Number(value);
  if (!Number.isFinite(edge) || edge <= 0) return 0;
  return Math.min(Math.floor(edge), 8192);
}

function normalizePoster(poster) {
  if (!poster || typeof poster !== "object") return null;
  const fileKey = b64Field(poster.fileKey, KEY_BYTES);
  const header = b64Field(poster.header, HEADER_BYTES);
  if (!fileKey || !header) return null;
  const mime = cleanMime(poster.mime) || "image/jpeg";
  const size = cleanSize(poster.size);
  if (typeof poster.b64 === "string" && poster.b64) {
    try {
      const raw = sodium.from_base64(poster.b64);
      if (!raw.length || raw.length > POSTER_EMBED_MAX) return null;
    } catch {
      return null;
    }
    return { b64: poster.b64, fileKey, header, mime, size };
  }
  const url = safeHttp(poster.url);
  if (!url) return null;
  return { url, fileKey, header, mime, size };
}

export function normalizeMedia(media) {
  if (!media || typeof media !== "object") return null;
  const url = safeHttp(media.url);
  const fileKey = b64Field(media.fileKey, KEY_BYTES);
  const header = b64Field(media.header, HEADER_BYTES);
  if (!url || !fileKey || !header) return null;
  const clean = {
    url,
    fileKey,
    header,
    mime: cleanMime(media.mime),
    size: cleanSize(media.size),
    w: cleanEdge(media.w),
    h: cleanEdge(media.h),
  };
  const poster = normalizePoster(media.poster);
  if (poster) clean.poster = poster;
  return clean;
}

export function packSealedMedia(text, media) {
  const clean = normalizeMedia(media);
  if (!clean) return "";
  return CHAT_IMAGE_PREFIX + JSON.stringify({
    t: typeof text === "string" ? text : "",
    m: clean,
  });
}

// Old chat images are { t, i, p } with no m. Those stay on the plaintext
// path. A new file leaves i empty so the ciphertext URL is never painted.
export function readSealedMedia(raw) {
  if (typeof raw !== "string" || !raw.startsWith(CHAT_IMAGE_PREFIX)) return null;
  try {
    const data = JSON.parse(raw.slice(CHAT_IMAGE_PREFIX.length));
    if (!data || data.m == null) return null;
    const media = normalizeMedia(data.m);
    const text = typeof data.t === "string" ? data.t : "";
    if (!media) return { text, media: { url: "", fileKey: "", header: "", mime: "", size: 0, w: 0, h: 0 } };
    return { text, media };
  } catch {
    return null;
  }
}

// Encrypt a poster. Embed the ciphertext when it is small enough and the
// caller says the sealed message still fits. Otherwise the caller uploads
// that ciphertext and never a JPEG.
export async function sealPosterBytes(plain, options) {
  const bytes = plain instanceof Uint8Array ? plain : new Uint8Array(plain || []);
  const enc = await encryptStream(bytes);
  const body = new Uint8Array(await enc.blob.arrayBuffer());
  const embedded = {
    b64: sodium.to_base64(body),
    fileKey: enc.fileKey,
    header: enc.header,
    mime: "image/jpeg",
    size: bytes.byteLength,
  };
  const cap = options && options.embedMax > 0 ? options.embedMax : POSTER_EMBED_MAX;
  const fits = options && typeof options.fits === "function" ? options.fits(embedded, body) : true;
  if (body.length <= cap && fits) {
    return { mode: "embed", poster: embedded, uploads: [] };
  }
  return {
    mode: "upload",
    poster: {
      fileKey: enc.fileKey,
      header: enc.header,
      mime: "image/jpeg",
      size: bytes.byteLength,
    },
    uploads: [{
      contentType: SEALED_CONTENT_TYPE,
      body,
      headers: sealedUploadHeaders(),
    }],
  };
}
