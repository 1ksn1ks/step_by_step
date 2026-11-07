import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import { map } from './map';
import { createMarkerPopupHTML, mediaMode, lengthMode } from './processallmessages.js';
import { videoSeconds } from './mediaduration.js';
import { toast } from './toast.js';
import { fetchLocalMarkers } from './msgbackend.js';
import { profilePictures, usernames, click2url } from './loadalladata.js';
import { CloseALL, changePopupState } from './cssLogic.js';
import { closeDrawAnchor } from './drawhere.js';
import { animateMapTo, cancelAnimateMapTo } from './animatemapto.js';
import { applyAllStyles } from './loadprofilepopup.js';
import { isTopicLayerActive } from './marker.js';
import { watchMarkerTilt, forgetMarkerTilt } from './markertilt.js';
import { geojson } from './letall.js';
import { watchFollowPrefetch } from './followtopic.js';
import { fetchFollowing } from './msgbackend.js';
import { earlyHashinalNumber, earlyHashinalReady, onOwnersChange } from './earlyhashinal.js';
import { connectedAccount } from './web3.js';

// Same key as marker.js topicPointKey — a live point matching a topic
// point to 5 decimals is a duplicate of the topic layer: while the topic
// layer is on it stays out of the live index, and the topic dot wears the
// live border instead (painted by marker.js).
const livePointKey = ([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

// All live points, at 5-decimal keys — marker.js paints the live border on
// any topic dot that has a live point at its exact spot. livePointTitles
// carries the live title so the border face keeps it (the topic face has none).
export const livePointCoords = new Set();
export const livePointTitles = new Map();

// "Local news" overlay — the 24h live markers shown after a geographic
// search (search.js). This is a SEPARATE lightweight set from the regular
// topic markers: it never touches the topic pipeline and is wiped on every
// new search.
//
// Mass scale: the markers live in a Supercluster index (same params as the
// topic markers in marker.js). Only the CLUSTERS VISIBLE in the current
// viewport become DOM nodes — zoomed out the whole world is a few hundred
// bubbles no matter how many markers exist, and the far side of the globe
// is filtered out. A tap popup uses the SAME popup the regular topic
// markers use (createMarkerPopupHTML).

const DEFAULT_AVATAR = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';

const index = new Supercluster({
  radius: 60, // px — same as marker.js
  maxZoom: 11, // above this, clustering stops and every point renders
});

// Mass-scale guard: max DOM nodes per viewport. Above z11 there is no
// clustering, so a city with 100k markers could otherwise put 10k nodes on
// screen — DOM nodes are what kill phones, not the data.
const MAX_DOM_NODES = 800;

// Centering: the marker element's box is the DOT only — the label is an
// absolutely-positioned child below it (out of flow) — so MapLibre's
// default anchor puts the dot's center on the map point exactly like the
// topic dots in marker.js, on every device, with no magic offset.

let localNodes = []; // maplibregl.Marker instances (bubbles + dots)
let localPopup = null; // the one shared popup for this overlay
let liveAll = []; // every live marker for the place (newest first)
let localList = []; // the ones in the chosen group: what the map shows
let localIndex = -1; // which one has its popup open
let layerActive = false; // moveend listener attached

// EXACTLY the expression the regular marker popups use (processallmessages):
// the popup's timestamp string doubles as the marker's like-key, so it must
// be byte-identical or likes wouldn't line up. Falls back to the upload time
// while the original message is still backfilling.
function formatTimestamp(created, lastSeenMs) {
  const d = created ? new Date(created) : new Date(lastSeenMs);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  );
}

// True when [lng, lat] is on the visible side of the globe (same test as
// marker.js — without it, far-side points project through the sphere onto
// the visible disc).
function isOnVisibleHemisphere(coords) {
  const toRad = (d) => (d * Math.PI) / 180;
  const center = map.getCenter();
  const cl = toRad(center.lat);
  const cgn = toRad(center.lng);
  const pl = toRad(coords[1]);
  const pg = toRad(coords[0]);
  const dot = Math.sin(cl) * Math.sin(pl) + Math.cos(cl) * Math.cos(pl) * Math.cos(pg - cgn);
  return dot > -0.03; // small horizon margin so edge markers don't pop
}

export function clearLocalMarkers(silent = false) {
  for (const m of localNodes) {
    const node = m.getElement();
    forgetMarkerTilt(node && node.querySelector(':scope > .cluster-face'));
    m.remove();
  }
  localNodes = [];
  if (localPopup) {
    localPopup.remove();
    localPopup = null;
  }
  localList = [];
  liveAll = [];
  localIndex = -1;
  index.load([]);
  indexFilterKey = null;
  lastLocalSig = null;
  livePointCoords.clear();
  livePointTitles.clear();
  hideLiveBar();
  if (!silent) document.dispatchEvent(new Event('live-dataset-changed')); // topic dots drop the border
  if (layerActive) {
    map.off('move', viewportLocalUpdate);
    map.off('moveend', viewportLocalUpdate);
    layerActive = false;
  }
}

// Keys of every topic marker (same 5-decimal format) — a live point
// matching one of these duplicates the topic layer.
function topicPointKeys() {
  return geojson.features.map((f) => livePointKey(f.geometry.coordinates));
}

// The live index holds ALL live points while the topic layer is off, and
// only the NON-duplicate points while it is on — a duplicate is already
// represented by its topic dot (which wears the live border) or its topic
// cluster bubble, so it must not sit in a live cluster on top of them.
let indexFilterKey = null;
function rebuildIndexIfNeeded() {
  const topicActive = isTopicLayerActive();
  const keys = topicActive ? topicPointKeys() : [];
  const filterKey = topicActive ? 'topic:' + keys.sort().join('|') : 'live-only';
  if (filterKey === indexFilterKey) return;
  indexFilterKey = filterKey;
  const dup = topicActive ? new Set(keys) : null;
  index.load(
    localList
      .map((m, i) => ({ m, i, key: livePointKey([m.lng, m.lat]) }))
      .filter((p) => !dup || !dup.has(p.key))
      .map((p) => ({
        type: 'Feature',
        properties: { i: p.i, title: p.m.title || '' },
        geometry: { type: 'Point', coordinates: [p.m.lng, p.m.lat] },
      }))
  );
}

let lastLocalSig = null;

// Render the clusters/points currently in the viewport, replacing the
// previous nodes. force=false (per-frame viewport path) re-renders only on
// the exact frame the cluster state changes (signature of cluster ids +
// point indices) — otherwise the nodes are already at their true
// coordinates and simply pan/zoom with the map. A debounced re-render
// instead let the cluster state lag the zoom, which read as markers
// sliding and jumping mid-zoom.
function updateLocalClusters(force = true) {
  if (localList.length === 0) return;
  rebuildIndexIfNeeded();
  const bounds = map.getBounds().toArray().flat();
  const zoom = map.getZoom();
  let clusters = index
    .getClusters(bounds, Math.floor(zoom))
    .filter((c) => isOnVisibleHemisphere(c.geometry.coordinates));
  if (clusters.length > MAX_DOM_NODES) clusters = clusters.slice(0, MAX_DOM_NODES);
  const sig = clusters
    .map((c) => (c.properties.cluster ? 'c' + c.properties.cluster_id : 'p' + c.properties.i))
    .sort()
    .join('|');
  if (!force && sig === lastLocalSig) return;
  lastLocalSig = sig;

  for (const m of localNodes) {
    const node = m.getElement();
    forgetMarkerTilt(node && node.querySelector(':scope > .cluster-face'));
    m.remove();
  }
  localNodes = [];

  for (const cluster of clusters) {
    const el = document.createElement('div');
    if (cluster.properties.cluster) {
      // Count bubble — tap zooms into the cluster (same as topic clusters)
      el.className = 'cluster-bubble';
      const face = document.createElement('div');
      face.className = 'cluster-face';
      face.textContent = cluster.properties.point_count_abbreviated;
      el.appendChild(face);
      watchMarkerTilt(face);
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const expansionZoom = (await index.getClusterExpansionZoom(cluster.id)) + 0.1;
        cancelAnimateMapTo(); // the moveend re-render must not fight the fly
        animateMapTo(map, cluster.geometry.coordinates, expansionZoom);
      });
    } else {
      const j = cluster.properties.i; // index into localList
      el.className = 'local-marker';
      // Dot + label sit in an inner positioned box (see the .local-marker-box
      // note) — the outer element stays MapLibre's marker element, untouched.
      const box = document.createElement('div');
      box.className = 'local-marker-box';
      const dot = document.createElement('div');
      // Solid dot at the true point. A live point sharing exact coords
      // with a topic dot was filtered out of the index above — over there
      // the topic dot itself wears the live border.
      dot.className = 'local-marker-dot-solid';
      box.appendChild(dot);
      const label = document.createElement('div');
      label.className = 'local-marker-label';
      label.textContent = localList[j].title || 'Live marker';
      box.appendChild(label);
      el.appendChild(box);
      watchFollowPrefetch(el, localList[j] && localList[j].payer);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openLocalPopup(j);
      });
    }
    localNodes.push(
      new maplibregl.Marker({ element: el })
        .setLngLat(cluster.geometry.coordinates)
        .addTo(map)
    );
  }
}

