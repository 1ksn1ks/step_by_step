// Globe hover gate. MapLibre's unproject snaps a pixel in the space around
// the globe onto the horizon, and queryRenderedFeatures then hits whatever
// polygon or marker sits on that edge. Hover uses this check first.
// Mercator, including the globe's own flat render path at high zoom, skips it.

import { map } from './map.js';

const DEG = Math.PI / 180;

// Unit steps around the pointer. Diagonals stay one inset long.
const INSET_STEPS = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
];

let insetEl = null;
let cached = null;

function insetPx() {
  if (!insetEl && document.body) {
    insetEl = document.createElement('div');
    insetEl.setAttribute('aria-hidden', 'true');
    insetEl.style.cssText = 'position:fixed;left:0;top:0;width:0.5dvmin;height:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(insetEl);
  }
  const width = insetEl ? insetEl.getBoundingClientRect().width : 0;
  if (width > 0) return width;
  return Math.min(window.innerWidth, window.innerHeight) * 0.005;
}

function renderingGlobe() {
  const tr = map.transform;
  if (!tr) return false;
  if (typeof tr.isGlobeRendering === 'boolean') return tr.isGlobeRendering;
  const spec = typeof map.getProjection === 'function' ? map.getProjection() : null;
  const type = spec && (spec.type || spec.name);
  return type === 'globe';
}

function onSurface(point) {
  const tr = map.transform;
  if (!tr) return true;
  const test = tr.isPointOnSurface || tr.isPointOnMapSurface;
  if (typeof test === 'function') return !!test.call(tr, point);
  try {
    const ll = map.unproject([point.x, point.y]);
    return ll != null;
  } catch {
    return false;
  }
}

function discCenter() {
  const tr = map.transform;
  const center = tr && tr.centerPoint;
  if (center && Number.isFinite(center.x) && Number.isFinite(center.y)) {
    return { x: center.x, y: center.y };
  }
  const projected = map.project(map.getCenter());
  return { x: projected.x, y: projected.y };
}

// Radius of the painted globe. The ray test is the limb; a projected
// near-horizon point is only the fallback when that test is missing.
function limbRadius(center) {
  const tr = map.transform;
  const hasSurface = tr && typeof (tr.isPointOnSurface || tr.isPointOnMapSurface) === 'function';
  if (!hasSurface) {
    const eye = map.getCenter();
    let lat = eye.lat + 89.9;
    let lng = eye.lng;
    if (lat > 90) { lat = 180 - lat; lng += 180; }
    if (lat < -90) { lat = -180 - lat; lng -= 180; }
    const horizon = map.project([lng, lat]);
    return Math.hypot(horizon.x - center.x, horizon.y - center.y);
  }
  if (!onSurface(center)) return 0;
  let lo = 0;
  let hi = 64;
  while (onSurface({ x: center.x + hi, y: center.y }) && hi < 1e7) hi *= 2;
  // Silhouette is far off screen. The limb inset does not apply.
  if (onSurface({ x: center.x + hi, y: center.y })) return Infinity;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (onSurface({ x: center.x + mid, y: center.y })) lo = mid;
    else hi = mid;
  }
  return lo;
}

function surfaceVector(lng, lat) {
  const phi = lat * DEG;
  const lambda = lng * DEG;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

// Camera position in Earth radii. Pitch 0 sits on the centre ray.
function cameraVector(distance) {
  const eye = map.getCenter();
  const lat = eye.lat * DEG;
  const lng = eye.lng * DEG;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const cosLng = Math.cos(lng);
  const sinLng = Math.sin(lng);
  const outward = [cosLat * cosLng, cosLat * sinLng, sinLat];
  const pitch = (map.getPitch() || 0) * DEG;
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  if (sinPitch < 1e-4) {
    return [outward[0] * distance, outward[1] * distance, outward[2] * distance];
  }
  const bearing = (map.getBearing() || 0) * DEG;
  const east = [-sinLng, cosLng, 0];
  const north = [-sinLat * cosLng, -sinLat * sinLng, cosLat];
  const cosBearing = Math.cos(bearing);
  const sinBearing = Math.sin(bearing);
  const up = [
    north[0] * cosBearing + east[0] * sinBearing,
    north[1] * cosBearing + east[1] * sinBearing,
    north[2] * cosBearing + east[2] * sinBearing,
  ];
  const along = -cosPitch + Math.sqrt(Math.max(0, distance * distance - sinPitch * sinPitch));
  return [
    outward[0] + along * (cosPitch * outward[0] - sinPitch * up[0]),
    outward[1] + along * (cosPitch * outward[1] - sinPitch * up[1]),
    outward[2] + along * (cosPitch * outward[2] - sinPitch * up[2]),
  ];
}

function viewState() {
  const tr = map.transform;
  const eye = map.getCenter();
  const key = [
    tr.zoom, tr.pitch, tr.bearing, tr.roll || 0, tr.width, tr.height,
    eye.lng.toFixed(4), eye.lat.toFixed(4),
  ].join('|');
  if (cached && cached.key === key) return cached;
  const center = discCenter();
  const radius = limbRadius(center);
  const height = tr.height || window.innerHeight;
  const fov = ((tr.fov || 45) * DEG) / 2;
  const focal = (height / 2) / Math.tan(fov);
  const distance = radius === Infinity
    ? 1e6
    : 1 / Math.sin(Math.atan((radius || 1) / focal));
  cached = {
    key,
    center,
    radius,
    distance,
    camera: cameraVector(distance),
  };
  return cached;
}

function readLngLat(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat };
  }
  const lng = Number(value.lng);
  const lat = Number(value.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

// A ring passes when any corner faces the camera. One point has to itself.
function facesCamera(lngLat, state) {
  const list = Array.isArray(lngLat) && lngLat.length && Array.isArray(lngLat[0])
    ? lngLat
    : [lngLat];
  let seen = false;
  const camera = state.camera;
  const reach = Math.hypot(camera[0], camera[1], camera[2]) || 1;
  const limit = 1 / state.distance - 1e-3;
  for (const item of list) {
    const ll = readLngLat(item);
    if (!ll) continue;
    seen = true;
    const place = surfaceVector(ll.lng, ll.lat);
    const dot = place[0] * camera[0] + place[1] * camera[1] + place[2] * camera[2];
    if (dot / reach >= limit) return true;
  }
  return !seen;
}

// point is a canvas pixel ({x, y}), the same space as a map event point.
// lngLat is optional: one {lng, lat} / [lng, lat], or a ring of those.
// Off the globe, inside the 0.5dvmin limb inset, or on the far side, this is
// false. Flat view is always true. The inset is eight ray tests, so it follows
// the silhouette at any pitch or bearing.
export function isPointerOnGlobe(point, lngLat) {
  if (!renderingGlobe()) return true;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return true;
  const state = viewState();
  if (!(state.radius > 0)) return false;
  if (!onSurface(point)) return false;
  if (state.radius === Infinity) return facesCamera(lngLat, state);
  const inset = insetPx();
  for (let i = 0; i < INSET_STEPS.length; i++) {
    const step = INSET_STEPS[i];
    if (!onSurface({ x: point.x + step[0] * inset, y: point.y + step[1] * inset })) return false;
  }
  return facesCamera(lngLat, state);
}
