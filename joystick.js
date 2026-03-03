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

  buttonElement.addEventListener("mousedown", startAction);
  buttonElement.addEventListener("mouseup", stopAction);
  buttonElement.addEventListener("mouseleave", stopAction);

  buttonElement.addEventListener("touchstart", startAction);
  buttonElement.addEventListener("touchend", stopAction);
  buttonElement.addEventListener("touchcancel", stopAction);
}

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

window.addEventListener("beforeunload", () => {
  activeIntervals.forEach(interval => clearInterval(interval));
  activeIntervals.clear();
});



const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  q: false,
  e: false,
  space: false,
  shift: false,
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

  const panSpeed = 10 * getSpeedMultiplier();
  const zoomSpeed = 0.05 * getSpeedMultiplier();

  if (!isBlocked) {
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

    if (keys.space) {
      map.setZoom(map.getZoom() + zoomSpeed);
    }
    if (keys.shift) {
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

document.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement; // Get the currently focused element
  const isInputField = activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA";
  const isSpeedSlider = activeElement.id === "speed-slider"; // Check if the active element is the speed slider

  switch (event.key.toLowerCase()) {
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
      if (!isInputField || isSpeedSlider) { // Allow spacebar if the active element is the speed slider
        keys.shift = true;
        event.preventDefault();
      }
      break;
    case "shift":
      keys.space = true;
      break;
    case "r":
      keys.r = true;
      break;
    case "f":
      keys.f = true;
      case " ":
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
      keys.shift = false;
      break;
    case "shift":
      keys.space = false;
      break;
    case "r":
      keys.r = false;
      break;
    case "f":
      keys.f = false;
      break;
  }
});