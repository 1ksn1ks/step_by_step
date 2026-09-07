import { map } from './map.js';

const RAD = Math.PI / 180;

let mode = 'daynight';
let updateTimer = null;

function getMode() {
  return mode;
}

function normLon(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

// Where the sun is directly overhead right now (low-precision solar formula)
function subsolarPoint(date) {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const n = (date.getTime() - yearStart) / 86400000; // fractional day of year
  const decl = 23.44 * Math.sin(RAD * (360 / 365) * (284 + n));
  const b = RAD * (360 / 365) * (n - 81);
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lon = normLon((12 - utcH) * 15 + eot / 4);
  return { lat: decl, lon };
}

// The night side of the Earth as an unambiguous planar polygon:
// the terminator latitude for every longitude, closed down to the dark pole.
function nightFeature(date) {
  const sun = subsolarPoint(date);
  const sinD = Math.sin(sun.lat * RAD);
  const cosD = Math.cos(sun.lat * RAD);

  // Near the equinox the dark region is a full-latitude longitude band
  if (Math.abs(sun.lat) < 0.5) {
    const west = normLon(sun.lon - 90);
    const east = normLon(sun.lon + 90);
    if (east > west) {
      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[[west, 90], [west, -90], [east, -90], [east, 90]]]
        }
      };
    }
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[west, 90], [west, -90], [180, -90], [180, 90]]],
          [[[-180, 90], [-180, -90], [east, -90], [east, 90]]]
        ]
      }
    };
  }

  const darkPole = sun.lat > 0 ? -90 : 90;
  const ring = [];
  const N = 256;
  for (let i = 0; i <= N; i++) {
    const lam = -180 + (360 * i) / N;
    const A = cosD * Math.cos(RAD * (lam - sun.lon));
    let phi = Math.atan2(-A, sinD) / RAD;
    if (phi > 90) phi -= 180;
    if (phi < -90) phi += 180;
    ring.push([lam, phi]);
  }
  ring.push([180, darkPole], [-180, darkPole]);
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
}

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

// What the shade layer should show right now
function modeData() {
  if (mode === 'dark') return fullWorldFeature();
  if (mode === 'daynight') return nightFeature(new Date());
  return { type: 'FeatureCollection', features: [] };
}

function addShadeLayer() {
  if (map.getLayer('globe-shade')) return;
  if (!map.getSource('globe-shade')) {
    map.addSource('globe-shade', {
      type: 'geojson',
      // No tile buffer: the default quarter-world buffer wraps around the
      // antimeridian and double-shades the edges of the globe.
      buffer: 0,
      data: modeData()
    });
  }
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

// isStyleLoaded() is only true after the initial 'load' event (style + all
// images), so if the style is not ready yet, wait for the next 'style.load'
// or 'load' and apply then (whichever fires first; addShadeLayer is a no-op
// once the layer exists).
function ensureShadeLayer() {
  if (map.getLayer('globe-shade')) return;
  if (map.isStyleLoaded()) {
    addShadeLayer();
    return;
  }
  const apply = () => addShadeLayer();
  map.once('style.load', apply);
  map.once('load', apply);
}

function refreshShade() {
  if (map.getSource('globe-shade')) {
    map.getSource('globe-shade').setData(modeData());
  }
}

function setMode(next) {
  mode = next;
  const label = document.getElementById('globe-mode-value');
  const label2 = document.getElementById('globe-mode-value2');
  const text = next === 'light' ? 'Light' : next === 'dark' ? 'Dark' : 'Day-Night';
  if (label) label.textContent = text;
  if (label2) label2.textContent = text;

  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }

  ensureShadeLayer();
  refreshShade();

  if (next === 'daynight') {
    updateTimer = setInterval(refreshShade, 60000);
  }
}

// Re-create the shade layer whenever the style (re)loads
map.on('style.load', () => {
  ensureShadeLayer();
  if (mode !== 'light') refreshShade();
});

document.getElementById('toggle-globe-mode').addEventListener('click', () => {
  const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'daynight' : 'light';
  setMode(next);
});

// Default to Day-Night when the page loads
setMode('daynight');
