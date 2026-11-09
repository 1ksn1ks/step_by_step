import { map } from './map.js';
import { closeTransientMapUI } from './cssLogic.js';
import {
  bindHoldMenu, openLiveGroupMenu, closeLiveGroupMenu, liveChoiceCaption,
  openLiveSettings, closeLiveSettings, LIVE_GEAR_ICON,
} from './livegroups.js';
import { showRadiusPreview, hideRadiusPreview } from './liveradius.js';

// Long-press (phone) / right-click (PC) on the map → the SAME pin as the
// plain tap (drawhere.js), with two actions split around it:
//   🗺 Open in Maps (left)  — that spot in the phone's default maps app
//                              (geo:), or Google Maps web on a PC
//   📡 Look for Live (right) — the 24h live markers within the chosen
//                              distance of that spot, in any country, from
//                              the chosen group (livegroups.js). Hold it
//                              (phone) or right-click it (PC) for the list of
//                              groups; a pick looks for live from that group.
//                              Its ⚙ opens the live settings: the groups,
//                              how far from the pin (km), and Look for Live.
//                              While the pin is up, that distance is a
//                              circle on the map (liveradius.js).
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
    holdOpenedPin = true;
    const rect = canvas.getBoundingClientRect();
    showPressAnchor(map.unproject([t.clientX - rect.left, t.clientY - rect.top]));
  }, HOLD_MS);
}, { passive: true });

// The pin's dot sits right under the finger that held, so lifting it taps
// the dot, which would close the pin it just made. However long the hold
// lasted, the tap that ends it is skipped.
let holdOpenedPin = false;
function endHoldTouch() {
  if (!holdOpenedPin) return;
  holdOpenedPin = false;
  suppressClickUntil = Math.max(suppressClickUntil, Date.now() + 450);
}

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
  endHoldTouch();
}, { passive: true });

canvas.addEventListener('touchcancel', () => {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  holdOpenedPin = false;
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
    closeLiveGroupMenu({ within: pressAnchor });
    closeLiveSettings({ within: pressAnchor });
    pressAnchor.remove();
    pressAnchor = null;
    hideRadiusPreview();
    // Back/Forward: pin tap, outside tap, Escape and closeTransientMapUI
    // all end here.
    layerClosedByUI('presspin');
  }
  pressLoc = null;
}

function showPressAnchor(lngLat) {
  // A long-press / right-click replaces open popups and the 📍/🔷 pin
  closeTransientMapUI();
  pressLoc = lngLat;

  // is-press (style.css): the pin is a dot at the held point itself, the
  // centre of Look for Live's circle, not a teardrop whose tip marks it.
  const anchor = document.createElement('div');
  anchor.className = 'draw-here-anchor is-press';

  const pin = document.createElement('div');
  pin.className = 'draw-here-pin';
  // Like the draw-here pin, a tap closes it; not the tap of the finger
  // that held, which lifts right over the dot.
  pin.onclick = () => {
    if (holdJustHappened()) return;
    closePressAnchor();
  };
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
  liveBtn.className = 'draw-here-btn draw-here-live';
  liveBtn.textContent = '📡 Look for Live';
  // The group (when it is not Everyone) and the distance are a caption
  // under the button (style.css): out of the row, so both buttons keep
  // their width and the pin stays centred on the held point.
  const paintCaption = () => {
    const caption = liveChoiceCaption();
    if (caption) liveBtn.dataset.group = caption;
    else delete liveBtn.dataset.group;
  };
  paintCaption();
  liveBtn.title = 'Hold or right-click to choose whose live posts';
  liveBtn.setAttribute('aria-haspopup', 'menu');
  // The live markers within the distance of the spot (localnews.js
  // showLocationMarkers), the same look a search pick runs. Dynamic: localnews pulls in
  // processallmessages → threejs, which use `map` at MODULE LEVEL. A group
  // from the list is set first (localnews says what a wallet-less pick
  // cannot show).
  const lookForLive = (pickedGroup) => {
    closePressAnchor();
    import('./localnews.js')
      .then(({ showLocationMarkers, pickLiveGroup }) => {
        if (pickedGroup) pickLiveGroup(pickedGroup);
        return showLocationMarkers(lngLat.lat, lngLat.lng);
      })
      .catch(() => {});
  };
  liveBtn.onclick = (e) => {
    e.stopPropagation();
    lookForLive(null);
  };
  bindHoldMenu(liveBtn, () => openLiveGroupMenu(liveBtn, (key) => lookForLive(key)));

  // ⚙ live settings, beside the button but out of the row (style.css), so
  // the pin stays centred on the held point.
  const liveWrap = document.createElement('span');
  liveWrap.className = 'draw-here-live-wrap';
  const gearBtn = document.createElement('button');
  gearBtn.type = 'button';
  gearBtn.className = 'draw-here-live-gear';
  gearBtn.setAttribute('aria-label', 'Live settings');
  gearBtn.setAttribute('aria-haspopup', 'dialog');
  gearBtn.setAttribute('aria-expanded', 'false');
  gearBtn.title = 'Live settings';
  gearBtn.innerHTML = LIVE_GEAR_ICON;
  gearBtn.onclick = (e) => {
    e.stopPropagation();
    openLiveSettings(gearBtn, { onLook: (key) => lookForLive(key), onChange: paintCaption });
  };
  liveWrap.append(liveBtn, gearBtn);

  // Same layout as the draw pin: left button, pin, right button
  anchor.insertBefore(mapsBtn, anchor.firstChild);
  anchor.appendChild(liveWrap);
  const p = map.project([lngLat.lng, lngLat.lat]);
  anchor.style.left = p.x + 'px';
  anchor.style.top = p.y + 'px';
  document.body.appendChild(anchor);
  pressAnchor = anchor;
  // How far Look for Live reaches from here; follows the Distance setting.
  showRadiusPreview(lngLat);
  // Back/Forward: the pin is a layer at its saved point.
  layerOpened('presspin', { at: [lngLat.lng, lngLat.lat] });
}

// Back/Forward: Forward re-drops the pin at its saved point.
if (window.defineLayer) {
  window.defineLayer('presspin', {
    open: (state) => {
      if (state && Array.isArray(state.at) && state.at.length >= 2) {
        showPressAnchor({ lng: state.at[0], lat: state.at[1] });
      }
    },
    close: () => closePressAnchor(),
  });
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
