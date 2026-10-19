// Early Hashinals: the first 1000 inscriptions (inscription_number 0..999).
// The list is public chain data. It is rebuilt only when the file on the
// data volume is missing or invalid, then owners are refreshed from the
// mirror. Nothing here is written to SQLite.

import fs from "node:fs";
import path from "node:path";

export const TIER_NUMBERS = "https://v2-api.tier.bot/api/inscriptions/numbers";
export const DEFAULT_MIRROR = "https://mainnet.mirrornode.hedera.com";
export const LIST_FILE = "early-hashinals.json";
export const OWNERS_FILE = "early-hashinal-owners.json";
export const REQUEST_TIMEOUT_MS = 10000;
export const OWNER_REFRESH_MS = 15 * 60 * 1000;
export const LIST_RETRY_START_MS = 60 * 1000;
export const LIST_RETRY_MAX_MS = 15 * 60 * 1000;
// At this many wanted serials or fewer, read each NFT. More than this pages
// upward from the lowest serial and stops at the highest.
export const OWNER_DIRECT_MAX = 20;
export const LAST_INSCRIPTION = 999;

const PAGE_LIMIT = 100;
const MAX_TRIES = 6;
const MAX_BACKOFF_MS = 30000;
const MAX_INSCRIPTION_PAGES = 15;
const MAX_NFT_PAGES = 5000;
const ACCOUNT_ID = /^0\.0\.\d+$/;

function warnWith(deps, message) {
  if (deps && typeof deps.warn === "function") deps.warn(message);
  else console.warn(message);
}

function uint32(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return BigInt(n >>> 0);
}

// tier.bot's created_timestamp JSON number is not a safe integer (it drops
// the last nanos). ts_raw low/high rebuild the same nanoseconds the mirror
// prints as "seconds.nanos".
export function timestampNanos(value) {
  if (value && typeof value === "object") {
    if (!Object.prototype.hasOwnProperty.call(value, "low")) return null;
    if (!Object.prototype.hasOwnProperty.call(value, "high")) return null;
    const low = uint32(value.low);
    const high = uint32(value.high);
    if (low == null || high == null) return null;
    return high * 4294967296n + low;
  }
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  const dotted = /^(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const frac = (dotted[2] + "000000000").slice(0, 9);
    return BigInt(dotted[1]) * 1000000000n + BigInt(frac);
  }
  if (!/^\d+$/.test(text)) return null;
  if (text.length >= 16) return BigInt(text);
  return BigInt(text) * 1000000000n;
}

export function mirrorTimestamp(nanos) {
  if (typeof nanos !== "bigint" || nanos < 0n) return null;
  const sec = nanos / 1000000000n;
  const frac = (nanos % 1000000000n).toString().padStart(9, "0");
  return `${sec}.${frac}`;
}

export function timestampsMatch(left, right) {
  const a = timestampNanos(left);
  const b = timestampNanos(right);
  return a != null && b != null && a === b;
}

export function inscriptionStamp(row) {
  if (!row || typeof row !== "object") return null;
  if (row.ts_raw && typeof row.ts_raw === "object") {
    const fromRaw = mirrorTimestamp(timestampNanos(row.ts_raw));
    if (fromRaw) return fromRaw;
  }
  if (typeof row.created_timestamp === "string" && timestampNanos(row.created_timestamp) != null) {
    return row.created_timestamp.trim();
  }
  return null;
}

export function inscriptionRecord(row) {
  if (!row || typeof row !== "object") return null;
  const n = row.inscription_number;
  if (!Number.isInteger(n) || n < 0 || n > LAST_INSCRIPTION) return null;
  if (typeof row.ht_id !== "string" || !ACCOUNT_ID.test(row.ht_id)) return null;
  if (!Number.isInteger(row.sn) || row.sn < 1) return null;
  const stamp = inscriptionStamp(row);
  if (!stamp) return null;
  return {
    number: n + 1,
    token_id: row.ht_id,
    serial: row.sn,
    created_timestamp: stamp,
  };
}

function headerValue(res, name) {
  const headers = res && res.headers;
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key == null ? null : headers[key];
}

function retryWait(res, backoff) {
  const raw = headerValue(res, "retry-after");
  if (raw != null && String(raw).trim() !== "") {
    const text = String(raw).trim();
    const seconds = Number(text);
    if (Number.isFinite(seconds)) return Math.min(MAX_BACKOFF_MS, Math.max(0, seconds * 1000));
    const when = Date.parse(text);
    if (Number.isFinite(when)) return Math.min(MAX_BACKOFF_MS, Math.max(0, when - Date.now()));
  }
  return Math.min(MAX_BACKOFF_MS, backoff);
}

function requestSignal(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (typeof timer.unref === "function") timer.unref();
  return { signal: ctrl.signal, cancel: () => clearTimeout(timer) };
}

