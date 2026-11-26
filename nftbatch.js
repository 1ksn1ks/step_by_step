// Batch NFT mint into an existing collection. One wallet-signed Hedera
// transaction per 10 links. The connected wallet signs every transaction
// through tokenmint.js. Mainnet only.
//
// WHY LOCAL STORAGE IS OK HERE
// The Hashinal resume (hashinalmint.js) stays in memory only, because it
// holds a private HCS-1 submit key. This NFT job holds NO keys or secrets:
// only the token id, the links, a cursor, serials, transaction ids and
// maybe-sent ids. Persisting it is safe. Never store anything key-like.

import { checkMintByMetadata, checkMintTx, mintNfts } from "./tokenmint.js";

const MIRROR_NODE = "https://mainnet.mirrornode.hedera.com";
const ACCOUNT_ID = /^\d+\.\d+\.\d+$/;
const CHUNK = 10;
const BYTE_LIMIT = 100;
const PREFIXES = ["ipfs://", "https://", "hcs://1/"];
const PREFIX_REASON = "Must start with ipfs://, https://, or hcs://1/";
const SIZE_REASON = "Over 100 bytes";
const STRING_REASON = "Not a string";
const JSON_REASON = "Not a JSON list";
const HEADER_CELL = /^(metadata|uri|link|url)$/i;
const DECLINE = /reject|cancel|denied|closed/i;
const KEY_PREFIX = "w3g-nft-batch:";
const encoder = new TextEncoder();

let fallbackStorage = null;

function utf8Size(text) {
  return encoder.encode(text).length;
}

function decimalField(value) {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return value;
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // A locked-down page can throw just for touching localStorage.
  }
  if (!fallbackStorage) fallbackStorage = memoryStorage();
  return fallbackStorage;
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
}

function judgeLink(value) {
  if (typeof value !== "string") return { ok: false, value, reason: STRING_REASON };
  const text = value.trim();
  if (text === "") return { ok: false, blank: true, value: text };
  if (!PREFIXES.some((prefix) => text.startsWith(prefix))) {
    return { ok: false, value: text, reason: PREFIX_REASON };
  }
  if (utf8Size(text) > BYTE_LIMIT) return { ok: false, value: text, reason: SIZE_REASON };
  return { ok: true, value: text };
}

function pushLink(bucket, line, judged) {
  if (judged.blank) return;
  if (!judged.ok) {
    bucket.bad.push({ line, value: judged.value, reason: judged.reason });
    return;
  }
  const value = judged.value;
  if (bucket.seen.has(value)) {
    bucket.duplicates.push({ line, value, firstLine: bucket.seen.get(value) });
  } else {
    bucket.seen.set(value, line);
  }
  bucket.links.push(value);
}

function emptyParse() {
  return { links: [], bad: [], duplicates: [], seen: new Map() };
}

function finishParse(bucket) {
  return {
    links: bucket.links,
    bad: bucket.bad,
    duplicates: bucket.duplicates,
    total: bucket.links.length + bucket.bad.length,
  };
}

function splitLines(text) {
  const source = text == null ? "" : String(text);
  const trimmed = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return trimmed.split(/\r\n|\n|\r/);
}

function firstColumn(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("\"")) {
    let out = "";
    for (let i = 1; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "\"") {
        if (trimmed[i + 1] === "\"") {
          out += "\"";
          i += 1;
          continue;
        }
        break;
      }
      out += ch;
    }
    return out.trim();
  }
  const comma = trimmed.indexOf(",");
  return (comma === -1 ? trimmed : trimmed.slice(0, comma)).trim();
}

function parseLines(text, csv) {
  const bucket = emptyParse();
  const lines = splitLines(text);
  let headerPending = csv;
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (raw.trim() === "") continue;
    const cell = csv ? firstColumn(raw) : raw.trim();
    if (headerPending) {
      headerPending = false;
      if (HEADER_CELL.test(cell)) continue;
    }
    if (cell === "") continue;
    pushLink(bucket, index + 1, judgeLink(cell));
  }
  return finishParse(bucket);
}

function jsonField(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    for (const key of ["metadata", "uri", "url"]) {
      if (typeof item[key] === "string") return item[key];
    }
    if ("metadata" in item || "uri" in item || "url" in item) {
      if ("metadata" in item) return item.metadata;
      if ("uri" in item) return item.uri;
      return item.url;
    }
  }
  return item;
}

