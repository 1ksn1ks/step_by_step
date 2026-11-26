// Author-picked NFT collections that pin a holder's comments.
// No DOM. The comments stay on chain; this only decides display order.
import { isHederaTokenId } from './loadcurrenttopic.js';
import { retryAfterMs } from './viewsort.js';
import {
  acquireMirror,
  holdKey,
  holdsFromMirrorBody,
  mirrorHoldUrl,
  mirrorTokenUrl,
  pauseMirror,
  releaseMirror,
  retryAfterHeader,
  tokenIsUniqueNft,
} from './coverautoplay.js';

export const COMMENT_PIN_MAX = 5;

// A holder answer is reused for this long. Separate from the cover autoplay cache.
export const HOLDER_MS = 5 * 60 * 1000;

// A failed holder read stores nothing, and is not tried again until this passes.
export const HOLDER_RETRY_MS = 30 * 1000;

const NAME_MS = 60 * 60 * 1000;
const NAME_CLIP = 40;
const HOLDER_429_TRIES = 4;
const TOKEN_READS = 3;

const pinByCreated = new Map();
const pinByStamp = new Map();
const holderCache = new Map();
const holderMissAt = new Map();
const holderFlight = new Map();
const nameCache = new Map();
const nameFlight = new Map();

let clock = () => Date.now();
let fetchImpl = (...args) => globalThis.fetch(...args);

export function setCommentPinIO({ fetch, now } = {}) {
  if (typeof fetch === 'function') fetchImpl = fetch;
  if (typeof now === 'function') clock = now;
}

export function clearCommentPinState() {
  pinByCreated.clear();
  pinByStamp.clear();
  holderCache.clear();
  holderMissAt.clear();
  holderFlight.clear();
  nameCache.clear();
  nameFlight.clear();
  clock = () => Date.now();
  fetchImpl = (...args) => globalThis.fetch(...args);
}

function isoTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function cleanId(value) {
  const id = String(value || '').trim();
  return isHederaTokenId(id) ? id : '';
}

// { tokens }, the legacy { token }, or a plain array. Anything else is no pin.
export function normalizePins(value) {
  let list = null;
  if (Array.isArray(value)) list = value;
  else if (value && typeof value === 'object') {
    if (Array.isArray(value.tokens)) list = value.tokens;
    else if (typeof value.token === 'string') list = [value.token];
    else return [];
  } else return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = cleanId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= COMMENT_PIN_MAX) break;
  }
  return out;
}

// null when the edit's commentPin is not a pin shape. [] is a real clear.
function acceptedPin(value) {
  if (Array.isArray(value)) return normalizePins(value);
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'tokens')) {
    if (!Array.isArray(value.tokens)) return null;
    return normalizePins(value);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'token')) {
    if (typeof value.token !== 'string') return null;
    return normalizePins(value);
  }
  return null;
}

