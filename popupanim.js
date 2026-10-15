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

// One frame for every map popup and for the popup settings card.
// The top line is the toolbar (10vh), so the gap under OPTIONS / TOPIC
// CHAT / E2EE CHAT matches that panel. Left, right, and bottom match the
// fully open topic chat and E2EE chat: flush to the sides, 0.5dvh up
// from the bottom. A post with more text scrolls inside the frame.
// The visual viewport is the tighter limit while the keyboard is open,
// because dvh does not shrink for the keyboard.
const visualViewport = window.visualViewport;
let scheduled = false;

function fitPopupsToViewport() {
  const layoutH = window.innerHeight;
  const viewH = visualViewport ? visualViewport.height : layoutH;
  const viewW = visualViewport ? visualViewport.width : window.innerWidth;
  const offsetTop = visualViewport ? visualViewport.offsetTop : 0;
  const offsetLeft = visualViewport ? visualViewport.offsetLeft : 0;
  const root = document.documentElement.style;
  const keyboard = layoutH - viewH > 80 || offsetTop > 40;
  // Same width the chat uses between left 0 and right 0. Chips scale from it.
  root.setProperty('--popup-card', `${Math.max(80, viewW - offsetLeft)}px`);
  root.setProperty('--popup-left', `${offsetLeft}px`);
  root.setProperty('--popup-right', '0px');
  if (!keyboard) {
    root.setProperty('--popup-top', '10vh');
    root.setProperty('--popup-bottom', '0.5dvh');
    root.setProperty('--popup-max-h', 'calc(100dvh - 10vh - 0.5dvh)');
    clearPopupFit();
    pinSettingsCard();
    return;
  }
  // Keep the toolbar line when it is still on screen, and keep 0.5% of
  // the visible height clear above the keyboard.
  const toolbarTop = layoutH * 0.1;
  const bottomInset = viewH * 0.005;
  const top = Math.max(toolbarTop, offsetTop);
  const bottom = Math.max(0, layoutH - (offsetTop + viewH) + bottomInset);
  root.setProperty('--popup-top', `${top}px`);
  root.setProperty('--popup-bottom', `${bottom}px`);
  root.setProperty('--popup-max-h', `${Math.max(80, offsetTop + viewH - top - bottomInset)}px`);
  clearPopupFit();
  pinSettingsCard();
}

// The settings card has to use this same frame. An older rule still in the
// loaded stylesheet pins it to the top of the screen; these win over that.
function pinSettingsCard() {
  const card = document.getElementById('popup-settings-card');
  if (!card) return;
  const set = (prop, value) => card.style.setProperty(prop, value, 'important');
  set('top', 'var(--popup-top)');
  set('right', 'var(--popup-right)');
  set('bottom', 'var(--popup-bottom)');
  set('left', 'var(--popup-left)');
  set('transform', 'none');
  set('width', 'auto');
  set('height', 'auto');
  set('max-width', 'none');
  set('max-height', 'none');
}

// Older fits wrote a per-popup top and --fit. Those would pin one post
// to a different size than the shared frame.
function clearPopupFit() {
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
scheduleFit();
