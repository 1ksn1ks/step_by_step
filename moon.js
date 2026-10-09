// The real moon in the sky.
//
// Its geocentric direction comes from the truncated Meeus/Astronomical
// Almanac series (no API, offline, ~0.2° accuracy), which yields the
// sub-lunar point — the spot on the globe directly under the moon. Screen
// position is the EXACT perspective projection of the point 3 Earth radii
// out along that direction through the map's live camera: the camera basis
// is rebuilt each frame from the map's real pitch/bearing and a distance
// derived from the measured globe disc radius, so it is correct at every
// zoom, pitch and bearing. Hidden when the camera→moon segment passes
// inside the Earth (exact line test — it pops back out over the limb).
// The 1M $HBAR wall snapshot (1mhbar.com/snapshot) is embedded on top of the
// moon picture; clicking the moon opens 1mhbar.com. The moon's on-screen size
// grows as you zoom out and shrinks as you zoom in.
import { map } from './map.js';

const MOON_RENDER_DIST = 3; // Earth radii (the real ~60 is a sub-pixel speck; 3 stays clearly in space)
const MAP_FOV = 45; // the map's fov option (map.js leaves it at the engine default)
// Base size in vh at zoom 3 — updateMoon scales it with the zoom: bigger as
// you zoom out (space view), smaller as you zoom in. Clamped to 1.5–48vh
// (really big at max zoom-out, below zoom 0).
const MOON_VH_BASE = 3.4;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm360 = (x) => ((x % 360) + 360) % 360;
const sinD = (x) => Math.sin(x * D2R);
const cosD = (x) => Math.cos(x * D2R);
const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

// Sub-lunar point + geocentric moon direction at time.
function computeSubLunar(nowMs) {
  const jd = nowMs / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  // Principal mean arguments (deg)
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T);
  const M = norm360(134.9634029 + 477198.86739801 * T + 0.0087414 * T * T);
  const Mpr = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const F = norm360(93.272095 + 483202.0175233 * T - 0.0036539 * T * T);
  const L = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T);
  // Largest periodic terms — tabular coefficients are 10⁻⁶ degrees
  const dLam = (6288774 * sinD(M) + 1274027 * sinD(2 * D - M) + 658314 * sinD(2 * D)
    + 213618 * sinD(2 * M) - 185116 * sinD(2 * F) - 114332 * sinD(2 * D - 2 * M)
    - 58793 * sinD(2 * D - 2 * F) - 57066 * sinD(2 * D + M)
    - 53322 * sinD(2 * D - 2 * Mpr) - 45721 * sinD(2 * D - M - Mpr)
    - 40923 * sinD(2 * D + M - Mpr) - 34721 * sinD(2 * Mpr)) / 1e6;
  const beta = (5128190 * sinD(F) + 280202 * sinD(D + F) + 277597 * sinD(D - F)
    + 173055 * sinD(2 * D - F) - 55138 * sinD(2 * D + M - F)
    - 46122 * sinD(2 * D - M - F)) / 1e6;
  const lambda = L + dLam;
  const eps = 23.4392911 - 0.0130042 * T; // mean obliquity of the ecliptic
  const ra = Math.atan2(sinD(lambda) * cosD(eps) - Math.tan(beta * D2R) * sinD(eps), cosD(lambda)) * R2D;
  const dec = Math.asin(Math.sin(beta * D2R) * cosD(eps) + Math.cos(beta * D2R) * sinD(eps) * sinD(lambda)) * R2D;
  const gmst = norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T);
  let lng = norm360(ra - gmst); // sub-lunar longitude, east-positive
  if (lng > 180) lng -= 360; // → (−180, 180]
  // The moon's geocentric direction is the sub-lunar point's ECEF unit vector
  return { lng, lat: dec, vec: [cosD(dec) * cosD(lng), cosD(dec) * sinD(lng), sinD(dec)] };
}

