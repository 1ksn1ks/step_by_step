import { map } from './map.js';
import { setShadeMode } from './letall.js';

let mode = 'daynight';

function fullWorldFeature() {
  // A single full-world rectangle is degenerate on the 3D sphere (its ±180°
  // edges are the same meridian, its ±90° edges are pole points), so the
  // full-globe view only shades part of it. A grid of small cells is
  // unambiguous in both the flat and the sphere render path.
  // Geometry stays in the canonical world (-180..180): duplicating it into
  // extra world copies makes the globe fold copies over each other and
  // double-shade part of the sphere.
  const step = 10;
  const polygons = [];
  for (let lon = -180; lon < 180; lon += step) {
    for (let lat = -90; lat < 90; lat += step) {
      polygons.push([[
        [lon, lat],
        [lon + step, lat],
        [lon + step, lat + step],
        [lon, lat + step],
        [lon, lat]
      ]]);
    }
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: polygons }
  };
}

function clearShade() {
  if (map.getLayer('globe-shade')) map.removeLayer('globe-shade');
  if (map.getSource('globe-shade')) map.removeSource('globe-shade');
}

// Day-Night is drawn by the 3D day/night shade sphere in loadP2PModels.js — a
// per-pixel fragment shader that tracks the globe exactly (no image tile for
// the globe to double-composite into two terminator lines). No map layer is
// created here; setMode() calls setShadeMode() to turn the sphere on/off, and
// the sphere re-aims at the sun every frame on its own.
function addDayNightShade() {
  // no-op: the 3D layer renders the day/night when shadeMode === 'daynight'
}

// Dark: the 10° grid over the whole globe (original, unchanged)
function addDarkShade() {
  if (map.getLayer('globe-shade')) return;
  map.addSource('globe-shade', {
    type: 'geojson',
    data: fullWorldFeature(),
    buffer: 0
  });
  map.addLayer({
    id: 'globe-shade',
    type: 'fill',
    source: 'globe-shade',
    paint: {
      'fill-color': '#00001a',
      'fill-opacity': 0.5,
      'fill-antialias': false
    }
  });
}

function addShadeLayer() {
  if (mode === 'daynight') addDayNightShade();
  else addDarkShade();
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
