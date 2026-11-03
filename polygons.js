import { applyAllStyles } from './loadprofilepopup';
import { scene } from "./threejs";
import maplibregl from 'maplibre-gl';
import { animateMapTo } from './animatemapto';
import { classifyImageUrl, isGifUrl, loadImageBytes, needsGifCheck, resolveMediaUrl } from './mediaurl.js';
import { gifStillCanvas } from './gifvideo.js';
import { currentUfoModelInGLTF, polygons } from './letall';
import { map } from './map'
import { cameraState, earthOccludes } from './moon.js';
import { activeMarkerPopups } from './marker';
import { polygonPopupNode } from './processallmessages.js';
import { CloseALL, changePopupState } from './cssLogic';
import { closeDrawAnchor } from './drawhere';
import { closePressAnchor } from './poiinfo';
import { watchPolygonTilt, forgetPolygonTilt } from './polygontilt.js';
import { fillMapTip } from './maptip.js';
import { prefetchPersonFollow } from './followtopic.js';
import { isPointerOnGlobe } from './onglobe.js';
import { advanceIpfsImage, armIpfsAttempt, clearIpfsAttempt, preferGateway } from './ipfsimage.js';
import { formatSliderValue, applySliderValueWidth } from './slidervalue.js';
import { COVER_VIDEO_MAX_SECONDS } from './covervideolimit.js';




export let addedLayers = new Set();

let polygonTitleTip = null;
let polygonTitleTimer = 0;
let polygonTitleFromTouch = false;

function ensurePolygonTitleTip() {
  if (polygonTitleTip) return polygonTitleTip;
  polygonTitleTip = document.createElement("div");
  polygonTitleTip.className = "polygon-title-tip";
  polygonTitleTip.hidden = true;
  document.body.appendChild(polygonTitleTip);
  return polygonTitleTip;
}

function eventPoint(e) {
  const src = e.originalEvent || e;
  const touch = src && (src.touches?.[0] || src.changedTouches?.[0]);
  if (touch) return { x: touch.clientX, y: touch.clientY };
  if (src && typeof src.clientX === "number") return { x: src.clientX, y: src.clientY };
  if (!e.point) return null;
  const rect = map.getCanvas().getBoundingClientRect();
  return { x: rect.left + e.point.x, y: rect.top + e.point.y };
}

function hidePolygonTitle() {
  clearTimeout(polygonTitleTimer);
  polygonTitleFromTouch = false;
  if (!polygonTitleTip) return;
  polygonTitleTip.hidden = true;
  polygonTitleTip._tipSource = null;
}

function polygonRing(polygon) {
  return polygon && polygon.coordinates && polygon.coordinates[0];
}

function polygonHoverOnGlobe(e, polygon) {
  if (isPointerOnGlobe(e && e.point, polygonRing(polygon))) return true;
  hidePolygonTitle();
  map.getCanvas().style.cursor = '';
  return false;
}

function showPolygonTitle(polygon, point, fromTouch) {
  if (!polygon || !point) {
    hidePolygonTitle();
    return;
  }
  const rect = map.getCanvas().getBoundingClientRect();
  if (!isPointerOnGlobe({ x: point.x - rect.left, y: point.y - rect.top }, polygonRing(polygon))) {
    hidePolygonTitle();
    map.getCanvas().style.cursor = '';
    return;
  }
  const tip = ensurePolygonTitleTip();
  if (tip._tipSource !== polygon) {
    if (!fillMapTip(tip, polygon)) {
      hidePolygonTitle();
      return;
    }
    tip._tipSource = polygon;
  }
  clearTimeout(polygonTitleTimer);
  polygonTitleFromTouch = fromTouch;
  tip.hidden = false;
  tip.style.left = `${point.x}px`;
  tip.style.top = `${point.y}px`;
}

map.on("movestart", hidePolygonTitle);

export let activePolygonPopups = [];
export function newActivePolygonPopups(a) {
  activePolygonPopups = a;
}

