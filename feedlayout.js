// Optional feed column for the topic already loaded on the globe.
// Map mode is the default and does not push a history entry.

import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { currentUfoModelInGLTF } from './letall.js';
import { markerPopupNode, polygonPopupNode, mountPostReactions } from './processallmessages.js';
import { BACKEND_URL, fetchMessagesBackend, streamOnTopic, messageSig } from './msgbackend.js';
import { createChunkAssembler, ingestMirrorRows } from './hcschunks.js';
import { initialTopicId } from './extracttopic.js';
import { connectedAccount } from './web3.js';
import { activeMarkerPopups } from './marker.js';
import { activePolygonPopups } from './polygons.js';
import { animateMapTo, cancelAnimateMapTo } from './animatemapto.js';
import { MARKER_ZOOM } from './openplace.js';
import { ringCenter } from './polygonframe.js';
import { CloseALL, changePopupState } from './cssLogic.js';
import { closeDrawAnchor } from './drawhere.js';
import { closePressAnchor } from './poiinfo.js';
import { applyAllStyles } from './loadprofilepopup.js';
import { scene } from './threejs.js';
import { profilePictures, usernames, click2url } from './loadalladata.js';
import { payerUsernameNode } from './payerlink.js';
import { paintHashtags } from './hashtag.js';
import { paintProfileAvatar } from './earlyhashinal.js';
import { openPreview } from './fullscreenmedia.js';

const LAYOUT_KEY = 'layoutMode';
const PAGE = 2030;
const CARD_CAP = 200;
const RENDER_CHUNK = 30;
const SCROLL_IDLE_MS = 250;
const VIEW_DWELL_MS = 1000;
const VIEW_FLUSH_MS = 10000;
const VIEW_POST_BATCH = 50;
const VIEW_GET_BATCH = 40;
const VIEWER_KEY = 'feedViewerId';
const MIRROR = 'https://mainnet.mirrornode.hedera.com';
const DEFAULT_PIC = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
const SVG_NS = 'http://www.w3.org/2000/svg';

const root = document.createElement('div');
root.id = 'feed-layout';
root.style.display = 'none';
const dim = document.createElement('div');
dim.className = 'feed-dim';
const scroller = document.createElement('div');
scroller.id = 'feed-scroll';
const column = document.createElement('div');
column.id = 'feed-column';
const pageStatus = document.createElement('div');
pageStatus.id = 'feed-page-status';
pageStatus.hidden = true;
pageStatus.setAttribute('role', 'status');
pageStatus.setAttribute('aria-label', 'Loading posts');
const pageSpin = document.createElement('span');
pageSpin.className = 'feed-page-spin';
pageSpin.setAttribute('aria-hidden', 'true');
pageStatus.appendChild(pageSpin);
scroller.append(column, pageStatus);

const toolbar = document.createElement('div');
toolbar.id = 'feed-toolbar';
const menuAnchor = document.createElement('div');
menuAnchor.className = 'feed-menu-anchor';
const menuBtn = document.createElement('button');
menuBtn.id = 'feed-back-btn';
menuBtn.type = 'button';
menuBtn.setAttribute('aria-label', 'Menu');
menuBtn.setAttribute('aria-haspopup', 'menu');
menuBtn.setAttribute('aria-expanded', 'false');
menuBtn.setAttribute('aria-controls', 'feed-menu');
menuBtn.title = 'Menu';
menuBtn.appendChild(svgIcon([
  ['line', { x1: '4', x2: '20', y1: '12', y2: '12' }],
  ['line', { x1: '4', x2: '20', y1: '6', y2: '6' }],
  ['line', { x1: '4', x2: '20', y1: '18', y2: '18' }],
]));
const menu = document.createElement('ul');
menu.id = 'feed-menu';
menu.hidden = true;
menu.setAttribute('role', 'menu');
const menuDim = document.createElement('button');
menuDim.type = 'button';
menuDim.className = 'feed-menu-dim';
menuDim.hidden = true;
menuDim.setAttribute('aria-label', 'Close menu');
menuAnchor.append(menuBtn);
const tools = document.createElement('div');
tools.className = 'feed-toolbar-slot';
toolbar.append(menuAnchor, tools);
root.append(dim, toolbar, scroller, menuDim, menu);

const btn = document.createElement('button');
btn.id = 'layout-mode-btn';
btn.type = 'button';
btn.setAttribute('aria-pressed', 'false');

const rowsIcon = svgIcon([
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['path', { d: 'M21 9H3' }],
  ['path', { d: 'M21 15H3' }],
]);
const GLOBE_ICON = [
  ['circle', { cx: '12', cy: '12', r: '10' }],
  ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }],
  ['path', { d: 'M2 12h20' }],
];
const globeIcon = svgIcon(GLOBE_ICON);
const pinIcon = () => svgIcon([
  ['path', { d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0' }],
  ['circle', { cx: '12', cy: '10', r: '3' }],
]);
btn.append(rowsIcon, globeIcon);

const searchBtn = document.getElementById('search-toggle-btn');
if (searchBtn && searchBtn.parentNode) {
  const row = document.createElement('div');
  row.id = 'map-corner-buttons';
  searchBtn.parentNode.insertBefore(row, searchBtn);
  row.append(btn, searchBtn);
} else document.body.appendChild(btn);
document.body.appendChild(root);

let posts = [];
let rangeStart = 0;
let rangeEnd = 0;
let loadedTopic = '';
let cursor = null;
let exhausted = false;
let paging = false;
let generation = 0;
let highSeq = 0;
let streamOff = null;
let assembler = null;
const seenSeq = new Set();
const seenSig = new Set();
const seenPost = new Set();
const actions = new Map();
const likeCounts = new Map();
const markerComments = new Map();
const polygonComments = new Map();
const markerReplies = new Map();
const polygonReplies = new Map();
const deletedCreated = new Set();
const deletedStamp = new Set();
const deletedNumber = new Set();
const droppedShares = new Set();
let savedScroll = 0;
let peek = false;
let revealToken = 0;
let scrollIdle = 0;
let viewObserver = null;
let viewFlushTimer = 0;
let viewCountTimer = 0;
let looseViewer = '';
const viewTimers = new Map();
const viewPending = [];
const viewHold = new Set();
const viewSent = new Set();
const viewTotals = new Map();
const viewCountWanted = [];

function svgIcon(parts) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [name, attrs] of parts) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

function savedMode() {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'feed' ? 'feed' : 'map';
  } catch {
    return 'map';
  }
}

function writeMode(mode) {
  try {
    localStorage.setItem(LAYOUT_KEY, mode);
  } catch {
    /* private mode */
  }
}

function paintToggle(feed) {
  btn.classList.toggle('is-feed', feed);
  btn.setAttribute('aria-pressed', feed ? 'true' : 'false');
  btn.setAttribute('aria-label', feed ? 'Feed' : 'Map');
  btn.title = feed ? 'Feed' : 'Map';
  rowsIcon.hidden = !feed;
  globeIcon.hidden = feed;
}

