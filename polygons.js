import { DEFAULT_AVATAR, attachHashinalFallback, resolveHashinalSrc } from './hashinalurl.js';
import { perfJob } from './perf.js';
import { applyAllStyles } from './loadprofilepopup';
import { scene } from "./threejs";
import maplibregl from 'maplibre-gl';
import { animateMapTo } from './animatemapto';
import { popupSideFor } from './popupside.js';
import { classifyImageUrl, isGifUrl, loadImageBytes, needsGifCheck, resolveMediaUrl, siblingPosterUrl } from './mediaurl.js';
import { COVER_RELEASE_MS, coverBatteryIsLow, coverHoldSrc, coverIdsToRelease, coverScreenScore, coverShouldRelease, coverTooSmall, holdQueriesFor, lookupHolds, pickAutoplayCover, shouldAutoplayCover } from './coverautoplay.js';
import { gifStillCanvas } from './gifvideo.js';
import { currentUfoModelInGLTF, polygons } from './letall';
import { map } from './map'
import { cameraState, earthOccludes, moonScreen, onMoonScreen } from './moon.js';
import { activeMarkerPopups } from './marker';
import { polygonPopupNode } from './processallmessages.js';
import { CloseALL, changePopupState } from './cssLogic';
import { closeDrawAnchor } from './drawhere';
import { closePressAnchor, holdJustHappened, HOLD_MS, MOVE_TOLERANCE } from './poiinfo';
import { watchPolygonTilt, forgetPolygonTilt } from './polygontilt.js';
import { fillMapTip } from './maptip.js';
import { addMapTipSource } from './maptipclick.js';
import { prefetchPersonFollow } from './followtopic.js';
import { isPointerOnGlobe } from './onglobe.js';
import { advanceIpfsImage, armIpfsAttempt, clearIpfsAttempt, preferGateway } from './ipfsimage.js';
import { formatSliderValue, applySliderValueWidth } from './slidervalue.js';
import { COVER_VIDEO_MAX_SECONDS } from './covervideolimit.js';




export let addedLayers = new Set();

let polygonTitleTip = null;
let polygonTitleTimer = 0;
let polygonTitleFromTouch = false;
let polygonHoldTimer = 0;
let polygonHoldStart = null;

function clearPolygonHold() {
  clearTimeout(polygonHoldTimer);
  polygonHoldTimer = 0;
  polygonHoldStart = null;
}

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

function touchCount(e) {
  const src = e.originalEvent || e;
  if (src && src.touches) return src.touches.length;
  if (e.points) return e.points.length;
  return 1;
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
map.on("movestart", clearPolygonHold);

// A touch hold's card stays until the map moves (above) or the next press,
// here, as a dot's does (marker.js). The press that held it went down
// before the card showed (HOLD_MS later) and lifting it is no press, so
// only a later one closes it. A right-click card is maptipclick.js's.
document.addEventListener("pointerdown", () => {
  if (!polygonTitleTip || polygonTitleTip.hidden || !polygonTitleFromTouch) return;
  hidePolygonTitle();
}, true);

// A right-click on a polygon shows its pill at the pointer, unless a dot
// over it took the click first (maptipclick.js). The hit is the topmost
// polygon whose mask is drawn under the pointer, on the near side of the
// globe. Mask layer id -> polygon, from addPolygonWithImageFill.
const polygonTipLayers = new Map();

// Tap masks are most of the per-frame draws while the camera moves. A drag
// cannot hit one, so each mask leaves the zoom range until moveend. moveend
// fires only after inertia has finished, so that is the real stop. The On/Off
// toggle and the Draw pick keep visibility, and the mask keeps fill-opacity 0.
// The zoom range is the same switch placeTiny() uses for pictures.
let masksParked = false;

function setMaskZoom(target, id, min, max) {
  try {
    if (target.getLayer(id)) target.setLayerZoomRange(id, min, max);
  } catch { /* the layer went with its source */ }
}

function onMaskMoveStart() {
  if (masksParked) return;
  masksParked = true;
  for (const id of polygonTipLayers.keys()) setMaskZoom(map, id, 24, 24);
}

function onMaskMoveEnd() {
  masksParked = false;
  for (const id of polygonTipLayers.keys()) setMaskZoom(map, id, 0, 24);
}

function parkFreshMask(target, id) {
  if (masksParked) setMaskZoom(target, id, 24, 24);
}

map.on("movestart", onMaskMoveStart);
map.on("moveend", onMaskMoveEnd);

addMapTipSource({
  rank: 1,
  hit(event) {
    const canvas = map.getCanvas();
    if (event.target !== canvas) return null;
    const layers = [...polygonTipLayers.keys()].filter((id) => map.getLayer(id));
    if (!layers.length) return null;
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    let features = [];
    try {
      features = map.queryRenderedFeatures([point.x, point.y], { layers });
    } catch {
      return null;
    }
    for (const feature of features) {
      const polygon = polygonTipLayers.get(feature.layer && feature.layer.id);
      if (!polygon || !isPointerOnGlobe(point, polygonRing(polygon))) continue;
      const at = { x: event.clientX, y: event.clientY };
      return () => {
        prefetchPersonFollow(polygon.payer);
        showPolygonTitle(polygon, at, false);
        return !!(polygonTitleTip && !polygonTitleTip.hidden);
      };
    }
    return null;
  },
  hide: hidePolygonTitle,
});

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
  // toBlob encodes the JPEG off the main thread. toDataURL encoded it on
  // it: each cover held the map still for a moment, and the map coming back
  // from the feed (or a pick) started many at once, so panning stuttered.
  // A tainted canvas still throws here, at once, as toDataURL did, so the
  // caller's one retry on the fallback keeps working.
  let settle = null;
  const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  canvas.toBlob((blob) => {
    if (blob) settle.resolve(URL.createObjectURL(blob));
    else settle.reject(new Error('cover encode'));
  }, 'image/jpeg', 0.92);
  return done;
}

