import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { toast } from './toast.js';
import { initialTopicId } from './extracttopic.js';
import { holdJustHappened, closePressAnchor } from './poiinfo.js';
import { closeTransientMapUI } from './cssLogic.js';

// Plain tap/click on the map (PC left-click, phone tap) → a pin with the
// two actions split around it: 📍 Marker on the left, 🔷 Polygon on the
// right. Picking polygon keeps the pin as TOP LEFT and the next tap places
// the BOTTOM RIGHT corner, then the Draw column opens prefilled.
// Long-press (phone) / right-click (PC) → Google Maps question (poiinfo.js).

const MOVE_TOLERANCE = 12; // px — finger moving more than this is a pan, not a tap

let suppressClickUntil = 0;

let anchorOpen = false;          // buttons around the pin are visible
let awaitingSecondCorner = false; // pin is TOP LEFT, waiting for BOTTOM RIGHT
let corner1 = null;
let pressLoc = null;             // geographic point under the pin
let pinEl = null;                // fixed-position anchor (buttons + pin, or pin only)

function currentTopic() {
  return document.getElementById('input-field').value || initialTopicId;
}

function clearDrawPreview() {
  if (pinEl) {
    pinEl.remove();
    pinEl = null;
  }
}

function cleanup() {
  const wasOpen = pinEl !== null;
  clearDrawPreview();
  anchorOpen = false;
  awaitingSecondCorner = false;
  corner1 = null;
  pressLoc = null;
  // Back/Forward: pin tap, outside tap, Escape and closeTransientMapUI
  // all end here.
  if (wasOpen) layerClosedByUI('drawpin');
}

// Top-bar buttons (OPTIONS / TOPIC CHAT / E2EE CHAT / 🔍) call this:
// they stopPropagation, so the document tap-outside close never sees them
export function closeDrawAnchor() {
  cleanup();
}

// Back/Forward: Forward re-drops the pin at its saved point.
if (window.defineLayer) {
  window.defineLayer('drawpin', {
    open: (state) => {
      if (state && Array.isArray(state.at) && state.at.length >= 2) {
        showAnchor({ lng: state.at[0], lat: state.at[1] });
      }
    },
    close: () => closeDrawAnchor(),
  });
}

// Keeps the pin anchored to its map point while the camera moves
function onMapMove() {
  if (!pinEl || !pressLoc) return;
  const p = map.project(pressLoc);
  pinEl.style.left = p.x + 'px';
  pinEl.style.top = p.y + 'px';
}
map.on('move', onMapMove);

function makePinEl() {
  if (pinEl) pinEl.remove();
  const el = document.createElement('div');
  el.className = 'draw-here-anchor';
  const pin = document.createElement('div');
  pin.className = 'draw-here-pin';
  pin.onclick = () => {
    const wasAwaiting = awaitingSecondCorner;
    cleanup();
    if (wasAwaiting) toast.info('Polygon draw cancelled');
  };
  el.appendChild(pin);
  document.body.appendChild(el);
  pinEl = el;
}

function showAnchor(loc) {
  // A tap pin replaces open popups and the long-press 🗺/📡 pin
  closeTransientMapUI();
  clearDrawPreview();
  makePinEl();
  pressLoc = loc;

  const markerBtn = document.createElement('button');
  markerBtn.className = 'draw-here-btn';
  markerBtn.textContent = '📍 Marker';
  markerBtn.onclick = (e) => {
    e.stopPropagation();
    startMarkerHere(loc);
  };

  const polygonBtn = document.createElement('button');
  polygonBtn.className = 'draw-here-btn';
  polygonBtn.textContent = '🔷 Polygon';
  polygonBtn.onclick = (e) => {
    e.stopPropagation();
    startPolygonHere(loc);
  };

  pinEl.insertBefore(markerBtn, pinEl.firstChild);
  pinEl.appendChild(polygonBtn);
  anchorOpen = true;
  onMapMove();
  // Back/Forward: the pin is a layer; a re-tap replaces it in place.
  layerOpened('drawpin', { at: [loc.lng, loc.lat] });
}

