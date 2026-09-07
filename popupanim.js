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
