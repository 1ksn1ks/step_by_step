import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import { debounce } from '/debounce'
import { animateMapTo } from './animatemapto';
import { geojson, existingMarkers, newExistingMarkers, currentUfoModelInGLTF } from './letall';
import { map } from './map'
import { activePolygonPopups } from './polygons';
import { CloseALL, changePopupState } from './cssLogic';
import { closeDrawAnchor } from './drawhere';
import { closePressAnchor } from './poiinfo';
import { applyAllStyles } from './loadprofilepopup';
import { scene } from "./threejs";
// Circular with localnews.js (which imports the topic helpers from here) —
// safe: both sides only touch the other's bindings inside functions.
import { livePointCoords, livePointTitles } from './localnews';
import { markerPopupNode } from './processallmessages.js';
import { earlyHashinalNumber } from './earlyhashinal.js';
import { prefetchPersonFollow } from './followtopic.js';
import { watchMarkerTilt, forgetMarkerTilt } from './markertilt.js';
import { fillMapTip } from './maptip.js';
import { bindMarkerHold, holdMoveLimit } from './markerhold.js';
import { isPointerOnGlobe } from './onglobe.js';
import { forgetLoop, pictureElement } from './loopmedia.js';
import { closeMarkerStack, isMarkerStackOpenFor, openMarkerStack } from './markerstack.js';



export let activeMarkerPopups = [];

export function newActiveMarkerPopups(a) {
  activeMarkerPopups = a;
}

function markerPictureUrl(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw : '';
}

// True when [lng, lat] is on the visible side of the globe. On a globe,
// far-side points otherwise project onto the visible disc (see-through).
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


export const index = new Supercluster({
    radius: 60,
    maxZoom: 11,
  });

let currentMarkerSize = 5;

export function setcurrentMarkerSize(a) {
  currentMarkerSize = a;
}

// The live view (localnews.js) sizes its glowing ring to this same value so
// it wraps a topic marker dot exactly when they share a spot.
export function getCurrentMarkerSize() {
  return currentMarkerSize;
}

// True when topic markers are both loaded (a topic was searched) and the
// visibility toggle is on — the live layer needs this to tell "twin sits
// behind a cluster bubble" (hide the live marker) from "no topic layer at
// all" (plain solid dot at the true point).
export function isTopicLayerActive() {
  return markersVisible && geojson.features.length > 0;
}

