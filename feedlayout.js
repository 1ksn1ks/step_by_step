// Optional feed column for the topic already loaded on the globe.
// Map mode is the default and does not push a history entry.

import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { currentUfoModelInGLTF, globalLoadedTopicIdsWithNames } from './letall.js';
import { markerPopupNode, polygonPopupNode, mountPostReactions, buildPopupProfile } from './processallmessages.js';
import { BACKEND_URL, fetchMessagesBackend, streamOnTopic, messageSig, fetchFollowing } from './msgbackend.js';
import { createChunkAssembler, ingestMirrorRows } from './hcschunks.js';
import { initialTopicId } from './extracttopic.js';
import { connectedAccount } from './web3.js';
import { toast } from './toast.js';
import { activeMarkerPopups } from './marker.js';
import { activePolygonPopups } from './polygons.js';
import { animateMapTo, cancelAnimateMapTo } from './animatemapto.js';
import { MARKER_ZOOM } from './openplace.js';
import { ringCenter } from './polygonframe.js';
import { CloseALL, changePopupState, popIsOpen } from './cssLogic.js';
import { closeDrawAnchor, openDrawColumn } from './drawhere.js';
import { closePressAnchor } from './poiinfo.js';
import { applyAllStyles } from './loadprofilepopup.js';
import { scene } from './threejs.js';
import { profilePictures, usernames, click2url } from './loadalladata.js';
import { paintHashtags, singleLineText } from './hashtag.js';
import { earlyHashinalNumber } from './earlyhashinal.js';
import { EARLY_POPUP_CLASS } from './earlypopup.js';
import { openPreview } from './fullscreenmedia.js';

const LAYOUT_KEY = 'layoutMode';
const FEED_SETTING = {
  tab: 'feed-setting-tab',
  autoplay: 'feed-setting-autoplay',
  data: 'feed-setting-data',
  density: 'feed-setting-density',
  fresh: 'feed-setting-fresh',
  location: 'feed-setting-location',
};
const feedPrefs = {
  tab: 'all',
  autoplay: false,
  dataSaver: false,
  density: 'comfortable',
  fresh: 'pill',
  location: true,
};
let settingsOpen = false;

function readFeedPrefs() {
  try {
    const tab = localStorage.getItem(FEED_SETTING.tab);
    if (tab === 'all' || tab === 'following') feedPrefs.tab = tab;
    feedPrefs.autoplay = localStorage.getItem(FEED_SETTING.autoplay) === 'on';
    feedPrefs.dataSaver = localStorage.getItem(FEED_SETTING.data) === 'on';
    const density = localStorage.getItem(FEED_SETTING.density);
    if (density === 'compact' || density === 'comfortable') feedPrefs.density = density;
    const fresh = localStorage.getItem(FEED_SETTING.fresh);
    if (fresh === 'pill' || fresh === 'jump') feedPrefs.fresh = fresh;
    const location = localStorage.getItem(FEED_SETTING.location);
    if (location === 'on') feedPrefs.location = true;
    if (location === 'off') feedPrefs.location = false;
  } catch {
    /* private mode */
  }
}

function writeFeedSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

readFeedPrefs();
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

const tabs = document.createElement('div');
tabs.id = 'feed-tabs';
tabs.setAttribute('role', 'tablist');
const allTab = document.createElement('button');
allTab.type = 'button';
allTab.className = 'feed-tab';
allTab.id = 'feed-tab-all';
allTab.setAttribute('role', 'tab');
allTab.textContent = 'All';
const followTab = document.createElement('button');
followTab.type = 'button';
followTab.className = 'feed-tab';
followTab.id = 'feed-tab-following';
followTab.setAttribute('role', 'tab');
followTab.textContent = 'Following';
const tabSlide = document.createElement('div');
tabSlide.className = 'feed-tabs-slide';
tabSlide.append(allTab, followTab);
tabs.append(tabSlide);
const tabRuler = document.createElement('div');
tabRuler.id = 'feed-tab-ruler';
tabRuler.setAttribute('aria-hidden', 'true');

const newPill = document.createElement('button');
newPill.id = 'feed-new-posts';
newPill.type = 'button';
newPill.hidden = true;
newPill.setAttribute('aria-label', 'New posts');
newPill.appendChild(svgIcon([
  ['path', { d: 'm5 12 7-7 7 7' }],
  ['path', { d: 'M12 19V5' }],
]));
const newFaces = document.createElement('span');
newFaces.className = 'feed-new-faces';
const newLabel = document.createElement('span');
newLabel.className = 'feed-new-label';
newLabel.textContent = 'posted';
newPill.append(newFaces, newLabel);

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
const topicBtn = document.createElement('button');
topicBtn.id = 'feed-topic-btn';
topicBtn.type = 'button';
const topicCopy = document.createElement('span');
topicCopy.className = 'feed-topic-copy';
const topicText = document.createElement('span');
topicText.className = 'feed-topic-label';
const topicIdLine = document.createElement('span');
topicIdLine.className = 'feed-topic-id';
topicIdLine.hidden = true;
topicCopy.append(topicText, topicIdLine);
topicBtn.append(topicCopy, svgIcon([
  ['path', { d: 'm6 9 6 6 6-6' }],
]));
const tools = document.createElement('div');
tools.className = 'feed-toolbar-slot';
tools.append(topicBtn);
const searchBtnFeed = document.createElement('button');
searchBtnFeed.id = 'feed-search-btn';
searchBtnFeed.type = 'button';
searchBtnFeed.setAttribute('aria-label', 'Search');
searchBtnFeed.setAttribute('aria-expanded', 'false');
searchBtnFeed.title = 'Search';
searchBtnFeed.appendChild(svgIcon([
  ['circle', { cx: '11', cy: '11', r: '8' }],
  ['path', { d: 'm21 21-4.3-4.3' }],
]));
const postBtn = document.createElement('button');
postBtn.id = 'feed-post-btn';
postBtn.type = 'button';
postBtn.setAttribute('aria-label', 'New post');
postBtn.title = 'New post';
postBtn.appendChild(svgIcon([
  ['path', { d: 'M5 12h14' }],
  ['path', { d: 'M12 5v14' }],
]));
const searchBar = document.createElement('div');
searchBar.id = 'feed-search';
searchBar.hidden = true;
const searchInput = document.createElement('input');
searchInput.id = 'feed-search-input';
searchInput.type = 'text';
searchInput.setAttribute('aria-label', 'Search posts');
searchInput.placeholder = 'Search';
searchInput.autocomplete = 'off';
searchInput.autocapitalize = 'off';
searchInput.spellcheck = false;
searchInput.enterKeyHint = 'search';
const searchClose = document.createElement('button');
searchClose.id = 'feed-search-close';
searchClose.type = 'button';
searchClose.setAttribute('aria-label', 'Close search');
searchClose.title = 'Close search';
searchClose.appendChild(svgIcon([
  ['path', { d: 'M18 6 6 18' }],
  ['path', { d: 'm6 6 12 12' }],
]));
searchBar.append(searchInput, searchClose);
toolbar.append(menuAnchor, tools, searchBtnFeed, postBtn, searchBar);
const frame = document.createElement('div');
frame.id = 'feed-frame';
frame.append(toolbar, tabs, tabRuler, newPill, scroller);
root.append(dim, frame, menuDim, menu);

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
let shown = [];
let found = [];
let searchQuery = '';
let searchOpen = false;
let searchTimer = 0;
let searchPinned = false;
let pinScroll = 0;
let pinStart = 0;
let pinEnd = 0;
let feedTab = 'all';
let tabToken = 0;
let followState = 'idle';
let followSet = null;
let rangeStart = 0;
let rangeEnd = 0;
const held = { all: [], following: [] };
const tabScroll = { all: 0, following: 0 };
const tabRange = {
  all: { start: 0, end: 0 },
  following: { start: 0, end: 0 },
};
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
let tabLastY = 0;
let tabOffset = 0;
let tabHidePx = 0;
let tabDir = 0;
let tabPending = 0;
let tabTrackHold = false;
let tabFollowQueued = false;
let tabSettleTimer = 0;
let tabSettleGen = 0;
let peek = false;
let placing = false;
let drawWasOpen = false;
let placeToken = 0;
let placeBusy = false;
let revealToken = 0;
let scrollIdle = 0;
let viewObserver = null;
let scrollFrameQueued = false;
const viewIntersecting = new Set();
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

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }
  return date.getDate() + ' ' + SHORT_MONTHS[date.getMonth()];
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

// 1dvmin. clientX is CSS pixels, and 1dvmin is 1% of the shorter viewport side.
function feedDragLimit() {
  return Math.min(window.innerWidth, window.innerHeight) * 0.01;
}

function feedSelectionEmpty() {
  const sel = window.getSelection && window.getSelection();
  return !sel || !String(sel).length;
}

let feedPress = null;
column.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  feedPress = { x: event.clientX, y: event.clientY };
});

function feedActIdle(event) {
  if (!feedSelectionEmpty()) return false;
  if (!feedPress) return true;
  const dx = event.clientX - feedPress.x;
  const dy = event.clientY - feedPress.y;
  return Math.hypot(dx, dy) < feedDragLimit();
}