function loadElementImage(imageUrl, maxWidth, maxHeight, fallbackUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.dataset.canvasImage = '1';
    // Our Hashinal route failing (the cover fallback) tries Kiloscribe.
    attachHashinalFallback(img);
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
  // A Hashinal link reads from our route (hashinalurl.js); Kiloscribe
  // sends no CORS header, so it cannot be a texture.
  imageUrl = resolveHashinalSrc(imageUrl);
  const key = `${imageUrl}|${maxWidth}|${maxHeight}`;
  const cached = resizedImageCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const url = preferGateway(imageUrl) || imageUrl;
    // The black map placeholder stays until this resolves. A GIF is frame 0
    // from the shared helper, never an <img> that can animate.
    // A check that could not run (a host without CORS, a network error) is
    // not a reason to drop the picture: it is loaded like a still. Only a
    // check that said GIF reads the bytes.
    if (url && (isGifUrl(url) || needsGifCheck(url)) && await classifyImageUrl(url) === true) {
      try {
        const buf = await loadImageBytes(url);
        const still = await gifStillCanvas(new File([buf], "cover.gif", { type: "image/gif" }));
        if (still) return rasterize(still, still.width, still.height, maxWidth, maxHeight);
      } catch {
        // The bytes cannot be read here: the element load below draws the
        // first frame instead.
      }
    }
    // A cover is a WebGL texture, which the browser only allows for a
    // picture its host shares with CORS. One it does not share (or a
    // tainted canvas) takes the fallback, as before.
    return loadElementImage(url, maxWidth, maxHeight, fallbackUrl);
  })();
  resizedImageCache.set(key, pending);
  pending.catch(() => {});
  return pending;
}

// ── Animated covers (video) ─────────────────────────────────────────────
// A MapLibre image source is a static texture. A hidden <video> is blitted
// onto a canvas and uploaded from there while one cover is playing.
// A GIF cover is frame 0 only. A cover that was converted to MP4 or WebM
// uses this path, including the 30s rewind.
//
// shouldAutoplayCover is the only hook that can start a cover. It stays
// false unless that polygon's topic set an autoplay NFT and the creator
// holds it. Save-Data, low battery, and reduced motion still refuse.
// In view, the texture is the uploaded
// poster, or frame 0 grabbed once and kept in memory. The video src stays
// unset until a tap. Off screen, a hidden tab, the feed, or another cover
// pauses it and gives the file back after a few seconds. The poster stays.
// In view = the map center is inside the source bbox, or a bbox corner
// projects inside the canvas (40px margin) and is not hidden by the Earth.
// Texture cap: 512² @ ~30 fps while playing.
const mediaCovers = new Map(); // sourceId → cover state
// Poster and frame-0 stills, keyed by the video URL. Survives a src release.
const stillCache = new Map();
const stillPending = new Map();
let coverBatteryLow = false;
// Still covers wait for the same in-view test. Until then the source shows
// the black placeholder.
const pendingCovers = new Map(); // sourceId → { url, corners, kind }
let pumpRunning = false;
let visTimer = null;
const VIDEO_FRAME_MS = 33; // ~30 fps texture uploads (2026-10-07, user asked for 30fps)
const COVER_FALLBACK = DEFAULT_AVATAR;
const D2R = Math.PI / 180;

// HMR: drop orphaned cover videos and play buttons left by a previous module instance
document.querySelectorAll('video[data-polygon-cover]').forEach((v) => v.remove());
document.querySelectorAll('.polygon-cover-play').forEach((el) => el.remove());

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

// --- One camera snapshot for every cover check --------------------------
// cameraState() (moon.js) unprojects the screen centre on the globe, and the
// canvas size is a layout read. Per cover, on every move event and moon
// frame, they were most of a low-zoom pan's main-thread time (the reads
// came right after the play buttons' style writes, so each forced a layout).
// Both depend only on the camera and the window: one snapshot serves every
// check until the camera moves, and each polygon keeps its projection for
// that snapshot (see placeOf).
let viewSize = null;
let viewSnap = null;
let viewSeq = 0;
// The window's size is a layout read too (cameraState uses it): a resize
// counts instead of reading it on every call.
let viewResizes = 0;
const viewResized = () => { viewSize = null; viewResizes += 1; };
map.on('resize', viewResized);
window.addEventListener('resize', viewResized);

function coverView() {
  let center = null;
  let key = '';
  try {
    center = map.getCenter();
    const pad = map.getPadding() || {};
    key = `${center.lng},${center.lat},${map.getZoom()},${map.getBearing()},${map.getPitch()},`
      + `${pad.top},${pad.right},${pad.bottom},${pad.left},${viewResizes}`;
  } catch {
    center = null;
    key = '';
  }
  if (viewSnap && key && viewSnap.key === key && viewSize) return viewSnap;
  // The canvas size is what MapLibre projects into. window.innerHeight
  // includes the phone URL bar, so a polygon on screen was treated as off
  // view and the cover never left its placeholder.
  if (!viewSize) {
    const canvas = map.getCanvas();
    viewSize = { w: canvas.clientWidth || window.innerWidth, h: canvas.clientHeight || window.innerHeight };
  }
  viewSnap = { key, seq: ++viewSeq, st: cameraState(), center, w: viewSize.w, h: viewSize.h };
  return viewSnap;
}

// --- Every polygon picture's place on screen ----------------------------
// sourceId → { sourceId, layerId, corners, seq, inView, box, finite, size,
// centerHidden, centerPoint, tiny, hidden }. Measured once per snapshot.
const coverPlaces = new Map();

