// fieldexpand.js — full screen for every 18 KB message box.
//
// bytecap.js mounts this on each field it caps (capMessageField /
// capMessageEditor), so any capped box gets it: a textarea, or a plain-text
// contenteditable that mirrors into a hidden field (the Draw text). Single-
// line fields, titles and search never do. The topic and E2EE composers
// keep their own fullscreen (chatcomposer.js) and only share the rules
// below: one box expanded at a time, and a closing page collapses it first.
//
// A button under the box's clear × (fieldclear.js), in the ×'s column,
// shows once the box has text (a box with no ×, or too short for two, has
// it in the counter row, left of the byte counter). It opens the box as a
// page of its own over the whole app (#field-full): a header like the
// app's pages (←, the box's title, and the box's own send button: Save, or
// Draw's Submit buttons), the text filling the rest with the same button
// under the × to come back, and the counter row at the bottom. On a phone
// or any portrait screen it covers the
// screen; on a landscape one it is a centred panel over a dimmed backdrop.
// ←, the button, Escape, Back (the 'fieldfull' history layer), or a send
// button marked data-expand-send closes it. Closing the page closes it
// first.
//
// The pages are containing blocks for fixed boxes (transforms, size
// containers, a backdrop blur) and stacking contexts, so a box cannot
// cover the app from where it sits. While it is out, the box itself moves
// into #field-full (a placeholder keeps its place and the page's layout),
// and its send buttons move into the header (a marker keeps their places);
// closing puts every one back exactly where it was. Only the elements move:
// their listeners, the 18 KB cap, the live counter, paste and the Draw
// text's mirror field go with them. Focus and the caret (or selection) are
// put back after each move, in the same task, so the keyboard stays up;
// keyboardlayout.js pins #field-full above the keyboard like any full-
// screen page. #field-full stops clicks and presses, as the pages do, so a
// tap in it never reaches the document's handlers (CloseALL).
//
// The box is data-expand-box on an ancestor, else the field's parent (the
// field and its counter). Its title is data-expand-title, else the
// field's label.

const PAGE_IDS = new Set([
  'feed-chat', 'popup-settings-card', 'draw-column', 'topic-chat-container', 'encrypted-chat-container',
  'feed-search-page', 'feed-profile', 'feed-settings', 'donate-sheet',
]);
const PAGE_CLASSES = ['feed-menu-page', 'drawer-screen', 'comments-modal', 'picker-sheet'];
const HEADER_CLASSES = ['feed-chat-bar', 'feed-menu-page-bar', 'feed-settings-bar', 'feed-comments-bar'];
const LAYER = 'fieldfull';

const EXPAND_ICON = '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>';
const COLLAPSE_ICON = '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/>';
const BACK_ICON = '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>';

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

// The page the box lives in: the nearest page with a header (Draw's form
// sits in #draw-column inside the #feed-chat page), else the nearest page.
function pageOf(box) {
  let nearest = null;
  for (let el = box.parentElement; el && el.nodeType === 1; el = el.parentElement) {
    if (!isPage(el)) continue;
    if (!nearest) nearest = el;
    if (headerOf(el)) return el;
  }
  return nearest;
}

// An action row beside the box or one of its parents (Draw's Submit row).
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

const isSend = (el) => !!(el.dataset && el.dataset.expandSend !== undefined);

// Put `node` where `mark` stands, and drop the mark.
function putBack(node, mark) {
  const parent = mark && mark.parentElement;
  if (!parent) return false;
  parent.insertBefore(node, mark);
  mark.remove();
  return true;
}

function marker() {
  return typeof document.createComment === 'function'
    ? document.createComment('field-expand')
    : document.createElement('span');
}

// --- The full-screen page (one, shared) ---------------------------------
let host = null;
let active = null; // the expanded controller (not a chat composer)
let lastExpanded = null;

function svg(paths) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}