// Sits over a photo, or over a video above the native control strip.
// Move and wheel listeners stay off this node so a drag still scrolls the feed.
// A finger that stays inside 1dvmin plays or pauses.
function coverFeedPlayer(media, onTap) {
  const hit = document.createElement('div');
  hit.className = 'feed-media-hit';
  if (media.querySelector('video')) hit.classList.add('is-video');
  let start = null;
  hit.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  hit.addEventListener('pointerup', (event) => {
    const from = start;
    start = null;
    if (!from || from.id !== event.pointerId) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.hypot(dx, dy) >= feedDragLimit() || !feedSelectionEmpty()) return;
    onTap();
  });
  hit.addEventListener('pointercancel', () => {
    start = null;
  });
  media.appendChild(hit);
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

// The comment count hangs to the right of the icon. This spacer is the same
// text, so share stays one gap past the count and the icon stays centred.
function commentCountSpace(comment) {
  const space = document.createElement('span');
  space.className = 'feed-comment-count-space';
  space.setAttribute('aria-hidden', 'true');
  const label = comment.querySelector('label');
  const input = comment.querySelector('input');
  const paint = () => {
    if (!label) return;
    const shown = input && input.checked ? label.dataset.next : label.dataset.count;
    space.textContent = shown || '0';
  };
  paint();
  if (label) {
    new MutationObserver(paint).observe(label, {
      attributes: true,
      attributeFilter: ['data-count', 'data-next'],
    });
  }
  if (input) input.addEventListener('change', paint);
  return space;
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

// Half the card inside the scroller. The observer's rootMargin is wider
// than this, so a view still waits until the card is actually on screen.
function cardInView(card) {
  const root = scroller.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const height = Math.max(0, Math.min(root.bottom, box.bottom) - Math.max(root.top, box.top));
  const width = Math.max(0, Math.min(root.right, box.right) - Math.max(root.left, box.left));
  const area = box.height * box.width;
  return area > 0 && (height * width) / area >= 0.5;
}

function syncCardView(card) {
  if (cardInView(card)) armView(card);
  else disarmView(card);
}

function warmFeedVideo(card) {
  const video = card.querySelector('.popup-media-card video');
  if (!video || video.preload !== 'none' || !video.paused) return;
  video.preload = 'metadata';
}

function linkInfo() {
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
}

// null means the browser has no Network Information API.
function connectionConstrained() {
  const net = linkInfo();
  if (!net) return null;
  if (net.saveData) return true;
  if (net.type === 'cellular') return true;
  const kind = net.effectiveType;
  if (kind === 'slow-2g' || kind === '2g') return true;
  return false;
}

function autoplayAllowed() {
  if (!feedPrefs.autoplay) return false;
  if (!feedPrefs.dataSaver) return true;
  const constrained = connectionConstrained();
  if (constrained == null) return false;
  return !constrained;
}

function startFeedVideo(video) {
  video.playsInline = true;
  if (video.preload === 'none') video.preload = 'metadata';
  if (video.dataset.feedAuto !== '1') video.muted = true;
  video.dataset.feedAuto = '1';
  if (!video.paused) return;
  const started = video.play();
  if (started && typeof started.catch === 'function') {
    started.catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });
  }
}

function syncFeedVideo(card) {
  const video = card.querySelector('.popup-media-card video');
  if (!video) return;
  const allow = autoplayAllowed() && !settingsOpen && cardInView(card) && feedCovers();
  if (allow && video.dataset.feedHold !== '1') {
    startFeedVideo(video);
    return;
  }
  if (!allow && video.dataset.feedAuto === '1') {
    delete video.dataset.feedHold;
    delete video.dataset.feedAuto;
    if (!video.paused) video.pause();
  }
}

function syncFeedVideos() {
  for (const card of column.querySelectorAll('.feed-card')) syncFeedVideo(card);
}

function syncVisibleViews() {
  if (!viewObserver) return;
  for (const card of viewIntersecting) {
    if (!card.isConnected) {
      viewIntersecting.delete(card);
      continue;
    }
    syncCardView(card);
    syncFeedVideo(card);
  }
}

function scheduleScrollFrame() {
  if (scrollFrameQueued) return;
  scrollFrameQueued = true;
  requestAnimationFrame(() => {
    scrollFrameQueued = false;
    syncVisibleViews();
    clampPending();
  });
}

function viewObserverOptions() {
  const options = { root: scroller, rootMargin: '100dvh', threshold: 0 };
  try {
    const probe = new IntersectionObserver(() => {}, options);
    probe.disconnect();
    return options;
  } catch {
    options.rootMargin = Math.round(window.innerHeight) + 'px';
    return options;
  }
}

function ensureViewObserver() {
  if (viewObserver) return viewObserver;
  viewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        viewIntersecting.add(entry.target);
        warmFeedVideo(entry.target);
      } else {
        viewIntersecting.delete(entry.target);
        syncFeedVideo(entry.target);
      }
      syncCardView(entry.target);
    }
  }, viewObserverOptions());
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
  viewIntersecting.delete(card);
  disarmView(card);
}

function clearViewWatch() {
  if (viewObserver) viewObserver.disconnect();
  viewIntersecting.clear();
  for (const timer of viewTimers.values()) clearTimeout(timer);
  viewTimers.clear();
}

function paintFeedHashinal(card) {
  const payer = card && card.dataset ? card.dataset.payer || '' : '';
  card.classList.toggle(EARLY_POPUP_CLASS, earlyHashinalNumber(payer) > 0);
}

document.addEventListener('early-hashinals', () => {
  for (const card of column.children) {
    if (card.classList && card.classList.contains('feed-card')) paintFeedHashinal(card);
  }
});

function feedTitle(record) {
  const raw = singleLineText(String(record && record.title || '').slice(0, 20));
  if (!raw.trim()) return null;
  const title = document.createElement('strong');
  title.className = 'title_color popup-title-bubble';
  paintHashtags(title, raw);
  const picker = document.getElementById('color-picker-popup-titles');
  if (picker && picker.value) title.style.color = picker.value;
  return title;
}

function buildCard(post) {
  const record = recordFor(post) || {};
  const card = document.createElement('article');
  card.className = 'feed-card';
  card.dataset.key = post.key;

  const payer = record.payer || '';
  card.dataset.payer = payer;
  const profile = buildPopupProfile({
    profileUrl: record.profileUrl || DEFAULT_PIC,
    payer,
    payerInfo: record.payerInfo || 'Anonymous',
    username: record.username || '',
    click2link: record.click2link || '',
  });
  card.appendChild(profile);
  paintFeedHashinal(card);
  const title = feedTitle(record);
  if (title) card.appendChild(title);
  if (payer) {
    // Capture runs before the Hashpack and click2url anchors. preventDefault
    // keeps those links from navigating. stopPropagation keeps this tap from
    // reaching the document click that closes every panel.
    profile.addEventListener('click', (event) => {
      const hit = event.target && event.target.closest && event.target.closest('img, h2');
      if (!hit || !profile.contains(hit)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!feedActIdle(event)) return;
      holdScroll();
      if (window.loadBio4PIC) window.loadBio4PIC(payer);
    }, true);
  }

  let media = null;
  const src = mediaOf(record.image);
  if (src) {
    media = document.createElement('div');
    media.className = 'popup-media-card';
    const video = isVideo(src);
    const node = video ? document.createElement('video') : document.createElement('img');
    if (video) {
      node.controls = true;
      node.playsInline = true;
      node.preload = 'none';
      const poster = mediaOf(record.coverimage);
      if (poster && !isVideo(poster)) node.poster = poster;
      node.src = src;
      media.appendChild(node);
      coverFeedPlayer(media, () => {
        if (node.paused) {
          delete node.dataset.feedHold;
          const started = node.play();
          if (started && typeof started.catch === 'function') started.catch(() => {});
        } else {
          node.dataset.feedHold = '1';
          node.pause();
        }
      });
    } else {
      node.alt = '';
      node.draggable = false;
      node.loading = 'lazy';
      node.decoding = 'async';
      node.src = src;
      media.appendChild(node);
      coverFeedPlayer(media, () => {
        holdScroll();
        openPreview(src);
      });
    }
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
  const actionLeft = document.createElement('div');
  actionLeft.className = 'feed-actions-left';
  const actionMid = document.createElement('div');
  actionMid.className = 'feed-actions-mid';
  const actionRight = document.createElement('div');
  actionRight.className = 'feed-actions-right';
  const meta = document.createElement('div');
  meta.className = 'feed-meta';
  const left = document.createElement('div');
  left.className = 'feed-meta-left';
  const right = document.createElement('div');
  right.className = 'feed-meta-right';
  const loc = document.createElement('button');
  loc.type = 'button';
  loc.className = 'feed-loc';
  loc.appendChild(pinIcon());
  const whereText = document.createElement('span');
  whereText.className = 'feed-loc-label';
  if (post.place) {
    const place = document.createElement('span');
    place.className = 'feed-loc-place';
    place.textContent = post.place;
    const sep = document.createElement('span');
    sep.className = 'feed-loc-sep';
    sep.textContent = ' · ';
    whereText.append(place, sep);
  }
  const coords = document.createElement('span');
  coords.className = 'feed-loc-coords';
  coords.textContent = coordLabel(post.lngLat);
  whereText.appendChild(coords);
  loc.appendChild(whereText);
  loc.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!feedActIdle(event)) return;
    openOnMap(post);
  });
  left.appendChild(loc);
  if ((post.kind === 'marker' || post.kind === 'polygon') && record.topicId && record.timestamp) {
    const cluster = document.createElement('div');
    mountPostReactions(cluster, record, post.kind, card);
    const heart = cluster.querySelector('.heart-like:not(.comment-bubble):not(.share-bubble)');
    const comment = cluster.querySelector('.comment-bubble');
    const share = cluster.querySelector('.share-bubble');
    if (heart) actionLeft.appendChild(heart);
    if (comment) {
      actionMid.appendChild(comment);
      actionRight.appendChild(commentCountSpace(comment));
    }
    if (share) actionRight.appendChild(share);
  }
  actionRight.appendChild(viewChip(post.key));
  actions.append(actionLeft, actionMid, actionRight);
  const time = document.createElement('div');
  time.className = 'popup-timestamp';
  const fullTime = document.createElement('span');
  fullTime.className = 'feed-time-full';
  fullTime.textContent = record.timestamp || clock(post.time);
  const briefTime = document.createElement('span');
  briefTime.className = 'feed-time-short';
  briefTime.textContent = shortClock(post.time) || fullTime.textContent;
  time.append(fullTime, briefTime);
  right.appendChild(time);
  meta.append(left, right);
  card.append(actions, meta);
  return card;
}