// The map's camera in the Earth-fixed frame at this instant — exact for any
// pitch/bearing. The view axis passes through the globe center; the camera
// sits on the line from the sub-camera point tilted back by the pitch.
function cameraBasis() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const subCam = map.unproject([w / 2, h / 2]);
  const lat = subCam.lat * D2R;
  const lng = subCam.lng * D2R;
  const a = [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
  const east = [-Math.sin(lng), Math.cos(lng), 0];
  const north = [-Math.sin(lat) * Math.cos(lng), -Math.sin(lat) * Math.sin(lng), Math.cos(lat)];
  const p = (map.getPitch() || 0) * D2R;
  const B = (map.getBearing() || 0) * D2R;
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  // Screen-up at zero pitch = compass direction B (bearing rotates the map)
  const up1 = [
    north[0] * Math.cos(B) + east[0] * Math.sin(B),
    north[1] * Math.cos(B) + east[1] * Math.sin(B),
    north[2] * Math.cos(B) + east[2] * Math.sin(B),
  ];
  // View direction (camera → globe center)
  const fwd = [-cp * a[0] + sp * up1[0], -cp * a[1] + sp * up1[1], -cp * a[2] + sp * up1[2]];
  // Screen up = up1 with its view-axis component removed
  const upRaw = [up1[0] - dot3(up1, fwd) * fwd[0], up1[1] - dot3(up1, fwd) * fwd[1], up1[2] - dot3(up1, fwd) * fwd[2]];
  const ul = Math.hypot(upRaw[0], upRaw[1], upRaw[2]);
  const up = [upRaw[0] / ul, upRaw[1] / ul, upRaw[2] / ul];
  const right = cross3(fwd, up);
  return { subCam, a, up1, fwd, up, right, cp, sp };
}

// True when the segment camera→point passes inside the unit Earth sphere —
// the only case where the Earth hides it (moon, polygon corners, ...).
export function earthOccludes(C, m) {
  const w = [m[0] - C[0], m[1] - C[1], m[2] - C[2]];
  const pw = dot3(C, w);
  const ww = dot3(w, w);
  if (ww <= 0) return false;
  const t = -pw / ww;
  if (t <= 0 || t >= 1) return false;
  return dot3(C, C) + 2 * t * pw + t * t * ww < 1;
}

// Camera position C in the Earth-fixed frame + focal length — shared by
// updateMoon and the polygon-cover visibility check (polygons.js).
export function cameraState() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cam = cameraBasis();
  // Camera-to-center distance from the measured disc radius — the disc edge
  // is the tangent cone: r = f·tan(asin(1/D)). The disc is a screen-centered
  // circle for any pitch/bearing, so this holds in every view.
  let lat = cam.subCam.lat + 89.9;
  let lng = cam.subCam.lng;
  if (lat > 90) { lat = 180 - lat; lng += 180; }
  if (lat < -90) { lat = -180 - lat; lng -= 180; }
  const horizon = map.project([lng, lat]);
  const rDisc = Math.hypot(horizon.x - w / 2, horizon.y - h / 2);
  if (rDisc <= 0) return null;
  const f = (h / 2) / Math.tan((MAP_FOV / 2) * D2R);
  const D = 1 / Math.sin(Math.atan(rDisc / f));
  // Distance from the sub-camera point to the camera (|C|² = d² + 2d·cos p + 1)
  const d = -cam.cp + Math.sqrt(D * D - cam.sp * cam.sp);
  const C = [
    cam.a[0] + d * (cam.cp * cam.a[0] - cam.sp * cam.up1[0]),
    cam.a[1] + d * (cam.cp * cam.a[1] - cam.sp * cam.up1[1]),
    cam.a[2] + d * (cam.cp * cam.a[2] - cam.sp * cam.up1[2]),
  ];
  return { cam, C, f, w, h };
}

let moonEl = null;
let subLunar = null;
let subLunarAt = 0;
let lastSizeVh = 0;
// {x, y, half} of the visible moon in window px — null when hidden.
// Exported (live binding): threejs.js culls the starfield stars that fall
// inside this circle, the same way the globe disc culls them.
export let moonScreen = null;