// Coordinates of topic markers currently drawn as INDIVIDUAL dots (not
// inside a cluster). The live layer checks this by coordinate: a live marker
// whose twin is an individual dot gets the border-only "live ring" style;
// one whose twin sits inside a cluster gets the old solid dot.
export const unclusteredTopicPoints = new Set();
const topicPointKey = ([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
function notifyTopicClustersUpdated() {
  document.dispatchEvent(new Event('topic-clusters-updated'));
}

let lastTopicSig = null;

// Title pill just above the pointer. A mouse hover shows it. A touch or pen
// hold shows the same pill and does not open the post. A short tap still does.
// Live twins already wear a permanent label under the dot.
let markerTitleTip = null;
let markerTitleHideTimer = 0;
const HOLD_TIP_MS = 2500;
const cancelMarkerHolds = new Set();

function ensureMarkerTitleTip() {
  if (markerTitleTip) return markerTitleTip;
  markerTitleTip = document.createElement("div");
  markerTitleTip.className = "marker-title-tip";
  markerTitleTip.hidden = true;
  document.body.appendChild(markerTitleTip);
  return markerTitleTip;
}

function hideMarkerTitle() {
  clearTimeout(markerTitleHideTimer);
  if (!markerTitleTip) return;
  markerTitleTip.hidden = true;
  markerTitleTip._tipEl = null;
  markerTitleTip._held = false;
  markerTitleTip.classList.remove("early");
  const spin = markerTitleTip.querySelector(":scope > .marker-tip-spin");
  if (spin) spin.remove();
}

// The class tracks the marker payer, and the next non-early marker takes
// it off. fillMapTip replaces the tip's children, so the spinning border
// is put back after that fill. Hover and a touch hold both use this.
function syncMarkerTipEarly(tip, el) {
  const early = !!(el && earlyHashinalNumber(el._markerPayer || ""));
  tip.classList.toggle("early", early);
  let spin = tip.querySelector(":scope > .marker-tip-spin");
  if (!early) {
    if (spin) spin.remove();
    return;
  }
  if (spin) return;
  spin = document.createElement("span");
  spin.className = "marker-tip-spin";
  spin.setAttribute("aria-hidden", "true");
  tip.prepend(spin);
}

function markerLngLat(el) {
  const coords = el && el._markerTip && el._markerTip.geometry && el._markerTip.geometry.coordinates;
  return coords || null;
}

function markerCanvasPoint(x, y) {
  const rect = map.getCanvas().getBoundingClientRect();
  return { x: x - rect.left, y: y - rect.top };
}

function showMarkerTitle(el, x, y) {
  if (!el || !Number.isFinite(x) || !Number.isFinite(y)) {
    hideMarkerTitle();
    return false;
  }
  if (!isPointerOnGlobe(markerCanvasPoint(x, y), markerLngLat(el))) {
    hideMarkerTitle();
    el.style.cursor = '';
    return false;
  }
  el.style.cursor = 'pointer';
  const tip = ensureMarkerTitleTip();
  if (tip._tipEl !== el) {
    if (!fillMapTip(tip, el._markerTip)) {
      hideMarkerTitle();
      return false;
    }
    tip._tipEl = el;
  }
  syncMarkerTipEarly(tip, el);
  clearTimeout(markerTitleHideTimer);
  tip._held = false;
  tip.hidden = false;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  return true;
}

// The desktop rule pins the pill above the point with translate(-50%, -100% - 14px).
// A hold passes the press point, so the same offset clears the finger.
function showHeldMarkerTitle(el, x, y) {
  if (!showMarkerTitle(el, x, y)) return false;
  markerTitleTip._held = true;
  markerTitleHideTimer = setTimeout(hideMarkerTitle, HOLD_TIP_MS);
  return true;
}

function markerHoldMoveLimit() {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return holdMoveLimit(root);
}

function markerCanHover() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

map.on("movestart", () => {
  hideMarkerTitle();
  for (const cancel of cancelMarkerHolds) cancel();
});

// A tap after the finger has lifted. The press that opened the pill already
// happened, so this is the next one. A mouse hover never sets _held.
document.addEventListener("pointerdown", () => {
  if (!markerTitleTip || markerTitleTip.hidden || !markerTitleTip._held) return;
  hideMarkerTitle();
}, true);

function releaseMarkerHold(entry) {
  const release = entry && entry.el && entry.el._releaseTitleHold;
  if (release) release();
}

function bindMarkerTitle(el) {
  el.style.webkitTouchCallout = "none";
  el.style.webkitUserSelect = "none";
  el.style.userSelect = "none";
  const hoverOwnsTip = () => !(markerTitleTip && markerTitleTip._held);
  el.addEventListener("mouseenter", (event) => {
    if (!hoverOwnsTip()) return;
    if (!isPointerOnGlobe(markerCanvasPoint(event.clientX, event.clientY), markerLngLat(el))) {
      hideMarkerTitle();
      el.style.cursor = '';
      return;
    }
    prefetchPersonFollow(el._markerPayer);
    if (markerCanHover()) showMarkerTitle(el, event.clientX, event.clientY);
  });
  el.addEventListener("mousemove", (event) => {
    if (!hoverOwnsTip()) return;
    if (!isPointerOnGlobe(markerCanvasPoint(event.clientX, event.clientY), markerLngLat(el))) {
      hideMarkerTitle();
      el.style.cursor = '';
      return;
    }
    if (markerCanHover()) showMarkerTitle(el, event.clientX, event.clientY);
  });
  el.addEventListener("mouseleave", () => {
    if (!hoverOwnsTip()) return;
    if (markerCanHover()) hideMarkerTitle();
  });
  el.addEventListener("contextmenu", (event) => event.preventDefault());
  el.addEventListener("touchstart", (event) => {
    prefetchPersonFollow(el._markerPayer);
    // This touch is the marker's. The map long-press is a canvas listener,
    // and the map's own pan handler sits on the parent of this element.
    event.stopPropagation();
  }, { passive: true });
  const hold = bindMarkerHold(el, {
    show: showHeldMarkerTitle,
    moveLimit: markerHoldMoveLimit,
  });
  cancelMarkerHolds.add(hold.cancelPending);
  el._releaseTitleHold = () => {
    hold.endHold();
    cancelMarkerHolds.delete(hold.cancelPending);
  };
}

// Dots that are still on screen stay. A cluster change only adds the
// markers that appeared and removes the ones that left. Keys are the
// supercluster id for a bubble and the drawing identity for a point, so a
// reload of the same drawing reuses its element and its picture.
const keptMarkers = new Map();

function markerFeatureKey(cluster) {
  if (cluster.stack) return 's:' + markerFeatureKey(cluster.leaves[0]);
  if (cluster.properties.cluster) return 'c' + cluster.properties.cluster_id;
  const num = cluster.msgNumber != null ? cluster.msgNumber : '';
  return `p:${cluster.topicId || ''}:${cluster.payer || ''}:${num}:${topicPointKey(cluster.geometry.coordinates)}`;
}

// Bubbles, one rule for all of them:
//   tap        zooms in until the dots come apart (a cluster to where it
//              splits, overlapping dots to where they stop covering each
//              other). Dots on the very same spot never come apart: the
//              tap takes them to street level, and once there, lists them.
//   hold / right-click   lists the posts in the bubble straight away.
// The list is markerstack.js (search, one row per post, pick to open).
// Only a bubble whose dots cannot be pulled apart wears the stacked ring,
// so the ring means "a tap lists these".
//
// Past the cluster zoom (index maxZoom) every post is its own dot, and
// dots closer than STACK_OVERLAP of a dot's width cover each other, so only
// the top one could be tapped: those draw as one bubble with their count,
// and split again as zooming pulls them apart. Clusters pass through.
const STACK_OVERLAP = 0.6;
const STREET_ZOOM = 16;
const RING_CHECK_MAX = 50; // larger clusters are never one spot in practice

function stackReach() {
  return (currentMarkerSize / 100) * window.innerHeight * STACK_OVERLAP;
}

// The zoom at which dots whose on-screen box has this larger side stop
// covering each other, or null when even the deepest zoom cannot.
function zoomForSpread(spread, reach = stackReach()) {
  if (!(spread > 1e-9)) return null;
  const z = map.getZoom() + Math.log2(reach / spread) + 0.2;
  return z <= map.getMaxZoom() ? z : null;
}

// The zoom at which these dots stop covering each other, or null when even
// the deepest zoom cannot pull them apart. The spread is the larger side of
// their on-screen box, which some pair is at least that far apart along.
function separateZoom(features) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of features) {
    let p = null;
    try { p = map.project(f.geometry.coordinates); } catch { p = null; }
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return zoomForSpread(Math.max(maxX - minX, maxY - minY));
}

// Whether a cluster's dots sit on one spot does not depend on the zoom, so
// it is worked out once per cluster and kept until the posts reload
// (index.load makes new trees) or the dot size changes. The test runs in
// Mercator units at the deepest zoom, the same rule as separateZoom without
// projecting every dot.
const oneSpotByCluster = new Map();
let oneSpotTrees = null;
let oneSpotReach = 0;

function mercatorXY(coords) {
  const lng = Number(coords[0]);
  const lat = Math.max(-85.051129, Math.min(85.051129, Number(coords[1])));
  const sin = Math.sin((lat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

function clusterOneSpot(cluster, reach) {
  if (index.trees !== oneSpotTrees || reach !== oneSpotReach || oneSpotByCluster.size > 5000) {
    oneSpotByCluster.clear();
    oneSpotTrees = index.trees;
    oneSpotReach = reach;
  }
  const id = cluster.properties.cluster_id;
  const known = oneSpotByCluster.get(id);
  if (known !== undefined) return known;
  let leaves = [];
  try { leaves = index.getLeaves(id, RING_CHECK_MAX); } catch { leaves = []; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const leaf of leaves) {
    const [x, y] = mercatorXY(leaf.geometry.coordinates);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  // World width in pixels 0.2 below the deepest zoom (the +0.2 margin).
  const world = 512 * Math.pow(2, map.getMaxZoom() - 0.2);
  const spread = Math.max(maxX - minX, maxY - minY) * world;
  const one = leaves.length > 1 && !(spread >= reach);
  oneSpotByCluster.set(id, one);
  return one;
}

// A number per grid cell. Cells far off screen could share one, which only
// adds groups to the distance check, never hides one.
function cellKey(cx, cy) {
  return (cx + 0x8000) * 0x10000 + (cy + 0x8000);
}

// Dots past the cluster zoom join the first group (in the order groups
// were made) within reach. Groups sit in a grid of reach-sized cells, so a
// dot only checks the 3×3 cells around it rather than every group.
function stackOverlaps(features) {
  const reach = stackReach();
  const reach2 = reach * reach;
  const cell = reach > 0 ? reach : 1;
  const out = [];
  const spots = [];
  const grid = new Map();
  for (const f of features) {
    if (f.properties && f.properties.cluster) {
      const n = f.properties.point_count || 0;
      if (n > 1 && n <= RING_CHECK_MAX) f.properties.oneSpot = clusterOneSpot(f, reach);
      out.push(f);
      continue;
    }
    let p = null;
    try { p = map.project(f.geometry.coordinates); } catch { p = null; }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      out.push(f);
      continue;
    }
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    let home = null;
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get(cellKey(gx, gy));
        if (!bucket) continue;
        for (const spot of bucket) {
          if (home && spot.order > home.order) break;
          const dx = spot.x - p.x;
          const dy = spot.y - p.y;
          if (dx * dx + dy * dy <= reach2) {
            home = spot;
            break;
          }
        }
      }
    }
    if (home) {
      home.leaves.push(f);
      if (p.x < home.minX) home.minX = p.x;
      if (p.y < home.minY) home.minY = p.y;
      if (p.x > home.maxX) home.maxX = p.x;
      if (p.y > home.maxY) home.maxY = p.y;
      continue;
    }
    const spot = { order: spots.length, x: p.x, y: p.y, minX: p.x, minY: p.y, maxX: p.x, maxY: p.y, leaves: [f] };
    spots.push(spot);
    const key = cellKey(cx, cy);
    const bucket = grid.get(key);
    if (bucket) bucket.push(spot);
    else grid.set(key, [spot]);
  }
  for (const spot of spots) {
    if (spot.leaves.length === 1) {
      out.push(spot.leaves[0]);
      continue;
    }
    out.push({
      type: 'Feature',
      stack: true,
      leaves: spot.leaves,
      properties: {
        cluster: false,
        stack: true,
        // The box of the projections above: separateZoom without projecting again.
        oneSpot: zoomForSpread(Math.max(spot.maxX - spot.minX, spot.maxY - spot.minY), reach) == null,
        point_count: spot.leaves.length,
        point_count_abbreviated: String(spot.leaves.length),
      },
      geometry: { type: 'Point', coordinates: spot.leaves[0].geometry.coordinates },
    });
  }
  return out;
}

function bubbleLeaves(entry) {
  if (entry.kind === 'stack') return entry.leaves || [];
  try {
    return index.getLeaves(entry.cluster.properties.cluster_id, Infinity);
  } catch {
    return [];
  }
}

function dropMarkerPopups() {
  activePolygonPopups.forEach((p) => p.remove());
  activeMarkerPopups.forEach((p) => p.remove());
}

// The tap: zoom in until they come apart; one spot lists at street level.
function tapBubble(entry) {
  if (isMarkerStackOpenFor(entry.el)) {
    closeMarkerStack();
    return;
  }
  const coords = entry.cluster.geometry.coordinates;
  if (entry.kind === 'cluster') {
    let expand = Infinity;
    try { expand = index.getClusterExpansionZoom(entry.cluster.properties.cluster_id); } catch { expand = Infinity; }
    if (expand <= index.options.maxZoom) {
      dropMarkerPopups();
      animateMapTo(map, coords, expand + 0.1);
      return;
    }
  }
  const leaves = bubbleLeaves(entry);
  const zoom = map.getZoom();
  const apart = leaves.length > 1 ? separateZoom(leaves) : null;
  if (apart != null && apart > zoom + 0.05) {
    dropMarkerPopups();
    animateMapTo(map, coords, apart);
    return;
  }
  if (apart == null && zoom < STREET_ZOOM - 0.05) {
    dropMarkerPopups();
    animateMapTo(map, coords, STREET_ZOOM);
    return;
  }
  openSpotList(entry, leaves);
}

// Hold (touch / pen) or right-click: the list right away. The click that a
// hold ends with is swallowed so the bubble does not zoom as well: until
// the finger lifts, then briefly (a click lands just after pointerup).
// Time-limited, so a later click without a press (keyboard, screen
// reader) is never eaten.
const HOLD_MS = 480;
const SWALLOW_MS = 600;
function bindBubbleList(entry) {
  const el = entry.el;
  let timer = 0;
  let sx = 0;
  let sy = 0;
  entry.swallowUntil = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
  };
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancel();
    if (entry.swallowUntil !== Infinity) entry.swallowUntil = performance.now() + SWALLOW_MS;
    openSpotList(entry, bubbleLeaves(entry));
  });
  el.addEventListener('pointerdown', (e) => {
    entry.swallowUntil = 0;
    if (e.pointerType === 'mouse') return;
    sx = e.clientX;
    sy = e.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = 0;
      entry.swallowUntil = Infinity;
      openSpotList(entry, bubbleLeaves(entry));
    }, HOLD_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancel();
  });
  const lift = () => {
    cancel();
    if (entry.swallowUntil === Infinity) entry.swallowUntil = performance.now() + SWALLOW_MS;
  };
  el.addEventListener('pointerup', lift);
  el.addEventListener('pointercancel', lift);
  // Keyboard: Tab reaches the bubble, Enter or Space is the tap, and the
  // menu key or Shift+F10 sends contextmenu, which lists the posts.
  el.tabIndex = 0;
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    tapBubble(entry);
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (performance.now() < entry.swallowUntil) {
      entry.swallowUntil = 0;
      return;
    }
    entry.swallowUntil = 0;
    tapBubble(entry);
  });
}

