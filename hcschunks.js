// Join Hedera Consensus Service chunks into one message.
//
// A topic submit over 1024 bytes is several mirror messages that share
// chunk_info.initial_transaction_id. Each piece is base64 of a raw byte
// slice, and a slice can split a UTF-8 character, so the bytes are
// concatenated before they are decoded. Nothing is returned until every
// chunk_info.number from 1 to chunk_info.total is present. Messages
// without chunk_info are returned unchanged.
//
// No DOM and no app imports: the server poller and the browser mirror
// readers both use this file.

export const HCS_CHUNK_SIZE = 1024;
export const HCS_MAX_CHUNKS = 20;
// Headroom under the 20-chunk / 20480-byte HCS ceiling.
export const HCS_MESSAGE_MAX_BYTES = 18 * 1024;
export const HCS_SHOW_COUNTER_AFTER = 1024;
export const CHUNK_TTL_MS = 10 * 60 * 1000;
export const DONE_KEY_LIMIT = 2000;
export const HCS_TOO_LONG = "Message is too long. Keep it under 18 KB.";

const encoder = new TextEncoder();

export function utf8ByteLength(text) {
  return encoder.encode(text == null ? "" : String(text)).length;
}

// Live size of one 18 KB topic message. Under 1 KB the used size is whole
// bytes. From 1 KB it is one decimal. A second chunk adds the wallet count.
export function formatHcsUsage(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  const over = n > HCS_MESSAGE_MAX_BYTES;
  const warn = !over && n > HCS_MESSAGE_MAX_BYTES * 0.9;
  const used = n < HCS_CHUNK_SIZE ? `${n} B` : `${(n / HCS_CHUNK_SIZE).toFixed(1)} KB`;
  let text = `${used} / 18 KB`;
  if (n > HCS_CHUNK_SIZE) text += `  ${Math.ceil(n / HCS_CHUNK_SIZE)} approvals`;
  return { text, warn, over };
}

// Stored text keeps real newline characters. Carriage returns become
// one newline, runs of three or more collapse to a blank line, and
// newlines at the ends are dropped. Spaces stay.
export function normalizeMessageNewlines(text) {
  const value = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return value.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

// Posts, comments, and chat sit inside JSON. A newline is stored as the
// two characters \ and n, so it counts as 2 toward a character cap.
// Other characters stay 1, matching the old caps when there is no newline.
export function messageLimitLength(text) {
  const value = String(text == null ? "" : text);
  let extra = 0;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) extra += 1;
  }
  return value.length + extra;
}

export function clipMessage(text, max) {
  const value = String(text == null ? "" : text);
  if (messageLimitLength(value) <= max) return value;
  let end = Math.min(value.length, max);
  while (end > 0 && messageLimitLength(value.slice(0, end)) > max) end -= 1;
  return value.slice(0, end);
}

function decodeBase64(value) {
  const clean = String(value || "").replace(/\s/g, "");
  return new Uint8Array(Buffer.from(clean, "base64"));
}

function encodeBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

// Mirror nodes currently send initial_transaction_id as
// "shard.realm.num-seconds-nanos", with nonce and scheduled beside it.
// An object form is accepted too, so a proxy that expands the id still joins.
function groupKey(topicId, info) {
  const id = info.initial_transaction_id;
  let idText = "";
  if (typeof id === "string") {
    idText = id;
  } else if (id && typeof id === "object") {
    const start = id.transaction_valid_start;
    const startText = typeof start === "string"
      ? start
      : start && typeof start === "object"
        ? `${start.seconds ?? ""}.${start.nanos ?? ""}`
        : "";
    idText = `${id.account_id || ""}@${startText}`;
  }
  if (!idText) return "";
  const nonce = info.nonce != null
    ? info.nonce
    : id && typeof id === "object" && id.nonce != null
      ? id.nonce
      : 0;
  const scheduled = info.scheduled != null
    ? info.scheduled
    : id && typeof id === "object"
      ? id.scheduled
      : false;
  return `${topicId}\0${idText}\0${nonce}\0${scheduled ? 1 : 0}`;
}

// Mirror ids are "0.0.x-seconds-nanos". An object id carries account_id.
// The payer has to be that account; a different payer cannot complete the group.
function accountFromInitial(id) {
  if (typeof id === "string") {
    const hyphen = id.indexOf("-");
    const at = id.indexOf("@");
    let end = -1;
    if (hyphen > 0 && at > 0) end = Math.min(hyphen, at);
    else if (hyphen > 0) end = hyphen;
    else if (at > 0) end = at;
    if (end <= 0) return "";
    return id.slice(0, end).trim();
  }
  if (id && typeof id === "object" && typeof id.account_id === "string") {
    return id.account_id.trim();
  }
  return "";
}

