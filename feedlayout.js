// Optional feed column for the topic already loaded on the globe.
// Map mode is the default and does not push a history entry.

import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { geojson, polygons, storedMarkers, storedPolygons, currentUfoModelInGLTF } from './letall.js';
import { allLoadedMessages, markerPopupNode, polygonPopupNode } from './processallmessages.js';
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
const BATCH = 20;
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
scroller.appendChild(column);
root.append(dim, scroller);

const btn = document.createElement('button');
btn.id = 'layout-mode-btn';
btn.type = 'button';
btn.setAttribute('aria-pressed', 'false');

const rowsIcon = svgIcon([
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['path', { d: 'M21 9H3' }],
  ['path', { d: 'M21 15H3' }],
]);
const globeIcon = svgIcon([
  ['circle', { cx: '12', cy: '12', r: '10' }],
  ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }],
  ['path', { d: 'M2 12h20' }],
]);
const pinIcon = () => svgIcon([
  ['path', { d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0' }],
  ['circle', { cx: '12', cy: '10', r: '3' }],
]);
btn.append(rowsIcon, globeIcon);

const searchBtn = document.getElementById('search-toggle-btn');
if (searchBtn && searchBtn.parentNode) searchBtn.parentNode.insertBefore(btn, searchBtn);
else document.body.appendChild(btn);
document.body.appendChild(root);

let posts = [];
let shown = 0;
let savedScroll = 0;
let peek = false;
let revealToken = 0;
let scrollTicket = 0;

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

function eachMarker(fn) {
  const lists = storedMarkers.length ? storedMarkers : [geojson.features];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const feature of list) fn(feature);
  }
}

function eachPolygon(fn) {
  const lists = storedPolygons.length ? storedPolygons : [polygons];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const polygon of list) fn(polygon);
  }
}

function collect() {
  const out = [];
  const seen = new Set();
  const add = (post) => {
    if (!post || !post.key || seen.has(post.key) || !post.lngLat) return;
    seen.add(post.key);
    out.push(post);
  };
  eachMarker((feature) => {
    if (!feature || !feature.geometry) return;
    const lngLat = pointFrom(feature.geometry.coordinates);
    if (!lngLat) return;
    add({
      key: `m:${feature.topicId}:${feature.payer}:${feature.created}:${feature.msgNumber}`,
      kind: 'marker',
      feature,
      lngLat,
      time: stamp(feature.created),
    });
  });
  eachPolygon((polygon) => {
    if (!polygon) return;
    const lngLat = ringCenter(polygon);
    if (!lngLat) return;
    add({
      key: `p:${polygon.topicId}:${polygon.payer}:${polygon.created}:${polygon.msgNumber}`,
      kind: 'polygon',
      polygon,
      lngLat,
      time: stamp(polygon.created),
    });
  });
  for (const entry of allLoadedMessages) {
    const messages = entry && entry.uniqueMessages && entry.uniqueMessages.messages;
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      if (!message || message.marker || message.polygon) continue;
      if (!message.userMessage && !message.image) continue;
      const bag = message.location || message.place || message;
      const lngLat = pointFrom(message.location) || pointFrom(message.place) || pointFrom(message.coords) || pointFrom(message.cord)
        || asPoint(message.lng ?? message.lon ?? message.longitude, message.lat ?? message.latitude);
      if (!lngLat) continue;
      const place = placeName(message.location) || placeName(message.place) || placeName(bag);
      add({
        key: `c:${entry.topicId}:${message.payer}:${message.sequence_number}:${message.created}`,
        kind: 'chat',
        message,
        topicId: entry.topicId,
        lngLat,
        place,
        time: stamp(message.created),
      });
    }
  }
  out.sort((a, b) => b.time - a.time);
  return out;
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
  img.style.cssText = 'width: calc(var(--u) * 7); height: calc(var(--u) * 7); flex-shrink: 0; border-radius: 50%; object-fit: cover; object-position: center; border: calc(var(--u) * 0.12) solid rgba(255, 255, 255, 0.25); box-shadow: 0 calc(var(--u) * 0.4) calc(var(--u) * 1) rgba(0, 0, 0, 0.45);';
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
  if (record.payer) paintProfileAvatar(img, record.payer);

  const src = mediaOf(record.image);
  if (src) {
    const media = document.createElement('div');
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
        openPreview(src);
      });
    }
    media.appendChild(node);
    card.appendChild(media);
  }

  const body = textOf(record.msg);
  if (body) {
    const text = document.createElement('p');
    text.className = 'text_color popup-text-bubble';
    paintHashtags(text, body);
    card.appendChild(text);
    text.dataset.clamp = '1';
  }

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

