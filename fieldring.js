// fieldring.js — the reading ring (readingring.js) on every text field
// that scrolls: once what you typed is taller than the field, its border
// lights clockwise from the top left as far as you are through it, the
// same as a popup's long text and the Swap bio. Once the text fits again
// the ring goes.
//
// A textarea cannot hold the ring, so it is a sibling: an absolute span
// put on the field's padding box from layout offsets (they ignore
// transforms, so an entrance animation does not throw it off), with the
// ring's SVG backed out over the border. It is placed again whenever the
// field or its parent changes size, the page resizes, or the DOM changes,
// the way fieldclear.js keeps its × on the field.
//
// Fields: every textarea and contenteditable editor you type in. Left out:
// read-only and disabled ones (copy helpers, a measuring twin) and anything
// inside [data-no-ring].

import { brightenRing, createRing, fitRing, paintRing } from './readingring.js';

const SKIP_INSIDE = '[data-no-ring]';

const rings = new Map(); // field -> { ring, holder }
const watched = new Set(); // fields with text: measured on every refresh
const parentUse = new Map(); // observed parent -> watched fields under it
let queued = false;

function isField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
  // The editing host itself, not a node inside it.
  return el.hasAttribute('contenteditable') && el.isContentEditable
    && !(el.parentElement && el.parentElement.isContentEditable);
}

function hostOf(node) {
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  while (el && !isField(el)) {
    if (!el.isContentEditable) return null;
    el = el.parentElement;
  }
  return el;
}

function hasText(field) {
  return field.tagName === 'TEXTAREA' ? field.value !== '' : (field.textContent || '') !== '';
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(refresh);
}

const sizes = new ResizeObserver(schedule);

function watch(field) {
  if (watched.has(field)) return;
  watched.add(field);
  sizes.observe(field);
  const parent = field.parentElement;
  if (!parent) return;
  const uses = parentUse.get(parent) || 0;
  if (!uses) sizes.observe(parent);
  parentUse.set(parent, uses + 1);
}

function unwatch(field) {
  if (!watched.delete(field)) return;
  sizes.unobserve(field);
  const parent = field.parentElement;
  if (parent) {
    const uses = (parentUse.get(parent) || 1) - 1;
    if (uses > 0) parentUse.set(parent, uses);
    else {
      parentUse.delete(parent);
      sizes.unobserve(parent);
    }
  }
}

function note(field) {
  if (!isField(field)) return;
  if (!watched.has(field) && !hasText(field)) return;
  if (field.closest(SKIP_INSIDE)) return;
  watch(field);
  schedule();
}

function ringFor(field) {
  let entry = rings.get(field);
  if (entry) {
    if (entry.holder.parentNode !== field.parentNode) field.after(entry.holder);
    return entry;
  }
  const holder = document.createElement('span');
  holder.className = 'field-ring';
  holder.setAttribute('aria-hidden', 'true');
  // A known origin: offsets are measured from left/top 0.
  holder.style.left = '0px';
  holder.style.top = '0px';
  const ring = createRing('field-ring-svg');
  holder.appendChild(ring.svg);
  field.after(holder);
  entry = { ring, holder };
  rings.set(field, entry);
  return entry;
}

function dropRing(field) {
  const entry = rings.get(field);
  if (!entry) return;
  clearTimeout(entry.ring.settle);
  entry.holder.remove();
  rings.delete(field);
}

function scrollRoom(field) {
  return field.scrollHeight - field.clientHeight;
}

function scrolls(field) {
  const y = getComputedStyle(field).overflowY;
  return y === 'auto' || y === 'scroll';
}

// Read everything first, then write, so a refresh lays the page out once.
function refresh() {
  queued = false;
  const plans = [];
  for (const field of [...watched]) {
    if (!field.isConnected || !isField(field)) {
      unwatch(field);
      dropRing(field);
      continue;
    }
    const room = scrollRoom(field);
    const shown = field.getClientRects().length > 0;
    const on = shown && room > 1 && scrolls(field);
    if (!on && !hasText(field)) unwatch(field);
    plans.push({ field, on, room });
  }
  for (const plan of plans) {
    const { field, on, room } = plan;
    if (!on) {
      const entry = rings.get(field);
      if (entry) {
        entry.holder.classList.remove('is-on');
        paintRing(entry.ring, 0);
      }
      continue;
    }
    const entry = ringFor(field);
    entry.holder.classList.add('is-on');
    fitRing(entry.ring, field);
    place(field, entry.holder);
    paintRing(entry.ring, field.scrollTop / room);
  }
}

// The holder sits on the field's padding box; the SVG inside backs out
// over the border (fitRing). Offsets share the field's offset parent.
function place(field, holder) {
  const cs = getComputedStyle(field);
  const bl = parseFloat(cs.borderLeftWidth) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  const left = (parseFloat(holder.style.left) || 0) + (field.offsetLeft + bl) - holder.offsetLeft;
  const top = (parseFloat(holder.style.top) || 0) + (field.offsetTop + bt) - holder.offsetTop;
  const l = `${Math.round(left * 2) / 2}px`;
  const t = `${Math.round(top * 2) / 2}px`;
  if (holder.style.left !== l) holder.style.left = l;
  if (holder.style.top !== t) holder.style.top = t;
}

// A scroll inside a field only repaints that field's ring.
const scrollFrames = new Map();
document.addEventListener('scroll', (event) => {
  const field = event.target;
  const entry = rings.get(field);
  if (!entry) return;
  brightenRing(entry.ring);
  if (scrollFrames.has(field)) return;
  scrollFrames.set(field, requestAnimationFrame(() => {
    scrollFrames.delete(field);
    const room = scrollRoom(field);
    paintRing(entry.ring, room > 1 ? field.scrollTop / room : 0);
  }));
}, { capture: true, passive: true });

// ── What wakes a refresh ──────────────────────────────────────────────────
// Code that sets .value directly (a load, a paste button) sends no input
// event, so the setter tells us. fieldclear.js wraps the same setter; each
// wrapper calls the one before it.
{
  const Proto = window.HTMLTextAreaElement;
  const desc = Proto && Object.getOwnPropertyDescriptor(Proto.prototype, 'value');
  if (desc && desc.set && desc.configurable) {
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
}

document.addEventListener('input', (event) => note(hostOf(event.target) || event.target), true);
document.addEventListener('focusin', (event) => note(event.target), true);
window.addEventListener('resize', schedule);
window.addEventListener('orientationchange', schedule);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

function scan(root) {
  if (isField(root)) {
    note(root);
    return;
  }
  if (!root.querySelectorAll) return;
  for (const field of root.querySelectorAll('textarea, [contenteditable]')) note(field);
}

// New fields, fields that moved, and editors whose text a script replaced.
new MutationObserver((records) => {
  let moved = false;
  for (const record of records) {
    const host = record.target && record.target.isContentEditable ? hostOf(record.target) : null;
    if (host) note(host);
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1 || node.classList.contains('field-ring')) continue;
      scan(node);
      moved = true;
    }
    if (record.removedNodes.length) moved = true;
  }
  if (moved && watched.size) schedule();
}).observe(document.documentElement, { childList: true, subtree: true });

scan(document.body || document.documentElement);
