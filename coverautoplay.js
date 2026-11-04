// Whether a polygon cover video may start by itself. No DOM.
// Save-Data, a low battery, and reduced motion always refuse.
// The topic rule is the admin's autoplayNft plus a cached hold for the
// polygon creator. The viewer's wallet is not an input.
import { isHederaTokenId } from './loadcurrenttopic.js';
import { retryAfterMs } from './viewsort.js';

const MIRROR = 'https://mainnet.mirrornode.hedera.com';

export const COVER_RELEASE_MS = 3000;

// getBattery level at or below this, and not charging, counts as low.
export const COVER_LOW_BATTERY = 0.2;

// One creator+token answer is reused for this long.
export const AUTOPLAY_HOLD_MS = 10 * 60 * 1000;

// A failed mirror read waits this long before another try.
export const AUTOPLAY_HOLD_RETRY_MS = 60 * 1000;

const topicTokens = new Map();
const holds = new Map();
const inflight = new Map();

// The public mirror is shared with the rest of the app. Four hold reads
// run at once. A 429 waits out Retry-After, then that read is tried again
// instead of being stored as a miss. Four 429s in a row give up.
export const MIRROR_HOLD_LIMIT = 4;
const MIRROR_HOLD_429_TRIES = 4;

let mirrorActive = 0;
const mirrorWaiters = [];
let mirrorPauseUntil = 0;
let mirrorPauseTimer = 0;

export function clearAutoplayState() {
  topicTokens.clear();
  holds.clear();
  inflight.clear();
  mirrorActive = 0;
  mirrorWaiters.length = 0;
  mirrorPauseUntil = 0;
  if (mirrorPauseTimer) {
    clearTimeout(mirrorPauseTimer);
    mirrorPauseTimer = 0;
  }
}

export function rememberTopicAutoplay(topicId, tokenId) {
  const id = String(topicId || '').trim();
  if (!id) return;
  const token = String(tokenId || '').trim();
  topicTokens.set(id, isHederaTokenId(token) ? token : '');
}

export function topicAutoplayNft(topicId) {
  return topicTokens.get(String(topicId || '').trim()) || '';
}

export function holdKey(account, token) {
  return `${String(account || '').trim()}|${String(token || '').trim()}`;
}

export function cachedHold(account, token, now = Date.now()) {
  const key = holdKey(account, token);
  const row = holds.get(key);
  if (!row) return undefined;
  const ttl = row.failed ? AUTOPLAY_HOLD_RETRY_MS : AUTOPLAY_HOLD_MS;
  if (now - row.at >= ttl) {
    holds.delete(key);
    return undefined;
  }
  if (row.failed) return null;
  return row.holds === true;
}

export function rememberHold(account, token, holdsNft, now = Date.now()) {
  const id = String(account || '').trim();
  const nft = String(token || '').trim();
  if (!id || !nft) return;
  holds.set(holdKey(id, nft), { holds: holdsNft === true, at: now });
}

function rememberHoldFailure(account, token, now) {
  const id = String(account || '').trim();
  const nft = String(token || '').trim();
  if (!id || !nft) return;
  holds.set(holdKey(id, nft), { failed: true, at: now });
}

export function shouldAutoplayCover(polygon, viewer, now = Date.now()) {
  const view = viewer || {};
  if (view.saveData) return false;
  if (view.lowBattery) return false;
  if (view.reducedMotion) return false;
  // polygon.topicId is the topic the drawing was posted in. The three
  // loaders set it on every polygon they keep. No topic id, no autoplay.
  if (!polygon || !polygon.topicId) return false;
  const token = topicAutoplayNft(polygon.topicId);
  if (!token) return false;
  const account = String(polygon.payer || '').trim();
  if (!account) return false;
  return cachedHold(account, token, now) === true;
}

export function holdQueriesFor(polygons, now = Date.now()) {
  const seen = new Set();
  const queries = [];
  for (const polygon of polygons || []) {
    if (!polygon || !polygon.topicId) continue;
    const token = topicAutoplayNft(polygon.topicId);
    if (!token) continue;
    const account = String(polygon.payer || '').trim();
    if (!isHederaTokenId(account)) continue;
    if (cachedHold(account, token, now) !== undefined) continue;
    const key = holdKey(account, token);
    if (seen.has(key) || inflight.has(key)) continue;
    seen.add(key);
    queries.push({ account, token });
  }
  return queries;
}

export function mirrorHoldUrl(account, token) {
  return `${MIRROR}/api/v1/accounts/${account}/nfts?token.id=${token}&limit=1`;
}

export function mirrorTokenUrl(token) {
  return `${MIRROR}/api/v1/tokens/${token}`;
}

export function holdsFromMirrorBody(body) {
  return !!(body && Array.isArray(body.nfts) && body.nfts.length > 0);
}

export function tokenIsUniqueNft(info) {
  return !!info && info.deleted !== true && info.type === 'NON_FUNGIBLE_UNIQUE';
}

function retryAfterHeader(response) {
  const headers = response && response.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get('retry-after');
  return headers['retry-after'] ?? headers['Retry-After'] ?? null;
}

function armMirrorPause() {
  if (mirrorPauseTimer || !mirrorWaiters.length) return;
  const wait = mirrorPauseUntil - Date.now();
  if (wait <= 0) return;
  mirrorPauseTimer = setTimeout(() => {
    mirrorPauseTimer = 0;
    pumpMirror();
  }, wait);
}