function clampPending() {
  column.querySelectorAll('.popup-text-bubble[data-clamp="1"]').forEach((text) => {
    delete text.dataset.clamp;
    text.classList.remove('is-clamped');
    const full = text.getBoundingClientRect().height;
    text.classList.add('is-clamped');
    const clipped = text.getBoundingClientRect().height;
    if (!(full > clipped + 1)) {
      text.classList.remove('is-clamped');
      return;
    }
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
  shown = [];
  found = [];
  searchPinned = false;
  pinScroll = 0;
  pinStart = 0;
  pinEnd = 0;
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
  setFeedScroll(0);
  resetQueues();
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
    payer,
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
    payer,
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
    payer,
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
    payer: message.payer || '',
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

function walletNow() {
  const account = typeof connectedAccount === 'string' ? connectedAccount.trim() : '';
  if (/^\d+\.\d+\.\d+$/.test(account) && account.length <= 40) return account;
  return '';
}

function lane() {
  if (searchQuery) return found;
  return feedTab === 'following' ? shown : posts;
}

function tabPosts() {
  return feedTab === 'following' ? shown : posts;
}

function hitQuery(post) {
  if (!searchQuery || !post) return false;
  const record = recordFor(post) || {};
  const parts = [textOf(record.msg), record.title, record.username, record.payer, record.payerInfo, post.payer];
  for (const part of parts) {
    if (part != null && String(part).toLowerCase().includes(searchQuery)) return true;
  }
  return false;
}

function syncFound() {
  found = [];
  if (!searchQuery) return;
  for (const post of tabPosts()) {
    if (hitQuery(post)) found.push(post);
  }
}

function shiftPin(count) {
  if (!searchPinned || !count) return;
  pinStart += count;
  pinEnd += count;
}

function takeFollowed(list) {
  if (!followSet) return [];
  const out = [];
  for (const post of list) {
    if (post && followSet.has(post.payer)) out.push(post);
  }
  return out;
}

function followBlocked() {
  return feedTab === 'following' && followState !== 'ready';
}

function paintTabs() {
  const all = feedTab !== 'following';
  allTab.setAttribute('aria-selected', all ? 'true' : 'false');
  followTab.setAttribute('aria-selected', all ? 'false' : 'true');
  allTab.tabIndex = all ? 0 : -1;
  followTab.tabIndex = all ? -1 : 0;
}

function searchMiss() {
  if (!searchQuery || paging) return false;
  if (feedTab === 'following' && followState === 'loading') return false;
  if (followBlocked()) return true;
  return exhausted;
}

function paintEmpty() {
  const old = column.querySelector('.feed-empty');
  if (old) old.remove();
  let text = '';
  if (searchQuery && found.length === 0 && searchMiss()) text = 'No posts found';
  else if (!searchQuery && feedTab === 'following' && followState === 'nowallet') text = 'Connect your wallet to see who you follow';
  else if (!searchQuery && feedTab === 'following' && followState === 'empty') text = "You're not following anyone yet";
  if (!text) return;
  const note = document.createElement('p');
  note.className = 'feed-empty';
  note.textContent = text;
  column.appendChild(note);
}

function rerenderLane(opts) {
  if (!opts || !opts.keepHeld) {
    held[feedTab] = [];
    tabScroll[feedTab] = 0;
    tabRange[feedTab] = { start: 0, end: 0 };
  }
  if (searchQuery) syncFound();
  rangeStart = 0;
  rangeEnd = 0;
  savedScroll = 0;
  setFeedScroll(0);
  clearViewWatch();
  column.replaceChildren();
  paintEmpty();
  if (!followBlocked()) fillDown();
  else paintEmpty();
  paintNewPill();
}

async function selectTab(next) {
  if (next !== 'all' && next !== 'following') return;
  if (next === feedTab) return;
  if (searchQuery && searchPinned) {
    tabScroll[feedTab] = pinScroll;
    tabRange[feedTab] = { start: pinStart, end: pinEnd };
  } else saveTabView();
  if (searchQuery) {
    searchPinned = true;
    pinScroll = 0;
    pinStart = 0;
    pinEnd = 0;
  }
  const token = ++tabToken;
  feedTab = next;
  paintTabs();
  showFeedTabs();
  if (next === 'all') {
    if (searchQuery) rerenderLane({ keepHeld: true });
    else restoreTabView();
    return;
  }
  const account = walletNow();
  if (!account) {
    followState = 'nowallet';
    followSet = null;
    shown = [];
    rerenderLane();
    return;
  }
  followState = 'loading';
  clearViewWatch();
  column.replaceChildren();
  rangeStart = 0;
  rangeEnd = 0;
  if (!searchQuery) {
    setFeedScroll(0);
    savedScroll = 0;
  }
  paintEmpty();
  paintNewPill();
  const data = await fetchFollowing(account);
  if (token !== tabToken || feedTab !== 'following') return;
  if (!data) {
    followState = 'offline';
    followSet = null;
    shown = [];
    paintEmpty();
    paintNewPill();
    return;
  }
  const ids = [];
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  for (const entry of accounts) {
    const raw = typeof entry === 'string' ? entry : entry && entry.id;
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (/^\d+\.\d+\.\d+$/.test(id)) ids.push(id);
  }
  if (!ids.length) {
    followState = 'empty';
    followSet = null;
    shown = [];
    rerenderLane();
    return;
  }
  followSet = new Set(ids);
  followState = 'ready';
  shown = posts.filter((post) => followSet.has(post.payer));
  alignHeld('following');
  if (searchQuery) rerenderLane({ keepHeld: true });
  else restoreTabView();
}

function renderThrough(end) {
  if (end <= rangeEnd) return;
  const note = column.querySelector('.feed-empty');
  if (note) note.remove();
  const list = lane();
  const frag = document.createDocumentFragment();
  const cards = [];
  for (let i = rangeEnd; i < end; i++) {
    const card = buildCard(list[i]);
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
    setFeedScroll(Math.max(0, scroller.scrollTop - drop));
  }
}

function fillUp() {
  if (paging || scroller.scrollTop > scroller.clientHeight || rangeStart <= laneFloor()) return;
  const add = Math.min(RENDER_CHUNK, rangeStart - laneFloor());
  const prevTop = scroller.scrollTop;
  const prevHeight = scroller.scrollHeight;
  const frag = document.createDocumentFragment();
  const cards = [];
  const list = lane();
  for (let i = rangeStart - add; i < rangeStart; i++) {
    const card = buildCard(list[i]);
    cards.push(card);
    frag.appendChild(card);
  }
  column.prepend(frag);
  rangeStart -= add;
  setFeedScroll(prevTop + (scroller.scrollHeight - prevHeight));
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
}

function fillDown() {
  if (!feedOn() || root.classList.contains('is-peek') || paging) return;
  if (followBlocked()) {
    if (searchQuery) paintEmpty();
    return;
  }
  const list = lane();
  if (scroller.clientHeight < 1) {
    if (rangeEnd < list.length) renderThrough(Math.min(list.length, rangeEnd + RENDER_CHUNK));
    return;
  }
  let guard = 0;
  while (guard < 12) {
    guard += 1;
    const room = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const short = scroller.scrollHeight <= scroller.clientHeight + 4;
    if (!short && room >= scroller.clientHeight * 2) {
      paintEmpty();
      return;
    }
    if (rangeEnd < list.length) {
      renderThrough(Math.min(list.length, rangeEnd + RENDER_CHUNK));
      trimAbove();
      continue;
    }
    if (!exhausted) loadOlder();
    else paintEmpty();
    return;
  }
}

function laneFloor() {
  return searchQuery ? 0 : held[feedTab].length;
}

function tabIsAtTop(tab) {
  if (held[tab].length) return false;
  if (tab === feedTab && searchQuery) {
    const start = searchPinned ? pinStart : 0;
    const scroll = searchPinned ? pinScroll : 0;
    return start === 0 && scroll < 2;
  }
  if (tab === feedTab) return rangeStart === 0 && scroller.scrollTop < 2;
  return tabRange[tab].start === 0 && tabScroll[tab] < 2;
}

function saveTabView() {
  if (searchQuery) return;
  tabScroll[feedTab] = scroller.scrollTop;
  tabRange[feedTab] = { start: rangeStart, end: rangeEnd };
}

function resetQueues() {
  held.all = [];
  held.following = [];
  tabScroll.all = 0;
  tabScroll.following = 0;
  tabRange.all = { start: 0, end: 0 };
  tabRange.following = { start: 0, end: 0 };
  paintNewPill();
}

function faceUrl(post) {
  const payer = post && post.payer;
  const pic = payer && profilePictures[payer] && profilePictures[payer].url;
  if (typeof pic === 'string' && pic) return pic;
  const record = recordFor(post);
  if (record && typeof record.profileUrl === 'string' && record.profileUrl) return record.profileUrl;
  return DEFAULT_PIC;
}

function paintNewFaces(list) {
  const urls = [];
  const seen = new Set();
  for (const post of list) {
    const payer = post && post.payer ? post.payer : '';
    if (seen.has(payer)) continue;
    seen.add(payer);
    urls.push(faceUrl(post));
    if (urls.length === 3) break;
  }
  newFaces.replaceChildren();
  for (const url of urls) {
    const img = document.createElement('img');
    img.className = 'feed-new-face';
    img.alt = '';
    img.decoding = 'async';
    img.src = url;
    newFaces.appendChild(img);
  }
}

function paintNewPill() {
  if (feedPrefs.fresh === 'jump') {
    newPill.hidden = true;
    newPill.classList.remove('is-in');
    return;
  }
  const show = feedOn() && !root.classList.contains('is-peek') && !searchQuery && held[feedTab].length > 0;
  if (!show) {
    newPill.hidden = true;
    newPill.classList.remove('is-in');
    return;
  }
  paintNewFaces(held[feedTab]);
  const fresh = newPill.hidden;
  newPill.hidden = false;
  if (!fresh) return;
  newPill.classList.remove('is-in');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!newPill.hidden) newPill.classList.add('is-in');
    });
  });
}