// Polygon transparency: live value pill + preview (the per-layer map
// opacity listeners are added separately in addPolygon)
const rasterOpacitySlider = document.getElementById("raster-opacity-slider");
const rasterOpacityPill = document.getElementById("raster-opacity-slider-pill");
const mbPolyPreview = document.getElementById("mb-poly-preview");
function paintRasterOpacityReadout() {
  rasterOpacityPill.textContent = formatSliderValue(rasterOpacitySlider, rasterOpacitySlider.value);
  applySliderValueWidth(rasterOpacitySlider, rasterOpacityPill);
}
paintRasterOpacityReadout();
rasterOpacitySlider.addEventListener("input", (event) => {
  paintRasterOpacityReadout();
  mbPolyPreview.style.opacity = event.target.value;
});

const resizedImageCache = new Map();

function rasterize(source, sw, sh, maxWidth, maxHeight) {
  const canvas = document.createElement('canvas');
  let width = sw;
  let height = sh;
  if (width > maxWidth || height > maxHeight) {
    if (width / height > maxWidth / maxHeight) {
      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }
    } else if (height > maxHeight) {
      width = Math.round(width * (maxHeight / height));
      height = maxHeight;
    }
  }
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function loadElementImage(imageUrl, maxWidth, maxHeight, fallbackUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.dataset.canvasImage = '1';
    img.crossOrigin = "anonymous";

    img.onload = () => {
      clearIpfsAttempt(img);
      try {
        resolve(rasterize(img, img.width, img.height, maxWidth, maxHeight));
      } catch (err) {
        // A tainted canvas throws here. One retry on the static fallback.
        if (fallbackUrl && img.src !== fallbackUrl) img.src = fallbackUrl;
        else reject(err);
      }
    };

    img.onerror = () => {
      clearIpfsAttempt(img);
      if (advanceIpfsImage(img)) return;
      if (fallbackUrl && img.src !== fallbackUrl) {
        img.src = fallbackUrl;
      } else {
        reject(new Error(`Failed to load image: ${img.src}`));
      }
    };

    img.src = preferGateway(imageUrl) || imageUrl;
    armIpfsAttempt(img);
  });
}

function createResizedImage(imageUrl, maxWidth = 256, maxHeight = 256, fallbackUrl = null) {
  const key = `${imageUrl}|${maxWidth}|${maxHeight}`;
  const cached = resizedImageCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const url = preferGateway(imageUrl) || imageUrl;
    // The black map placeholder stays until this resolves. A GIF is frame 0
    // from the shared helper, never an <img> that can animate.
    if (url && (isGifUrl(url) || needsGifCheck(url))) {
      const gif = await classifyImageUrl(url);
      if (gif === true) {
        const buf = await loadImageBytes(url);
        const still = await gifStillCanvas(new File([buf], "cover.gif", { type: "image/gif" }));
        if (!still) throw new Error("gif still");
        return rasterize(still, still.width, still.height, maxWidth, maxHeight);
      }
      if (gif == null) {
        if (!fallbackUrl) throw new Error("unverified image");
        return loadElementImage(fallbackUrl, maxWidth, maxHeight, null);
      }
    }
    return loadElementImage(url, maxWidth, maxHeight, fallbackUrl);
  })();
  resizedImageCache.set(key, pending);
  pending.catch(() => {});
  return pending;
}

// ── Animated covers (video) ─────────────────────────────────────────────
// A MapLibre image source is a static texture. A hidden <video> is blitted
// onto a canvas and uploaded from there. A GIF cover is frame 0 only.
// A cover that was converted to MP4 or WebM uses this path, including the 30s rewind.
//
// A looping profile picture is the fill whenever a polygon has no cover of
// its own. The video is created only once the polygon is on screen. In view
// = the map center is inside the source bbox, or a bbox corner projects
// inside the canvas (40px margin) and is not hidden by the Earth. Off view,
// the <video> is not created, a created one is paused, and the rAF stops
// when nothing is visible. Texture cap: 512² JPEG q0.8 @ ~30 fps.
const mediaCovers = new Map(); // sourceId → cover state
// Still covers wait for the same in-view test. Until then the source shows
// the black placeholder.
const pendingCovers = new Map(); // sourceId → { url, corners, kind }
let pumpRunning = false;
let visTimer = null;
const VIDEO_FRAME_MS = 33; // ~30 fps texture uploads (2026-10-07, user asked for 30fps)
const COVER_FALLBACK = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";
const D2R = Math.PI / 180;

