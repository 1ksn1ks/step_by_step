// One feed query. The feed paints from this; nothing here touches the DOM.
// textOf matches feedlayout.js so a search does not import the feed.

const state = { text: '', filters: {}, sort: 'newest' };
const fns = new Map();
const sorts = new Map();
const listeners = new Set();

function textOf(msg) {
  if (Array.isArray(msg)) return msg[0] == null ? '' : String(msg[0]);
  return msg == null ? '' : String(msg);
}

function snapshot() {
  return { text: state.text, filters: { ...state.filters }, sort: state.sort };
}

function emit() {
  const query = snapshot();
  for (const fn of listeners) fn(query);
  const host = typeof globalThis.window !== 'undefined' ? globalThis.window : null;
  if (!host || typeof host.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
  host.dispatchEvent(new CustomEvent('feed-search', { detail: query }));
}

export function getQuery() {
  return snapshot();
}

export function setText(text) {
  const next = text == null ? '' : String(text);
  if (next === state.text) return;
  state.text = next;
  emit();
}

// '', null, undefined, and false drop the key so getQuery().filters stays clean.
export function setFilter(key, value) {
  const drop = value == null || value === '' || value === false;
  if (drop) {
    if (!Object.prototype.hasOwnProperty.call(state.filters, key)) return;
    delete state.filters[key];
    emit();
    return;
  }
  if (state.filters[key] === value) return;
  state.filters[key] = value;
  emit();
}

// '' and null return to newest. newest is the default and is not an active filter.
export function setSort(key) {
  const next = key == null || key === '' ? 'newest' : String(key);
  if (next === state.sort) return;
  state.sort = next;
  emit();
}

export function registerSort(key, cmp) {
  if (typeof cmp === 'function') sorts.set(key, cmp);
  else sorts.delete(key);
}

// Null for newest, an unknown key, or a dropped comparator. Sort is not a
// predicate: matches() stays false when text and filters are both empty.
export function sortCmp() {
  if (state.sort === 'newest') return null;
  const cmp = sorts.get(state.sort);
  return typeof cmp === 'function' ? cmp : null;
}

export function clearQuery() {
  if (state.text === '' && Object.keys(state.filters).length === 0 && state.sort === 'newest') return;
  state.text = '';
  state.filters = {};
  state.sort = 'newest';
  emit();
}

export function registerFilter(key, fn) {
  if (typeof fn === 'function') fns.set(key, fn);
  else fns.delete(key);
}

function activeFilters() {
  const out = [];
  for (const key of Object.keys(state.filters)) {
    const value = state.filters[key];
    if (value == null || value === '' || value === false) continue;
    const fn = fns.get(key);
    if (typeof fn !== 'function') continue;
    out.push([fn, value]);
  }
  return out;
}

export function matches(post, record) {
  if (!post) return false;
  const needle = state.text.trim().toLowerCase();
  const rec = record || {};
  if (needle) {
    const parts = [textOf(rec.msg), rec.title, rec.username, rec.payer, rec.payerInfo, post.payer];
    let hit = false;
    for (const part of parts) {
      if (part != null && String(part).toLowerCase().includes(needle)) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  const filters = activeFilters();
  if (!needle && !filters.length) return false;
  for (const [fn, value] of filters) {
    if (!fn(post, rec, value)) return false;
  }
  return true;
}

export function onChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}