function placeOf(sourceId, layerId, corners) {
  let place = coverPlaces.get(sourceId);
  if (!place) {
    place = { sourceId, layerId, corners, seq: 0, tiny: false, hidden: false };
    coverPlaces.set(sourceId, place);
  }
  place.layerId = layerId || place.layerId;
  place.corners = corners || place.corners;
  return place;
}

// In view when the map center sits inside the source bbox (the zoomed-in
// case — all four corners are off screen then) or a bbox corner projects
// inside the canvas (40px margin) without being hidden by the Earth. The
// same four projections give the box (the autoplay score and the play
// glass) and the size (too small to draw).
function measurePlace(place, view) {
  if (place.seq === view.seq) return place;
  place.seq = view.seq;
  const corners = place.corners;
  const minLng = Math.min(corners[0][0], corners[2][0]);
  const maxLng = Math.max(corners[1][0], corners[3][0]);
  const minLat = Math.min(corners[2][1], corners[3][1]);
  const maxLat = Math.max(corners[0][1], corners[1][1]);
  const center = view.center;
  const centerInside = !!(center && center.lng >= minLng && center.lng <= maxLng && center.lat >= minLat && center.lat <= maxLat);
  let inView = centerInside;
  let finite = true;
  let any = false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [lng, lat] of corners) {
    let p = null;
    try { p = map.project([lng, lat]); } catch { p = null; }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) finite = false;
    if (!p) continue;
    any = true;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (inView) continue;
    if (view.st && view.st.C) {
      const lr = lat * D2R;
      const gr = lng * D2R;
      const m = [Math.cos(lr) * Math.cos(gr), Math.cos(lr) * Math.sin(gr), Math.sin(lr)];
      if (earthOccludes(view.st.C, m)) continue;
    }
    if (p.x >= -40 && p.x <= view.w + 40 && p.y >= -40 && p.y <= view.h + 40) inView = true;
  }
  place.inView = inView;
  place.centerInside = centerInside;
  place.box = any ? { minX, minY, maxX, maxY } : null;
  place.finite = finite;
  // A picture around the map centre fills the view; one the camera cannot
  // place is never called small.
  place.size = centerInside || !finite || !any ? Infinity : Math.max(maxX - minX, maxY - minY);
  // The play button's spot: the bbox centre, unless the Earth hides it.
  const [cLng, cLat] = coverCenter(corners);
  place.centerHidden = coverCenterHidden(cLng, cLat, view.st);
  let point = null;
  if (!place.centerHidden) {
    try { point = map.project([cLng, cLat]); } catch { point = null; }
  }
  place.centerPoint = point;
  return place;
}

function coverInView(place, view) {
  return !!measurePlace(place, view).inView;
}

// Too small on screen to draw: the picture layer is skipped (a zoom range no
// zoom reaches, so MapLibre neither draws it nor prepares its source), its
// cover waits, and a video cover counts as off screen. Its tap mask stays.
// The zoom range is the polygons' own switch: the Draw pick and the On/Off
// toggle use visibility, the opacity slider raster-opacity.
function placeTiny(place, view) {
  measurePlace(place, view);
  place.tiny = coverTooSmall(place.size, Math.min(view.w, view.h), place.tiny);
  if (place.hidden !== place.tiny) {
    try {
      if (map.getLayer(place.layerId)) {
        map.setLayerZoomRange(place.layerId, place.tiny ? 24 : 0, 24);
        place.hidden = place.tiny;
      }
    } catch { /* the layer went with its source */ }
  }
  return place.tiny;
}

function coverTiny(cov) {
  return !!(cov && cov.place && cov.place.tiny);
}

// Every polygon's size against this camera. Cheap when the camera has not
// moved: each place is already measured for the snapshot.
function sizePass(view) {
  for (const [sid, place] of coverPlaces) {
    if (!map.getSource(sid)) {
      coverPlaces.delete(sid);
      continue;
    }
    placeTiny(place, view);
  }
}

// While the camera moves, sizes are checked at most this often, so a
// picture shows while zooming in, not only once the camera stops.
const SIZE_PASS_MS = 200;
let sizePassAt = 0;

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
  coverPlaces.delete(polygonId + '-source');
  addedLayers.delete(polygonId + '-mask-layer');
}

function detachCover(cov) {
  if (!cov) return;
  cov.dead = true;
  cov.playing = false;
  if (cov.releaseTimer) {
    clearTimeout(cov.releaseTimer);
    cov.releaseTimer = 0;
  }
  if (cov.btn) {
    cov.btn.remove();
    cov.btn = null;
  }
  if (cov.video) {
    try { cov.video.pause(); } catch { /* already idle */ }
    cov.video.removeAttribute('src');
    delete cov.video.dataset.coverSrc;
    delete cov.video.dataset.src;
    try { cov.video.load(); } catch { /* element is going away */ }
    cov.video.remove();
    cov.video = null;
  }
  mediaCovers.delete(cov.sourceId);
}

// Screen area of a cover. A polygon that contains the map center fills the
// view, so it outranks a corner sliver. The pure score lives in coverautoplay.
function coverVisibleScore(cov, view) {
  const corners = cov && cov.corners;
  if (!corners || corners.length < 4 || !cov.place) return 0;
  const place = measurePlace(cov.place, view);
  const canvas = { w: view.w, h: view.h };
  if (place.centerInside) return coverScreenScore({ centerInside: true }, canvas);
  if (!place.box) return 0;
  return coverScreenScore(place.box, canvas);
}

let holdRefresh = null;
function refreshCoverHolds() {
  if (holdRefresh) return;
  const onScreen = [];
  for (const cov of mediaCovers.values()) {
    if (!cov.inView || !cov.polygon) continue;
    onScreen.push(cov.polygon);
  }
  const queries = holdQueriesFor(onScreen);
  if (!queries.length) return;
  holdRefresh = lookupHolds(queries).then(() => {
    holdRefresh = null;
    visPass();
  }, () => {
    holdRefresh = null;
  });
}