// HMR: drop orphaned cover videos left by a previous module instance
document.querySelectorAll('video[data-polygon-cover]').forEach((v) => v.remove());

const mediaKind = (url) => (resolveMediaUrl(url).kind === 'video' ? 'video' : null);

function coverPlayUrl(url) {
  const resolved = resolveMediaUrl(url);
  return resolved.kind === 'video' ? resolved.src : '';
}

let black512 = null;
function blackDataUrl() {
  if (!black512) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, 512, 512);
    black512 = c.toDataURL('image/jpeg');
  }
  return black512;
}

// MapLibre's updateImage only accepts a URL, then decodes it and drops the
// GL texture. Animated frames upload the canvas itself: texture.update
// copies the pixels, and a missing texture is rebuilt from source.image
// on the next prepare. Off-screen covers never reach this.
function swapSourceImage(sourceId, canvas) {
  const src = map.getSource(sourceId);
  if (!src || !canvas) return false;
  try {
    src.image = canvas;
    const texture = src.texture;
    if (texture && typeof texture.update === 'function') {
      texture.update(canvas);
    } else if (texture) {
      src.texture = null;
    }
    map.triggerRepaint();
    return true;
  } catch {
    return false;
  }
}

// In view when the map center sits inside the source bbox (the zoomed-in
// case — all four corners are off screen then) or a bbox corner projects
// inside the canvas (40px margin) without being hidden by the Earth.
// The canvas size is what MapLibre projects into. window.innerHeight
// includes the phone URL bar, so a polygon on screen was treated as off
// view and the cover never left its placeholder.
function coverInView(corners, st) {
  const canvas = map.getCanvas();
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const minLng = Math.min(corners[0][0], corners[2][0]);
  const maxLng = Math.max(corners[1][0], corners[3][0]);
  const minLat = Math.min(corners[2][1], corners[3][1]);
  const maxLat = Math.max(corners[0][1], corners[1][1]);
  let center = null;
  try { center = map.getCenter(); } catch { center = null; }
  if (center && center.lng >= minLng && center.lng <= maxLng && center.lat >= minLat && center.lat <= maxLat) return true;
  for (const [lng, lat] of corners) {
    if (st && st.C) {
      const lr = lat * D2R;
      const gr = lng * D2R;
      const m = [Math.cos(lr) * Math.cos(gr), Math.cos(lr) * Math.sin(gr), Math.sin(lr)];
      if (earthOccludes(st.C, m)) continue;
    }
    let p = null;
    try { p = map.project([lng, lat]); } catch { p = null; }
    if (!p) continue;
    if (p.x >= -40 && p.x <= w + 40 && p.y >= -40 && p.y <= h + 40) return true;
  }
  return false;
}

export function dropPolygonCover(polygonId) {
  if (!polygonId) return;
  forgetPolygonTilt(polygonId);
  const cov = mediaCovers.get(polygonId + '-source');
  if (cov) detachCover(cov);
  const pending = pendingCovers.get(polygonId + '-source');
  if (pending) {
    pending.dead = true; // an in-flight fetch must not apply after the drop
    pendingCovers.delete(polygonId + '-source');
  }
  addedLayers.delete(polygonId + '-mask-layer');
}

function detachCover(cov) {
  if (!cov) return;
  if (cov.video) {
    try { cov.video.pause(); } catch { /* already idle */ }
    cov.video.removeAttribute('src');
    try { cov.video.load(); } catch { /* element is going away */ }
    cov.video.remove();
    cov.video = null;
  }
  mediaCovers.delete(cov.sourceId);
}