function concatParts(group) {
  let length = 0;
  const parts = [];
  for (let number = 1; number <= group.total; number++) {
    const part = group.parts.get(number);
    if (!part) return null;
    parts.push(part);
    length += part.length;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function createChunkAssembler({ ttlMs = CHUNK_TTL_MS } = {}) {
  const groups = new Map();
  // key -> first time the group finished. Newest keys stay; Map order is
  // oldest first. A finished key is forgotten after the TTL or past the cap
  // so a long-running poller does not keep every message forever.
  const done = new Map();

  function pruneDone(now) {
    for (const [key, at] of done) {
      if (now - at >= ttlMs) done.delete(key);
    }
    while (done.size > DONE_KEY_LIMIT) {
      const oldest = done.keys().next().value;
      done.delete(oldest);
    }
  }

  function rememberDone(key, now) {
    if (done.has(key)) done.delete(key);
    done.set(key, now);
    pruneDone(now);
  }

  function prune(now = Date.now()) {
    for (const [key, group] of groups) {
      if (now - group.seenAt >= ttlMs) groups.delete(key);
    }
    pruneDone(now);
  }

  // One mirror row in. A plain row comes back as itself. A finished group
  // comes back as one row whose message is the joined bytes (base64), using
  // chunk 1's sequence, consensus timestamp, and payer. Incomplete, duplicate,
  // and malformed chunk rows return null.
  function push(topicId, row, now = Date.now()) {
    prune(now);
    if (!row || typeof row !== "object") return null;
    const info = row.chunk_info;
    if (info == null) return row;

    const total = Number(info.total);
    const number = Number(info.number);
    if (!Number.isInteger(total) || total < 1 || total > HCS_MAX_CHUNKS) return null;
    if (!Number.isInteger(number) || number < 1 || number > total) return null;

    const key = groupKey(topicId, info);
    if (!key) return null;
    const payer = typeof row.payer_account_id === "string" ? row.payer_account_id.trim() : "";
    if (!payer || payer !== accountFromInitial(info.initial_transaction_id)) return null;
    if (done.has(key)) return null;

    let group = groups.get(key);
    if (!group) {
      group = {
        total,
        parts: new Map(),
        seqs: [],
        first: null,
        seenAt: now,
      };
      groups.set(key, group);
    } else if (group.total !== total) {
      return null;
    }

    if (group.parts.has(number)) return null;

    group.parts.set(number, decodeBase64(row.message));
    const seq = Number(row.sequence_number);
    if (Number.isFinite(seq)) group.seqs.push(seq);
    if (number === 1) {
      group.first = {
        sequence_number: row.sequence_number,
        consensus_timestamp: row.consensus_timestamp,
        payer_account_id: row.payer_account_id,
      };
    }
    if (group.parts.size < group.total || !group.first) return null;

    const joined = concatParts(group);
    groups.delete(key);
    rememberDone(key, now);
    if (!joined) return null;
    return {
      sequence_number: group.first.sequence_number,
      consensus_timestamp: group.first.consensus_timestamp,
      payer_account_id: group.first.payer_account_id,
      message: encodeBase64(joined),
      topic_id: row.topic_id || topicId,
    };
  }

  function pendingSequences(topicId) {
    const prefix = `${topicId}\0`;
    const seqs = [];
    for (const [key, group] of groups) {
      if (!key.startsWith(prefix)) continue;
      for (const seq of group.seqs) seqs.push(seq);
    }
    return seqs;
  }

  return { push, prune, pendingSequences };
}

// Parsed topic messages from one mirror page. Invalid JSON is skipped, the
// same as a normal message the app cannot read. Chunks stay hidden until the
// group is complete.
export function ingestMirrorRows(assembler, topicId, rows, now = Date.now()) {
  const out = [];
  for (const row of rows || []) {
    const ready = assembler.push(topicId, row, now);
    if (!ready) continue;
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(String(ready.message || ""), "base64").toString("utf8"));
    } catch {
      continue;
    }
    out.push({
      parsed,
      payer: ready.payer_account_id,
      consensus_timestamp: ready.consensus_timestamp,
      sequence_number: ready.sequence_number,
    });
  }
  return out;
}

// Highest mirror sequence that is safe to skip on the next read.
// An incomplete group holds the watermark at the sequence before its first
// arrived chunk, so a later read still sees those bytes. Callers that keep
// the assembler (the server poller, a live subscription) can walk past the
// group because the buffer still has the chunks.
export function openWatermark(after, rows, pendingSeqs) {
  const floor = Number(after) || 0;
  let maxSeq = floor;
  let hole = Infinity;
  const pending = new Set(pendingSeqs || []);
  for (const row of rows || []) {
    const seq = Number(row && row.sequence_number);
    if (!Number.isFinite(seq)) continue;
    if (pending.has(seq)) {
      if (seq < hole) hole = seq;
      continue;
    }
    if (seq > maxSeq) maxSeq = seq;
  }
  if (hole !== Infinity) return Math.max(floor, hole - 1);
  return maxSeq;
}