function startMarkerHere(loc) {
  const wasAwaiting = awaitingSecondCorner;
  cleanup();
  if (wasAwaiting) toast.info('Polygon draw cancelled');
  openDrawColumn();
  showMarkerForm();
  const markerTopic = document.getElementById('input-field-2-0');
  markerTopic.value = currentTopic();
  markerTopic.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('input-field-2-3').value = `${loc.lng.toFixed(5)},${loc.lat.toFixed(5)}`;
  toast.info('Marker opened');
}

function startPolygonHere(loc) {
  awaitingSecondCorner = true;
  corner1 = loc;
  // Drop the buttons, keep the pin (it is the TOP LEFT corner)
  makePinEl();
  pressLoc = loc;
  anchorOpen = false;
  onMapMove();
  toast.info('Add bottom right 🔷');
}

function setSecondCorner(loc) {
  const topLeft = corner1;
  if (!topLeft) return;
  // Clear instantly — no pins/box linger on the map while the form is open
  cleanup();
  openDrawColumn();
  showPolygonForm();
  const polygonTopic = document.getElementById('input-field-3-0');
  polygonTopic.value = currentTopic();
  polygonTopic.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('input-field-3-3').value = `${topLeft.lng.toFixed(5)},${topLeft.lat.toFixed(5)}`;
  document.getElementById('input-field-3-5').value = `${loc.lng.toFixed(5)},${loc.lat.toFixed(5)}`;
  toast.info('Polygon opened');
}

// Search results: the same pin, but without the action buttons
export function showSearchPin(loc) {
  cleanup();
  makePinEl();
  pressLoc = loc;
  anchorOpen = false;
  onMapMove();
}

function handlePress(loc) {
  closePressAnchor(); // a plain tap replaces the open long-press 🗺/📡 anchor
  if (awaitingSecondCorner) {
    setSecondCorner(loc);
    return;
  }
  if (anchorOpen) {
    // Press again while the buttons are open: move them to the new spot
    pressLoc = loc;
    onMapMove();
    return;
  }
  showAnchor(loc);
}

// The same Draw control the toolbar row uses. fromMap is the pin path:
// that tap already chose Marker or Polygon. The feed + passes false.
export function openDrawColumn(fromMap = true) {
  const drawBtn = document.getElementById('Draw_Marker_Polygon');
  if (!drawBtn) return false;
  if (fromMap) {
    drawBtn.dataset.fromMap = '1';
    drawBtn.dataset.drawSource = 'map';
  } else {
    delete drawBtn.dataset.fromMap;
    drawBtn.dataset.drawSource = 'feed';
  }
  drawBtn.click();
  const chat = document.getElementById('feed-chat');
  return !!(chat && !chat.hidden && chat.classList.contains('is-draw'));
}

function showMarkerForm() {
  const showBtn = document.getElementById('show-draw-marker');
  if (showBtn.style.display !== 'none') showBtn.click();
}

function showPolygonForm() {
  const showBtn = document.getElementById('show-draw-polygon');
  if (showBtn.style.display !== 'none') showBtn.click();
}

function locFromClient(clientX, clientY) {
  const rect = map.getContainer().getBoundingClientRect();
  return map.unproject([clientX - rect.left, clientY - rect.top]);
}

const canvas = map.getCanvas();

// Where the pointer went down — a pan/drag must NOT place anything, so the
// down spot is compared against the click/tap spot.
let downPoint = null;
canvas.addEventListener('mousedown', (e) => {
  downPoint = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  downPoint = { x: t.clientX, y: t.clientY };
}, { passive: true });

// Plain tap/click (PC left-click, phone tap) → the 📍/🔷 pin.
canvas.addEventListener('click', (e) => {
  if (holdJustHappened()) return; // long-press → Google Maps question (poiinfo)
  if (Date.now() < suppressClickUntil) return;
  if (downPoint && Math.hypot(e.clientX - downPoint.x, e.clientY - downPoint.y) > MOVE_TOLERANCE) {
    downPoint = null; // it was a pan, not a tap
    return;
  }
  downPoint = null;
  // Globe mode: a tap in empty space (outside the globe) must not trigger —
  // isPointOnMapSurface does a ray/sphere intersection test (true in 2D mode).
  const rect = map.getContainer().getBoundingClientRect();
  const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  // Picking for the Draw form: every map tap stops here, so it opens
  // nothing else and the document's CloseALL never closes the form. Any
  // spot on the map counts, a polygon too; a tap past the globe does nothing.
  if (pick) {
    e.stopPropagation();
    suppressClickUntil = Date.now() + 500;
    if (map.transform.isPointOnMapSurface(p)) handlePickTap(locFromClient(e.clientX, e.clientY));
    return;
  }
  if (!map.transform.isPointOnMapSurface(p)) return;
  // Polygon taps open their own popup — don't add the pin on top of it
  const hits = map.queryRenderedFeatures([p.x, p.y]);
  if (hits.some((f) => f.layer && f.layer.id.includes('-mask-layer'))) return;
  if (awaitingSecondCorner) e.stopPropagation();
  suppressClickUntil = Date.now() + 500; // swallow the document close on this same tap
  handlePress(locFromClient(e.clientX, e.clientY));
});