function ensureHost() {
  if (host) return host;
  const root = document.createElement('div');
  root.id = 'field-full';
  root.className = 'field-full';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'field-full-title');
  const panel = document.createElement('div');
  panel.className = 'field-full-panel';
  const bar = document.createElement('div');
  bar.className = 'feed-chat-bar field-full-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'feed-chat-back field-full-back';
  back.setAttribute('aria-label', 'Back');
  back.title = 'Back';
  back.innerHTML = svg(BACK_ICON);
  const title = document.createElement('div');
  title.className = 'feed-chat-title field-full-title';
  title.id = 'field-full-title';
  const actions = document.createElement('div');
  actions.className = 'field-full-actions';
  bar.append(back, title, actions);
  const body = document.createElement('div');
  body.className = 'field-full-body';
  panel.append(bar, body);
  root.appendChild(panel);
  // Like the pages: a tap or a press in here stays here (CloseALL and the
  // drawer's outside taps listen on the document). The backdrop does
  // nothing.
  root.addEventListener('click', (event) => event.stopPropagation());
  root.addEventListener('pointerdown', (event) => event.stopPropagation());
  // ← never takes focus, so the keyboard stays up while it closes.
  const keep = (event) => event.preventDefault();
  back.addEventListener('pointerdown', keep);
  back.addEventListener('mousedown', keep);
  back.addEventListener('click', (event) => {
    event.preventDefault();
    if (active) active.collapse();
  });
  // Escape closes this page only. The pages' own Escape handlers listen on
  // the document in the capture phase (the drawer's would close the page
  // under it), so this one takes the key first, on the window.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !active || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    active.collapse();
  }, true);
  document.body.appendChild(root);
  host = { root, panel, bar, back, title, actions, body };
  return host;
}

// --- Closing: the opening played backwards -------------------------------
// #field-full.is-closing fades the page out and the panel glides back down
// (style.css), then the box goes back as it always did. One box at a time:
// the page is shared. CSS decides: with no animation (reduced motion) it
// closes at once. animationend can go missing, so a timeout of the
// animation's length (and a frame) ends it too.
let closing = null;

function animationMs(el, name) {
  let cs;
  try { cs = getComputedStyle(el); } catch { return 0; }
  if (!String(cs.animationName || '').split(',').map((s) => s.trim()).includes(name)) return 0;
  const seconds = (value) => {
    const v = String(value || '').trim();
    return v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v);
  };
  const ms = (seconds(cs.animationDuration) + Math.max(0, seconds(cs.animationDelay) || 0)) * 1000;
  return Number.isFinite(ms) ? ms : 0;
}

function startClosing(controller, fromHistory, finish) {
  if (!host || host.root.hidden) return false;
  const { root, panel } = host;
  root.classList.add('is-closing');
  const ms = animationMs(panel, 'composerExpandOut');
  if (!(ms > 0)) {
    root.classList.remove('is-closing');
    return false;
  }
  const job = { controller, fromHistory, finish, timer: 0, onEnd: null };
  job.onEnd = (event) => {
    if (closing === job && event.target === panel && event.animationName === 'composerExpandOut') endClosing(true);
  };
  root.addEventListener('animationend', job.onEnd);
  job.timer = setTimeout(() => {
    if (closing === job) endClosing(true);
  }, ms + 50);
  closing = job;
  return true;
}

// The box on its way out: put back now (run), or kept open (not).
function endClosing(run) {
  const job = closing;
  if (!job) return;
  closing = null;
  clearTimeout(job.timer);
  if (host) {
    host.root.removeEventListener('animationend', job.onEnd);
    host.root.classList.remove('is-closing');
  }
  if (run) job.finish({ fromHistory: job.fromHistory });
}