// Re-check every cover against ONE camera snapshot; drop covers whose
// source was removed. Runs on moveend/zoomend and every second.
function visPass() {
  if (mediaCovers.size === 0 && pendingCovers.size === 0) { stopVisTimer(); return; }
  for (const sid of [...mediaCovers.keys()]) {
    if (!map.getSource(sid)) detachCover(mediaCovers.get(sid));
  }
  for (const sid of [...pendingCovers.keys()]) {
    if (!map.getSource(sid)) {
      const cov = pendingCovers.get(sid);
      if (cov) cov.dead = true;
      pendingCovers.delete(sid);
    }
  }
  if (mediaCovers.size === 0 && pendingCovers.size === 0) { stopVisTimer(); return; }
  const st = cameraState();
  for (const cov of mediaCovers.values()) cov.inView = coverInView(cov.corners, st);
  for (const [sid, cov] of [...pendingCovers]) {
    if (coverInView(cov.corners, st)) {
      pendingCovers.delete(sid);
      startPendingCover(sid, cov); // its bytes start now
    }
  }
  ensurePump(); // a cover may have just entered view
}

function stopVisTimer() {
  if (visTimer) { clearInterval(visTimer); visTimer = null; }
}

function ensureVisTimer() {
  if (visTimer || (mediaCovers.size === 0 && pendingCovers.size === 0)) return;
  visTimer = setInterval(visPass, 1000);
}

// Queue a still cover until the polygon is on screen. In view at queue
// time → begin now; otherwise visPass checks it on every camera change
// and every second.
function queueCoverLoad(sourceId, url, corners, kind = 'still') {
  const old = pendingCovers.get(sourceId);
  if (old) old.dead = true; // its in-flight fetch must not apply anymore
  pendingCovers.delete(sourceId);
  const cov = { url, corners, kind };
  if (coverInView(corners, cameraState())) {
    startPendingCover(sourceId, cov);
    return;
  }
  pendingCovers.set(sourceId, cov);
  ensureVisTimer();
}

async function startPendingCover(sourceId, cov) {
  try {
    const url = await createResizedImage(cov.url, 512, 512, COVER_FALLBACK);
    // Liveness by flag, not by map lookup: BOTH callers remove the
    // pendingCovers entry before the fetch starts (queueCoverLoad's
    // in-view branch never adds it; visPass deletes it first), so a
    // lookup here always reads "dropped" and the still never left its
    // placeholder.
    if (cov.dead) return;
    if (pendingCovers.get(sourceId) === cov) pendingCovers.delete(sourceId);
    const src = map.getSource(sourceId);
    if (!src || typeof src.updateImage !== 'function') return;
    try {
      src.updateImage({ url });
    } catch {
      /* the black placeholder stays */
    }
  } catch {
    cov.dead = true; // stop the 1s timer from retrying a dead URL
    if (pendingCovers.get(sourceId) === cov) pendingCovers.delete(sourceId);
    /* a failed cover keeps the placeholder — the polygon itself is fine */
  }
}

// Register a video cover. The <video> waits until the polygon is on screen.
function registerCover(sourceId, layerId, kind, url, corners) {
  // A topic reload re-adds the same sourceId — drop the previous load's
  // entry (and its orphaned hidden <video>, if any) and start fresh, so a
  // stale in-flight state from the old source can't block the new one.
  const stale = mediaCovers.get(sourceId);
  if (stale) detachCover(stale);
  const cov = { kind, sourceId, layerId, url, corners, started: false, starting: false, inView: false };
  cov.inView = coverInView(corners, cameraState());
  mediaCovers.set(sourceId, cov);
  ensureVisTimer();
  if (cov.inView) startCover(cov); // in view at insert time → begin now
}