function bubbleLabel(cluster) {
  const n = cluster.properties.point_count || 0;
  return cluster.properties.oneSpot
    ? `${n} posts on one spot. Tap to zoom in and list them, or hold to list them now.`
    : `${n} posts. Tap to zoom in, hold to list them.`;
}

function makeMarkerPopup() {
  const popup = new maplibregl.Popup({ focusAfterOpen: false });
  popup.on('close', () => {
    changePopupState(false);
    if (currentUfoModelInGLTF) {
      scene.add(currentUfoModelInGLTF);
      crosshair.style.display = 'block';
    }
  });
  return popup;
}

// One post's popup: a dot's tap, or a pick from a spot's list.
function openFeaturePopup(feature, popup) {
  hideMarkerTitle();
  const node = markerPopupNode(feature.properties, feature);
  if (!node) return;
  activePolygonPopups.forEach((p) => p.remove());
  activeMarkerPopups.forEach((p) => p.remove());
  activeMarkerPopups.push(popup);
  CloseALL();
  closeDrawAnchor();
  closePressAnchor(); // a marker popup replaces the 🗺/📡 pin too
  popup.setLngLat(feature.geometry.coordinates).addTo(map).setDOMContent(node);
  animateMapTo(map, feature.geometry.coordinates, null);
  applyAllStyles();
  changePopupState(true);
  if (currentUfoModelInGLTF) {
    scene.remove(currentUfoModelInGLTF);
    crosshair.style.display = 'none';
  }
}

