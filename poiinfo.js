import { map } from './map.js';
import { closeTransientMapUI } from './cssLogic.js';

// Long-press (phone) / right-click (PC) on the map → the SAME pin as the
// plain tap (drawhere.js), with two actions split around it:
//   🗺 Open in Maps (left)  — that spot in the phone's default maps app
//                              (geo:), or Google Maps web on a PC
//   📡 Look for Live (right) — the 24h live markers of the country at that
//                              spot (the exact view a country search shows)
// The plain tap/click (the 📍/🔷 pin in drawhere.js) must keep working,
// so the tap a hold generates is swallowed via holdJustHappened().

const HOLD_MS = 500;
const MOVE_TOLERANCE = 12; // px — same as drawhere.js

const canvas = map.getCanvas();

let suppressClickUntil = 0;
let holdTimer = null;
let holdStart = null;
let lastTouchTime = 0;

// drawhere.js checks this to skip the tap that a long-press generates
export function holdJustHappened() {
  return Date.now() < suppressClickUntil;
}

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  lastTouchTime = Date.now();
  const t = e.touches[0];
  holdStart = { x: t.clientX, y: t.clientY };
  holdTimer = setTimeout(() => {
    holdTimer = null;
    suppressClickUntil = Date.now() + 600; // the hold became the pin, not a tap
    const rect = canvas.getBoundingClientRect();
    showPressAnchor(map.unproject([t.clientX - rect.left, t.clientY - rect.top]));
  }, HOLD_MS);
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (!holdTimer || !holdStart) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - holdStart.x, t.clientY - holdStart.y) > MOVE_TOLERANCE) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}, { passive: true });

canvas.addEventListener('touchend', () => {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}, { passive: true });

canvas.addEventListener('touchcancel', () => {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}, { passive: true });

let pressAnchor = null; // the anchor element (left button, pin, right button)
let pressLoc = null;    // the geographic point under the pin

// Keeps the pin anchored to its map point while the camera moves
// (same as the draw pin in drawhere.js)
function onMapMove() {
  if (!pressAnchor || !pressLoc) return;
  const p = map.project(pressLoc);
  pressAnchor.style.left = p.x + 'px';
  pressAnchor.style.top = p.y + 'px';
}
map.on('move', onMapMove);

export function closePressAnchor() {
  if (pressAnchor) {
    pressAnchor.remove();
    pressAnchor = null;
  }
  pressLoc = null;
}

function showPressAnchor(lngLat) {
  // A long-press / right-click replaces open popups and the 📍/🔷 pin
  closeTransientMapUI();
  pressLoc = lngLat;

  const anchor = document.createElement('div');
  anchor.className = 'draw-here-anchor';

  const pin = document.createElement('div');
  pin.className = 'draw-here-pin';
  pin.onclick = closePressAnchor; // like the draw-here pin: tap closes
  anchor.appendChild(pin);

  const mapsBtn = document.createElement('button');
  mapsBtn.className = 'draw-here-btn';
  mapsBtn.textContent = '🗺 Open in Maps';
  mapsBtn.onclick = (e) => {
    e.stopPropagation();
    closePressAnchor();
    // Mobile: geo: opens the phone's DEFAULT maps app (Apple Maps on iOS,
    // whatever the user set on Android). PC: geo: has no reliable handler
    // (Linux: none at all), so desktop keeps Google Maps web.
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const url = isMobile
      ? `geo:${lngLat.lat},${lngLat.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${lngLat.lat},${lngLat.lng}`;
    window.open(url, '_blank', 'noopener');
  };

  const liveBtn = document.createElement('button');
  liveBtn.className = 'draw-here-btn';
  liveBtn.textContent = '📡 Look for Live';
  liveBtn.onclick = (e) => {
    e.stopPropagation();
    closePressAnchor();
    // The exact pipeline a country search uses: reverse-geocode the spot in
    // ENGLISH (so the country string matches what /api/local stored), then
    // show that country's 24h live markers. Dynamic: localnews pulls in
    // processallmessages → threejs, which use `map` at MODULE LEVEL.
    import('./localnews.js')
      .then(({ showLocationMarkers }) =>
        showLocationMarkers(lngLat.lat, lngLat.lng)
      )
      .catch(() => {});
  };

  // Same layout as the draw pin: left button, pin, right button
  anchor.insertBefore(mapsBtn, anchor.firstChild);
  anchor.appendChild(liveBtn);
  const p = map.project([lngLat.lng, lngLat.lat]);
  anchor.style.left = p.x + 'px';
  anchor.style.top = p.y + 'px';
  document.body.appendChild(anchor);
  pressAnchor = anchor;
}

// Tap anywhere outside the pin/buttons closes it — same as the draw pin.
// The click of the tap that OPENED the anchor is still inside
// suppressClickUntil, so it is ignored here.
document.addEventListener('click', (e) => {
  if (Date.now() < suppressClickUntil) return;
  if (pressAnchor && !pressAnchor.contains(e.target)) closePressAnchor();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePressAnchor();
});

// PC: right-click (the PC twin of the phone long-press). A right-click-DRAG is
// the pitch/rotate gesture, so only a stationary right-click opens the anchor.
let rightDownPos = null;
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2) rightDownPos = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('contextmenu', (e) => {
  if (Date.now() - lastTouchTime < 1000) return; // touch-origin (iOS long-press ghost)
  e.preventDefault();
  // Release point vs press point: past the tolerance it was a pitch change, not a right-click
  const wasDrag = rightDownPos && Math.hypot(e.clientX - rightDownPos.x, e.clientY - rightDownPos.y) > MOVE_TOLERANCE;
  rightDownPos = null;
  if (wasDrag) return;
  const rect = canvas.getBoundingClientRect();
  showPressAnchor(map.unproject([e.clientX - rect.left, e.clientY - rect.top]));
});