// Tap anywhere outside the pin/buttons closes it
document.addEventListener('click', (e) => {
  if (Date.now() < suppressClickUntil) return;
  if (pinEl && !pinEl.contains(e.target)) cleanup();
});

// Esc closes / cancels / clears the placed rectangle
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && pick && pick.phase === 'adjust') {
    e.preventDefault();
    confirmPolygonPick();
    return;
  }
  if (e.key !== 'Escape') return;
  if (pick) {
    endPick(false);
    return;
  }
  if (pinEl || anchorOpen || awaitingSecondCorner) {
    const wasAwaiting = awaitingSecondCorner;
    cleanup();
    if (wasAwaiting) toast.info('Polygon draw cancelled');
  }
});

// Pick on the map, from the Draw form. Each coordinate field has a pin
// button. It steps the Draw page aside (html.is-draw-picking, style.css),
// shows a bar with what to tap, and fills the field from the tap:
//   Marker: one tap.
//   Polygon: the corner whose button was pressed, then the other corner
//   too while that one is still empty. Each corner stays on the map as a
//   draggable handle with its coordinates in a small bubble, the box is
//   drawn between them, and the bar's ✓ (or Enter) fills both fields,
//   in order: TOP LEFT is the north west corner, BOTTOM RIGHT the south east.
// The bar's ×, Escape and Back go back to the form with nothing changed.
// Pan and zoom still work while picking; markers let taps through.
// The map starts clean: markers, clusters and polygons step out of the way
// (setPostsShown), and the bar's eye button brings them back on demand.
// The 3D models stay away for the whole pick (loadP2PModels.js).
const PICK_FIELDS = {
  marker: ['input-field-2-3'],
  polygon: ['input-field-3-3', 'input-field-3-5'],
};
const PICK_LABEL = {
  'input-field-2-3': 'Pick the spot on the map',
  'input-field-3-3': 'Pick the top left corner on the map',
  'input-field-3-5': 'Pick the bottom right corner on the map',
};
const PICK_PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>'
  + '<circle cx="12" cy="10" r="3"/></svg>';
let pick = null; // { kind, steps: [field id], index, phase: 'tap'|'adjust', corners, handles }
let pickBar = null;
// Polygon picture layers hidden for the pick, with the visibility each had
// (the Visibility panel can already have polygons off; that is kept).
const POST_LAYER = /-image-layer$/;
let hiddenPostLayers = null;
const EYE_ICON = '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF_ICON = '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>';

// A polygon that loads during the pick stays out of the way too.
function onPickStyle() {
  if (pick && !postsShown()) hidePostLayers();
}

function postsShown() {
  return document.documentElement.classList.contains('is-pick-posts');
}

function hidePostLayers() {
  if (!hiddenPostLayers) hiddenPostLayers = new Map();
  const style = map.getStyle && map.getStyle();
  for (const layer of (style && style.layers) || []) {
    if (!POST_LAYER.test(layer.id) || hiddenPostLayers.has(layer.id)) continue;
    const before = map.getLayoutProperty(layer.id, 'visibility') || 'visible';
    hiddenPostLayers.set(layer.id, before);
    if (before !== 'none') map.setLayoutProperty(layer.id, 'visibility', 'none');
  }
}

function restorePostLayers() {
  if (!hiddenPostLayers) return;
  for (const [id, before] of hiddenPostLayers) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', before);
  }
  hiddenPostLayers = null;
}

