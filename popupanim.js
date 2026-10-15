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

// One frame for every map popup and for the popup settings card. The top
// of that frame is the bottom of OPTIONS / TOPIC CHAT / E2EE CHAT. A post
// with more text, a picture, or open comments scrolls inside the frame.
// The visual viewport is the tighter limit while the keyboard is open,
// because dvh does not shrink for the keyboard. Width stays on the full
// screen so the keyboard does not also make the card narrower.
const visualViewport = window.visualViewport;
let scheduled = false;
let chromePx = 0;

function readChrome(offsetTop) {
  const row = document.getElementById('main-buttons-row');
  if (!row) return chromePx;
  const rect = row.getBoundingClientRect();
  // Hidden while another panel is open. Keep the last real bottom so the
  // frame does not jump up into the button row.
  if (rect.height < 2) return chromePx;
  const bottom = rect.bottom - offsetTop;
  if (bottom > 0) chromePx = bottom;
  return chromePx;
}

function fitPopupsToViewport() {
  const viewH = visualViewport ? visualViewport.height : window.innerHeight;
  const viewW = visualViewport ? visualViewport.width : window.innerWidth;
  const offsetTop = visualViewport ? visualViewport.offsetTop : 0;
  const chrome = readChrome(offsetTop) || window.innerHeight * 0.1;
  const gap = Math.max(8, viewH * 0.012);
  const available = Math.max(80, viewH - chrome - gap * 2);
  const card = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.7, viewW * 0.98);
  const root = document.documentElement.style;
  root.setProperty('--chrome-bottom', `${offsetTop + chrome}px`);
  root.setProperty('--popup-gap', `${gap}px`);
  root.setProperty('--popup-max-h', `${available}px`);
  root.setProperty('--popup-card', `${card}px`);

  // Older fits wrote a per-popup top and --fit. Those would pin one post
  // to a different size than the shared frame.
  document.querySelectorAll('.maplibregl-popup').forEach((el) => {
    if (el.closest('#popup-settings-card')) return;
    el.style.removeProperty('top');
    el.style.removeProperty('--fit');
    el.style.removeProperty('height');
  });
}

function scheduleFit() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    fitPopupsToViewport();
  });
}

export function refitPopups() {
  fitPopupsToViewport();
}

function fitIfOpen(popup) {
  const el = typeof popup.getElement === 'function' ? popup.getElement() : null;
  if (el && el.isConnected) fitPopupsToViewport();
}

const originalSetDOMContent = maplibregl.Popup.prototype.setDOMContent;
maplibregl.Popup.prototype.setDOMContent = function (node) {
  const result = originalSetDOMContent.call(this, node);
  fitIfOpen(this);
  return result;
};

const originalAddTo = maplibregl.Popup.prototype.addTo;
maplibregl.Popup.prototype.addTo = function (map) {
  const result = originalAddTo.call(this, map);
  fitIfOpen(this);
  return result;
};

if (visualViewport) {
  visualViewport.addEventListener('resize', scheduleFit);
  visualViewport.addEventListener('scroll', scheduleFit);
}
window.addEventListener('resize', scheduleFit);

const buttonRow = document.getElementById('main-buttons-row');
if (buttonRow && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(scheduleFit).observe(buttonRow);
}
scheduleFit();
