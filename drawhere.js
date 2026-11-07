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
//   too while that one is still empty. The pair is then put in order:
//   TOP LEFT is the north west corner, BOTTOM RIGHT the south east.
// The bar's ×, Escape and Back go back to the form with nothing changed.
// Pan and zoom still work while picking; markers let taps through.
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
let pick = null; // { kind, steps: [field id], index, values: { id: loc } }
let pickBar = null;

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
  if (pick.kind === 'marker') return 'Tap the map to place the marker';
  const id = pick.steps[pick.index];
  const second = pick.index > 0;
  if (id === 'input-field-3-3') return second ? 'Now tap the top left corner' : 'Tap the top left corner';
  return second ? 'Now tap the bottom right corner' : 'Tap the bottom right corner';
}

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
    pickBar.append(icon, text, cancel);
    pickBar.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(pickBar);
  }
  pickBar.querySelector('.draw-pick-text').textContent = pickPrompt();
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

function startPick(kind, fieldId) {
  if (pick) endPick(false);
  cleanup();
  const steps = [fieldId];
  if (kind === 'polygon') {
    const other = fieldId === 'input-field-3-3' ? 'input-field-3-5' : 'input-field-3-3';
    if (!readLngLat(document.getElementById(other).value)) steps.push(other);
  }
  pick = { kind, steps, index: 0, values: {} };
  if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
  document.documentElement.classList.add('is-draw-picking');
  paintPickBar();
  framePickFields(kind);
  if (window.layerOpened) window.layerOpened('drawpick');
}

function handlePickTap(loc) {
  if (!pick) return;
  pick.values[pick.steps[pick.index]] = loc;
  pick.index += 1;
  if (pick.index < pick.steps.length) {
    // Keep a pin on the corner just placed while the next one is picked.
    makePinEl();
    pinEl.classList.add('is-pick-corner');
    pressLoc = loc;
    anchorOpen = false;
    onMapMove();
    paintPickBar();
    return;
  }
  fillPickedFields();
  endPick(true);
}

function fillPickedFields() {
  const ids = new Set(Object.keys(pick.values));
  for (const [id, loc] of Object.entries(pick.values)) {
    document.getElementById(id).value = lngLatText(loc);
  }
  if (pick.kind === 'polygon') {
    const tl = document.getElementById('input-field-3-3');
    const br = document.getElementById('input-field-3-5');
    const a = readLngLat(tl.value);
    const b = readLngLat(br.value);
    if (a && b) {
      // West is the corner the shorter way round is east of, so two taps
      // either side of the 180° line keep the small box, not the long way
      // round the globe. Values are only swapped, never shifted.
      const eastward = ((((b.lng - a.lng) % 360) + 540) % 360) - 180 >= 0;
      const west = eastward ? a.lng : b.lng;
      const east = eastward ? b.lng : a.lng;
      tl.value = lngLatText({ lng: west, lat: Math.max(a.lat, b.lat) });
      br.value = lngLatText({ lng: east, lat: Math.min(a.lat, b.lat) });
      ids.add('input-field-3-3');
      ids.add('input-field-3-5');
    }
  }
  // The form's own listeners (preview, field height) follow the input event.
  for (const id of ids) document.getElementById(id).dispatchEvent(new Event('input', { bubbles: true }));
}

function endPick(done, { fromHistory = false } = {}) {
  if (!pick) return;
  const kind = pick.kind;
  pick = null;
  clearDrawPreview();
  pressLoc = null;
  document.documentElement.classList.remove('is-draw-picking');
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
