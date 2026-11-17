import { isTyping } from './joystick.js';
import { presentImage } from './loopmedia.js';
import { preferGateway } from './ipfsimage.js';
import { isGifUrl, needsGifCheck, resolveMediaUrl } from './mediaurl.js';
import { posterSrc, watchVideoFace } from './videoposter.js';

// One preview for every picture in the app (chat thumbnails, popup
// pictures, and the next place that needs it). Call openPreview. Add the
// next control in this file — callers only pass the source and options.
//
//   openPreview(src)
//   openPreview(src, { video: true })
//   openPreview(src, { video: true, time: 12.5 })   start the video there
//   openGallery([src, src, ...], 1)                 a post's pictures, at the 2nd
//
// Backdrop tap, the ×, Esc and Back close it. A tap on the picture does not.
// In a gallery a swipe, the ‹ › buttons and the arrow keys move between
// the pictures, and the counter reads "2 / 4".
//
// The overlay itself is the stylesheet's edge-to-edge frame. The picture
// stays inside the visible screen. On a phone, 100vh is the tall layout
// viewport (the area behind the address bar). A picture sized to that box
// is taller than what the user can see, and some phones then never paint
// it. visualViewport is the area that is actually on screen. The picture
// uses most of that area, with a margin so the × stays clear.
let overlay = null;
let fitted = null;
let onFit = null;
let stillWatch = null;

const PREVIEW_WIDTH = 0.92;
const PREVIEW_HEIGHT = 0.84;

function placePreview() {
  if (!overlay || !fitted) return;
  const view = window.visualViewport;
  const width = view && view.width ? view.width : window.innerWidth;
  const height = view && view.height ? view.height : window.innerHeight;
  const maxWidth = Math.max(1, Math.floor(width * PREVIEW_WIDTH)) + 'px';
  const maxHeight = Math.max(1, Math.floor(height * PREVIEW_HEIGHT)) + 'px';
  const stage = fitted.classList && fitted.classList.contains('media-preview-stage');
  const nodes = stage ? fitted.querySelectorAll('canvas, img, video') : [fitted];
  nodes.forEach((node) => {
    node.style.maxWidth = maxWidth;
    node.style.maxHeight = maxHeight;
  });
}

function watchPreview(media) {
  fitted = media;
  onFit = () => placePreview();
  placePreview();
  window.addEventListener('resize', onFit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onFit);
    window.visualViewport.addEventListener('scroll', onFit);
  }
}

function unwatchPreview() {
  if (onFit) {
    window.removeEventListener('resize', onFit);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onFit);
      window.visualViewport.removeEventListener('scroll', onFit);
    }
  }
  onFit = null;
  fitted = null;
}

export function closePreview() {
  if (!overlay) return;
  if (stillWatch) {
    stillWatch.disconnect();
    stillWatch = null;
  }
  const back = gallery && gallery.returnFocus;
  if (gallery) clearTimeout(gallery.slideTimer);
  gallery = null;
  unwatchPreview();
  overlay.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
  // The gallery took focus so the arrow keys were its own; the tile or
  // badge that opened it gets it back.
  if (back && back.isConnected && typeof back.focus === 'function') {
    try { back.focus({ preventScroll: true }); } catch { /* gone */ }
  }
  // Back/Forward: the ×, the backdrop and Esc all end here.
  layerClosedByUI('media');
}

function onKey(e) {
  if (isTyping(e.target)) return;
  if (e.key === 'Escape') closePreview();
  if (!gallery) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    stepGallery(e.key === 'ArrowLeft' ? -1 : 1);
  }
}

function closeButton() {
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'media-fullscreen-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closePreview();
  });
  return close;
}

// --- Gallery ----------------------------------------------------------
// Only the picture on screen loads. The next one (in the direction of
// travel) is fetched ahead, unless the browser's Save-Data hint or the
// feed's Data saver switch (feedlayout.js, the same stored key) is on.
let gallery = null;
let swipeClickHold = false;
const prefetched = new Set();
const SVG_NS = 'http://www.w3.org/2000/svg';
// A release past this share of the screen's width turns the page.
const SWIPE_COMMIT = 0.18;
// px per ms: a quick flick turns the page however short it was.
const SWIPE_FLICK = 0.5;
const SLIDE_OUT_MS = 150;

function savingData() {
  try {
    if (navigator.connection && navigator.connection.saveData) return true;
  } catch {
    /* no Network Information API */
  }
  try {
    return localStorage.getItem('feed-setting-data') === 'on';
  } catch {
    return false;
  }
}

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// 2dvmin: a finger that moves less is a tap.
function swipeStart() {
  return Math.min(window.innerWidth, window.innerHeight) * 0.02;
}

