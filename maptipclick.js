// A right-click on a marker or a polygon shows its title bubble (maptip.js
// fillMapTip in .marker-title-tip / .polygon-title-tip), at the pointer,
// where a mouse hover used to show it. A touch on one is claimed the same
// way, so a hold shows only its bubble, not the map's long-press pin.
//
// One contextmenu handler for the whole map, in the capture phase of the
// canvas container, so a right-click opens at most one bubble: that of the
// topmost thing under the pointer. Sources register here in order of
// precedence: a marker (an element over the canvas, marker.js) before a
// polygon (a layer drawn on the canvas, polygons.js). A right-click that
// opens a bubble is claimed (mapTipClaimed): the browser's menu and the
// press anchor (poiinfo.js) leave it alone. Any other right-click closes
// the bubble and goes on as before: a cluster lists its posts, the map
// opens the press anchor.
//
// The bubble closes on a left-click anywhere, Escape, another right-click,
// or the map moving (marker.js and polygons.js hide their bubble on
// movestart). Touch keeps its own tap and hold: the contextmenu a touch or
// pen long-press sends is ignored here.

import { map } from './map';
import { holdMoveLimit } from './markerhold.js';

// { rank, hit(event) -> show() or null, hide() }
const sources = [];
const claimed = new WeakSet();
let openSource = null;
let rightDown = null;
let touchAt = -Infinity;
let armed = false;

const TOUCH_GHOST_MS = 1000;

export function addMapTipSource(source) {
  sources.push(source);
  sources.sort((a, b) => a.rank - b.rank);
  arm();
}

export function mapTipClaimed(event) {
  return !!event && claimed.has(event);
}

export function closeMapTip() {
  if (!openSource) return;
  const source = openSource;
  openSource = null;
  source.hide();
}

// Past this the right button dragged: MapLibre pitched or turned the map.
function moveLimit() {
  return holdMoveLimit(parseFloat(getComputedStyle(document.documentElement).fontSize));
}

function fromTouch(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return true;
  return performance.now() - touchAt < TOUCH_GHOST_MS;
}

// The topmost source under the press, with its show(), or null.
function hitAt(target, clientX, clientY) {
  const press = { target, clientX, clientY };
  for (const source of sources) {
    const show = source.hit(press);
    if (show) return { source, show };
  }
  return null;
}

function onContextMenu(event) {
  const down = rightDown;
  rightDown = null;
  if (fromTouch(event)) return;
  if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > moveLimit()) return;
  const hit = hitAt(event.target, event.clientX, event.clientY);
  if (!hit) {
    closeMapTip();
    return;
  }
  event.preventDefault();
  claimed.add(event);
  for (const other of sources) {
    if (other !== hit.source) other.hide();
  }
  openSource = hit.show() === false ? null : hit.source;
}

// A finger on a dot or a polygon is that thing's: its own tap and hold
// show its bubble (marker.js, polygons.js). The press is only claimed
// here, by the same rule as a right-click, so the map's long-press pin
// (poiinfo.js) does not also open under it. A dot never reaches the
// canvas, where the pin listens; a polygon is drawn on it.
function onTouchStart(event) {
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  if (hitAt(event.target, touch.clientX, touch.clientY)) claimed.add(event);
}

function arm() {
  if (armed) return;
  armed = true;
  const container = map.getCanvasContainer();
  container.addEventListener('mousedown', (event) => {
    if (event.button === 2) rightDown = { x: event.clientX, y: event.clientY };
  }, true);
  container.addEventListener('contextmenu', onContextMenu, true);
  container.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') {
      touchAt = performance.now();
      return;
    }
    if (event.button === 0) closeMapTip();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMapTip();
  });
}
