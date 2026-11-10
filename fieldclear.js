// An × inside the right end of every text field. It shows while the field
// has text; a tap empties the field and keeps the keyboard up when it was
// up. After a long text (LONG_CHARS or more, or more than one line) the
// same spot offers ↶ for UNDO_MS: a toast would sit under the keyboard.
//
// The × is a real button, inserted right after its field once the field
// first has text, and placed from layout offsets (they ignore transforms,
// so a field's zoomIn entrance does not throw it off). Being a sibling, it
// scrolls with the field natively. Where the field already has tools at its
// right end the CSS places it instead (--clear-placed: 1): the Load field,
// where it takes Paste's spot, and the chat room fields, where 👥 steps left.
//
// Left out: fields with their own clear, the message composers, numeric
// fields (inputmode numeric/decimal), the draw coordinates (their right end
// is the pick-on-map button), read-only or disabled fields, fields under
// MIN_WIDTH, and anything inside [data-no-clear].

const SKIP_IDS = new Set([
  'search-input', // search bar: #search-clear-btn
  'feed-search-input', // #feed-search-clear
  'feed-filter-country-input', // .feed-country-clear
  'encrypted-chat-private-key', // .secret-entry-clear
  'user-write-message',
  'user-write-message-encrypted-chat',
  'coordinates-display', // map readout with its copy button
]);
const SKIP_INSIDE = '.draw-coord-wrap, .comments-input-row, .chat-compose, [data-no-clear]';
const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password']);
const MIN_WIDTH = 120;
const HIT_W = 40; // px: the ×'s width, and the text padding it needs
const HIT_H = 44; // px: tallest hit area
const LONG_CHARS = 40;
const UNDO_MS = 5000;

const entries = new WeakMap(); // field -> entry
const live = new Set(); // fields that have text, or show ↶
const parentUse = new Map(); // observed parent -> live fields under it
let queued = false;

function isField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
}

function wanted(field) {
  if (field.readOnly || field.disabled) return false;
  if (field.id && SKIP_IDS.has(field.id)) return false;
  const mode = (field.getAttribute('inputmode') || '').toLowerCase();
  if (mode === 'numeric' || mode === 'decimal') return false;
  return !field.closest(SKIP_INSIDE);
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(refresh);
}

function note(field) {
  if (!isField(field)) return;
  if (field.value === '' && !(entries.get(field) && entries.get(field).undo != null)) {
    if (!live.has(field)) return;
  }
  track(field);
  schedule();
}

const resizes = new ResizeObserver(schedule);

function track(field) {
  if (live.has(field)) return;
  live.add(field);
  resizes.observe(field);
  const parent = field.parentElement;
  if (!parent) return;
  const uses = parentUse.get(parent) || 0;
  if (!uses) resizes.observe(parent);
  parentUse.set(parent, uses + 1);
  const entry = entries.get(field);
  if (entry) entry.parent = parent;
}

function untrack(field) {
  if (!live.delete(field)) return;
  resizes.unobserve(field);
  const entry = entries.get(field);
  const parent = (entry && entry.parent) || field.parentElement;
  if (!parent) return;
  const uses = (parentUse.get(parent) || 1) - 1;
  if (uses > 0) parentUse.set(parent, uses);
  else {
    parentUse.delete(parent);
    resizes.unobserve(parent);
  }
}

// ── The button ──────────────────────────────────────────────────────────
function entryFor(field) {
  let entry = entries.get(field);
  if (entry) return entry;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'field-clear';
  btn.tabIndex = -1;
  btn.hidden = true;
  btn.setAttribute('aria-label', 'Clear');
  // A known origin: offsets are measured from left/top 0, not from where
  // an unplaced absolute box would sit.
  btn.style.setProperty('left', '0px', 'important');
  btn.style.setProperty('top', '0px', 'important');
  // No focus move: the field keeps the caret and the keyboard stays up.
  btn.addEventListener('pointerdown', (event) => event.preventDefault());
  btn.addEventListener('mousedown', (event) => event.preventDefault());
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    press(field);
  });
  entry = { btn, undo: null, timer: 0, pad: null, shown: false, parent: field.parentElement };
  entries.set(field, entry);
  return entry;
}

function fire(field, inputType) {
  let event;
  try {
    event = new InputEvent('input', { bubbles: true, inputType });
  } catch {
    event = new Event('input', { bubbles: true });
  }
  field.dispatchEvent(event);
  // A field that is not being edited gets no blur to send change itself.
  if (document.activeElement !== field) field.dispatchEvent(new Event('change', { bubbles: true }));
}

function endUndo(entry) {
  clearTimeout(entry.timer);
  entry.timer = 0;
  entry.undo = null;
}

