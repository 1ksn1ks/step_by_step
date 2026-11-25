// Hashinal (HCS-1) inscribing, paid by the caller's own wallet.
//
// An HCS-1 topic memo is "<sha256 hex of the raw file>:zstd:base64".
// The file is zstd-compressed (level 10), base64-encoded, and prefixed
// with "data:<mime>;base64,". That text is split into JSON messages
// {"o": index, "c": content}, each at most HCS1_CHUNK_MAX bytes. A reader
// sorts by o, joins c, decompresses, and checks the hash (server/hcs1.js).
//
// This file imports only @hashgraph/sdk and, inside buildHcs1Inscription,
// @bokuweb/zstd-wasm. It never opens a wallet. Copy it on its own and pass
// createTopic / submitMessage:
//
//   import { buildHcs1Inscription, inscribeHcs1 } from "./hcs1inscribe.js";
//
//   const built = await buildHcs1Inscription(bytes, "image/png");
//   // built.memo, built.messages, built.usd
//   const done = await inscribeHcs1({
//     bytes,
//     mime: "image/png",
//     createTopic: ({ memo, submitKey }) => topicId,
//     submitMessage: ({ topicId, submitKey, message }) => {},
//     onProgress: ({ sent, total, topicId }) => {},
//   });
//   // done.hrl is hcs://1/<topicId>
//
// createTopic makes a topic with that submit key and no admin key.
// submitMessage sends one JSON message as one transaction body.
// Send them strictly one at a time: a wallet that signs a list stamps one
// signature onto every body, and the bodies differ.
//
// If a submit throws, the error carries { topicId, submitKey, sentIndexes }.
// Call inscribeHcs1 again with resume: { topicId, submitKey, sentIndexes }
// to send only the missing chunks. After every chunk is in, the submit key
// on that resume object is dropped and is not on the result.
//
// submitKey, when passed, is the caller's key. A fresh run uses it instead
// of generating one, and a resume that has a topic id but no key uses it
// too. The object is never mutated. onTopic runs after the topic exists
// and before the first chunk; a throw there does not hide the topic.

import { PrivateKey } from "@hashgraph/sdk";

// What one inscription may weigh, raw, before compression.
export const HCS1_INSCRIBE_MAX_BYTES = 2 * 1024 * 1024;
// One consensus message. The JSON {"o","c"} itself must fit, not only c.
export const HCS1_CHUNK_MAX = 1024;
// The reader refuses a topic above this (server/hcs1.js HCS1_MAX_MESSAGES).
const HCS1_INSCRIBE_MAX_MESSAGES = 12000;
const ZSTD_LEVEL = 10;

const textEncoder = new TextEncoder();
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

let zstdPromise = null;

function asBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  throw new Error("hcs-1 file is not bytes");
}

function utf8Length(text) {
  return textEncoder.encode(text).length;
}

function toBase64(bytes) {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const n = (a << 16) | (b << 8);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >>> 6) & 63] : "=";
    out += "=";
  }
  return out;
}

