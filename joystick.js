import { 
  everythinginsideoptionsbuttons, 
  firstlayercolumns,
  everythinginsideyourfov,
  everythinginsidetoolbar} from "./ui.js";
  
import { map } from './map.js';


const leftUpButton = document.getElementById("left-up");
const leftLeftButton = document.getElementById("left-left");
const leftRightButton = document.getElementById("left-right");
const leftDownButton = document.getElementById("left-down");

const rightUpButton = document.getElementById("right-up");
const rightLeftButton = document.getElementById("right-left");
const rightRightButton = document.getElementById("right-right");
const rightDownButton = document.getElementById("right-down");

const activeIntervals = new Set();
const buttonStops = new Set();

function setupButton(buttonElement, action) {
  let intervalId;

  const startAction = (event) => {
    event.preventDefault();
    if (!intervalId) {
      intervalId = setInterval(action, 16); // 60fps timing
      activeIntervals.add(intervalId);
    }
  };

  const stopAction = () => {
    if (intervalId) {
      clearInterval(intervalId);
      activeIntervals.delete(intervalId);
      intervalId = null;
    }
  };

  buttonStops.add(stopAction);

  buttonElement.addEventListener("mousedown", startAction);
  buttonElement.addEventListener("mouseup", stopAction);
  buttonElement.addEventListener("mouseleave", stopAction);
  buttonElement.addEventListener("pointerup", stopAction);
  buttonElement.addEventListener("pointercancel", stopAction);
  buttonElement.addEventListener("lostpointercapture", stopAction);

  buttonElement.addEventListener("touchstart", startAction);
  buttonElement.addEventListener("touchend", stopAction);
  buttonElement.addEventListener("touchcancel", stopAction);
}

function stopAllButtons() {
  for (const stop of buttonStops) stop();
}

function clearButtonIntervals() {
  stopAllButtons();
  activeIntervals.forEach(interval => clearInterval(interval));
  activeIntervals.clear();
}

document.addEventListener("pointerup", stopAllButtons, true);
document.addEventListener("touchend", stopAllButtons, true);

setupButton(leftUpButton, () => map.panBy([0, -BUTTON_PAN_SPEED * getSpeedMultiplier()], { animate: false }));
setupButton(leftDownButton, () => map.panBy([0, BUTTON_PAN_SPEED * getSpeedMultiplier()], { animate: false }));
setupButton(leftLeftButton, () => map.panBy([-BUTTON_PAN_SPEED * getSpeedMultiplier(), 0], { animate: false }));
setupButton(leftRightButton, () => map.panBy([BUTTON_PAN_SPEED * getSpeedMultiplier(), 0], { animate: false }));

setupButton(rightUpButton, () => map.setZoom(map.getZoom() + BUTTON_ZOOM_SPEED * getSpeedMultiplier()));
setupButton(rightDownButton, () => map.setZoom(map.getZoom() - BUTTON_ZOOM_SPEED * getSpeedMultiplier()));

setupButton(rightLeftButton, () => map.setBearing(map.getBearing() - MOVE_SPEED * getSpeedMultiplier()));
setupButton(rightRightButton, () => map.setBearing(map.getBearing() + MOVE_SPEED * getSpeedMultiplier()));

setupButton(document.getElementById("zoom-in"), () => map.setPitch(map.getPitch() + 1 * getSpeedMultiplier()));
setupButton(document.getElementById("zoom-out"), () => map.setPitch(map.getPitch() - 1 * getSpeedMultiplier()));

window.addEventListener("beforeunload", clearButtonIntervals);



const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  q: false,
  e: false,
  // Shift zooms in. Space zooms out. The old names had those two swapped.
  shiftZoomIn: false,
  spaceZoomOut: false,
  r: false,
  f: false,
};

const MOVE_SPEED = 0.5;
const BUTTON_PAN_SPEED = 6;
const BUTTON_ZOOM_SPEED = 0.05;

const speedSlider = document.getElementById("speed-slider");

function getSpeedMultiplier() {
  return parseFloat(speedSlider.value);
}

