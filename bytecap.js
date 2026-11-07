// bytecap.js — the 18 KB topic message limit, held while typing.
//
// Every message box with a "… / 18 KB" counter stops taking text at the
// limit instead of only turning the counter red: a key, a paste or a drop
// that would pass it is cut back to what still fits (a long paste keeps
// its start), and a short note says why. Deleting is never blocked, even
// when an attachment alone has already gone over.
//
// The size is the field's own counter number: measure() returns the bytes
// the message would send with what is in the box right now (it may read
// other fields too, such as a post's title and media). The check runs in
// the same input event as the counter, before it paints, so the counter
// never shows an over-limit value and nothing flickers.
//   capMessageField(textarea, measure)      textarea / input
//   capMessageEditor(editor, field, measure, sync)
//                                           a plain-text contenteditable
//                                           that mirrors into field
//   setMessageMeasure(el, measure | null)   a different size while an
//                                           edit mode is on; null restores
import { HCS_MESSAGE_MAX_BYTES } from './hcschunks.js';
import { toast } from './toast.js';

const MAX = HCS_MESSAGE_MAX_BYTES;
const states = new WeakMap(); // element -> state

let noteAt = 0;
function noteLimit() {
  const now = Date.now();
  if (now - noteAt < 2500) return;
  noteAt = now;
  toast.info('That is the 18 KB limit for one message');
}

// A cut never splits a surrogate pair (emoji and the like).
function cutAt(text, n) {
  if (n > 0 && n < text.length) {
    const code = text.charCodeAt(n - 1);
    if (code >= 0xd800 && code <= 0xdbff) return n - 1;
  }
  return n;
}

function bytesNow(state) {
  try {
    const n = Number(state.override ? state.override() : state.measure());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// The shared rule. a: { get(), probe(text), commit(text, caret) }.
// state.last / start / end: the text and selection the edit started from.
function enforce(state, a) {
  const now = bytesNow(state);
  const cur = a.get();
  if (now <= MAX) {
    state.last = cur;
    return;
  }
  const last = state.last == null ? '' : state.last;
  if (cur === last) return;
  a.probe(last);
  const before = bytesNow(state);
  a.probe(cur);
  // Same size or smaller is always fine: a delete while an attachment is over.
  if (now <= before) {
    state.last = cur;
    return;
  }
  const start = Math.max(0, Math.min(state.start == null ? last.length : state.start, last.length));
  const end = Math.max(start, Math.min(state.end == null ? start : state.end, last.length));
  const head = last.slice(0, start);
  const tail = last.slice(end);
  let fitted = last;
  let caret = start;
  if (cur.length >= head.length + tail.length && cur.startsWith(head) && cur.endsWith(tail)) {
    const inserted = cur.slice(head.length, cur.length - tail.length);
    let lo = 0;
    let hi = inserted.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      a.probe(head + inserted.slice(0, cutAt(inserted, mid)) + tail);
      if (bytesNow(state) <= MAX) lo = mid;
      else hi = mid - 1;
    }
    const keep = cutAt(inserted, lo);
    fitted = head + inserted.slice(0, keep) + tail;
    caret = head.length + keep;
  }
  a.commit(fitted, caret);
  state.last = fitted;
  noteLimit();
}

function snapshot(state, text, start, end) {
  state.last = text;
  state.start = start;
  state.end = end;
}

export function setMessageMeasure(el, measure) {
  const state = el && states.get(el);
  if (state) state.override = typeof measure === 'function' ? measure : null;
}

export function capMessageField(field, measure) {
  if (!field || states.has(field) || typeof measure !== 'function') return;
  const state = { measure, override: null, last: field.value, start: null, end: null, composing: false };
  states.set(field, state);
  const take = () => snapshot(state, field.value, field.selectionStart, field.selectionEnd);
  field.addEventListener('beforeinput', () => {
    if (!state.composing) take();
  }, true);
  field.addEventListener('compositionstart', () => {
    take();
    state.composing = true;
  }, true);
  const adapter = {
    get: () => field.value,
    probe: (text) => { field.value = text; },
    commit: (text, caret) => {
      field.value = text;
      try { field.setSelectionRange(caret, caret); } catch { /* not focusable */ }
    },
  };
  // Capture: at the field itself capture listeners run first, so the
  // field's own counter (a plain listener) paints the kept text.
  field.addEventListener('input', (event) => {
    if (event.isComposing || state.composing) return;
    enforce(state, adapter);
  }, true);
  field.addEventListener('compositionend', () => {
    state.composing = false;
    enforce(state, adapter);
    // The counter has already painted the composed text.
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);
}

// Plain-text offsets of the caret / selection inside a contenteditable.
function editorSelection(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return [null, null];
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return [null, null];
  const offsetOf = (node, offset) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(node, offset);
    return r.toString().length;
  };
  return [offsetOf(range.startContainer, range.startOffset), offsetOf(range.endContainer, range.endOffset)];
}

function placeEditorCaret(el, offset) {
  const sel = window.getSelection();
  if (!sel) return;
  const text = el.firstChild;
  const range = document.createRange();
  if (text && text.nodeType === Node.TEXT_NODE) {
    range.setStart(text, Math.min(offset, text.length));
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// editor: the contenteditable. field: the hidden field it mirrors into
// (measure reads it). sync(): the editor's own write (copies the editor's
// text into field and paints the counter); called after a cut.
export function capMessageEditor(editor, field, measure, sync) {
  if (!editor || !field || states.has(editor) || typeof measure !== 'function') return;
  const state = { measure, override: null, last: field.value, start: null, end: null, composing: false, busy: false };
  states.set(editor, state);
  const take = () => {
    const [start, end] = editorSelection(editor);
    snapshot(state, field.value, start, end);
  };
  editor.addEventListener('beforeinput', () => {
    if (!state.composing) take();
  }, true);
  editor.addEventListener('compositionstart', () => {
    take();
    state.composing = true;
  }, true);
  const adapter = {
    get: () => field.value,
    probe: (text) => { field.value = text; },
    commit: (text, caret) => {
      editor.textContent = text;
      field.value = text;
      placeEditorCaret(editor, caret);
      state.busy = true;
      try { if (typeof sync === 'function') sync(); } finally { state.busy = false; }
    },
  };
  const check = () => {
    if (state.busy || state.composing) return;
    enforce(state, adapter);
  };
  // After the editor's own input handler (registered before this one) has
  // copied its text into field.
  editor.addEventListener('input', (event) => {
    if (event.isComposing) return;
    check();
  });
  editor.addEventListener('compositionend', () => {
    state.composing = false;
    queueMicrotask(check);
  });
  // The editor inserts a paste itself (no input event): check right after.
  editor.addEventListener('paste', () => {
    take();
    queueMicrotask(check);
  }, true);
}