function chevron(dir) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', dir === 'prev' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6');
  svg.appendChild(path);
  return svg;
}

function navButton(dir) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `media-gallery-nav is-${dir}`;
  button.setAttribute('aria-label', dir === 'prev' ? 'Previous image' : 'Next image');
  button.appendChild(chevron(dir));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    stepGallery(dir === 'prev' ? -1 : 1);
  });
  return button;
}

function prefetch(index) {
  if (!gallery || index < 0 || index >= gallery.list.length || savingData()) return;
  const url = gallery.list[index];
  if (prefetched.has(url)) return;
  prefetched.add(url);
  if (prefetched.size > 64) prefetched.delete(prefetched.values().next().value);
  const ahead = new Image();
  ahead.decoding = 'async';
  ahead.src = preferGateway(url) || url;
}

function paintGallery(index, delta) {
  const g = gallery;
  if (!g) return;
  g.index = index;
  presentImage(g.img, g.list[index], { play: true });
  g.img.alt = `Image ${index + 1} of ${g.list.length}`;
  g.counter.textContent = `${index + 1} / ${g.list.length}`;
  g.prev.disabled = index === 0;
  g.next.disabled = index === g.list.length - 1;
  prefetch(index + (delta < 0 ? -1 : 1));
}

function settleImage(img) {
  img.style.transition = '';
  img.style.transform = '';
  img.style.opacity = '';
}

function stepGallery(delta) {
  const g = gallery;
  if (!g) return;
  const to = g.index + delta;
  if (to < 0 || to >= g.list.length) {
    snapBack();
    return;
  }
  clearTimeout(g.slideTimer);
  const img = g.img;
  if (reducedMotion()) {
    settleImage(img);
    paintGallery(to, delta);
    return;
  }
  // Out the way the finger went, in from the other side. Percent is of the
  // picture's own width, so a narrow portrait shot slides as far as it is.
  img.style.transition = `transform ${SLIDE_OUT_MS}ms ease-in, opacity ${SLIDE_OUT_MS}ms ease-in`;
  img.style.transform = `translateX(${-delta * 24}%)`;
  img.style.opacity = '0';
  g.slideTimer = setTimeout(() => {
    if (gallery !== g) return;
    paintGallery(to, delta);
    img.style.transition = 'none';
    img.style.transform = `translateX(${delta * 24}%)`;
    void img.offsetWidth;
    img.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out';
    img.style.transform = '';
    img.style.opacity = '';
  }, SLIDE_OUT_MS);
}

function snapBack() {
  if (!gallery) return;
  const img = gallery.img;
  img.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
  img.style.transform = '';
}

