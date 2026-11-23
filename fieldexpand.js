// fieldexpand.js — full screen for every 18 KB message box.
//
// bytecap.js mounts this on each field it caps (capMessageField /
// capMessageEditor), so any capped box gets it: a textarea, or a plain-text
// contenteditable that mirrors into a hidden field (the Draw text). Single-
// line fields, titles and search never do. The topic and E2EE composers
// keep their own fullscreen (chatcomposer.js) and only share the rules
// below: one box expanded at a time, and a closing page collapses it first.
//
// A button in the box's counter row (left of the byte counter) shows once
// the box has text. It opens the box as a page of its own over the whole
// app (#field-full): a header like the app's pages (←, the box's title,
// and the box's own send button: Save, or Draw's Submit buttons), the
// text filling the rest, and the counter row at the bottom with the same
// button to come back. On a phone or any portrait screen it covers the
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
  const state = { expanded: false, look: '', placeholder: null, scrolls: [], path: [], moved: [], stop: [] };
  const entry = { collapse: () => controller.collapse() };

  const hasText = () => {
    if (mirror) return String(mirror.value || '') !== '';
    if (field.tagName === 'TEXTAREA') return String(field.value || '') !== '';
    return String(field.textContent || '') !== '';
  };

  // The button sits in the counter's row, on its left, as far in as the
  // counter is from the right, and as tall as the counter's text (1.6em of
  // its font). The counter shares the field's parent in every box; a box
  // without one gets a small row of its own under the field.
  const placed = {};
  const setPlace = (name, value) => {
    if (placed[name] === value) return;
    placed[name] = value;
    button.style.setProperty(name, value);
  };
  const placeButton = () => {
    if (!button.classList.contains('is-shown')) return;
    const inRow = !!(counter && counter.parentElement === anchor && rendered(counter));
    if (button.classList.contains('is-rowless') === inRow) button.classList.toggle('is-rowless', !inRow);
    if (!inRow) return;
    const right = (anchor.clientWidth || 0) - ((counter.offsetLeft || 0) + (counter.offsetWidth || 0));
    let font = 0;
    try { font = parseFloat(getComputedStyle(counter).fontSize) || 0; } catch { font = 0; }
    setPlace('--fx-row-mid', `${(counter.offsetTop || 0) + (counter.offsetHeight || 0) / 2}px`);
    setPlace('--fx-row-left', `${Math.max(0, right)}px`);
    if (font > 0) setPlace('--fx-row-font', `${font}px`);
  };

  // Runs on every key, so it writes only when something changed: a write
  // inside these pages restyles the page (chatcomposer.js).
  const paint = () => {
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
      if (state.expanded && !rendered(state.placeholder)) controller.collapse();
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
      if (state.expanded || !rendered(box)) return;
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
    collapse({ fromHistory = false } = {}) {
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
      paint();
      restoreCaret(caret);
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
  // The counter row moves when the field grows or the box changes size.
  if (typeof ResizeObserver === 'function') {
    const resize = new ResizeObserver(() => placeButton());
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
