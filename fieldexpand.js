// fieldexpand.js — full screen for every 18 KB message box.
//
// bytecap.js mounts this on each field it caps (capMessageField /
// capMessageEditor), so any capped box gets it: a textarea, or a plain-text
// contenteditable that mirrors into a hidden field (the Draw text). Single-
// line fields, titles and search never do. The topic and E2EE composers
// keep their own fullscreen (chatcomposer.js) and only share the rules
// below: one box expanded at a time, and a closing page collapses it first.
//
// A button in the field's top right corner shows once the box has text.
// It opens the box over the page it lives in, below that page's header
// (and above an action row marked data-expand-footer, such as Draw's
// Submit buttons); on a phone that is the whole screen. The same button,
// Escape, Back (the 'fieldfull' history layer), or a send button marked
// data-expand-send closes it again. Closing the page closes it first.
//
// Nothing moves in the DOM: the box only turns position: fixed, so focus,
// the caret, the keyboard, the 18 KB cap, the live counter, paste and drop
// handling and every listener stay as they are. A placeholder keeps the
// page's layout while it is out, and the page's scroll comes back exactly.
// The pages are size containers (a containing block for fixed boxes), so
// the box is placed by measuring: the page's area minus its header and
// footer, in its containing block's coordinates, again whenever the page,
// the window or the visual viewport changes (keyboardlayout.js pins the
// page above the keyboard; data-kb-skip keeps it from pinning the box).
//
// The box is data-expand-box on an ancestor, else the field's parent (the
// field and its counter). What it holds stays in it: the Post edit and
// Swap bio boxes keep their Save button.

const PAGE_IDS = new Set([
  'feed-chat', 'popup-settings-card', 'draw-column', 'topic-chat-container', 'encrypted-chat-container',
  'feed-search-page', 'feed-profile', 'feed-settings', 'donate-sheet',
]);
const PAGE_CLASSES = ['feed-menu-page', 'drawer-screen', 'comments-modal', 'picker-sheet'];
const HEADER_CLASSES = ['feed-chat-bar', 'feed-menu-page-bar', 'feed-settings-bar', 'feed-comments-bar'];
const LAYER = 'fieldfull';

const EXPAND_ICON = '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>';
const COLLAPSE_ICON = '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/>';

// --- One expanded box at a time (shared with chatcomposer.js) ----------
// An entry is { collapse() }. Claiming collapses whichever other one is out.
let current = null;

export function claimExpanded(entry) {
  if (current && current !== entry) {
    const previous = current;
    current = null;
    previous.collapse();
  }
  current = entry;
}

export function releaseExpanded(entry) {
  if (current === entry) current = null;
}

// A page is closing: whatever box is out goes back first.
export function collapseExpandedFields() {
  if (!current) return;
  const previous = current;
  current = null;
  previous.collapse();
}

// --- DOM helpers (parent walks and class checks only) ------------------
function isPage(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.id && PAGE_IDS.has(el.id)) return true;
  return PAGE_CLASSES.some((name) => el.classList.contains(name));
}

function rendered(el) {
  return !!(el && el.isConnected !== false && el.getClientRects && el.getClientRects().length);
}

function headerOf(page) {
  if (!page) return null;
  for (const child of page.children || []) {
    if (HEADER_CLASSES.some((name) => child.classList.contains(name)) && rendered(child)) return child;
  }
  return null;
}

// The page the box covers: the nearest page with a header (Draw's form sits
// in #draw-column inside the #feed-chat page), else the nearest page.
function pageOf(box) {
  let nearest = null;
  for (let el = box.parentElement; el && el.nodeType === 1; el = el.parentElement) {
    if (!isPage(el)) continue;
    if (!nearest) nearest = el;
    if (headerOf(el)) return el;
  }
  return nearest;
}

// An action row the box stops above, beside the box or one of its parents.
function footerOf(box, page) {
  for (let el = box.parentElement; el; el = el.parentElement) {
    for (const child of el.children || []) {
      if (child !== box && child.dataset && child.dataset.expandFooter !== undefined && rendered(child)) return child;
    }
    if (el === page) break;
  }
  return null;
}

function boxOf(field) {
  for (let el = field.parentElement; el && el.nodeType === 1; el = el.parentElement) {
    if (el.dataset && el.dataset.expandBox !== undefined) return el;
  }
  return field.parentElement;
}