// Re-check every cover against ONE camera snapshot; drop covers whose
// source was removed. Runs on moveend/zoomend and every second.
function visPass() {
  perfJob('visPass', () => visPassWork());
}

function visPassWork() {
  // The feed covers the map: no cover's visibility can change while it is
  // up, so the once-per-second projection pass over every cover is pure
  // waste (measured at 400ms+ on the phone). coverFeedWatch runs a full
  // pass the moment the map comes back.
  if (document.documentElement.classList.contains('feed-app')) return;
  if (mediaCovers.size === 0 && pendingCovers.size === 0 && coverPlaces.size === 0) { stopVisTimer(); return; }
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
  // One camera snapshot for the whole pass. When the camera has not moved
  // since the last one (the one-second timer while the map is still),
  // every polygon is already measured for it and nothing is projected.
  const view = coverView();
  sizePass(view);
  if (mediaCovers.size === 0 && pendingCovers.size === 0) { stopVisTimer(); return; }
  const viewer = readCoverViewer();
  const rows = [];
  let currentId = null;
  for (const cov of mediaCovers.values()) {
    cov.inView = coverInView(cov.place, view);
    if (cov.playing) currentId = cov.sourceId;
    // A cover too small to draw is off screen: it never wins autoplay.
    const eligible = coverOnScreen(cov) && !cov.userPaused && shouldAutoplayCover(cov.polygon, viewer);
    rows.push({ id: cov.sourceId, eligible, score: eligible ? coverVisibleScore(cov, view) : 0 });
  }
  const winner = pickAutoplayCover(rows, currentId);
  for (const cov of mediaCovers.values()) {
    settleCover(cov, viewer, !!winner && cov.sourceId === winner);
  }
  refreshCoverHolds();
  // Picking a Draw spot with the polygons put away (drawhere.js): their
  // covers wait, and load once they are on show again (this pass runs
  // every second and on each camera stop).
  if (coversPutAway()) {
    ensurePump();
    return;
  }
  for (const [sid, cov] of [...pendingCovers]) {
    // A picture too small to draw keeps waiting; it loads once it is not.
    if (cov.place && coverInView(cov.place, view) && !cov.place.tiny) {
      pendingCovers.delete(sid);
      startPendingCover(sid, cov); // its bytes start now
    }
  }
  ensurePump();
}

// The Draw pick hides polygon pictures until its eye button shows them.
function coversPutAway() {
  const shell = document.documentElement.classList;
  return shell.contains('is-draw-picking') && !shell.contains('is-pick-posts');
}

function stopVisTimer() {
  if (visTimer) { clearInterval(visTimer); visTimer = null; }
}

function ensureVisTimer() {
  if (visTimer || (mediaCovers.size === 0 && pendingCovers.size === 0)) return;
  visTimer = setInterval(visPass, 1000);
}

// Queue a still cover until the polygon is on screen and big enough to
// draw. Both at queue time → begin now; otherwise visPass checks it on
// every camera change and every second.
function queueCoverLoad(sourceId, url, corners, kind = 'still', place = null) {
  const old = pendingCovers.get(sourceId);
  if (old) old.dead = true; // its in-flight fetch must not apply anymore
  pendingCovers.delete(sourceId);
  const cov = { url, corners, kind, place: place || placeOf(sourceId, sourceId.replace(/-source$/, '-image-layer'), corners) };
  const view = coverView();
  if (!coversPutAway() && cov.place && coverInView(cov.place, view) && !placeTiny(cov.place, view)) {
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

const COVER_VIDEO_STYLE = 'position: fixed; left: -10px; top: -10px; width: 2px; height: 2px; opacity: 0; pointer-events: none;';

function coverFeedOpen() {
  return document.documentElement.classList.contains('feed-app');
}

function coverLayerOn(cov) {
  try {
    return !!map.getLayer(cov.layerId)
      && map.getLayoutProperty(cov.layerId, 'visibility') === 'visible';
  } catch {
    return false;
  }
}

// Too small to draw counts as off screen: no autoplay, a playing cover
// pauses on its frame, its play button hides.
function coverOnScreen(cov) {
  return !!cov.inView && !coverTiny(cov) && !document.hidden && !coverFeedOpen() && coverLayerOn(cov);
}

function readCoverViewer() {
  const net = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  let reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    reducedMotion = false;
  }
  return {
    saveData: !!(net && net.saveData),
    lowBattery: coverBatteryLow,
    reducedMotion,
  };
}

function watchCoverBattery() {
  const getBattery = navigator.getBattery;
  if (typeof getBattery !== 'function') return;
  Promise.resolve().then(() => getBattery.call(navigator)).then((battery) => {
    if (!battery) return;
    const apply = () => { coverBatteryLow = coverBatteryIsLow(battery); };
    apply();
    battery.addEventListener('levelchange', apply);
    battery.addEventListener('chargingchange', apply);
  }).catch(() => {});
}
watchCoverBattery();

function coverHoldState(cov) {
  return {
    hasSrc: !!(cov.video && cov.video.dataset.coverSrc),
    playing: !!cov.playing,
    replaced: !!cov.forceRelease,
    hidden: document.hidden,
    feed: coverFeedOpen(),
    inView: !!cov.inView && !coverTiny(cov) && coverLayerOn(cov),
  };
}

function syncCoverHold(cov) {
  const state = coverHoldState(cov);
  if (!state.hasSrc || coverHoldSrc(state)) {
    if (cov.releaseTimer) {
      clearTimeout(cov.releaseTimer);
      cov.releaseTimer = 0;
    }
    return;
  }
  if (cov.releaseTimer) return;
  cov.releaseSince = Date.now();
  cov.releaseTimer = setTimeout(() => {
    cov.releaseTimer = 0;
    if (coverHoldSrc(coverHoldState(cov))) return;
    if (!coverShouldRelease(cov.releaseSince, Date.now())) return;
    releaseCoverSrc(cov);
  }, COVER_RELEASE_MS);
}

function releaseCoverSrc(cov) {
  if (!cov || cov.dead) return;
  if (cov.releaseTimer) {
    clearTimeout(cov.releaseTimer);
    cov.releaseTimer = 0;
  }
  cov.playing = false;
  cov.forceRelease = false;
  const video = cov.video;
  if (video) {
    try { video.pause(); } catch { /* idle */ }
    video.removeAttribute('src');
    delete video.dataset.coverSrc;
    delete video.dataset.src;
    try { video.load(); } catch { /* already clear */ }
  }
  const still = stillCache.get(cov.url) || cov.still;
  if (still) paintCoverStill(cov, still);
  syncCoverButton(cov);
}

function armCoverRelease(cov) {
  cov.playing = false;
  cov.userPaused = false;
  cov.autoStarted = false;
  cov.forceRelease = true;
  if (cov.video && !cov.video.paused) {
    try { cov.video.pause(); } catch { /* idle */ }
  }
  syncCoverHold(cov);
  syncCoverButton(cov);
}

function allocBlit(cov) {
  if (cov.canvas && cov.ctx) return;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  cov.canvas = canvas;
  cov.ctx = canvas.getContext('2d');
}

function paintCoverStill(cov, still) {
  if (!still || cov.dead) return false;
  if (!map.getSource(cov.sourceId)) return false;
  if (still.kind === 'url') {
    try {
      const src = map.getSource(cov.sourceId);
      if (!src || typeof src.updateImage !== 'function') return false;
      src.updateImage({ url: still.url });
      cov.still = still;
      cov.stillReady = true;
      return true;
    } catch {
      return false;
    }
  }
  allocBlit(cov);
  try {
    const source = still.kind === 'canvas' ? still.canvas : still.image;
    cov.ctx.drawImage(source, 0, 0, 512, 512);
    cov.still = still;
    cov.stillReady = !!swapSourceImage(cov.sourceId, cov.canvas);
    return cov.stillReady;
  } catch {
    if (!still.url) return false;
    return paintCoverStill(cov, { kind: 'url', url: still.url });
  }
}

function probePoster(posterUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = posterUrl;
  });
}

