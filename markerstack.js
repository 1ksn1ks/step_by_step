// markerstack.js — the list of posts in a marker bubble.
//
// marker.js decides when it opens (see its bubble rule): holding or
// right-clicking any bubble, or tapping a bubble whose dots sit on one
// spot once the map is at street level (a tap on any other bubble zooms
// in to pull its dots apart). The list is a dropdown next to the bubble:
// a search box and one row per post (its picture, title, who and when, a
// line of its text), newest first. Picking a row opens that post's own
// popup. Escape, a tap anywhere else, moving the map and Back close it.
//
// A cluster held from far out can hold thousands of posts, and each row
// reads the post's record (popupData, built on demand) and makes a
// picture. So rows are made a page at a time as the list scrolls, and a
// search reads the records a few milliseconds per frame, showing matches
// as they are found.
import { map } from './map';
import { forgetLoop, pictureElement } from './loopmedia.js';

let panel = null;
let countEl = null;
let input = null;
let list = null;
let empty = null;
// { anchor, onPick, features (newest first), matches, rendered (rows in
//   the list, in order), limit, rowCache (feature -> row), words, searching }
let current = null;
let layerDefined = false;
let searchRun = 0;

const PAGE = 30; // rows made at a time
const MORE_PX = 240; // the next page is made this near the end of the list
const SEARCH_SLICE_MS = 8; // search work per frame
const described = new WeakMap(); // feature -> what its row shows and is searched by

// The record the post's popup is built from (popupData is lazy).
function recordOf(feature) {
  const props = (feature && feature.properties) || {};
  if (props._stackRecord) return props._stackRecord;
  let record = props._shareRecord || null;
  if (!record) {
    const data = props.popupData;
    try {
      record = typeof data === 'function' ? data() : data;
    } catch {
      record = null;
    }
  }
  props._stackRecord = record || {};
  return props._stackRecord;
}

function plainText(value) {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

function fold(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// What a row shows and the text a search matches, read once per post.
function describe(feature) {
  let info = described.get(feature);
  if (info) return info;
  const record = recordOf(feature);
  const props = feature.properties || {};
  const title = plainText(record.title) || plainText(props.title) || 'Untitled post';
  const payer = record.payer || feature.payer || '';
  const name = plainText(record.username);
  const who = name && name !== payer ? name : payer;
  const when = plainText(record.timestamp);
  const text = plainText(record.msg);
  info = {
    record,
    title,
    who,
    when,
    text,
    hay: fold([title, who, payer, when, text, record.loadedTopicName].join(' ')),
  };
  described.set(feature, info);
  return info;
}

function createdMs(feature) {
  const raw = feature && (feature.created || (feature.properties && feature.properties.created));
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function ensureLayer() {
  if (layerDefined || !window.defineLayer) return;
  layerDefined = true;
  // Forward cannot bring a closed list back (its bubble may be gone), so
  // only Back closes it.
  window.defineLayer('markerstack', {
    open: () => {},
    close: () => closeMarkerStack({ fromHistory: true }),
  });
}

function buildPanel() {
  panel = document.createElement('div');
  panel.className = 'marker-stack';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Posts on this spot');

  const head = document.createElement('div');
  head.className = 'marker-stack-head';
  countEl = document.createElement('div');
  countEl.className = 'marker-stack-count';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'marker-stack-close';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  close.addEventListener('click', () => closeMarkerStack());
  head.append(countEl, close);

  const search = document.createElement('label');
  search.className = 'marker-stack-search';
  input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search posts here';
  input.setAttribute('aria-label', 'Search posts on this spot');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => filterRows());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const first = visibleRows()[0];
      if (first) first.el.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const first = visibleRows()[0];
      if (first) pick(first.feature);
    }
  });
  search.appendChild(input);

  list = document.createElement('div');
  list.className = 'marker-stack-list';
  list.setAttribute('role', 'listbox');
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = visibleRows();
    const at = rows.findIndex((row) => row.el === document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
    if (next >= rows.length) showMore(); // adds to the same rows array
    if (next < 0) input.focus();
    else if (rows[next]) rows[next].el.focus();
  });
  list.addEventListener('scroll', () => {
    if (current && nearEnd()) showMore();
  }, { passive: true });

  empty = document.createElement('div');
  empty.className = 'marker-stack-empty';
  empty.textContent = 'No posts match';
  empty.hidden = true;

  panel.append(head, search, list, empty);
  // The document click closes panels (CloseALL); this list keeps its own.
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMarkerStack();
    }
  });
  document.body.appendChild(panel);

  // A tap anywhere else, or the map moving, closes it.
  document.addEventListener('pointerdown', (event) => {
    if (!current || panel.hidden) return;
    if (panel.contains(event.target)) return;
    if (current.anchor && current.anchor.contains(event.target)) return;
    closeMarkerStack();
  }, true);
  map.on('movestart', () => {
    if (current) closeMarkerStack();
  });
  window.addEventListener('resize', () => {
    if (current) closeMarkerStack();
  });
}

