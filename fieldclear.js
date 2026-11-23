// An × inside the right end of every text field. It shows while the field
// has text; a tap empties the field and keeps the keyboard up when it was
// up. After a long text (LONG_CHARS or more, or more than one line) the
// same spot offers ↶ for UNDO_MS: a toast would sit under the keyboard.
//
// The × is a real button, inserted right after its field once the field
// first has text, and placed from layout offsets (they ignore transforms,
// so a field's zoomIn entrance does not throw it off). Being a sibling, it
// scrolls with the field natively. It is Swap bio's round chip (.is-chip):
// its size, its inset from the field's right and its even gap come from
// style.css, resolved on the button; a short field fits a smaller chip with
// the same gap above and below. Where the field already has tools at its
// right end the CSS places it instead (--clear-placed: 1): the Load field,
// where it takes Paste's spot, Swap bio, the reference chip, and the chat
// room fields, where 👥 steps left.
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

// The text must not run under the ×: at least the chip and a gap on each
// side of it as right padding while it shows (Swap bio's). The field's own
// padding wins when it is larger; its inline padding comes back on hide.
function holdPad(field, entry, need) {
  if (!entry.pad) {
    entry.pad = {
      value: field.style.getPropertyValue('padding-right'),
      priority: field.style.getPropertyPriority('padding-right'),
    };
  }
  setInline(field, entry.pad);
  const own = parseFloat(getComputedStyle(field).paddingRight) || 0;
  if (own >= need) return false;
  field.style.setProperty('padding-right', need + 'px', 'important');
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

  // Read: placement mode, and the chip's sizes as style.css resolves them on
  // the button (after the attribute took effect).
  for (const plan of plans) {
    if (!plan.visible) continue;
    const entry = entries.get(plan.field);
    const cs = getComputedStyle(entry.btn);
    plan.css = cs.getPropertyValue('--clear-placed').trim() === '1';
    if (plan.css) continue;
    plan.sizes = {
      full: parseFloat(cs.scrollMarginTop) || 0,
      inset: parseFloat(cs.scrollMarginRight) || 0,
      even: Math.max(0, parseFloat(cs.scrollMarginBottom) || 0),
    };
    plan.chip = chipFor(plan.field, plan.sizes);
  }
  for (const plan of plans) {
    if (!plan.visible) continue;
    const { field } = plan;
    const entry = entries.get(field);
    if (plan.css) {
      const s = entry.btn.style;
      for (const prop of ['left', 'top', 'width', 'height', '--clear-face', '--clear-face-y']) s.removeProperty(prop);
      if (entry.btn.classList.contains('is-chip')) entry.btn.classList.remove('is-chip');
      if (dropPad(field, entry)) refit(field);
      continue;
    }
    if (!entry.btn.classList.contains('is-chip')) entry.btn.classList.add('is-chip');
    if (!hasOrigin(entry.btn)) {
      entry.btn.style.setProperty('left', '0px', 'important');
      entry.btn.style.setProperty('top', '0px', 'important');
    }
    // Padding is read and set again only when the field first shows the ×,
    // its width changed (a new context may bring its own padding) or the
    // chip did.
    const need = px2(plan.chip + 2 * plan.sizes.inset);
    if (plan.fresh || entry.padW !== plan.w || entry.padNeed !== need) {
      entry.padW = plan.w;
      entry.padNeed = need;
      if (holdPad(field, entry, need)) refit(field);
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
    const { w, h } = boxOf(field, cs);
    const inner = Math.max(0, h - bt - bb);
    // The field may have re-fitted to its padding: size it again.
    const size = chipFor(field, plan.sizes);
    const room = Math.max(0, (inner - size) / 2);
    const edge = Math.min(plan.sizes.even, room);
    // An input centres it. A textarea keeps it level with its first line
    // (and there as the text grows), inside the field by the even gap.
    let dy = bt + room;
    if (field.tagName === 'TEXTAREA') {
      const line = bt + pt + lineH / 2;
      dy = Math.min(Math.max(bt + edge, line - size / 2), bt + inner - size - edge);
    }
    // Its right edge the inset in from the field's inner right edge.
    const dx = w - br - plan.sizes.inset - size;
    // From the screen rects of the two siblings, in layout px: a scale on a
    // parent (a field's zoomIn entrance) is taken back out, and fractions
    // are kept (whole-pixel offsets would put it off its even gaps).
    const f = field.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const k = w > 0 && f.width > 0 ? f.width / w : 1;
    const tx = (parseFloat(btn.style.left) || 0) + (f.left - b.left) / k + dx;
    const ty = (parseFloat(btn.style.top) || 0) + (f.top - b.top) / k + dy;
    plan.place = { left: px2(tx), top: px2(ty), size: px2(size) };
  }
  for (const plan of plans) {
    if (!plan.place) continue;
    const { btn } = entries.get(plan.field);
    const s = btn.style;
    const left = plan.place.left + 'px';
    const top = plan.place.top + 'px';
    const size = plan.place.size + 'px';
    if (s.left !== left) s.setProperty('left', left, 'important');
    if (s.top !== top) s.setProperty('top', top, 'important');
    if (s.width !== size) s.setProperty('width', size, 'important');
    if (s.height !== size) s.setProperty('height', size, 'important');
    // The chip's face is the button itself (style.css .is-chip).
    if (s.getPropertyValue('--clear-face') !== '') s.removeProperty('--clear-face');
    if (s.getPropertyValue('--clear-face-y') !== '') s.removeProperty('--clear-face-y');
  }
}

const px2 = (value) => Math.round(value * 100) / 100;

// The field's border box in layout px, with its fractions (offsetWidth and
// offsetHeight are whole pixels).
function boxOf(field, cs) {
  let w = parseFloat(cs.width) || 0;
  let h = parseFloat(cs.height) || 0;
  if (cs.boxSizing !== 'border-box') {
    const sum = (...names) => names.reduce((total, name) => total + (parseFloat(cs[name]) || 0), 0);
    w += sum('paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth');
    h += sum('paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth');
  }
  return { w: w > 0 ? w : field.offsetWidth, h: h > 0 ? h : field.offsetHeight };
}

// Swap bio's chip, or for a field too short for it, one that fits with the
// same even gap above and below.
function chipFor(field, sizes) {
  const cs = getComputedStyle(field);
  const inner = Math.max(0, boxOf(field, cs).h - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.borderBottomWidth) || 0));
  const full = sizes.full > 0 ? sizes.full : inner;
  let chip = Math.min(full, inner - 2 * sizes.even);
  if (!(chip > 0)) chip = Math.min(full, inner);
  return Math.max(0, chip);
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
