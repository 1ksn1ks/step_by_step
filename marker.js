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
import { isPointerOnGlobe } from './onglobe.js';



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

// Title pill just above the cursor on a device that can hover. A phone tap
// always opens the marker. Live twins already wear a permanent label.
let markerTitleTip = null;
let markerTitleHideTimer = 0;

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
  markerTitleTip.classList.remove("early");
  const spin = markerTitleTip.querySelector(":scope > .marker-tip-spin");
  if (spin) spin.remove();
}

// Desktop hover only. The class tracks the marker payer, and the next
// non-early marker takes it off. fillMapTip replaces the tip's children,
// so the spinning border is put back after that fill.
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
    return;
  }
  if (!isPointerOnGlobe(markerCanvasPoint(x, y), markerLngLat(el))) {
    hideMarkerTitle();
    el.style.cursor = '';
    return;
  }
  el.style.cursor = 'pointer';
  const tip = ensureMarkerTitleTip();
  if (tip._tipEl !== el) {
    if (!fillMapTip(tip, el._markerTip)) {
      hideMarkerTitle();
      return;
    }
    tip._tipEl = el;
  }
  syncMarkerTipEarly(tip, el);
  clearTimeout(markerTitleHideTimer);
  tip.hidden = false;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function markerCanHover() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

map.on("movestart", () => {
  hideMarkerTitle();
});

function bindMarkerTitle(el) {
  el.addEventListener("mouseenter", (event) => {
    if (!isPointerOnGlobe(markerCanvasPoint(event.clientX, event.clientY), markerLngLat(el))) {
      hideMarkerTitle();
      el.style.cursor = '';
      return;
    }
    prefetchPersonFollow(el._markerPayer);
    if (markerCanHover()) showMarkerTitle(el, event.clientX, event.clientY);
  });
  el.addEventListener("mousemove", (event) => {
    if (!isPointerOnGlobe(markerCanvasPoint(event.clientX, event.clientY), markerLngLat(el))) {
      hideMarkerTitle();
      el.style.cursor = '';
      return;
    }
    if (markerCanHover()) showMarkerTitle(el, event.clientX, event.clientY);
  });
  el.addEventListener("mouseleave", () => {
    if (markerCanHover()) hideMarkerTitle();
  });
  el.addEventListener("contextmenu", (event) => event.preventDefault());
  el.addEventListener("touchstart", () => {
    prefetchPersonFollow(el._markerPayer);
  }, { passive: true });
}

// Dots that are still on screen stay. A cluster change only adds the
// markers that appeared and removes the ones that left. Keys are the
// supercluster id for a bubble and the drawing identity for a point, so a
// reload of the same drawing reuses its element and its picture.
const keptMarkers = new Map();

function markerFeatureKey(cluster) {
  if (cluster.properties.cluster) return 'c' + cluster.properties.cluster_id;
  const num = cluster.msgNumber != null ? cluster.msgNumber : '';
  return `p:${cluster.topicId || ''}:${cluster.payer || ''}:${num}:${topicPointKey(cluster.geometry.coordinates)}`;
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
    forgetMarkerTilt(entry.face);
    try { entry.marker.remove(); } catch { /* already gone */ }
  }
  keptMarkers.clear();
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

// The face sits in a MapLibre marker (transform, not scroll). Set the cover
// URL directly. A viewport lazy observer never sees these on a phone.
function paintMarkerPicture(entry, url) {
  const seq = (entry.pictureSeq || 0) + 1;
  entry.pictureSeq = seq;
  entry.pictureUrl = url || '';
  const face = entry.face;
  let view = face.querySelector('img');
  if (!url) {
    if (view) view.remove();
    face.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
    return;
  }
  if (!view) {
    view = document.createElement('img');
    view.alt = '';
    view.draggable = false;
    view.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center;border-radius:50%;display:block;pointer-events:none;';
    face.insertBefore(view, face.firstChild);
  }
  view.loading = 'eager';
  view.decoding = 'async';
  view.onload = () => {
    if (entry.pictureSeq !== seq) return;
    face.style.backgroundColor = '';
  };
  view.onerror = () => {
    if (entry.pictureSeq !== seq) return;
    view.remove();
    face.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
  };
  if (view.getAttribute('src') !== url) view.src = url;
  else face.style.backgroundColor = '';
}

function paintMarkerHashinal(entry) {
  if (!entry || entry.kind === 'cluster') return;
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
  const isCluster = !!cluster.properties.cluster;
  const el = document.createElement('div');
  el.className = isCluster ? 'cluster-bubble' : 'marker';
  applyMarkerBox(el, isCluster);
  const entry = { key, el, kind: isCluster ? 'cluster' : 'point' };

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
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const current = entry.cluster;
      activePolygonPopups.forEach((popup) => popup.remove());
      activeMarkerPopups.forEach((popup) => popup.remove());
      const expansionZoom = await index.getClusterExpansionZoom(current.id) + 0.1;
      animateMapTo(map, current.geometry.coordinates, expansionZoom);
    });
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
    const popup = new maplibregl.Popup({ focusAfterOpen: false });
    entry.popup = popup;
    popup.on('close', () => {
      changePopupState(false);
      if (currentUfoModelInGLTF) {
        scene.add(currentUfoModelInGLTF);
        crosshair.style.display = 'block';
      }
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      hideMarkerTitle();
      const current = entry.feature;
      const node = markerPopupNode(current.properties, current);
      if (!node) return;
      activePolygonPopups.forEach((popup) => popup.remove());
      activeMarkerPopups.forEach((popup) => popup.remove());
      activeMarkerPopups.push(popup);
      CloseALL();
      closeDrawAnchor();
      closePressAnchor(); // a marker popup replaces the 🗺/📡 pin too
      popup.setLngLat(current.geometry.coordinates).addTo(map).setDOMContent(node);
      animateMapTo(map, current.geometry.coordinates, null);
      applyAllStyles();
      changePopupState(true);
      if (currentUfoModelInGLTF) {
        scene.remove(currentUfoModelInGLTF);
        crosshair.style.display = 'none';
      }
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
  applyMarkerBox(entry.el, entry.kind === 'cluster');
  entry.marker.setLngLat(cluster.geometry.coordinates);
  placeKeptMarker(entry);
  if (entry.kind === 'cluster') {
    entry.cluster = cluster;
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
    const clusters = index.getClusters(currentBounds, Math.floor(zoom)).filter(
      (c) => isOnVisibleHemisphere(c.geometry.coordinates)
    );
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
      forgetMarkerTilt(gone.face);
      gone.marker.remove();
      keptMarkers.delete(key);
    }

    unclusteredTopicPoints.clear();
    for (const [key, cluster] of wanted) {
      const entry = keptMarkers.get(key);
      if (entry) refreshKeptMarker(entry, cluster);
      else keptMarkers.set(key, createKeptMarker(cluster, key));
      if (!cluster.properties.cluster) {
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