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

// Popups grow with their content. If that box is taller or wider than the
// visible screen, --fit scales the whole card (layout stays in --u) so it
// stays inside 96dvw × 96dvh. The visual viewport is the tighter limit while
// the keyboard is open, because dvh does not shrink for the keyboard.
const visualViewport = window.visualViewport;
const watched = new WeakSet();
let scheduled = false;

function limitPx(el, name, fallback) {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw.endsWith('px')) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function fitPopupsToViewport() {
  const viewH = visualViewport ? visualViewport.height : window.innerHeight;
  const viewW = visualViewport ? visualViewport.width : window.innerWidth;
  const offsetTop = visualViewport ? visualViewport.offsetTop : 0;

  document.querySelectorAll('.maplibregl-popup').forEach((el) => {
    if (el.closest('#popup-settings-card')) return; // dummy preview, not fixed
    if (getComputedStyle(el).position !== 'fixed') return;
    if (!watched.has(el)) {
      watched.add(el);
      popupSizeObserver.observe(el);
    }

    el.style.setProperty('top', `${offsetTop + viewH / 2}px`, 'important');

    const content = el.querySelector('.maplibregl-popup-content');
    if (content) {
      content.style.removeProperty('max-height');
      content.style.removeProperty('overflow');
      content.style.removeProperty('overflow-y');
      content.style.removeProperty('overflow-x');
    }

    const laidH = el.offsetHeight;
    const laidW = el.offsetWidth;
    if (laidH < 1 || laidW < 1) return;

    // 96dvh / 96dvw from the registered custom props, and never past the
    // visible viewport (keyboard).
    const maxH = Math.min(limitPx(el, '--popup-max-h', viewH * 0.96), viewH * 0.98);
    const maxW = Math.min(limitPx(el, '--popup-max-w', viewW * 0.96), viewW * 0.98);
    const inline = el.style.getPropertyValue('--fit');
    const current = inline ? parseFloat(inline) : 1;
    if (!Number.isFinite(current) || current <= 0) return;

    const writeFit = (fit) => {
      const next = Math.min(1, Math.max(fit, 0.02)).toFixed(4);
      if (el.style.getPropertyValue('--fit') !== next) el.style.setProperty('--fit', next);
    };

    // Still past the screen: shrink from the size we have now. --fit scales
    // --u and the width together, so the laid-out box is what shrinks.
    if (laidH > maxH + 1 || laidW > maxW + 1) {
      writeFit(Math.min(current * maxH / laidH, current * maxW / laidW, current));
      const h2 = el.offsetHeight;
      const w2 = el.offsetWidth;
      const now = parseFloat(el.style.getPropertyValue('--fit')) || current;
      if ((h2 > maxH + 1 || w2 > maxW + 1) && now > 0) {
        writeFit(Math.min(now * maxH / h2, now * maxW / w2, now));
      }
      return;
    }

    // Content got shorter and the card is no longer using the screen.
    // Remeasure at the design size and grow back toward it.
    if (current < 0.999 && laidH < maxH - 8 && laidW < maxW - 8) {
      el.style.setProperty('--fit', '1');
      const naturalH = el.offsetHeight;
      const naturalW = el.offsetWidth;
      let fit = 1;
      if (naturalH > maxH) fit = Math.min(fit, maxH / naturalH);
      if (naturalW > maxW) fit = Math.min(fit, maxW / naturalW);
      writeFit(fit);
    }
  });
}

const popupSizeObserver = new ResizeObserver(() => {
  scheduleFit();
});

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