// One metadata load, seek to frame 0, draw, then drop src. The canvas stays
// in stillCache. A later view does not download the file again.
function grabCoverFrame(url) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.setAttribute('data-polygon-cover', 'frame');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'metadata';
    video.style.cssText = COVER_VIDEO_STYLE;
    let settled = false;
    let asked = false;
    let timer = 0;
    const finish = (still) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      try { video.load(); } catch { /* already clear */ }
      video.remove();
      resolve(still || null);
    };
    const draw = () => {
      if (settled || !asked || video.readyState < 2) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        canvas.getContext('2d').drawImage(video, 0, 0, 512, 512);
        finish({ kind: 'canvas', canvas });
      } catch {
        finish(null);
      }
    };
    video.addEventListener('loadedmetadata', () => {
      asked = true;
      try { video.currentTime = 0; } catch { draw(); }
      if (video.currentTime === 0 && video.readyState >= 2) draw();
    }, { once: true });
    video.addEventListener('seeked', draw);
    video.addEventListener('loadeddata', draw);
    video.addEventListener('error', () => finish(null), { once: true });
    timer = setTimeout(() => finish(null), 8000);
    document.body.appendChild(video); // iOS only decodes videos in the DOM
    video.src = url;
  });
}

function loadCoverStill(url) {
  if (!url) return Promise.resolve({ kind: 'url', url: COVER_FALLBACK });
  const cached = stillCache.get(url);
  if (cached) return Promise.resolve(cached);
  const pending = stillPending.get(url);
  if (pending) return pending;
  const job = (async () => {
    const poster = siblingPosterUrl(url);
    if (poster) {
      const image = await probePoster(poster);
      if (image) return { kind: 'image', image, url: poster };
    }
    const frame = await grabCoverFrame(url);
    if (frame) return frame;
    return { kind: 'url', url: COVER_FALLBACK };
  })();
  stillPending.set(url, job);
  job.then((still) => { stillCache.set(url, still); }).finally(() => { stillPending.delete(url); });
  return job;
}

function ensureCoverStill(cov) {
  if (!cov || cov.dead || cov.stillReady || cov.grabbing || !cov.url) return;
  // Too small to draw: the poster or frame grab waits too.
  if (!cov.inView || coverTiny(cov) || document.hidden || coverFeedOpen()) return;
  cov.grabbing = true;
  const token = cov;
  loadCoverStill(cov.url).then((still) => {
    if (mediaCovers.get(token.sourceId) !== token || token.dead) return;
    if (token.playing || (token.userPaused && token.frameDrawn)) {
      token.still = still;
      return;
    }
    paintCoverStill(token, still);
  }).catch(() => {
    if (mediaCovers.get(token.sourceId) !== token || token.dead || token.playing) return;
    paintCoverStill(token, { kind: 'url', url: COVER_FALLBACK });
  }).finally(() => {
    if (mediaCovers.get(token.sourceId) === token) token.grabbing = false;
  });
}

