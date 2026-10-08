import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import { map } from './map';
import { createMarkerPopupHTML } from './processallmessages.js';
import { fetchLocalMarkers } from './msgbackend.js';
import { profilePictures, usernames, click2url } from './loadalladata.js';
import { CloseALL, changePopupState } from './cssLogic.js';
import { closeDrawAnchor } from './drawhere.js';
import { makeScrollable } from './makescrollable.js';
import { animateMapTo, cancelAnimateMapTo } from './animatemapto.js';
import { applyAllStyles } from './loadprofilepopup.js';
import { isTopicLayerActive } from './marker.js';
import { geojson } from './letall.js';

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
let localList = []; // the live markers (newest first)
let localIndex = -1; // which one has its popup open
let layerActive = false; // moveend listener attached

// EXACTLY the expression the regular marker popups use (processallmessages):
// the popup's timestamp string doubles as the marker's like-key, so it must
// be byte-identical or likes wouldn't line up. Falls back to the upload time
// while the original message is still backfilling.
function formatTimestamp(created, lastSeenMs) {
  const d = created ? new Date(created) : new Date(lastSeenMs);
  return d.toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
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
  for (const m of localNodes) m.remove();
  localNodes = [];
  if (localPopup) {
    localPopup.remove();
    localPopup = null;
  }
  localList = [];
  localIndex = -1;
  index.load([]);
  indexFilterKey = null;
  lastLocalSig = null;
  livePointCoords.clear();
  livePointTitles.clear();
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

  for (const m of localNodes) m.remove();
  localNodes = [];

  for (const cluster of clusters) {
    const el = document.createElement('div');
    if (cluster.properties.cluster) {
      // Count bubble — tap zooms into the cluster (same as topic clusters)
      el.className = 'cluster-bubble';
      el.textContent = cluster.properties.point_count_abbreviated;
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
    likeCountMarker: m.likeCount || 0,
    dislikeCountMarker: m.dislikeCount || 0,
    comments: m.comments || [],
    coords: `${m.lng},${m.lat}`,
    onPrev: () => { if (localIndex > 0) navigateLocal(localIndex - 1); },
    onNext: () => { if (localIndex < localList.length - 1) navigateLocal(localIndex + 1); },
  });

  // Match the regular marker popup behaviour: close other panels, make the
  // body scrollable, and apply the active theme.
  CloseALL();
  closeDrawAnchor();
  localPopup.setLngLat([m.lng, m.lat]).addTo(map).setDOMContent(content);
  const popupContent = localPopup.getElement()?.querySelector('.maplibregl-popup-content');
  if (popupContent && !popupContent._scrollable) {
    makeScrollable(popupContent);
    popupContent._scrollable = true;
  }
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

  localList = markers;
  localPopup = new maplibregl.Popup({ closeButton: true, offset: 18 });
  livePointCoords.clear();
  livePointTitles.clear();
  for (const m of markers) {
    const k = livePointKey([m.lng, m.lat]);
    livePointCoords.add(k);
    if (m.title) livePointTitles.set(k, m.title);
  }
  indexFilterKey = null; // rebuild the index against the current topic state

  updateLocalClusters(); // first paint now, not on the next moveend
  map.on('move', viewportLocalUpdate);
  map.on('moveend', viewportLocalUpdate);
  layerActive = true;
  document.dispatchEvent(new Event('live-dataset-changed')); // topic dots pick up the border
}

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