// Posts that arrive below the top stay out of that tab's window. held[tab]
// is the newest prefix of that tab's lane, in the same order as the lane.
function noteHeld(tab, batch) {
  if (!batch.length || tabIsAtTop(tab)) return false;
  held[tab].unshift(...batch);
  tabRange[tab].start += batch.length;
  tabRange[tab].end += batch.length;
  if (tab === feedTab && !searchQuery) {
    rangeStart += batch.length;
    rangeEnd += batch.length;
  }
  return true;
}

function alignHeld(tab) {
  const list = tab === 'following' ? shown : posts;
  const next = [];
  for (let i = 0; i < held[tab].length && i < list.length; i++) {
    if (list[i] !== held[tab][i]) break;
    next.push(list[i]);
  }
  held[tab] = next;
}

function mountIncoming(incoming, searchLane) {
  if (!incoming.length) return;
  const atTop = scroller.scrollTop < 2;
  const showingTop = rangeStart === 0;
  const prevTop = scroller.scrollTop;
  const prevHeight = scroller.scrollHeight;
  rangeStart += incoming.length;
  rangeEnd += incoming.length;
  if (!showingTop) return;
  const frag = document.createDocumentFragment();
  const cards = [];
  const note = column.querySelector('.feed-empty');
  if (note) note.remove();
  for (const post of incoming) {
    const card = buildCard(post);
    cards.push(card);
    frag.appendChild(card);
  }
  column.prepend(frag);
  rangeStart = searchLane ? 0 : rangeStart - incoming.length;
  const delta = scroller.scrollHeight - prevHeight;
  setFeedScroll(atTop ? 0 : prevTop + delta);
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
  trimAbove();
}

function prependPosts(list) {
  if (!list.length) return;
  const followed = takeFollowed(list);
  posts.unshift(...list);
  if (followSet) shown.unshift(...followed);
  shiftPin(feedTab === 'following' ? followed.length : list.length);
  let searchIncoming = [];
  if (searchQuery) {
    const pool = feedTab === 'following' ? followed : list;
    for (const post of pool) if (hitQuery(post)) searchIncoming.push(post);
    if (searchIncoming.length) found.unshift(...searchIncoming);
  }
  const heldAll = noteHeld('all', list);
  const heldFollow = followSet ? noteHeld('following', followed) : false;
  if (searchQuery) mountIncoming(searchIncoming, true);
  else if (feedTab === 'following') {
    if (!heldFollow) mountIncoming(followed, false);
  } else if (!heldAll) mountIncoming(list, false);
  const jump = !searchQuery && feedPrefs.fresh === 'jump' && (
    (feedTab === 'following' && heldFollow) || (feedTab !== 'following' && heldAll)
  );
  if (jump) goToFreshPosts();
  else paintNewPill();
}

function scrollMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function prependAbove(count) {
  const n = Math.min(count, rangeStart, lane().length);
  if (n <= 0) return;
  const list = lane();
  const prevTop = scroller.scrollTop;
  const prevHeight = scroller.scrollHeight;
  const frag = document.createDocumentFragment();
  const cards = [];
  const note = column.querySelector('.feed-empty');
  if (note) note.remove();
  for (let i = 0; i < n; i++) {
    const card = buildCard(list[i]);
    cards.push(card);
    frag.appendChild(card);
  }
  column.prepend(frag);
  rangeStart -= n;
  setFeedScroll(prevTop + (scroller.scrollHeight - prevHeight));
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
}

function revealParked() {
  if (searchQuery || root.classList.contains('is-peek')) return;
  const tab = feedTab;
  const n = held[tab].length;
  if (!n || scroller.scrollTop >= 2 || rangeStart !== n) return;
  held[tab] = [];
  prependAbove(n);
  setFeedScroll(0);
  savedScroll = 0;
  tabScroll[tab] = 0;
  tabRange[tab] = { start: 0, end: rangeEnd };
  paintNewPill();
}

function goToFreshPosts() {
  const tab = feedTab;
  if (!held[tab].length && scroller.scrollTop < 2) {
    paintNewPill();
    return;
  }
  held[tab] = [];
  paintNewPill();
  if (searchQuery) {
    feedScrollTo({ top: 0, behavior: scrollMotion() });
    return;
  }
  if (rangeStart > 0 && rangeStart <= 60) prependAbove(rangeStart);
  else if (rangeStart > 60) {
    clearViewWatch();
    column.replaceChildren();
    rangeStart = 0;
    rangeEnd = 0;
    const end = Math.min(lane().length, RENDER_CHUNK);
    if (end) renderThrough(end);
    paintEmpty();
    setFeedScroll(Math.min(scroller.clientHeight * 0.65, scroller.scrollHeight));
  }
  tabScroll[tab] = 0;
  tabRange[tab] = { start: rangeStart, end: rangeEnd };
  savedScroll = 0;
  feedScrollTo({ top: 0, behavior: scrollMotion() });
}

function restoreTabView() {
  const tab = feedTab;
  alignHeld(tab);
  const list = lane();
  let start = tabRange[tab].start;
  const floor = held[tab].length;
  if (start < floor) start = floor;
  if (start > list.length) start = list.length;
  let end = tabRange[tab].end;
  if (end < start) end = start;
  if (end > list.length) end = list.length;
  if (end === start) end = Math.min(list.length, start + RENDER_CHUNK);
  rangeStart = start;
  rangeEnd = start;
  clearViewWatch();
  column.replaceChildren();
  if (end > start) renderThrough(end);
  paintEmpty();
  setFeedScroll(tabScroll[tab]);
  savedScroll = scroller.scrollTop;
  tabRange[tab] = { start: rangeStart, end: rangeEnd };
  paintNewPill();
  if (!followBlocked()) {
    fillDown();
    fillUp();
  }
  revealParked();
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
    const made = ingest(messages);
    posts.push(...made);
    const added = feedTab === 'following' ? takeFollowed(made) : made;
    if (feedTab === 'following') shown.push(...added);
    if (searchQuery) {
      for (const post of added) if (hitQuery(post)) found.push(post);
    }
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
  if (placing && made.some(ownPlace)) returnToFeed(true);
}

function bindStream(topic) {
  if (streamOff) streamOff();
  streamOff = streamOnTopic(topic, onStream);
}

function topicName(topicId) {
  const prefix = `${topicId} - `;
  for (const entry of globalLoadedTopicIdsWithNames) {
    const row = String(entry || '');
    if (!row.startsWith(prefix)) continue;
    const name = row.slice(prefix.length).trim();
    if (name && name !== topicId) return name;
  }
  return '';
}

function paintTopicTitle() {
  const topic = topicNow();
  const name = topicName(topic);
  const label = name || topic || '';
  topicText.textContent = label;
  const showId = !!(name && topic);
  topicIdLine.hidden = !showId;
  topicIdLine.textContent = showId ? topic : '';
  const spoken = showId ? `${name}, ${topic}` : label;
  topicBtn.title = spoken;
  topicBtn.setAttribute('aria-label', spoken ? `Load ${spoken}` : 'Load topic');
}