// Same hold and pop as the follow button.
function bindPress(button) {
  let holdTimer = 0;
  const clearHold = () => {
    clearTimeout(holdTimer);
    button.classList.remove('is-hold');
  };
  button.addEventListener('pointerdown', () => {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => button.classList.add('is-hold'), 450);
  });
  button.addEventListener('pointerup', clearHold);
  button.addEventListener('pointerleave', clearHold);
  button.addEventListener('pointercancel', clearHold);
  button.addEventListener('click', () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    button.classList.remove('is-pop');
    void button.offsetWidth;
    button.classList.add('is-pop');
  });
  button.addEventListener('animationend', () => button.classList.remove('is-pop'));
}

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function asPoint(lng, lat) {
  const x = finite(lng);
  const y = finite(lat);
  if (x == null || y == null) return null;
  if (Math.abs(x) > 180 || Math.abs(y) > 90) return null;
  return [x, y];
}

function pointFrom(value) {
  if (Array.isArray(value) && value.length >= 2) return asPoint(value[0], value[1]);
  if (typeof value === 'string') {
    const parts = value.split(',');
    if (parts.length >= 2) return asPoint(parts[0], parts[1]);
  }
  if (value && typeof value === 'object') {
    const named = asPoint(
      value.lng ?? value.lon ?? value.longitude,
      value.lat ?? value.latitude,
    );
    if (named) return named;
    if (value.coords) return pointFrom(value.coords);
    if (value.cord) return pointFrom(value.cord);
  }
  return null;
}

function placeName(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const name = value.name || value.place || value.label;
  return typeof name === 'string' ? name.trim() : '';
}

function stamp(value) {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1e12) return numeric;
  if (Number.isFinite(numeric) && numeric > 1e9) return numeric * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function clock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function textOf(msg) {
  if (Array.isArray(msg)) return msg[0] == null ? '' : String(msg[0]);
  return msg == null ? '' : String(msg);
}

function mediaOf(image) {
  const url = Array.isArray(image) ? image[0] : image;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
  return url;
}

function isVideo(url) {
  return /\.(mp4|webm)(\?|#|$)/i.test(url);
}

function coordLabel(lngLat) {
  const lat = Number(lngLat[1]);
  const lng = Number(lngLat[0]);
  const n = (v) => {
    const a = Math.abs(v);
    const digits = a >= 100 ? 2 : a >= 10 ? 3 : 4;
    return v.toFixed(digits);
  };
  return `${n(lat)}, ${n(lng)}`;
}

const ringCenters = new Map();

function centerOf(polygon) {
  if (ringCenters.has(polygon)) return ringCenters.get(polygon);
  const lngLat = ringCenter(polygon);
  ringCenters.set(polygon, lngLat);
  return lngLat;
}

function readRecord(data) {
  if (typeof data === 'function') {
    try { return data(); } catch { return null; }
  }
  return data && typeof data === 'object' ? data : null;
}

function markerRecord(feature) {
  return readRecord(feature && feature.properties && feature.properties.popupData);
}

function polygonRecord(polygon) {
  return readRecord(polygon && polygon.popupData);
}

function chatRecord(post) {
  const message = post.message || {};
  const payer = message.payer || '';
  const pic = payer && profilePictures[payer] && profilePictures[payer].url;
  const name = payer && usernames[payer] && usernames[payer].username;
  const link = payer && click2url[payer] && click2url[payer].click2url;
  return {
    profileUrl: typeof pic === 'string' && pic ? pic : DEFAULT_PIC,
    payer,
    payerInfo: payer || 'Anonymous',
    username: name ? ` ${name}` : '',
    click2link: link ? ` ${link}` : '',
    image: message.image,
    msg: message.userMessage,
    timestamp: clock(message.created),
  };
}

function recordFor(post) {
  if (post.kind === 'marker') return markerRecord(post.feature);
  if (post.kind === 'polygon') return polygonRecord(post.polygon);
  return chatRecord(post);
}

function isViewerUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function anonViewer() {
  try {
    let id = localStorage.getItem(VIEWER_KEY);
    if (!isViewerUuid(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(VIEWER_KEY, id);
    }
    return id;
  } catch {
    if (!isViewerUuid(looseViewer)) {
      try { looseViewer = crypto.randomUUID(); } catch { looseViewer = ''; }
    }
    return looseViewer;
  }
}

// The id is read when the view joins the batch, so a wallet connect while
// that batch is waiting does not rewrite rows already queued.
function viewerNow() {
  const account = typeof connectedAccount === 'string' ? connectedAccount.trim() : '';
  if (/^\d+\.\d+\.\d+$/.test(account) && account.length <= 40) return account;
  return anonViewer();
}

function viewLabel(num) {
  return num === 1 ? '1 view' : `${num} views`;
}

function viewChip(key) {
  const chip = document.createElement('span');
  chip.className = 'feed-views';
  chip.appendChild(svgIcon([
    ['line', { x1: '18', x2: '18', y1: '20', y2: '10' }],
    ['line', { x1: '12', x2: '12', y1: '20', y2: '4' }],
    ['line', { x1: '6', x2: '6', y1: '20', y2: '14' }],
  ]));
  const count = document.createElement('span');
  count.className = 'feed-view-count';
  const known = viewTotals.get(key);
  const num = known == null ? 0 : known;
  count.textContent = String(num);
  chip.setAttribute('aria-label', viewLabel(num));
  chip.appendChild(count);
  return chip;
}

function paintCardCount(card) {
  const num = viewTotals.get(card.dataset.key);
  if (num == null) return;
  const node = card.querySelector('.feed-view-count');
  if (!node) return;
  node.textContent = String(num);
  if (node.parentElement) node.parentElement.setAttribute('aria-label', viewLabel(num));
}

function paintCounts(counts) {
  if (!counts || typeof counts !== 'object') return;
  for (const [id, raw] of Object.entries(counts)) {
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) continue;
    viewTotals.set(id, num);
  }
  for (const card of column.children) {
    if (card.classList && card.classList.contains('feed-card')) paintCardCount(card);
  }
}

function wantCount(key) {
  if (!key || viewTotals.has(key)) return;
  viewCountWanted.push(key);
  if (!viewCountTimer) viewCountTimer = setTimeout(pullCounts, 60);
}

async function pullCounts() {
  viewCountTimer = 0;
  const ids = [];
  const seen = new Set();
  while (viewCountWanted.length && ids.length < VIEW_GET_BATCH) {
    const id = viewCountWanted.shift();
    if (!id || seen.has(id) || viewTotals.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (viewCountWanted.length && !viewCountTimer) viewCountTimer = setTimeout(pullCounts, 60);
  if (!ids.length) return;
  try {
    const res = await fetch(`${BACKEND_URL}/api/views?ids=${ids.map(encodeURIComponent).join(',')}`);
    if (!res.ok) return;
    const data = await res.json();
    paintCounts(data && data.counts);
  } catch {
    /* the next cards ask again */
  }
}

function ensureViewObserver() {
  if (viewObserver) return viewObserver;
  viewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.intersectionRatio >= 0.5) armView(entry.target);
      else disarmView(entry.target);
    }
  }, { root: scroller, threshold: 0.5 });
  return viewObserver;
}

function armView(card) {
  const key = card.dataset.key;
  if (!key || viewSent.has(key) || viewHold.has(key) || viewTimers.has(card)) return;
  const timer = setTimeout(() => {
    viewTimers.delete(card);
    if (!card.isConnected) return;
    enqueueView(key, viewerNow());
  }, VIEW_DWELL_MS);
  viewTimers.set(card, timer);
}

function disarmView(card) {
  const timer = viewTimers.get(card);
  if (!timer) return;
  clearTimeout(timer);
  viewTimers.delete(card);
}