function visibleRows() {
  return current ? current.rendered : [];
}

function nearEnd() {
  return list.scrollHeight - list.scrollTop - list.clientHeight < MORE_PX;
}

function rowFor(feature) {
  let row = current.rowCache.get(feature);
  if (!row) {
    row = buildRow(feature);
    current.rowCache.set(feature, row);
  }
  return row;
}

// Adds rows for the matches up to the limit.
function fillRows() {
  if (!current) return;
  const end = Math.min(current.limit, current.matches.length);
  if (current.rendered.length >= end) return;
  const batch = document.createDocumentFragment();
  for (let i = current.rendered.length; i < end; i++) {
    const row = rowFor(current.matches[i]);
    current.rendered.push(row);
    batch.appendChild(row.el);
  }
  list.appendChild(batch);
}

// The next page, when there are more matches than rows. false when none.
function showMore() {
  if (!current || current.rendered.length >= current.matches.length) return false;
  current.limit = current.rendered.length + PAGE;
  fillRows();
  return true;
}

function paintCount() {
  const total = current.features.length;
  const searching = current.words.length > 0;
  empty.hidden = !searching || current.searching || current.matches.length > 0;
  countEl.textContent = searching
    ? `${current.matches.length} of ${total} posts${current.searching ? '…' : ''}`
    : `${total} posts here`;
}

// No words: every post, newest first. Words: the posts whose text has all
// of them, read a slice per frame. A new keystroke starts over; records
// already read are kept, so it is quicker each time.
function filterRows() {
  if (!current) return;
  const run = ++searchRun;
  const words = fold(input.value).split(/\s+/).filter(Boolean);
  current.words = words;
  current.rendered = [];
  current.limit = PAGE;
  list.replaceChildren();
  list.scrollTop = 0;
  if (!words.length) {
    current.matches = current.features;
    current.searching = false;
    fillRows();
    paintCount();
    return;
  }
  const features = current.features;
  const matches = [];
  current.matches = matches;
  current.searching = true;
  let at = 0;
  const step = () => {
    if (run !== searchRun || !current) return;
    const until = performance.now() + SEARCH_SLICE_MS;
    while (at < features.length) {
      const feature = features[at++];
      const { hay } = describe(feature);
      if (words.every((word) => hay.includes(word))) matches.push(feature);
      if (performance.now() >= until) break;
    }
    current.searching = at < features.length;
    fillRows();
    // Scrolled to the end while matches still arrive: no scroll event follows.
    if (current.searching && current.rendered.length >= current.limit && nearEnd()) showMore();
    paintCount();
    if (current.searching) requestAnimationFrame(step);
  };
  step();
}

