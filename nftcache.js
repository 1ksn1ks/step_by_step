// Local cache of every token an account holds. Topic load reads this first.
// A miss asks the mirror once for the whole account, saves every balance,
// and the next topic looks the collection up here.
//
// The public mirror rejects an IP above about 40 requests a second. This
// queue stays at 20/s and slows down after a 429, so topic polls and other
// mirror calls on the same IP still have room.

const MIRROR = 'https://mainnet.mirrornode.hedera.com';
const DB_NAME = 'meritocracy-nft-holdings';
const STORE = 'accounts';
const TTL_MS = 12 * 60 * 60 * 1000;
const CAP_PER_SECOND = 20;
const MIN_GAP_MS = Math.ceil(1000 / CAP_PER_SECOND);
const MAX_PAGES = 50;

const memory = new Map();
const inflight = new Map();
let gapMs = MIN_GAP_MS;
let nextSlot = 0;
let tail = Promise.resolve();
let dbPromise = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function absolute(link) {
  if (!link) return null;
  if (link.startsWith('http')) return link;
  return `${MIRROR}${link}`;
}

async function takeSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + gapMs;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

function slowDown() {
  gapMs = Math.min(1000, gapMs * 2);
  nextSlot = Math.max(nextSlot, Date.now() + gapMs);
}

function fullSpeed() {
  gapMs = MIN_GAP_MS;
}

function runSerial(fn) {
  const job = tail.then(fn, fn);
  tail = job.then(() => {}, () => {});
  return job;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'accountId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

function persist(row) {
  openDb().then((database) => {
    if (!database) return;
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(row);
  }).catch(() => {});
}

async function preload(accountIds) {
  const missing = [];
  for (const accountId of accountIds) {
    if (accountId && !memory.has(accountId)) missing.push(accountId);
  }
  if (!missing.length) return;
  const database = await openDb();
  if (!database) return;
  await new Promise((resolve) => {
    const tx = database.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    for (const accountId of missing) {
      const request = store.get(accountId);
      request.onsuccess = () => {
        if (request.result && request.result.tokens) memory.set(accountId, request.result);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

function readFresh(accountId) {
  const row = memory.get(accountId);
  if (!row || !row.tokens) return null;
  if (Date.now() - row.checkedAt > TTL_MS) return null;
  return row.tokens;
}

async function mirrorJson(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await takeSlot();
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        slowDown();
        lastError = new Error('429');
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      fullSpeed();
      return await response.json();
    } catch (err) {
      lastError = err;
      if (err && err.message === '429') continue;
      slowDown();
      if (err && String(err.message).startsWith('HTTP ')) throw err;
    }
  }
  throw lastError || new Error('mirror failed');
}

async function loadTokens(accountId) {
  let url = `${MIRROR}/api/v1/accounts/${accountId}/tokens?limit=100`;
  const tokens = {};
  const seen = new Set();
  let pages = 0;
  while (url && pages < MAX_PAGES && !seen.has(url)) {
    seen.add(url);
    pages += 1;
    const data = await mirrorJson(url);
    const rows = data && data.tokens;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && row.token_id) tokens[row.token_id] = Number(row.balance) || 0;
      }
    }
    url = absolute(data && data.links && data.links.next);
  }
  const saved = { accountId, tokens, checkedAt: Date.now() };
  memory.set(accountId, saved);
  persist(saved);
  return tokens;
}

// Cached balances for these accounts. Missing and expired ids are absent.
export async function prepareHoldings(accountIds) {
  await preload(accountIds);
  const holdings = new Map();
  for (const accountId of accountIds) {
    const tokens = readFresh(accountId);
    if (tokens) holdings.set(accountId, tokens);
  }
  return holdings;
}

// One mirror walk of every token this account holds. Pages share the 20/s cap.
// force skips a fresh cache row so the open wallet can be read again.
export function fetchAccountTokens(accountId, force = false) {
  if (!force) {
    const fresh = readFresh(accountId);
    if (fresh) return Promise.resolve(fresh);
  }
  const existing = inflight.get(accountId);
  if (existing) return existing;
  const job = runSerial(() => loadTokens(accountId)).finally(() => {
    inflight.delete(accountId);
  });
  inflight.set(accountId, job);
  return job;
}
