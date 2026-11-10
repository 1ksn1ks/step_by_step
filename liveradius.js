import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { liveRadius } from './livegroups.js';
import { formatKm } from './arrowfilters.js';

// Look for Live's reach, drawn on the map: a circle of the chosen radius
// around the spot, in the polygon picker's cyan fill and dashed line
// (drawhere.js addPickRect), with a bubble on its top edge saying how far.
//   preview — while the held-spot pin is up (poiinfo.js). It follows the
//             Distance setting (livegroups.js 'live-radius-changed').
//   area    — the place that was searched (localnews.js), while its live
//             posts are on the map; with none found it shows for a moment.
// The preview wins while both exist; closing the pin brings the area back.
//
// The bubble rides the circle's top edge. The held-spot pin is drawn over
// the map, so when the circle is small (a short distance, or zoomed out)
// that edge falls under the pin: the bubble then lifts to just above the
// pin's row (its buttons and the gear badge too), its arrow on the pin.

const SOURCE = 'live-radius';
const FILL = 'live-radius-fill';
const LINE = 'live-radius-line';
const STEPS = 96;
const EARTH_KM = 6371.0088;
const FLASH_MS = 2600;
const TAG_LIFT = 7; // px: the arrow's height, so its tip sits on the line
const PIN_GAP = 4; // px between a lifted bubble's arrow and the pin's row

let preview = null; // { at: { lng, lat }, km }
let area = null;
let tag = null; // maplibregl.Marker on the circle's top edge
let tagKm = null;
let tagAt = null; // [lng, lat] of that edge
let tagOffset = -TAG_LIFT;
let pinRow = null; // the held-spot pin (poiinfo.js), kept clear of
let pinReach = 0; // px its row reaches above the held point
let flashTimer = 0;

// A geodesic circle. Longitudes stay continuous around the centre (no
// wrap to ±180), so a circle across the 180° line draws the short way.
function ring(at, km) {
  const rad = Math.PI / 180;
  const lat1 = at.lat * rad;
  const lng1 = at.lng * rad;
  const d = km / EARTH_KM;
  const points = [];
  for (let i = 0; i <= STEPS; i++) {
    const bearing = (i / STEPS) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
    points.push([lng2 / rad, lat2 / rad]);
  }
  return points;
}

function shape() {
  return preview || area;
}

// false while the style is still loading; style.load paints again.
function ensureLayers() {
  if (map.getSource(SOURCE)) return true;
  try {
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: FILL,
      type: 'fill',
      source: SOURCE,
      paint: { 'fill-color': '#22D3EE', 'fill-opacity': 0.12 },
    });
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SOURCE,
      paint: { 'line-color': '#22D3EE', 'line-width': 2, 'line-dasharray': [2, 1.5] },
    });
    return true;
  } catch {
    return false;
  }
}

function removeLayers() {
  try {
    if (map.getLayer(LINE)) map.removeLayer(LINE);
    if (map.getLayer(FILL)) map.removeLayer(FILL);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  } catch { /* style mid-reload: nothing left to remove */ }
}

function buildTag() {
  const el = document.createElement('div');
  el.className = 'live-radius-tag';
  el.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'live-radius-tag-name';
  name.textContent = 'Radius';
  const km = document.createElement('span');
  km.className = 'live-radius-tag-km';
  el.append(name, km);
  // Lifted by the arrow's height, so its tip sits on the line.
  tag = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -TAG_LIFT] });
  tagOffset = -TAG_LIFT;
  tagKm = km;
}

// How far the pin's row reaches above its middle (the held point), from
// layout offsets: its drop-in scale animation does not change them.
function measurePin() {
  pinReach = 0;
  if (!pinRow || !pinRow.isConnected) return;
  let top = 0;
  for (const el of pinRow.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement) || !el.offsetParent) continue;
    let y = 0;
    let node = el;
    while (node && node !== pinRow) {
      y += node.offsetTop;
      node = node.offsetParent;
    }
    if (node === pinRow && y < top) top = y;
  }
  pinReach = pinRow.offsetHeight / 2 - top;
}

// The bubble's arrow stays at least PIN_GAP above the pin's row.
function liftTag() {
  if (!tag || !tagAt) return;
  let lift = 0;
  if (preview && shape() === preview && pinRow && pinRow.isConnected && pinReach > 0) {
    const edgeY = map.project(tagAt).y;
    const pointY = map.project([preview.at.lng, preview.at.lat]).y;
    lift = Math.max(0, edgeY - (pointY - pinReach - PIN_GAP));
  }
  const next = -(TAG_LIFT + Math.round(lift));
  if (next === tagOffset) return;
  tagOffset = next;
  tag.setOffset([0, next]);
}

function paint() {
  const now = shape();
  if (!now) {
    removeLayers();
    if (tag) tag.remove();
    return;
  }
  if (!ensureLayers()) return;
  const points = ring(now.at, now.km);
  map.getSource(SOURCE).setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [points] } }],
  });
  if (!tag) buildTag();
  tagKm.textContent = formatKm(now.km);
  tagAt = points[0]; // bearing 0: the top edge
  tag.setLngLat(tagAt).addTo(map);
  liftTag();
}

// A style switch (globe on/off, theme) drops added layers.
map.on('style.load', () => {
  if (shape()) paint();
});
// Zoom changes how far the edge sits from the pin on screen.
map.on('move', liftTag);
window.addEventListener('resize', () => {
  if (!pinRow) return;
  measurePin();
  liftTag();
});

// pin: the held-spot pin's element, which the bubble keeps clear of.
export function showRadiusPreview(at, pin = null) {
  if (!at) return;
  preview = { at: { lng: Number(at.lng), lat: Number(at.lat) }, km: liveRadius() };
  pinRow = pin;
  measurePin();
  paint();
}

export function hideRadiusPreview() {
  if (!preview) return;
  preview = null;
  pinRow = null;
  pinReach = 0;
  paint();
}

// flash: nothing was found, so the area shows for a moment and goes.
export function showSearchArea(at, km, { flash = false } = {}) {
  clearTimeout(flashTimer);
  area = { at: { lng: Number(at.lng), lat: Number(at.lat) }, km };
  paint();
  if (flash) {
    flashTimer = setTimeout(() => {
      area = null;
      paint();
    }, FLASH_MS);
  }
}

export function hideSearchArea() {
  clearTimeout(flashTimer);
  if (!area) return;
  area = null;
  paint();
}

document.addEventListener('live-radius-changed', (event) => {
  if (!preview) return;
  preview.km = event.detail;
  paint();
});