async function drain(res) {
  try {
    if (res && typeof res.text === "function") await res.text();
  } catch {
    /* the body is only drained so the socket can be reused */
  }
}

export async function fetchJson(url, deps, opts = {}) {
  const fetchImpl = deps.fetch;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeout = deps.timeoutMs || REQUEST_TIMEOUT_MS;
  let backoff = 1000;
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    const timer = requestSignal(timeout);
    let res;
    try {
      res = await fetchImpl(url, { signal: timer.signal });
    } finally {
      timer.cancel();
    }
    const status = res && res.status;
    if (status === 429) {
      await drain(res);
      const wait = retryWait(res, backoff);
      backoff = Math.min(MAX_BACKOFF_MS, Math.max(1000, backoff * 2));
      await sleep(wait);
      continue;
    }
    if (status === 404 && opts.missing) {
      await drain(res);
      return null;
    }
    if (!res || !res.ok) {
      await drain(res);
      const err = new Error(`http ${status || 0}`);
      err.status = status || 0;
      throw err;
    }
    return await res.json();
  }
  const err = new Error("http 429");
  err.status = 429;
  throw err;
}

function tierUrl(cursor) {
  const url = new URL(TIER_NUMBERS);
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (cursor != null) url.searchParams.set("inscriptionNumber", String(cursor));
  return url.toString();
}

function finishInscriptions(kept) {
  kept.sort((a, b) => a.number - b.number);
  return kept;
}

export async function collectInscriptions(deps) {
  const kept = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < MAX_INSCRIPTION_PAGES; page += 1) {
    const body = await fetchJson(tierUrl(cursor), deps);
    if (!Array.isArray(body)) throw new Error("bad inscription page");
    if (body.length === 0) return finishInscriptions(kept);
    let maxKept = null;
    let passedEnd = false;
    for (const row of body) {
      const n = row && row.inscription_number;
      if (!Number.isInteger(n) || n < 0) continue;
      if (n > LAST_INSCRIPTION) {
        passedEnd = true;
        continue;
      }
      if (maxKept == null || n > maxKept) maxKept = n;
      if (seen.has(n)) continue;
      seen.add(n);
      const record = inscriptionRecord(row);
      if (record) kept.push(record);
    }
    // A short page, a page that reaches 999, or a cursor that does not move
    // is the end of the list. Anything still paging after the cap is a bad
    // crawl and must not be saved.
    if (passedEnd || maxKept == null || maxKept >= LAST_INSCRIPTION) return finishInscriptions(kept);
    if (cursor != null && maxKept <= cursor) return finishInscriptions(kept);
    cursor = maxKept;
    if (body.length < PAGE_LIMIT) return finishInscriptions(kept);
  }
  throw new Error("inscription pages did not reach 999");
}

function nftUrl(mirror, tokenId, serial) {
  return `${mirror}/api/v1/tokens/${tokenId}/nfts/${serial}`;
}

export async function verifyInscriptions(records, deps) {
  const mirror = (deps && deps.mirror) || DEFAULT_MIRROR;
  const kept = [];
  for (const record of records) {
    const nft = await fetchJson(nftUrl(mirror, record.token_id, record.serial), deps, { missing: true });
    if (!nft || nft.deleted === true) continue;
    if (!timestampsMatch(record.created_timestamp, nft.created_timestamp)) continue;
    kept.push(record);
  }
  return kept;
}

export async function buildEarlyList(deps) {
  const records = await collectInscriptions(deps);
  return verifyInscriptions(records, deps);
}

function nextLink(link, mirror) {
  if (link == null || link === "") return null;
  if (typeof link !== "string") throw new Error("bad nft page");
  if (link.startsWith("/")) return mirror + link;
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error("bad nft page");
  }
  if (url.origin !== new URL(mirror).origin) throw new Error("bad nft page");
  return url.toString();
}

async function readMirror(url, deps, opts = {}) {
  if (deps && typeof deps.mirrorFetch === "function") {
    try {
      return await deps.mirrorFetch(url);
    } catch (err) {
      const missing = opts.missing && err && typeof err.message === "string" && err.message.includes("404");
      if (missing) return null;
      throw err;
    }
  }
  return fetchJson(url, deps, opts);
}

function noteOwner(nft, wanted, treasury, owners, seen) {
  const serial = nft && nft.serial_number;
  if (!Number.isInteger(serial) || !wanted.has(serial)) return false;
  seen.add(serial);
  if (nft.deleted === true) return true;
  const account = typeof nft.account_id === "string" ? nft.account_id.trim() : "";
  if (!ACCOUNT_ID.test(account) || account === treasury) return true;
  const number = wanted.get(serial);
  if (owners[account] == null || number < owners[account]) owners[account] = number;
  return true;
}