function inChatComposer(field) {
  for (let el = field.parentElement; el && el.nodeType === 1; el = el.parentElement) {
    if (el.classList.contains('chat-compose')) return true;
  }
  return false;
}

function descendants(root, test) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      if (test(child)) out.push(child);
      walk(child);
    }
  };
  if (root) walk(root);
  return out;
}

// The element a fixed box is placed in: the nearest ancestor that is a
// containing block for fixed descendants (a size container, a transform,
// a filter...), else the viewport. Its padding box, as the page scrolls it.
function fixedOrigin(box) {
  for (let el = box.parentElement; el && el !== document.documentElement && el.nodeType === 1; el = el.parentElement) {
    let cs;
    try { cs = getComputedStyle(el); } catch { continue; }
    const holds = (value) => value && value !== 'none';
    if (holds(cs.transform) || holds(cs.translate) || holds(cs.scale) || holds(cs.rotate) || holds(cs.perspective)
      || holds(cs.filter) || holds(cs.backdropFilter) || holds(cs.webkitBackdropFilter)
      || /paint|layout|strict|content/.test(cs.contain || '')
      || (cs.containerType && cs.containerType !== 'normal')
      || /transform|perspective|filter/.test(cs.willChange || '')
      || cs.contentVisibility === 'auto') {
      const r = el.getBoundingClientRect();
      return { x: r.left + (el.clientLeft || 0) - (el.scrollLeft || 0), y: r.top + (el.clientTop || 0) - (el.scrollTop || 0), el };
    }
  }
  return { x: 0, y: 0, el: null };
}