let layerDefined = false;

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
  // edited: typed in while open. inline: a textarea's own inline height
  // before it opened ({ value, priority }), put back after an edit.
  const state = { expanded: false, look: '', placeholder: null, scrolls: [], path: [], moved: [], stop: [], edited: false, inline: null };
  // Another box taking the full screen, or a page closing under it, puts it
  // back at once: that page's history step comes right after this one's.
  const entry = { collapse: () => controller.collapse({ instant: true }) };

  const hasText = () => {
    if (mirror) return String(mirror.value || '') !== '';
    if (field.tagName === 'TEXTAREA') return String(field.value || '') !== '';
    return String(field.textContent || '') !== '';
  };

  // The button stands under the field's clear × (fieldclear.js), in its
  // column: centred on it, the size and look of its face (the × itself when
  // it is a chip, as Swap bio's, else its round ::before face), one --ui-gap
  // (else 0.5em) below it. The × already keeps the text out of that column
  // (its right padding). In full screen, a × hidden by an emptied text
  // leaves the button where it stood, so the way out stays put.
  // With no × to stand under (a box without one, Draw's text; or a field too
  // short for two, one line) it sits in the counter's row, on its left, as
  // far in as the counter is from the right, and as tall as the counter's
  // text (1.6em of its font). The counter shares the field's parent in every
  // box; a box without one gets a small row of its own under the field.
  const placed = {};
  const setPlace = (name, value) => {
    if (placed[name] === value) return;
    placed[name] = value;
    button.style.setProperty(name, value);
  };
  const setClass = (name, on) => {
    if (button.classList.contains(name) !== on) button.classList.toggle(name, on);
  };
  const px = (value) => `${Math.round(value * 100) / 100}px`;
  let resize = null;
  let watchedClear = null;
  // The last spot under the ×, from the field's top right: inline, full screen.
  const spots = [null, null];

  const clearOf = () => {
    for (const el of anchor.children) {
      if (el.classList.contains('field-clear')) return el;
    }
    return null;
  };
  const alpha = (color) => {
    const value = String(color || '').trim();
    if (value === 'transparent') return 0;
    const match = /^rgba?\(([^)]*)\)$/.exec(value);
    if (!match) return 1;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length > 3 ? parseFloat(parts[3]) : 1;
  };
  // The ×'s face in the anchor's box, in layout px (a scale on a parent,
  // the zoomIn entrance, is taken out of the rects).
  const faceOf = (clear) => {
    if (!clear || clear.hidden || !rendered(clear)) return null;
    const a = anchor.getBoundingClientRect();
    const c = clear.getBoundingClientRect();
    const k = anchor.offsetWidth > 0 && a.width > 0 ? a.width / anchor.offsetWidth : 1;
    const left = (c.left - a.left) / k - anchor.clientLeft;
    const top = (c.top - a.top) / k - anchor.clientTop;
    const cs = getComputedStyle(clear);
    const glyph = parseFloat(getComputedStyle(clear, '::after').width) || 0;
    // Its colours are copied only at rest (not ↶, hovered or pressed).
    const rest = !clear.classList.contains('is-undo') && !clear.matches(':hover, :active');
    if ((parseFloat(cs.borderTopWidth) || 0) > 0 || alpha(cs.backgroundColor) > 0) {
      const w = c.width / k;
      const h = c.height / k;
      const size = Math.min(w, h);
      if (!(size > 0)) return null;
      const look = rest ? { bg: cs.backgroundColor, border: `${cs.borderTopWidth} solid ${cs.borderTopColor}`, color: cs.color, glyph } : null;
      return { cx: left + w / 2, bottom: top + h, size, look };
    }
    const face = getComputedStyle(clear, '::before');
    const size = parseFloat(face.width) || 0;
    if (!(size > 0)) return null;
    const cx = left + clear.clientLeft + (parseFloat(face.left) || clear.clientWidth / 2);
    const cy = top + clear.clientTop + (parseFloat(face.top) || clear.clientHeight / 2);
    const look = rest ? { bg: face.backgroundColor, border: '0px solid transparent', color: cs.color, glyph } : null;
    return { cx, bottom: cy + size / 2, size, look };
  };
  // --ui-gap as px (the button carries it in scroll-margin-top, style.css),
  // else half the box's text size.
  const gapPx = () => {
    let gap = 0;
    try { gap = parseFloat(getComputedStyle(button).scrollMarginTop) || 0; } catch { gap = 0; }
    if (gap > 0) return gap;
    let font = 0;
    try { font = parseFloat(getComputedStyle(anchor).fontSize) || 0; } catch { font = 0; }
    return font * 0.5;
  };
  const stackSpot = () => {
    const clear = clearOf();
    if (clear && clear !== watchedClear && resize) {
      if (watchedClear) resize.unobserve(watchedClear);
      resize.observe(clear);
      watchedClear = clear;
    }
    const slot = state.expanded ? 1 : 0;
    const fieldTop = field.offsetTop || 0;
    const fieldRight = (field.offsetLeft || 0) + (field.offsetWidth || 0);
    const face = faceOf(clear);
    if (face) {
      const before = spots[slot];
      spots[slot] = {
        fromRight: fieldRight - face.cx,
        below: face.bottom - fieldTop,
        size: face.size,
        look: face.look || (before && before.look) || null,
      };
    } else if (!state.expanded || hasText()) {
      // No × beside this text (none in the box, or the field is too narrow).
      return null;
    }
    const spot = spots[slot];
    if (!spot) return null;
    const top = fieldTop + spot.below + gapPx();
    let border = 0;
    try { border = parseFloat(getComputedStyle(field).borderBottomWidth) || 0; } catch { border = 0; }
    // Two must fit in the field: under it is the counter's row.
    if (top + spot.size > fieldTop + (field.offsetHeight || 0) - border + 0.5) return null;
    return { top, left: fieldRight - spot.fromRight - spot.size / 2, size: spot.size, look: spot.look };
  };

  const placeButton = () => {
    if (!button.classList.contains('is-shown')) return;
    const spot = stackSpot();
    setClass('is-stacked', !!spot);
    if (spot) {
      setClass('is-rowless', false);
      setPlace('--fx-stack-top', px(spot.top));
      setPlace('--fx-stack-left', px(spot.left));
      setPlace('--fx-stack-size', px(spot.size));
      if (spot.look) {
        setPlace('--fx-face-bg', spot.look.bg);
        setPlace('--fx-face-border', spot.look.border);
        setPlace('--fx-face-color', spot.look.color);
        if (spot.look.glyph > 0) setPlace('--fx-glyph', px(spot.look.glyph));
      }
      return;
    }
    const inRow = !!(counter && counter.parentElement === anchor && rendered(counter));
    setClass('is-rowless', !inRow);
    if (!inRow) return;
    const right = (anchor.clientWidth || 0) - ((counter.offsetLeft || 0) + (counter.offsetWidth || 0));
    let font = 0;
    try { font = parseFloat(getComputedStyle(counter).fontSize) || 0; } catch { font = 0; }
    setPlace('--fx-row-mid', `${(counter.offsetTop || 0) + (counter.offsetHeight || 0) / 2}px`);
    setPlace('--fx-row-left', `${Math.max(0, right)}px`);
    if (font > 0) setPlace('--fx-row-font', `${font}px`);
  };
  // The × shows, hides and moves in fieldclear.js's frame, which an input
  // queues first: this one reads after it.
  let placeQueued = false;
  const queuePlace = () => {
    if (placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => {
      placeQueued = false;
      placeButton();
    });
  };

  // Runs on every key, so it writes only when something changed: a write
  // inside these pages restyles the page (chatcomposer.js).
  const paint = () => {
    queuePlace();
    const shown = state.expanded || hasText();
    const look = `${shown ? 1 : 0}${state.expanded ? 1 : 0}`;
    if (state.look === look) return;
    state.look = look;
    button.classList.toggle('is-shown', shown);
    const label = state.expanded ? 'Exit full screen' : 'Full screen';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', state.expanded ? 'true' : 'false');
    button.innerHTML = svg(state.expanded ? COLLAPSE_ICON : EXPAND_ICON);
    placeButton();
  };

  const scrollParents = () => {
    const list = [];
    for (let el = box.parentElement; el && el.nodeType === 1; el = el.parentElement) {
      if ((el.scrollHeight || 0) > (el.clientHeight || 0) || el.scrollTop) list.push([el, el.scrollTop || 0]);
    }
    return list;
  };

  // The caret (or selection), kept across a move: a moved node loses the
  // focus and, in an editor, the selection's place in its text.
  const textLength = (node, offset) => {
    const range = document.createRange();
    range.selectNodeContents(field);
    range.setEnd(node, offset);
    return range.toString().length;
  };
  const textPoint = (target) => {
    let seen = 0;
    let last = null;
    const walker = document.createTreeWalker(field, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.data.length;
      if (seen + length >= target) return [node, target - seen];
      seen += length;
      last = node;
    }
    return last ? [last, last.data.length] : [field, field.childNodes.length];
  };
  const saveCaret = () => {
    if (document.activeElement !== field) return null;
    if (field.tagName === 'TEXTAREA') {
      return { start: field.selectionStart, end: field.selectionEnd, dir: field.selectionDirection };
    }
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || typeof document.createRange !== 'function') return { start: null };
    const range = sel.getRangeAt(0);
    if (!field.contains(range.startContainer) || !field.contains(range.endContainer)) return { start: null };
    return { start: textLength(range.startContainer, range.startOffset), end: textLength(range.endContainer, range.endOffset) };
  };
  const restoreCaret = (saved) => {
    if (!saved) return;
    if (document.activeElement !== field) {
      try { field.focus({ preventScroll: true }); } catch { field.focus(); }
    }
    if (saved.start == null) return;
    if (field.tagName === 'TEXTAREA') {
      try { field.setSelectionRange(saved.start, saved.end, saved.dir || 'none'); } catch { /* not a text field */ }
      return;
    }
    const sel = window.getSelection && window.getSelection();
    if (!sel || typeof document.createRange !== 'function' || typeof document.createTreeWalker !== 'function') return;
    const range = document.createRange();
    range.setStart(...textPoint(saved.start));
    range.setEnd(...textPoint(saved.end));
    sel.removeAllRanges();
    sel.addRange(range);
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

  let checkQueued = false;
  const queueCheck = () => {
    if (checkQueued) return;
    checkQueued = true;
    requestAnimationFrame(() => {
      checkQueued = false;
      // The page closed under it by a path that did not collapse it first.
      if (state.expanded && !rendered(state.placeholder)) controller.collapse({ instant: true });
    });
  };

  const watch = (page, sends) => {
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(queueCheck);
      for (const el of [page, state.placeholder].filter(Boolean)) observer.observe(el);
      state.stop.push(() => observer.disconnect());
    }
    // A send from full screen sends as usual, then closes it, unless the
    // byte limit blocked it.
    for (const send of sends) {
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
      if (closing && closing.controller === controller) {
        // Opened again on its way out: it stays open. Back already took its
        // history step, so it gets one again.
        const gone = closing.fromHistory;
        endClosing(false);
        if (gone && !fromHistory) {
          defineLayer();
          if (window.layerOpened) window.layerOpened(LAYER);
        }
        return;
      }
      if (state.expanded || !rendered(box)) return;
      // Another box still on its way out goes back first: the page is shared.
      if (closing) endClosing(true);
      claimExpanded(entry);
      const page = pageOf(box);
      const sends = descendants(box, isSend).concat(descendants(footerOf(box, page), isSend));
      const caret = saveCaret() || { start: null };
      state.scrolls = scrollParents();
      const view = ensureHost();
      // The box's place, at its height and margins, keeps the page's layout.
      const placeholder = document.createElement('div');
      placeholder.className = 'field-expand-placeholder';
      const cs = getComputedStyle(box);
      placeholder.style.height = `${box.offsetHeight || 0}px`;
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) placeholder.style[`margin${side}`] = cs[`margin${side}`];
      box.before(placeholder);
      state.placeholder = placeholder;
      // The header: the box's title and its own send buttons.
      view.title.textContent = (box.dataset && box.dataset.expandTitle) || field.getAttribute('aria-label') || 'Message';
      state.moved = [];
      for (const send of sends) {
        const mark = marker();
        send.before(mark);
        view.actions.appendChild(send);
        state.moved.push([send, mark]);
      }
      // The field fills the page: every parent between them stretches too.
      state.path = [];
      for (let el = field.parentElement; el && el !== box; el = el.parentElement) {
        el.classList.add('field-expand-path');
        state.path.push(el);
      }
      // An auto-growing textarea writes its height inline on every input:
      // the one it has in its row is kept for the way back.
      if (field.tagName === 'TEXTAREA') {
        state.inline = { value: field.style.getPropertyValue('height'), priority: field.style.getPropertyPriority('height') };
      }
      state.edited = false;
      state.expanded = true;
      box.classList.add('is-expanded');
      field.classList.add('is-field-expanded');
      view.body.appendChild(box);
      view.root.classList.toggle('has-actions', state.moved.length > 0);
      view.root.hidden = false;
      document.documentElement.classList.add('field-full-open');
      active = controller;
      lastExpanded = controller;
      for (const [el, top] of state.scrolls) el.scrollTop = top;
      watch(page, sends);
      paint();
      // It opens focused, the caret where it was (else where the field puts it).
      restoreCaret(caret);
      // The caret's line stays in view in the taller box.
      if (caretAtEnd()) field.scrollTop = field.scrollHeight;
      if (fromHistory) return;
      defineLayer();
      if (window.layerOpened) window.layerOpened(LAYER);
    },
    // instant: no closing animation (another box, a page closing under it).
    collapse({ fromHistory = false, instant = false } = {}) {
      if (closing && closing.controller === controller) {
        // A second way out on its way out: nothing more, unless it must be now.
        if (fromHistory) closing.fromHistory = true;
        if (instant) endClosing(true);
        return;
      }
      if (!state.expanded) return;
      if (closing) endClosing(true);
      if (!instant && startClosing(controller, fromHistory, finishCollapse)) return;
      finishCollapse({ fromHistory });
    },
    toggle() {
      // On its way out it counts as closed: the button keeps it open.
      if (closing && closing.controller === controller) controller.expand();
      else if (state.expanded) controller.collapse();
      else controller.expand();
    },
    paint,
  };

  // Every element back where it was, as it always closed.
  function finishCollapse({ fromHistory = false } = {}) {
    if (!state.expanded) return;
    const caret = saveCaret();
    state.expanded = false;
    releaseExpanded(entry);
    if (active === controller) active = null;
    for (const stop of state.stop.splice(0)) stop();
    // Every element goes back where it was.
    for (const [send, mark] of state.moved.splice(0)) {
      if (!putBack(send, mark)) send.remove();
    }
    if (!state.placeholder || !putBack(box, state.placeholder)) box.remove();
    state.placeholder = null;
    box.classList.remove('is-expanded');
    field.classList.remove('is-field-expanded');
    for (const el of state.path.splice(0)) el.classList.remove('field-expand-path');
    if (host && !active) {
      host.root.hidden = true;
      host.root.classList.remove('has-actions');
      host.title.textContent = '';
      document.documentElement.classList.remove('field-full-open');
    }
    for (const [el, top] of state.scrolls.splice(0)) el.scrollTop = top;
    // Typed in while open, a textarea's own input listeners measured it in
    // the page: its auto-height wrote the page's height inline and the ×
    // was placed there. Its row height goes back, and once it is home one
    // input event lets the box's listeners fit it to the row again.
    const refit = field.tagName === 'TEXTAREA' && state.edited;
    if (refit && state.inline) {
      if (state.inline.value) field.style.setProperty('height', state.inline.value, state.inline.priority);
      else field.style.removeProperty('height');
    }
    paint();
    restoreCaret(caret);
    if (refit) field.dispatchEvent(new Event('input', { bubbles: true }));
    state.edited = false;
    state.inline = null;
    if (fromHistory) return;
    if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen(LAYER)) window.layerClosedByUI(LAYER);
  }

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
  field.addEventListener('input', () => {
    if (state.expanded) state.edited = true;
  });
  field.addEventListener('focus', paint);
  if (mirror) mirror.addEventListener('input', paint);
  // A draft restored or a box cleared from code fires no input event; the
  // page repaints the counter then.
  if (counter && typeof MutationObserver === 'function') {
    new MutationObserver(paint).observe(counter, { childList: true, characterData: true, subtree: true });
  }
  // The counter row and the × move when the field grows or the box changes
  // size; the × is watched too once it is there (it shows and hides).
  if (typeof ResizeObserver === 'function') {
    resize = new ResizeObserver(() => placeButton());
    resize.observe(field);
    if (anchor !== field) resize.observe(anchor);
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