function press(field) {
  const entry = entryFor(field);
  if (entry.undo != null && field.value === '') {
    const text = entry.undo;
    endUndo(entry);
    field.value = text;
    fire(field, 'historyUndo');
    schedule();
    return;
  }
  const old = field.value;
  if (old === '') return;
  endUndo(entry);
  field.value = '';
  fire(field, 'deleteContentBackward');
  if (old.length >= LONG_CHARS || /[\r\n]/.test(old)) {
    entry.undo = old;
    entry.timer = setTimeout(() => {
      entry.undo = null;
      entry.timer = 0;
      schedule();
    }, UNDO_MS);
  }
  schedule();
}

// The text must not run under the ×: at least HIT_W of right padding while
// it shows. The field's own inline padding comes back when it hides.
function holdPad(field, entry) {
  if (!entry.pad) {
    entry.pad = {
      value: field.style.getPropertyValue('padding-right'),
      priority: field.style.getPropertyPriority('padding-right'),
    };
  }
  setInline(field, entry.pad);
  const own = parseFloat(getComputedStyle(field).paddingRight) || 0;
  if (own >= HIT_W) return false;
  field.style.setProperty('padding-right', HIT_W + 'px', 'important');
  return true;
}

function dropPad(field, entry) {
  if (!entry.pad) return false;
  setInline(field, entry.pad);
  entry.pad = null;
  return true;
}

function setInline(field, pad) {
  if (pad.value) field.style.setProperty('padding-right', pad.value, pad.priority);
  else field.style.removeProperty('padding-right');
}

// An auto-height textarea (inline height from its oninput) re-fits after
// its padding changes, or a rewrapped last line would be cut off.
function refit(field) {
  if (field.tagName !== 'TEXTAREA' || !field.style.height) return;
  // Not rendered (its panel closed): scrollHeight is 0 and would stick.
  if (!field.getClientRects().length) return;
  field.style.height = '';
  field.style.height = field.scrollHeight + 'px';
}

function hide(field, entry) {
  if (!entry.shown) return;
  entry.shown = false;
  entry.btn.hidden = true;
  field.removeAttribute('data-clear-shown');
  if (dropPad(field, entry)) refit(field);
}