function enqueueView(key, viewer) {
  if (!key || !viewer || viewSent.has(key) || viewHold.has(key)) return;
  viewHold.add(key);
  viewPending.push({ id: key, viewer });
  armViewFlush();
}

function armViewFlush() {
  if (viewFlushTimer) return;
  viewFlushTimer = setTimeout(() => {
    viewFlushTimer = 0;
    flushViews(false);
  }, VIEW_FLUSH_MS);
}

function flushViewsNow() {
  if (viewFlushTimer) {
    clearTimeout(viewFlushTimer);
    viewFlushTimer = 0;
  }
  flushViews(true);
}

function flushViews(keepalive) {
  if (!viewPending.length) return;
  const take = keepalive ? viewPending.length : VIEW_POST_BATCH;
  const batch = viewPending.splice(0, take);
  const groups = new Map();
  for (const item of batch) {
    let list = groups.get(item.viewer);
    if (!list) groups.set(item.viewer, list = []);
    if (!list.includes(item.id)) list.push(item.id);
  }
  for (const [viewer, ids] of groups) {
    for (let i = 0; i < ids.length; i += VIEW_POST_BATCH) postViews(viewer, ids.slice(i, i + VIEW_POST_BATCH), keepalive);
  }
  if (!keepalive && viewPending.length) armViewFlush();
}

async function postViews(viewer, ids, keepalive) {
  let ok = false;
  let drop = false;
  try {
    const res = await fetch(`${BACKEND_URL}/api/views`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viewer, posts: ids }),
      keepalive: !!keepalive,
    });
    if (res.status === 400) {
      drop = true;
    } else if (res.ok) {
      const data = await res.json();
      for (const id of ids) {
        viewHold.delete(id);
        viewSent.add(id);
      }
      paintCounts(data && data.counts);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (drop) {
    for (const id of ids) viewHold.delete(id);
    return;
  }
  if (ok) return;
  let back = false;
  for (const id of ids) {
    if (viewSent.has(id) || viewPending.some((item) => item.id === id)) continue;
    viewPending.push({ id, viewer });
    back = true;
  }
  if (back) armViewFlush();
}

function watchCard(card) {
  const key = card.dataset.key;
  if (!key) return;
  ensureViewObserver().observe(card);
  if (viewTotals.has(key)) paintCardCount(card);
  else wantCount(key);
}

function forgetCard(card) {
  if (viewObserver) viewObserver.unobserve(card);
  disarmView(card);
}

function clearViewWatch() {
  if (viewObserver) viewObserver.disconnect();
  for (const timer of viewTimers.values()) clearTimeout(timer);
  viewTimers.clear();
}

function buildCard(post) {
  const record = recordFor(post) || {};
  const card = document.createElement('article');
  card.className = 'feed-card';
  card.dataset.key = post.key;

  const profile = document.createElement('div');
  profile.className = 'popup-profile-bubble';
  const img = document.createElement('img');
  img.src = record.profileUrl || DEFAULT_PIC;
  img.alt = 'Profile photo';
  img.style.cssText = 'box-sizing: border-box; width: clamp(7dvmin, 8dvmin, 9dvmin); height: clamp(7dvmin, 8dvmin, 9dvmin); flex-shrink: 0; border-radius: 50%; object-fit: cover; object-position: center; border: calc(var(--u) * 0.12) solid rgba(255, 255, 255, 0.25); box-shadow: 0 calc(var(--u) * 0.4) calc(var(--u) * 1) rgba(0, 0, 0, 0.45);';
  profile.appendChild(img);
  const header = document.createElement('div');
  const h2 = document.createElement('h2');
  const payerLink = document.createElement('a');
  payerLink.href = `https://explore.hashpack.app/${encodeURIComponent(record.payerInfo || '')}`;
  payerLink.target = '_blank';
  payerLink.rel = 'noopener noreferrer';
  payerLink.className = 'payer-info';
  payerLink.style.textDecoration = 'none';
  payerLink.textContent = record.payerInfo || 'Anonymous';
  h2.appendChild(payerLink);
  const trimmed = String(record.username || '').trim();
  if (trimmed) {
    h2.appendChild(document.createElement('br'));
    h2.appendChild(payerUsernameNode(trimmed, record.click2link, { className: 'username' }));
  }
  header.appendChild(h2);
  profile.appendChild(header);
  card.appendChild(profile);
  if (record.payer) {
    const payer = record.payer;
    img.style.cursor = 'pointer';
    h2.style.cursor = 'pointer';
    // Capture runs before the Hashpack and click2url anchors. preventDefault
    // keeps those links from navigating. stopPropagation keeps this tap from
    // reaching the document click that closes every panel.
    profile.addEventListener('click', (event) => {
      const hit = event.target && event.target.closest && event.target.closest('img, h2');
      if (!hit || !profile.contains(hit)) return;
      event.preventDefault();
      event.stopPropagation();
      holdScroll();
      if (window.loadBio4PIC) window.loadBio4PIC(payer);
    }, true);
    paintProfileAvatar(img, payer);
    // The picture already leans toward the pointer. Aim that lean at the
    // pill so the name gets the same hover and press as the picture.
    if (img._tilt) img._tilt.host = profile;
  }

  let media = null;
  const src = mediaOf(record.image);
  if (src) {
    media = document.createElement('div');
    media.className = 'popup-media-card';
    const node = isVideo(src) ? document.createElement('video') : document.createElement('img');
    node.src = src;
    if (isVideo(src)) {
      node.controls = true;
      node.playsInline = true;
      node.preload = 'metadata';
    } else {
      node.alt = '';
      node.style.cursor = 'zoom-in';
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        holdScroll();
        openPreview(src);
      });
    }
    media.appendChild(node);
  }

  let text = null;
  const body = textOf(record.msg);
  if (body) {
    text = document.createElement('p');
    text.className = 'text_color popup-text-bubble';
    paintHashtags(text, body);
    text.dataset.clamp = '1';
  }

  if (media && text) {
    const sheet = document.createElement('div');
    sheet.className = 'popup-sheet';
    const section = document.createElement('div');
    section.className = 'popup-body';
    const msgDiv = document.createElement('div');
    msgDiv.appendChild(text);
    section.append(media, msgDiv);
    sheet.appendChild(section);
    card.appendChild(sheet);
  } else if (media) {
    card.appendChild(media);
  } else if (text) {
    card.appendChild(text);
  }

  const actions = document.createElement('div');
  actions.className = 'feed-actions';
  if ((post.kind === 'marker' || post.kind === 'polygon') && record.topicId && record.timestamp) {
    mountPostReactions(actions, record, post.kind, card);
  }
  actions.appendChild(viewChip(post.key));
  card.appendChild(actions);

  const meta = document.createElement('div');
  meta.className = 'feed-meta';
  const loc = document.createElement('button');
  loc.type = 'button';
  loc.className = 'feed-loc';
  loc.appendChild(pinIcon());
  const whereText = document.createElement('span');
  whereText.className = 'feed-loc-label';
  whereText.textContent = post.place ? `${post.place} · ${coordLabel(post.lngLat)}` : coordLabel(post.lngLat);
  loc.appendChild(whereText);
  loc.addEventListener('click', (event) => {
    event.stopPropagation();
    openOnMap(post);
  });
  const time = document.createElement('div');
  time.className = 'popup-timestamp';
  time.textContent = record.timestamp || clock(post.time);
  meta.append(loc, time);
  card.appendChild(meta);
  return card;
}

