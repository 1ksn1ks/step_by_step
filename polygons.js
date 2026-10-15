import { applyAllStyles } from './loadprofilepopup';
import { scene } from "./threejs";
import maplibregl from 'maplibre-gl';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { animateMapTo } from './animatemapto';
import { currentUfoModelInGLTF, polygons } from './letall';
import { map } from './map'
import { cameraState, earthOccludes } from './moon.js';
import { activeMarkerPopups } from './marker';
import { polygonPopupNode } from './processallmessages.js';
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

const resizedImageCache = new Map();

function createResizedImage(imageUrl, maxWidth = 256, maxHeight = 256, fallbackUrl = null) {
  const key = `${imageUrl}|${maxWidth}|${maxHeight}`;
  const cached = resizedImageCache.get(key);
  if (cached) return cached;
  const pending = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
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
      } catch (err) {
        // A tainted canvas throws here. One retry on the static fallback.
        if (fallbackUrl && img.src !== fallbackUrl) img.src = fallbackUrl;
        else reject(err);
      }
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
  resizedImageCache.set(key, pending);
  pending.catch(() => {});
  return pending;
}

// ── Animated covers (gif / video) ────────────────────────────────────────
// A MapLibre image source is a STATIC texture. map source.updateImage({url})
// swaps it, so a small pump drives gif frames (gifuct-js, proper disposal)
// and video frames (hidden <video> blitted to a canvas).
//
// A gif profile picture is the fill whenever a polygon has no cover of its
// own. Phones used to stay black: the in-view test measured the window, not
// the map canvas (the URL bar makes those differ), and a failed decode
// deleted the cover while the black placeholder stayed. The first frame is
// painted as soon as the bytes arrive, shared by every polygon on that URL,
// and left in place if animation never starts. Decode is also one copy per
// URL — each polygon used to hold its own frame patches.
//
// Animation still waits until the polygon is on screen. In view = the map
// center is inside the source bbox, or a bbox corner projects inside the
// canvas (40px margin) and is not hidden by the Earth. Off view: the
// <video> is not created, a created one is paused, and the rAF stops when
// nothing is visible. Visibility is re-checked on moveend/zoomend and every
// second. Texture caps: video 512² JPEG q0.8 @ ~30 fps; gif composited at
// native res, uploaded capped at 512.
const mediaCovers = new Map(); // sourceId → cover state
const gifPlayers = new Map(); // gif url → shared decoder/canvas
const gifBytes = new Map(); // gif url → Promise<ArrayBuffer>
const gifDecoded = new Map(); // gif url → Promise<decoded|null>
const gifStillByUrl = new Map(); // gif url → Promise<dataURL>
let pumpRunning = false;
let visTimer = null;
const VIDEO_FRAME_MS = 33; // ~30 fps texture uploads (2026-10-07, user asked for 30fps)
const GIF_MIN_DELAY_MS = 20;
const COVER_FALLBACK = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";
const D2R = Math.PI / 180;

// A profile <img> can cache this GIF without CORS. A later canvas fetch then
// fails on iOS. The public R2 url is unsigned, so a cache-bust query is safe.
function corsFetchUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    u.searchParams.set('mb', '1');
    return u.href;
  } catch {
    return url;
  }
}

function gifBytesOf(url) {
  let pending = gifBytes.get(url);
  if (pending) return pending;
  pending = fetch(corsFetchUrl(url), { mode: 'cors', cache: 'no-store' }).then((res) => {
    if (!res.ok) throw new Error(String(res.status));
    return res.arrayBuffer();
  });
  pending.catch(() => {
    if (gifBytes.get(url) === pending) gifBytes.delete(url);
  });
  gifBytes.set(url, pending);
  return pending;
}

function decodedGif(url) {
  let pending = gifDecoded.get(url);
  if (pending) return pending;
  pending = (async () => {
    try {
      const gif = decodeGif(await gifBytesOf(url));
      gifBytes.delete(url);
      if (!gif || !gif.frames.length || !gif.width || !gif.height) {
        if (gifDecoded.get(url) === pending) gifDecoded.delete(url);
        return null;
      }
      return gif;
    } catch {
      if (gifDecoded.get(url) === pending) gifDecoded.delete(url);
      return null;
    }
  })();
  gifDecoded.set(url, pending);
  return pending;
}

