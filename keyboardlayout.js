// The page scale is CSS, not a JS innerHeight formula. Shell height and the
// height side of --fu live in style.css as var(--app-h, 100dvh).
// --app-h stays on the last 100dvh measured with the keyboard closed.
// A focused text field pins the nearest fixed shell, or an absolute sheet
// whose parent is the viewport. A full-screen shell (donate, chats, feed)
// takes the visual viewport. A short sheet that already sits on the bottom
// keeps its height and moves up so that bottom rests on the keyboard.

export const KB_RATIO = 0.75;

export const KB_OPEN_CLASS = 'kb-open';

// Known sheets. Matching is an override, not a requirement: a fixed shell
// is pinned even when it is absent here, including one mounted after load.
// A named absolute sheet still has to sit in a viewport-sized parent, so an
// in-card comments layer does not steal the pin from the popup behind it.
//   #topic-chat-container / #encrypted-chat-container — index.html, map chat
//   #feed-chat — the feed and map-chat page (the inner chat is relative)
//   .comments-modal — processallmessages.js showCommentsModal
//   #feed-search-page — feedlayout.js
//   #popup-settings-card — index.html
//   .picker-sheet — picker.js mount
//   #draw-column — index.html create/edit form (feed create uses #feed-chat)
//   #search-bar — index.html map search
//   #donate-sheet — donations.js ensureSheet, style.css
export const SHELL_SELECTOR = [
  '#topic-chat-container',
  '#encrypted-chat-container',
  '#feed-chat',
  '.comments-modal',
  '#feed-search-page',
  '#popup-settings-card',
  '.picker-sheet',
  '#draw-column',
  '#search-bar',
  '#donate-sheet',
].join(', ');

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
// pixels so the zoom is not a keyboard.
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
// of that height before the overlap is measured.
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

// The shell's pin. top and height are the visual viewport. bottom is auto
// so a stretched sheet (top and bottom both set) follows this height.
// A resizing WebView leaves visualViewport.height full and shrinks
// innerHeight. The visible band is the tighter of the two.
export function pinFrame(offsetTop, height, layoutH) {
  const top = Number(offsetTop);
  const h = Number(height);
  const safeTop = Number.isFinite(top) ? top : 0;
  let safeH = h > 0 ? h : 0;
  const layout = Number(layoutH);
  if (safeH > 0 && layout > 0) {
    const room = layout - safeTop;
    if (room > 0 && room < safeH) safeH = room;
  }
  return { top: safeTop, height: safeH, bottom: 'auto' };
}

// True when the field's bottom edge is past the visible area.
export function fieldBelowVisible(fieldBottom, viewBottom) {
  const field = Number(fieldBottom);
  const view = Number(viewBottom);
  if (!Number.isFinite(field) || !Number.isFinite(view)) return false;
  return field > view + 1;
}

// Stay pinned while the keyboard is open, including after the pin has
// moved the field up. A pin that started for a small overlap stays until
// the visible area is the stable height again, so it does not flicker.
export function pinHeld(focused, open, below, already, visible, stable) {
  if (!focused) return false;
  if (open || below) return true;
  if (!already) return false;
  if (!(stable > 0) || !(visible > 0)) return false;
  return visible < stable - 2;
}

// scrollTop from before focus, clamped to the shell after the pin is gone.
export function restoredScrollTop(saved, maxScroll) {
  const n = Number(saved);
  let value = Number.isFinite(n) && n > 0 ? n : 0;
  const max = Number(maxScroll);
  if (Number.isFinite(max) && max >= 0 && value > max) value = max;
  return value;
}

// How far a scroller still has to move after scrollIntoView. That call
// uses the layout viewport, so a visualViewport offset can leave the
// field in the strip above the visible top. Negative moves the field down.
// A field taller than the band keeps its top on the visible top.
export function scrollCorrection(fieldTop, fieldBottom, viewTop, viewBottom) {
  const top = Number(fieldTop);
  const bottom = Number(fieldBottom);
  const bandTop = Number(viewTop);
  const bandBottom = Number(viewBottom);
  if (![top, bottom, bandTop, bandBottom].every(Number.isFinite)) return 0;
  if (top < bandTop - 1) return top - bandTop;
  if (bottom > bandBottom + 1) return bottom - bandBottom;
  return 0;
}