function clampPending() {
  column.querySelectorAll('.popup-text-bubble[data-clamp="1"]').forEach((text) => {
    delete text.dataset.clamp;
    const full = text.scrollHeight;
    const line = parseFloat(getComputedStyle(text).lineHeight) || 0;
    if (!line || full <= line * 6 + 1) return;
    text.classList.add('is-clamped');
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'feed-more';
    more.textContent = 'Show more';
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      const clamped = text.classList.toggle('is-clamped');
      more.textContent = clamped ? 'Show more' : 'Show less';
    });
    text.after(more);
  });
}

function topicNow() {
  const input = document.getElementById('input-field');
  const value = input && input.value.trim();
  if (value && /^\d+\.\d+\.\d+$/.test(value)) return value;
  return /^\d+\.\d+\.\d+$/.test(initialTopicId) ? initialTopicId : '';
}

function cmpTs(a, b) {
  const left = String(a || '').split('.');
  const right = String(b || '').split('.');
  const as = left[0].padStart(12, '0') + (left[1] || '').padEnd(9, '0');
  const bs = right[0].padStart(12, '0') + (right[1] || '').padEnd(9, '0');
  if (as === bs) return 0;
  return as < bs ? -1 : 1;
}

function cmpMessage(a, b) {
  const ts = cmpTs(a && a.consensus_timestamp, b && b.consensus_timestamp);
  if (ts) return ts;
  return (Number(a && a.sequence_number) || 0) - (Number(b && b.sequence_number) || 0);
}

function createdIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function profileOf(payer) {
  const pic = payer && profilePictures[payer] && profilePictures[payer].url;
  const name = payer && usernames[payer] && usernames[payer].username;
  const link = payer && click2url[payer] && click2url[payer].click2url;
  return {
    profileUrl: typeof pic === 'string' && pic ? pic : DEFAULT_PIC,
    payer: payer || '',
    payerInfo: payer || 'Anonymous',
    username: name ? ` ${name}` : '',
    click2link: link ? ` ${link}` : '',
  };
}

function shapeNumber(value, created) {
  if (value == null || String(value).trim() === '') return created || '';
  if (!Number.isInteger(Number(value))) return null;
  return value;
}

function ringFrom(cord) {
  if (Array.isArray(cord) && cord.length > 2 && Array.isArray(cord[0])) return cord;
  if (typeof cord !== 'string') return null;
  if (!/^\[-?\d+\.?\d*,\s*-?\d+\.?\d*\](,\s*\[-?\d+\.?\d*,\s*-?\d+\.?\d*\])*$/.test(cord)) return null;
  try {
    const ring = JSON.parse(`[${cord}]`);
    return Array.isArray(ring) && ring.length > 2 ? ring : null;
  } catch {
    return null;
  }
}

function paintSpinner(on) {
  pageStatus.hidden = !on;
}

function clearMaps() {
  seenSeq.clear();
  seenSig.clear();
  seenPost.clear();
  actions.clear();
  likeCounts.clear();
  markerComments.clear();
  polygonComments.clear();
  markerReplies.clear();
  polygonReplies.clear();
  deletedCreated.clear();
  deletedStamp.clear();
  deletedNumber.clear();
  droppedShares.clear();
  ringCenters.clear();
}

function resetFeed(topic) {
  generation += 1;
  loadedTopic = topic;
  posts = [];
  rangeStart = 0;
  rangeEnd = 0;
  cursor = null;
  exhausted = false;
  paging = false;
  highSeq = 0;
  assembler = createChunkAssembler();
  clearMaps();
  clearViewWatch();
  column.replaceChildren();
  paintSpinner(false);
  savedScroll = 0;
}

function actionKey(bucket, stamp) {
  return `${bucket}|${stamp}`;
}

function setAction(bucket, stamp, payer, type, at) {
  const key = actionKey(bucket, stamp);
  if (!actions.has(key)) actions.set(key, new Map());
  const row = actions.get(key);
  const prev = row.get(payer);
  if (prev && cmpTs(prev.at, at) > 0) return;
  if (prev && prev.type === 'like') likeCounts.set(key, (likeCounts.get(key) || 0) - 1);
  row.set(payer, { type, at });
  if (type === 'like') likeCounts.set(key, (likeCounts.get(key) || 0) + 1);
}

function pushList(map, key, item) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(item);
}

function noteDelete(payer, data) {
  if (!payer || !data) return;
  const created = createdIso(data.deleteMarkerCreated || data.deletePolygonCreated);
  const stampLabel = data.deleteMarkerTimestamp || data.deletePolygonTimestamp;
  const number = data.deleteMarkerNumber != null ? data.deleteMarkerNumber : data.deletePolygonNumber;
  if (created) deletedCreated.add(`${payer}|${created}`);
  if (stampLabel != null && String(stampLabel).trim() !== '') deletedStamp.add(`${payer}|${stampLabel}`);
  if (number != null && String(number).trim() !== '') deletedNumber.add(`${payer}|${number}`);
}

function noteMessage(message) {
  const payer = message.payer || '';
  const at = String(message.consensus_timestamp || message.created || '');
  noteDelete(payer, message.marker && message.marker.data);
  noteDelete(payer, message.polygon && message.polygon.data);
  const fields = [
    ['likeMarker', 'marker', 'like'],
    ['dislikeMarker', 'marker', 'dislike'],
    ['likePolygon', 'polygon', 'like'],
    ['dislikePolygon', 'polygon', 'dislike'],
    ['unlikeMarker', 'marker', 'unlike'],
    ['unlikePolygon', 'polygon', 'unlike'],
  ];
  for (const [field, bucket, type] of fields) {
    const body = message[field];
    if (!body || !body.timestamp || !payer) continue;
    setAction(bucket, String(body.timestamp), payer, type, at);
  }
  const created = createdIso(message.created);
  if (message.commentMarker && message.commentMarker.timestamp && payer) {
    pushList(markerComments, String(message.commentMarker.timestamp), {
      payer,
      text: String(message.commentMarker.text || '').slice(0, 300),
      created,
    });
  }
  if (message.commentPolygon && message.commentPolygon.timestamp && payer) {
    pushList(polygonComments, String(message.commentPolygon.timestamp), {
      payer,
      text: String(message.commentPolygon.text || '').slice(0, 300),
      created,
    });
  }
  if (message.replyMarker && message.replyMarker.parentId && payer) {
    pushList(markerReplies, String(message.replyMarker.parentId), {
      payer,
      text: String(message.replyMarker.text || '').slice(0, 300),
      created,
    });
  }
  if (message.replyPolygon && message.replyPolygon.parentId && payer) {
    pushList(polygonReplies, String(message.replyPolygon.parentId), {
      payer,
      text: String(message.replyPolygon.text || '').slice(0, 300),
      created,
    });
  }
  const unshare = message.unshare;
  if (unshare && typeof unshare === 'object') {
    const topic = typeof unshare.topic === 'string' ? unshare.topic.trim() : '';
    const when = createdIso(unshare.created);
    if (payer && /^\d+\.\d+\.\d+$/.test(topic) && when) droppedShares.add(`${payer}|${topic}|${when}`);
  }
}