// First frame as a JPEG. createImageBitmap keeps the browser from decoding
// every frame just to show the still. Shared: one profile GIF fills many
// polygons that have no cover of their own.
function gifStill(url) {
  let pending = gifStillByUrl.get(url);
  if (pending) return pending;
  pending = (async () => {
    try {
      const buf = await gifBytesOf(url);
      const bmp = await createImageBitmap(new Blob([buf], { type: 'image/gif' }));
      const max = 512;
      let w = bmp.width;
      let h = bmp.height;
      if (!(w > 0) || !(h > 0)) throw new Error('empty gif frame');
      if (w > max || h > max) {
        const s = Math.min(max / w, max / h);
        w = Math.max(1, Math.round(w * s));
        h = Math.max(1, Math.round(h * s));
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
      try {
        return await createResizedImage(corsFetchUrl(url), 512, 512, COVER_FALLBACK);
      } catch {
        try {
          return await createResizedImage(COVER_FALLBACK, 512, 512);
        } catch {
          if (gifStillByUrl.get(url) === pending) gifStillByUrl.delete(url);
          return blackDataUrl();
        }
      }
    }
  })();
  gifStillByUrl.set(url, pending);
  return pending;
}

function paintGifStill(sourceId, url) {
  gifStill(url).then((dataUrl) => {
    const cov = mediaCovers.get(sourceId);
    if (cov && cov.player) return; // animation already owns the texture
    const src = map.getSource(sourceId);
    if (!src || typeof src.updateImage !== 'function' || !dataUrl || dataUrl === blackDataUrl()) return;
    try { src.updateImage({ url: dataUrl }); } catch { /* still stays at the placeholder */ }
  });
}

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

// In view when the map center sits inside the source bbox (the zoomed-in
// case — all four corners are off screen then) or a bbox corner projects
// inside the canvas (40px margin) without being hidden by the Earth.
// The canvas size is what MapLibre projects into. window.innerHeight
// includes the phone URL bar, so a polygon on screen was treated as off
// view and the gif never left its placeholder.
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
  const cov = mediaCovers.get(polygonId + '-source');
  if (cov) detachCover(cov);
  addedLayers.delete(polygonId + '-mask-layer');
}

function detachCover(cov) {
  if (!cov) return;
  if (cov.video) {
    cov.video.remove();
    cov.video = null;
  }
  const player = cov.player;
  if (player) {
    player.covers.delete(cov.sourceId);
    cov.player = null;
    if (player.covers.size === 0) gifPlayers.delete(player.url);
  }
  mediaCovers.delete(cov.sourceId);
}

function freezeGif(player) {
  if (!player) return;
  gifPlayers.delete(player.url);
  const doomed = [];
  for (const cov of mediaCovers.values()) {
    if (cov.player === player) doomed.push(cov);
  }
  player.frames = null;
  player.covers.clear();
  for (const cov of doomed) {
    cov.player = null;
    if (cov.video) {
      cov.video.remove();
      cov.video = null;
    }
    mediaCovers.delete(cov.sourceId);
  }
}

function compositeGifFrame(player, i) {
  try {
    const f = player.frames[i];
    const { left, top, width: fw, height: fh } = f.dims;
    const x = left;
    const y = top;
    const full = player.full;
    const fctx = player.fctx;
    const w = Math.min(fw, full.width - x);
    const h = Math.min(fh, full.height - y);
    const saved = (f.disposalType === 3 && w > 0 && h > 0)
      ? fctx.getImageData(x, y, w, h) : null;
    if (w > 0 && h > 0) {
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
    // Disposal below mutates `full`. The uploaded canvas has to stay the
    // frame that was just drawn, and stay the same size so the GL texture
    // can be updated in place.
    if (player.out) {
      player.octx.drawImage(full, 0, 0, player.out.width, player.out.height);
      player.frameCanvas = player.out;
    } else {
      if (!player.hold) {
        player.hold = document.createElement('canvas');
        player.hold.width = full.width;
        player.hold.height = full.height;
        player.hctx = player.hold.getContext('2d');
      }
      player.hctx.drawImage(full, 0, 0);
      player.frameCanvas = player.hold;
    }
    if (f.disposalType === 2) fctx.clearRect(x, y, w, h);
    else if (saved) fctx.putImageData(saved, x, y);
    return !!player.frameCanvas;
  } catch {
    player.frameCanvas = null;
    return false;
  }
}

function pushGifFrame(player) {
  if (!player.frameCanvas) return;
  for (const sourceId of [...player.covers]) {
    if (!swapSourceImage(sourceId, player.frameCanvas)) {
      detachCover(mediaCovers.get(sourceId));
    }
  }
}

function makeGifPlayer(url, gif) {
  const full = document.createElement('canvas');
  full.width = gif.width;
  full.height = gif.height;
  const fctx = full.getContext('2d', { willReadFrequently: true });
  let out = null;
  let octx = null;
  if (gif.width > 512 || gif.height > 512) {
    const s = Math.min(512 / gif.width, 512 / gif.height);
    out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(gif.width * s));
    out.height = Math.max(1, Math.round(gif.height * s));
    octx = out.getContext('2d');
  }
  const player = {
    url,
    frames: gif.frames,
    covers: new Set(),
    idx: 0,
    nextFrameAt: 0,
    frameCanvas: null,
    ticked: 0,
    full,
    fctx,
    out,
    octx,
  };
  if (!compositeGifFrame(player, 0)) return null;
  player.nextFrameAt = performance.now() + Math.max(GIF_MIN_DELAY_MS, gif.frames[0].delay || 0);
  return player;
}

