import maplibregl from 'maplibre-gl';
import { forgetProfileTree, watchProfileTree } from './markertilt.js';

// Animate popup close: play the shrink+fade (.closing class, popupOut keyframes
// in style.css), then let MapLibre actually remove the popup.
const CLOSE_MS = 150;
const originalClose = maplibregl.Popup.prototype.close;
const originalRemove = maplibregl.Popup.prototype.remove;

function releasePopupFaces(popup) {
  const el = typeof popup.getElement === 'function' ? popup.getElement() : null;
  if (el) forgetProfileTree(el);
}

// Back/Forward (historyLayers.js): the minimum a card carries to reopen
// the same post later — its topic, payer and timestamp, plus where the
// popup is anchored.
function popupLayerData(popup) {
  const el = typeof popup.getElement === 'function' ? popup.getElement() : null;
  const card = el && el.querySelector ? el.querySelector('.popup-sheet') : null;
  const ds = card && card.dataset ? card.dataset : {};
  const lngLat = typeof popup.getLngLat === 'function' ? popup.getLngLat() : null;
  return {
    kind: card && card.querySelector && card.querySelector('[id^="polygon-comments-"]')
      ? 'polygon'
      : 'marker',
    topic: ds.viewTopic || '',
    payer: ds.popupPayer || '',
    created: ds.viewCreated || '',
    at: lngLat ? [lngLat.lng, lngLat.lat] : null,
  };
}

function startClose(popup, original) {
  const el = typeof popup.getElement === 'function' ? popup.getElement() : null;
  const content = el ? el.querySelector('.maplibregl-popup-content') : null;
  if (content && !content.classList.contains('closing')) {
    content.classList.add('closing');
    setTimeout(() => {
      releasePopupFaces(popup);
      original.call(popup);
    }, CLOSE_MS);
    return popup;
  }
  releasePopupFaces(popup);
  original.call(popup);
  return popup;
}

maplibregl.Popup.prototype.close = function () {
  return startClose(this, originalClose);
};

maplibregl.Popup.prototype.remove = function () {
  return startClose(this, originalRemove);
};

// remove() is an instance arrow, so the prototype wrap above is not what
// popup.remove() calls. Forget the picture, then run that arrow.
const NativePopup = maplibregl.Popup;
function Popup(options) {
  const popup = new NativePopup(options);
  const nativeRemove = popup.remove;
  popup.remove = () => {
    releasePopupFaces(popup);
    if (window.layerPopupClosed) window.layerPopupClosed(popup);
    return nativeRemove();
  };
  // Back/Forward (historyLayers.js): every popup close — the ×, a map
  // tap, a bulk close — goes through this event.
  popup.on('close', () => {
    if (window.layerPopupClosed) window.layerPopupClosed(popup);
  });
  return popup;
}
Popup.prototype = NativePopup.prototype;
maplibregl.Popup = Popup;

// One frame for every map popup and for the popup settings card.
// Top and bottom are the same gap: 0.5dvh plus the safe area. Left and
// right stay flush. A post with more text scrolls inside the frame.
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
    root.setProperty('--popup-top', 'calc(0.5dvh + env(safe-area-inset-top))');
    root.setProperty('--popup-bottom', 'calc(0.5dvh + env(safe-area-inset-bottom))');
    root.setProperty('--popup-max-h', 'calc(100dvh - var(--popup-top) - var(--popup-bottom))');
    clearPopupFit();
    pinSettingsCard();
    return;
  }
  // Same gap, shifted into the visible viewport. dvh stays the full
  // screen, so the covered strip under the keyboard is added by hand.
  const covered = Math.max(0, layoutH - (offsetTop + viewH));
  root.setProperty('--popup-top', `calc(${offsetTop}px + 0.5dvh + env(safe-area-inset-top))`);
  root.setProperty('--popup-bottom', `calc(${covered}px + 0.5dvh + env(safe-area-inset-bottom))`);
  root.setProperty('--popup-max-h', `max(80px, calc(${viewH}px - 1dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom)))`);
  clearPopupFit();
  pinSettingsCard();
}

// The settings card has to use this same frame. An older rule still in the
// loaded stylesheet pins it to the top of the screen; these win over that.
function pinSettingsCard() {
  const card = document.getElementById('popup-settings-card');
  if (!card) return;
  const set = (prop, value) => card.style.setProperty(prop, value, 'important');
  const wide = window.matchMedia('(orientation: landscape)').matches;
  set('top', 'var(--popup-top)');
  set('right', wide ? 'calc(var(--popup-right) + env(safe-area-inset-right))' : 'var(--popup-right)');
  set('bottom', 'var(--popup-bottom)');
  set('left', wide ? 'calc(var(--popup-left) + env(safe-area-inset-left))' : 'var(--popup-left)');
  set('transform', 'none');
  set('width', 'auto');
  set('height', wide ? 'calc(100dvh - var(--popup-top) - var(--popup-bottom))' : 'auto');
  set('max-width', 'none');
  set('max-height', wide ? 'calc(100dvh - var(--popup-top) - var(--popup-bottom))' : 'none');
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
  const el = typeof this.getElement === 'function' ? this.getElement() : null;
  // Paging and a fresh card drop the picture that was showing.
  if (el && node && node.nodeType === 1 && !el.contains(node)) forgetProfileTree(el);
  const result = originalSetDOMContent.call(this, node);
  fitIfOpen(this);
  // Cached cards are shown again through this call. Follow controls re-read.
  if (node && node.nodeType === 1) {
    watchProfileTree(node);
    document.dispatchEvent(new CustomEvent('follow-popup-open', { detail: node }));
  }
  // Back/Forward: a card swapped into an already-open popup (paging,
  // live-marker walk) refreshes the saved history data.
  if (window.layerPopupOpened && this.isOpen && this.isOpen()) {
    window.layerPopupOpened(this, popupLayerData(this));
  }
  return result;
};

const settingsPreview = document.getElementById('popup-settings-preview');
if (settingsPreview) watchProfileTree(settingsPreview);

const originalAddTo = maplibregl.Popup.prototype.addTo;
maplibregl.Popup.prototype.addTo = function (map) {
  const result = originalAddTo.call(this, map);
  fitIfOpen(this);
  // Back/Forward: report the open when the card was set before addTo
  // (the setDOMContent hook covers the other order).
  const el = typeof this.getElement === 'function' ? this.getElement() : null;
  if (el && el.querySelector) {
    if (window.layerPopupOpened && el.querySelector('.popup-sheet')) {
      window.layerPopupOpened(this, popupLayerData(this));
    }
  }
  return result;
};

if (visualViewport) {
  visualViewport.addEventListener('resize', scheduleFit);
  visualViewport.addEventListener('scroll', scheduleFit);
}
window.addEventListener('resize', scheduleFit);
scheduleFit();