function commentsFor(bucket, stamp) {
  const list = bucket === 'polygon' ? polygonComments : markerComments;
  const replies = bucket === 'polygon' ? polygonReplies : markerReplies;
  return (list.get(stamp) || []).map((comment) => ({
    ...comment,
    replies: (replies.get(comment.created) || []).slice(),
  }));
}

function liked(bucket, stamp) {
  const row = actions.get(actionKey(bucket, stamp));
  const mine = row && connectedAccount && row.get(connectedAccount);
  return !!(mine && mine.type === 'like');
}

function likeTotal(bucket, stamp) {
  return likeCounts.get(actionKey(bucket, stamp)) || 0;
}

function gone(payer, number, created, stampLabel) {
  if (created && deletedCreated.has(`${payer}|${created}`)) return true;
  if (stampLabel && deletedStamp.has(`${payer}|${stampLabel}`)) return true;
  if (number != null && String(number) !== '' && deletedNumber.has(`${payer}|${number}`)) return true;
  return false;
}

function keepPost(post) {
  if (!post || !post.key || seenPost.has(post.key) || !post.lngLat) return null;
  seenPost.add(post.key);
  return post;
}

function markerPost(message, data) {
  const payer = message.payer || '';
  const created = createdIso(message.created);
  const number = shapeNumber(data.numberOfMarker, created);
  const lngLat = number == null ? null : pointFrom(data.cord);
  const stampLabel = clock(message.created);
  if (!lngLat || gone(payer, number, created, stampLabel)) return null;
  const record = () => ({
    markernumber: number,
    topicId: loadedTopic,
    ...profileOf(payer),
    title: data.title,
    image: data.image,
    coverimage: data.coverimage,
    msg: data.msg,
    timestamp: stampLabel,
    created,
    likeCountMarker: likeTotal('marker', stampLabel),
    likedByMe: liked('marker', stampLabel),
    comments: commentsFor('marker', stampLabel),
    coords: lngLat,
  });
  return keepPost({
    key: `m:${loadedTopic}:${payer}:${created}:${number}`,
    kind: 'marker',
    seq: Number(message.sequence_number) || 0,
    lngLat,
    time: stamp(message.created),
    feature: {
      topicId: loadedTopic,
      created: message.created,
      msgNumber: number,
      type: 'Feature',
      payer,
      properties: { popupData: record },
      geometry: { type: 'Point', coordinates: lngLat },
    },
  });
}

function polygonPost(message, data) {
  const payer = message.payer || '';
  const created = createdIso(message.created);
  const number = shapeNumber(data.numberOfPolygon, created);
  const ring = number == null ? null : ringFrom(data.cord);
  const stampLabel = clock(message.created);
  if (!ring || gone(payer, number, created, stampLabel)) return null;
  const polygon = {
    topicId: loadedTopic,
    created: message.created,
    msgNumber: number,
    payer,
    coordinates: [ring],
  };
  const lngLat = centerOf(polygon);
  if (!lngLat) return null;
  polygon.popupData = () => ({
    polygonnumber: number,
    topicId: loadedTopic,
    ...profileOf(payer),
    title: data.title,
    image: data.image,
    coverimage: data.coverimage,
    msg: data.msg,
    timestamp: stampLabel,
    created,
    likeCountPolygon: likeTotal('polygon', stampLabel),
    likedByMe: liked('polygon', stampLabel),
    comments: commentsFor('polygon', stampLabel),
    coordinates: ring,
  });
  return keepPost({
    key: `p:${loadedTopic}:${payer}:${created}:${number}`,
    kind: 'polygon',
    seq: Number(message.sequence_number) || 0,
    polygon,
    lngLat,
    time: stamp(message.created),
  });
}

function sharePost(message) {
  const share = message.share;
  if (!share || typeof share !== 'object') return null;
  const payer = message.payer || '';
  const original = typeof share.topic === 'string' ? share.topic.trim() : '';
  const created = createdIso(share.created);
  const lngLat = pointFrom(share.pin || share.coords);
  if (!payer || !/^\d+\.\d+\.\d+$/.test(original) || !created || !lngLat) return null;
  if (droppedShares.has(`${payer}|${original}|${created}`)) return null;
  const author = typeof share.payer === 'string' ? share.payer : '';
  const stampLabel = clock(created);
  const number = share.number == null ? '' : share.number;
  const record = () => ({
    markernumber: number,
    polygonnumber: number,
    topicId: original,
    ...profileOf(author),
    title: share.title,
    image: share.image,
    coverimage: share.cover,
    msg: share.msg,
    timestamp: stampLabel,
    created,
    likeCountMarker: likeTotal('marker', stampLabel),
    likeCountPolygon: likeTotal('polygon', stampLabel),
    likedByMe: false,
    comments: [],
    coords: lngLat,
    coordinates: lngLat,
    share: { sharer: payer, home: loadedTopic },
  });
  return keepPost({
    key: `s:${payer}:${original}:${created}`,
    kind: 'marker',
    seq: Number(message.sequence_number) || 0,
    lngLat,
    time: stamp(message.created),
    feature: {
      topicId: loadedTopic,
      created,
      msgNumber: `share-${created}-${payer}`,
      type: 'Feature',
      payer,
      properties: { popupData: record },
      geometry: { type: 'Point', coordinates: lngLat },
    },
  });
}

function chatPost(message) {
  if (message.marker || message.polygon || message.share) return null;
  if (!message.userMessage && !message.image) return null;
  const bag = message.location || message.place || message;
  const lngLat = pointFrom(message.location) || pointFrom(message.place) || pointFrom(message.coords) || pointFrom(message.cord)
    || asPoint(message.lng ?? message.lon ?? message.longitude, message.lat ?? message.latitude);
  if (!lngLat) return null;
  const place = placeName(message.location) || placeName(message.place) || placeName(bag);
  return keepPost({
    key: `c:${loadedTopic}:${message.payer}:${message.sequence_number}:${message.created}`,
    kind: 'chat',
    seq: Number(message.sequence_number) || 0,
    message,
    topicId: loadedTopic,
    lngLat,
    place,
    time: stamp(message.created),
  });
}

function postsFrom(message) {
  const out = [];
  const marker = message.marker && message.marker.data;
  const polygon = message.polygon && message.polygon.data;
  if (marker) {
    const post = markerPost(message, marker);
    if (post) out.push(post);
  }
  if (polygon) {
    const post = polygonPost(message, polygon);
    if (post) out.push(post);
  }
  const shared = sharePost(message);
  if (shared) out.push(shared);
  const chat = chatPost(message);
  if (chat) out.push(chat);
  return out;
}

function accept(message) {
  if (!message || typeof message !== 'object') return false;
  const seq = Number(message.sequence_number);
  if (seq > 0 && seenSeq.has(seq)) return false;
  const signature = messageSig(message);
  if (seenSig.has(signature)) {
    if (seq > 0) seenSeq.add(seq);
    if (seq > highSeq) highSeq = seq;
    return false;
  }
  if (seq > 0) {
    seenSeq.add(seq);
    if (seq > highSeq) highSeq = seq;
  }
  seenSig.add(signature);
  return true;
}

function ingest(messages) {
  const fresh = [];
  for (const message of messages || []) {
    if (accept(message)) fresh.push(message);
  }
  fresh.sort(cmpMessage);
  for (const message of fresh) noteMessage(message);
  const made = [];
  for (let i = fresh.length - 1; i >= 0; i--) made.push(...postsFrom(fresh[i]));
  return made;
}