// Begin a cover while it is in view. The hidden <video> decodes on play()
// and the pump blits frames. A background tab pauses it.
async function startCover(cov) {
  if (cov.started || cov.starting) return;
  if (!map.getSource(cov.sourceId)) { detachCover(cov); return; }
  if (cov.kind !== 'video') { detachCover(cov); return; }
  cov.started = true;
  const video = document.createElement('video');
  video.setAttribute('data-polygon-cover', cov.sourceId);
  video.src = cov.url;
  video.crossOrigin = 'anonymous'; // R2 objects carry CORS (set at upload)
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute('muted', '');
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.style.cssText = 'position: fixed; left: -10px; top: -10px; width: 2px; height: 2px; opacity: 0; pointer-events: none;';
  document.body.appendChild(video); // iOS only decodes videos in the DOM
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  Object.assign(cov, { video, canvas, ctx, lastFrameAt: 0 });
  video.addEventListener('error', () => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 512, 512);
      swapSourceImage(cov.sourceId, canvas);
      detachCover(cov);
    };
    img.src = COVER_FALLBACK;
  });
  ensurePump();
}

// The shared pump — one rAF loop for all animated covers. It runs only
// while at least one cover is visible; off-view covers cost nothing (no
// decode, no blit, no texture upload) and the rAF stops between them.
// visPass (moveend/zoomend + 1s timer) restarts it when one enters view.
function ensurePump() {
  if (pumpRunning) return;
  pumpRunning = true;
  const tick = (now) => {
    if (mediaCovers.size === 0) { pumpRunning = false; stopVisTimer(); return; }
    let any = false;
    for (const cov of mediaCovers.values()) {
      // One corrupt cover must not kill the shared loop — drop it and go on
      try {
        let visible = false;
        try {
          visible = cov.inView && !!map.getLayer(cov.layerId)
            && map.getLayoutProperty(cov.layerId, 'visibility') === 'visible';
        } catch { visible = false; }
        if (!cov.started) {
          if (visible && !document.hidden) startCover(cov);
          continue;
        }
        if (!cov.video) { detachCover(cov); continue; }
        if (!visible || document.hidden) {
          if (!cov.video.paused) cov.video.pause();
          continue;
        }
        if (cov.video.currentTime >= COVER_VIDEO_MAX_SECONDS) cov.video.currentTime = 0;
        if (cov.video.paused) cov.video.play().catch(() => {});
        any = true;
        if (now - cov.lastFrameAt < VIDEO_FRAME_MS) continue;
        cov.lastFrameAt = now;
        if (cov.video.readyState >= 2) {
          cov.ctx.drawImage(cov.video, 0, 0, 512, 512);
          if (!swapSourceImage(cov.sourceId, cov.canvas)) detachCover(cov);
        }
      } catch (err) {
        console.error('polygon cover tick failed:', err);
        detachCover(cov);
      }
    }
    if (any) requestAnimationFrame(tick);
    else pumpRunning = false; // nothing visible — rAF stops until visPass
  };
  requestAnimationFrame(tick);
}

map.on('moveend', visPass);
map.on('zoomend', visPass);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    for (const cov of mediaCovers.values()) {
      if (cov.video && !cov.video.paused) cov.video.pause();
    }
    return;
  }
  ensurePump();
});

// MapLibre v5: 'load' fires ONCE (initial style load). After that, every
// in-flight source change (addSource, 3d-model layer, ...) flips
// isStyleLoaded() back to false via 'styledata' — awaiting map.once('load')
// again would hang forever and silently kill every polygon added after the
// first. Track the first 'load' and only wait for it if it has not fired.
let styleLoadSeen = false;
map.on('load', () => { styleLoadSeen = true; });
// Held from the moment an add starts until addSource finishes. The resize
// await is the gap where a second caller used to pass the getSource check.
const pendingPolygonSources = new Set();

export async function addPolygonWithImageFill(map, polygon) {
    const sourceId = `${polygon.id}-source`;
    const layerId = `${polygon.id}-image-layer`;
    const maskLayerId = `${polygon.id}-mask-layer`;

    if (pendingPolygonSources.has(sourceId) || map.getSource(sourceId)) {
      return;
    }
    pendingPolygonSources.add(sourceId);
    try {
    await addPolygonSource(map, polygon, sourceId, layerId, maskLayerId);
    } finally {
      pendingPolygonSources.delete(sourceId);
    }
}