function buildRow(feature) {
  const { record, title, who, when, text } = describe(feature);
  const props = feature.properties || {};

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'marker-stack-row';
  row.setAttribute('role', 'option');

  const url = (Array.isArray(props.imageUrl) ? props.imageUrl[0] : props.imageUrl) || record.profileUrl || '';
  const pic = url ? pictureElement(url, { className: 'marker-stack-pic', alt: '' }) : document.createElement('span');
  if (!url) pic.className = 'marker-stack-pic';
  // A held cluster can list many posts: pictures load as rows scroll in.
  if (pic.tagName === 'IMG') pic.loading = 'lazy';
  pic.setAttribute('aria-hidden', 'true');

  const body = document.createElement('span');
  body.className = 'marker-stack-body';
  const titleEl = document.createElement('span');
  titleEl.className = 'marker-stack-title';
  titleEl.textContent = title;
  const meta = document.createElement('span');
  meta.className = 'marker-stack-meta';
  meta.textContent = [who, when].filter(Boolean).join(' · ');
  body.append(titleEl, meta);
  if (text && text !== title) {
    const line = document.createElement('span');
    line.className = 'marker-stack-text';
    line.textContent = text;
    body.appendChild(line);
  }
  row.append(pic, body);
  row.addEventListener('click', () => pick(feature));
  return { feature, el: row };
}

function place(anchor) {
  const vw = window.innerWidth;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const r = anchor.getBoundingClientRect();
  const gap = 10;
  const edge = 12;
  const width = Math.min(340, vw - edge * 2);
  const cx = r.left + r.width / 2;
  const left = Math.min(Math.max(cx - width / 2, edge), vw - width - edge);
  const below = vh - r.bottom - gap - edge;
  const above = r.top - gap - edge;
  const down = below >= 260 || below >= above;
  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.maxHeight = `${Math.max(160, Math.min(down ? below : above, vh * 0.62))}px`;
  if (down) {
    panel.style.top = `${r.bottom + gap}px`;
    panel.style.bottom = 'auto';
  } else {
    panel.style.top = 'auto';
    panel.style.bottom = `${window.innerHeight - r.top + gap}px`;
  }
  panel.classList.toggle('is-above', !down);
}

function pick(feature) {
  const onPick = current && current.onPick;
  closeMarkerStack();
  if (typeof onPick === 'function') onPick(feature);
}

export function isMarkerStackOpenFor(anchor) {
  return !!(current && current.anchor === anchor && panel && !panel.hidden);
}

// anchor: the bubble element. features: the posts on the spot.
// onPick(feature) opens the chosen post.
export function openMarkerStack(anchor, features, onPick) {
  if (!anchor || !Array.isArray(features) || features.length === 0) return;
  if (!panel) buildPanel();
  ensureLayer();
  const wasOpen = !!current;
  dropRows(current);
  // Each date is read once, not on every comparison.
  const sorted = features
    .map((feature) => [createdMs(feature), feature])
    .sort((a, b) => b[0] - a[0])
    .map((pair) => pair[1]);
  current = {
    anchor,
    onPick,
    features: sorted,
    matches: sorted,
    rendered: [],
    limit: PAGE,
    rowCache: new Map(),
    words: [],
    searching: false,
  };
  input.value = '';
  filterRows();
  list.scrollTop = 0;
  panel.hidden = false;
  place(anchor);
  // A phone keeps its keyboard down until the search is tapped.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus({ preventScroll: true });
  if (!wasOpen && window.layerOpened) window.layerOpened('markerstack');
}

// Rows a search took out of the list are still kept, so every row made
// for this list lets go of its video.
function dropRows(state) {
  if (!list) return;
  if (state) {
    for (const row of state.rowCache.values()) {
      for (const video of row.el.querySelectorAll('video')) forgetLoop(video);
    }
  }
  list.replaceChildren();
}

export function closeMarkerStack({ fromHistory = false } = {}) {
  if (!current) return;
  const was = current;
  current = null;
  searchRun++;
  if (panel) panel.hidden = true;
  dropRows(was);
  if (!fromHistory && window.layerClosedByUI) window.layerClosedByUI('markerstack');
}