function renderMore() {
  const slice = posts.slice(shown, shown + BATCH);
  if (!slice.length) return;
  const frag = document.createDocumentFragment();
  for (const post of slice) frag.appendChild(buildCard(post));
  column.appendChild(frag);
  shown += slice.length;
  requestAnimationFrame(clampPending);
}

function ensureFilled() {
  let guard = 0;
  while (guard < 5 && shown < posts.length && scroller.scrollHeight <= scroller.clientHeight + 4) {
    renderMore();
    guard += 1;
  }
}

function sync(force) {
  const next = collect();
  const sameHead = (!next.length && !posts.length) || (next[0] && posts[0] && next[0].key === posts[0].key);
  const sameTail = next.length === posts.length && sameHead && (
    !next.length || (next[next.length - 1] && posts[posts.length - 1] && next[next.length - 1].key === posts[posts.length - 1].key)
  );
  if (!force && sameTail) return;
  const atTop = scroller.scrollTop < 2;
  if (!force && !atTop) {
    if (sameHead) posts = next;
    return;
  }
  posts = next;
  shown = 0;
  column.replaceChildren();
  ensureFilled();
}

function feedOn() {
  return root.style.display !== 'none';
}

// Opaque feed is its own screen. The class lifts the layout toggle above
// that screen and tells the globe loop to skip frames. Peek and map mode
// clear it so the map chrome comes back as it was.
function syncCover() {
  const open = root.style.display !== 'none' && !root.classList.contains('is-peek');
  document.documentElement.classList.toggle('feed-app', open);
}

function rememberScroll() {
  if (root.classList.contains('is-peek')) return;
  savedScroll = scroller.scrollTop;
  if (!window.layerIsOpen || !window.layerIsOpen('feed')) return;
  if (window.layerIsOpen('markerpopup') || window.layerIsOpen('feedfly')) return;
  window.layerOpened('feed', { scroll: savedScroll });
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
  const lngLat = ringCenter(polygon);
  if (!node || !lngLat) return false;
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
  if (on) {
    peek = false;
    root.classList.remove('is-peek');
    root.style.display = 'block';
    syncCover();
    sync(column.childElementCount === 0 || scroller.scrollTop < 2);
    return;
  }
  peek = false;
  revealToken += 1;
  root.classList.remove('is-peek');
  root.style.display = 'none';
  syncCover();
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

bindPress(btn);
btn.addEventListener('click', () => {
  applyFeed(!feedOn());
});

root.addEventListener('click', (event) => event.stopPropagation());

scroller.addEventListener('scroll', () => {
  if (root.classList.contains('is-peek')) return;
  savedScroll = scroller.scrollTop;
  if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < scroller.clientHeight * 0.6) {
    renderMore();
  }
  if (scrollTicket) return;
  scrollTicket = requestAnimationFrame(() => {
    scrollTicket = 0;
    rememberScroll();
  });
}, { passive: true });

paintToggle(false);
if (savedMode() === 'feed') applyFeed(true);

setInterval(() => {
  if (!feedOn() || root.classList.contains('is-peek')) return;
  sync(false);
}, 2000);