function ensureTopic(opening) {
  const topic = topicNow();
  paintTopicTitle();
  if (!topic) return;
  if (topic !== loadedTopic) {
    if (streamOff) {
      streamOff();
      streamOff = null;
    }
    resetFeed(topic);
    bindStream(topic);
    if (followBlocked()) paintEmpty();
    else loadOlder();
    return;
  }
  if (opening) catchUp();
  if (!followBlocked() && !paging && !posts.length && !exhausted) loadOlder();
}

function feedOn() {
  return root.style.display !== 'none';
}

// Opaque feed is its own screen. The class tells the globe loop to skip
// frames. Peek and map mode clear it so the map chrome comes back.
function feedCovers() {
  return root.style.display !== 'none' && !root.classList.contains('is-peek');
}

function syncCover() {
  document.documentElement.classList.toggle('feed-app', feedCovers());
  syncLoadOverFeed();
  syncFeedVideos();
}

// The Load panel is painted at 1002, under the feed. Lift only an open
// that started from the feed toolbar. A map open stays at 1002.
let loadOverFeed = false;
let loadLifted = false;

function syncLoadOverFeed() {
  const col = document.getElementById('load-column');
  if (!col) return;
  const shown = col.style.display === 'block';
  if (loadOverFeed && shown && feedCovers()) {
    if (col.style.zIndex !== '8800') col.style.zIndex = '8800';
    loadLifted = true;
    return;
  }
  if (loadLifted && col.style.zIndex === '8800') col.style.zIndex = '1002';
  loadLifted = false;
}

function ensureLoadLayer() {
  const col = document.getElementById('load-column');
  if (!loadOverFeed || !feedCovers()) return;
  if (!col || col.style.display !== 'block') return;
  if (window.layerIsOpen && window.layerIsOpen('load-column')) return;
  if (window.layerOpened) window.layerOpened('load-column');
}

function openLoadFromFeed() {
  if (window.layerIsTop && !window.layerIsTop('feed')) return;
  const trigger = document.getElementById('Load_Everything');
  if (!trigger) return;
  holdScroll();
  loadOverFeed = true;
  trigger.click();
  syncLoadOverFeed();
  ensureLoadLayer();
  // CloseALL may already have queued a history.back that consumes the
  // entry this click just pushed. Put it back once that back has run.
  setTimeout(ensureLoadLayer, 0);
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

window.holdFeedScroll = holdScroll;

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
  requestAnimationFrame(() => { setFeedScroll(y); });
  paintNewPill();
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

function paintSearch(open) {
  toolbar.classList.toggle('is-search', open);
  searchBar.hidden = !open;
  searchBtnFeed.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function pinWindow() {
  if (searchPinned) return;
  searchPinned = true;
  pinScroll = scroller.scrollTop;
  pinStart = rangeStart;
  pinEnd = rangeEnd;
}

function showQueryResults() {
  syncFound();
  rangeStart = 0;
  rangeEnd = 0;
  clearViewWatch();
  column.replaceChildren();
  setFeedScroll(0);
  paintEmpty();
  if (!followBlocked()) fillDown();
  else paintEmpty();
}

function restorePin() {
  const start = Math.min(pinStart, tabPosts().length);
  const end = Math.min(Math.max(pinEnd, start), tabPosts().length);
  const y = pinScroll;
  searchPinned = false;
  pinStart = 0;
  pinEnd = 0;
  pinScroll = 0;
  clearViewWatch();
  column.replaceChildren();
  rangeStart = start;
  rangeEnd = start;
  if (end > start) renderThrough(end);
  paintEmpty();
  setFeedScroll(y);
  savedScroll = y;
  if (!followBlocked()) fillDown();
  setFeedScroll(y);
  savedScroll = y;
  paintNewPill();
  revealParked();
}

function applyQuery(raw) {
  const next = String(raw || '').trim().toLowerCase();
  if (next === searchQuery) return;
  if (!next) {
    searchQuery = '';
    found = [];
    if (searchPinned) restorePin();
    else paintEmpty();
    return;
  }
  pinWindow();
  searchQuery = next;
  showQueryResults();
}

function hideSearch() {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = 0;
  }
  searchOpen = false;
  searchQuery = '';
  found = [];
  searchPinned = false;
  pinScroll = 0;
  pinStart = 0;
  pinEnd = 0;
  searchInput.value = '';
  paintSearch(false);
}

function closeSearch() {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = 0;
  }
  const pinned = searchPinned;
  searchOpen = false;
  searchQuery = '';
  found = [];
  searchInput.value = '';
  paintSearch(false);
  if (pinned) restorePin();
  else paintEmpty();
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedsearch')) {
    window.layerClosedByUI('feedsearch');
  }
}

function openSearch() {
  if (searchOpen) return;
  if (!feedOn() || root.classList.contains('is-peek')) return;
  if (window.layerIsTop && !window.layerIsTop('feed')) return;
  holdScroll();
  searchOpen = true;
  paintSearch(true);
  if (window.layerOpened) window.layerOpened('feedsearch');
  searchInput.focus({ preventScroll: true });
}

function ownPlace(post) {
  const me = walletNow();
  if (!me || !post || post.payer !== me) return false;
  if (post.kind === 'polygon') return true;
  if (post.kind !== 'marker' || !post.feature) return false;
  const number = post.feature.msgNumber;
  return typeof number !== 'string' || !number.startsWith('share-');
}

function walletOverlay() {
  const host = document.querySelector('wcm-modal');
  const rootNode = host && host.shadowRoot;
  if (!rootNode) return null;
  return rootNode.querySelector('.wcm-overlay');
}

function walletModalOpen() {
  const overlay = walletOverlay();
  if (!overlay || !overlay.classList.contains('wcm-active')) return false;
  const box = overlay.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

// web3.js writes "Connecting..." before openModal. That label, or the sheet,
// means the connect flow is still starting and must not be treated as a miss.
function connectPending() {
  const connect = document.getElementById('connect-wallet-btn');
  return !!(connect && /connecting/i.test(connect.textContent || ''));
}

// 'ok' continues into placing. 'cancel' stays on the feed with no toast.
// 'fail' is a real miss and the caller says why.
function ensureWallet() {
  if (walletNow()) return Promise.resolve('ok');
  const connect = document.getElementById('connect-wallet-btn');
  if (!connect) return Promise.resolve('fail');
  if (!walletModalOpen() && !connectPending()) {
    try { connect.click(); } catch (err) { return Promise.resolve('fail'); }
  }
  const started = Date.now();
  let sawSheet = false;
  return new Promise((resolve) => {
    const tick = () => {
      if (walletNow()) {
        resolve('ok');
        return;
      }
      const open = walletModalOpen();
      const connecting = connectPending();
      if (open) sawSheet = true;
      // The overlay can drop while openModal is still resolving. Stay pending
      // until the label clears so a late account still resolves 'ok'.
      if (sawSheet && !open && !connecting) {
        resolve('cancel');
        return;
      }
      if (!sawSheet && !open && !connecting && Date.now() - started >= 4000) {
        resolve('fail');
        return;
      }
      if (Date.now() - started >= 120000) {
        resolve('cancel');
        return;
      }
      setTimeout(tick, 200);
    };
    setTimeout(tick, 200);
  });
}

function restoreMapChrome() {
  const main = document.getElementById('main-toggle-btn');
  const toolbarBtn = document.getElementById('toggle-toolbar-btn-btn');
  const fovBtn = document.getElementById('toggle-your-fov-btn-btn');
  if (main) main.style.display = 'block';
  if (toolbarBtn) toolbarBtn.style.display = 'none';
  if (fovBtn) fovBtn.style.display = 'none';
  const crosshair = document.getElementById('crosshair');
  if (!popIsOpen && currentUfoModelInGLTF && crosshair) {
    scene.add(currentUfoModelInGLTF);
    crosshair.style.display = 'block';
  }
}

// Peek keeps the feedplace entry and leaves layoutMode as feed, so Back
// can close Draw and return to this scroll spot. The caller opens Draw.
function beginPlace() {
  if (!window.layerOpened) return false;
  placing = true;
  drawWasOpen = false;
  holdScroll();
  peek = true;
  root.classList.add('is-peek');
  syncCover();
  try {
    window.layerOpened('feedplace');
  } catch (err) {
    placing = false;
    placeBusy = false;
    peek = false;
    root.classList.remove('is-peek');
    syncCover();
    throw err;
  }
  return root.classList.contains('is-peek');
}

// Hides a form this session opened, then drops feedplace. Callers reveal
// the feed themselves: a skipped popstate never runs the layer close.
function leavePlace() {
  placeToken += 1;
  placeBusy = false;
  const active = placing || (window.layerIsOpen && window.layerIsOpen('feedplace'));
  if (!active) return;
  const openedForm = drawWasOpen;
  placing = false;
  drawWasOpen = false;
  if (openedForm) {
    const col = document.getElementById('draw-column');
    if (col && col.style.display !== 'none') {
      col.style.display = 'none';
      if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('draw-column')) {
        window.layerClosedByUI('draw-column');
      }
    }
    restoreMapChrome();
  }
  closeDrawAnchor();
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedplace')) {
    window.layerClosedByUI('feedplace');
  }
}

function returnToFeed(sent) {
  if (!placing && !(window.layerIsOpen && window.layerIsOpen('feedplace'))) return;
  leavePlace();
  if (!feedOn()) return;
  if (sent) {
    if (feedTab === 'following' && !(followSet && followSet.has(walletNow()))) {
      feedTab = 'all';
      paintTabs();
    }
    savedScroll = 0;
    peek = false;
    root.classList.remove('is-peek');
    syncCover();
    held.all = [];
    held.following = [];
    rerenderLane();
    return;
  }
  reveal();
}