// Markers, clusters and the polygon play buttons hide by CSS
// (html.is-draw-picking without .is-pick-posts); polygon pictures are map
// layers, so they are switched here.
function setPostsShown(show) {
  document.documentElement.classList.toggle('is-pick-posts', show);
  if (show) restorePostLayers();
  else hidePostLayers();
  const btn = pickBar && pickBar.querySelector('.draw-pick-posts');
  if (!btn) return;
  const label = show ? 'Hide markers and polygons' : 'Show markers and polygons';
  btn.setAttribute('aria-pressed', show ? 'true' : 'false');
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (show ? EYE_ICON : EYE_OFF_ICON) + '</svg>';
}

function lngLatText(loc) {
  return `${loc.lng.toFixed(5)},${loc.lat.toFixed(5)}`;
}

function readLngLat(text) {
  const m = String(text || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

function pickPrompt() {
  if (!pick) return '';
  if (pick.kind === 'marker') return 'Tap to place the marker';
  if (pick.phase === 'adjust') return 'Drag a corner to adjust';
  const id = pick.steps[pick.index];
  const second = pick.index > 0;
  if (id === 'input-field-3-3') return second ? 'Now tap the top left corner' : 'Tap the top left corner';
  return second ? 'Now tap the bottom right corner' : 'Tap the bottom right corner';
}

const CHECK_ICON = '<path d="M20 6 9 17l-5-5"/>';

function paintPickBar() {
  if (!pickBar) {
    pickBar = document.createElement('div');
    pickBar.id = 'draw-pick-bar';
    pickBar.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'draw-pick-icon';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'draw-pick-text';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'draw-pick-cancel';
    cancel.setAttribute('aria-label', 'Cancel');
    cancel.title = 'Cancel';
    cancel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      endPick(false);
    });
    const posts = document.createElement('button');
    posts.type = 'button';
    posts.className = 'draw-pick-posts';
    posts.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPostsShown(!postsShown());
    });
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'draw-pick-confirm';
    confirm.setAttribute('aria-label', 'Use these corners');
    confirm.title = 'Use these corners';
    confirm.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + CHECK_ICON + '</svg>';
    confirm.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      confirmPolygonPick();
    });
    pickBar.append(icon, text, posts, confirm, cancel);
    pickBar.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(pickBar);
  }
  pickBar.querySelector('.draw-pick-text').textContent = pickPrompt();
  pickBar.querySelector('.draw-pick-confirm').hidden = !(pick && pick.phase === 'adjust');
  pickBar.hidden = false;
  // Replay the drop-in for each new step.
  pickBar.classList.remove('is-step');
  void pickBar.offsetWidth;
  pickBar.classList.add('is-step');
}

// Show what is already in the fields, so a small fix starts close by.
function framePickFields(kind) {
  if (kind === 'marker') {
    const at = readLngLat(document.getElementById('input-field-2-3').value);
    if (at) map.easeTo({ center: [at.lng, at.lat], duration: 600, essential: true });
    return;
  }
  const a = readLngLat(document.getElementById('input-field-3-3').value);
  const b = readLngLat(document.getElementById('input-field-3-5').value);
  if (a && b) {
    map.fitBounds([
      [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat)],
      [Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)],
    ], { padding: 80, duration: 600, maxZoom: 16, essential: true });
  } else if (a || b) {
    const at = a || b;
    map.easeTo({ center: [at.lng, at.lat], duration: 600, essential: true });
  }
}

// The two corners as TOP LEFT (north west) and BOTTOM RIGHT (south east).
// West is the corner the shorter way round is east of, so two corners
// either side of the 180° line keep the small box, not the long way round
// the globe. Values are only swapped, never shifted.
function orderCorners(a, b) {
  const eastward = ((((b.lng - a.lng) % 360) + 540) % 360) - 180 >= 0;
  return {
    tl: { lng: eastward ? a.lng : b.lng, lat: Math.max(a.lat, b.lat) },
    br: { lng: eastward ? b.lng : a.lng, lat: Math.min(a.lat, b.lat) },
    aIsWest: eastward,
  };
}