async function addPolygonSource(map, polygon, sourceId, layerId, maskLayerId) {

    // A fresh add creates a NEW mask layer (the old one was removed with the
    // source), so a stale addedLayers entry from a previous topic load is
    // wrong — it would skip the click listener AND the animated-cover
    // registration, leaving video covers black on every topic reload.
    addedLayers.delete(maskLayerId);
  
    // Wait for the initial style load only if it has not happened yet
    if (!styleLoadSeen && !map.isStyleLoaded()) {
      await new Promise((resolve) => {
        map.once('load', () => { styleLoadSeen = true; resolve(); });
      });
    }
  
    try {
      // Calculate the bounding box of the polygon
      const coordinates = polygon.coordinates[0];
      const bounds = coordinates.reduce((bounds, coord) => {
        return {
          minLng: Math.min(bounds.minLng, coord[0]),
          maxLng: Math.max(bounds.maxLng, coord[0]),
          minLat: Math.min(bounds.minLat, coord[1]),
          maxLat: Math.max(bounds.maxLat, coord[1])
        };
      }, {
        minLng: Infinity,
        maxLng: -Infinity,
        minLat: Infinity,
        maxLat: -Infinity
      });
  
      const sourceCoordinates = [
        [bounds.minLng, bounds.maxLat],
        [bounds.maxLng, bounds.maxLat],
        [bounds.maxLng, bounds.minLat],
        [bounds.minLng, bounds.minLat]
      ];

      // Cover media: a video (including a GIF that resolved to MP4) animates
      // through the pump. A raster source is a static texture. coverimage
      // arrives as an ARRAY (["url"]) — MapLibre's source url must be a
      // string, an array fails the schema and kills the whole polygon.
      const coverUrl = (Array.isArray(polygon.imageUrl) ? polygon.imageUrl[0] : polygon.imageUrl) || '';
      const kind = mediaKind(coverUrl);
      const sourceInit = { type: 'image', url: blackDataUrl(), coordinates: sourceCoordinates };

      // Now safe to add source and layers since style is loaded
      map.addSource(sourceId, sourceInit);
  
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
          'raster-brightness-min': 0,
          'raster-brightness-max': 1,
          'raster-contrast': 0,
          'raster-saturation': 0
        },
        layout: {
          'visibility': 'visible'
        },
        interactive: false // Disable click interactions
      });
  
      // Opacity slider listener (only add once per layer, but since it's per-layer, it's fine here)
      document.getElementById("raster-opacity-slider").addEventListener("input", (event) => {
        const opacityValue = event.target.value; // Get the current value of the slider
        if (map.getLayer(layerId)) { // Safety check
          map.setPaintProperty(layerId, 'raster-opacity', parseFloat(opacityValue)); // Update the layer's opacity
        }
      });
  
      // Add mask for the polygon — bounding-box rectangle, exactly matching
      // the visible image so taps anywhere on it open the popup
      const maskSourceId = `${polygon.id}-mask-source`;

      map.addSource(maskSourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [bounds.minLng, bounds.minLat],
              [bounds.maxLng, bounds.minLat],
              [bounds.maxLng, bounds.maxLat],
              [bounds.minLng, bounds.maxLat],
              [bounds.minLng, bounds.minLat]
            ]]
          }
        }
      });
  
      map.addLayer({
        id: maskLayerId,
        type: 'fill',
        source: maskSourceId,
        paint: {
          'fill-opacity': 0, // Set back to 0 for invisibility after debugging
          'fill-outline-color': '#000'
        }
      }, layerId); // Ensure mask layer is above raster layer
  
      // Add interactivity (only if not already added)
      if (!addedLayers.has(maskLayerId)) {
        map.on('click', maskLayerId, (e) => {
          hidePolygonTitle();
          const description = polygonPopupNode(polygon);
          if (description) {
            const targetLngLat = e.lngLat.toArray()
            // A fresh popup per click: re-adding the same instance after an
            // outside-click close gets closed again by its own stale
            // closeOnClick listener (still in this click's listener list).
            const popup = new maplibregl.Popup({ focusAfterOpen: false });
            popup.on('close', () => {
              changePopupState(false);
              if (currentUfoModelInGLTF) {
                scene.add(currentUfoModelInGLTF);
                crosshair.style.display = "block";
              }
              // Remove popup from tracking array when closed
              const index = activePolygonPopups.indexOf(popup);
              if (index > -1) {
                activePolygonPopups.splice(index, 1);
              }
            });
            // Close previously opened popups (other polygons + markers)
            // before opening this one, so the new popup is not in the list
            // when the cleanup runs
            activePolygonPopups.forEach((p) => p.remove());
            activeMarkerPopups.forEach((p) => p.remove());
            CloseALL();
            closeDrawAnchor();
            closePressAnchor(); // a polygon popup replaces the 🗺/📡 pin too
            popup
              .setLngLat(e.lngLat)
              .setDOMContent(description)
              .addTo(map);
            animateMapTo(map, targetLngLat, null);
            activePolygonPopups.push(popup);
            applyAllStyles();
          }
          changePopupState(true);
          if (currentUfoModelInGLTF) {
            scene.remove(currentUfoModelInGLTF);
            crosshair.style.display = "none";
          }
        });
  
        map.on('mouseenter', maskLayerId, (e) => {
          if (!polygonHoverOnGlobe(e, polygon)) return;
          prefetchPersonFollow(polygon.payer);
          map.getCanvas().style.cursor = 'pointer';
          showPolygonTitle(polygon, eventPoint(e), false);
        });

        map.on('mousemove', maskLayerId, (e) => {
          if (!polygonHoverOnGlobe(e, polygon)) return;
          map.getCanvas().style.cursor = 'pointer';
          showPolygonTitle(polygon, eventPoint(e), false);
        });

        map.on('mouseleave', maskLayerId, () => {
          map.getCanvas().style.cursor = '';
          if (polygonTitleFromTouch) {
            clearTimeout(polygonTitleTimer);
            polygonTitleTimer = setTimeout(hidePolygonTitle, 1200);
          } else {
            hidePolygonTitle();
          }
        });

        map.on('touchstart', maskLayerId, (e) => {
          if (!polygonHoverOnGlobe(e, polygon)) return;
          prefetchPersonFollow(polygon.payer);
          showPolygonTitle(polygon, eventPoint(e), true);
        });

        map.on('touchend', maskLayerId, () => {
          clearTimeout(polygonTitleTimer);
          polygonTitleTimer = setTimeout(hidePolygonTitle, 1200);
        });

        // Mark this layer as added
        addedLayers.add(maskLayerId);

        // A video cover waits until the polygon is on screen. A still
        // cover does too, and downloads only then. A GIF is frame 0.
        if (kind === 'video') {
          registerCover(sourceId, layerId, 'video', coverPlayUrl(coverUrl), sourceCoordinates);
        } else {
          queueCoverLoad(sourceId, coverUrl, sourceCoordinates, 'still');
        }
        watchPolygonTilt(map, sourceId, layerId, maskLayerId, sourceCoordinates);
      }
    } catch (error) {
      console.error('Error loading or resizing image:', error);
    }
  }

  let polygonsVisible = true;



  // Function to toggle polygons visibility
  function togglePolygons() {
      polygonsVisible = !polygonsVisible; // Toggle state

      polygons.forEach(polygon => {
          const layerId = `${polygon.id}-image-layer`;
          const maskLayerId = `${polygon.id}-mask-layer`; // Define the mask layer ID

          if (map.getLayer(layerId)) {
              const visibility = polygonsVisible ? 'visible' : 'none'; // Set visibility based on the current state
              map.setLayoutProperty(layerId, 'visibility', visibility);
              map.setLayoutProperty(maskLayerId, 'visibility', visibility); // Also toggle the mask layer visibility
          }
      });

      document.getElementById("polygon-visibility-value").textContent = polygonsVisible ? "On" : "Off"; // Update button state
      document.getElementById("polygon-visibility-value2").textContent = polygonsVisible ? "On" : "Off"; // Update button state
  }

  document.getElementById("toggle-polygon-visibility").addEventListener("click", togglePolygons);