export function parsePinInput(text) {
  const parts = String(text || '').split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  const tokens = [];
  const invalid = [];
  const seen = new Set();
  for (const part of parts) {
    const id = cleanId(part);
    if (!id) {
      invalid.push(part);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    if (tokens.length < COMMENT_PIN_MAX) tokens.push(id);
  }
  return { tokens, invalid, tooMany: seen.size > COMMENT_PIN_MAX };
}

function mappedName(names, token) {
  if (!names) return '';
  if (typeof names.get === 'function') return names.get(token) || '';
  return names[token] || '';
}

function pinLabel(token, names) {
  const named = String(mappedName(names, token) || '').trim();
  const text = named || token;
  return text.length > NAME_CLIP ? text.slice(0, NAME_CLIP) : text;
}

export function commentPinText(tokens, names) {
  const list = Array.isArray(tokens) ? tokens.filter(Boolean) : [];
  if (!list.length) return '';
  return `Holders of ${list.map((token) => pinLabel(token, names)).join(', ')} shown first`;
}

// Top-level only. A new array; the input and each node's replies stay put.
export function pinTopLevel(nodes, isPinned) {
  const list = Array.isArray(nodes) ? nodes : [];
  const ask = typeof isPinned === 'function' ? isPinned : () => undefined;
  const pinned = [];
  const rest = [];
  for (const node of list) {
    if (ask(node && node.payer) === true) pinned.push(node);
    else rest.push(node);
  }
  if (!pinned.length) return list.slice();
  return pinned.concat(rest);
}

export function commentPinPayers(nodes, limit = 100) {
  const cap = limit > 0 ? limit : 0;
  const rows = (Array.isArray(nodes) ? nodes : []).filter((node) => node && node.payer);
  const sorted = rows.slice().sort((a, b) => {
    if (a.created === b.created) return 0;
    return a.created < b.created ? 1 : -1;
  });
  const out = [];
  const seen = new Set();
  for (const node of sorted) {
    const payer = String(node.payer);
    if (seen.has(payer)) continue;
    seen.add(payer);
    out.push(payer);
    if (out.length >= cap) break;
  }
  return out;
}

// Newest pin edit from the original payer. An empty list is a clear.
// Same created + stamp keys as a shape edit. An older message loses.
export function rememberCommentPin(payer, data, envelope) {
  if (!payer || !data || !Object.prototype.hasOwnProperty.call(data, 'commentPin')) return null;
  const created = isoTime(data.editMarkerCreated || data.editPolygonCreated);
  const stampRaw = data.editMarkerTimestamp != null ? data.editMarkerTimestamp : data.editPolygonTimestamp;
  const stamp = stampRaw != null && String(stampRaw).trim() !== '' ? String(stampRaw) : '';
  if (!created && !stamp) return null;
  const tokens = acceptedPin(data.commentPin);
  if (!tokens) return null;
  const at = isoTime(envelope) || '';
  if (created && at && at <= created) return null;
  const slots = [];
  if (created) slots.push([pinByCreated, `${payer}|${created}`]);
  if (stamp) slots.push([pinByStamp, `${payer}|${stamp}`]);
  let newestAt = '';
  for (const [map, key] of slots) {
    const prev = map.get(key);
    if (prev && prev.at && (!newestAt || prev.at > newestAt)) newestAt = prev.at;
  }
  if (newestAt && at && at < newestAt) return null;
  const entry = { tokens: tokens.slice(), at };
  for (const [map, key] of slots) map.set(key, entry);
  return entry;
}

export function commentPinFor(payer, created, stamp, base) {
  if (payer) {
    const iso = isoTime(created);
    let hit = null;
    if (iso) hit = pinByCreated.get(`${payer}|${iso}`) || null;
    if (!hit && stamp != null && String(stamp).trim() !== '') {
      hit = pinByStamp.get(`${payer}|${String(stamp)}`) || null;
    }
    if (hit) return hit.tokens.slice();
  }
  return normalizePins(base);
}

export function cachedHolder(account, token, now = clock()) {
  const key = holdKey(account, token);
  const row = holderCache.get(key);
  if (!row) return undefined;
  if (now - row.at >= HOLDER_MS) {
    holderCache.delete(key);
    return undefined;
  }
  return row.holds === true;
}

function holderGated(account, token, now) {
  const key = holdKey(account, token);
  const at = holderMissAt.get(key);
  if (at == null) return false;
  if (now - at >= HOLDER_RETRY_MS) {
    holderMissAt.delete(key);
    return false;
  }
  return true;
}

function noteHolderMiss(account, token, now) {
  holderMissAt.set(holdKey(account, token), now);
}

export function cachedPinned(account, tokens, now = clock()) {
  const list = Array.isArray(tokens) ? tokens : [];
  if (!list.length) return undefined;
  let allFalse = true;
  for (const token of list) {
    const hit = cachedHolder(account, token, now);
    if (hit === true) return true;
    if (hit !== false) allFalse = false;
  }
  return allFalse ? false : undefined;
}

function readHolder(account, token, read, now) {
  const key = holdKey(account, token);
  const existing = holderFlight.get(key);
  if (existing) return existing;
  const job = (async () => {
    try {
      for (let attempt = 0; attempt < HOLDER_429_TRIES; attempt++) {
        const wait = acquireMirror();
        if (wait) await wait;
        try {
          const response = await read(mirrorHoldUrl(account, token));
          if (response && response.status === 429) {
            pauseMirror(retryAfterMs(retryAfterHeader(response)));
            continue;
          }
          if (!response || !response.ok) {
            noteHolderMiss(account, token, now);
            return false;
          }
          let body;
          try {
            body = await response.json();
          } catch {
            noteHolderMiss(account, token, now);
            return false;
          }
          holderCache.set(key, { holds: holdsFromMirrorBody(body) === true, at: now });
          holderMissAt.delete(key);
          return true;
        } catch {
          noteHolderMiss(account, token, now);
          return false;
        } finally {
          releaseMirror();
        }
      }
      noteHolderMiss(account, token, now);
      return false;
    } finally {
      holderFlight.delete(key);
    }
  })();
  holderFlight.set(key, job);
  return job;
}

// One account's tokens run in order, so a cached hold skips the rest.
// The batch resolves with whether any pair gained an answer.
export async function lookupHolders(accounts, tokens, read = fetchImpl, now = clock()) {
  const ids = [];
  const seenAccounts = new Set();
  for (const account of accounts || []) {
    const id = String(account || '').trim();
    if (!id || seenAccounts.has(id)) continue;
    seenAccounts.add(id);
    ids.push(id);
  }
  const nfts = [];
  const seenTokens = new Set();
  for (const token of tokens || []) {
    const id = cleanId(token);
    if (!id || seenTokens.has(id)) continue;
    seenTokens.add(id);
    nfts.push(id);
  }
  if (!ids.length || !nfts.length) return false;
  const box = { changed: false };
  await Promise.all(ids.map(async (account) => {
    for (const token of nfts) {
      const known = cachedHolder(account, token, now);
      if (known === true) return;
      if (known === false) continue;
      if (holderGated(account, token, now)) continue;
      const stored = await readHolder(account, token, read, now);
      if (stored) box.changed = true;
      if (cachedHolder(account, token, now) === true) return;
    }
  }));
  return box.changed;
}

function startNameLoad(id, read) {
  const existing = nameFlight.get(id);
  if (existing) return existing;
  const job = (async () => {
    try {
      const response = await read(mirrorTokenUrl(id));
      if (!response || !response.ok) return '';
      let info;
      try {
        info = await response.json();
      } catch {
        return '';
      }
      if (!info || typeof info !== 'object') return '';
      const name = typeof info.name === 'string' ? info.name : '';
      nameCache.set(id, { name, at: clock() });
      return name;
    } catch {
      return '';
    } finally {
      nameFlight.delete(id);
    }
  })();
  nameFlight.set(id, job);
  return job;
}

export function collectionName(token) {
  const id = cleanId(token);
  if (!id) return '';
  const now = clock();
  const row = nameCache.get(id);
  if (row && now - row.at < NAME_MS) return row.name;
  if (row) nameCache.delete(id);
  startNameLoad(id, fetchImpl);
  return '';
}

export function whenCollectionName(token) {
  const id = cleanId(token);
  if (!id) return Promise.resolve('');
  const now = clock();
  const row = nameCache.get(id);
  if (row && now - row.at < NAME_MS) return Promise.resolve(row.name);
  return startNameLoad(id, fetchImpl);
}

export function collectionNames(tokens) {
  const map = {};
  for (const token of tokens || []) {
    const id = cleanId(token);
    if (!id) continue;
    map[id] = collectionName(id);
  }
  return map;
}

export async function validatePinToken(token, read = fetchImpl) {
  const id = cleanId(token);
  if (!id) return { ok: false, reason: 'Could not check the collection' };
  try {
    const response = await read(mirrorTokenUrl(id));
    if (!response || !response.ok) return { ok: false, reason: 'Could not check the collection' };
    let info;
    try {
      info = await response.json();
    } catch {
      return { ok: false, reason: 'Could not check the collection' };
    }
    if (!tokenIsUniqueNft(info)) return { ok: false, reason: 'Not an NFT collection' };
    const name = info && typeof info.name === 'string' ? info.name : '';
    if (name) nameCache.set(id, { name, at: clock() });
    return { ok: true, name };
  } catch {
    return { ok: false, reason: 'Could not check the collection' };
  }
}

export async function validatePinTokens(tokens, read = fetchImpl) {
  const list = [];
  const seen = new Set();
  for (const token of tokens || []) {
    const id = cleanId(token);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push(id);
    if (list.length >= COMMENT_PIN_MAX) break;
  }
  const results = new Array(list.length);
  let next = 0;
  let stop = false;
  const workers = Math.min(TOKEN_READS, list.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (!stop) {
      const index = next;
      next += 1;
      if (index >= list.length) return;
      const result = await validatePinToken(list[index], read);
      results[index] = result;
      if (!result.ok) stop = true;
    }
  }));
  for (let index = 0; index < list.length; index++) {
    const result = results[index];
    if (result && !result.ok) return { ok: false, token: list[index], reason: result.reason };
  }
  return { ok: true };
}