// fixed: any shell. A short bottom sheet does not have to be on the override
// list, and it does not have to cover 70% of the width or 45% of the height.
// absolute: the parent is the viewport. A full-viewport absolute canvas that
// is not a named override (the map, a stretch wrapper) is not a sheet.
// selfFills is that canvas test. An in-card comments layer fails the parent
// test even when it carries a named class.
export function acceptsShell(position, named, coversViewport, selfFills) {
  if (position === 'fixed') return true;
  if (position !== 'absolute' || !coversViewport) return false;
  if (selfFills && !named) return false;
  return true;
}

// The element's box already covers the viewport. top/left allow a 1px error.
export function rectCoversViewport(rect, viewW, viewH) {
  if (!rect || !(viewW > 0) || !(viewH > 0)) return false;
  return rect.top <= 1 && rect.left <= 1
    && rect.width >= viewW * 0.9
    && rect.height >= viewH * 0.9;
}

// ancestors are nearest parent first. Each entry is
// { position, named, pageRoot, id, rect, parentRect }.
// pageRoot is html/body. #map is the page canvas, not a sheet.
// The first fixed entry wins. An absolute entry wins when its parent covers
// the viewport and it is a sheet rather than a full-size unnamed canvas.
export function selectShell(ancestors, view) {
  const viewW = Number(view && view.width) || 0;
  const viewH = Number(view && view.height) || 0;
  const list = Array.isArray(ancestors) ? ancestors : [];
  for (const node of list) {
    if (!node || node.pageRoot || node.id === 'map') continue;
    const pos = node.position;
    if (pos !== 'fixed' && pos !== 'absolute') continue;
    if (pos === 'fixed') return node;
    const parentCovers = rectCoversViewport(node.parentRect, viewW, viewH);
    const selfFills = rectCoversViewport(node.rect, viewW, viewH);
    if (acceptsShell(pos, !!node.named, parentCovers, selfFills)) return node;
  }
  return null;
}

// A short sheet already resting on the layout bottom. A full-bleed sheet
// (top near 0, or taller than 85% of the layout) is not one of these:
// that sheet is shrunk to the visual viewport instead of being translated.
export function shellAnchored(rect, layoutH) {
  const layout = Number(layoutH);
  if (!rect || !(layout > 0)) return false;
  const top = Number(rect.top);
  const bottom = Number(rect.bottom);
  const height = Number(rect.height);
  if (![top, bottom, height].every(Number.isFinite)) return false;
  if (!(height > 0) || height >= layout * 0.85) return false;
  if (!(top > 16)) return false;
  return bottom >= layout - 16;
}

// bottomAnchored keeps ownHeight and sits that bottom on the keyboard top.
// Anything else fills the visual viewport. ownHeight taller than the band
// is capped so the sheet cannot extend under the keyboard.
export function shellPlacement(spec) {
  const frame = pinFrame(spec && spec.offsetTop, spec && spec.viewH, spec && spec.layoutH);
  const own = Number(spec && spec.ownHeight);
  const short = own > 0 && own < frame.height - 1;
  if (!(spec && spec.bottomAnchored) || !short) return frame;
  const keyboardTop = frame.top + frame.height;
  let top = keyboardTop - own;
  if (top < frame.top) top = frame.top;
  return { top, height: own, bottom: 'auto' };
}

const PIN_MOTION = new Set(['transform', 'top', 'right', 'bottom', 'left', 'height', 'inset']);