// Picks from a list share one popup: those posts have no dot of their own.
let stackPickPopup = null;
function openSpotList(entry, leaves) {
  if (!leaves || leaves.length === 0) return;
  if (isMarkerStackOpenFor(entry.el)) return;
  hideMarkerTitle();
  dropMarkerPopups();
  closeDrawAnchor();
  closePressAnchor();
  openMarkerStack(entry.el, leaves, (feature) => {
    if (!stackPickPopup) stackPickPopup = makeMarkerPopup();
    openFeaturePopup(feature, stackPickPopup);
  });
}

function applyMarkerBox(el, isCluster) {
  const size = `${currentMarkerSize}vh`;
  el.style.width = size;
  el.style.height = size;
  el.style.cursor = 'pointer';
  if (isCluster) {
    el.style.minWidth = size;
    el.style.boxSizing = 'border-box';
  }
}

function placeKeptMarker(entry) {
  if (!entry.marker._map) entry.marker.addTo(map);
}

export function releaseTopicMarkers() {
  const hadPoints = unclusteredTopicPoints.size > 0;
  const hadMarkers = keptMarkers.size > 0;
  for (const entry of keptMarkers.values()) {
    releaseMarkerHold(entry);
    forgetMarkerTilt(entry.face);
    const loop = entry.face && entry.face.querySelector('video.loop-face');
    if (loop) forgetLoop(loop);
    try { entry.marker.remove(); } catch { /* already gone */ }
  }
  keptMarkers.clear();
  closeMarkerStack();
  newExistingMarkers([]);
  lastTopicSig = null;
  hideMarkerTitle();
  if (hadPoints || hadMarkers) {
    unclusteredTopicPoints.clear();
    notifyTopicClustersUpdated();
  }
}

