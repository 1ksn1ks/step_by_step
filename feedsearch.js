// One feed query. The feed paints from this; nothing here touches the DOM.
// textOf matches feedlayout.js so a search does not import the feed.

const state = { text: '', filters: {} };
const fns = new Map();
const listeners = new Set();

function textOf(msg) {
  if (Array.isArray(msg)) return msg[0] == null ? '' : String(msg[0]);
  return msg == null ? '' : String(msg);
}

function snapshot() {
  return { text: state.text, filters: { ...state.filters } };
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

export function clearQuery() {
  if (state.text === '' && Object.keys(state.filters).length === 0) return;
  state.text = '';
  state.filters = {};
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
