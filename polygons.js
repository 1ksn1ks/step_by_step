import { applyAllStyles } from './loadprofilepopup';
import { scene } from "./threejs";
import maplibregl from 'maplibre-gl';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { animateMapTo } from './animatemapto';
import { currentUfoModelInGLTF, polygons } from './letall';
import { map } from './map'
import { cameraState, earthOccludes } from './moon.js';
import { activeMarkerPopups } from './marker';
import { CloseALL, changePopupState } from './cssLogic';
import { closeDrawAnchor } from './drawhere';
import { closePressAnchor } from './poiinfo';




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
  if (polygonTitleTip) polygonTitleTip.hidden = true;
}

function showPolygonTitle(title, point, fromTouch) {
  const text = String(title || "").trim();
  if (!text || !point) {
    hidePolygonTitle();
    return;
  }
  clearTimeout(polygonTitleTimer);
  polygonTitleFromTouch = fromTouch;
  const tip = ensurePolygonTitleTip();
  tip.textContent = text;
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
rasterOpacitySlider.addEventListener("input", (event) => {
  rasterOpacityPill.textContent = event.target.value;
  mbPolyPreview.style.opacity = event.target.value;
});

async function createResizedImage(imageUrl, maxWidth = 256, maxHeight = 256, fallbackUrl = null) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Maintain aspect ratio
      if (width > maxWidth || height > maxHeight) {
        if (width / height > maxWidth / maxHeight) {
          // wider than target ratio → constrain by width
          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
        } else {
          // taller or same → constrain by height
          if (height > maxHeight) {
            width = Math.round(width * (maxHeight / height));
            height = maxHeight;
          }
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(img, 0, 0, width, height);

      // You can also do: 'image/webp', 0.85 for smaller size & good quality
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };

    img.onerror = () => {
      if (fallbackUrl && img.src !== fallbackUrl) {
        // Try fallback once
        img.src = fallbackUrl;
      } else {
        reject(new Error(`Failed to load image: ${img.src}`));
      }
    };

    img.src = imageUrl;
  });
}

// ── Animated covers (gif / video) ────────────────────────────────────────
// A MapLibre image source is a STATIC texture — that is why a gif cover
// used to freeze at frame 0. map.updateImage() swaps the texture of a live
// source, so a small pump drives it: gif frames are decoded with gifuct-js
// and composited with proper disposal; video frames come from a hidden
// <video> blitted onto a canvas (~15 fps).
//
// Power rule (2026-10-07): a cover is only fetched, decoded and pumped
// while its polygon is actually on screen. In view = the viewport center
// is inside the source bbox (the zoomed-in-on-polygon case — all four
// corners are off screen then) OR a bbox corner projects inside the
// viewport (40px margin) without being hidden by the Earth (all corners
// occluded → off the visible hemisphere). Off view: the <video> is not
// even created, a created one is paused (decoding stops), and the shared
// rAF loop stops entirely when nothing is visible. Visibility is
// re-checked on moveend/zoomend and every second. Texture caps: video
// 512² JPEG q0.8 @ ~30 fps; gif composited at native res, uploaded capped
// at 512. The full native-quality player with sound lives in the popup
// (the "Inside image" field).
const mediaCovers = new Map(); // sourceId → cover state
let pumpRunning = false;
let visTimer = null;
const VIDEO_FRAME_MS = 33; // ~30 fps texture uploads (2026-10-07, user asked for 30fps)
const GIF_MIN_DELAY_MS = 20;
const COVER_FALLBACK = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";
const D2R = Math.PI / 180;

// HMR: drop orphaned cover videos left by a previous module instance
document.querySelectorAll('video[data-polygon-cover]').forEach((v) => v.remove());