function syncKeptMarkers() {
  const list = [];
  for (const entry of keptMarkers.values()) list.push(entry.marker);
  newExistingMarkers(list);
}

// The face sits in a MapLibre marker (transform, not scroll). A still is an
// img. A GIF is frame 0 and stays still. A video is a small muted loop
// that plays while the dot is on the map and pauses when the tab is hidden.
function paintMarkerPicture(entry, url) {
  const seq = (entry.pictureSeq || 0) + 1;
  entry.pictureSeq = seq;
  entry.pictureUrl = url || '';
  const face = entry.face;
  let view = face.querySelector('img, video.loop-face');
  face.querySelectorAll('canvas.media-still, video.media-gif-play').forEach((node) => node.remove());
  if (!url) {
    if (view && view.tagName === 'VIDEO') forgetLoop(view);
    if (view) view.remove();
    face.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
    return;
  }
  if (view) {
    if (view.tagName === 'VIDEO') forgetLoop(view);
    view.remove();
  }
  view = pictureElement(url, { alt: '', className: 'marker-loop' });
  view.draggable = false;
  const clear = () => {
    if (entry.pictureSeq !== seq) return;
    face.style.backgroundColor = '';
  };
  const fail = () => {
    if (entry.pictureSeq !== seq) return;
    if (view.tagName === 'VIDEO') forgetLoop(view);
    view.remove();
    face.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
  };
  if (view.tagName === 'VIDEO') {
    view.addEventListener('loadeddata', clear);
    view.addEventListener('error', fail);
  } else {
    view.loading = 'eager';
    view.decoding = 'async';
    view.onload = clear;
    view.onerror = fail;
  }
  face.insertBefore(view, face.firstChild);
}

