import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { toast } from './toast.js';
import { initialTopicId } from './extracttopic.js';
import { holdJustHappened } from './poiinfo.js';

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
  clearDrawPreview();
  anchorOpen = false;
  awaitingSecondCorner = false;
  corner1 = null;
  pressLoc = null;
}

// Top-bar buttons (OPTIONS / TOPIC CHAT / E2EE CHAT / 🔍) call this:
// they stopPropagation, so the document tap-outside close never sees them
export function closeDrawAnchor() {
  cleanup();
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
}

function startMarkerHere(loc) {
  const wasAwaiting = awaitingSecondCorner;
  cleanup();
  if (wasAwaiting) toast.info('Polygon draw cancelled');
  openDrawColumn();
  showMarkerForm();
  document.getElementById('input-field-2-0').value = currentTopic();
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
  document.getElementById('input-field-3-0').value = currentTopic();
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

// Reuses the toolbar button so CloseALL / toolbar / UFO handling stay identical
function openDrawColumn() {
  document.getElementById('Draw_Marker_Polygon').click();
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
  if (e.key !== 'Escape') return;
  if (pinEl || anchorOpen || awaitingSecondCorner) {
    const wasAwaiting = awaitingSecondCorner;
    cleanup();
    if (wasAwaiting) toast.info('Polygon draw cancelled');
  }
});
