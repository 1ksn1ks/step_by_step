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

// Pinch-zoom shrinks visualViewport.height by about the same factor as scale.
// A hair over 1 is subpixel noise. Above that, put the height back in stable
// pixels so the zoom is not a keyboard and the lift does not chase it.
function unscaledViewHeight(height, scale) {
  const h = Number(height) || 0;
  if (typeof scale === 'number' && scale > 1.01) return h * scale;
  return h;
}

// A focused text field plus a drop of more than ~25%. Overlay browsers shrink
// visualViewport. A resizing WebView or installed PWA shrinks innerHeight
// and can leave visualViewport.height unchanged. Either drop counts.
// layoutH is optional so a caller that only has the visual height still works.
// scale is optional. Above 1.01 the visual height is height * scale.
export function keyboardOpen(focused, viewH, stableH, layoutH, scale) {
  if (!focused || !(stableH > 0)) return false;
  const line = stableH * KB_RATIO;
  if (unscaledViewHeight(viewH, scale) < line) return true;
  return typeof layoutH === 'number' && layoutH > 0 && layoutH < line;
}

// Visible bottom in layout-viewport coordinates. getBoundingClientRect() is
// in that space, so the keyboard edge is visualViewport.offsetTop + height,
// not height alone. When the layout viewport has already shrunk above that
// sum, the visible bottom is innerHeight. scale undoes a pinch-zoom shrink
// of that height before the lift measures overlap.
export function visibleBottom(offsetTop, height, layoutH, scale) {
  const visual = (Number(offsetTop) || 0) + unscaledViewHeight(height, scale);
  const layout = Number(layoutH);
  if (layout > 0 && visual > 0) return Math.min(visual, layout);
  return visual > 0 ? visual : (layout > 0 ? layout : 0);
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
  const open = keyboardOpen(state.focused, state.viewH, state.stableH, state.layoutH, state.scale);
  if (open && !widthChanged && !orientChanged) return state.stableH;
  return measured;
}

// How far a bottom bar must move so its box sits pad px above the keyboard.
// translateY is the lift already applied (negative when lifted). viewBottom
// is the visible bottom (offsetTop + visualViewport.height). With offsetTop
// 0 that is the visual height, so older callers stay the same.
export function liftPx(barBottom, translateY, viewBottom, pad = 8) {
  const raw = barBottom - translateY;
  const overlap = raw - (viewBottom - pad);
  return overlap > 1 ? overlap : 0;
}

// viewTop defaults to 0, the band when the visual viewport has not panned.
export function fieldOutside(top, bottom, viewBottom, pad = 8, viewTop = 0) {
  const origin = Number(viewTop) || 0;
  return top < origin + pad || bottom > viewBottom - pad;
}