function ensureCoverVideo(cov) {
  if (cov.video) return cov.video;
  const video = document.createElement('video');
  video.setAttribute('data-polygon-cover', cov.sourceId);
  video.crossOrigin = 'anonymous'; // R2 objects carry CORS (set at upload)
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute('muted', '');
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'metadata';
  video.style.cssText = COVER_VIDEO_STYLE;
  document.body.appendChild(video); // iOS only decodes videos in the DOM
  allocBlit(cov);
  cov.video = video;
  cov.lastFrameAt = 0;
  video.addEventListener('error', () => {
    if (!cov.playing || cov.video !== video) return;
    cov.playing = false;
    cov.userPaused = true;
    if (!stillCache.has(cov.url)) stillCache.set(cov.url, { kind: 'url', url: COVER_FALLBACK });
    releaseCoverSrc(cov);
  });
  return video;
}

function playCover(cov, auto) {
  if (!cov || cov.dead || !cov.url) return;
  if (!map.getSource(cov.sourceId)) { detachCover(cov); return; }
  const busy = [];
  for (const other of mediaCovers.values()) {
    if (other === cov) continue;
    if (other.playing || (other.video && other.video.dataset.coverSrc)) busy.push(other.sourceId);
  }
  for (const id of coverIdsToRelease(busy, cov.sourceId)) {
    const other = mediaCovers.get(id);
    if (other) armCoverRelease(other);
  }
  const video = ensureCoverVideo(cov);
  if (video.dataset.coverSrc !== cov.url) {
    video.dataset.src = cov.url;
    video.src = cov.url;
    video.dataset.coverSrc = cov.url;
  }
  cov.playing = true;
  cov.userPaused = false;
  cov.autoStarted = !!auto;
  cov.forceRelease = false;
  if (cov.releaseTimer) {
    clearTimeout(cov.releaseTimer);
    cov.releaseTimer = 0;
  }
  const pending = video.play();
  if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  syncCoverButton(cov);
  ensurePump();
}

function toggleCoverPlay(cov) {
  if (!cov || cov.dead) return;
  if (cov.playing) {
    cov.playing = false;
    cov.userPaused = true;
    cov.autoStarted = false;
    cov.forceRelease = false;
    if (cov.releaseTimer) {
      clearTimeout(cov.releaseTimer);
      cov.releaseTimer = 0;
    }
    if (cov.video && !cov.video.paused) {
      try { cov.video.pause(); } catch { /* idle */ }
    }
    syncCoverButton(cov);
    return;
  }
  playCover(cov);
}

function settleCover(cov, viewer, allowAutoplay) {
  if (!coverOnScreen(cov)) {
    if (cov.playing) {
      cov.playing = false;
      cov.autoStarted = false;
      if (cov.video && !cov.video.paused) {
        try { cov.video.pause(); } catch { /* idle */ }
      }
    }
  } else if (!allowAutoplay && cov.playing && cov.autoStarted) {
    armCoverRelease(cov);
  } else if (allowAutoplay && !cov.playing && !cov.userPaused && shouldAutoplayCover(cov.polygon, viewer || readCoverViewer())) {
    playCover(cov, true);
  } else if (!cov.playing && !cov.userPaused && !cov.stillReady && !cov.grabbing) {
    ensureCoverStill(cov);
  }
  syncCoverHold(cov);
  syncCoverButton(cov);
  placeCoverButton(cov);
}

function coverCenter(corners) {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const pair of corners || []) {
    const lng = pair[0];
    const lat = pair[1];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

function coverCenterHidden(lng, lat, st) {
  if (!st || !st.C) return false;
  const lr = lat * D2R;
  const gr = lng * D2R;
  const m = [Math.cos(lr) * Math.cos(gr), Math.cos(lr) * Math.sin(gr), Math.sin(lr)];
  return earthOccludes(st.C, m);
}

function ensureCoverButton(cov) {
  if (cov.btn) return cov.btn;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'polygon-cover-play';
  btn.dataset.cover = cov.sourceId;
  btn.hidden = true;
  btn.setAttribute('aria-label', 'Play cover');
  btn.innerHTML = '<span class="polygon-cover-play-glass" aria-hidden="true">'
    + '<svg class="polygon-cover-play-icon" viewBox="0 0 24 24" focusable="false">'
    + '<path class="is-play" d="M9 6.2v11.6l9.2-5.8z" fill="#22D3EE"></path>'
    + '<path class="is-pause" d="M7 5.5h3.2v13H7zm6.8 0H17v13h-3.2z" fill="#22D3EE"></path>'
    + '</svg></span>';
  btn.addEventListener('pointerdown', (event) => { event.stopPropagation(); });
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleCoverPlay(cov);
  });
  map.getContainer().appendChild(btn);
  cov.btn = btn;
  return btn;
}

function syncCoverButton(cov) {
  const btn = cov.btn;
  if (!btn) return;
  const playing = !!cov.playing;
  btn.classList.toggle('is-playing', playing);
  btn.setAttribute('aria-label', playing ? 'Pause cover' : 'Play cover');
}

// The full play glass in px, as style.css sizes it: 2.6 × --fu, where --fu
// is 2.4% of the smaller of the viewport width and --app-h.
function coverFu() {
  const appH = parseFloat(document.documentElement.style.getPropertyValue('--app-h')) || window.innerHeight;
  const w = document.documentElement.clientWidth || window.innerWidth;
  return Math.min(w, appH) * 0.024;
}

// fu: the snapshot's (coverView), so a pass reads the layout once.
function coverGlassPx(fu = coverFu()) {
  return fu * 2.6;
}

// The button's box: style.css .polygon-cover-play, max(44px, --fu * 3.6).
function coverHitPx(fu = coverFu()) {
  return Math.max(44, fu * 3.6);
}

// The play glass shrinks with its cover as the map zooms out: at most 45% of
// the cover's shorter on-screen side, never under 14px, never above its CSS
// size. Only the glass scales; the button around it, the tap area, keeps
// its full size (coverHitPx), so a small cover is still easy to start.
const COVER_PLAY_MIN_PX = 14;
const COVER_PLAY_SHARE = 0.45;
function coverPlayScale(cov, full, view) {
  if (!(full > 0) || !cov.place) return 1;
  const place = measurePlace(cov.place, view);
  if (!place.finite || !place.box) return 1;
  const { minX, maxX, minY, maxY } = place.box;
  const side = Math.min(maxX - minX, maxY - minY);
  const px = Math.min(full, Math.max(COVER_PLAY_MIN_PX, side * COVER_PLAY_SHARE));
  return px / full;
}

