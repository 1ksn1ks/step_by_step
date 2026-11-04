import { isTyping } from './joystick.js';
import { presentImage } from './loopmedia.js';
import { isGifUrl, needsGifCheck, resolveMediaUrl } from './mediaurl.js';
import { posterSrc } from './videoposter.js';

// One preview for every picture in the app (chat thumbnails, popup
// pictures, and the next place that needs it). Call openPreview. Add the
// next control in this file — callers only pass the source and options.
//
//   openPreview(src)
//   openPreview(src, { video: true })
//
// Backdrop tap, the ×, and Esc close it. A tap on the picture does not.
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
  unwatchPreview();
  overlay.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
  // Back/Forward: the ×, the backdrop and Esc all end here.
  layerClosedByUI('media');
}

function onKey(e) {
  if (isTyping(e.target)) return;
  if (e.key === 'Escape') closePreview();
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
    media.src = resolved.src;
    media.controls = true;
    media.playsInline = true;
    media.setAttribute('playsinline', '');
    media.autoplay = true;
    const poster = posterSrc(resolved.src, options);
    if (poster) media.poster = poster;
  }
  stage.appendChild(media);
  overlay.appendChild(stage);
  if (video) watchPreview(media);
  else {
    presentImage(media, raw);
    watchPreview(stage);
    stillWatch = new MutationObserver(() => placePreview());
    stillWatch.observe(stage, { childList: true, attributes: true, attributeFilter: ['src', 'class'] });
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'media-fullscreen-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closePreview();
  });
  overlay.appendChild(close);

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
    open: (state) => openPreview(state && state.src, { video: state && state.video === true }),
    close: () => closePreview(),
  });
}

export function closeMediaFullscreen() {
  closePreview();
}
