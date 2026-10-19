import { isTyping } from './joystick.js';

// One preview for every picture in the app (chat thumbnails, popup
// pictures, and the next place that needs it). Call openPreview. Add the
// next control in this file — callers only pass the source and options.
//
//   openPreview(src)
//   openPreview(src, { video: true })
//
// Backdrop tap, the ×, and Esc close it. A tap on the picture does not.
//
// The picture stays inside the visible screen. On a phone, 100vh is the
// tall layout viewport (the area behind the address bar). A picture sized
// to that box is taller than what the user can see, and some phones then
// never paint it. visualViewport is the area that is actually on screen.
// The picture uses most of that area, with a margin so the × stays clear.
let overlay = null;
let fitted = null;
let onFit = null;

const PREVIEW_WIDTH = 0.92;
const PREVIEW_HEIGHT = 0.84;

function placePreview() {
  if (!overlay || !fitted) return;
  const view = window.visualViewport;
  const width = view && view.width ? view.width : window.innerWidth;
  const height = view && view.height ? view.height : window.innerHeight;
  if (view) {
    overlay.style.top = view.offsetTop + 'px';
    overlay.style.left = view.offsetLeft + 'px';
  }
  overlay.style.width = Math.max(1, Math.floor(width)) + 'px';
  overlay.style.height = Math.max(1, Math.floor(height)) + 'px';
  fitted.style.maxWidth = Math.max(1, Math.floor(width * PREVIEW_WIDTH)) + 'px';
  fitted.style.maxHeight = Math.max(1, Math.floor(height * PREVIEW_HEIGHT)) + 'px';
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
  unwatchPreview();
  overlay.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
}

function onKey(e) {
  if (isTyping(e.target)) return;
  if (e.key === 'Escape') closePreview();
}

export function openPreview(src, options = {}) {
  if (!src) return;
  closePreview();
  const video = options.video === true;

  overlay = document.createElement('div');
  overlay.id = 'media-fullscreen';

  const stage = document.createElement('div');
  stage.className = 'media-preview-stage';
  const media = video ? document.createElement('video') : document.createElement('img');
  media.src = src;
  if (video) {
    media.controls = true;
    media.playsInline = true;
    media.autoplay = true;
  }
  stage.appendChild(media);
  overlay.appendChild(stage);
  watchPreview(media);

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
}

// Older name. Same preview.
export function openMediaFullscreen(src, isVideo = false) {
  openPreview(src, { video: !!isVideo });
}

export function closeMediaFullscreen() {
  closePreview();
}