// ── Polygon pick: corners on the map ────────────────────────────────────
// Each placed corner is a draggable handle with a small bubble holding its
// coordinates; the box between them is drawn on the map. Both stay put on
// the map while it pans and zooms. Once both corners are down the bar
// says to drag a corner to adjust it and shows a ✓ (Enter works too).
const RECT_SOURCE = 'draw-pick-rect';
const RECT_FILL = 'draw-pick-rect-fill';
const RECT_LINE = 'draw-pick-rect-line';
let rectHover = null;
let rectHoverQueued = false;

function rectData(a, b) {
  if (!a || !b) return { type: 'FeatureCollection', features: [] };
  const { tl, br } = orderCorners(a, b);
  const west = tl.lng;
  let east = br.lng;
  if (east < west) east += 360; // across the 180° line: draw it the short way
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[west, tl.lat], [east, tl.lat], [east, br.lat], [west, br.lat], [west, tl.lat]]],
      },
    }],
  };
}

function addPickRect() {
  if (map.getSource(RECT_SOURCE)) return;
  map.addSource(RECT_SOURCE, { type: 'geojson', data: rectData(null, null) });
  map.addLayer({
    id: RECT_FILL,
    type: 'fill',
    source: RECT_SOURCE,
    paint: { 'fill-color': '#22D3EE', 'fill-opacity': 0.14 },
  });
  map.addLayer({
    id: RECT_LINE,
    type: 'line',
    source: RECT_SOURCE,
    paint: { 'line-color': '#22D3EE', 'line-width': 2, 'line-dasharray': [2, 1.5] },
  });
}

function removePickRect() {
  if (map.getLayer(RECT_LINE)) map.removeLayer(RECT_LINE);
  if (map.getLayer(RECT_FILL)) map.removeLayer(RECT_FILL);
  if (map.getSource(RECT_SOURCE)) map.removeSource(RECT_SOURCE);
}

function cornerText(loc) {
  return `${loc.lng.toFixed(5)}, ${loc.lat.toFixed(5)}`;
}

// Box and bubbles follow the corners (and, before the second tap, the mouse).
function paintPolygonPick() {
  if (!pick || pick.kind !== 'polygon') return;
  const [a, b] = pick.corners;
  const other = b || (pick.phase === 'tap' ? rectHover : null);
  const src = map.getSource(RECT_SOURCE);
  if (src) src.setData(rectData(a, other));
  const order = a && b ? orderCorners(a, b) : null;
  pick.handles.forEach((handle, i) => {
    const loc = pick.corners[i];
    if (!loc) return;
    let name = 'Corner';
    if (order) name = (i === 0) === order.aIsWest ? 'Top left' : 'Bottom right';
    const el = handle.getElement();
    // Bottom right's bubble hangs below its corner, out of the box's way.
    el.classList.toggle('is-below', name === 'Bottom right');
    el.querySelector('.draw-pick-tip-name').textContent = name;
    el.querySelector('.draw-pick-tip-coords').textContent = cornerText(loc);
  });
}

function makeCornerHandle(index, loc) {
  const el = document.createElement('div');
  el.className = 'draw-pick-handle';
  el.innerHTML = '<span class="draw-pick-dot" aria-hidden="true"></span>'
    + '<span class="draw-pick-tip"><span class="draw-pick-tip-name"></span>'
    + '<span class="draw-pick-tip-coords"></span></span>';
  el.setAttribute('aria-label', 'Corner, drag to move');
  const handle = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
    .setLngLat([loc.lng, loc.lat])
    .addTo(map);
  const follow = () => {
    if (!pick) return;
    const at = handle.getLngLat().wrap();
    pick.corners[index] = { lng: at.lng, lat: at.lat };
    paintPolygonPick();
  };
  handle.on('dragstart', () => el.classList.add('is-dragging'));
  handle.on('drag', follow);
  handle.on('dragend', () => {
    el.classList.remove('is-dragging');
    follow();
  });
  pick.handles[index] = handle;
  return handle;
}

function placeCorner(loc) {
  const index = pick.corners.length;
  pick.corners.push(loc);
  makeCornerHandle(index, loc);
  if (pick.corners.length === 2) {
    pick.phase = 'adjust';
    rectHover = null;
  }
  paintPolygonPick();
  paintPickBar();
}