// Per-frame viewport path — see updateLocalClusters(force=false).
const viewportLocalUpdate = () => updateLocalClusters(false);

// The topic layer re-rendered (new search, zoom/move, visibility toggle) —
// re-check which live points duplicate it and re-render (signature-guarded).
document.addEventListener('topic-clusters-updated', () => {
  updateLocalClusters(false);
});

// Show / Video length, read from the same saved popup settings as topic posts.
// An array image is its first entry, the same way videoSeconds reads it.
function localMedia(m) {
  const image = m && Array.isArray(m.image) ? m.image[0] : m && m.image;
  if (image == null || image === '') return 'none';
  if (/\.(mp4|webm)(\?|#|$)/i.test(String(image))) return 'video';
  return 'picture';
}

function localMatches(m) {
  const show = mediaMode();
  const kind = localMedia(m);
  if (show === 'pictures' && kind !== 'picture') return false;
  if (show === 'videos' && kind !== 'video') return false;
  if (show === 'both' && kind !== 'picture' && kind !== 'video') return false;
  const length = lengthMode();
  if (length === 'any' || kind !== 'video') return true;
  const seconds = videoSeconds(m && m.image);
  if (seconds == null) return false;
  if (length === 'under') return seconds < 30;
  if (length === 'mid') return seconds >= 30 && seconds <= 120;
  return seconds > 120;
}

function createdStamp(value) {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

// Another copy of the post that is open: same time and same point.
function sameLivePost(a, b) {
  if (!a || !b) return false;
  if (Number(a.lng) !== Number(b.lng) || Number(a.lat) !== Number(b.lat)) return false;
  const left = createdStamp(a.created);
  const right = createdStamp(b.created);
  return left !== '' && left === right;
}

function localEndLabel() {
  const mode = mediaMode();
  if (mode === 'pictures') return 'No more pictures';
  if (mode === 'videos') return 'No more videos';
  return 'No more pictures or videos';
}

// Newest-first, no wrap. The open post can be text; the arrow lands on the
// nearest item that matches Show and Video length.
function step(direction) {
  const dir = direction < 0 ? -1 : 1;
  const open = localList[localIndex];
  for (let j = localIndex + dir; j >= 0 && j < localList.length; j += dir) {
    const item = localList[j];
    if (!localMatches(item) || sameLivePost(item, open)) continue;
    navigateLocal(j);
    return;
  }
  if (mediaMode() !== 'all') toast.info(localEndLabel());
}

// Popup for the marker at localList[j] — the SAME popup the regular topic
// markers use, but ◀️/▶️ walk THIS list instead of the topic's
// markers (onPrev/onNext callbacks).
function openLocalPopup(j) {
  const m = localList[j];
  if (!m) return;
  localIndex = j;

  const content = createMarkerPopupHTML({
    markernumber: m.number || '',
    topicId: m.topic,
    loadedTopicName: m.topicName || '',
    profileUrl: profilePictures[m.payer]?.url || DEFAULT_AVATAR,
    payer: m.payer,
    payerInfo: m.payer,
    username: usernames[m.payer]?.username || '',
    click2link: click2url[m.payer]?.click2url || '',
    title: m.title || '',
    image: m.image || '',
    msg: m.msg || '',
    timestamp: formatTimestamp(m.created, m.lastSeen),
    created: m.created || '',
    likeCountMarker: m.likeCount || 0,
    dislikeCountMarker: m.dislikeCount || 0,
    comments: m.comments || [],
    coords: `${m.lng},${m.lat}`,
    viewCount: Number.isFinite(Number(m.views)) ? Number(m.views) : 0,
    onPrev: () => step(-1),
    onNext: () => step(1),
  });

  // Match the regular marker popup: close other panels and apply the theme.
  // The card grows with the post; popupanim scales it into the screen.
  CloseALL();
  closeDrawAnchor();
  localPopup.setLngLat([m.lng, m.lat]).addTo(map).setDOMContent(content);
  applyAllStyles();
  changePopupState(true);
}

// ◀️/▶️ in a live popup: fly to the neighbor (clamped at both ends) and
// swap the popup over to it.
function navigateLocal(j) {
  const m = localList[j];
  if (!m) return;
  cancelAnimateMapTo(); // stop the popup-open loop, or it kills this flyTo
  map.flyTo({ center: [m.lng, m.lat], zoom: 12, essentialOnly: true });
  openLocalPopup(j);
}

// Render the given live markers, replacing whatever is shown. An empty list
// clears the overlay.
export function showLocalMarkers(markers) {
  clearLocalMarkers(true); // silent: one live-dataset-changed at the end
  if (!markers || markers.length === 0) return;

  liveAll = markers;
  localPopup = new maplibregl.Popup({ closeButton: true, offset: 18 });
  map.on('move', viewportLocalUpdate);
  map.on('moveend', viewportLocalUpdate);
  layerActive = true;
  paintLiveGroup(); // first paint now, not on the next moveend
  if (liveGroup === 'following') {
    const set = liveAll;
    ensureFollowIds().then(() => {
      if (liveAll === set && liveGroup === 'following') paintLiveGroup();
    });
  }
}

// ── Groups: whose live posts the map shows ─────────────────────────────
// One choice at a time, kept for later searches: Everyone; Following (the
// accounts this wallet follows, the same list as the feed's Following);
// NFT holders (Early Hashinal holders, the feed's filter of that name);
// Mine. A bar under the map's top bar picks the group and closes the live
// overlay. Popup ◀️/▶️ walk the shown group only.
const LIVE_GROUPS = [
  ['all', 'Everyone'],
  ['following', 'Following'],
  ['holders', 'NFT holders'],
  ['mine', 'Mine'],
];
const LIVE_GROUP_KEY = 'meritocracy-live-group';
let liveGroup = readLiveGroup();
let followIds = null; // Set of followed accounts, for followFor
let followFor = '';
let followLoad = null;
let liveBar = null;
let liveCount = null;
const groupButtons = new Map();

function readLiveGroup() {
  try {
    const saved = localStorage.getItem(LIVE_GROUP_KEY);
    if (LIVE_GROUPS.some(([key]) => key === saved)) return saved;
  } catch { /* private mode: Everyone */ }
  return 'all';
}

function walletNow() {
  const account = typeof connectedAccount === 'string' ? connectedAccount.trim() : '';
  return /^\d+\.\d+\.\d+$/.test(account) ? account : '';
}

function ensureFollowIds() {
  const me = walletNow();
  if (!me) {
    followIds = null;
    followFor = '';
    return Promise.resolve('nowallet');
  }
  if (followFor === me && followIds) return Promise.resolve('ready');
  if (followFor === me && followLoad) return followLoad;
  followFor = me;
  followIds = null;
  followLoad = fetchFollowing(me).then((data) => {
    followLoad = null;
    if (followFor !== me) return 'stale';
    if (!data) {
      followFor = ''; // offline: the next pick asks again
      return 'offline';
    }
    const ids = new Set();
    for (const entry of data.accounts || []) {
      const raw = typeof entry === 'string' ? entry : entry && entry.id;
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (/^\d+\.\d+\.\d+$/.test(id)) ids.add(id);
    }
    followIds = ids;
    return ids.size ? 'ready' : 'empty';
  }).catch(() => {
    followLoad = null;
    followFor = '';
    return 'offline';
  });
  return followLoad;
}

function inLiveGroup(m) {
  const payer = m && m.payer;
  if (liveGroup === 'following') return !!(followIds && followFor === walletNow() && followIds.has(payer));
  if (liveGroup === 'holders') return earlyHashinalNumber(payer) > 0;
  if (liveGroup === 'mine') {
    const me = walletNow();
    return !!me && payer === me;
  }
  return true;
}

// The shown set from the full one: the map, the live borders on topic
// dots and the popup walk all follow it.
function paintLiveGroup() {
  for (const node of localNodes) {
    const el = node.getElement();
    forgetMarkerTilt(el && el.querySelector(':scope > .cluster-face'));
    node.remove();
  }
  localNodes = [];
  if (localPopup) localPopup.remove();
  localIndex = -1;
  localList = liveAll.filter(inLiveGroup);
  livePointCoords.clear();
  livePointTitles.clear();
  for (const m of localList) {
    const k = livePointKey([m.lng, m.lat]);
    livePointCoords.add(k);
    if (m.title) livePointTitles.set(k, m.title);
  }
  indexFilterKey = null; // rebuild the index against the current topic state
  lastLocalSig = null;
  if (localList.length) updateLocalClusters();
  else index.load([]);
  paintLiveBar();
  document.dispatchEvent(new Event('live-dataset-changed')); // topic dots follow the group
}

function liveCountText() {
  const total = liveAll.length;
  const shown = localList.length;
  if (liveGroup === 'following' && walletNow() && followLoad) return 'Loading…';
  if (liveGroup === 'holders' && !earlyHashinalReady()) return 'Loading…';
  if (liveGroup === 'all') return total === 1 ? '1 post' : `${total} posts`;
  return `${shown} of ${total}`;
}

function ensureLiveBar() {
  if (liveBar) return liveBar;
  liveBar = document.createElement('div');
  liveBar.className = 'live-filter';
  liveBar.hidden = true;
  liveBar.setAttribute('role', 'region');
  liveBar.setAttribute('aria-label', 'Live posts');

  const head = document.createElement('div');
  head.className = 'live-filter-head';
  const tag = document.createElement('span');
  tag.className = 'live-filter-tag';
  const dot = document.createElement('span');
  dot.className = 'live-filter-dot';
  dot.setAttribute('aria-hidden', 'true');
  tag.append(dot, document.createTextNode('Live'));
  liveCount = document.createElement('span');
  liveCount.className = 'live-filter-count';
  liveCount.setAttribute('aria-live', 'polite');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'live-filter-close';
  close.setAttribute('aria-label', 'Hide live posts');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    clearLocalMarkers();
  });
  head.append(tag, liveCount, close);

  const groups = document.createElement('div');
  groups.className = 'live-filter-groups';
  groups.setAttribute('role', 'radiogroup');
  groups.setAttribute('aria-label', 'Whose live posts');
  for (const [key, label] of LIVE_GROUPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'live-filter-group';
    btn.setAttribute('role', 'radio');
    btn.dataset.group = key;
    btn.textContent = label;
    if (key === 'holders') btn.title = 'Early Hashinal holders';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      pickLiveGroup(key);
    });
    groupButtons.set(key, btn);
    groups.appendChild(btn);
  }
  liveBar.append(head, groups);
  // The document click closes panels (CloseALL); the bar keeps itself.
  liveBar.addEventListener('click', (event) => event.stopPropagation());
  document.body.appendChild(liveBar);
  return liveBar;
}