// A free slot is taken now, so the fetch starts before lookupHolds yields.
// Anything past the limit, or inside a 429 pause, waits for pumpMirror.
function acquireMirror() {
  if (mirrorActive < MIRROR_HOLD_LIMIT && Date.now() >= mirrorPauseUntil) {
    mirrorActive += 1;
    return null;
  }
  return new Promise((resolve) => {
    mirrorWaiters.push(resolve);
    armMirrorPause();
  });
}

function pumpMirror() {
  if (mirrorPauseTimer) return;
  const wait = mirrorPauseUntil - Date.now();
  if (wait > 0) {
    armMirrorPause();
    return;
  }
  while (mirrorWaiters.length && mirrorActive < MIRROR_HOLD_LIMIT) {
    mirrorActive += 1;
    const resume = mirrorWaiters.shift();
    resume();
  }
}

function releaseMirror() {
  mirrorActive = Math.max(0, mirrorActive - 1);
  pumpMirror();
}

function pauseMirror(ms) {
  const until = Date.now() + Math.max(0, Number(ms) || 0);
  if (until > mirrorPauseUntil) mirrorPauseUntil = until;
}

function readMirrorHold(account, token, fetchImpl, now) {
  const key = holdKey(account, token);
  return (async () => {
    try {
      for (let attempt = 0; attempt < MIRROR_HOLD_429_TRIES; attempt++) {
        const wait = acquireMirror();
        if (wait) await wait;
        try {
          const response = await fetchImpl(mirrorHoldUrl(account, token));
          if (response && response.status === 429) {
            pauseMirror(retryAfterMs(retryAfterHeader(response)));
            continue;
          }
          if (!response || !response.ok) {
            rememberHoldFailure(account, token, now);
            return;
          }
          const body = await response.json();
          rememberHold(account, token, holdsFromMirrorBody(body), now);
          return;
        } catch {
          rememberHoldFailure(account, token, now);
          return;
        } finally {
          releaseMirror();
        }
      }
      rememberHoldFailure(account, token, now);
    } finally {
      inflight.delete(key);
    }
  })();
}

export async function lookupHolds(queries, fetchImpl = globalThis.fetch, now = Date.now()) {
  const jobs = [];
  for (const query of queries || []) {
    const account = String(query && query.account || '').trim();
    const token = String(query && query.token || '').trim();
    if (!account || !token) continue;
    const key = holdKey(account, token);
    if (inflight.has(key)) {
      jobs.push(inflight.get(key));
      continue;
    }
    const job = readMirrorHold(account, token, fetchImpl, now);
    inflight.set(key, job);
    jobs.push(job);
  }
  await Promise.all(jobs);
}

export async function readUniqueNft(tokenId, fetchImpl = globalThis.fetch) {
  const id = String(tokenId || '').trim();
  if (!isHederaTokenId(id)) return false;
  const response = await fetchImpl(mirrorTokenUrl(id));
  if (!response || !response.ok) return false;
  const info = await response.json();
  return tokenIsUniqueNft(info);
}

// The largest on-screen score wins. An equal score keeps the cover that
// is already playing. Zero and ineligible rows never win.
export function pickAutoplayCover(rows, currentId) {
  let best = null;
  let bestScore = 0;
  for (const row of rows || []) {
    if (!row || !row.eligible) continue;
    const score = Number(row.score);
    if (!(score > 0)) continue;
    const keepCurrent = score === bestScore && row.id === currentId && best !== currentId;
    if (score > bestScore || keepCurrent) {
      best = row.id;
      bestScore = score;
    }
  }
  return best;
}

export function coverScreenScore(box, canvas) {
  if (!box || !canvas) return 0;
  const width = Number(canvas.w);
  const height = Number(canvas.h);
  if (!(width > 0) || !(height > 0)) return 0;
  if (box.centerInside) return width * height;
  const x0 = Math.max(Number(box.minX), 0);
  const y0 = Math.max(Number(box.minY), 0);
  const x1 = Math.min(Number(box.maxX), width);
  const y1 = Math.min(Number(box.maxY), height);
  const boxW = x1 - x0;
  const boxH = y1 - y0;
  if (!(boxW > 0) || !(boxH > 0)) return 0;
  return boxW * boxH;
}

export function coverBatteryIsLow(battery) {
  if (!battery || typeof battery !== "object") return false;
  const level = Number(battery.level);
  if (!Number.isFinite(level)) return false;
  if (battery.charging) return false;
  return level <= COVER_LOW_BATTERY;
}

// True while the file should stay attached. Off screen, a hidden tab, the
// feed, or another cover taking the only play slot all let it go.
export function coverHoldSrc(state) {
  if (!state || !state.hasSrc) return false;
  if (state.replaced || state.hidden || state.feed || !state.inView) return false;
  return true;
}

export function coverShouldRelease(since, now) {
  if (since == null || now == null) return false;
  const start = Number(since);
  const at = Number(now);
  if (!Number.isFinite(start) || !Number.isFinite(at)) return false;
  return at - start >= COVER_RELEASE_MS;
}

// Every other cover gives its file back when this one starts. One plays.
export function coverIdsToRelease(ids, nextId) {
  if (!nextId || !Array.isArray(ids)) return [];
  return ids.filter((id) => id && id !== nextId);
}