// A box held by a containing block is also cut by it and by every parent
// above it that clips (Draw's form clips to its editor): the box stays
// inside what shows, so its top and its button are never cut off.
function clipFrame(frame, holder) {
  let { top, left } = frame;
  let right = frame.left + frame.width;
  let bottom = frame.top + frame.height;
  for (let el = holder; el && el !== document.documentElement && el.nodeType === 1; el = el.parentElement) {
    let cs;
    try { cs = getComputedStyle(el); } catch { continue; }
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = el.getBoundingClientRect();
    const innerTop = r.top + (el.clientTop || 0);
    const innerLeft = r.left + (el.clientLeft || 0);
    top = Math.max(top, innerTop);
    left = Math.max(left, innerLeft);
    bottom = Math.min(bottom, innerTop + (el.clientHeight || r.height));
    right = Math.min(right, innerLeft + (el.clientWidth || r.width));
  }
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// The area the box covers, in viewport coordinates.
export function expandFrame(box) {
  const page = pageOf(box);
  const view = window.visualViewport;
  const viewTop = view ? view.offsetTop : 0;
  const viewBottom = view ? view.offsetTop + view.height : (window.innerHeight || 0);
  const area = page && rendered(page)
    ? page.getBoundingClientRect()
    : { top: 0, left: 0, width: window.innerWidth || 0, bottom: window.innerHeight || 0 };
  let top = Math.max(area.top, viewTop);
  let bottom = Math.min(area.bottom, viewBottom);
  const header = headerOf(page);
  if (header) top = Math.max(top, header.getBoundingClientRect().bottom);
  const footer = footerOf(box, page);
  if (footer) bottom = Math.min(bottom, footer.getBoundingClientRect().top);
  return { top, left: area.left, width: area.width, height: Math.max(0, bottom - top) };
}

let layerDefined = false;
let active = null; // the expanded controller (not a chat composer)
let lastExpanded = null;

function defineLayer() {
  if (layerDefined || typeof window.defineLayer !== 'function') return;
  layerDefined = true;
  window.defineLayer(LAYER, {
    open() {
      if (lastExpanded && rendered(lastExpanded.box)) lastExpanded.expand({ fromHistory: true });
    },
    close() {
      if (active) active.collapse({ fromHistory: true });
    },
  });
}

const mounted = new WeakMap();

// field: the textarea, or the contenteditable editor. mirror: the hidden
// field an editor copies its text into (its text is read from there).
export function mountFieldExpand(field, { mirror = null } = {}) {
  if (!field || field.nodeType !== 1 || mounted.has(field)) return null;
  const multiLine = field.tagName === 'TEXTAREA' || field.isContentEditable || field.getAttribute('contenteditable') === 'true';
  if (!multiLine || inChatComposer(field)) return null;
  const box = boxOf(field);
  const anchor = field.parentElement;
  if (!box || !anchor) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'field-expand-btn';
  field.after(button);
  box.classList.add('field-expand-box');
  try {
    if (getComputedStyle(anchor).position === 'static') anchor.classList.add('field-expand-anchor');
  } catch { /* no layout yet */ }

  const counter = descendants(box, (el) => el.classList.contains('hcs-byte-counter'))[0] || null;
  const state = { expanded: false, look: '', placeholder: null, scrolls: [], path: [], stop: [] };
  const entry = { collapse: () => controller.collapse() };

  const hasText = () => {
    if (mirror) return String(mirror.value || '') !== '';
    if (field.tagName === 'TEXTAREA') return String(field.value || '') !== '';
    return String(field.textContent || '') !== '';
  };

  // The button sits in the field's top right corner, wherever the field is
  // inside its parent (a label above it, a counter below).
  const placeButton = () => {
    if (!button.classList.contains('is-shown')) return;
    const right = (anchor.clientWidth || 0) - ((field.offsetLeft || 0) + (field.offsetWidth || 0));
    button.style.setProperty('--fx-field-top', `${field.offsetTop || 0}px`);
    button.style.setProperty('--fx-field-right', `${Math.max(0, right)}px`);
  };

  // Runs on every key, so it writes only when something changed: a write
  // inside these pages restyles the page (chatcomposer.js).
  const paint = () => {
    const shown = state.expanded || hasText();
    const look = `${shown ? 1 : 0}${state.expanded ? 1 : 0}`;
    if (state.look === look) return;
    state.look = look;
    button.classList.toggle('is-shown', shown);
    field.classList.toggle('has-field-expand', shown);
    const label = state.expanded ? 'Exit full screen' : 'Full screen';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', state.expanded ? 'true' : 'false');
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + (state.expanded ? COLLAPSE_ICON : EXPAND_ICON) + '</svg>';
    placeButton();
  };

  let placeQueued = false;
  const place = () => {
    if (!state.expanded) return;
    const origin = fixedOrigin(box);
    const frame = origin.el ? clipFrame(expandFrame(box), origin.el) : expandFrame(box);
    box.style.setProperty('--fx-top', `${frame.top - origin.y}px`);
    box.style.setProperty('--fx-left', `${frame.left - origin.x}px`);
    box.style.setProperty('--fx-width', `${frame.width}px`);
    box.style.setProperty('--fx-height', `${frame.height}px`);
    placeButton();
  };
  const queuePlace = () => {
    if (placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => {
      placeQueued = false;
      if (!state.expanded) return;
      // The page closed under it by a path that did not collapse it first.
      if (!rendered(box.parentElement)) {
        controller.collapse();
        return;
      }
      place();
    });
  };

  const scrollParents = () => {
    const list = [];
    for (let el = box.parentElement; el && el.nodeType === 1; el = el.parentElement) {
      if ((el.scrollHeight || 0) > (el.clientHeight || 0) || el.scrollTop) list.push([el, el.scrollTop || 0]);
    }
    return list;
  };

  const caretAtEnd = () => {
    if (field.tagName === 'TEXTAREA') return field.selectionStart >= String(field.value || '').length;
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || !sel.focusNode || !field.contains(sel.focusNode)) return false;
    const range = document.createRange();
    range.selectNodeContents(field);
    range.setStart(sel.focusNode, sel.focusOffset);
    return range.toString() === '';
  };

  const watch = () => {
    const page = pageOf(box);
    const header = headerOf(page);
    const footer = footerOf(box, page);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(queuePlace);
      for (const el of [page, header, footer, box.parentElement].filter(Boolean)) observer.observe(el);
      state.stop.push(() => observer.disconnect());
    }
    const onWindow = () => queuePlace();
    window.addEventListener('resize', onWindow);
    document.addEventListener('scroll', onWindow, true);
    state.stop.push(() => {
      window.removeEventListener('resize', onWindow);
      document.removeEventListener('scroll', onWindow, true);
    });
    const view = window.visualViewport;
    if (view) {
      view.addEventListener('resize', onWindow);
      view.addEventListener('scroll', onWindow);
      state.stop.push(() => {
        view.removeEventListener('resize', onWindow);
        view.removeEventListener('scroll', onWindow);
      });
    }
    // A send from full screen sends as usual, then closes it, unless the
    // byte limit blocked it.
    for (const send of descendants(box, (el) => el.dataset && el.dataset.expandSend !== undefined)
      .concat(descendants(footer, (el) => el.dataset && el.dataset.expandSend !== undefined))) {
      const onSend = () => {
        if (send.disabled || send.classList.contains('hcs-send-blocked')) return;
        queueMicrotask(() => controller.collapse());
      };
      send.addEventListener('click', onSend);
      state.stop.push(() => send.removeEventListener('click', onSend));
    }
  };

  const controller = {
    field,
    box,
    button,
    get expanded() { return state.expanded; },
    expand({ fromHistory = false } = {}) {
      if (state.expanded || !rendered(box)) return;
      claimExpanded(entry);
      const focused = document.activeElement === field;
      state.scrolls = scrollParents();
      const placeholder = document.createElement('div');
      placeholder.className = 'field-expand-placeholder';
      const cs = getComputedStyle(box);
      placeholder.style.height = `${box.offsetHeight || 0}px`;
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) placeholder.style[`margin${side}`] = cs[`margin${side}`];
      box.before(placeholder);
      state.placeholder = placeholder;
      // The field fills the box: every parent between them stretches too.
      state.path = [];
      for (let el = field.parentElement; el && el !== box; el = el.parentElement) {
        el.classList.add('field-expand-path');
        state.path.push(el);
      }
      state.expanded = true;
      box.dataset.kbSkip = '1';
      box.classList.add('is-expanded');
      field.classList.add('is-field-expanded');
      active = controller;
      lastExpanded = controller;
      place();
      for (const [el, top] of state.scrolls) el.scrollTop = top;
      watch();
      paint();
      if (!focused) {
        try { field.focus({ preventScroll: true }); } catch { field.focus(); }
      }
      // The caret's line stays in view in the taller box.
      if (caretAtEnd()) field.scrollTop = field.scrollHeight;
      if (fromHistory) return;
      defineLayer();
      if (window.layerOpened) window.layerOpened(LAYER);
    },
    collapse({ fromHistory = false } = {}) {
      if (!state.expanded) return;
      state.expanded = false;
      releaseExpanded(entry);
      if (active === controller) active = null;
      for (const stop of state.stop.splice(0)) stop();
      box.classList.remove('is-expanded');
      field.classList.remove('is-field-expanded');
      delete box.dataset.kbSkip;
      for (const name of ['--fx-top', '--fx-left', '--fx-width', '--fx-height']) box.style.removeProperty(name);
      for (const el of state.path.splice(0)) el.classList.remove('field-expand-path');
      if (state.placeholder) state.placeholder.remove();
      state.placeholder = null;
      for (const [el, top] of state.scrolls.splice(0)) el.scrollTop = top;
      paint();
      if (fromHistory) return;
      if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen(LAYER)) window.layerClosedByUI(LAYER);
    },
    toggle() {
      if (state.expanded) controller.collapse();
      else controller.expand();
    },
    paint,
  };

  // The button never takes focus, so the keyboard stays up.
  const keep = (event) => event.preventDefault();
  button.addEventListener('pointerdown', keep);
  button.addEventListener('mousedown', keep);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    controller.toggle();
  });
  box.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.expanded) return;
    event.preventDefault();
    event.stopPropagation();
    controller.collapse();
  });
  field.addEventListener('input', paint);
  field.addEventListener('focus', paint);
  if (mirror) mirror.addEventListener('input', paint);
  // A draft restored or a box cleared from code fires no input event; the
  // page repaints the counter then.
  if (counter && typeof MutationObserver === 'function') {
    new MutationObserver(paint).observe(counter, { childList: true, characterData: true, subtree: true });
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => placeButton()).observe(field);
  }
  mounted.set(field, controller);
  paint();
  return controller;
}

// The controller mounted on a field (tests, and a page that wants to open
// or close it from code).
export function fieldExpandOf(field) {
  return mounted.get(field) || null;
}