function paintMarkerHashinal(entry) {
  if (!entry || entry.kind !== 'point') return;
  const face = entry.face;
  const el = entry.el;
  if (!face || !el) return;
  const n = earlyHashinalNumber(entry.feature && entry.feature.payer);
  const spin = face.querySelector(':scope > .early-hashinal-spin');
  el.classList.remove('early-hashinal-holder');
  if (el.dataset.ehTip) {
    delete el.dataset.tip;
    delete el.dataset.ehTip;
    el.removeAttribute('title');
    el.removeAttribute('aria-label');
  }
  if (!n) {
    face.classList.remove('early-hashinal');
    if (spin) spin.remove();
    return;
  }
  face.classList.add('early-hashinal');
  if (!spin) {
    const ring = document.createElement('span');
    ring.className = 'early-hashinal-spin';
    ring.setAttribute('aria-hidden', 'true');
    face.insertBefore(ring, face.firstChild);
  }
}

document.addEventListener('early-hashinals', () => {
  for (const entry of keptMarkers.values()) paintMarkerHashinal(entry);
  if (markerTitleTip && !markerTitleTip.hidden && markerTitleTip._tipEl) {
    syncMarkerTipEarly(markerTitleTip, markerTitleTip._tipEl);
  }
});

function syncLiveFace(entry) {
  const twinKey = topicPointKey(entry.feature.geometry.coordinates);
  const live = livePointCoords.has(twinKey);
  entry.face.classList.toggle('live-twin', live);
  const liveTitle = live ? (livePointTitles.get(twinKey) || '') : '';
  let label = entry.face.querySelector('.local-marker-label');
  if (liveTitle) {
    if (!label) {
      label = document.createElement('div');
      label.className = 'local-marker-label';
      entry.face.appendChild(label);
    }
    if (label.textContent !== liveTitle) label.textContent = liveTitle;
  } else if (label) {
    label.remove();
  }
  // The live label stays under the dot. The hover card still names the post.
  entry.el._markerTip = entry.feature;
  if (!entry.titleBound) {
    bindMarkerTitle(entry.el);
    entry.titleBound = true;
  }
}