const mediaKind = (url) =>
  /\.(mp4|webm)(\?|#|$)/i.test(url) ? 'video'
  : /\.gif(\?|#|$)/i.test(url) ? 'gif'
  : null;

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

// MapLibre v5: map.updateImage() only addresses style images, not image
// SOURCES — sources are swapped via source.updateImage({url}), which
// reloads the texture from that url (canvas/ImageData inputs are ignored
// silently). So each animated frame is encoded to a data-URL and the
// source is pointed at it.
function swapSourceImage(sourceId, canvas) {
  const src = map.getSource(sourceId);
  if (!src || typeof src.updateImage !== 'function') return false;
  try {
    src.updateImage({ url: canvas.toDataURL('image/jpeg', 0.8) });
    return true;
  } catch {
    return false;
  }
}

// Decode an ArrayBuffer → {width, height, frames:[{dims, delay(ms),
// disposalType, patch:RGBA}]} or null if it is not a gif. gifuct-js v2:
// parseGIF + decompressFrames(..., true) — each frame's patch is already
// RGBA (alpha 0 at the transparent color) and delay is already in ms.
function decodeGif(buf) {
  try {
    const parsed = parseGIF(buf);
    const frames = decompressFrames(parsed, true);
    return {
      width: parsed.lsd.width,
      height: parsed.lsd.height,
      frames: frames.map((f) => ({
        dims: f.dims,
        delay: f.delay,
        disposalType: f.disposalType,
        patch: f.patch,
      })),
    };
  } catch {
    return null;
  }
}

// In view when the viewport center sits inside the source bbox (the
// zoomed-in-on-polygon case — all four corners are off screen then) or a
// bbox corner projects inside the viewport (40px margin) without being
// hidden by the Earth. corners = the image source's 4 bbox [lng,lat] pairs,
// st = cameraState().
function coverInView(corners, st) {
  const minLng = Math.min(corners[0][0], corners[2][0]);
  const maxLng = Math.max(corners[1][0], corners[3][0]);
  const minLat = Math.min(corners[2][1], corners[3][1]);
  const maxLat = Math.max(corners[0][1], corners[1][1]);
  const c = map.unproject([st.w / 2, st.h / 2]);
  if (c.lng >= minLng && c.lng <= maxLng && c.lat >= minLat && c.lat <= maxLat) return true;
  const { C, f, w, h } = st;
  const fwd = st.cam.fwd;
  const right = st.cam.right;
  const up = st.cam.up;
  for (const [lng, lat] of corners) {
    const lr = lat * D2R;
    const gr = lng * D2R;
    const m = [Math.cos(lr) * Math.cos(gr), Math.cos(lr) * Math.sin(gr), Math.sin(lr)];
    const wv = [m[0] - C[0], m[1] - C[1], m[2] - C[2]];
    const z = wv[0] * fwd[0] + wv[1] * fwd[1] + wv[2] * fwd[2];
    if (z <= 0.01 || earthOccludes(C, m)) continue;
    const x = w / 2 + (f * (wv[0] * right[0] + wv[1] * right[1] + wv[2] * right[2])) / z;
    const y = h / 2 - (f * (wv[0] * up[0] + wv[1] * up[1] + wv[2] * up[2])) / z;
    if (x >= -40 && x <= w + 40 && y >= -40 && y <= h + 40) return true;
  }
  return false;
}

// Re-check every cover against ONE camera snapshot; drop covers whose
// source was removed. Runs on moveend/zoomend and every second.
function visPass() {
  if (mediaCovers.size === 0) { stopVisTimer(); return; }
  for (const sid of [...mediaCovers.keys()]) {
    if (!map.getSource(sid)) mediaCovers.delete(sid);
  }
  if (mediaCovers.size === 0) { stopVisTimer(); return; }
  const st = cameraState();
  if (!st) return;
  for (const cov of mediaCovers.values()) cov.inView = coverInView(cov.corners, st);
  ensurePump(); // a cover may have just entered view
}

function stopVisTimer() {
  if (visTimer) { clearInterval(visTimer); visTimer = null; }
}

function ensureVisTimer() {
  if (visTimer || mediaCovers.size === 0) return;
  visTimer = setInterval(visPass, 1000);
}

// Register an animated cover. NOTHING is fetched or created yet — the
// first frame only starts once the polygon is actually in view.
function registerCover(sourceId, layerId, kind, url, corners) {
  // A topic reload re-adds the same sourceId — drop the previous load's
  // entry (and its orphaned hidden <video>, if any) and start fresh, so a
  // stale in-flight state from the old source can't block the new one.
  const stale = mediaCovers.get(sourceId);
  if (stale) {
    if (stale.video) stale.video.remove();
    mediaCovers.delete(sourceId);
  }
  const cov = { kind, sourceId, layerId, url, corners, started: false, starting: false, inView: false };
  const st = cameraState();
  if (st) cov.inView = coverInView(corners, st);
  mediaCovers.set(sourceId, cov);
  ensureVisTimer();
  if (cov.inView) startCover(cov); // in view at insert time → begin now
}

// Begin a cover (only called while in view): video → create the hidden
// <video> (decoding starts with play(), driven by the pump); gif → fetch +
// decode (the only heavy part, so it waits for view-entry) and composite
// frame 0.
async function startCover(cov) {
  if (cov.started || cov.starting) return;
  if (!map.getSource(cov.sourceId)) { mediaCovers.delete(cov.sourceId); return; }
  if (cov.kind === 'video') {
    cov.started = true;
    const video = document.createElement('video');
    video.setAttribute('data-polygon-cover', cov.sourceId);
    video.src = cov.url;
    video.crossOrigin = 'anonymous'; // R2 objects carry CORS: * (set at upload)
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position: fixed; left: -10px; top: -10px; width: 2px; height: 2px; opacity: 0; pointer-events: none;';
    document.body.appendChild(video); // iOS only decodes videos in the DOM
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    Object.assign(cov, { video, canvas, ctx, lastFrameAt: 0 });
    video.addEventListener('error', () => {
      // Unplayable video → the same fallback the static covers use
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.drawImage(img, 0, 0, 512, 512);
        swapSourceImage(cov.sourceId, canvas);
        mediaCovers.delete(cov.sourceId);
      };
      img.src = COVER_FALLBACK;
    });
    ensurePump();
    return;
  }
  // gif — deferred fetch + decode
  cov.starting = true;
  let buf;
  try {
    buf = await (await fetch(cov.url, { mode: 'cors' })).arrayBuffer();
  } catch {
    cov.starting = false;
    mediaCovers.delete(cov.sourceId); // fetch failed — black placeholder stays, no retry
    return;
  }
  const gif = decodeGif(buf);
  if (!gif || !gif.frames.length || !gif.width || !gif.height) {
    cov.starting = false;
    mediaCovers.delete(cov.sourceId);
    return;
  }
  // Compose at the gif's native resolution (proper disposal needs it),
  // then upload a copy capped at 512 — big gifs used to upload full-res.
  const full = document.createElement('canvas');
  full.width = gif.width;
  full.height = gif.height;
  const fctx = full.getContext('2d');
  let out = null;
  let octx = null;
  if (gif.width > 512 || gif.height > 512) {
    const s = Math.min(512 / gif.width, 512 / gif.height);
    out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(gif.width * s));
    out.height = Math.max(1, Math.round(gif.height * s));
    octx = out.getContext('2d');
  }
  const frames = gif.frames;
  cov.paint = (i) => {
    const f = frames[i];
    const { left, top, width: fw, height: fh } = f.dims;
    const x = left;
    const y = top;
    const w = Math.min(fw, full.width - x);
    const h = Math.min(fh, full.height - y);
    const saved = (f.disposalType === 3 && w > 0 && h > 0)
      ? fctx.getImageData(x, y, w, h) : null;
    if (w > 0 && h > 0) {
      // The patch is RGBA — alpha 0 means transparent and keeps whatever
      // was already on the base (required while the frame is shown).
      const region = fctx.getImageData(x, y, w, h);
      const px = region.data;
      const patch = f.patch;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const po = (yy * fw + xx) * 4;
          if (patch[po + 3] === 0) continue;
          const o = (yy * w + xx) * 4;
          px[o] = patch[po];
          px[o + 1] = patch[po + 1];
          px[o + 2] = patch[po + 2];
          px[o + 3] = 255;
        }
      }
      fctx.putImageData(region, x, y);
    }
    if (out) octx.drawImage(full, 0, 0, out.width, out.height);
    if (!swapSourceImage(cov.sourceId, out || full)) mediaCovers.delete(cov.sourceId);
    // After-disposal: prepare the base for the NEXT frame.
    if (f.disposalType === 2) fctx.clearRect(x, y, w, h); // restore to background
    else if (saved) fctx.putImageData(saved, x, y);       // 3: restore previous
    // 0/1/4: the frame stays in place (next composites on top)
  };
  cov.frames = frames;
  cov.idx = 0;
  cov.started = true;
  cov.starting = false;
  cov.paint(0);
  cov.nextFrameAt = performance.now() + Math.max(GIF_MIN_DELAY_MS, frames[0].delay);
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
          if (visible) startCover(cov); // fetch/decode or create the video now
          continue;
        }
        if (cov.kind === 'video') {
          if (!visible) {
            if (!cov.video.paused) cov.video.pause();
            continue;
          }
          if (cov.video.paused) cov.video.play().catch(() => {});
          any = true;
          if (now - cov.lastFrameAt < VIDEO_FRAME_MS) continue; // ~15 fps
          cov.lastFrameAt = now;
          if (cov.video.readyState >= 2) {
            cov.ctx.drawImage(cov.video, 0, 0, 512, 512);
            if (!swapSourceImage(cov.sourceId, cov.canvas)) mediaCovers.delete(cov.sourceId);
          }
        } else if (cov.kind === 'gif') {
          if (!visible) { cov.nextFrameAt = now; continue; }
          if (now < cov.nextFrameAt) { any = true; continue; }
          any = true;
          cov.idx = (cov.idx + 1) % cov.frames.length;
          cov.paint(cov.idx);
          cov.nextFrameAt = now + Math.max(GIF_MIN_DELAY_MS, cov.frames[cov.idx].delay);
        }
      } catch (err) {
        console.error('polygon cover tick failed:', err);
        mediaCovers.delete(cov.sourceId);
      }
    }
    if (any) requestAnimationFrame(tick);
    else pumpRunning = false; // nothing visible — rAF stops until visPass
  };
  requestAnimationFrame(tick);
}