// Mouse only: the box follows the pointer between the first and second tap.
function onPickHover(event) {
  if (!pick || pick.kind !== 'polygon' || pick.phase !== 'tap' || pick.corners.length !== 1) return;
  const native = event.originalEvent;
  if (native && native.pointerType && native.pointerType !== 'mouse') return;
  rectHover = { lng: event.lngLat.wrap().lng, lat: event.lngLat.lat };
  if (rectHoverQueued) return;
  rectHoverQueued = true;
  requestAnimationFrame(() => {
    rectHoverQueued = false;
    paintPolygonPick();
  });
}

function confirmPolygonPick() {
  if (!pick || pick.kind !== 'polygon' || pick.phase !== 'adjust') return;
  const [a, b] = pick.corners;
  const { tl, br } = orderCorners(a, b);
  const fieldTL = document.getElementById('input-field-3-3');
  const fieldBR = document.getElementById('input-field-3-5');
  fieldTL.value = lngLatText(tl);
  fieldBR.value = lngLatText(br);
  // The form's own listeners (preview, field height) follow the input event.
  for (const field of [fieldTL, fieldBR]) field.dispatchEvent(new Event('input', { bubbles: true }));
  endPick(true);
}

function startPick(kind, fieldId) {
  if (pick) endPick(false);
  cleanup();
  const steps = [fieldId];
  let kept = null;
  if (kind === 'polygon') {
    const other = fieldId === 'input-field-3-3' ? 'input-field-3-5' : 'input-field-3-3';
    kept = readLngLat(document.getElementById(other).value);
    if (!kept) steps.push(other);
  }
  pick = { kind, steps, index: 0, phase: 'tap', corners: [], handles: [] };
  if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
  document.documentElement.classList.add('is-draw-picking');
  if (kind === 'polygon') {
    addPickRect();
    map.on('mousemove', onPickHover);
    // The corner that is not being picked stays where it is, as a handle.
    if (kept) placeCorner(kept);
  }
  paintPickBar();
  setPostsShown(false);
  map.on('styledata', onPickStyle);
  framePickFields(kind);
  if (window.layerOpened) window.layerOpened('drawpick');
}

function handlePickTap(loc) {
  if (!pick) return;
  if (pick.kind === 'marker') {
    const field = document.getElementById('input-field-2-3');
    field.value = lngLatText(loc);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    endPick(true);
    return;
  }
  // Polygon: taps place corners; with both down, taps only pan, and the
  // corners move by dragging their handles.
  if (pick.phase !== 'tap') return;
  pick.index += 1;
  placeCorner(loc);
}

function endPick(done, { fromHistory = false } = {}) {
  if (!pick) return;
  const kind = pick.kind;
  for (const handle of pick.handles) if (handle) handle.remove();
  pick = null;
  rectHover = null;
  map.off('mousemove', onPickHover);
  removePickRect();
  clearDrawPreview();
  pressLoc = null;
  map.off('styledata', onPickStyle);
  restorePostLayers();
  document.documentElement.classList.remove('is-draw-picking', 'is-pick-posts');
  // The 3D models skip their draw while picking (loadP2PModels.js) and
  // their loop waits for a frame: kick one so they come straight back.
  map.triggerRepaint();
  if (pickBar) pickBar.hidden = true;
  if (!fromHistory && window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('drawpick')) {
    window.layerClosedByUI('drawpick');
  }
  if (done) toast.info(kind === 'marker' ? 'Marker spot set' : 'Polygon corners set');
}

if (window.defineLayer) {
  window.defineLayer('drawpick', {
    open() {},
    close: () => endPick(false, { fromHistory: true }),
  });
}

// One pin button inside each coordinate field. The field moves into a
// wrapper (.draw-coord-wrap) so the button can sit at its right end.
function mountPickButtons() {
  for (const [kind, ids] of Object.entries(PICK_FIELDS)) {
    for (const id of ids) {
      const field = document.getElementById(id);
      if (!field || (field.parentElement && field.parentElement.classList.contains('draw-coord-wrap'))) continue;
      const wrap = document.createElement('span');
      wrap.className = 'draw-coord-wrap';
      field.before(wrap);
      wrap.appendChild(field);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'draw-coord-pick';
      btn.setAttribute('aria-label', PICK_LABEL[id]);
      btn.title = PICK_LABEL[id];
      btn.innerHTML = PICK_PIN_SVG;
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startPick(kind, id);
      });
      wrap.appendChild(btn);
    }
  }
}
mountPickButtons();