function createKeptMarker(cluster, key) {
  const kind = cluster.stack ? 'stack' : cluster.properties.cluster ? 'cluster' : 'point';
  const isCluster = kind !== 'point';
  const el = document.createElement('div');
  el.className = isCluster ? 'cluster-bubble' : 'marker';
  if (isCluster) el.classList.toggle('is-stack', !!cluster.properties.oneSpot);
  applyMarkerBox(el, isCluster);
  const entry = { key, el, kind };

  if (isCluster) {
    entry.cluster = cluster;
    // The count sits on an inner face. The outer element is MapLibre's
    // marker and keeps the transform that places the bubble.
    const face = document.createElement('div');
    face.className = 'cluster-face';
    face.textContent = cluster.properties.point_count_abbreviated;
    el.appendChild(face);
    entry.face = face;
    watchMarkerTilt(face);
    if (kind === 'stack') entry.leaves = cluster.leaves;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', bubbleLabel(cluster));
    bindBubbleList(entry);
  } else {
    entry.feature = cluster;
    el._markerPayer = cluster.payer || '';
    // The visual goes on an inner face element: the outer element is
    // MapLibre's marker element (positioned absolute + transform by
    // .maplibregl-marker) and must NEVER get a position of its own —
    // position:relative would put it back in the document flow (stacked
    // after the other markers) and shift it. The face fills the outer
    // element, so the anchored box stays exactly the dot.
    const face = document.createElement('div');
    face.className = 'marker-face';
    face.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
    el.appendChild(face);
    entry.face = face;
    watchMarkerTilt(face);
    entry.pictureUrl = null;
    entry.pictureSeq = 0;
    entry.titleBound = false;
    const popup = makeMarkerPopup();
    entry.popup = popup;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openFeaturePopup(entry.feature, popup);
    });
    syncLiveFace(entry);
    paintMarkerPicture(entry, markerPictureUrl(cluster.properties.imageUrl));
    paintMarkerHashinal(entry);
  }

  entry.marker = new maplibregl.Marker({ element: el })
    .setLngLat(cluster.geometry.coordinates)
    .addTo(map);
  return entry;
}

function refreshKeptMarker(entry, cluster) {
  applyMarkerBox(entry.el, entry.kind !== 'point');
  entry.marker.setLngLat(cluster.geometry.coordinates);
  placeKeptMarker(entry);
  if (entry.kind !== 'point') {
    entry.cluster = cluster;
    if (entry.kind === 'stack') entry.leaves = cluster.leaves;
    entry.el.classList.toggle('is-stack', !!cluster.properties.oneSpot);
    entry.el.setAttribute('aria-label', bubbleLabel(cluster));
    const count = String(cluster.properties.point_count_abbreviated);
    if (entry.face && entry.face.textContent !== count) entry.face.textContent = count;
    return;
  }
  entry.feature = cluster;
  entry.el._markerPayer = cluster.payer || '';
  syncLiveFace(entry);
  paintMarkerHashinal(entry);
  const pictureUrl = markerPictureUrl(cluster.properties.imageUrl);
  if (pictureUrl !== entry.pictureUrl) paintMarkerPicture(entry, pictureUrl);
}

