import maplibregl from 'maplibre-gl';

// Animate popup close: play the shrink+fade (.closing class, popupOut keyframes
// in style.css), then let MapLibre actually remove the popup.
const CLOSE_MS = 150;
const originalClose = maplibregl.Popup.prototype.close;
const originalRemove = maplibregl.Popup.prototype.remove;

function startClose(popup, original) {
  const el = typeof popup.getElement === 'function' ? popup.getElement() : null;
  const content = el ? el.querySelector('.maplibregl-popup-content') : null;
  if (content && !content.classList.contains('closing')) {
    content.classList.add('closing');
    setTimeout(() => original.call(popup), CLOSE_MS);
    return popup;
  }
  original.call(popup);
  return popup;
}

maplibregl.Popup.prototype.close = function () {
  return startClose(this, originalClose);
};

maplibregl.Popup.prototype.remove = function () {
  return startClose(this, originalRemove);
};

// Keep the screen-centered (fixed) popups inside the VISIBLE area on phones:
// when the on-screen keyboard opens, the browser scrolls/resizes the visual
// viewport and the fixed popup would be shoved up, pushing its top (title,
// close button) off-screen. So while a popup is open we re-center it on the
// visual viewport and, while the keyboard is open, cap the content height to
// the visible height (the content scrolls internally).
const visualViewport = window.visualViewport;
let baseHeight = window.innerHeight;
window.addEventListener('resize', () => {
  baseHeight = Math.max(baseHeight, window.innerHeight);
});

function fitPopupsToViewport() {
  if (!visualViewport) return;
  const keyboardOpen = visualViewport.height < baseHeight * 0.9;
  document.querySelectorAll('.maplibregl-popup').forEach((el) => {
    if (el.closest('#popup-settings-card')) return; // dummy preview, not fixed
    if (getComputedStyle(el).position !== 'fixed') return;
    el.style.setProperty(
      'top',
      `${visualViewport.offsetTop + visualViewport.height / 2}px`,
      'important'
    );
    const content = el.querySelector('.maplibregl-popup-content');
    if (!content) return;
    if (keyboardOpen) {
      content.style.setProperty(
        'max-height',
        `${Math.max(120, visualViewport.height - 10)}px`,
        'important'
      );
    } else {
      content.style.removeProperty('max-height');
    }
  });
}

if (visualViewport) {
  visualViewport.addEventListener('resize', fitPopupsToViewport);
  visualViewport.addEventListener('scroll', fitPopupsToViewport);
}
window.addEventListener('resize', fitPopupsToViewport);