function nftRangeUrl(mirror, tokenId, lowest) {
  const url = new URL(`${mirror}/api/v1/tokens/${tokenId}/nfts`);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("order", "asc");
  url.searchParams.set("serialnumber", `gte:${lowest}`);
  return url.toString();
}

export async function ownerMapFor(records, deps) {
  const mirror = (deps && deps.mirror) || DEFAULT_MIRROR;
  const byToken = new Map();
  for (const record of records) {
    if (!record || typeof record.token_id !== "string" || !ACCOUNT_ID.test(record.token_id)) continue;
    if (!Number.isInteger(record.serial) || !Number.isInteger(record.number)) continue;
    let wanted = byToken.get(record.token_id);
    if (!wanted) {
      wanted = new Map();
      byToken.set(record.token_id, wanted);
    }
    const prev = wanted.get(record.serial);
    if (prev == null || record.number < prev) wanted.set(record.serial, record.number);
  }
  const owners = {};
  for (const [tokenId, wanted] of byToken) {
    const info = await readMirror(`${mirror}/api/v1/tokens/${tokenId}`, deps);
    const treasury = info && typeof info.treasury_account_id === "string"
      ? info.treasury_account_id.trim()
      : "";
    if (!ACCOUNT_ID.test(treasury)) throw new Error("token treasury missing");
    const seen = new Set();
    const serials = [...wanted.keys()];
    if (serials.length <= OWNER_DIRECT_MAX) {
      for (const serial of serials) {
        const nft = await readMirror(`${mirror}/api/v1/tokens/${tokenId}/nfts/${serial}`, deps, { missing: true });
        if (!nft) continue;
        noteOwner(nft, wanted, treasury, owners, seen);
      }
      continue;
    }
    const lowest = Math.min(...serials);
    const highest = Math.max(...serials);
    const seenUrls = new Set();
    let next = nftRangeUrl(mirror, tokenId, lowest);
    let pages = 0;
    while (next && seen.size < wanted.size) {
      if (seenUrls.has(next) || pages >= MAX_NFT_PAGES) throw new Error("nft page did not advance");
      seenUrls.add(next);
      pages += 1;
      const page = await readMirror(next, deps);
      const nfts = page && Array.isArray(page.nfts) ? page.nfts : null;
      if (!nfts) throw new Error("bad nft page");
      let pageMax = null;
      for (const nft of nfts) {
        const serial = nft && nft.serial_number;
        if (!Number.isInteger(serial)) continue;
        if (pageMax == null || serial > pageMax) pageMax = serial;
        if (serial > highest) continue;
        noteOwner(nft, wanted, treasury, owners, seen);
      }
      if (nfts.length === 0 || seen.size >= wanted.size) break;
      if (pageMax != null && pageMax >= highest) break;
      next = nextLink(page.links && page.links.next, mirror);
    }
  }
  return owners;
}

function validStored(item) {
  return !!item
    && Number.isInteger(item.number) && item.number >= 1 && item.number <= 1000
    && typeof item.token_id === "string" && ACCOUNT_ID.test(item.token_id)
    && Number.isInteger(item.serial) && item.serial >= 1
    && typeof item.created_timestamp === "string"
    && timestampNanos(item.created_timestamp) != null;
}

export function parseList(value) {
  const items = Array.isArray(value) ? value : (value && Array.isArray(value.items) ? value.items : null);
  if (!items) return null;
  const out = [];
  for (const item of items) {
    if (!validStored(item)) return null;
    out.push({
      number: item.number,
      token_id: item.token_id,
      serial: item.serial,
      created_timestamp: item.created_timestamp,
    });
  }
  return out;
}

export function parseOwners(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!value.owners || typeof value.owners !== "object" || Array.isArray(value.owners)) return null;
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) return null;
  const owners = {};
  for (const [id, num] of Object.entries(value.owners)) {
    if (!ACCOUNT_ID.test(id) || !Number.isInteger(num) || num < 1 || num > 1000) return null;
    owners[id] = num;
  }
  return { owners, updatedAt: value.updatedAt };
}

// Windows rename cannot replace a file that is already there. Write a temp
// file, fsync it, then rename, and if that fails unlink the old file once.
export function writeJsonAtomic(filePath, value, fsImpl = fs) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  const data = Buffer.from(JSON.stringify(value));
  let fd;
  try {
    fd = fsImpl.openSync(tmp, "w");
    fsImpl.writeSync(fd, data);
    fsImpl.fsyncSync(fd);
  } finally {
    if (fd != null) fsImpl.closeSync(fd);
  }
  try {
    fsImpl.renameSync(tmp, filePath);
  } catch {
    try {
      fsImpl.unlinkSync(filePath);
    } catch {
      /* the destination was not there */
    }
    fsImpl.renameSync(tmp, filePath);
  }
}

