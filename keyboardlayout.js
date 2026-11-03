// The page scale is CSS, not a JS innerHeight formula. Shell height and the
// height side of --fu live in style.css as var(--app-h, 100dvh):
//   .info-overlay, #e2ee-web-notice-overlay, .picker-sheet
//     --fu: min(100dvw, --app-h) * 0.024
//   map shells (#search-bar, drawers, #feed-search-page, map chat)
//     --fu / --feed-unit: min(78dvw, --app-h * 0.42) / 31.25
//   full-screen shells: height: var(--app-h, 100dvh)
// --app-h stays on the last 100dvh measured with the keyboard closed.

export const KB_RATIO = 0.75;

// A bottom bar that contains the focused field. Chat composers are the
// original case. data-kb-dock marks the same kind of bar: the comments
// composer, the feed search head, the donate sheet, the edit box, and
// the create-post submit row.
export const DOCK_SELECTOR = '.chat-compose, [data-kb-dock]';

export const KB_OPEN_CLASS = 'kb-open';

// The search head already shifts with this variable. The lift adds to it.
export const SEARCH_HEAD_SHIFT = 'var(--feed-search-y, 0px)';

const TEXT_SKIP = new Set(['button', 'checkbox', 'radio', 'range', 'file', 'color', 'submit', 'reset', 'image', 'hidden']);

export function isTextControl(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return !TEXT_SKIP.has(String(el.type || 'text').toLowerCase());
}

// A focused text field plus a visual-viewport drop of more than ~25%.
export function keyboardOpen(focused, viewH, stableH) {
  return !!focused && stableH > 0 && viewH < stableH * KB_RATIO;
}

// Keep the frozen height while the keyboard is open. A width or orientation
// change, or the keyboard being closed, takes the 100dvh probe. That matches
// the shell height from before this script runs. innerHeight is only the
// fallback when the probe has not been measured.
export function nextStableHeight(state) {
  const measured = state.dvh > 0 ? state.dvh : Math.max(state.viewH || 0, state.layoutH || 0);
  if (!(state.stableH > 0)) return measured;
  const widthChanged = Math.abs(state.width - state.stableW) > 2;
  const orientChanged = state.orient !== state.prevOrient;
  const open = keyboardOpen(state.focused, state.viewH, state.stableH);
  if (open && !widthChanged && !orientChanged) return state.stableH;
  return measured;
}

// How far a bottom bar must move so its box sits pad px above the keyboard.
// translateY is the lift already applied (negative when lifted).
export function liftPx(barBottom, translateY, viewH, pad = 8) {
  const raw = barBottom - translateY;
  const overlap = raw - (viewH - pad);
  return overlap > 1 ? overlap : 0;
}

export function fieldOutside(top, bottom, viewH, pad = 8) {
  return top < pad || bottom > viewH - pad;
}

// Extra scroll after scrollIntoView. The field's scroller can be taller
// than the visual viewport, so "nearest" still leaves it under the keyboard.
export function scrollDelta(top, bottom, viewH, pad = 8) {
  if (bottom > viewH - pad) return bottom - (viewH - pad);
  if (top < pad) return top - pad;
  return 0;
}

// Inline lift. base is an existing translate the bar must keep, such as
// the search head's scroll offset. A second call with the same lift does
// not stack: liftPx subtracts the used translate before measuring.
export function liftTransform(lift, base) {
  const shift = (-Number(lift)).toFixed(2) + 'px';
  if (base) return 'translateY(calc(' + base + ' + ' + shift + '))';
  return 'translateY(' + shift + ')';
}

// How much of the visual viewport a pinned action row covers once it has
// been lifted. The scrolling field then stops above that row.
export function dockCover(rawBottom, viewH, height, pad = 8) {
  if (!(height > 0)) return 0;
  return rawBottom > viewH - pad ? height : 0;
}

