// markerstack.js — topic markers that sit on one spot of the map.
//
// Dots that cover each other cannot be told apart by tapping (only the top
// one gets the tap) or, past the cluster zoom, by zooming. marker.js draws
// them as one bubble with their count, like a cluster; a tap on it opens
// this dropdown next to the bubble: a search box and one row per post (its
// picture, title, who and when, a line of its text), newest first.
// Picking a row opens that post's own popup. Escape, a tap anywhere else,
// moving the map and Back close it.
import { map } from './map';
import { forgetLoop, pictureElement } from './loopmedia.js';

let panel = null;
let countEl = null;
let input = null;
let list = null;
let empty = null;
let current = null; // { anchor, rows: [{ feature, el, hay }], onPick }
let layerDefined = false;

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
    if (next < 0) input.focus();
    else if (rows[next]) rows[next].el.focus();
  });

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
  return current ? current.rows.filter((row) => !row.el.hidden) : [];
}

function filterRows() {
  if (!current) return;
  const words = fold(input.value).split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const row of current.rows) {
    const hit = words.every((word) => row.hay.includes(word));
    row.el.hidden = !hit;
    if (hit) shown++;
  }
  empty.hidden = shown > 0;
  countEl.textContent = words.length
    ? `${shown} of ${current.rows.length} posts`
    : `${current.rows.length} posts here`;
}

function buildRow(feature) {
  const record = recordOf(feature);
  const props = feature.properties || {};
  const title = plainText(record.title) || plainText(props.title) || 'Untitled post';
  const payer = record.payer || feature.payer || '';
  const name = plainText(record.username);
  const who = name && name !== payer ? name : payer;
  const when = plainText(record.timestamp);
  const text = plainText(record.msg);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'marker-stack-row';
  row.setAttribute('role', 'option');

  const url = (Array.isArray(props.imageUrl) ? props.imageUrl[0] : props.imageUrl) || record.profileUrl || '';
  const pic = url ? pictureElement(url, { className: 'marker-stack-pic', alt: '' }) : document.createElement('span');
  if (!url) pic.className = 'marker-stack-pic';
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
  return { feature, el: row, hay: fold([title, who, payer, when, text, record.loadedTopicName].join(' ')) };
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
  dropRows();
  const sorted = [...features].sort((a, b) => createdMs(b) - createdMs(a));
  const rows = sorted.map(buildRow);
  for (const row of rows) list.appendChild(row.el);
  current = { anchor, rows, onPick };
  input.value = '';
  filterRows();
  list.scrollTop = 0;
  panel.hidden = false;
  place(anchor);
  // A phone keeps its keyboard down until the search is tapped.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus({ preventScroll: true });
  if (!wasOpen && window.layerOpened) window.layerOpened('markerstack');
}

function dropRows() {
  if (!list) return;
  for (const video of list.querySelectorAll('video')) forgetLoop(video);
  list.replaceChildren();
}

export function closeMarkerStack({ fromHistory = false } = {}) {
  if (!current) return;
  current = null;
  if (panel) panel.hidden = true;
  dropRows();
  if (!fromHistory && window.layerClosedByUI) window.layerClosedByUI('markerstack');
}
