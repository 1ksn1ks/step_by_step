// Tap-to-fullscreen for popup media — a fixed black overlay holds the
// image/video at full viewport size. Tapping the backdrop or the × closes
// it; Esc works on desktop. Sits above every panel (max z-index in use: 10000).
let overlay = null;

export function closeMediaFullscreen() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
}

function onKey(e) {
  if (e.key === 'Escape') closeMediaFullscreen();
}

export function openMediaFullscreen(src, isVideo = false) {
  closeMediaFullscreen();
  overlay = document.createElement('div');
  overlay.id = 'media-fullscreen';

  const media = isVideo ? document.createElement('video') : document.createElement('img');
  media.src = src;
  if (isVideo) {
    media.controls = true;
    media.playsInline = true;
    media.autoplay = true;
  }
  // Tapping the media itself does nothing — only the backdrop closes, so a
  // reach for the edge can't dismiss while inspecting the picture.
  overlay.appendChild(media);

  const close = document.createElement('button');
  close.className = 'media-fullscreen-close';
  close.textContent = '×';
  close.addEventListener('click', closeMediaFullscreen);
  overlay.appendChild(close);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMediaFullscreen();
  });

  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
}