function readJson(filePath, fsImpl) {
  try {
    return JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

export function createEarlyHashinals(options = {}) {
  const fsImpl = options.fs || fs;
  const dataDir = options.dataDir;
  const now = options.now || (() => Date.now());
  const deps = {
    fetch: options.fetch || globalThis.fetch,
    sleep: options.sleep,
    mirror: options.mirror || DEFAULT_MIRROR,
    timeoutMs: options.timeoutMs,
    warn: options.warn,
    mirrorFetch: options.mirrorFetch,
  };
  const setTimeoutImpl = options.setTimeout || setTimeout;
  const clearTimeoutImpl = options.clearTimeout || clearTimeout;
  const setIntervalImpl = options.setInterval || setInterval;
  const clearIntervalImpl = options.clearInterval || clearInterval;
  const listPath = path.join(dataDir, LIST_FILE);
  const ownersPath = path.join(dataDir, OWNERS_FILE);
  const refreshMs = options.refreshMs || OWNER_REFRESH_MS;
  let list = [];
  let listReady = false;
  let owners = {};
  let updatedAt = null;
  let pending = null;
  let timer = null;
  let retryTimer = null;
  let listRetryMs = LIST_RETRY_START_MS;
  let life = 0;

  function snapshot() {
    return { owners: { ...owners }, updatedAt };
  }

  function load() {
    const parsedList = parseList(readJson(listPath, fsImpl));
    if (parsedList) {
      list = parsedList;
      listReady = true;
    } else {
      list = [];
      listReady = false;
    }
    const parsedOwners = parseOwners(readJson(ownersPath, fsImpl));
    if (parsedOwners) {
      owners = parsedOwners.owners;
      updatedAt = parsedOwners.updatedAt;
    }
  }

  async function ensureList() {
    if (listReady) return list.slice();
    const built = await buildEarlyList(deps);
    try {
      writeJsonAtomic(listPath, built, fsImpl);
    } catch {
      warnWith(deps, "early hashinal list was not saved");
    }
    list = built;
    listReady = true;
    return list.slice();
  }

  async function doRefresh() {
    const items = list.slice();
    const next = await ownerMapFor(items, deps);
    const at = now();
    writeJsonAtomic(ownersPath, { owners: next, updatedAt: at }, fsImpl);
    owners = next;
    updatedAt = at;
    return snapshot();
  }

  function refreshOwners() {
    if (!listReady) return Promise.resolve(snapshot());
    if (pending) return pending;
    let resolveGate;
    let rejectGate;
    const gate = new Promise((resolve, reject) => {
      resolveGate = resolve;
      rejectGate = reject;
    });
    pending = gate;
    doRefresh().then(
      (value) => {
        if (pending === gate) pending = null;
        resolveGate(value);
      },
      (err) => {
        if (pending === gate) pending = null;
        rejectGate(err);
      }
    );
    return gate;
  }

  function arm(handle) {
    if (handle && typeof handle.unref === "function") handle.unref();
    return handle;
  }

  async function boot() {
    const generation = life;
    try {
      await ensureList();
    } catch {
      warnWith(deps, "early hashinal list was not built");
      if (generation !== life) return;
      const wait = listRetryMs;
      listRetryMs = Math.min(LIST_RETRY_MAX_MS, listRetryMs * 2);
      retryTimer = arm(setTimeoutImpl(() => {
        retryTimer = null;
        return boot().catch(() => warnWith(deps, "early hashinal list was not built"));
      }, wait));
      return;
    }
    if (generation !== life) return;
    listRetryMs = LIST_RETRY_START_MS;
    try {
      await refreshOwners();
    } catch {
      warnWith(deps, "early hashinal owner refresh failed");
    }
    if (generation !== life || timer) return;
    timer = arm(setIntervalImpl(() => {
      refreshOwners().catch(() => warnWith(deps, "early hashinal owner refresh failed"));
    }, refreshMs));
  }

  function start() {
    load();
    boot().catch(() => warnWith(deps, "early hashinal list was not built"));
  }

  function stop() {
    life += 1;
    if (timer) clearIntervalImpl(timer);
    timer = null;
    if (retryTimer) clearTimeoutImpl(retryTimer);
    retryTimer = null;
  }

  return {
    snapshot,
    load,
    start,
    stop,
    boot,
    ensureList,
    refreshOwners,
    get inflight() {
      return pending;
    },
  };
}

export function startEarlyHashinals(options = {}) {
  if (process.env.EARLY_HASHINALS === "0") {
    return {
      snapshot() {
        return { owners: {}, updatedAt: null };
      },
      stop() {},
    };
  }
  const svc = createEarlyHashinals(options);
  svc.start();
  return svc;
}