async function fetchBackend(topic, before) {
  const out = [];
  const seen = new Set();
  let beforeSeq = before && before.seq ? before.seq : 0;
  let short = false;
  while (out.length < PAGE) {
    const ask = Math.min(1000, PAGE - out.length);
    const page = await fetchMessagesBackend(topic, ask, 0, beforeSeq);
    if (!page.ready) return null;
    const confirmed = (page.messages || []).filter((message) => Number(message.sequence_number) > 0);
    if (!confirmed.length) {
      short = true;
      break;
    }
    confirmed.sort(cmpMessage);
    for (let i = confirmed.length - 1; i >= 0 && out.length < PAGE; i--) {
      const seq = Number(confirmed[i].sequence_number);
      if (seen.has(seq)) continue;
      seen.add(seq);
      out.push(confirmed[i]);
    }
    if (confirmed.length < ask) {
      short = true;
      break;
    }
    const oldestSeq = Number(confirmed[0].sequence_number);
    if (!oldestSeq || (beforeSeq && oldestSeq >= beforeSeq)) {
      short = true;
      break;
    }
    beforeSeq = oldestSeq;
  }
  out.sort((a, b) => cmpMessage(b, a));
  return { messages: out, done: short || out.length < PAGE };
}

async function fetchMirror(topic, before) {
  const out = [];
  const seen = new Set();
  let beforeTs = before && before.ts ? String(before.ts) : '';
  let short = false;
  for (let guard = 0; guard < 40 && out.length < PAGE; guard++) {
    const ask = Math.min(100, PAGE - out.length);
    let url = `${MIRROR}/api/v1/topics/${topic}/messages?limit=${ask}&order=desc`;
    if (beforeTs) url += `&timestamp=lt:${encodeURIComponent(beforeTs)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`mirror HTTP ${response.status}`);
    const data = await response.json();
    const raw = data.messages || [];
    if (!raw.length) {
      short = true;
      break;
    }
    const parsed = ingestMirrorRows(assembler, topic, raw).map((item) => ({
      ...item.parsed,
      payer: item.payer,
      created: new Date(Number(item.consensus_timestamp) * 1000).toISOString(),
      consensus_timestamp: String(item.consensus_timestamp),
      sequence_number: item.sequence_number,
    }));
    parsed.sort((a, b) => cmpMessage(b, a));
    for (const message of parsed) {
      if (out.length >= PAGE) break;
      const seq = Number(message.sequence_number);
      if (seq > 0 && seen.has(seq)) continue;
      if (before && before.ts && cmpTs(message.consensus_timestamp, before.ts) >= 0) continue;
      if (seq > 0) seen.add(seq);
      out.push(message);
    }
    const oldestRaw = String(raw[raw.length - 1].consensus_timestamp || '');
    if (!oldestRaw || (beforeTs && cmpTs(oldestRaw, beforeTs) >= 0)) {
      short = true;
      break;
    }
    beforeTs = oldestRaw;
    if (raw.length < ask) {
      short = true;
      break;
    }
  }
  out.sort((a, b) => cmpMessage(b, a));
  return { messages: out, done: short || out.length < PAGE };
}

async function fetchPage(topic, before) {
  const cached = await fetchBackend(topic, before);
  if (cached) return cached;
  return fetchMirror(topic, before);
}

async function fetchNewer(topic, after) {
  const page = await fetchMessagesBackend(topic, 100, after, 0);
  if (page.ready) return (page.messages || []).filter((message) => Number(message.sequence_number) > after);
  const response = await fetch(`${MIRROR}/api/v1/topics/${topic}/messages?limit=100&order=asc&sequencenumber=gt:${after}`);
  if (!response.ok) return [];
  const data = await response.json();
  return ingestMirrorRows(assembler, topic, data.messages || []).map((item) => ({
    ...item.parsed,
    payer: item.payer,
    created: new Date(Number(item.consensus_timestamp) * 1000).toISOString(),
    consensus_timestamp: String(item.consensus_timestamp),
    sequence_number: item.sequence_number,
  }));
}

function renderThrough(end) {
  if (end <= rangeEnd) return;
  const frag = document.createDocumentFragment();
  const cards = [];
  for (let i = rangeEnd; i < end; i++) {
    const card = buildCard(posts[i]);
    cards.push(card);
    frag.appendChild(card);
  }
  column.appendChild(frag);
  rangeEnd = end;
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
}

function trimAbove() {
  const viewTop = scroller.getBoundingClientRect().top;
  const far = viewTop - scroller.clientHeight;
  while (rangeEnd - rangeStart > CARD_CAP) {
    const first = column.firstElementChild;
    if (!first || !first.classList.contains('feed-card')) break;
    const rect = first.getBoundingClientRect();
    if (rect.bottom > far) break;
    const next = first.nextElementSibling;
    const drop = next && next.classList.contains('feed-card') ? next.offsetTop - first.offsetTop : first.offsetHeight;
    forgetCard(first);
    first.remove();
    rangeStart += 1;
    scroller.scrollTop = Math.max(0, scroller.scrollTop - drop);
  }
}

function fillUp() {
  if (paging || scroller.scrollTop > scroller.clientHeight || rangeStart === 0) return;
  const add = Math.min(RENDER_CHUNK, rangeStart);
  const prevTop = scroller.scrollTop;
  const prevHeight = scroller.scrollHeight;
  const frag = document.createDocumentFragment();
  const cards = [];
  for (let i = rangeStart - add; i < rangeStart; i++) {
    const card = buildCard(posts[i]);
    cards.push(card);
    frag.appendChild(card);
  }
  column.prepend(frag);
  rangeStart -= add;
  scroller.scrollTop = prevTop + (scroller.scrollHeight - prevHeight);
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
}

function fillDown() {
  if (!feedOn() || root.classList.contains('is-peek') || paging) return;
  if (scroller.clientHeight < 1) {
    if (rangeEnd < posts.length) renderThrough(Math.min(posts.length, rangeEnd + RENDER_CHUNK));
    return;
  }
  let guard = 0;
  while (guard < 12) {
    guard += 1;
    const room = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const short = scroller.scrollHeight <= scroller.clientHeight + 4;
    if (!short && room >= scroller.clientHeight * 2) return;
    if (rangeEnd < posts.length) {
      renderThrough(Math.min(posts.length, rangeEnd + RENDER_CHUNK));
      trimAbove();
      continue;
    }
    if (!exhausted) loadOlder();
    return;
  }
}

function prependPosts(list) {
  if (!list.length) return;
  const atTop = scroller.scrollTop < 2;
  const showingTop = rangeStart === 0;
  posts.unshift(...list);
  rangeStart += list.length;
  rangeEnd += list.length;
  if (!showingTop) return;
  const prevTop = scroller.scrollTop;
  const prevHeight = scroller.scrollHeight;
  const frag = document.createDocumentFragment();
  const cards = [];
  for (const post of list) {
    const card = buildCard(post);
    cards.push(card);
    frag.appendChild(card);
  }
  column.prepend(frag);
  rangeStart = 0;
  const delta = scroller.scrollHeight - prevHeight;
  scroller.scrollTop = atTop ? 0 : prevTop + delta;
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
  trimAbove();
}

async function loadOlder() {
  if (paging || exhausted) return;
  const topic = loadedTopic;
  if (!topic) return;
  const gen = generation;
  paging = true;
  paintSpinner(true);
  let ok = false;
  try {
    const page = await fetchPage(topic, cursor);
    if (gen !== generation) return;
    const messages = page.messages || [];
    if (!messages.length) {
      exhausted = true;
      ok = true;
      return;
    }
    const oldest = messages[messages.length - 1];
    const nextTs = String(oldest.consensus_timestamp || '');
    const nextSeq = Number(oldest.sequence_number) || 0;
    if (cursor && nextTs === String(cursor.ts)) {
      exhausted = true;
      ok = true;
      return;
    }
    cursor = { ts: nextTs, seq: nextSeq };
    if (page.done) exhausted = true;
    posts.push(...ingest(messages));
    ok = true;
  } catch (error) {
    console.warn('feed page failed', error);
  } finally {
    if (gen === generation) {
      paging = false;
      paintSpinner(false);
    }
  }
  if (ok && gen === generation) fillDown();
}

async function catchUp() {
  if (!loadedTopic || !highSeq || paging) return;
  const topic = loadedTopic;
  const gen = generation;
  const after = highSeq;
  paging = true;
  try {
    const rows = await fetchNewer(topic, after);
    if (gen !== generation) return;
    const made = ingest(rows);
    if (made.length) prependPosts(made);
  } catch (error) {
    console.warn('feed catch-up failed', error);
  } finally {
    if (gen === generation) paging = false;
  }
}

function onStream(event) {
  if (!feedOn() || !event || event.topic !== loadedTopic) return;
  if (event.type !== 'message' && event.type !== 'pending') return;
  if (!event.message) return;
  const made = ingest([event.message]);
  if (made.length) prependPosts(made);
}

function bindStream(topic) {
  if (streamOff) streamOff();
  streamOff = streamOnTopic(topic, onStream);
}

function ensureTopic(opening) {
  const topic = topicNow();
  if (!topic) return;
  if (topic !== loadedTopic) {
    if (streamOff) {
      streamOff();
      streamOff = null;
    }
    resetFeed(topic);
    bindStream(topic);
    loadOlder();
    return;
  }
  if (opening) catchUp();
  if (!paging && !posts.length && !exhausted) loadOlder();
}

function feedOn() {
  return root.style.display !== 'none';
}

// Opaque feed is its own screen. The class tells the globe loop to skip
// frames. Peek and map mode clear it so the map chrome comes back.
function syncCover() {
  const open = root.style.display !== 'none' && !root.classList.contains('is-peek');
  document.documentElement.classList.toggle('feed-app', open);
}

// savedScroll stays live. History is updated once the feed sits still,
// and again right before the map opens or the feed closes.
function writeScroll() {
  if (root.classList.contains('is-peek')) return;
  if (!window.layerIsOpen || !window.layerIsOpen('feed')) return;
  if (window.layerIsOpen('markerpopup') || window.layerIsOpen('feedfly')) return;
  // A layer opened on top of the feed in the idle window. Pushing feed
  // again would sit above that layer, so Back would close the feed first.
  if (!window.layerIsTop || !window.layerIsTop('feed')) return;
  window.layerOpened('feed', { scroll: savedScroll });
}

// The next card action opens another layer. Keep the scroll the feed is
// on, and drop the pending idle write so it cannot land above that layer.
function holdScroll() {
  savedScroll = scroller.scrollTop;
  if (scrollIdle) {
    clearTimeout(scrollIdle);
    scrollIdle = 0;
  }
}

function rememberScroll() {
  if (scrollIdle) {
    clearTimeout(scrollIdle);
    scrollIdle = 0;
  }
  if (root.classList.contains('is-peek')) return;
  savedScroll = scroller.scrollTop;
  writeScroll();
}

function scheduleScrollWrite() {
  if (scrollIdle) clearTimeout(scrollIdle);
  scrollIdle = setTimeout(() => {
    scrollIdle = 0;
    writeScroll();
  }, SCROLL_IDLE_MS);
}

function reveal() {
  peek = false;
  root.classList.remove('is-peek');
  syncCover();
  const y = savedScroll;
  requestAnimationFrame(() => { scroller.scrollTop = y; });
}

function revealSoon() {
  const token = ++revealToken;
  let tries = 0;
  const tick = () => {
    if (token !== revealToken) return;
    tries += 1;
    if (window.layerIsOpen && (window.layerIsOpen('markerpopup') || window.layerIsOpen('feedfly'))) {
      if (tries < 12) setTimeout(tick, 40);
      return;
    }
    if (peek && window.layerIsOpen && window.layerIsOpen('feed')) reveal();
  };
  setTimeout(tick, 0);
}

function hideModel() {
  const crosshair = document.getElementById('crosshair');
  if (currentUfoModelInGLTF) {
    scene.remove(currentUfoModelInGLTF);
    if (crosshair) crosshair.style.display = 'none';
  }
}

function showModel() {
  const crosshair = document.getElementById('crosshair');
  if (currentUfoModelInGLTF && crosshair) {
    scene.add(currentUfoModelInGLTF);
    crosshair.style.display = 'block';
  }
}

function openMarkerFeature(feature) {
  const node = markerPopupNode(feature.properties, feature);
  const lngLat = feature.geometry && feature.geometry.coordinates;
  if (!node || !lngLat) return false;
  holdScroll();
  activePolygonPopups.forEach((popup) => popup.remove());
  activeMarkerPopups.forEach((popup) => popup.remove());
  CloseALL();
  closeDrawAnchor();
  closePressAnchor();
  const popup = new maplibregl.Popup({ focusAfterOpen: false });
  popup.on('close', () => {
    changePopupState(false);
    showModel();
  });
  activeMarkerPopups.push(popup);
  popup.setLngLat(lngLat).addTo(map).setDOMContent(node);
  cancelAnimateMapTo();
  animateMapTo(map, lngLat, MARKER_ZOOM);
  applyAllStyles();
  changePopupState(true);
  hideModel();
  return true;
}

function openPolygonFeature(polygon) {
  const node = polygonPopupNode(polygon);
  const lngLat = centerOf(polygon);
  if (!node || !lngLat) return false;
  holdScroll();
  activePolygonPopups.forEach((popup) => popup.remove());
  activeMarkerPopups.forEach((popup) => popup.remove());
  CloseALL();
  closeDrawAnchor();
  closePressAnchor();
  const popup = new maplibregl.Popup({ focusAfterOpen: false });
  popup.on('close', () => {
    changePopupState(false);
    showModel();
  });
  activePolygonPopups.push(popup);
  popup.setLngLat(lngLat).setDOMContent(node).addTo(map);
  cancelAnimateMapTo();
  animateMapTo(map, lngLat, MARKER_ZOOM);
  applyAllStyles();
  changePopupState(true);
  hideModel();
  return true;
}

function flyOnly(lngLat) {
  if (window.layerOpened) {
    window.layerOpened('feedfly', {
      lng: lngLat[0],
      lat: lngLat[1],
      scroll: savedScroll,
    });
  }
  cancelAnimateMapTo();
  animateMapTo(map, lngLat, MARKER_ZOOM);
}

function openOnMap(post) {
  rememberScroll();
  peek = true;
  root.classList.add('is-peek');
  syncCover();
  if (post.kind === 'marker' && post.feature && openMarkerFeature(post.feature)) return;
  if (post.kind === 'polygon' && post.polygon && openPolygonFeature(post.polygon)) return;
  flyOnly(post.lngLat);
}

function applyFeed(on) {
  paintToggle(on);
  writeMode(on ? 'feed' : 'map');
  if (!on) paintMenu(false);
  if (on) {
    peek = false;
    root.classList.remove('is-peek');
    root.style.display = 'block';
    syncCover();
    ensureTopic(true);
    return;
  }
  peek = false;
  revealToken += 1;
  root.classList.remove('is-peek');
  rememberScroll();
  root.style.display = 'none';
  syncCover();
  if (streamOff) {
    streamOff();
    streamOff = null;
  }
}

if (window.defineLayer) {
  window.defineLayer('feedfly', {
    parent: 'feed',
    open: (state) => {
      peek = true;
      root.classList.add('is-peek');
      syncCover();
      const y = Number(state && state.scroll);
      if (Number.isFinite(y)) savedScroll = y;
      if (state && state.lng != null && state.lat != null) {
        cancelAnimateMapTo();
        animateMapTo(map, [Number(state.lng), Number(state.lat)], MARKER_ZOOM);
      }
    },
    close: () => {
      if (root.style.display === 'none') return;
      reveal();
    },
  });
}

if (window.watchDisplayLayer) {
  window.watchDisplayLayer('feed', root, {
    open: (state) => {
      applyFeed(true);
      const y = Number(state && state.scroll);
      if (Number.isFinite(y)) {
        savedScroll = y;
        requestAnimationFrame(() => { scroller.scrollTop = y; });
      }
    },
    close: () => applyFeed(false),
  });
}

if (window.layerPopupOpened) {
  const opened = window.layerPopupOpened;
  window.layerPopupOpened = function (popup, data) {
    if (feedOn() && window.layerIsOpen && window.layerIsOpen('feed')) {
      peek = true;
      root.classList.add('is-peek');
      revealToken += 1;
      syncCover();
    }
    return opened(popup, data);
  };
}

if (window.layerPopupClosed) {
  const closed = window.layerPopupClosed;
  window.layerPopupClosed = function (popup) {
    const fromFeed = peek && feedOn();
    const already = popup && popup._hlClosed;
    const result = closed(popup);
    if (fromFeed && (already || popup)) revealSoon();
    return result;
  };
}

btn.addEventListener('click', () => {
  applyFeed(!feedOn());
});

// One row per action. Later items are another entry in this list.
const FEED_MENU = [
  { label: 'Back to map', icon: GLOBE_ICON, run: backToMap },
];

// A later open or close bumps this so a finishing slide cannot hide
// the drawer the user just reopened.
let menuToken = 0;

function motionOff() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function paintMenu(open) {
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && !menu.hidden && menu.classList.contains('is-open')) return;
  const token = ++menuToken;
  if (open) {
    menu.hidden = false;
    menuDim.hidden = false;
    if (motionOff()) {
      menu.classList.add('is-open');
      menuDim.classList.add('is-open');
      return;
    }
    menu.classList.remove('is-open');
    menuDim.classList.remove('is-open');
    void menu.offsetWidth;
    if (token !== menuToken) return;
    menu.classList.add('is-open');
    menuDim.classList.add('is-open');
    return;
  }
  menu.classList.remove('is-open');
  menuDim.classList.remove('is-open');
  const finish = () => {
    if (token !== menuToken) return;
    menu.hidden = true;
    menuDim.hidden = true;
  };
  if (motionOff() || menu.hidden) {
    finish();
    return;
  }
  let settled = false;
  const end = () => {
    if (settled) return;
    settled = true;
    menu.removeEventListener('transitionend', onEnd);
    finish();
  };
  const onEnd = (event) => {
    if (event.target !== menu || event.propertyName !== 'transform') return;
    end();
  };
  menu.addEventListener('transitionend', onEnd);
  setTimeout(end, 280);
}

// Hides the drawer and, when this gesture closed it, drops its history
// entry. A phone Back already popped that entry, so the history call
// no-ops and the feed stays.
function closeMenu() {
  paintMenu(false);
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedmenu')) {
    window.layerClosedByUI('feedmenu');
  }
}

function openMenu() {
  if (window.layerIsTop && !window.layerIsTop('feed')) return;
  paintMenu(true);
  if (window.layerOpened) window.layerOpened('feedmenu');
}

function backToMap() {
  // The menu sits on the feed. Two steps land where one phone Back
  // lands when the menu is shut: the feed closes and the map returns.
  if (window.layerIsOpen && window.layerIsOpen('feedmenu')) {
    history.go(-2);
    return;
  }
  if (window.layerIsOpen && window.layerIsOpen('feed')) history.back();
}

for (const item of FEED_MENU) {
  const row = document.createElement('li');
  const choice = document.createElement('button');
  choice.type = 'button';
  choice.className = 'feed-menu-item';
  choice.append(svgIcon(item.icon), document.createTextNode(item.label));
  choice.addEventListener('click', (event) => {
    event.stopPropagation();
    item.run();
  });
  bindPress(choice);
  row.appendChild(choice);
  menu.appendChild(row);
}

if (window.defineLayer) {
  window.defineLayer('feedmenu', {
    parent: 'feed',
    open: () => paintMenu(true),
    close: () => closeMenu(),
  });
}

bindPress(menuBtn);
menuBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (window.layerIsOpen && window.layerIsOpen('feedmenu')) closeMenu();
  else openMenu();
});

menuDim.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeMenu();
});

let menuSwipe = null;
function endMenuSwipe(event) {
  if (!menuSwipe || event.pointerId !== menuSwipe.id) return;
  const dx = event.clientX - menuSwipe.x;
  const dy = event.clientY - menuSwipe.y;
  const cancelled = event.type === 'pointercancel';
  menuSwipe = null;
  document.removeEventListener('pointerup', endMenuSwipe);
  document.removeEventListener('pointercancel', endMenuSwipe);
  if (cancelled) return;
  const limit = menu.getBoundingClientRect().width * 0.18;
  if (dx >= -limit || dx >= -Math.abs(dy)) return;
  const eat = (click) => {
    click.preventDefault();
    click.stopPropagation();
  };
  menu.addEventListener('click', eat, true);
  setTimeout(() => menu.removeEventListener('click', eat, true), 0);
  closeMenu();
}
menu.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || menuSwipe) return;
  menuSwipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  document.addEventListener('pointerup', endMenuSwipe);
  document.addEventListener('pointercancel', endMenuSwipe);
});

document.addEventListener('keydown', (event) => {
  if (menu.hidden || event.key !== 'Escape') return;
  if (window.layerIsTop && !window.layerIsTop('feedmenu')) return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu();
}, true);

root.addEventListener('click', (event) => event.stopPropagation());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushViewsNow();
});
window.addEventListener('pagehide', flushViewsNow);

scroller.addEventListener('scroll', () => {
  if (root.classList.contains('is-peek')) return;
  savedScroll = scroller.scrollTop;
  fillUp();
  fillDown();
  scheduleScrollWrite();
}, { passive: true });

paintToggle(false);
if (savedMode() === 'feed') applyFeed(true);

setInterval(() => {
  if (!feedOn() || root.classList.contains('is-peek')) return;
  ensureTopic(false);
}, 2000);