function closePlaceBlockers() {
  if (searchOpen || (window.layerIsOpen && window.layerIsOpen('feedsearch'))) closeSearch();
  if (!menu.hidden || (window.layerIsOpen && window.layerIsOpen('feedmenu'))) closeMenu();
}

function placeSurfaceOpen() {
  return root.classList.contains('is-peek') || walletModalOpen();
}

async function startPost() {
  if (placing || placeBusy) {
    if (placeSurfaceOpen()) {
      toast.info(root.classList.contains('is-peek') ? 'Already placing a post' : 'Finish connecting first');
      return;
    }
    leavePlace();
  }
  if (!feedOn()) {
    toast.info('Feed is closed');
    return;
  }
  if (root.classList.contains('is-peek')) {
    toast.info('Already placing a post');
    return;
  }
  closePlaceBlockers();
  if (window.layerIsTop && !window.layerIsTop('feed')) {
    toast.info('Close this panel first');
    return;
  }
  const token = ++placeToken;
  placeBusy = true;
  let status = 'fail';
  try {
    // One note as the sheet opens. Success and cancel stay quiet.
    if (!walletNow() && !walletModalOpen() && !connectPending()) toast.info('Connect wallet');
    status = await ensureWallet();
  } catch (err) {
    status = 'fail';
  } finally {
    if (token === placeToken) placeBusy = false;
  }
  if (token !== placeToken) return;
  if (status === 'cancel') return;
  if (status !== 'ok') {
    placing = false;
    placeBusy = false;
    toast.info("Couldn't open the wallet");
    return;
  }
  if (!feedOn()) {
    toast.info('Feed is closed');
    return;
  }
  if (root.classList.contains('is-peek') || placing) return;
  if (window.layerIsTop && !window.layerIsTop('feed')) {
    toast.info('Close this panel first');
    return;
  }
  try {
    if (!beginPlace()) {
      placing = false;
      placeBusy = false;
      toast.info("Couldn't open the map");
      return;
    }
    // Same panel as the toolbar Draw button. The pin path passes true.
    if (!openDrawColumn(false)) {
      leavePlace();
      if (feedOn()) reveal();
      toast.info("Couldn't open Draw");
    }
  } catch (err) {
    if (placing || (window.layerIsOpen && window.layerIsOpen('feedplace'))) {
      leavePlace();
      if (feedOn()) reveal();
    } else {
      placing = false;
      placeBusy = false;
      if (root.classList.contains('is-peek')) {
        root.classList.remove('is-peek');
        syncCover();
      }
    }
    toast.info("Couldn't open Draw");
  }
}