export function updateClusters(force = true) {
  if (markersVisible){
    if (geojson.features.length === 0) {
      // Notify only on the real transition — the per-frame viewport path
      // calls this constantly and must stay silent when nothing changed.
      if (keptMarkers.size > 0 || unclusteredTopicPoints.size > 0) releaseTopicMarkers();
      return;
    }

    const currentBounds = map.getBounds().toArray().flat();
    const zoom = map.getZoom();
    // A camera move (initial XYZ flyTo) can run while topic messages are
    // still being parsed, before index.load. getClusters then throws inside
    // the map frame and the map stays dead ("already running").
    const treeZoom = Math.max(
      index.options.minZoom,
      Math.min(Math.floor(+zoom), index.options.maxZoom + 1)
    );
    if (!Number.isFinite(treeZoom) || !index.trees[treeZoom]) return;
    // Drop points on the far side of the globe — they would project
    // through the sphere onto the visible disc
    const clusters = stackOverlaps(index.getClusters(currentBounds, Math.floor(zoom)).filter(
      (c) => isOnVisibleHemisphere(c.geometry.coordinates)
    ));
    // Per-frame viewport path (force=false): re-render only on the exact
    // frame the cluster state changes — otherwise the markers are already
    // at their true coordinates and simply pan/zoom with the map.
    const sig = clusters
      .map((c) => markerFeatureKey(c))
      .sort()
      .join('|');
    if (!force && sig === lastTopicSig) return;
    if (sig !== lastTopicSig) hideMarkerTitle();
    lastTopicSig = sig;

    const wanted = new Map();
    for (const cluster of clusters) wanted.set(markerFeatureKey(cluster), cluster);
    for (const key of [...keptMarkers.keys()]) {
      if (wanted.has(key)) continue;
      const gone = keptMarkers.get(key);
      releaseMarkerHold(gone);
      forgetMarkerTilt(gone.face);
      gone.marker.remove();
      keptMarkers.delete(key);
    }

    unclusteredTopicPoints.clear();
    for (const [key, cluster] of wanted) {
      const entry = keptMarkers.get(key);
      if (entry) refreshKeptMarker(entry, cluster);
      else keptMarkers.set(key, createKeptMarker(cluster, key));
      if (!cluster.properties.cluster && !cluster.stack) {
        unclusteredTopicPoints.add(topicPointKey(cluster.geometry.coordinates));
      }
    }
    syncKeptMarkers();
    notifyTopicClustersUpdated();
  } else {
    // topic markers hidden → every live dot uses the old solid style
    unclusteredTopicPoints.clear();
    notifyTopicClustersUpdated();
  }

}
  
  
 export const debouncedUpdateClusters = debounce(() => {
    updateClusters();
  }, 1000);

  // Per-frame viewport path (see updateClusters) — the old 1s-debounced
  // moveend re-render let the cluster state lag the zoom, which read as
  // markers sliding and jumping mid-zoom.
  const viewportTopicUpdate = () => {
    try {
      updateClusters(false);
    } catch (err) {
      console.error("updateClusters failed", err);
    }
  };

  let markersVisible = false;

  document.getElementById("toggle-marker-visibility").addEventListener("click", () => {
    toggleMarkers();
});

// The live dataset was loaded or cleared — re-render so every topic dot
// picks up (or drops) the live border.
document.addEventListener("live-dataset-changed", () => {
  if (markersVisible) updateClusters();
});



    function toggleMarkers() {
      markersVisible = !markersVisible;

      existingMarkers.forEach(marker => {
          if (marker.getElement()) {
              if (markersVisible) {
                  marker.getElement().style.display = 'block';
                  marker.addTo(map);
              } else {
                  marker.getElement().style.display = 'none';
                  marker.remove();
              }
          }
      });

      document.getElementById("marker-visibility-value").textContent = markersVisible ? "On" : "Off";
      document.getElementById("marker-visibility-value2").textContent = markersVisible ? "On" : "Off";

      if (!markersVisible) {
          map.off("move", viewportTopicUpdate);
          map.off("moveend", viewportTopicUpdate);
          // Topic layer just went away — the live layer must re-check which
          // of its points still duplicate it.
          document.dispatchEvent(new Event('topic-clusters-updated'));
      } else {
          map.on("move", viewportTopicUpdate);
          map.on("moveend", viewportTopicUpdate);
          // Fresh cluster state (the map may have moved while hidden) and a
          // fresh live-border pass over every dot.
          updateClusters();
      }
  }

  toggleMarkers()