// The moon stays pointer-events:none so a mouse drag or the scroll wheel
// over it still reaches the map. Touches do not: any touch whose point lies
// inside the visible disc is stopped on the way down, before MapLibre's
// canvas listeners, at every zoom — including zoom < -1, where the moon is
// pinned to the center and would otherwise pan or open the Earth behind it.
// A tap (no drag, one finger) opens 1mhbar.com. Popups and page buttons that
// paint above the moon keep their own touches.
function bindMoonTouch() {
  if (window.__moonTapBound) return; // HMR re-import guard
  window.__moonTapBound = true;

  const claimed = new Map(); // touch id -> {x, y, moved}
  let openedAt = 0;

  const inMoon = (x, y) => {
    if (!moonEl || moonEl.style.display === 'none') return false;
    const r = moonEl.getBoundingClientRect();
    if (r.width < 1) return false;
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const half = r.width / 2;
    return dx * dx + dy * dy <= half * half;
  };

  // True when something painted above the moon is the real target
  // (a popup, the compass, a menu). Those keep the gesture.
  const aboveMoon = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return false;
    if (t.closest('.maplibregl-popup, .maplibregl-ctrl, button, a, input, textarea, select, label')) return true;
    return !map.getContainer().contains(t);
  };

  const openMoon = () => {
    openedAt = Date.now();
    window.open('https://1mhbar.com', '_blank', 'noopener');
  };

  const swallow = (e) => {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  };

  document.addEventListener('touchstart', (e) => {
    if (aboveMoon(e)) return;
    let hit = false;
    for (const t of e.changedTouches) {
      if (!inMoon(t.clientX, t.clientY)) continue;
      claimed.set(t.identifier, { x: t.clientX, y: t.clientY, moved: false });
      hit = true;
    }
    if (e.touches.length > 1) {
      for (const g of claimed.values()) g.moved = true;
    }
    if (hit) swallow(e);
  }, { capture: true, passive: false });

  document.addEventListener('touchmove', (e) => {
    let hit = false;
    for (const t of e.touches) {
      const g = claimed.get(t.identifier);
      if (!g) continue;
      hit = true;
      if (Math.hypot(t.clientX - g.x, t.clientY - g.y) > 12) g.moved = true;
    }
    if (hit) swallow(e);
  }, { capture: true, passive: false });

  const endTouch = (e) => {
    let hit = false;
    let tap = false;
    for (const t of e.changedTouches) {
      const g = claimed.get(t.identifier);
      if (!g) continue;
      claimed.delete(t.identifier);
      hit = true;
      if (!g.moved && inMoon(t.clientX, t.clientY)) tap = true;
    }
    if (hit) swallow(e);
    if (tap && claimed.size === 0 && e.touches.length === 0) openMoon();
  };
  document.addEventListener('touchend', endTouch, { capture: true, passive: false });
  document.addEventListener('touchcancel', (e) => {
    for (const t of e.changedTouches) claimed.delete(t.identifier);
  }, { capture: true });

  // Mouse click, and any click the browser still synthesizes after a touch.
  // Stopped in capture so the map never opens what is behind the moon.
  document.addEventListener('click', (e) => {
    if (aboveMoon(e) || !inMoon(e.clientX, e.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - openedAt > 700) openMoon();
  }, true);
}
bindMoonTouch();