// Wherever the moon shows it is in front of the globe (moon.js hides it
// once the Earth is between it and the camera). Any overlap hides the
// button: the moon lets clicks through and leaves buttons alone, so a
// button under its edge would still start a video nobody can see.
function underMoon(x, y, r) {
  const m = moonScreen;
  if (!m || !(m.half > 0)) return false;
  const reach = m.half + r;
  const dx = x - m.x;
  const dy = y - m.y;
  return dx * dx + dy * dy < reach * reach;
}

function placeCoverButton(cov) {
  if (!coverOnScreen(cov) || !cov.place) {
    if (cov.btn) cov.btn.hidden = true;
    return;
  }
  const view = coverView();
  const place = measurePlace(cov.place, view);
  if (place.centerHidden) {
    if (cov.btn) cov.btn.hidden = true;
    return;
  }
  const point = place.centerPoint;
  const w = view.w;
  const h = view.h;
  if (!point || point.x < 0 || point.y < 0 || point.x > w || point.y > h) {
    if (cov.btn) cov.btn.hidden = true;
    return;
  }
  if (!(view.fu > 0)) view.fu = coverFu();
  const full = coverGlassPx(view.fu);
  const scale = coverPlayScale(cov, full, view);
  // The whole tap area counts: one under the moon's edge would still start
  // a video nobody can see.
  if (underMoon(point.x, point.y, coverHitPx(view.fu) / 2)) {
    if (cov.btn) cov.btn.hidden = true;
    return;
  }
  const btn = ensureCoverButton(cov);
  btn.hidden = false;
  btn.style.left = `${point.x}px`;
  btn.style.top = `${point.y}px`;
  btn.style.setProperty('--cover-play-scale', scale.toFixed(3));
  syncCoverButton(cov);
}

// Many covers can register in one turn. One visPass on the next frame
// sees all of them. A pass that is already queued is left in place.
let visPassFrame = 0;
function scheduleVisPass() {
  if (visPassFrame) return;
  visPassFrame = requestAnimationFrame(() => {
    visPassFrame = 0;
    visPass();
  });
}

// Register a video cover. The file stays unloaded until a tap. In view, the
// texture becomes the poster or a cached frame 0. A topic reload drops the
// previous entry so a stale video cannot block the new one.
function registerCover(sourceId, layerId, url, corners, polygon) {
  const stale = mediaCovers.get(sourceId);
  if (stale) detachCover(stale);
  const cov = {
    kind: 'video',
    sourceId,
    layerId,
    url,
    corners,
    polygon,
    inView: false,
    playing: false,
    userPaused: false,
    autoStarted: false,
    forceRelease: false,
    stillReady: false,
    grabbing: false,
    releaseTimer: 0,
    place: placeOf(sourceId, layerId, corners),
  };
  cov.inView = coverInView(cov.place, coverView());
  mediaCovers.set(sourceId, cov);
  ensureVisTimer();
  scheduleVisPass();
}

// The shared pump blits only the cover that is playing. Off-view, hidden,
// and feed covers pause here and give the file back after the release window.
function ensurePump() {
  if (pumpRunning) return;
  let playing = false;
  for (const cov of mediaCovers.values()) if (cov.playing) playing = true;
  if (!playing) return;
  pumpRunning = true;
  const tick = (now) => {
    let any = false;
    for (const cov of mediaCovers.values()) {
      try {
        if (!cov.playing || !cov.video) continue;
        if (!coverOnScreen(cov)) {
          cov.playing = false;
          if (!cov.video.paused) {
            try { cov.video.pause(); } catch { /* idle */ }
          }
          syncCoverHold(cov);
          syncCoverButton(cov);
          placeCoverButton(cov);
          continue;
        }
        if (cov.video.currentTime >= COVER_VIDEO_MAX_SECONDS) cov.video.currentTime = 0;
        if (cov.video.paused) {
          if (!cov.video.getAttribute('src') && cov.video.dataset.src) cov.video.src = cov.video.dataset.src;
          const pending = cov.video.play();
          if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        }
        any = true;
        if (!cov.ctx || now - cov.lastFrameAt < VIDEO_FRAME_MS) continue;
        cov.lastFrameAt = now;
        if (cov.video.readyState >= 2) {
          cov.ctx.drawImage(cov.video, 0, 0, 512, 512);
          cov.frameDrawn = true;
          if (!swapSourceImage(cov.sourceId, cov.canvas)) detachCover(cov);
        }
      } catch (err) {
        console.error('polygon cover tick failed:', err);
        detachCover(cov);
      }
    }
    if (any) requestAnimationFrame(tick);
    else pumpRunning = false;
  };
  requestAnimationFrame(tick);
}

function pauseCoverForBlock(cov) {
  if (cov.playing) {
    cov.playing = false;
    if (cov.video && !cov.video.paused) {
      try { cov.video.pause(); } catch { /* idle */ }
    }
  }
  syncCoverHold(cov);
  syncCoverButton(cov);
  placeCoverButton(cov);
}

