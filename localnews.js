import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import { map } from './map';
import { createMarkerPopupHTML, mediaMode, lengthMode } from './processallmessages.js';
import { videoSeconds } from './mediaduration.js';
import { toast } from './toast.js';
import { fetchNearMarkers } from './msgbackend.js';
import { showSearchArea, hideSearchArea } from './liveradius.js';
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
import { liveGroup as groupNow, liveGroupName, setLiveGroup, openLiveGroupMenu, closeLiveGroupMenu, liveRadius, liveHours, liveHoursName, LIVE_HOURS_DEFAULT } from './livegroups.js';
import { secondsMatch, withinRadius, radiusKm, radiusLabel, formatKm } from './arrowfilters.js';

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
  // The live bar's × (not a new set replacing this one) also takes the
  // searched circle away.
  if (!silent) hideSearchArea();
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

// Type / Video length / Distance, read from the same saved popup settings
// as topic posts (arrowfilters.js). An array image is its first entry, the
// same way videoSeconds reads it.
function localMedia(m) {
  const image = m && Array.isArray(m.image) ? m.image[0] : m && m.image;
  if (image == null || image === '') return 'none';
  if (/\.(mp4|webm)(\?|#|$)/i.test(String(image))) return 'video';
  return 'picture';
}

function livePoint(m) {
  const lng = Number(m && m.lng);
  const lat = Number(m && m.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

// origin: where the open live post is, for Distance.
function localMatches(m, origin) {
  const show = mediaMode();
  const kind = localMedia(m);
  if (show === 'pictures' && kind !== 'picture') return false;
  if (show === 'videos' && kind !== 'video') return false;
  if (show === 'both' && kind !== 'picture' && kind !== 'video') return false;
  if (!withinRadius(origin, livePoint(m))) return false;
  const length = lengthMode();
  if (length === 'any' || kind !== 'video') return true;
  return secondsMatch(videoSeconds(m && m.image), length);
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

// "No more videos", "No more posts within 10 km", …
function localEndLabel() {
  const mode = mediaMode();
  let base = 'No more posts';
  if (mode === 'pictures') base = 'No more pictures';
  else if (mode === 'videos') base = 'No more videos';
  else if (mode === 'both') base = 'No more pictures or videos';
  else if (lengthMode() !== 'any' && radiusKm() == null) base = 'No more posts of that length';
  const near = radiusLabel();
  return near ? `${base} ${near}` : base;
}

// Newest-first, no wrap. The open post can be text; the arrow lands on the
// nearest item that matches Type, Video length and Distance.
function step(direction) {
  const dir = direction < 0 ? -1 : 1;
  const open = localList[localIndex];
  const origin = livePoint(open);
  for (let j = localIndex + dir; j >= 0 && j < localList.length; j += dir) {
    const item = localList[j];
    if (!localMatches(item, origin) || sameLivePost(item, open)) continue;
    navigateLocal(j);
    return;
  }
  if (mediaMode() !== 'all' || lengthMode() !== 'any' || radiusKm() != null) toast.info(localEndLabel());
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
  // A Following or Mine kept from an earlier visit shows nothing without a
  // wallet: say why, once per visit (the bar keeps saying it).
  const group = groupNow();
  if (needsWallet(group) && !walletNow()) {
    if (walletToldFor !== group) walletToast(group);
  } else if (group === 'following') {
    paintFollowing(); // before the paint, so the bar says Loading…
  }
  paintLiveGroup(); // first paint now, not on the next moveend
}

// ── Groups: whose live posts the map shows ─────────────────────────────
// The choice and its dropdown live in livegroups.js (Everyone, Following,
// NFT holders, Mine; kept for later searches). The dropdown opens from
// holding / right-clicking "Look for Live" (poiinfo.js) and from the group
// pill on the bar under the map's top bar; the bar also counts the shown
// posts and closes the live overlay. Popup ◀️/▶️ walk the shown group only.
let followIds = null; // Set of followed accounts, for followFor
let followFor = '';
let followLoad = null;
let liveBar = null;
let liveCount = null;
let livePill = null;
let livePillName = null;
let walletToldFor = ''; // the group the "Connect your wallet" toast last named

function walletNow() {
  const account = typeof connectedAccount === 'string' ? connectedAccount.trim() : '';
  return /^\d+\.\d+\.\d+$/.test(account) ? account : '';
}

function needsWallet(group) {
  return group === 'following' || group === 'mine';
}

function walletToast(group) {
  walletToldFor = group;
  toast.info('Connect your wallet to see ' + (group === 'mine' ? 'your live posts' : 'people you follow'));
}

// Following waits for the accounts this wallet follows, then repaints.
// Call it before the first paintLiveGroup(): it starts the load right
// away, so that paint finds followLoad set and the bar reads Loading…
// instead of "0 of N" until the list arrives.
function paintFollowing() {
  const set = liveAll;
  ensureFollowIds().then((state) => {
    // A stale load: the newer wallet's own paintFollowing repaints.
    if (state === 'stale' || liveAll !== set || groupNow() !== 'following') return;
    if (state === 'empty') toast.info('You do not follow anyone yet');
    else if (state === 'offline') toast.error('Could not load who you follow');
    paintLiveGroup();
  });
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
  // An older wallet's load finishing must not clear a newer one's
  // followLoad, or the bar drops to "0 of N" while that one still loads.
  const load = fetchFollowing(me).then((data) => {
    if (followLoad === load) followLoad = null;
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
    if (followLoad === load) followLoad = null;
    if (followFor !== me) return 'stale';
    followFor = '';
    return 'offline';
  });
  followLoad = load;
  return load;
}

function inLiveGroup(m) {
  const payer = m && m.payer;
  const group = groupNow();
  if (group === 'following') return !!(followIds && followFor === walletNow() && followIds.has(payer));
  if (group === 'holders') return earlyHashinalNumber(payer) > 0;
  if (group === 'mine') {
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
  const group = groupNow();
  if (needsWallet(group) && !walletNow()) return 'Connect wallet';
  if (group === 'following' && followLoad) return 'Loading…';
  if (group === 'holders' && !earlyHashinalReady()) return 'Loading…';
  if (group === 'all') return total === 1 ? '1 post' : `${total} posts`;
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
  // The group pill: the same dropdown as holding "Look for Live".
  livePill = document.createElement('button');
  livePill.type = 'button';
  livePill.className = 'live-filter-pick';
  livePill.setAttribute('aria-haspopup', 'menu');
  livePillName = document.createElement('span');
  livePillName.className = 'live-filter-pick-name';
  const caret = document.createElement('span');
  caret.className = 'live-filter-pick-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  livePill.append(livePillName, caret);
  livePill.addEventListener('click', (event) => {
    event.stopPropagation();
    openLiveGroupMenu(livePill, (key) => pickLiveGroup(key));
  });
  head.append(tag, livePill, liveCount, close);
  liveBar.append(head);
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
  const name = liveGroupName();
  livePillName.textContent = name;
  livePill.setAttribute('aria-label', `Showing ${name}. Choose whose live posts`);
  livePill.classList.toggle('is-filtered', groupNow() !== 'all');
  liveCount.textContent = liveCountText();
}

function hideLiveBar() {
  if (!liveBar) return;
  closeLiveGroupMenu({ within: liveBar });
  liveBar.hidden = true;
}

// Set the group (livegroups.js keeps it) and repaint what is shown.
// poiinfo.js calls this for a pick from the "Look for Live" list before it
// looks, so the toasts below cover that pick too.
export function pickLiveGroup(key) {
  if (!setLiveGroup(key)) return;
  if (needsWallet(key) && !walletNow()) walletToast(key);
  if (key === 'following' && walletNow()) paintFollowing();
  paintLiveGroup();
}

// A wallet that connects (or a session that restores after the page
// loaded) fills a Following or Mine overlay; a disconnect empties it.
document.addEventListener('wallet-account-changed', () => {
  walletToldFor = '';
  if (!liveAll.length || !needsWallet(groupNow())) return;
  if (groupNow() === 'following' && walletNow()) paintFollowing();
  paintLiveGroup();
});

// The holder list arrives after the globe draws and refreshes every 15 min.
onOwnersChange(() => {
  if (groupNow() === 'holders' && liveAll.length) paintLiveGroup();
});

// Live markers within the Look for Live distance (livegroups.js) of a
// spot, in any country, from the last chosen hours: the held pin
// (poiinfo.js), a search pick (search.js), or your location once the
// geolocate control has a fix (map.js). The server only has the last 24
// hours; a shorter choice is kept here. The searched circle stays on the
// map with them (liveradius.js); with none found it shows for a moment
// beside the toast.
let lookSeq = 0;
export async function showLocationMarkers(lat, lng) {
  const at = { lat: Number(lat), lng: Number(lng) };
  const km = liveRadius();
  const within = liveHours();
  const seq = ++lookSeq;
  const { markers, error } = await fetchNearMarkers(at.lat, at.lng, km);
  if (seq !== lookSeq) return; // a newer look took over
  if (error) return; // offline: leave whatever is shown
  const cutoff = Date.now() - within * 3600 * 1000;
  const recent = within >= LIVE_HOURS_DEFAULT
    ? markers
    : markers.filter((m) => Number(m.lastSeen) >= cutoff);
  showLocalMarkers(recent);
  showSearchArea(at, km, { flash: !recent.length });
  if (!recent.length) {
    const where = within >= LIVE_HOURS_DEFAULT
      ? formatKm(km)
      : formatKm(km) + ' in the last ' + liveHoursName(within);
    toast.info('No live posts within ' + where);
  }
}