// Called every frame from the animate() loop in threejs.js.
export function updateMoon() {
  const now = Date.now();
  if (!moonEl) {
    // HMR leaves the previous module instance's element behind — drop any
    // stale #moon so a hot reload never shows two moons
    const stale = document.getElementById('moon');
    if (stale) stale.remove();
    moonEl = document.createElement('div');
    moonEl.id = 'moon';
    // The 1M $HBAR wall snapshot on top of the moon picture — styled in
    // style.css as the circle's inscribed square so the whole thing fits
    // without being cropped
    const wall = document.createElement('iframe');
    wall.src = 'https://1mhbar.com/snapshot';
    wall.title = '1M $HBAR wall';
    moonEl.appendChild(wall);
    // Rendered INSIDE the map container (not #three-container) so it stacks
    // between the canvas and the popups: MapLibre appends popups to this same
    // container after the moon, so an open popup always paints over the moon.
    // (#three-container sits after #map in the DOM, which put the moon above
    // popups — the bug this fixes.) pointer-events:none stays so mouse-drag
    // and the wheel still reach the map; touches inside the disc are stopped
    // in bindMoonTouch before they get there.
    map.getContainer().appendChild(moonEl);
  }
  if (!subLunar || now - subLunarAt >= 1000) {
    // The moon moves ~0.1°/min — a 1s cache is invisible and skips the trig
    subLunar = computeSubLunar(now);
    subLunarAt = now;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Zoom-driven size: bigger as you zoom out, smaller as you zoom in. At
  // zoom ≥ 0 each level grows by 2^(1/5) (the approved curve). Below zoom 0
  // (the space view, down to the engine floor of −2) the moon grows ×3 per
  // level from EXACTLY the z0 size (5.15vh) up to ~46vh — one continuous
  // curve, no jump at 0 (the old ×2.25 branch jumped 5.15 → 11.6vh). Clamped.
  const zoom = map.getZoom();
  const rawVh = zoom >= 0
    ? MOON_VH_BASE * Math.pow(2, (3 - zoom) / 5)
    : MOON_VH_BASE * Math.pow(2, 0.6) * Math.pow(3, -zoom);
  const sizeVh = Math.min(48, Math.max(1.5, rawVh));
  if (Math.abs(sizeVh - lastSizeVh) > 0.05) {
    lastSizeVh = sizeVh;
    moonEl.style.width = `${sizeVh.toFixed(2)}vh`;
    moonEl.style.height = `${sizeVh.toFixed(2)}vh`;
  }
  const half = (sizeVh / 2) * (h / 100);
  // User rule (2026-10-06): past zoom −1 toward max zoom-out the moon is
  // pinned to the screen center and is NEVER hidden — even when it would
  // sit behind the Earth. Skips the camera trig entirely in that view.
  // Centering is done by CSS itself (50%/50% of the fixed full-viewport
  // container + translate(-50%,-50%) of the element's own size) rather than
  // window.innerWidth/innerHeight math — on phone browsers those values can
  // drift from the real layout box (dynamic URL bars & co), which is what
  // left the moon a few px right of center.
  if (zoom < -1.0) {
    moonScreen = { x: w / 2, y: h / 2, half };
    moonEl.style.display = 'block';
    moonEl.style.left = '50%';
    moonEl.style.top = '50%';
    moonEl.style.transform = 'translate(-50%, -50%)';
    return;
  }
  const st = cameraState();
  if (!st) return;
  const cam = st.cam;
  const C = st.C;
  const f = st.f;
  const m = [MOON_RENDER_DIST * subLunar.vec[0], MOON_RENDER_DIST * subLunar.vec[1], MOON_RENDER_DIST * subLunar.vec[2]];
  const wv = [m[0] - C[0], m[1] - C[1], m[2] - C[2]];
  const z = dot3(wv, cam.fwd); // depth in front of the camera
  if (z <= 0.01 || earthOccludes(C, m)) {
    moonScreen = null; // behind the Earth / out of view — no hit area
    moonEl.style.display = 'none';
    return;
  }
  const x = w / 2 + (f * dot3(wv, cam.right)) / z;
  const y = h / 2 - (f * dot3(wv, cam.up)) / z;
  moonScreen = { x, y, half };
  moonEl.style.display = 'block';
  // Reset the pin's 50%/50% anchors so the px translate is from (0,0)
  moonEl.style.left = '0';
  moonEl.style.top = '0';
  moonEl.style.transform = `translate(${(x - half).toFixed(1)}px, ${(y - half).toFixed(1)}px)`;
}