function paintLiveBar() {
  if (!liveAll.length) {
    hideLiveBar();
    return;
  }
  ensureLiveBar();
  liveBar.hidden = false;
  for (const [key, btn] of groupButtons) {
    const on = key === liveGroup;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
  }
  liveCount.textContent = liveCountText();
}

function hideLiveBar() {
  if (liveBar) liveBar.hidden = true;
}

function pickLiveGroup(key) {
  if (!LIVE_GROUPS.some(([k]) => k === key)) return;
  liveGroup = key;
  try { localStorage.setItem(LIVE_GROUP_KEY, key); } catch { /* this visit only */ }
  if ((key === 'following' || key === 'mine') && !walletNow()) {
    toast.info('Connect your wallet to see ' + (key === 'mine' ? 'your live posts' : 'people you follow'));
  }
  paintLiveGroup();
  if (key === 'following' && walletNow()) {
    const set = liveAll;
    ensureFollowIds().then((state) => {
      if (liveAll !== set || liveGroup !== 'following') return;
      if (state === 'empty') toast.info('You do not follow anyone yet');
      else if (state === 'offline') toast.error('Could not load who you follow');
      paintLiveGroup();
    });
  }
}

// The holder list arrives after the globe draws and refreshes every 15 min.
onOwnersChange(() => {
  if (liveGroup === 'holders' && liveAll.length) paintLiveGroup();
});

