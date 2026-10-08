import { map } from './map.js';
import { setShadeMode } from './letall.js';

let mode = 'daynight';

function clearShade() {
  if (map.getLayer('globe-shade')) map.removeLayer('globe-shade');
  if (map.getSource('globe-shade')) map.removeSource('globe-shade');
}

// Both Day-Night and Dark are drawn by the 3D day/night shade sphere in
// loadP2PModels.js — a per-pixel fragment shader that tracks the globe
// exactly. Day-night tracks the real sun; dark is the same sphere in
// full-night mode (no sun, no terminator). No map layer is created here;
// setMode() calls setShadeMode() to drive the sphere, and in day-night the
// sphere re-aims at the sun every frame on its own.
function addShadeLayer() {
  // no-op: the 3D layer renders both modes when shadeMode is 'daynight'/'dark'
}

// isStyleLoaded() is only true after the initial 'load' event (style + all
// images), so if the style is not ready yet, wait for the next 'style.load'
// or 'load' and apply then (whichever fires first; addShadeLayer is a no-op
// once the layer exists).
function ensureShadeLayer() {
  if (mode === 'light' || map.getLayer('globe-shade')) return;
  if (map.isStyleLoaded()) {
    addShadeLayer();
    return;
  }
  const apply = () => addShadeLayer();
  map.once('style.load', apply);
  map.once('load', apply);
}

function setMode(next) {
  mode = next;
  setShadeMode(next); // drives the 3D day/night sphere's visibility + sun
  map.triggerRepaint(); // repaint so the day/night layer picks up the mode even when the bots are hidden
  const label = document.getElementById('globe-mode-value');
  const label2 = document.getElementById('globe-mode-value2');
  const text = next === 'light' ? 'Light' : next === 'dark' ? 'Dark' : 'Day-Night';
  if (label) label.textContent = text;
  if (label2) label2.textContent = text;

  clearShade();
  ensureShadeLayer();
}

// Re-create the shade layer whenever the style (re)loads
map.on('style.load', () => {
  if (mode === 'light') {
    clearShade();
    return;
  }
  clearShade();
  ensureShadeLayer();
});

document.getElementById('toggle-globe-mode').addEventListener('click', () => {
  const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'daynight' : 'light';
  setMode(next);
});

// Default to Day-Night when the page loads
setMode('daynight');