export function handleMovement() {

  const isBlocked = [
    ...everythinginsideyourfov,
    ...everythinginsidetoolbar,
    ...firstlayercolumns,
    ...everythinginsideoptionsbuttons,
  ].some(id => {
    const element = document.getElementById(id);
    return element && window.getComputedStyle(element).display === "block";
  });

  // Also block while typing (search, comments, draw editors, chat) so
  // WASD/QE don't pan the map mid-keystroke. The speed slider stays live.
  const typing = isTyping(document.activeElement);

  const panSpeed = 10 * getSpeedMultiplier();
  const zoomSpeed = 0.05 * getSpeedMultiplier();

  if (!isBlocked && !typing) {
    if (keys.w) {
      map.panBy([0, -panSpeed], { animate: false });
    }
    if (keys.s) {
      map.panBy([0, panSpeed], { animate: false });
    }

    if (keys.a) {
      map.panBy([-panSpeed, 0], { animate: false });
    }
    if (keys.d) {
      map.panBy([panSpeed, 0], { animate: false });
    }

    if (keys.e) {
      map.setBearing(map.getBearing() + MOVE_SPEED * getSpeedMultiplier());
    }
    if (keys.q) {
      map.setBearing(map.getBearing() - MOVE_SPEED * getSpeedMultiplier());
    }

    if (keys.shiftZoomIn) {
      map.setZoom(map.getZoom() + zoomSpeed);
    }
    if (keys.spaceZoomOut) {
      map.setZoom(map.getZoom() - zoomSpeed);
    }

    if (keys.r) {
      map.setPitch(map.getPitch() + 1 * getSpeedMultiplier());
    }
    if (keys.f) {
      map.setPitch(map.getPitch() - 1 * getSpeedMultiplier());
    }
  }
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

// True while the key should go to a text control. The speed slider is
// the exception: it stays a movement control.
export function isTyping(target) {
  const el = target && target.nodeType === 1 ? target : target && target.parentElement;
  if (!el || el.id === "speed-slider") return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has(String(el.type || "text").toLowerCase());
  if (el.isContentEditable) return true;
  return !!(el.closest && el.closest('[contenteditable="true"]'));
}

function clearMovementKeys() {
  keys.w = false;
  keys.a = false;
  keys.s = false;
  keys.d = false;
  keys.q = false;
  keys.e = false;
  keys.shiftZoomIn = false;
  keys.spaceZoomOut = false;
  keys.r = false;
  keys.f = false;
}

function typingNow(event) {
  return isTyping(event && event.target) || isTyping(document.activeElement);
}

document.addEventListener("keydown", (event) => {
  if (typingNow(event)) return;
  // Win/Ctrl/Alt shortcuts (Win+Shift+S, Ctrl+Shift) must not latch zoom.
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (event.repeat) {
    if (key === " ") event.preventDefault();
    return;
  }

  switch (key) {
    case "w":
      keys.w = true;
      break;
    case "a":
      keys.a = true;
      break;
    case "s":
      keys.s = true;
      break;
    case "d":
      keys.d = true;
      break;
    case "q":
      keys.q = true;
      break;
    case "e":
      keys.e = true;
      break;
    case " ":
      keys.spaceZoomOut = true;
      event.preventDefault();
      break;
    case "shift":
      keys.shiftZoomIn = true;
      break;
    case "r":
      keys.r = true;
      break;
    case "f":
      keys.f = true;
      break;
  }
});

document.addEventListener("keyup", (event) => {
  switch (event.key.toLowerCase()) {
    case "w":
      keys.w = false;
      break;
    case "a":
      keys.a = false;
      break;
    case "s":
      keys.s = false;
      break;
    case "d":
      keys.d = false;
      break;
    case "q":
      keys.q = false;
      break;
    case "e":
      keys.e = false;
      break;
    case " ":
      keys.spaceZoomOut = false;
      break;
    case "shift":
      keys.shiftZoomIn = false;
      break;
    case "r":
      keys.r = false;
      break;
    case "f":
      keys.f = false;
      break;
  }
});

document.addEventListener("focusin", (event) => {
  if (isTyping(event.target)) clearMovementKeys();
});

window.addEventListener("blur", () => {
  clearMovementKeys();
  clearButtonIntervals();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearMovementKeys();
    clearButtonIntervals();
  }
});
window.addEventListener("pagehide", clearMovementKeys);
document.addEventListener("contextmenu", clearMovementKeys);