// 24h markers for where the user is (geolocate control turned on):
// reverse-geocode the fix in ENGLISH — the same side and language as the
// search flow, so the country string always matches what /api/local stored.
// Then the exact same country path the search results use.
export async function showLocationMarkers(lat, lng) {
  try {
    const data = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=en`
    ).then((r) => r.json());
    const country = (data && data.address && data.address.country) || "";
    if (country) {
      const { markers } = await fetchLocalMarkers(country);
      showLocalMarkers(markers);
    } else {
      showLocalMarkers([]);
    }
  } catch {
    // geocode failed / offline — leave whatever is currently shown
  }
}

// Dev server only (import.meta.env.DEV; the production build drops this):
// https://localhost:5173/?livedemo shows five made-up live posts over
// western Europe, one for each group in the bar, so the groups can be tried
// without waiting for real 24h posts. Following and Mine read the wallet:
// the Paris post is by 0.0.981180 (followed by 0.0.9779355, and an Early
// Hashinal holder), Rome is by 0.0.9779355; Berlin and London are holders,
// Madrid is nobody in particular.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('livedemo')) {
  const seed = () => {
    const now = Date.now();
    const post = (payer, lng, lat, title, hoursAgo) => ({
      payer,
      lng,
      lat,
      title,
      topic: '0.0.9609912',
      topicName: 'Freedom',
      created: new Date(now - hoursAgo * 3600000).toISOString(),
      lastSeen: now,
      msg: title + ' (made-up live post)',
      image: '',
    });
    // The bar lives on the map: leave the feed if it is covering it.
    if (document.documentElement.classList.contains('feed-app')) document.getElementById('layout-mode-btn')?.click();
    map.jumpTo({ center: [6, 47], zoom: 3.6 });
    showLocalMarkers([
      post('0.0.981180', 2.35, 48.85, 'Followed holder', 0),
      post('0.0.805149', 13.40, 52.52, 'Holder Berlin', 1),
      post('0.0.9779355', 12.49, 41.90, 'My post Rome', 2),
      post('0.0.555555', -3.70, 40.42, 'Nobody Madrid', 3),
      post('0.0.454863', -0.12, 51.50, 'Holder London', 4),
    ]);
  };
  // After the map has loaded and the start-up camera has settled.
  const start = () => map.once('idle', () => setTimeout(seed, 1200));
  if (map.loaded()) start();
  else map.once('load', start);
}