// ── Refresh: one rAF, reads batched before writes ─────────────────────────
function refresh() {
  queued = false;
  const show = [];
  for (const field of [...live]) {
    const entry = entries.get(field);
    if (!field.isConnected) {
      if (entry) hide(field, entry);
      untrack(field);
      continue;
    }
    const undo = !!(entry && entry.undo != null);
    if (undo && field.value !== '') endUndo(entry);
    if (field.value === '' && !(entry && entry.undo != null)) {
      if (entry) hide(field, entry);
      untrack(field);
      continue;
    }
    if (!wanted(field)) {
      if (entry) hide(field, entry);
      continue;
    }
    show.push(field);
  }

  // Read: rendered and wide enough?
  const plans = [];
  for (const field of show) {
    const rendered = field.offsetParent !== null || getComputedStyle(field).position === 'fixed';
    const w = rendered ? field.offsetWidth : 0;
    const visible = rendered && w >= MIN_WIDTH && field.offsetHeight > 0
      && getComputedStyle(field).visibility !== 'hidden';
    plans.push({ field, visible, w });
  }

  // Write: insert, unhide, mark, pad.
  for (const plan of plans) {
    const { field } = plan;
    const entry = entryFor(field);
    if (!plan.visible) {
      hide(field, entry);
      continue;
    }
    const { btn } = entry;
    if (btn.parentNode !== field.parentNode) field.after(btn);
    const undo = entry.undo != null;
    btn.classList.toggle('is-undo', undo);
    btn.setAttribute('aria-label', undo ? 'Undo clear' : 'Clear');
    if (!entry.shown) {
      entry.shown = true;
      btn.hidden = false;
      field.setAttribute('data-clear-shown', '');
      plan.fresh = true;
    }
  }

  // Read: placement mode and padding (after the attribute took effect).
  for (const plan of plans) {
    if (!plan.visible) continue;
    const entry = entries.get(plan.field);
    plan.css = getComputedStyle(entry.btn).getPropertyValue('--clear-placed').trim() === '1';
  }
  for (const plan of plans) {
    if (!plan.visible) continue;
    const { field } = plan;
    const entry = entries.get(field);
    if (plan.css) {
      const s = entry.btn.style;
      for (const prop of ['left', 'top', 'height', '--clear-face', '--clear-face-y']) s.removeProperty(prop);
      if (dropPad(field, entry)) refit(field);
      continue;
    }
    if (!hasOrigin(entry.btn)) {
      entry.btn.style.setProperty('left', '0px', 'important');
      entry.btn.style.setProperty('top', '0px', 'important');
    }
    // Padding is read and set again only when the field first shows the ×
    // or its width changed: a new context may bring its own padding.
    if (plan.fresh || entry.padW !== plan.w) {
      entry.padW = plan.w;
      if (holdPad(field, entry)) refit(field);
    }
  }

  // Read: offsets. Write: place.
  for (const plan of plans) {
    if (!plan.visible || plan.css) continue;
    const { field } = plan;
    const { btn } = entries.get(field);
    const cs = getComputedStyle(field);
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    const pt = parseFloat(cs.paddingTop) || 0;
    const fontSize = parseFloat(cs.fontSize) || 16;
    const lineH = parseFloat(cs.lineHeight) || fontSize * 1.2;
    const w = field.offsetWidth;
    const h = field.offsetHeight;
    const inner = Math.max(0, h - bt - bb);
    const btnH = Math.round(Math.min(HIT_H, inner || h));
    // An input centres its line; a textarea starts at the top, so the face
    // sits on its first line (and stays there as the text grows) while the
    // tap area stays inside the field.
    let dy = (h - btnH) / 2;
    let faceY = btnH / 2;
    if (field.tagName === 'TEXTAREA') {
      const line = bt + pt + lineH / 2;
      dy = Math.min(Math.max(0, line - btnH / 2), Math.max(0, h - btnH));
      faceY = line - dy;
    }
    const room = 2 * Math.min(faceY, btnH - faceY);
    const face = Math.round(Math.max(16, Math.min(24, btnH * 0.55, room)));
    plan.size = { btnH, face, faceY: Math.round(faceY * 2) / 2 };
    let tx;
    let ty;
    if (btn.offsetParent && btn.offsetParent === field.offsetParent) {
      tx = (parseFloat(btn.style.left) || 0) + (field.offsetLeft + w - br - HIT_W) - btn.offsetLeft;
      ty = (parseFloat(btn.style.top) || 0) + (field.offsetTop + dy) - btn.offsetTop;
    } else {
      // Not the same offset parent (a table cell, say): screen rects. A
      // scale on an ancestor could skew these, the offsets above cannot.
      const f = field.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      tx = (parseFloat(btn.style.left) || 0) + (f.right - br - HIT_W) - b.left;
      ty = (parseFloat(btn.style.top) || 0) + (f.top + dy) - b.top;
    }
    plan.place = { left: Math.round(tx * 2) / 2, top: Math.round(ty * 2) / 2 };
  }
  for (const plan of plans) {
    if (!plan.place) continue;
    const { btn } = entries.get(plan.field);
    const s = btn.style;
    const left = plan.place.left + 'px';
    const top = plan.place.top + 'px';
    const height = plan.size.btnH + 'px';
    const face = plan.size.face + 'px';
    const faceY = plan.size.faceY + 'px';
    if (s.left !== left) s.setProperty('left', left, 'important');
    if (s.top !== top) s.setProperty('top', top, 'important');
    if (s.height !== height) s.setProperty('height', height, 'important');
    if (s.getPropertyValue('--clear-face') !== face) s.setProperty('--clear-face', face);
    if (s.getPropertyValue('--clear-face-y') !== faceY) s.setProperty('--clear-face-y', faceY);
  }
}

function hasOrigin(btn) {
  return btn.style.getPropertyValue('left') !== '' && btn.style.getPropertyValue('top') !== '';
}

// ── What wakes a refresh ──────────────────────────────────────────────────
// Code that sets .value directly (Paste, a contact pick, a load) sends no
// input event, so the setter tells us.
for (const Proto of [window.HTMLInputElement, window.HTMLTextAreaElement]) {
  const desc = Proto && Object.getOwnPropertyDescriptor(Proto.prototype, 'value');
  if (!desc || !desc.set || !desc.configurable) continue;
  Object.defineProperty(Proto.prototype, 'value', {
    configurable: true,
    enumerable: desc.enumerable,
    get: desc.get,
    set(next) {
      desc.set.call(this, next);
      note(this);
    },
  });
}

document.addEventListener('input', (event) => note(event.target), true);
document.addEventListener('focusin', (event) => { if (isField(event.target)) schedule(); }, true);
window.addEventListener('resize', schedule);
window.addEventListener('orientationchange', schedule);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

function scan(root) {
  if (isField(root)) {
    note(root);
    return;
  }
  if (!root.querySelectorAll) return;
  for (const field of root.querySelectorAll('input, textarea')) note(field);
}

// New fields (a panel built from JS, a sheet) and fields that moved.
new MutationObserver((records) => {
  let moved = false;
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1 || node.classList.contains('field-clear')) continue;
      scan(node);
      moved = true;
    }
    if (record.removedNodes.length) moved = true;
  }
  if (moved && live.size) schedule();
}).observe(document.documentElement, { childList: true, subtree: true });

scan(document.body || document.documentElement);