// Extra scroll after scrollIntoView. The field's scroller can be taller
// than the visible band, so "nearest" still leaves it under the keyboard.
export function scrollDelta(top, bottom, viewBottom, pad = 8, viewTop = 0) {
  const origin = Number(viewTop) || 0;
  if (bottom > viewBottom - pad) return bottom - (viewBottom - pad);
  if (top < origin + pad) return top - (origin + pad);
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

// How much of the visible band a pinned action row covers once it has
// been lifted. viewBottom is the visible bottom. The scrolling field then
// stops above that row.
export function dockCover(rawBottom, viewBottom, height, pad = 8) {
  if (!(height > 0)) return 0;
  return rawBottom > viewBottom - pad ? height : 0;
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
  let focusFrame = 0;
  let focusTimer = 0;
  let debugEl = null;

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
    const offsetTop = view && Number.isFinite(view.offsetTop) ? view.offsetTop : 0;
    const scale = view && Number.isFinite(view.scale) ? view.scale : 1;
    return {
      width,
      layoutH,
      viewH,
      offsetTop,
      scale,
      orient: width > layoutH ? 'land' : 'port',
    };
  }

  function edgeOf(metrics) {
    return visibleBottom(metrics.offsetTop, metrics.viewH, metrics.layoutH, metrics.scale);
  }

  function kbDebug() {
    try {
      return new URLSearchParams(window.location.search).get('kbdebug') === '1';
    } catch (err) {
      return false;
    }
  }

  function paintDebug(metrics, open, lift) {
    if (!kbDebug()) return;
    if (!debugEl) {
      debugEl = document.createElement('div');
      debugEl.id = 'kb-debug';
      debugEl.setAttribute('aria-hidden', 'true');
      debugEl.style.cssText = 'position:fixed;left:0.4rem;top:0.4rem;z-index:2147483646;margin:0;padding:0.35rem 0.5rem;background:rgba(0,0,0,0.82);color:#7CFFB2;font:600 0.7rem/1.35 ui-monospace,monospace;pointer-events:none;white-space:pre;border-radius:0.4rem;';
      document.documentElement.appendChild(debugEl);
    }
    const view = window.visualViewport;
    debugEl.textContent = [
      'innerHeight ' + metrics.layoutH,
      'vvH ' + (view && view.height ? view.height : metrics.viewH),
      'offsetTop ' + (view && Number.isFinite(view.offsetTop) ? view.offsetTop : 0),
      'stableH ' + stableH,
      'keyboardOpen ' + !!open,
      'lift ' + lift,
    ].join('\n');
  }

  function focusedLift() {
    const el = document.activeElement;
    const bar = el && el.closest && el.closest(DOCK_SELECTOR);
    if (!bar || !bar.dataset.kbLift) return 0;
    const n = Number(bar.dataset.kbLift);
    return Number.isFinite(n) ? Math.abs(n) : 0;
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
      scale: metrics.scale,
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
  function liftBar(bar, viewBottom) {
    const ty = translateY(bar);
    const rect = bar.getBoundingClientRect();
    const lift = liftPx(rect.bottom, ty, viewBottom);
    const rawBottom = rect.bottom - ty;
    if (lift) {
      const base = bar.classList.contains('feed-search-head') ? SEARCH_HEAD_SHIFT : '';
      // chatSectionIn animates transform on .chat-compose, and a stylesheet
      // transform !important would beat a plain inline value. Inline
      // !important wins over both. An ancestor transform (#feed-chat's
      // translateX(-50%), slideInNoFade, .nav-cover) composes with this
      // translateY. It does not replace it.
      bar.style.setProperty('transform', liftTransform(lift, base), 'important');
      bar.dataset.kbLift = (-lift).toFixed(2);
    } else if (bar.dataset.kbLift) {
      dropLift(bar);
    }
    return dockCover(rawBottom, viewBottom, rect.height);
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
    const edge = edgeOf(metrics);
    const open = keyboardOpen(focusedNow(), metrics.viewH, stableH, metrics.layoutH, metrics.scale);
    if (!open || !isTextControl(el)) {
      clearLifts();
      paintDebug(metrics, open, 0);
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
    if (bar) liftBar(bar, edge);
    extras.forEach((dock) => {
      cover += liftBar(dock, edge);
    });
    if (bar) {
      document.querySelectorAll('[data-kb-pad]').forEach(dropPad);
      paintDebug(metrics, true, focusedLift());
      return;
    }
    revealField(el, revealLimit(edge, cover), metrics.offsetTop);
    paintDebug(metrics, true, focusedLift());
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

  function parkField(scroller, el, viewBottom, viewTop) {
    const tail = scroller.getBoundingClientRect().bottom - (viewBottom - 8);
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
      const delta = scrollDelta(rect.top, rect.bottom, viewBottom, 8, viewTop);
      if (Math.abs(delta) <= 1) return true;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + delta;
      if (scroller.scrollTop === before) break;
      moved = true;
    }
    const settled = el.getBoundingClientRect();
    if (Math.abs(scrollDelta(settled.top, settled.bottom, viewBottom, 8, viewTop)) <= 1) return true;
    if (!moved) dropPad(scroller);
    return moved;
  }

  function revealField(el, viewBottom, viewTop) {
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { /* older browsers */ }
    const placed = () => {
      const rect = el.getBoundingClientRect();
      return Math.abs(scrollDelta(rect.top, rect.bottom, viewBottom, 8, viewTop)) <= 1;
    };
    if (placed()) return;
    for (const scroller of scrollers(el)) {
      if (placed()) return;
      if (parkField(scroller, el, viewBottom, viewTop)) return;
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
    // Focus is already gone. keyboardOpen(true) is only the shrink test,
    // so a WebView that shrank innerHeight still waits out the animation.
    if (keyboardOpen(true, metrics.viewH, stableH, metrics.layoutH, metrics.scale) && blurTries < 8) {
      blurTries += 1;
      blurTimer = setTimeout(finishBlur, 50);
      return;
    }
    blurTries = 0;
    syncHeight();
    paintDebug(box(), false, 0);
  }

  function clearFocusFollow() {
    if (focusFrame) cancelAnimationFrame(focusFrame);
    focusFrame = 0;
    clearTimeout(focusTimer);
    focusTimer = 0;
  }

  function onBlur() {
    clearFocusFollow();
    clearTimeout(blurTimer);
    blurTries = 0;
    blurTimer = setTimeout(finishBlur, 50);
  }

  // The keyboard animates in after focus. Measure again on the next frame
  // and once it has had time to settle. A newer focus or a blur cancels both.
  function onFocus() {
    clearFocusFollow();
    onGeometry();
    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      liftFocused();
    });
    focusTimer = setTimeout(() => {
      focusTimer = 0;
      if (!focusedNow()) return;
      liftFocused();
    }, 300);
  }

  onGeometry();
  window.addEventListener('resize', onGeometry);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onGeometry);
    window.visualViewport.addEventListener('scroll', liftFocused);
  }
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onBlur);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