async function sha256Hex(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// Loaded on the first inscription, not when this module is imported.
function loadZstd() {
  if (!zstdPromise) {
    zstdPromise = import("@bokuweb/zstd-wasm").then(async (mod) => {
      const api = typeof mod.compress === "function" ? mod : mod.default;
      if (!api || typeof api.init !== "function" || typeof api.compress !== "function") {
        throw new Error("zstd-wasm did not load");
      }
      await api.init();
      return api.compress;
    });
    zstdPromise.catch(() => {
      zstdPromise = null;
    });
  }
  return zstdPromise;
}

function jsonMessage(index, content) {
  return JSON.stringify({ o: index, c: content });
}

// Split the joined text so each JSON message is at most HCS1_CHUNK_MAX bytes.
function splitPayload(payload, maxMessages) {
  const messages = [];
  let offset = 0;
  while (offset < payload.length) {
    if (messages.length >= maxMessages) throw new Error("too many messages");
    const index = messages.length;
    let room = HCS1_CHUNK_MAX - utf8Length(jsonMessage(index, ""));
    if (room < 1) throw new Error("hcs-1 chunk does not fit");
    let content = payload.slice(offset, offset + room);
    let message = jsonMessage(index, content);
    while (utf8Length(message) > HCS1_CHUNK_MAX) {
      const over = utf8Length(message) - HCS1_CHUNK_MAX;
      if (content.length <= over) throw new Error("hcs-1 chunk does not fit");
      content = content.slice(0, content.length - over);
      message = jsonMessage(index, content);
    }
    if (!content) throw new Error("hcs-1 chunk does not fit");
    messages.push(message);
    offset += content.length;
  }
  if (!messages.length) throw new Error("too many messages");
  return messages;
}

function sentSet(resume) {
  const sent = new Set();
  const list = resume && Array.isArray(resume.sentIndexes) ? resume.sentIndexes : [];
  for (const index of list) {
    if (Number.isInteger(index) && index >= 0) sent.add(index);
  }
  return sent;
}

function topicString(value) {
  if (typeof value === "string" && value) return value;
  if (value != null && typeof value.toString === "function") {
    const text = value.toString();
    if (typeof text === "string" && text && text !== "[object Object]") return text;
  }
  throw new Error("createTopic did not return a topic id");
}

// Topic create plus one transaction per message.
// 0.01 USD for the topic, 0.0008 USD for each message.
export function estimateHcs1Cost(messageCount) {
  const count = Number(messageCount) || 0;
  return {
    txCount: count + 1,
    usd: 0.01 + count * 0.0008,
  };
}

// FEE GATE HOOK: a future app fee or check plugs in here.
// Return { ok: false } to stop inscribeHcs1 before a topic is created
// or a message is sent. ctx is { bytes, mime, resume }.
export async function assertInscribeGate(_ctx) {
  return { ok: true };
}

// { sha256, memo, messages, byteLength, txCount, usd }.
// Throws if the raw file is over HCS1_INSCRIBE_MAX_BYTES, or the split
// is over 12000 messages. limits is optional and only tightens those caps.
export async function buildHcs1Inscription(bytes, mime, limits = {}) {
  const raw = asBytes(bytes);
  const maxBytes = Number.isFinite(limits.maxBytes) ? limits.maxBytes : HCS1_INSCRIBE_MAX_BYTES;
  const maxMessages = Number.isFinite(limits.maxMessages) ? limits.maxMessages : HCS1_INSCRIBE_MAX_MESSAGES;
  if (raw.byteLength > maxBytes) throw new Error("file is over 2 MB");

  const type = String(mime ?? "");
  const prefix = `data:${type};base64,`;
  if (utf8Length(jsonMessage(0, prefix)) > HCS1_CHUNK_MAX) throw new Error("mime does not fit in one hcs-1 message");

  const sha256 = await sha256Hex(raw);
  const compress = await loadZstd();
  const compressed = new Uint8Array(await compress(raw, ZSTD_LEVEL));
  const messages = splitPayload(prefix + toBase64(compressed), maxMessages);
  return {
    sha256,
    memo: `${sha256}:zstd:base64`,
    messages,
    byteLength: raw.byteLength,
    ...estimateHcs1Cost(messages.length),
  };
}

// Inscribe bytes. createTopic and submitMessage are injected, so this
// module never touches a wallet. resume skips topic creation and sends
// only the indexes not listed in sentIndexes.
//
// suppliedKey belongs to the caller. It is used as-is and never mutated.
// onTopic is told the topic id before any chunk is sent.
export async function inscribeHcs1({
  bytes,
  mime,
  createTopic,
  submitMessage,
  onProgress,
  resume,
  submitKey: suppliedKey,
  onTopic,
} = {}) {
  const gate = await assertInscribeGate({ bytes, mime, resume: resume || null });
  if (!gate || gate.ok !== true) {
    const error = new Error("inscribe gate");
    error.gate = gate || null;
    throw error;
  }
  if (typeof createTopic !== "function" || typeof submitMessage !== "function") {
    throw new Error("inscribe needs createTopic and submitMessage");
  }

  const built = await buildHcs1Inscription(bytes, mime);
  const sent = sentSet(resume);
  const resuming = !!(resume && resume.topicId);
  let activeKey = resuming ? resume.submitKey : null;
  let topicId = resuming ? topicString(resume.topicId) : "";
  if (resuming && activeKey == null && suppliedKey != null) activeKey = suppliedKey;
  if (!resuming) {
    activeKey = suppliedKey != null ? suppliedKey : await PrivateKey.generateED25519Async();
    topicId = topicString(await createTopic({ memo: built.memo, submitKey: activeKey }));
    if (typeof onTopic === "function") {
      try {
        await onTopic({ topicId, memo: built.memo, total: built.messages.length });
      } catch {
        // The topic is already on Hedera. Losing the checkpoint must not
        // drop it, or the chunks that follow would open a second topic.
      }
    }
  }

  const progress = typeof onProgress === "function" ? onProgress : null;
  try {
    for (let index = 0; index < built.messages.length; index += 1) {
      if (sent.has(index)) continue;
      await submitMessage({ topicId, submitKey: activeKey, message: built.messages[index] });
      sent.add(index);
      if (progress) await progress({ sent: sent.size, total: built.messages.length, topicId });
    }
  } catch (err) {
    const error = new Error(err && err.message ? String(err.message) : "hcs-1 submit failed");
    error.topicId = topicId;
    error.submitKey = activeKey;
    error.sentIndexes = [...sent].sort((a, b) => a - b);
    throw error;
  }

  if (resume && typeof resume === "object") resume.submitKey = null;
  activeKey = null;
  return {
    topicId,
    hrl: `hcs://1/${topicId}`,
    sha256: built.sha256,
    total: built.messages.length,
  };
}