function applyFeed(on) {
  paintToggle(on);
  writeMode(on ? 'feed' : 'map');
  if (!on) {
    paintMenu(false);
    dropOptions();
    leavePlace();
    const dropSearch = window.layerIsOpen && window.layerIsOpen('feedsearch');
    hideSearch();
    if (dropSearch && window.layerClosedByUI) window.layerClosedByUI('feedsearch');
    if (settingsOpen || (window.layerIsOpen && window.layerIsOpen('feedsettings'))) closeFeedSettings();
  }
  if (on) {
    const opening = !feedOn();
    peek = false;
    root.classList.remove('is-peek');
    root.style.display = 'block';
    showFeedTabs();
    measureTabHide();
    syncCover();
    applyFeedChrome();
    ensureTopic(true);
    if (opening) {
      const want = feedPrefs.tab === 'following' ? 'following' : 'all';
      if (feedTab !== want) selectTab(want);
    }
    return;
  }
  loadOverFeed = false;
  peek = false;
  revealToken += 1;
  root.classList.remove('is-peek');
  rememberScroll();
  resetQueues();
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
      const beforeTab = feedTab;
      const wasOff = !feedOn();
      applyFeed(true);
      if (wasOff && beforeTab !== feedTab) return;
      const y = Number(state && state.scroll);
      if (Number.isFinite(y)) {
        savedScroll = y;
        requestAnimationFrame(() => { setFeedScroll(y); });
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

const USER_ICON = [
  ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
  ['circle', { cx: '12', cy: '7', r: '4' }],
];
const CHAT_ICON = [
  ['path', { d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719' }],
];
const LOCK_ICON = [
  ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
  ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
];
const SETTINGS_ICON = [
  ['path', { d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915' }],
  ['circle', { cx: '12', cy: '12', r: '3' }],
];
const LOGOUT_ICON = [
  ['path', { d: 'm16 17 5-5-5-5' }],
  ['path', { d: 'M21 12H9' }],
  ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
];
const WALLET_ICON = [
  ['path', { d: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1' }],
  ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4' }],
];

// Panels Options can open. They are painted under the feed, so a drawer
// open lifts them while that Options session is up.
const OPTION_PANELS = [
  'menu-buttons-group',
  'toolbar',
  'visibility-controls',
  'rotation-controls',
  'Edit_Profile-column',
  'load-column',
  'create-column',
  'draw-column',
  'utility-column',
  'memo-column',
  'domain-column',
  'stack-topic-ids',
  'initial-xyz-column',
  'model-column',
  'model-column-save',
  'crosshair-column',
  'crosshair-column-save',
  'popup-settings-backdrop',
  'popup-settings-card',
  'main-button-column',
  'main-button-column-save',
  'marker-options-column',
  'marker-column-save',
  'button-input-column',
  'button-input-column-save',
  'topic-chat-column',
  'topic-chat-save',
  'edit-profile-help-overlay',
  'load-options-help-overlay',
  'create-topic-help-overlay',
  'map-draw-help-overlay',
  'model-sharing-rules-help-overlay',
  'edit-topic-rules-help-overlay',
  'domain-help-overlay',
  'stack-topic-ids-help-overlay',
  'topic-chat-help-overlay',
  'e2ee-chat-help-overlay',
  'change-model-help-overlay',
  'crosshair-settings-help-overlay',
  'marker-size-help-overlay',
  'main-buttons-style-help-overlay',
  'main-buttons-advanced-style-help-overlay',
  'chat-style-help-overlay',
  'visibility-help-overlay',
];
let optionsOverFeed = false;
const optionLifted = new Map();

function liftOptionEl(el) {
  if (!el) return;
  if (!optionLifted.has(el)) optionLifted.set(el, el.style.zIndex);
  if (el.style.zIndex !== '8800') el.style.zIndex = '8800';
}

function liftOptions() {
  if (!optionsOverFeed || !feedCovers()) return;
  for (const id of OPTION_PANELS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (id !== 'menu-buttons-group' && el.style.display === 'none') continue;
    liftOptionEl(el);
  }
}

function dropOptions() {
  optionsOverFeed = false;
  for (const [el, prev] of optionLifted) {
    if (prev) el.style.zIndex = prev;
    else el.style.removeProperty('z-index');
  }
  optionLifted.clear();
}

function clickId(id) {
  const el = document.getElementById(id);
  if (el) el.click();
}

// Close the drawer first so the feature replaces that history entry.
// One Back then returns to the feed.
function openOverFeed(run) {
  holdScroll();
  closeMenu();
  run();
}

function openOwnProfile() {
  const account = walletNow();
  if (!account || typeof window.loadBio4PIC !== 'function') return;
  openOverFeed(() => window.loadBio4PIC(account));
}

function openTopicChat() {
  openOverFeed(() => clickId('topic-chat-btn'));
}

async function openE2ee() {
  if (!walletNow()) {
    holdScroll();
    closeMenu();
    let status = 'fail';
    try {
      status = await ensureWallet();
    } catch (err) {
      status = 'fail';
    }
    if (status === 'cancel') return;
    if (status !== 'ok') {
      toast.info("Couldn't open the wallet");
      return;
    }
  }
  openOverFeed(() => clickId('toggle-encrypted-chat-btn'));
}

function applyFeedChrome() {
  root.classList.toggle('is-compact', feedPrefs.density === 'compact');
  root.classList.toggle('is-loc-off', !feedPrefs.location);
  if (feedPrefs.fresh === 'jump' && feedOn() && !searchQuery && held[feedTab].length) goToFreshPosts();
  else paintNewPill();
  syncFeedVideos();
}

const settingsPaints = [];
const settings = document.createElement('div');
settings.id = 'feed-settings';
settings.hidden = true;
settings.setAttribute('role', 'dialog');
settings.setAttribute('aria-modal', 'true');
settings.setAttribute('aria-label', 'Settings');
const settingsBar = document.createElement('div');
settingsBar.className = 'feed-settings-bar';
const settingsBack = document.createElement('button');
settingsBack.type = 'button';
settingsBack.className = 'feed-settings-back';
settingsBack.setAttribute('aria-label', 'Back');
settingsBack.appendChild(svgIcon([
  ['path', { d: 'm12 19-7-7 7-7' }],
  ['path', { d: 'M19 12H5' }],
]));
const settingsTitle = document.createElement('h2');
settingsTitle.className = 'feed-settings-title';
settingsTitle.textContent = 'Settings';
settingsBar.append(settingsBack, settingsTitle);
const settingsBody = document.createElement('div');
settingsBody.className = 'feed-settings-body';

function settingsSection(title) {
  const section = document.createElement('section');
  section.className = 'feed-settings-section';
  const label = document.createElement('h3');
  label.className = 'feed-settings-label';
  label.textContent = title;
  section.appendChild(label);
  return section;
}

function settingsRadios(name, options, get, set) {
  const group = document.createElement('div');
  group.className = 'feed-settings-radios';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', name);
  const buttons = [];
  const paint = () => {
    const value = get();
    for (const button of buttons) {
      const on = button.dataset.value === value;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  };
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feed-settings-choice';
    button.dataset.value = option.value;
    button.setAttribute('role', 'radio');
    button.textContent = option.label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (get() === option.value) return;
      set(option.value);
      paint();
    });
    bindPress(button);
    buttons.push(button);
    group.appendChild(button);
  }
  paint();
  settingsPaints.push(paint);
  return group;
}

function settingsSwitch(label, get, set) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'feed-settings-switch';
  button.setAttribute('role', 'switch');
  const text = document.createElement('span');
  text.textContent = label;
  const ui = document.createElement('span');
  ui.className = 'feed-settings-switch-ui';
  ui.setAttribute('aria-hidden', 'true');
  button.append(text, ui);
  const paint = () => {
    const on = !!get();
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    set(!get());
    paint();
  });
  bindPress(button);
  paint();
  settingsPaints.push(paint);
  return button;
}

const tabSection = settingsSection('Default tab');
tabSection.appendChild(settingsRadios('Default tab', [
  { value: 'all', label: 'All' },
  { value: 'following', label: 'Following' },
], () => feedPrefs.tab, (value) => {
  feedPrefs.tab = value;
  writeFeedSetting(FEED_SETTING.tab, value);
}));
const mediaSection = settingsSection('Media');
mediaSection.append(
  settingsSwitch('Autoplay videos', () => feedPrefs.autoplay, (on) => {
    feedPrefs.autoplay = on;
    writeFeedSetting(FEED_SETTING.autoplay, on ? 'on' : 'off');
    syncFeedVideos();
  }),
  settingsSwitch('Data saver', () => feedPrefs.dataSaver, (on) => {
    feedPrefs.dataSaver = on;
    writeFeedSetting(FEED_SETTING.data, on ? 'on' : 'off');
    syncFeedVideos();
  }),
);
const densitySection = settingsSection('Density');
densitySection.appendChild(settingsRadios('Density', [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
], () => feedPrefs.density, (value) => {
  feedPrefs.density = value;
  writeFeedSetting(FEED_SETTING.density, value);
  applyFeedChrome();
}));
const freshSection = settingsSection('New posts');
freshSection.appendChild(settingsRadios('New posts', [
  { value: 'pill', label: 'Show pill' },
  { value: 'jump', label: 'Jump to top' },
], () => feedPrefs.fresh, (value) => {
  feedPrefs.fresh = value;
  writeFeedSetting(FEED_SETTING.fresh, value);
  applyFeedChrome();
}));
const privacySection = settingsSection('Privacy');
privacySection.appendChild(settingsSwitch('Show location on cards', () => feedPrefs.location, (on) => {
  feedPrefs.location = on;
  writeFeedSetting(FEED_SETTING.location, on ? 'on' : 'off');
  applyFeedChrome();
}));
settingsBody.append(tabSection, mediaSection, densitySection, freshSection, privacySection);
settings.append(settingsBar, settingsBody);
root.appendChild(settings);

function paintFeedSettings(open) {
  settingsOpen = open;
  settings.hidden = !open;
  if (open) {
    for (const paint of settingsPaints) paint();
    settingsBack.focus({ preventScroll: true });
  }
  syncFeedVideos();
}

function closeFeedSettings() {
  paintFeedSettings(false);
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedsettings')) {
    window.layerClosedByUI('feedsettings');
  }
}

function openFeedSettings() {
  if (!feedOn() || root.classList.contains('is-peek')) return;
  openOverFeed(() => {
    paintFeedSettings(true);
    if (window.layerOpened) window.layerOpened('feedsettings');
  });
}

function openDisconnect() {
  openOverFeed(() => clickId('disconnect-wallet-btn'));
}

// The drawer sits on the feed, and #connect-wallet-btn is under that screen.
// Close the drawer first, let its deferred history.back() land, then open
// the sheet the same way the plus button does. Success and cancel both
// stay on the feed.
async function openConnect() {
  holdScroll();
  closeMenu();
  await new Promise((resolve) => setTimeout(resolve, 0));
  let status = 'fail';
  try {
    status = await ensureWallet();
  } catch (err) {
    status = 'fail';
  }
  if (status === 'ok' || status === 'cancel') return;
  toast.info("Couldn't open the wallet");
}

// A later open or close bumps this so a finishing slide cannot hide
// the drawer the user just reopened.
let menuToken = 0;

function motionOff() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function paintMenu(open) {
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) paintWalletRows();
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

const MENU_ROWS = [
  { label: 'Back to map', icon: GLOBE_ICON, run: backToMap },
  { label: 'Connect wallet', icon: WALLET_ICON, run: openConnect, wallet: 'off' },
  { label: 'My profile', icon: USER_ICON, run: openOwnProfile, wallet: 'on' },
  { label: 'Topic chat', icon: CHAT_ICON, run: openTopicChat },
  { label: 'E2EE chat', icon: LOCK_ICON, run: openE2ee },
  { label: 'Settings', icon: SETTINGS_ICON, run: openFeedSettings },
  { rule: true, wallet: 'on' },
  { label: 'Disconnect', icon: LOGOUT_ICON, run: openDisconnect, wallet: 'on', danger: true },
];

const walletRows = [];

function paintWalletRows() {
  const on = !!walletNow();
  for (const row of walletRows) row.hidden = on ? row.dataset.wallet !== 'on' : row.dataset.wallet !== 'off';
}

// web3.js writes #account-id on connect and disconnect. Repaint so a
// connect that finishes after the drawer was painted cannot leave
// "Connect wallet" showing.
function watchWalletRows() {
  const account = document.getElementById('account-id');
  if (!account) return;
  let last = walletNow();
  const sync = () => {
    const now = walletNow();
    if (now === last) return;
    last = now;
    paintWalletRows();
  };
  new MutationObserver(sync).observe(account, { childList: true, characterData: true, subtree: true });
}

for (const item of MENU_ROWS) {
  const row = document.createElement('li');
  if (item.wallet) {
    row.dataset.wallet = item.wallet;
    walletRows.push(row);
  }
  if (item.rule) {
    row.className = 'feed-menu-rule';
    row.setAttribute('role', 'separator');
    menu.appendChild(row);
    continue;
  }
  const choice = document.createElement('button');
  choice.type = 'button';
  choice.className = item.danger ? 'feed-menu-item is-danger' : 'feed-menu-item';
  choice.append(svgIcon(item.icon), document.createTextNode(item.label));
  choice.addEventListener('click', (event) => {
    event.stopPropagation();
    item.run();
  });
  bindPress(choice);
  row.appendChild(choice);
  menu.appendChild(row);
}
paintWalletRows();
watchWalletRows();

if (window.defineLayer) {
  window.defineLayer('feedmenu', {
    parent: 'feed',
    open: () => paintMenu(true),
    close: () => closeMenu(),
  });
  window.defineLayer('feedsettings', {
    parent: 'feed',
    open: () => paintFeedSettings(true),
    close: () => closeFeedSettings(),
  });
  window.defineLayer('feedsearch', {
    parent: 'feed',
    open: () => {
      searchOpen = true;
      paintSearch(true);
      searchInput.focus({ preventScroll: true });
    },
    close: () => closeSearch(),
  });
  window.defineLayer('feedplace', {
    parent: 'feed',
    open: () => {
      if (root.style.display === 'none') return;
      placing = true;
      peek = true;
      root.classList.add('is-peek');
      syncCover();
    },
    close: () => {
      if (!placing) {
        placeBusy = false;
        return;
      }
      returnToFeed(false);
    },
  });
}

bindPress(menuBtn);
menuBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (window.layerIsOpen && window.layerIsOpen('feedmenu')) closeMenu();
  else openMenu();
});

bindPress(topicBtn);
topicBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  openLoadFromFeed();
});

const loadColumn = document.getElementById('load-column');
if (loadColumn) {
  new MutationObserver(() => syncLoadOverFeed()).observe(loadColumn, {
    attributes: true,
    attributeFilter: ['style'],
  });
}

const optionTrigger = document.getElementById('toggle-toolbar-btn');
if (optionTrigger) {
  new MutationObserver(() => {
    if (!optionsOverFeed) return;
    if (optionTrigger.style.display === 'none') {
      dropOptions();
      return;
    }
    liftOptions();
  }).observe(optionTrigger, { attributes: true, attributeFilter: ['style'] });
}
for (const id of OPTION_PANELS) {
  if (id === 'menu-buttons-group') continue;
  const panel = document.getElementById(id);
  if (!panel) continue;
  new MutationObserver(() => {
    if (!optionsOverFeed || !feedCovers() || panel.style.display === 'none') return;
    liftOptionEl(panel);
  }).observe(panel, { attributes: true, attributeFilter: ['style'] });
}