// The finger drags the picture. Past SWIPE_COMMIT of the width, or a
// flick, the next one comes in; at either end it gives and springs back.
function bindGallerySwipe(el) {
  let start = null;
  let dragging = false;
  el.addEventListener('pointerdown', (event) => {
    if (!gallery || event.button !== 0) return;
    if (event.target.closest && event.target.closest('button')) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId, at: event.timeStamp };
    dragging = false;
  });
  el.addEventListener('pointermove', (event) => {
    if (!start || !gallery || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!dragging) {
      if (Math.abs(dx) < swipeStart() || Math.abs(dx) < Math.abs(dy)) return;
      dragging = true;
      try { el.setPointerCapture(event.pointerId); } catch { /* already released */ }
      clearTimeout(gallery.slideTimer);
      settleImage(gallery.img);
      gallery.img.style.transition = 'none';
    }
    const last = gallery.list.length - 1;
    const atEnd = (dx > 0 && gallery.index === 0) || (dx < 0 && gallery.index === last);
    gallery.img.style.transform = `translateX(${atEnd ? dx * 0.3 : dx}px)`;
  });
  const end = (event) => {
    if (!start || event.pointerId !== start.id) return;
    const from = start;
    const was = dragging;
    start = null;
    dragging = false;
    if (!was || !gallery) return;
    // The click that follows the release lands on the backdrop; it must
    // not close the viewer.
    swipeClickHold = true;
    setTimeout(() => { swipeClickHold = false; }, 0);
    if (event.type !== 'pointerup') {
      snapBack();
      return;
    }
    const dx = event.clientX - from.x;
    const width = el.clientWidth || window.innerWidth;
    const speed = Math.abs(dx) / Math.max(1, event.timeStamp - from.at);
    if (Math.abs(dx) > width * SWIPE_COMMIT || speed > SWIPE_FLICK) stepGallery(dx < 0 ? 1 : -1);
    else snapBack();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

export function openGallery(urls, index = 0) {
  const list = (Array.isArray(urls) ? urls : [])
    .map((url) => (typeof url === 'string' ? url.trim() : ''))
    .filter(Boolean);
  if (!list.length) return;
  if (list.length === 1) {
    openPreview(list[0]);
    return;
  }
  const at = Math.min(list.length - 1, Math.max(0, Math.floor(Number(index) || 0)));
  const opener = document.activeElement;
  closePreview();

  overlay = document.createElement('div');
  overlay.id = 'media-fullscreen';
  overlay.className = 'is-gallery';
  overlay.tabIndex = -1;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${list.length} images`);

  const stage = document.createElement('div');
  stage.className = 'media-preview-stage';
  const img = document.createElement('img');
  img.className = 'media-gallery-img';
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  stage.appendChild(img);
  overlay.appendChild(stage);

  const counter = document.createElement('div');
  counter.className = 'media-gallery-count';
  counter.setAttribute('aria-live', 'polite');
  const prev = navButton('prev');
  const next = navButton('next');
  overlay.append(prev, next, counter, closeButton());

  // A text field is not handed focus back (that would raise a phone's
  // keyboard over the page).
  const returnFocus = opener && opener !== document.body && !isTyping(opener) ? opener : null;
  gallery = { list, index: at, img, counter, prev, next, slideTimer: 0, returnFocus };
  paintGallery(at, 1);
  watchPreview(stage);
  stillWatch = new MutationObserver(() => placePreview());
  stillWatch.observe(stage, { childList: true, attributes: true, attributeFilter: ['src', 'class'] });
  bindGallerySwipe(overlay);

  overlay.addEventListener('click', (event) => {
    if (swipeClickHold) return;
    if (event.target === overlay || event.target === stage) closePreview();
  });

  document.body.appendChild(overlay);
  // Focus moves in, so ← → and Esc reach the gallery, not the tile or
  // field under it.
  try { overlay.focus({ preventScroll: true }); } catch { /* not focusable */ }
  document.addEventListener('keydown', onKey);
  // Back closes it. Moving between pictures adds no history; Forward
  // reopens the gallery at the picture it was opened on.
  layerOpened('media', { src: list[at], video: false, gallery: list, index: at });
}

export function openPreview(src, options = {}) {
  if (!src) return;
  const resolved = resolveMediaUrl(src);
  const raw = String(src).trim();
  const gifLike = isGifUrl(raw) || needsGifCheck(raw);
  const video = options.video === true || resolved.kind === 'video';
  if (video && !resolved.src) return;
  if (!video && !resolved.src && !gifLike) return;
  closePreview();

  overlay = document.createElement('div');
  overlay.id = 'media-fullscreen';

  const stage = document.createElement('div');
  stage.className = 'media-preview-stage';
  const media = video ? document.createElement('video') : document.createElement('img');
  if (video) {
    media.dataset.src = resolved.src;
    media.src = resolved.src;
    media.controls = true;
    media.playsInline = true;
    media.setAttribute('playsinline', '');
    media.autoplay = true;
    const poster = posterSrc(resolved.src, options);
    if (poster) media.poster = poster;
    // The feed's fullscreen button carries on from where the card was.
    const start = Number(options.time);
    if (Number.isFinite(start) && start > 0) {
      media.addEventListener('loadedmetadata', () => {
        try {
          if (start < media.duration) media.currentTime = start;
        } catch {
          /* not seekable yet */
        }
      }, { once: true });
    }
    watchVideoFace(media);
    const pending = media.play();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  }
  stage.appendChild(media);
  overlay.appendChild(stage);
  if (video) watchPreview(media);
  else {
    // A GIF animates here as a normal picture (a still with reduced motion).
    presentImage(media, raw, { play: true });
    watchPreview(stage);
    stillWatch = new MutationObserver(() => placePreview());
    stillWatch.observe(stage, { childList: true, attributes: true, attributeFilter: ['src', 'class'] });
  }

  overlay.appendChild(closeButton());

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closePreview();
  });

  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  // Back/Forward: the preview is a layer; Forward re-opens the same media.
  layerOpened('media', { src, video });
}

// Older name. Same preview.
export function openMediaFullscreen(src, isVideo = false) {
  openPreview(src, { video: !!isVideo });
}

if (window.defineLayer) {
  window.defineLayer('media', {
    open: (state) => {
      if (state && Array.isArray(state.gallery)) openGallery(state.gallery, state.index);
      else openPreview(state && state.src, { video: state && state.video === true });
    },
    close: () => closePreview(),
  });
}

export function closeMediaFullscreen() {
  closePreview();
}