// Finite CSS animations that move the box. An infinite custom-property spin
// (the early-holder ring) and a JS fade with no animationName stay running.
export function settlesOnPin(anim) {
  if (!anim || typeof anim.animationName !== 'string') return false;
  const name = anim.animationName;
  if (!name || name === 'none') return false;
  if (anim.playState === 'finished' || anim.playState === 'idle' || anim.playState === 'canceled') return false;
  const iterations = anim.timing && anim.timing.iterations;
  if (iterations === Infinity || iterations === 'infinite') return false;
  const props = Array.isArray(anim.properties) ? anim.properties : [];
  return props.some((prop) => PIN_MOTION.has(prop));
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
  let pinned = null;
  let pinSaved = null;
  // scrollTop from the moment the field was focused, before the browser
  // or this script scrolls it into view.
  let focusScroll = null;

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

  function paintDebug(metrics, open, frame) {
    if (!kbDebug()) return;
    if (!debugEl) {
      debugEl = document.createElement('div');
      debugEl.id = 'kb-debug';
      debugEl.setAttribute('aria-hidden', 'true');
      debugEl.style.cssText = 'position:fixed;left:0.4rem;top:0.4rem;z-index:2147483646;margin:0;padding:0.35rem 0.5rem;background:rgba(0,0,0,0.82);color:#7CFFB2;font:600 0.7rem/1.35 ui-monospace,monospace;pointer-events:none;white-space:pre;border-radius:0.4rem;';
      document.documentElement.appendChild(debugEl);
    }
    const view = window.visualViewport;
    const pin = frame && frame.height > 0 ? frame.top + ' ' + frame.height : 'off';
    debugEl.textContent = [
      'innerHeight ' + metrics.layoutH,
      'vvH ' + (view && view.height ? view.height : metrics.viewH),
      'offsetTop ' + (view && Number.isFinite(view.offsetTop) ? view.offsetTop : 0),
      'stableH ' + stableH,
      'keyboardOpen ' + !!open,
      'pin ' + pin,
    ].join('\n');
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

  function readInline(el, prop) {
    return {
      value: el.style.getPropertyValue(prop),
      priority: el.style.getPropertyPriority(prop),
    };
  }

  function writeInline(el, prop, saved) {
    if (!saved || !saved.value) el.style.removeProperty(prop);
    else el.style.setProperty(prop, saved.value, saved.priority || '');
  }

  function releasePin() {
    const shell = pinned;
    const saved = pinSaved;
    if (!shell || !saved) {
      pinned = null;
      pinSaved = null;
      return;
    }
    pinned = null;
    pinSaved = null;
    if (focusScroll && focusScroll.shell === shell) focusScroll = null;
    delete shell.dataset.kbPin;
    // Scroll anchoring would keep the focused field on screen and throw
    // away the scroll position from before the keyboard opened.
    shell.style.setProperty('overflow-anchor', 'none');
    writeInline(shell, 'top', saved.top);
    writeInline(shell, 'height', saved.height);
    writeInline(shell, 'bottom', saved.bottom);
    writeInline(shell, 'max-height', saved.maxHeight);
    writeInline(shell, 'min-height', saved.minHeight);
    writeInline(shell, 'padding-top', saved.paddingTop);
    writeInline(shell, 'padding-bottom', saved.paddingBottom);
    const applyScroll = () => {
      const max = shell.scrollHeight - shell.clientHeight;
      shell.scrollTop = restoredScrollTop(saved.scroll, max);
    };
    applyScroll();
    // The map chat list is an explicit height. Tell cssLogic to measure
    // the shell again now that the pin is gone.
    notifyPin();
    requestAnimationFrame(() => {
      // A new focus pinned this same shell again. Leave its scroll alone.
      if (pinned === shell) return;
      applyScroll();
      writeInline(shell, 'overflow-anchor', saved.anchor);
    });
  }

  function notifyPin() {
    try { window.dispatchEvent(new Event('kbpin')); } catch (err) { /* no window */ }
  }

  function findShell(el) {
    if (!el || !el.parentElement) return null;
    const view = { width: window.innerWidth || 0, height: window.innerHeight || 0 };
    const ancestors = [];
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const pageRoot = node === document.body;
      let pos = '';
      try { pos = getComputedStyle(node).position; } catch (err) { pos = ''; }
      let named = false;
      try { named = !!(node.matches && SHELL_SELECTOR && node.matches(SHELL_SELECTOR)); } catch (err) { named = false; }
      let rect = null;
      let parentRect = null;
      if (!pageRoot && node.id !== 'map' && (pos === 'fixed' || pos === 'absolute')) {
        try { rect = node.getBoundingClientRect(); } catch (err) { rect = null; }
        if (pos === 'absolute') {
          const parent = node.offsetParent || document.documentElement;
          try { parentRect = parent.getBoundingClientRect(); } catch (err) { parentRect = null; }
        }
      }
      ancestors.push({
        node,
        id: node.id,
        position: pos,
        named,
        pageRoot,
        rect,
        parentRect,
      });
      node = node.parentElement;
    }
    const picked = selectShell(ancestors, view);
    return picked && picked.node ? picked.node : null;
  }

  // Entry motion (donate-sheet-up, slideIn) paints the sheet under the
  // keyboard even after top and height are pinned. Finish that finite
  // animation first. Leave an infinite ring or glow alone.
  function animationFacts(anim) {
    let properties = [];
    let iterations = 1;
    try {
      const effect = anim.effect;
      if (effect && effect.getTiming) {
        const timing = effect.getTiming();
        if (timing && timing.iterations != null) iterations = timing.iterations;
      }
      if (effect && effect.getKeyframes) {
        const seen = new Set();
        for (const frame of effect.getKeyframes()) {
          if (!frame) continue;
          for (const key of Object.keys(frame)) {
            if (key === 'offset' || key === 'easing' || key === 'composite' || key === 'computedOffset') continue;
            seen.add(key);
          }
        }
        properties = [...seen];
      }
    } catch (err) { /* unreadable effect */ }
    return {
      animationName: typeof anim.animationName === 'string' ? anim.animationName : '',
      playState: anim.playState,
      timing: { iterations },
      properties,
    };
  }

  function shellAnimations(root) {
    if (!root || typeof root.getAnimations !== 'function') return [];
    try { return root.getAnimations({ subtree: true }); } catch (err) { /* walk */ }
    const out = [];
    const walk = (el) => {
      if (!el || el.nodeType !== 1) return;
      try {
        const list = el.getAnimations();
        for (const anim of list) out.push(anim);
      } catch (err) { /* skip */ }
      const kids = el.children;
      if (!kids) return;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    };
    walk(root);
    return out;
  }

  function settleEntry(root) {
    for (const anim of shellAnimations(root)) {
      if (!settlesOnPin(animationFacts(anim))) continue;
      try { anim.finish(); } catch (err) {
        try { anim.cancel(); } catch (err2) { /* leave it */ }
      }
    }
  }

  function scrolls(node) {
    let oy = '';
    try { oy = getComputedStyle(node).overflowY; } catch (err) { return false; }
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return true;
    // Landscape settings uses overflow:hidden and still scrolls.
    return oy === 'hidden' && node.scrollHeight - node.clientHeight > 1;
  }

  // The nearest overflow scroller inside the shell, or the shell itself.
  function nearestScroller(el, shell) {
    let node = el && el.parentElement;
    while (node && node !== shell) {
      if (scrolls(node)) return node;
      node = node.parentElement;
    }
    if (shell && scrolls(shell)) return shell;
    return null;
  }

  // The field lives in the scrolling middle, not in a header or bottom bar.
  function fieldInScroller(el, shell) {
    return !!nearestScroller(el, shell);
  }

  function applyPin(shell, metrics) {
    const probe = pinFrame(metrics.offsetTop, metrics.viewH, metrics.layoutH);
    if (!(probe.height > 0)) {
      if (pinned) releasePin();
      return probe;
    }
    if (pinned && pinned !== shell) releasePin();
    if (
      pinned === shell && pinSaved
      && (pinSaved.width !== metrics.width || pinSaved.orient !== metrics.orient)
    ) {
      releasePin();
    }
    // The card's translateY runs on a descendant. Finish it before the
    // measurement, so a bottom sheet's height is the resting height.
    settleEntry(shell);
    if (pinned !== shell) {
      const rect = shell.getBoundingClientRect();
      const prior = focusScroll && focusScroll.shell === shell ? focusScroll.scroll : shell.scrollTop;
      pinned = shell;
      pinSaved = {
        top: readInline(shell, 'top'),
        height: readInline(shell, 'height'),
        bottom: readInline(shell, 'bottom'),
        maxHeight: readInline(shell, 'max-height'),
        minHeight: readInline(shell, 'min-height'),
        paddingTop: readInline(shell, 'padding-top'),
        paddingBottom: readInline(shell, 'padding-bottom'),
        anchor: readInline(shell, 'overflow-anchor'),
        scroll: prior,
        ownHeight: rect.height,
        bottomAnchored: shellAnchored(rect, metrics.layoutH),
        width: metrics.width,
        orient: metrics.orient,
      };
      shell.dataset.kbPin = '1';
      shell.style.setProperty('overflow-anchor', 'none');
    }
    const frame = shellPlacement({
      offsetTop: metrics.offsetTop,
      viewH: metrics.viewH,
      layoutH: metrics.layoutH,
      ownHeight: pinSaved.ownHeight,
      bottomAnchored: pinSaved.bottomAnchored,
    });
    // !important beats a stylesheet height of var(--app-h), inset: 0, and
    // the chat and settings rules that lock top and bottom. max-height and
    // min-height would otherwise keep a sheet in the covered band.
    shell.style.setProperty('top', frame.top + 'px', 'important');
    shell.style.setProperty('height', frame.height + 'px', 'important');
    shell.style.setProperty('bottom', 'auto', 'important');
    shell.style.setProperty('max-height', frame.height + 'px', 'important');
    shell.style.setProperty('min-height', '0px', 'important');
    // A map comments card is position:fixed with keyboard padding from
    // popupanim.js. The pin is already the visible band, so that padding
    // would shrink it a second time. Safe area stays.
    if (shell.classList && shell.classList.contains('maplibregl-popup')) {
      shell.style.setProperty('padding-top', 'env(safe-area-inset-top, 0px)', 'important');
      shell.style.setProperty('padding-bottom', 'env(safe-area-inset-bottom, 0px)', 'important');
    }
    notifyPin();
    return frame;
  }

  function place() {
    const el = document.activeElement;
    const metrics = box();
    const edge = edgeOf(metrics);
    const open = keyboardOpen(focusedNow(), metrics.viewH, stableH, metrics.layoutH, metrics.scale);
    const focused = isTextControl(el);
    if (!focused) {
      // Blur usually arrives before the keyboard has finished closing.
      // Dropping the pin in that gap stretches the sheet back over the
      // keyboard and jumps. Hold it until the viewport has grown back.
      const closing = keyboardOpen(true, metrics.viewH, stableH, metrics.layoutH, metrics.scale);
      if (closing && pinned) {
        const frame = applyPin(pinned, metrics);
        paintDebug(metrics, false, frame);
        return;
      }
      releasePin();
      document.documentElement.classList.remove(KB_OPEN_CLASS);
      paintDebug(metrics, false, null);
      return;
    }
    document.documentElement.classList.toggle(KB_OPEN_CLASS, open);
    const rect = el.getBoundingClientRect();
    const below = fieldBelowVisible(rect.bottom, edge);
    const held = pinHeld(true, open, below, !!pinned, edge, stableH);
    if (!held) {
      releasePin();
      paintDebug(metrics, open, null);
      return;
    }
    const shell = findShell(el);
    if (!shell) {
      if (below) {
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { /* older browsers */ }
      }
      paintDebug(metrics, open, null);
      return;
    }
    const frame = applyPin(shell, metrics);
    if (fieldInScroller(el, shell)) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { /* older browsers */ }
      const scroller = nearestScroller(el, shell);
      if (scroller) {
        const next = el.getBoundingClientRect();
        const dy = scrollCorrection(next.top, next.bottom, metrics.offsetTop, edge);
        if (dy) scroller.scrollTop += dy;
      }
    }
    paintDebug(metrics, open, frame);
  }

  function onGeometry() {
    syncHeight();
    place();
  }

  function finishBlur() {
    blurTimer = 0;
    if (focusedNow()) return;
    const metrics = box();
    // Focus is already gone. keyboardOpen(true) is only the shrink test,
    // so a WebView that shrank innerHeight still waits out the animation
    // before the pin and --app-h let go together.
    if (keyboardOpen(true, metrics.viewH, stableH, metrics.layoutH, metrics.scale) && blurTries < 8) {
      blurTries += 1;
      blurTimer = setTimeout(finishBlur, 50);
      return;
    }
    blurTries = 0;
    releasePin();
    document.documentElement.classList.remove(KB_OPEN_CLASS);
    syncHeight();
    paintDebug(box(), false, null);
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

  function noteFocusScroll(el) {
    if (!isTextControl(el)) return;
    const shell = findShell(el);
    if (!shell) return;
    if (focusScroll && focusScroll.shell === shell) return;
    focusScroll = { shell, scroll: shell.scrollTop };
  }

  // The keyboard animates in after focus. Measure again on the next frame
  // and once it has had time to settle. A newer focus or a blur cancels both.
  function onFocus(event) {
    clearFocusFollow();
    noteFocusScroll(event && event.target);
    onGeometry();
    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      place();
    });
    focusTimer = setTimeout(() => {
      focusTimer = 0;
      if (!focusedNow()) return;
      place();
    }, 300);
  }

  onGeometry();
  window.addEventListener('resize', onGeometry, true);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onGeometry, true);
    window.visualViewport.addEventListener('scroll', place, true);
  }
  document.addEventListener('pointerdown', (event) => noteFocusScroll(event.target), true);
  // A tap records the scroll on pointerdown. A script calls focus()
  // directly, and the browser scrolls the field before focusin, so the
  // snapshot has to happen before the native focus.
  const nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (options) {
    try { noteFocusScroll(this); } catch (err) { /* still focus */ }
    return nativeFocus.call(this, options);
  };
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('focusout', onBlur);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
