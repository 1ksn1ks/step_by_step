import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { liveRadius } from './livegroups.js';
import { formatKm } from './arrowfilters.js';
import { hitsMoon, onMoonScreen } from './moon.js';

// Look for Live's reach, drawn on the map: a circle of the chosen radius
// around the spot, in the polygon picker's cyan fill and dashed line
// (drawhere.js addPickRect), with a bubble on its top edge saying how far.
//   preview — while the held-spot pin is up (poiinfo.js). It follows the
//             Distance setting (livegroups.js 'live-radius-changed').
//   area    — the place that was searched (localnews.js), while its live
//             posts are on the map; with none found it shows for a moment.
// The preview wins while both exist; closing the pin brings the area back.
//
// The bubble rides the circle's top edge, so zoomed in its arrow touches
// the line. Zoomed out that edge falls on the held dot and the bubble used
// to jump clear of the whole button row. It now stops just above the dot,
// with a gap, and comes back to the line once the circle grows past it.

const SOURCE = 'live-radius';
const FILL = 'live-radius-fill';
const LINE = 'live-radius-line';
const STEPS = 96;
const EARTH_KM = 6371.0088;
const FLASH_MS = 2600;
const TAG_LIFT = 7; // px: the arrow's height, so its tip sits on the line
const DOT_GAP = 10; // px of space between the dot's edge and the arrow
const FAR_ZOOM = 6; // below this the circle is small, so the bubble stays by the dot

let preview = null; // { at: { lng, lat }, km }
let area = null;
let tag = null; // maplibregl.Marker on the circle's top edge
let tagKm = null;
let tagAt = null; // [lng, lat] of that edge
let tagOffsetX = 0;
let tagOffset = -TAG_LIFT;
let pinRow = null; // the held-spot pin (poiinfo.js), while its circle is up
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

// Half the held dot, in px. The bubble clears this, not the buttons beside it.
// offsetHeight, not the border box: the dot scales in from twice its size
// (pressDotIn), and that animated box parked the bubble high until the
// next zoom remeasured the settled dot.
function dotHalf() {
  const dot = pinRow && pinRow.querySelector('.draw-here-pin');
  if (!dot || !dot.isConnected) return 11;
  const h = dot.offsetHeight;
  return (h > 0 ? h : 22) / 2;
}

// Zoomed in: the arrow stays on the radius line. Zoomed out, or whenever
// that line would cover the dot, the arrow stops DOT_GAP past the dot.
function liftTag() {
  if (!tag || !tagAt) return;
  let offsetX = 0;
  let offsetY = -TAG_LIFT;
  if (preview && shape() === preview) {
    const edge = map.project(tagAt);
    const point = map.project([preview.at.lng, preview.at.lat]);
    const dx = edge.x - point.x;
    const dy = edge.y - point.y;
    const dist = Math.hypot(dx, dy);
    const near = dotHalf() + DOT_GAP;
    if (map.getZoom() < FAR_ZOOM && dist > near) {
      const tipX = point.x + (dx / dist) * near;
      const tipY = point.y + (dy / dist) * near;
      offsetX = Math.round(tipX - edge.x);
      offsetY = Math.round(tipY - edge.y);
    } else if (dist > 0) {
      const borderTip = edge.y - TAG_LIFT;
      const nearTip = point.y - near;
      if (borderTip > nearTip) offsetY = -(TAG_LIFT + Math.round(borderTip - nearTip));
    }
  }
  if (offsetX === tagOffsetX && offsetY === tagOffset) return;
  tagOffsetX = offsetX;
  tagOffset = offsetY;
  tag.setOffset([offsetX, offsetY]);
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
  keepTagOffMoon();
}

// The bubble is a map marker. Hide it while it meets the moon; the circle
// itself is on the map canvas, already under the moon.
function keepTagOffMoon() {
  const el = tag && tag.getElement();
  if (!el) return;
  el.style.visibility = hitsMoon(el.getBoundingClientRect()) ? 'hidden' : 'visible';
}

// A style switch (globe on/off, theme) drops added layers.
map.on('style.load', () => {
  if (shape()) paint();
});
// Zoom changes how far the edge sits from the pin on screen.
map.on('move', () => {
  liftTag();
  keepTagOffMoon();
});
onMoonScreen(keepTagOffMoon);
window.addEventListener('resize', liftTag);

// pin: the held-spot pin. Zoomed out, the bubble stops just above its dot.
export function showRadiusPreview(at, pin = null) {
  if (!at) return;
  preview = { at: { lng: Number(at.lng), lat: Number(at.lat) }, km: liveRadius() };
  pinRow = pin;
  paint();
}

export function hideRadiusPreview() {
  if (!preview) return;
  preview = null;
  pinRow = null;
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
