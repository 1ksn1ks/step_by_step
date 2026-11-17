// timefilter.js — All / Today / This week / This month, for the feed and
// the map of an open topic.
//
// A range is [from, to) in ms, in the person's local time: today starts at
// local midnight, a week on Monday, a month on the 1st. Posts are matched by
// their message's consensus timestamp. The choice is remembered per topic
// on this device and the feed and the map share it.
//
// No DOM here (timefilterui.js draws the chip). The feed reads with the
// mirror's timestamp=gte: from consensusFrom(range); both views skip a
// stacked topic whose newest message is older than the range (isStale).

export const TIME_FILTERS = Object.freeze([
  { key: 'all', label: 'All', short: 'All' },
  { key: 'today', label: 'Today', short: 'Today' },
  { key: 'week', label: 'This week', short: 'Week' },
  { key: 'month', label: 'This month', short: 'Month' },
]);

const KEYS = new Set(TIME_FILTERS.map((f) => f.key));
const STORE = 'time-filter-v1';
const STORE_MAX = 100;

export function isTimeFilter(key) {
  return KEYS.has(key);
}

export function filterLabel(key, short = false) {
  const hit = TIME_FILTERS.find((f) => f.key === key) || TIME_FILTERS[0];
  return short ? hit.short : hit.label;
}

// [from, to) for a filter at `now`, or null for All. Local calendar
// arithmetic (new Date(y, m, d)), so a day that is 23 or 25 hours long
// around a clock change still ends at the next local midnight.
export function timeRange(key, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (key === 'today') return { from: new Date(y, m, d).getTime(), to: new Date(y, m, d + 1).getTime() };
  if (key === 'week') {
    const sinceMonday = (now.getDay() + 6) % 7;
    return { from: new Date(y, m, d - sinceMonday).getTime(), to: new Date(y, m, d - sinceMonday + 7).getTime() };
  }
  if (key === 'month') return { from: new Date(y, m, 1).getTime(), to: new Date(y, m + 1, 1).getTime() };
  return null;
}

// A consensus timestamp ("seconds.nanos") for ms, as the mirror takes it.
export function consensusAt(ms) {
  return `${Math.floor(ms / 1000)}.${String((ms % 1000) * 1e6).padStart(9, '0')}`;
}

export function consensusFrom(range) {
  return range ? consensusAt(range.from) : '';
}

// ms for a consensus timestamp, an ISO date, a Date or ms; NaN otherwise.
export function timeOf(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const text = String(value == null ? '' : value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const [s, n = '0'] = text.split('.');
    return Number(s) * 1000 + Math.floor(Number(n.padEnd(9, '0').slice(0, 9)) / 1e6);
  }
  return text ? new Date(text).getTime() : NaN;
}

// No range (All) lets everything in; an unreadable time is let in too, so
// a post never disappears because its time could not be read.
export function inTimeRange(value, range) {
  if (!range) return true;
  const ms = timeOf(value);
  if (!Number.isFinite(ms)) return true;
  return ms >= range.from && ms < range.to;
}

// A topic whose newest message is older than the range has nothing in it.
// An unknown newest time is not stale: that topic is read.
export function isStale(latest, range) {
  if (!range) return false;
  const ms = timeOf(latest);
  return Number.isFinite(ms) && ms < range.from;
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readAll(storage) {
  try {
    const parsed = JSON.parse((storage && storage.getItem(STORE)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// This visit's choices, per store: a store that refuses writes (private
// mode) still keeps the choice until the page closes.
const noStore = new Map();
const visits = new WeakMap();

function visitFor(storage) {
  if (!storage) return noStore;
  if (!visits.has(storage)) visits.set(storage, new Map());
  return visits.get(storage);
}

// The filter remembered for a topic, 'all' when none.
export function timeFilterFor(topicId, storage = defaultStorage()) {
  const topic = String(topicId || '');
  const visit = visitFor(storage);
  if (visit.has(topic)) return visit.get(topic);
  const row = readAll(storage)[topic];
  return row && isTimeFilter(row.key) ? row.key : 'all';
}

const listeners = new Set();

export function onTimeFilter(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Remembers a topic's filter (newest STORE_MAX topics) and tells the feed
// and the map. 'all' is stored by forgetting the topic.
export function setTimeFilterFor(topicId, key, storage = defaultStorage()) {
  const topic = String(topicId || '');
  if (!topic || !isTimeFilter(key)) return;
  const before = timeFilterFor(topic, storage);
  visitFor(storage).set(topic, key);
  const all = readAll(storage);
  delete all[topic];
  if (key !== 'all') all[topic] = { key, at: Date.now() };
  const rows = Object.entries(all).sort((a, b) => (Number(b[1].at) || 0) - (Number(a[1].at) || 0));
  const kept = Object.fromEntries(rows.slice(0, STORE_MAX));
  try {
    if (storage) storage.setItem(STORE, JSON.stringify(kept));
  } catch {
    /* private mode: the choice holds until the page closes */
  }
  if (before === key) return;
  for (const fn of listeners) {
    try {
      fn({ topic, key });
    } catch (error) {
      console.warn('time filter listener failed', error);
    }
  }
}