const drawColumn = document.getElementById('draw-column');
if (drawColumn) {
  new MutationObserver(() => {
    const open = drawColumn.style.display === 'block';
    if (open) {
      if (placing) drawWasOpen = true;
      return;
    }
    if (!placing || !drawWasOpen) return;
    returnToFeed(false);
  }).observe(drawColumn, { attributes: true, attributeFilter: ['style'] });
}

const loadTrigger = document.getElementById('toolbar-load');
if (loadTrigger) {
  loadTrigger.addEventListener('click', () => {
    if (!feedOn() || root.classList.contains('is-peek')) return;
    ensureTopic(false);
  });
}

window.addEventListener('topics-ready', paintTopicTitle);
const loadedList = document.getElementById('loaded-topics-list');
if (loadedList) {
  new MutationObserver(() => paintTopicTitle()).observe(loadedList, { childList: true, subtree: true });
}

menuDim.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const box = postBtn.getBoundingClientRect();
  const onPost = box.width > 0 && box.height > 0
    && event.clientX >= box.left && event.clientX <= box.right
    && event.clientY >= box.top && event.clientY <= box.bottom;
  if (onPost) {
    startPost();
    return;
  }
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
  if (event.key !== 'Escape') return;
  if (!settings.hidden && (!window.layerIsTop || window.layerIsTop('feedsettings'))) {
    event.preventDefault();
    event.stopPropagation();
    closeFeedSettings();
    return;
  }
  if (menu.hidden) return;
  if (window.layerIsTop && !window.layerIsTop('feedmenu')) return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu();
}, true);
bindPress(settingsBack);
settingsBack.addEventListener('click', (event) => {
  event.stopPropagation();
  closeFeedSettings();
});
settings.addEventListener('click', (event) => event.stopPropagation());

column.addEventListener('click', (event) => {
  const tag = event.target && event.target.closest && event.target.closest('.post-hashtag');
  if (!tag || !column.contains(tag)) return;
  if (feedActIdle(event)) return;
  event.preventDefault();
  event.stopPropagation();
}, true);
root.addEventListener('click', (event) => event.stopPropagation());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushViewsNow();
});
window.addEventListener('pagehide', flushViewsNow);

allTab.addEventListener('click', () => { selectTab('all'); });
followTab.addEventListener('click', () => { selectTab('following'); });
bindPress(newPill);
newPill.addEventListener('click', (event) => {
  event.stopPropagation();
  goToFreshPosts();
});
paintTabs();

bindPress(searchBtnFeed);
searchBtnFeed.addEventListener('click', (event) => {
  event.stopPropagation();
  openSearch();
});
bindPress(postBtn);
postBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  startPost();
});
bindPress(searchClose);
searchClose.addEventListener('click', (event) => {
  event.stopPropagation();
  closeSearch();
});
searchInput.addEventListener('input', () => {
  if (searchTimer) clearTimeout(searchTimer);
  const value = searchInput.value;
  searchTimer = setTimeout(() => {
    searchTimer = 0;
    if (!searchOpen) return;
    applyQuery(value);
  }, 250);
});
searchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
});

function refreshTabRowHeight() {
  const h = tabs.getBoundingClientRect().height;
  if (h > 1) tabHidePx = h;
}

function tabRowHeight() {
  return tabHidePx > 1 ? tabHidePx : 0;
}

function setTabY(value) {
  tabs.style.setProperty('--feed-tab-y', value);
  newPill.style.setProperty('--feed-tab-y', value);
}

function cancelTabSettle() {
  tabSettleGen += 1;
  if (tabSettleTimer) {
    clearTimeout(tabSettleTimer);
    tabSettleTimer = 0;
  }
  tabs.classList.remove('is-settle');
}

function readVisualOffset() {
  const tr = getComputedStyle(tabs).transform;
  if (!tr || tr === 'none') return 0;
  const m3 = tr.match(/matrix3d\(([^)]+)\)/);
  if (m3) {
    const ty = parseFloat(m3[1].split(',')[13]);
    return Number.isFinite(ty) ? ty : tabOffset;
  }
  const m = tr.match(/matrix\(([^)]+)\)/);
  if (!m) return tabOffset;
  const ty = parseFloat(m[1].split(',')[5]);
  return Number.isFinite(ty) ? ty : tabOffset;
}

function pinVisualOffset() {
  if (!tabs.classList.contains('is-settle')) return;
  tabOffset = readVisualOffset();
  tabs.classList.remove('is-settle');
  setTabY(tabOffset.toFixed(2) + 'px');
}

function writeTabOffset(y, settle) {
  const limit = tabRowHeight();
  const next = limit > 1 ? Math.max(-limit, Math.min(0, y)) : 0;
  tabOffset = next;
  setTabY(next.toFixed(2) + 'px');
  tabs.classList.toggle('is-settle', !!settle);
  if (next <= -limit + 0.5 && limit > 1) tabs.style.pointerEvents = 'none';
  else tabs.style.removeProperty('pointer-events');
}

function showFeedTabs() {
  cancelTabSettle();
  tabDir = 0;
  tabPending = 0;
  tabLastY = scroller.scrollTop;
  writeTabOffset(0, false);
}

function measureTabHide() {
  refreshTabRowHeight();
  pinVisualOffset();
  writeTabOffset(tabOffset, false);
}

function queueTabFollow() {
  if (tabFollowQueued) return;
  tabFollowQueued = true;
  requestAnimationFrame(applyTabFollow);
}

function applyTabFollow() {
  tabFollowQueued = false;
  tabSettleGen += 1;
  if (root.classList.contains('is-peek')) {
    tabPending = 0;
    return;
  }
  const delta = tabPending;
  tabPending = 0;
  pinVisualOffset();
  if (tabSettleTimer) {
    clearTimeout(tabSettleTimer);
    tabSettleTimer = 0;
  }
  const y = scroller.scrollTop;
  if (y < 2) {
    tabDir = 0;
    writeTabOffset(0, false);
    return;
  }
  if (delta > 0.5) tabDir = 1;
  else if (delta < -0.5) tabDir = -1;
  writeTabOffset(tabOffset - delta, false);
  armTabSettle();
}

function armTabSettle() {
  if (tabSettleTimer) clearTimeout(tabSettleTimer);
  tabSettleTimer = setTimeout(settleTabs, 80);
}

function settleTabs() {
  tabSettleTimer = 0;
  if (root.classList.contains('is-peek')) return;
  const y = scroller.scrollTop;
  tabLastY = y;
  if (y < 2) {
    writeTabOffset(0, false);
    return;
  }
  const h = tabRowHeight();
  if (!(h > 1) || tabOffset >= -0.5 || tabOffset <= -h + 0.5) return;
  const target = tabDir < 0 ? 0 : -h;
  if (motionOff()) {
    writeTabOffset(target, false);
    return;
  }
  const gen = ++tabSettleGen;
  tabs.classList.remove('is-settle');
  setTabY(tabOffset.toFixed(2) + 'px');
  void tabs.offsetWidth;
  tabs.classList.add('is-settle');
  setTabY(target.toFixed(2) + 'px');
  tabOffset = target;
  if (target <= -h + 0.5) tabs.style.pointerEvents = 'none';
  else tabs.style.removeProperty('pointer-events');
  setTimeout(() => {
    if (gen !== tabSettleGen) return;
    tabs.classList.remove('is-settle');
  }, 130);
}

// Script scrolls must not count as a finger moving the row.
function setFeedScroll(value) {
  const before = scroller.scrollTop;
  tabTrackHold = true;
  scroller.scrollTop = value;
  if (scroller.scrollTop === before) tabTrackHold = false;
}

function feedScrollTo(options) {
  const before = scroller.scrollTop;
  tabTrackHold = true;
  scroller.scrollTo(options);
  const top = options && typeof options === 'object' ? options.top : options;
  if (typeof top === 'number' && scroller.scrollTop === before && top === before) tabTrackHold = false;
}

tabs.addEventListener('focusin', () => showFeedTabs());
window.addEventListener('resize', measureTabHide);
if (window.visualViewport) window.visualViewport.addEventListener('resize', measureTabHide);
if (document.fonts) {
  document.fonts.ready.then(() => measureTabHide());
  document.fonts.addEventListener('loadingdone', measureTabHide);
}

scroller.addEventListener('scroll', (event) => {
  const hold = tabTrackHold;
  if (hold) tabTrackHold = false;
  if (root.classList.contains('is-peek')) return;
  const y = scroller.scrollTop;
  if (hold || !event.isTrusted) {
    tabLastY = y;
    if (y < 2) showFeedTabs();
  } else {
    // Hold this delta until the frame. A script scroll only moves tabLastY.
    tabPending += y - tabLastY;
    tabLastY = y;
    queueTabFollow();
  }
  savedScroll = y;
  fillUp();
  fillDown();
  revealParked();
  // Captions can still be waiting on layout when a card is first built.
  scheduleScrollFrame();
  scheduleScrollWrite();
}, { passive: true });

paintToggle(false);
applyFeedChrome();
if (savedMode() === 'feed') applyFeed(true);
const feedLink = linkInfo();
if (feedLink && typeof feedLink.addEventListener === 'function') {
  feedLink.addEventListener('change', syncFeedVideos);
}

setInterval(() => {
  if (!feedOn() || root.classList.contains('is-peek')) return;
  ensureTopic(false);
}, 2000);