// On every move event: one snapshot for all covers. Sizes are checked at
// most every SIZE_PASS_MS, so pictures show while zooming in; a video cover
// too small to draw keeps its button hidden and is not projected per frame
// (the pump pauses one that was playing).
function trackCoverButtons() {
  if (mediaCovers.size === 0 && coverPlaces.size === 0) return;
  const view = coverView();
  const now = performance.now();
  if (now - sizePassAt >= SIZE_PASS_MS) {
    sizePassAt = now;
    sizePass(view);
  }
  for (const cov of mediaCovers.values()) {
    if (coverTiny(cov)) {
      if (cov.btn && !cov.btn.hidden) cov.btn.hidden = true;
      continue;
    }
    const was = cov.inView;
    cov.inView = coverInView(cov.place, view);
    if (was && !cov.inView) pauseCoverForBlock(cov);
    else {
      if (!was && cov.inView) syncCoverHold(cov);
      placeCoverButton(cov);
    }
  }
}

map.on('move', trackCoverButtons);
// The moon moves on the three.js frame, not on map move events.
onMoonScreen(() => {
  for (const cov of mediaCovers.values()) placeCoverButton(cov);
});
map.on('moveend', visPass);
map.on('zoomend', visPass);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    for (const cov of mediaCovers.values()) pauseCoverForBlock(cov);
    return;
  }
  visPass();
});

let coverFeedWas = document.documentElement.classList.contains('feed-app');
const coverFeedWatch = new MutationObserver(() => {
  const feed = document.documentElement.classList.contains('feed-app');
  if (feed === coverFeedWas) return;
  coverFeedWas = feed;
  if (feed) {
    for (const cov of mediaCovers.values()) pauseCoverForBlock(cov);
    return;
  }
  visPass();
});
coverFeedWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

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
      const coverUrl = resolveHashinalSrc((Array.isArray(polygon.imageUrl) ? polygon.imageUrl[0] : polygon.imageUrl) || '');
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

      parkFreshMask(map, maskLayerId);

      polygonTipLayers.set(maskLayerId, polygon);

      // Add interactivity (only if not already added)
      if (!addedLayers.has(maskLayerId)) {
        map.on('click', maskLayerId, (e) => {
          // Picking a spot for the Draw form (drawhere.js): the tap is a
          // coordinate, not a polygon open.
          if (document.documentElement.classList.contains('is-draw-picking')) return;
          // The tap that lifts a hold: the hold showed the title bubble
          // (poiinfo.js), so the post does not open, like a dot's hold.
          if (holdJustHappened()) return;
          if (kind === 'video') toggleCoverPlay(mediaCovers.get(sourceId));
          hidePolygonTitle();
          const description = polygonPopupNode(polygon);
          if (description) {
            const targetLngLat = e.lngLat.toArray()
            // A fresh popup per click: re-adding the same instance after an
            // outside-click close gets closed again by its own stale
            // closeOnClick listener (still in this click's listener list).
            const popup = new maplibregl.Popup({
              focusAfterOpen: false,
              anchor: popupSideFor(map, map.getCenter()),
            });
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
  
        // A hover only marks the polygon as clickable (and warms its follow
        // state). The title pill is a right-click's (maptipclick.js), which
        // stays until it is closed, or a touch's.
        map.on('mouseenter', maskLayerId, (e) => {
          const onGlobe = isPointerOnGlobe(e.point, polygonRing(polygon));
          map.getCanvas().style.cursor = onGlobe ? 'pointer' : '';
          if (onGlobe) prefetchPersonFollow(polygon.payer);
        });

        map.on('mousemove', maskLayerId, (e) => {
          map.getCanvas().style.cursor = isPointerOnGlobe(e.point, polygonRing(polygon)) ? 'pointer' : '';
        });

        map.on('mouseleave', maskLayerId, () => {
          map.getCanvas().style.cursor = '';
        });

        // The bubble waits for a still hold at the touch-start point.
        // A tap, a drag, a second finger or a pan never flashes it.
        map.on('touchstart', maskLayerId, (e) => {
          if (touchCount(e) !== 1) {
            clearPolygonHold();
            return;
          }
          if (!polygonHoverOnGlobe(e, polygon)) return;
          prefetchPersonFollow(polygon.payer);
          const point = eventPoint(e);
          if (!point) return;
          clearPolygonHold();
          polygonHoldStart = point;
          const at = point;
          polygonHoldTimer = setTimeout(() => {
            polygonHoldTimer = 0;
            polygonHoldStart = null;
            showPolygonTitle(polygon, at, true);
          }, HOLD_MS);
        });

        map.on('touchmove', maskLayerId, (e) => {
          if (!polygonHoldTimer || !polygonHoldStart) return;
          if (touchCount(e) !== 1) {
            clearPolygonHold();
            return;
          }
          const point = eventPoint(e);
          if (!point) return;
          if (Math.hypot(point.x - polygonHoldStart.x, point.y - polygonHoldStart.y) > MOVE_TOLERANCE) {
            clearPolygonHold();
          }
        });

        map.on('touchend', maskLayerId, () => {
          clearPolygonHold();
          // A touch hold's card stays open (the next press closes it).
          if (polygonTitleFromTouch) return;
          clearTimeout(polygonTitleTimer);
          polygonTitleTimer = setTimeout(hidePolygonTitle, 1200);
        });

        map.on('touchcancel', maskLayerId, () => {
          clearPolygonHold();
        });

        // Mark this layer as added
        addedLayers.add(maskLayerId);

        // A video cover shows a still until a tap. The file is not requested
        // until then. A raster cover downloads only once it is on screen and
        // big enough to draw. A GIF is frame 0. A picture too small to draw
        // is skipped from its first frame.
        // A fresh layer: a place left from a removed one would think it hidden.
        coverPlaces.delete(sourceId);
        const place = placeOf(sourceId, layerId, sourceCoordinates);
        placeTiny(place, coverView());
        if (kind === 'video') {
          registerCover(sourceId, layerId, coverPlayUrl(coverUrl), sourceCoordinates, polygon);
        } else {
          queueCoverLoad(sourceId, coverUrl, sourceCoordinates, 'still', place);
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

