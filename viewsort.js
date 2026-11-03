// Viewed-sort count fetches. The on-screen chip getter stays on
// GET /api/views (50 ids). A ranked window is SORT_PAGE_CAP pages of PAGE
// posts (4 * 2030). At 50 ids that is more than PUBLIC_POST_RATE_LIMIT
// requests a minute, so the sort uses POST /api/views/counts instead.
// 400 ids keeps a worst-case 200-character key under the 100kb JSON cap,
// and the whole window is 21 requests, under the 60/min default.

export const VIEW_SORT_BATCH = 400;
export const VIEW_SORT_LIMIT = 60;
export const VIEW_SORT_WINDOW = 4 * 2030;
const RETRY_FALLBACK_MS = 1000;

export function viewCountBatches(ids, batchSize = VIEW_SORT_BATCH) {
  const size = batchSize > 0 ? Math.floor(batchSize) : VIEW_SORT_BATCH;
  const out = [];
  const seen = new Set();
  let batch = [];
  const list = Array.isArray(ids) ? ids : [];
  for (const id of list) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    batch.push(id);
    if (batch.length === size) {
      out.push(batch);
      batch = [];
    }
  }
  if (batch.length) out.push(batch);
  return out;
}

// Retry-After is delta-seconds or an HTTP date. A missing or junk value
// waits the fallback so a 429 is retried instead of dropped.
export function retryAfterMs(header, now = Date.now()) {
  if (header == null) return RETRY_FALLBACK_MS;
  const text = String(header).trim();
  if (!text) return RETRY_FALLBACK_MS;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const when = Date.parse(text);
  if (Number.isFinite(when)) return Math.max(0, when - now);
  return RETRY_FALLBACK_MS;
}

// The feed treats scrollTop under 2 as the top. A re-sort below that
// would pull the list out from under the reader.
export function keepScroll(scrollTop) {
  return Number(scrollTop) >= 2;
}

// A ranked window is ready once the topic is exhausted, the date floor is
// reached, or the page cap has been pulled. Until then the spinner stays
// up and nothing is painted, so paging cannot jump the scroll.
export function rankedWindowReady(pages, cap, exhausted, floor) {
  if (exhausted || floor) return true;
  const limit = cap > 0 ? cap : 0;
  return pages >= limit;
}

// Cards already on screen keep their scroll position. An empty column is
// the first paint and starts at the top.
export function rankedPaintHold(hasCards, scrollTop) {
  return !!hasCards && keepScroll(scrollTop);
}
