// Read an HCS-1 topic back from the mirror and decide what is already
// written. No wallet, no storage, no private key kept here. The only
// import is the inscription builder, so a recovered file hashes the same
// way the first attempt did.
//
// Mirror lag can hide a chunk that was just sent. The next send then
// writes that chunk again. server/hcs1.js keeps the first message for each
// index and ignores the copy, so the duplicate is harmless.

import { buildHcs1Inscription } from "./hcs1inscribe.js";

const MIRROR_ORIGIN = "https://mainnet.mirrornode.hedera.com";
const TOPIC_ID = /^0\.0\.\d+$/;
const PAGE_LIMIT = 130;
const READ_ERROR = "Could not read the topic on Hedera";

function userFacing(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

function failRead() {
  throw userFacing(READ_ERROR);
}

function fetchFn(fetchImpl) {
  if (typeof fetchImpl === "function") return fetchImpl;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  return null;
}

// Only a same-host /api/v1 link is followed. Anything else is ignored.
function nextUrl(next, current) {
  if (typeof next !== "string" || next === "") return "";
  let url;
  try {
    url = new URL(next, current);
  } catch {
    return "";
  }
  if (url.origin !== MIRROR_ORIGIN) return "";
  if (!url.pathname.startsWith("/api/v1/")) return "";
  return url.toString();
}

function decodeMessage(value) {
  if (typeof value !== "string" || value === "") return "";
  let binary;
  try {
    binary = atob(value);
  } catch {
    return "";
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// AbortSignal.timeout is missing in some browsers. The wait is the same.
function readSignal() {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(12000);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 12000);
  return controller.signal;
}

async function fetchJson(fetchImpl, url) {
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(url, { signal: readSignal() });
      break;
    } catch {
      if (attempt === 0) continue;
      failRead();
    }
  }
  if (!response || response.ok !== true) failRead();
  try {
    const data = await response.json();
    if (!data || typeof data !== "object") failRead();
    return data;
  } catch (err) {
    if (err && err.userFacing) throw err;
    failRead();
  }
  return null;
}

function rawPublicHex(submitKey) {
  const pub = submitKey && submitKey.publicKey;
  if (!pub || typeof pub.toStringRaw !== "function") return "";
  return String(pub.toStringRaw()).trim().toLowerCase().replace(/^0x/, "");
}

/**
 * Topic memo, submit key, and the first message text for each index.
 * Later copies of the same index are ignored, matching the reader.
 * count is how many distinct indexes were kept.
 */
export async function readTopic(topicId, { fetchImpl } = {}) {
  const fetchCall = fetchFn(fetchImpl);
  const id = typeof topicId === "string" ? topicId.trim() : "";
  if (!fetchCall || !TOPIC_ID.test(id)) failRead();
  const infoUrl = `${MIRROR_ORIGIN}/api/v1/topics/${id}`;
  const info = await fetchJson(fetchCall, infoUrl);
  const memo = typeof info.memo === "string" ? info.memo : "";
  const submit = info.submit_key && typeof info.submit_key === "object" ? info.submit_key : null;
  const submitKeyHex = submit && typeof submit.key === "string"
    ? submit.key.trim().toLowerCase().replace(/^0x/, "")
    : "";
  const submitKeyType = submit && typeof submit._type === "string" ? submit._type : "";
  const messages = new Map();
  let url = `${MIRROR_ORIGIN}/api/v1/topics/${id}/messages?limit=100&order=asc`;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const data = await fetchJson(fetchCall, url);
    const list = Array.isArray(data.messages) ? data.messages : [];
    for (const row of list) {
      const text = decodeMessage(row && row.message);
      if (!text) continue;
      let part;
      try {
        part = JSON.parse(text);
      } catch {
        continue;
      }
      if (!part || typeof part !== "object" || !Number.isInteger(part.o) || part.o < 0) continue;
      if (typeof part.c !== "string") continue;
      if (messages.has(part.o)) continue;
      messages.set(part.o, text);
    }
    const next = data.links && data.links.next;
    const followed = nextUrl(next, url);
    if (!followed) break;
    url = followed;
  }
  return { memo, submitKeyHex, submitKeyType, messages, count: messages.size };
}

function presentIndexes(messages, total) {
  const count = Number.isInteger(total) && total > 0 ? total : 0;
  const sentIndexes = [];
  for (let index = 0; index < count; index += 1) {
    if (messages.has(index)) sentIndexes.push(index);
  }
  return { sentIndexes, total: count };
}

/**
 * No key and no file. complete means every index from 0 to total-1 is on
 * the mirror. A different memo is a different inscription.
 */
export async function checkTopicByCount({ topicId, memo, total }, opts = {}) {
  const topic = await readTopic(topicId, opts);
  if (topic.memo !== memo) return { status: "wrong-topic" };
  const found = presentIndexes(topic.messages, total);
  const status = found.total > 0 && found.sentIndexes.length === found.total ? "complete" : "partial";
  return { status, sentIndexes: found.sentIndexes, total: found.total };
}

/**
 * Compare the topic with a fresh build of the same bytes.
 * wrong-file: the memo is not this file.
 * wrong-key: the supplied key is not the topic's submit key.
 * conflict: an index in range holds different text. Do not write over it.
 * A chunk the mirror has not shown yet is simply missing. Sending it again
 * is safe: the reader keeps the first copy.
 */
export async function recoverInscription({ topicId, prepared, submitKey } = {}, opts = {}) {
  const bytes = prepared && prepared.bytes;
  const mime = prepared && prepared.mime;
  const built = await buildHcs1Inscription(bytes, mime);
  const topic = await readTopic(topicId, opts);
  if (topic.memo !== built.memo) return { status: "wrong-file" };
  if (submitKey != null) {
    const raw = rawPublicHex(submitKey);
    if (!raw || raw !== topic.submitKeyHex) return { status: "wrong-key" };
  }
  const total = built.messages.length;
  const sentIndexes = [];
  for (let index = 0; index < total; index += 1) {
    if (!topic.messages.has(index)) continue;
    if (topic.messages.get(index) !== built.messages[index]) return { status: "conflict", index };
    sentIndexes.push(index);
  }
  const status = total > 0 && sentIndexes.length === total ? "complete" : "partial";
  return { status, sentIndexes, total, topicId: typeof topicId === "string" ? topicId.trim() : "" };
}
