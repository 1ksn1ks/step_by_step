import { map } from './map.js';

const RAD = Math.PI / 180;

let mode = 'daynight';
let updateTimer = null;

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

// The night side of the Earth as a per-pixel image (0.5° per pixel).
// Every pixel's darkness comes from the real sun elevation, so the
// terminator is a smooth sunrise/sunset fade — and because it's a texture,
// not geometry, there are no tile seams or missing pixels.
// The image source is a single zoom-0 tile, and the globe projects tile
// textures with MERCATOR latitude mapping, so each row must be filled with
// the darkness of the latitude that row will actually be displayed at
// (linear latitude would land the terminator at the wrong place).
const IMG_W = 720;
const IMG_H = 360;
const FADE_DEG = 4; // fade width in degrees of sun elevation around the horizon

function nightDataUrl(date) {
  const sun = subsolarPoint(date);
  const sinD = Math.sin(sun.lat * RAD);
  const cosD = Math.cos(sun.lat * RAD);
  const canvas = document.createElement('canvas');
  canvas.width = IMG_W;
  canvas.height = IMG_H;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(IMG_W, IMG_H);
  const px = imgData.data;
  for (let y = 0; y < IMG_H; y++) {
    const t = (y + 0.5) / IMG_H; // 0 = north edge .. 1 = south edge
    // inverse web-mercator: the geographic latitude displayed at row t
    const lat = (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * t))) - Math.PI / 2) / RAD;
    const sinLat = Math.sin(lat * RAD);
    const cosLat = Math.cos(lat * RAD);
    for (let x = 0; x < IMG_W; x++) {
      const lon = -180 + ((x + 0.5) / IMG_W) * 360;
      const sinEl = sinD * sinLat + cosD * cosLat * Math.cos(RAD * (lon - sun.lon));
      const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
      let darkness = (FADE_DEG - el) / (2 * FADE_DEG);
      if (darkness < 0) darkness = 0;
      else if (darkness > 1) darkness = 1;
      const i = (y * IMG_W + x) * 4;
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 26; // #00001a
      px[i + 3] = Math.round(darkness * 255);
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
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

function clearShade() {
  if (map.getLayer('globe-shade')) map.removeLayer('globe-shade');
  if (map.getSource('globe-shade')) map.removeSource('globe-shade');
}

// Day-Night: one image source whose texture is swapped in place every minute
// (updateImage), so the shade never flickers.
function addDayNightShade() {
  if (map.getLayer('globe-shade')) return;
  // Corners must stay within web-mercator latitude: at exactly ±90° the
  // south corner's Mercator Y is Infinity, which makes ImageSource compute
  // tile (0,0,Infinity) that never matches tile (0,0,0) — the image then
  // renders nothing. The z0 tile still projects onto the whole sphere in
  // globe mode, so the poles are covered.
  map.addSource('globe-shade', {
    type: 'image',
    url: nightDataUrl(new Date()),
    coordinates: [[-180, 85.05112877980659], [180, 85.05112877980659], [180, -85.05112877980659], [-180, -85.05112877980659]]
  });
  map.addLayer({
    id: 'globe-shade',
    type: 'raster',
    source: 'globe-shade',
    paint: {
      'raster-opacity': 0.75,
      'raster-fade-duration': 0
    }
  });
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

function refreshShade() {
  if (mode !== 'daynight') return;
  const source = map.getSource('globe-shade');
  if (source && source.updateImage) {
    source.updateImage({ url: nightDataUrl(new Date()) });
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

  clearShade();
  ensureShadeLayer();

  if (next === 'daynight') {
    updateTimer = setInterval(refreshShade, 60000);
  }
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