// Re-check every cover against ONE camera snapshot; drop covers whose
// source was removed. Runs on moveend/zoomend and every second.
function visPass() {
  if (mediaCovers.size === 0) { stopVisTimer(); return; }
  for (const sid of [...mediaCovers.keys()]) {
    if (!map.getSource(sid)) detachCover(mediaCovers.get(sid));
  }
  if (mediaCovers.size === 0) { stopVisTimer(); return; }
  const st = cameraState();
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

// Register an animated cover. The gif still is painted separately
// (paintGifStill) so a phone that never starts the pump still shows the
// picture. Decoding and the <video> wait until the polygon is in view.
function registerCover(sourceId, layerId, kind, url, corners) {
  // A topic reload re-adds the same sourceId — drop the previous load's
  // entry (and its orphaned hidden <video>, if any) and start fresh, so a
  // stale in-flight state from the old source can't block the new one.
  const stale = mediaCovers.get(sourceId);
  if (stale) detachCover(stale);
  const cov = { kind, sourceId, layerId, url, corners, started: false, starting: false, inView: false, player: null };
  cov.inView = coverInView(corners, cameraState());
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
  if (!map.getSource(cov.sourceId)) { detachCover(cov); return; }
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
        detachCover(cov);
      };
      img.src = COVER_FALLBACK;
    });
    ensurePump();
    return;
  }
  // One decode for every polygon that shares this gif (a profile picture
  // with no polygon cover). Failure leaves the still frame in place.
  cov.starting = true;
  const gif = await decodedGif(cov.url);
  cov.starting = false;
  if (mediaCovers.get(cov.sourceId) !== cov) return;
  if (!map.getSource(cov.sourceId) || !gif) { detachCover(cov); return; }
  let player = gifPlayers.get(cov.url);
  if (!player) {
    player = makeGifPlayer(cov.url, gif);
    if (!player) { detachCover(cov); return; }
    gifPlayers.set(cov.url, player);
  }
  player.covers.add(cov.sourceId);
  cov.player = player;
  cov.started = true;
  pushGifFrame(player);
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
            if (!swapSourceImage(cov.sourceId, cov.canvas)) detachCover(cov);
          }
        } else if (cov.kind === 'gif') {
          const player = cov.player;
          if (!player || !player.frames) { detachCover(cov); continue; }
          if (player.ticked === now) continue;
          player.ticked = now;
          let someone = false;
          for (const other of mediaCovers.values()) {
            if (other.player !== player) continue;
            try {
              if (other.inView && map.getLayer(other.layerId)
                && map.getLayoutProperty(other.layerId, 'visibility') === 'visible') someone = true;
            } catch { /* layer already gone */ }
          }
          if (!someone) { player.nextFrameAt = now; continue; }
          any = true;
          if (now < player.nextFrameAt) continue;
          player.idx = (player.idx + 1) % player.frames.length;
          if (!compositeGifFrame(player, player.idx)) { freezeGif(player); continue; }
          pushGifFrame(player);
          player.nextFrameAt = now + Math.max(GIF_MIN_DELAY_MS, player.frames[player.idx].delay || 0);
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
        // Placeholder until the shared still (or the animation) replaces it.
        // The still is not gated on the in-view test, so a phone whose
        // canvas size disagrees with the window still shows the picture.
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
      if (kind === 'gif') paintGifStill(sourceId, coverUrl);
  
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