export function revealLimit(viewH, coverPx) {
  if (!(coverPx > 0) || !(viewH > 0)) return viewH;
  const next = viewH - coverPx;
  return next > 16 ? next : viewH;
}

function boot() {
  let stableH = 0;
  let stableW = 0;
  let stableOrient = '';
  let probe = null;
  let blurTimer = 0;
  let blurTries = 0;

  function dvhHeight() {
    if (!probe) {
      probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100dvh;visibility:hidden;pointer-events:none;';
      document.documentElement.appendChild(probe);
    }
    const h = probe.getBoundingClientRect().height;
    return h > 0 ? h : window.innerHeight;
  }

  function box() {
    const view = window.visualViewport;
    const width = window.innerWidth;
    const layoutH = window.innerHeight;
    const viewH = view && view.height ? view.height : layoutH;
    return {
      width,
      layoutH,
      viewH,
      orient: width > layoutH ? 'land' : 'port',
    };
  }

  function focusedNow() {
    return isTextControl(document.activeElement);
  }

  function commit(h, metrics) {
    if (!(h > 0)) return;
    stableH = h;
    stableW = metrics.width;
    stableOrient = metrics.orient;
    const next = (Math.round(h * 100) / 100) + 'px';
    const root = document.documentElement.style;
    if (root.getPropertyValue('--app-h') !== next) root.setProperty('--app-h', next);
  }

  function syncHeight() {
    const metrics = box();
    const dvh = dvhHeight();
    const next = nextStableHeight({
      viewH: metrics.viewH,
      layoutH: metrics.layoutH,
      dvh,
      stableH,
      stableW,
      width: metrics.width,
      orient: metrics.orient,
      prevOrient: stableOrient,
      focused: focusedNow(),
    });
    commit(next, metrics);
  }

  // The keyboard lift only. A bar can also have its own translate, so the
  // used matrix is not the lift. The stored value is the translateY we set.
  function translateY(el) {
    if (!el.dataset.kbLift) return 0;
    const n = Number(el.dataset.kbLift);
    return Number.isFinite(n) ? n : 0;
  }

  function dropLift(el) {
    if (!el || !el.dataset || !el.dataset.kbLift) return;
    el.style.removeProperty('transform');
    delete el.dataset.kbLift;
  }

  function clearLifts() {
    document.documentElement.classList.remove(KB_OPEN_CLASS);
    document.querySelectorAll('[data-kb-lift]').forEach(dropLift);
    document.querySelectorAll('[data-kb-pad]').forEach(dropPad);
  }

  function keepLifts(keep) {
    const held = new Set(keep);
    document.querySelectorAll('[data-kb-lift]').forEach((el) => {
      if (!held.has(el)) dropLift(el);
    });
  }

  // Lift one bar. Returns how tall it is when its resting bottom sits in
  // the keyboard, so a field in the scroller can stop above it.
  function liftBar(bar, viewH) {
    const ty = translateY(bar);
    const rect = bar.getBoundingClientRect();
    const lift = liftPx(rect.bottom, ty, viewH);
    const rawBottom = rect.bottom - ty;
    if (lift) {
      const base = bar.classList.contains('feed-search-head') ? SEARCH_HEAD_SHIFT : '';
      bar.style.transform = liftTransform(lift, base);
      bar.dataset.kbLift = (-lift).toFixed(2);
    } else if (bar.dataset.kbLift) {
      dropLift(bar);
    }
    return dockCover(rawBottom, viewH, rect.height);
  }

  // The create-post submit row is pinned under the scroller, so it is not
  // an ancestor of the field. The edit box is an ancestor and is found by
  // closest() instead.
  function sideDocks(el) {
    const host = el.closest && el.closest('.draw-popup-editor');
    if (!host) return [];
    return Array.from(host.querySelectorAll('[data-kb-dock]')).filter((dock) => !dock.contains(el));
  }

  function liftFocused() {
    const el = document.activeElement;
    const metrics = box();
    const open = keyboardOpen(focusedNow(), metrics.viewH, stableH);
    if (!open || !isTextControl(el)) {
      clearLifts();
      return;
    }
    document.documentElement.classList.add(KB_OPEN_CLASS);
    const bar = el.closest && el.closest(DOCK_SELECTOR);
    const extras = sideDocks(el);
    const keep = [];
    if (bar) keep.push(bar);
    extras.forEach((dock) => keep.push(dock));
    keepLifts(keep);
    let cover = 0;
    if (bar) liftBar(bar, metrics.viewH);
    extras.forEach((dock) => {
      cover += liftBar(dock, metrics.viewH);
    });
    if (bar) {
      document.querySelectorAll('[data-kb-pad]').forEach(dropPad);
      return;
    }
    revealField(el, revealLimit(metrics.viewH, cover));
  }

  function dropPad(el) {
    if (!el || !el.dataset.kbPad) return;
    if (el.dataset.kbPadWas) el.style.paddingBottom = el.dataset.kbPadWas;
    else el.style.removeProperty('padding-bottom');
    delete el.dataset.kbPad;
    delete el.dataset.kbPadWas;
  }

  function scrollers(el) {
    const nodes = [];
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') nodes.push(node);
      node = node.parentElement;
    }
    const live = nodes.filter((item) => item.scrollHeight > item.clientHeight + 1);
    return live.length ? live : nodes;
  }

  function parkField(scroller, el, viewH) {
    const tail = scroller.getBoundingClientRect().bottom - (viewH - 8);
    if (tail > 1) {
      if (!scroller.dataset.kbPad) {
        scroller.dataset.kbPad = '1';
        scroller.dataset.kbPadWas = scroller.style.paddingBottom || '';
      }
      const extra = Math.ceil(tail);
      const was = scroller.dataset.kbPadWas;
      scroller.style.paddingBottom = was ? 'calc(' + was + ' + ' + extra + 'px)' : extra + 'px';
    }
    let moved = false;
    for (let guard = 0; guard < 4; guard += 1) {
      const rect = el.getBoundingClientRect();
      const delta = scrollDelta(rect.top, rect.bottom, viewH);
      if (Math.abs(delta) <= 1) return true;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + delta;
      if (scroller.scrollTop === before) break;
      moved = true;
    }
    if (Math.abs(scrollDelta(el.getBoundingClientRect().top, el.getBoundingClientRect().bottom, viewH)) <= 1) return true;
    if (!moved) dropPad(scroller);
    return moved;
  }

  function revealField(el, viewH) {
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { /* older browsers */ }
    if (Math.abs(scrollDelta(el.getBoundingClientRect().top, el.getBoundingClientRect().bottom, viewH)) <= 1) return;
    for (const scroller of scrollers(el)) {
      if (Math.abs(scrollDelta(el.getBoundingClientRect().top, el.getBoundingClientRect().bottom, viewH)) <= 1) return;
      if (parkField(scroller, el, viewH)) return;
    }
  }

  function onGeometry() {
    syncHeight();
    liftFocused();
  }

  function finishBlur() {
    blurTimer = 0;
    if (focusedNow()) return;
    document.documentElement.classList.remove(KB_OPEN_CLASS);
    clearLifts();
    const metrics = box();
    if (stableH && metrics.viewH < stableH * KB_RATIO && blurTries < 8) {
      blurTries += 1;
      blurTimer = setTimeout(finishBlur, 50);
      return;
    }
    blurTries = 0;
    syncHeight();
  }

  function onBlur() {
    clearTimeout(blurTimer);
    blurTries = 0;
    blurTimer = setTimeout(finishBlur, 50);
  }

  onGeometry();
  window.addEventListener('resize', onGeometry);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onGeometry);
    window.visualViewport.addEventListener('scroll', liftFocused);
  }
  document.addEventListener('focusin', onGeometry);
  document.addEventListener('focusout', onBlur);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