map.on('moveend', visPass);
map.on('zoomend', visPass);

// MapLibre v5: 'load' fires ONCE (initial style load). After that, every
// in-flight source change (addSource, 3d-model layer, ...) flips
// isStyleLoaded() back to false via 'styledata' — awaiting map.once('load')
// again would hang forever and silently kill every polygon added after the
// first. Track the first 'load' and only wait for it if it has not fired.
let styleLoadSeen = false;
map.on('load', () => { styleLoadSeen = true; });

export async function addPolygonWithImageFill(map, polygon) {
    const sourceId = `${polygon.id}-source`;
    const layerId = `${polygon.id}-image-layer`;
    const maskLayerId = `${polygon.id}-mask-layer`;
  
    // Check if the source already exists
    if (map.getSource(sourceId)) {
      return; // Skip adding this polygon if the source already exists
    }

    // A fresh add creates a NEW mask layer (the old one was removed with the
    // source), so a stale addedLayers entry from a previous topic load is
    // wrong — it would skip the click listener AND the animated-cover
    // registration, leaving gif/video covers black on every topic reload.
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

      // Cover media: gif/video animate through the pump below — a raster
      // source is a static texture, so the canvas resize can't see their
      // later frames. coverimage arrives as an ARRAY (["url"]) — MapLibre's
      // source url must be a string, an array fails the schema and kills
      // the whole polygon ("string expected, array found").
      const coverUrl = (Array.isArray(polygon.imageUrl) ? polygon.imageUrl[0] : polygon.imageUrl) || '';
      const kind = mediaKind(coverUrl);
      let sourceInit;
      if (kind === 'gif') {
        // Black placeholder — the gif itself is only fetched + decoded
        // once the polygon is in view (registerCover → startCover), so an
        // off-screen polygon costs nothing at load.
        sourceInit = { type: 'image', url: blackDataUrl(), coordinates: sourceCoordinates };
      } else if (kind === 'video') {
        // Image sources need a `url` (a `data` property is rejected by this
        // MapLibre version and kills the whole polygon) — a black data-URL
        // placeholder until the first frame is blitted.
        sourceInit = { type: 'image', url: blackDataUrl(), coordinates: sourceCoordinates };
      } else {
        const resizedImageUrl = await createResizedImage(coverUrl, 512, 512, COVER_FALLBACK);
        sourceInit = { type: 'image', url: resizedImageUrl, coordinates: sourceCoordinates };
      }

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
          if (polygon.description) {
            const targetLngLat = e.lngLat.toArray()
            // A fresh popup per click: re-adding the same instance after an
            // outside-click close gets closed again by its own stale
            // closeOnClick listener (still in this click's listener list).
            const popup = new maplibregl.Popup();
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
              .setDOMContent(polygon.description)
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
          map.getCanvas().style.cursor = 'pointer';
          showPolygonTitle(polygon.title, eventPoint(e), false);
        });

        map.on('mousemove', maskLayerId, (e) => {
          showPolygonTitle(polygon.title, eventPoint(e), false);
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
          showPolygonTitle(polygon.title, eventPoint(e), true);
        });

        map.on('touchend', maskLayerId, () => {
          clearTimeout(polygonTitleTimer);
          polygonTitleTimer = setTimeout(hidePolygonTitle, 1200);
        });

        // Mark this layer as added
        addedLayers.add(maskLayerId);

        // Animated cover (gif/video) — registered only; the fetch/decode
        // (gif) and <video> creation (video) wait until the polygon
        // actually enters view (see registerCover / visPass above).
        if (kind === 'gif' || kind === 'video') {
          registerCover(sourceId, layerId, kind, coverUrl, sourceCoordinates);
        }
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