function parseJson(text) {
  const bucket = emptyParse();
  let data;
  try {
    data = JSON.parse(text == null ? "" : String(text));
  } catch {
    bucket.bad.push({ line: 1, value: "", reason: JSON_REASON });
    return finishParse(bucket);
  }
  if (!Array.isArray(data)) {
    bucket.bad.push({ line: 1, value: "", reason: JSON_REASON });
    return finishParse(bucket);
  }
  for (let index = 0; index < data.length; index++) {
    const value = jsonField(data[index]);
    if (typeof value === "string" && value.trim() === "") continue;
    pushLink(bucket, index + 1, judgeLink(value));
  }
  return finishParse(bucket);
}

/**
 * Parse a text, csv, or json list of NFT metadata links.
 * Duplicates are reported and kept. Blank lines are skipped.
 */
export function parseLinkList(text, options) {
  const kind = options && typeof options.kind === "string" ? options.kind.toLowerCase() : "text";
  if (kind === "json") return parseJson(text);
  return parseLines(text, kind === "csv");
}

/**
 * Read one mainnet collection. Supplies are decimal strings.
 * remaining is null when the supply type is INFINITE.
 */
export async function readCollectionSupply(tokenId) {
  const id = typeof tokenId === "string" ? tokenId.trim() : "";
  let response;
  try {
    response = await fetch(`${MIRROR_NODE}/api/v1/tokens/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw new Error("Could not read the collection");
  }
  if (!response || !response.ok) throw new Error("Could not read the collection");
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Could not read the collection");
  }
  if (!data || typeof data !== "object" || typeof data.type !== "string") {
    throw new Error("Could not read the collection");
  }
  if (data.type !== "NON_FUNGIBLE_UNIQUE") throw new Error("This token is not an NFT collection");
  const maxSupply = decimalField(data.max_supply);
  const totalSupply = decimalField(data.total_supply);
  if (maxSupply == null || totalSupply == null) throw new Error("Could not read the collection");
  let remaining = null;
  if (data.supply_type !== "INFINITE") {
    const max = BigInt(maxSupply);
    const total = BigInt(totalSupply);
    remaining = (max > total ? max - total : 0n).toString();
  }
  return {
    maxSupply,
    totalSupply,
    remaining,
    type: data.type,
    treasury: typeof data.treasury_account_id === "string" ? data.treasury_account_id : "",
  };
}

export function jobKey(accountId, tokenId) {
  return `${KEY_PREFIX}${accountId}:${tokenId}`;
}

function storedJob(job) {
  const stored = {
    v: 1,
    accountId: job.accountId,
    tokenId: job.tokenId,
    links: Array.isArray(job.links) ? job.links.slice() : [],
    cursor: Number.isInteger(job.cursor) && job.cursor >= 0 ? job.cursor : 0,
    minted: [],
    maybeSent: [],
    inflight: null,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
  for (const row of Array.isArray(job.minted) ? job.minted : []) {
    if (!row || typeof row !== "object") continue;
    stored.minted.push({
      txId: typeof row.txId === "string" ? row.txId : "",
      serials: Array.isArray(row.serials) ? row.serials.map((serial) => String(serial)) : [],
      from: row.from,
      to: row.to,
    });
  }
  for (const row of Array.isArray(job.maybeSent) ? job.maybeSent : []) {
    if (!row || typeof row !== "object") continue;
    stored.maybeSent.push({
      txId: typeof row.txId === "string" ? row.txId : "",
      from: row.from,
      to: row.to,
    });
  }
  if (job.inflight && Number.isInteger(job.inflight.from) && Number.isInteger(job.inflight.to)) {
    stored.inflight = { from: job.inflight.from, to: job.inflight.to };
  }
  if (typeof job.reason === "string" && job.reason) stored.reason = job.reason;
  return stored;
}

function normalizeLoaded(job) {
  // A closed tab leaves status "running". An in-flight range may have been
  // broadcast, so it comes back unconfirmed until recheck() says otherwise.
  if (job.status === "running") {
    job.loadedFromRunning = true;
    if (job.inflight || job.maybeSent.length > 0) {
      job.status = "unconfirmed";
      if (!job.reason) job.reason = "Not confirmed on Hedera yet";
    } else {
      job.status = "paused";
    }
  }
  return job;
}

function readStored(store, key) {
  let raw;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.links)) return null;
    if (typeof parsed.accountId !== "string" || typeof parsed.tokenId !== "string") return null;
    return normalizeLoaded(storedJob(parsed));
  } catch {
    return null;
  }
}

export function loadJob(accountId, tokenId, storage) {
  const job = readStored(resolveStorage(storage), jobKey(accountId, tokenId));
  if (!job || job.accountId !== accountId || job.tokenId !== tokenId) return null;
  return job;
}

export function saveJob(job, storage) {
  if (!job || typeof job.accountId !== "string" || typeof job.tokenId !== "string") return false;
  try {
    resolveStorage(storage).setItem(jobKey(job.accountId, job.tokenId), JSON.stringify(storedJob(job)));
    return true;
  } catch {
    job.persistError = true;
    return false;
  }
}

export function discardJob(accountId, tokenId, storage) {
  try {
    resolveStorage(storage).removeItem(jobKey(accountId, tokenId));
  } catch {
    // Dropping a finished job must not trap the caller.
  }
}

export function listSavedJobs(accountId, storage) {
  const store = resolveStorage(storage);
  const prefix = `${KEY_PREFIX}${accountId}:`;
  const jobs = [];
  let length = 0;
  try {
    length = store.length || 0;
  } catch {
    return jobs;
  }
  for (let index = 0; index < length; index++) {
    let key = null;
    try {
      key = store.key(index);
    } catch {
      continue;
    }
    if (typeof key !== "string" || !key.startsWith(prefix)) continue;
    const job = readStored(store, key);
    if (job && job.accountId === accountId) jobs.push(job);
  }
  return jobs;
}

function errorText(err) {
  const parts = [];
  if (err && err.message) parts.push(String(err.message));
  if (err && err.cause && err.cause.message) parts.push(String(err.cause.message));
  return parts.join(" ");
}

function isMaxSupply(text) {
  return typeof text === "string" && text.includes("MAX_SUPPLY_REACHED");
}

function maybeIds(err) {
  if (!err || !Array.isArray(err.maybeSentTxIds)) return [];
  return err.maybeSentTxIds.filter((id) => typeof id === "string" && id !== "");
}

async function readConnectedAccount() {
  const web3 = await import("./web3.js");
  const id = typeof web3.connectedAccount === "string" ? web3.connectedAccount.trim() : "";
  if (!ACCOUNT_ID.test(id)) throw new Error("Connect wallet first");
  return id;
}

/**
 * Mint links into an existing collection, ten per signed transaction.
 * A saved job for this account and token is resumed. An empty links list
 * keeps the saved list. Pass storage to replace localStorage in tests.
 */
export function createBatchMinter(options = {}) {
  const tokenId = typeof options.tokenId === "string" ? options.tokenId.trim() : "";
  const storage = options.storage;
  const mint = options.mint || mintNfts;
  const checkTx = options.checkTx || checkMintTx;
  const checkMeta = options.checkMeta || checkMintByMetadata;
  const readSupply = options.readSupply || readCollectionSupply;
  const now = options.now || Date.now;
  let links = Array.isArray(options.links) ? options.links.slice() : [];
  let accountId = typeof options.accountId === "string" ? options.accountId.trim() : "";
  let job = null;
  let running = false;
  let loopPromise = null;
  let pauseAfter = false;
  let stopAfter = false;
  let discarded = false;
  let warned = false;
  const listeners = new Map();

  if (accountId && tokenId) {
    const saved = loadJob(accountId, tokenId, storage);
    if (saved) {
      job = saved;
      links = saved.links.slice();
      if (job.loadedFromRunning) {
        job.loadedFromRunning = false;
        persist();
      }
    }
  }

  function on(event, fn) {
    if (typeof fn !== "function") return () => {};
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => off(event, fn);
  }

  function off(event, fn) {
    const set = listeners.get(event);
    if (!set) return;
    if (fn) set.delete(fn);
    else listeners.delete(event);
  }

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch {
        // A listener must not stop the mint.
      }
    }
  }

  function emitStatus() {
    if (!job) return;
    const payload = { status: job.status };
    if (job.reason) payload.reason = job.reason;
    emit("status", payload);
  }

  function progressPayload() {
    let minted = 0;
    for (const row of job.minted) minted += row.serials.length;
    const total = job.links.length;
    return {
      minted,
      total,
      cursor: job.cursor,
      txCount: Math.ceil(total / CHUNK),
      txDone: job.minted.length,
    };
  }

  function persist() {
    if (discarded || !job) return;
    job.updatedAt = now();
    const ok = saveJob(job, storage);
    if (!ok && !warned) {
      warned = true;
      emit("warning", { message: "Could not save mint progress in this browser" });
    }
  }

  function state() {
    if (!job) {
      return {
        v: 1,
        accountId: accountId || "",
        tokenId,
        links: links.slice(),
        cursor: 0,
        minted: [],
        maybeSent: [],
        inflight: null,
        status: "idle",
        createdAt: 0,
        updatedAt: 0,
        persistError: false,
        running,
      };
    }
    const snapshot = {
      v: 1,
      accountId: job.accountId,
      tokenId: job.tokenId,
      links: job.links.slice(),
      cursor: job.cursor,
      minted: job.minted.map((row) => ({
        txId: row.txId,
        serials: row.serials.slice(),
        from: row.from,
        to: row.to,
      })),
      maybeSent: job.maybeSent.map((row) => ({ txId: row.txId, from: row.from, to: row.to })),
      inflight: job.inflight ? { from: job.inflight.from, to: job.inflight.to } : null,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      persistError: job.persistError === true,
      running,
    };
    if (job.reason) snapshot.reason = job.reason;
    return snapshot;
  }

  function collected() {
    const serials = [];
    const txIds = [];
    for (const row of job.minted) {
      for (const serial of row.serials) serials.push(String(serial));
      if (row.txId) txIds.push(row.txId);
    }
    return { serials, txIds };
  }

  function accept(range, result) {
    const serials = Array.isArray(result && result.serials) ? result.serials.map((serial) => String(serial)) : [];
    const txId = result && typeof result.txId === "string"
      ? result.txId
      : (result && Array.isArray(result.txIds) && typeof result.txIds[0] === "string" ? result.txIds[0] : "");
    job.minted.push({ txId, serials, from: range.from, to: range.to });
    if (range.from === job.cursor) job.cursor = range.to;
    if (job.inflight && job.inflight.from === range.from && job.inflight.to === range.to) job.inflight = null;
    job.maybeSent = job.maybeSent.filter((row) => row.from !== range.from || row.to !== range.to);
    job.reason = undefined;
    persist();
    emit("batch", { from: range.from, to: range.to, txId, serials });
    emit("progress", progressPayload());
  }

  function finish() {
    job.status = "done";
    job.inflight = null;
    job.reason = undefined;
    job.updatedAt = now();
    const summary = collected();
    discardJob(job.accountId, job.tokenId, storage);
    emit("status", { status: "done" });
    emit("done", summary);
  }

  function halt(status) {
    job.status = status;
    job.inflight = null;
    if (!discarded) persist();
    emitStatus();
    return state();
  }

  async function confirmRange(range, txId) {
    if (txId) {
      let looked = { status: "unknown" };
      try {
        looked = await checkTx(txId, job.tokenId);
      } catch {
        looked = { status: "unknown" };
      }
      if (looked && looked.status === "minted") {
        const serials = Array.isArray(looked.serials) ? looked.serials.map((serial) => String(serial)) : [];
        return { kind: "minted", serials };
      }
      if (looked && looked.status === "failed") {
        return { kind: "failed", result: typeof looked.result === "string" ? looked.result : "" };
      }
    }
    const chunk = job.links.slice(range.from, range.to);
    if (chunk.length === 0) return { kind: "unknown" };
    // No transaction to read: each link must show up as its own NFT, made
    // since two minutes before this job began (a fast phone clock). A serial
    // this job already counted, or one an earlier line of this chunk took
    // (a duplicate link), is not this line's. A line with nothing left
    // means the chunk is not proven.
    const claimed = new Set();
    for (const row of job.minted) {
      for (const serial of row.serials) claimed.add(String(serial));
    }
    const serials = [];
    for (const link of chunk) {
      let found = { status: "unknown" };
      try {
        found = await checkMeta(job.tokenId, job.accountId, link, { since: job.createdAt - 120000 });
      } catch {
        found = { status: "unknown" };
      }
      if (!found || found.status !== "minted" || !Array.isArray(found.serials) || found.serials.length === 0) {
        return { kind: "unknown" };
      }
      const serial = found.serials.map((value) => String(value)).find((value) => !claimed.has(value));
      if (serial === undefined) return { kind: "unknown" };
      claimed.add(serial);
      serials.push(serial);
    }
    return { kind: "minted", serials };
  }

  async function settleError(range, err) {
    const text = errorText(err);
    if (isMaxSupply(text)) {
      job.inflight = null;
      job.maybeSent = job.maybeSent.filter((row) => row.from !== range.from || row.to !== range.to);
      job.status = "stopped";
      job.reason = "max supply reached";
      persist();
      emitStatus();
      return false;
    }
    const ids = maybeIds(err);
    if (ids.length === 0) {
      job.inflight = null;
      job.status = "paused";
      job.reason = DECLINE.test(text) ? "Wallet declined" : (text || "Minting stopped");
      persist();
      emitStatus();
      return false;
    }
    const txId = ids[0];
    job.inflight = null;
    if (!job.maybeSent.some((row) => row.txId === txId && row.from === range.from && row.to === range.to)) {
      job.maybeSent.push({ txId, from: range.from, to: range.to });
    }
    persist();
    const outcome = await confirmRange(range, txId);
    if (outcome.kind === "minted") {
      accept(range, { txId, serials: outcome.serials, txIds: [txId] });
      return true;
    }
    if (outcome.kind === "failed") {
      job.maybeSent = job.maybeSent.filter((row) => row.from !== range.from || row.to !== range.to);
      job.inflight = null;
      if (isMaxSupply(outcome.result)) {
        job.status = "stopped";
        job.reason = "max supply reached";
      } else {
        job.status = "paused";
        job.reason = "Last batch failed on Hedera, nothing was minted";
      }
      persist();
      emitStatus();
      return false;
    }
    job.status = "unconfirmed";
    job.reason = "Not confirmed on Hedera yet";
    persist();
    emitStatus();
    return false;
  }

  function blocked() {
    if (!job) return false;
    if (job.status === "done" || job.status === "unconfirmed") return true;
    if (job.maybeSent.length > 0 || job.inflight) return true;
    return false;
  }

  async function ensureAccount() {
    if (ACCOUNT_ID.test(accountId)) return accountId;
    accountId = await readConnectedAccount();
    if (!job) {
      const saved = loadJob(accountId, tokenId, storage);
      if (saved) {
        job = saved;
        links = saved.links.slice();
        if (job.loadedFromRunning) {
          job.loadedFromRunning = false;
          persist();
        }
      }
    }
    return accountId;
  }

  async function ensureJob() {
    if (!ACCOUNT_ID.test(tokenId)) throw new Error("Enter a token id like 0.0.123");
    if (job) return;
    if (links.length === 0) {
      emit("status", { status: "paused", reason: "Add at least one link" });
      return;
    }
    const supply = await readSupply(tokenId);
    if (supply && supply.remaining != null) {
      try {
        const remaining = BigInt(supply.remaining);
        const count = BigInt(links.length);
        if (count > remaining) {
          const over = (count - remaining).toString();
          emit("warning", { message: `This list is ${over} over the remaining supply` });
        }
      } catch {
        // A supply figure that is not a whole number is ignored. The mint still runs.
      }
    }
    const stamp = now();
    job = {
      v: 1,
      accountId,
      tokenId,
      links: links.slice(),
      cursor: 0,
      minted: [],
      maybeSent: [],
      inflight: null,
      status: "running",
      createdAt: stamp,
      updatedAt: stamp,
    };
    persist();
  }

  async function run() {
    pauseAfter = false;
    stopAfter = false;
    await ensureAccount();
    await ensureJob();
    if (!job || discarded) return state();
    if (blocked()) {
      emitStatus();
      return state();
    }
    job.status = "running";
    job.reason = undefined;
    emitStatus();
    while (job.cursor < job.links.length) {
      if (discarded) return state();
      if (stopAfter) return halt("stopped");
      if (pauseAfter) return halt("paused");
      if (job.maybeSent.length > 0 || job.inflight) {
        job.status = "unconfirmed";
        job.reason = "Not confirmed on Hedera yet";
        persist();
        emitStatus();
        return state();
      }
      const from = job.cursor;
      const to = Math.min(from + CHUNK, job.links.length);
      job.inflight = { from, to };
      job.status = "running";
      // The range is durable before the wallet opens, so a closed tab cannot resend it.
      persist();
      try {
        const result = await mint(job.tokenId, job.links.slice(from, to));
        if (discarded) return state();
        accept({ from, to }, result);
      } catch (err) {
        if (discarded) return state();
        const goOn = await settleError({ from, to }, err);
        if (!goOn) return state();
      }
      if (discarded) return state();
      if (stopAfter) return halt("stopped");
      if (pauseAfter) return halt("paused");
    }
    if (job.maybeSent.length === 0 && !job.inflight) finish();
    return state();
  }

  /**
   * Re-send ranges that may already have been minted. This is the only path
   * that sends a maybe-sent chunk again. The UI calls it after a second
   * confirm. It does not run by itself, and it does not continue into later
   * links that were never sent.
   */
  async function remint() {
    await ensureAccount();
    if (!job || discarded) return state();
    const ranges = job.maybeSent.map((row) => ({ txId: row.txId, from: row.from, to: row.to }));
    if (job.inflight && !ranges.some((row) => row.from === job.inflight.from && row.to === job.inflight.to)) {
      ranges.push({ txId: "", from: job.inflight.from, to: job.inflight.to });
    }
    if (ranges.length === 0) return state();
    for (const range of ranges) {
      if (discarded) return state();
      job.maybeSent = job.maybeSent.filter((row) => row.from !== range.from || row.to !== range.to);
      job.inflight = { from: range.from, to: range.to };
      job.status = "running";
      job.reason = undefined;
      persist();
      try {
        const result = await mint(job.tokenId, job.links.slice(range.from, range.to));
        if (discarded) return state();
        accept(range, result);
      } catch (err) {
        if (discarded) return state();
        const goOn = await settleError(range, err);
        if (!goOn) return state();
      }
    }
    if (discarded) return state();
    if (job.cursor >= job.links.length && job.maybeSent.length === 0 && !job.inflight) {
      finish();
      return state();
    }
    if (job.status === "running") {
      job.status = "paused";
      job.inflight = null;
      job.reason = undefined;
      persist();
      emitStatus();
    }
    return state();
  }

  function begin(task) {
    if (running) return loopPromise;
    if (discarded) return Promise.resolve(state());
    running = true;
    loopPromise = (async () => {
      try {
        if (task === "remint") return await remint();
        return await run();
      } finally {
        running = false;
        loopPromise = null;
      }
    })();
    return loopPromise;
  }

  function start() {
    if (discarded) return Promise.resolve(state());
    if (running) return loopPromise;
    if (blocked()) return Promise.resolve(state());
    return begin("run");
  }

  function resume() {
    if (discarded) return Promise.resolve(state());
    if (running) return loopPromise;
    if (blocked()) return Promise.resolve(state());
    return begin("run");
  }

  function pause() {
    pauseAfter = true;
  }

  function stop() {
    stopAfter = true;
    pauseAfter = false;
  }

  function discard() {
    discarded = true;
    stopAfter = true;
    const id = job ? job.accountId : accountId;
    if (id && tokenId) discardJob(id, tokenId, storage);
    if (!running) job = null;
  }

  async function recheck() {
    if (running || !job) return state();
    if (job.status !== "unconfirmed" && job.maybeSent.length === 0 && !job.inflight) return state();
    const ranges = job.maybeSent.map((row) => ({ txId: row.txId, from: row.from, to: row.to }));
    if (job.inflight && !ranges.some((row) => row.from === job.inflight.from && row.to === job.inflight.to)) {
      ranges.push({ txId: "", from: job.inflight.from, to: job.inflight.to });
    }
    let unknown = 0;
    for (const range of ranges) {
      const outcome = await confirmRange(range, range.txId || "");
      if (outcome.kind === "minted") {
        accept(range, { txId: range.txId || "", serials: outcome.serials, txIds: range.txId ? [range.txId] : [] });
        continue;
      }
      if (outcome.kind === "failed") {
        job.maybeSent = job.maybeSent.filter((row) => row.from !== range.from || row.to !== range.to);
        if (job.inflight && job.inflight.from === range.from && job.inflight.to === range.to) job.inflight = null;
        if (isMaxSupply(outcome.result)) {
          job.status = "stopped";
          job.reason = "max supply reached";
          persist();
          emitStatus();
          return state();
        }
        continue;
      }
      unknown += 1;
    }
    if (job.cursor >= job.links.length && job.maybeSent.length === 0 && !job.inflight) {
      finish();
      return state();
    }
    if (unknown === 0 && job.maybeSent.length === 0 && !job.inflight) {
      job.status = "paused";
      job.reason = undefined;
      persist();
      emitStatus();
      return state();
    }
    job.status = "unconfirmed";
    job.reason = "Not confirmed on Hedera yet";
    persist();
    emitStatus();
    return state();
  }

  function forceRemintUnconfirmed() {
    if (discarded) return Promise.resolve(state());
    if (running) return loopPromise;
    return begin("remint");
  }

  return {
    start,
    pause,
    resume,
    stop,
    discard,
    recheck,
    forceRemintUnconfirmed,
    state,
    on,
    off,
  };
}
