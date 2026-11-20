// Standalone typing layer. No app imports. The page passes a history port
// and adapters. This file only talks to the DOM it is given.

const SKIP_TYPES = new Set([
  'file', 'hidden', 'checkbox', 'radio', 'range', 'color',
  'date', 'time', 'month', 'week', 'datetime-local',
  'button', 'submit', 'reset', 'image',
]);

export function isTypingCandidate(el) {
  if (!el || typeof el !== 'object') return false;
  if (el.readOnly || el.disabled || el.hidden) return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (el.isContentEditable) {
    const parent = el.parentElement;
    if (parent && parent.isContentEditable) return false;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return true;
  }
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT' || tag !== 'INPUT') return false;
  const type = String(el.type || 'text').toLowerCase();
  return !SKIP_TYPES.has(type);
}

// First match wins. 'confirm' means the caller opens the layer and watches
// for a software keyboard. A physical session stays inline, including on a
// fresh touch.
export function activationDecision(signals) {
  const s = signals || {};
  if (!s.candidate || s.suppressed) return 'inline';
  if (s.session === 'physical') return 'inline';
  if (s.session === 'software') return 'typing';
  if (s.pointerType === 'touch') return 'confirm';
  if (s.trustedFocus && s.coarse && s.hoverNone && !s.fineHover) return 'confirm';
  return 'inline';
}

// query '0' or '1' wins over stored '0' or '1'. Otherwise fallback
// (this app passes false until the rollout default flips on).
export function typingEnabled({ query, stored, fallback = false } = {}) {
  if (query === '0') return false;
  if (query === '1') return true;
  if (stored === '0') return false;
  if (stored === '1') return true;
  return !!fallback;
}

// The event list for one mirror edit. 'write' is the value copy, not a DOM event.
export function planSync(pre, next) {
  const to = next || {};
  const phase = to.phase || 'edit';
  if (phase === 'keydown') {
    const keys = to.key === 'Escape' ? [] : ['keydown'];
    return { events: keys, write: false, isComposing: false, value: to.value };
  }
  if (phase === 'compositionstart') {
    return { events: ['compositionstart'], write: false, isComposing: true, trailingInput: false };
  }
  if (phase === 'compositionend') {
    return {
      events: ['compositionend'],
      write: true,
      isComposing: false,
      trailingInput: false,
      value: to.value != null ? to.value : (pre && pre.value),
    };
  }
  if (to.isComposing) {
    return { events: ['input'], write: true, isComposing: true, value: to.value };
  }
  return {
    events: ['beforeinput', 'write', 'input'],
    write: true,
    isComposing: false,
    value: to.value,
    selectionStart: to.selectionStart,
    selectionEnd: to.selectionEnd,
  };
}

export function planDismiss(kind, snapshot, current) {
  if (kind === 'cancel') return { value: snapshot, events: ['input', 'change'] };
  return { value: current, events: snapshot === current ? [] : ['change'] };
}

// Enter is never Send. Escape commits and is not dispatched.
export function enterPolicy(input) {
  const key = input && input.key;
  if (key === 'Escape') return { close: 'commit', send: false, keys: [] };
  const keys = ['keydown'];
  if (key !== 'Enter') return { close: false, send: false, keys };
  if (input.multiline) return { close: false, send: false, keys };
  if (input.defaultPrevented || input.pickerMulti) return { close: false, send: false, keys };
  return { close: 'commit', send: false, keys };
}

function textOf(node) {
  return String(node && node.textContent || '').replace(/\s+/g, ' ').trim();
}

export function fieldLabel(el, adapterLabel) {
  if (adapterLabel) return String(adapterLabel);
  const doc = el && el.ownerDocument;
  if (el && el.getAttribute) {
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled && doc && doc.getElementById) {
      const parts = labelled.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean);
      const joined = parts.map(textOf).filter(Boolean).join(' ');
      if (joined) return joined;
    }
    if (el.id && doc && doc.querySelector) {
      let forLabel = null;
      try { forLabel = doc.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]'); } catch { forLabel = null; }
      if (forLabel) {
        const clone = forLabel.cloneNode(true);
        clone.querySelectorAll('input, textarea, select').forEach((node) => node.remove());
        const own = textOf(clone);
        if (own) return own;
      }
    }
    const wrap = el.closest && el.closest('label');
    if (wrap) {
      const clone = wrap.cloneNode(true);
      clone.querySelectorAll('input, textarea, select').forEach((node) => node.remove());
      const own = textOf(clone);
      if (own) return own;
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
  }
  if (el && el.placeholder && String(el.placeholder).trim()) return String(el.placeholder).trim();
  return 'Edit';
}

function readValue(el) {
  if (!el) return '';
  if (el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
    return String(el.textContent || '').replace(/\r\n/g, '\n');
  }
  return el.value == null ? '' : String(el.value);
}

function writeValue(el, value) {
  if (el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
    el.textContent = value;
    return;
  }
  el.value = value;
}

function viewBox(win) {
  const view = win.visualViewport;
  const innerH = win.innerHeight || 0;
  const innerW = win.innerWidth || 0;
  const top = view ? view.offsetTop : 0;
  const left = view ? view.offsetLeft : 0;
  let width = view ? view.width : innerW;
  let height = view ? view.height : innerH;
  if (innerH > 0 && innerH - top < height) height = innerH - top;
  return { top, left, width, height };
}

function paintBox(node, box) {
  node.style.top = box.top + 'px';
  node.style.left = box.left + 'px';
  node.style.width = box.width + 'px';
  node.style.height = box.height + 'px';
}

function inputEvent(type, init) {
  const fields = init || {};
  try {
    return new InputEvent(type, fields);
  } catch {
    return new Event(type, { bubbles: !!fields.bubbles, cancelable: !!fields.cancelable });
  }
}

export function mountTypingHost(doc, hooks) {
  const idle = { open() {}, dismiss() {}, destroy() {}, registerAdapter() {}, field() { return null; } };
  if (!doc || typeof doc.createElement !== 'function' || !doc.body) return idle;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (!win) return idle;
  const port = hooks || {};
  const adapters = [];
  let current = null;
  let host = null;
  let cover = null;
  let mirror = null;
  let slot = null;
  let activeAdapter = null;
  let composing = false;
  let geomFrame = 0;
  let settleTimer = 0;
  let settleTries = 0;
  let closedHeight = 0;
  let opening = false;

  function registerAdapter(adapter) {
    if (adapter && typeof adapter.match === 'function') adapters.push(adapter);
  }
  (port.adapters || []).forEach(registerAdapter);

  function adapterFor(el) {
    for (let i = 0; i < adapters.length; i += 1) {
      try {
        if (adapters[i].match(el)) return adapters[i];
      } catch { /* a bad match skips */ }
    }
    return null;
  }

  function emit(phase, reason, detail) {
    if (typeof win.CustomEvent !== 'function' || typeof win.dispatchEvent !== 'function') return;
    const field = detail && detail.field ? detail.field : (current && current.el);
    const match = detail && detail.match != null ? detail.match : (current && current.match ? current.match : '');
    win.dispatchEvent(new win.CustomEvent('typing-screen', {
      detail: {
        phase,
        reason: reason || '',
        fieldId: field && field.id ? field.id : '',
        match: match || '',
      },
    }));
  }

  function track() {
    if (geomFrame) return;
    geomFrame = win.requestAnimationFrame(() => {
      geomFrame = 0;
      const box = viewBox(win);
      if (host) paintBox(host, box);
      if (cover) paintBox(cover, box);
    });
  }

  function ensureCover() {
    if (cover) return cover;
    cover = doc.createElement('div');
    cover.id = 'typing-screen-cover';
    cover.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(cover);
    paintBox(cover, viewBox(win));
    return cover;
  }

  function dropCover() {
    if (settleTimer) win.clearTimeout(settleTimer);
    settleTimer = 0;
    settleTries = 0;
    if (cover && cover.parentNode) cover.parentNode.removeChild(cover);
    cover = null;
  }

  function viewportSettled() {
    const view = win.visualViewport;
    if (!view || !closedHeight) return true;
    return Math.abs(view.height - closedHeight) <= 2 && Math.abs(view.offsetTop) <= 2;
  }

  // The cover hides the page only while the keyboard is still up. A
  // hardware-keyboard latch closes with the viewport already full, and a
  // tight 2px compare would flash the cover over that field.
  function coverNeeded() {
    const view = win.visualViewport;
    if (!view || !closedHeight) return false;
    return view.height < closedHeight * 0.85 || Math.abs(view.offsetTop) > 40;
  }

  function settleCover() {
    settleTries += 1;
    if (viewportSettled() || settleTries >= 8) {
      dropCover();
      return;
    }
    settleTimer = win.setTimeout(settleCover, 50);
  }

  function blurPage() {
    const body = doc.body;
    if (!body || typeof body.focus !== 'function') return;
    const prev = body.getAttribute('tabindex');
    body.setAttribute('tabindex', '-1');
    try { body.focus({ preventScroll: true }); } catch { try { body.focus(); } catch { /* leave focus */ } }
    if (prev == null) body.removeAttribute('tabindex');
    else body.setAttribute('tabindex', prev);
  }

  function copyChrome(from, to) {
    if (from.tagName === 'INPUT' && to.tagName === 'INPUT' && from.type) to.type = from.type;
    if (from.maxLength > 0) to.maxLength = from.maxLength;
    if (from.minLength > 0) to.minLength = from.minLength;
    const names = ['inputMode', 'autocomplete', 'autocapitalize', 'placeholder', 'min', 'max', 'step', 'pattern', 'enterKeyHint'];
    for (let i = 0; i < names.length; i += 1) {
      const value = from[names[i]];
      if (value != null && value !== '') to[names[i]] = value;
    }
    if (from.autocorrect) to.autocorrect = from.autocorrect;
    to.spellcheck = !!from.spellcheck;
    if (to.tagName === 'TEXTAREA' && from.rows) to.rows = from.rows;
    try {
      const security = win.getComputedStyle(from).webkitTextSecurity;
      if (security === 'disc') to.style.webkitTextSecurity = 'disc';
    } catch { /* computed style can fail on a detached node */ }
  }

  function mirrorKind(el, adapter) {
    if (adapter && adapter.multiline === false) return 'input';
    if (el.tagName === 'TEXTAREA') return 'textarea';
    if (el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
      return el.tagName === 'SPAN' ? 'input' : 'textarea';
    }
    return 'input';
  }

  function placeCaret(node, start, end) {
    if (!node || typeof node.setSelectionRange !== 'function') return;
    try { node.setSelectionRange(start, end); } catch { /* number inputs */ }
  }

  function syncCaretAttrs(el) {
    if (!el || !el.dataset || !mirror) return;
    if (!(el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
    el.dataset.caretStart = String(mirror.selectionStart || 0);
    el.dataset.caretEnd = String(mirror.selectionEnd || 0);
  }

  function forwardInput(type, source, extra) {
    const init = {
      bubbles: true,
      cancelable: type === 'beforeinput',
      inputType: source && source.inputType || '',
      data: source && source.data || null,
      isComposing: !!(extra && extra.isComposing),
    };
    const event = inputEvent(type, init);
    current.el.dispatchEvent(event);
    return event;
  }

  function pullBack() {
    if (!mirror || !current) return;
    const after = readValue(current.el);
    if (after === mirror.value) return;
    const caret = mirror.selectionStart;
    mirror.value = after;
    placeCaret(mirror, caret, caret);
  }

  function onBeforeInput(event) {
    if (!current || composing) return;
    syncCaretAttrs(current.el);
    const start = typeof mirror.selectionStart === 'number' ? mirror.selectionStart : 0;
    const end = typeof mirror.selectionEnd === 'number' ? mirror.selectionEnd : start;
    placeCaret(current.el, start, end);
    const forwarded = forwardInput('beforeinput', event);
    if (forwarded.defaultPrevented) event.preventDefault();
  }

  function onInput(event) {
    if (!current) return;
    const live = !!(event && event.isComposing) || composing;
    writeValue(current.el, mirror.value);
    if (!live) {
      const start = typeof mirror.selectionStart === 'number' ? mirror.selectionStart : mirror.value.length;
      const end = typeof mirror.selectionEnd === 'number' ? mirror.selectionEnd : start;
      placeCaret(current.el, start, end);
    }
    forwardInput('input', event, { isComposing: live });
    if (!live) pullBack();
    if (activeAdapter && current.mounted && typeof current.mounted.update === 'function') {
      try { current.mounted.update(); } catch { /* adapter update is optional */ }
    }
  }

  function keyInit(event) {
    return {
      bubbles: true,
      cancelable: true,
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
  }

  function onKeyDown(event) {
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss('escape');
      return;
    }
    const forwarded = new win.KeyboardEvent('keydown', keyInit(event));
    current.el.dispatchEvent(forwarded);
    if (forwarded.defaultPrevented) event.preventDefault();
    const policy = enterPolicy({
      multiline: mirror.tagName === 'TEXTAREA',
      key: event.key,
      defaultPrevented: forwarded.defaultPrevented,
      pickerMulti: !!(current.el.dataset && current.el.dataset.typingPickerMulti === '1'),
    });
    if (policy.close === 'commit') {
      event.preventDefault();
      dismiss('done');
    }
  }

  function onKeyUp(event) {
    if (!current || event.key === 'Escape') return;
    const forwarded = new win.KeyboardEvent('keyup', keyInit(event));
    current.el.dispatchEvent(forwarded);
    if (forwarded.defaultPrevented) event.preventDefault();
  }

  function onPaste(event) {
    if (!current) return;
    syncCaretAttrs(current.el);
    const forwarded = new Event('paste', { bubbles: true, cancelable: true });
    try {
      Object.defineProperty(forwarded, 'clipboardData', { value: event.clipboardData });
    } catch { /* a paste without clipboard data still reaches the listener */ }
    current.el.dispatchEvent(forwarded);
    if (forwarded.defaultPrevented) {
      event.preventDefault();
      mirror.value = readValue(current.el);
    }
  }

  function onComposition(event) {
    if (!current) return;
    if (event.type === 'compositionstart') composing = true;
    if (event.type === 'compositionend') composing = false;
    syncCaretAttrs(current.el);
    const forwarded = new Event(event.type, { bubbles: true, cancelable: event.cancelable });
    try { Object.defineProperty(forwarded, 'data', { value: event.data }); } catch { /* data is optional */ }
    current.el.dispatchEvent(forwarded);
  }

  function buildMirror(el, adapter) {
    const node = doc.createElement(mirrorKind(el, adapter) === 'textarea' ? 'textarea' : 'input');
    node.className = 'typing-mirror';
    node.setAttribute('data-typing-mirror', '1');
    node.setAttribute('aria-labelledby', 'typing-label');
    if (node.tagName === 'INPUT' && !node.type) node.type = 'text';
    copyChrome(el, node);
    const value = readValue(el);
    node.value = value;
    return node;
  }

  function destroyHost() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    mirror = null;
    slot = null;
  }

  function open(el) {
    if (!el) return;
    const nextId = el.id || '';
    if (current && current.el === el) return;
    if (current && current.el && current.el.id === nextId && nextId) return;
    if (current) dismiss('done');
    const adapter = adapterFor(el);
    const snapshot = readValue(el);
    closedHeight = win.innerHeight || 0;
    if (el.setAttribute) el.setAttribute('data-typing-live', '1');
    current = { el, snapshot, match: adapter && adapter.name ? adapter.name : '', mounted: null };
    opening = true;
    host = doc.createElement('div');
    host.id = 'typing-screen';
    host.setAttribute('data-kb-skip', '1');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-labelledby', 'typing-label');
    const bar = doc.createElement('div');
    bar.className = 'typing-bar';
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'typing-cancel';
    cancel.textContent = 'Cancel';
    const label = doc.createElement('div');
    label.className = 'typing-label';
    label.id = 'typing-label';
    const adapterLabel = adapter && (typeof adapter.label === 'function' ? adapter.label(el) : adapter.label);
    label.textContent = fieldLabel(el, adapterLabel);
    const done = doc.createElement('button');
    done.type = 'button';
    done.className = 'typing-done';
    done.textContent = 'Done';
    bar.append(cancel, label, done);
    slot = doc.createElement('div');
    slot.className = 'typing-slot';
    const compose = doc.createElement('div');
    compose.className = 'typing-compose';
    mirror = buildMirror(el, adapter);
    compose.append(mirror);
    try {
      if (win.getComputedStyle(el).webkitTextSecurity === 'disc') {
        const reveal = doc.createElement('button');
        reveal.type = 'button';
        reveal.className = 'typing-reveal';
        reveal.textContent = 'Show';
        reveal.addEventListener('click', () => {
          const hidden = mirror.style.webkitTextSecurity === 'disc';
          mirror.style.webkitTextSecurity = hidden ? 'none' : 'disc';
          reveal.textContent = hidden ? 'Hide' : 'Show';
        });
        compose.append(reveal);
      }
    } catch { /* masking is optional when style cannot be read */ }
    host.append(bar, slot, compose);
    // A click that reaches document runs CloseALL. Stop it after the
    // mirror and the buttons have seen it.
    host.addEventListener('click', (event) => event.stopPropagation());
    host.addEventListener('pointerdown', (event) => event.stopPropagation());
    host.addEventListener('beforeinput', onBeforeInput, true);
    host.addEventListener('input', onInput, true);
    host.addEventListener('keydown', onKeyDown, true);
    host.addEventListener('keyup', onKeyUp, true);
    host.addEventListener('paste', onPaste, true);
    host.addEventListener('compositionstart', onComposition, true);
    host.addEventListener('compositionupdate', onComposition, true);
    host.addEventListener('compositionend', onComposition, true);
    cancel.addEventListener('click', () => dismiss('cancel'));
    done.addEventListener('click', () => dismiss('done'));
    doc.body.appendChild(host);
    paintBox(host, viewBox(win));
    if (adapter && typeof adapter.mount === 'function') {
      try {
        current.mounted = adapter.mount(slot, el, host) || null;
      } catch {
        current.mounted = null;
      }
    }
    if (port.history && typeof port.history.open === 'function') {
      try { port.history.open({ id: nextId }); } catch { /* history is optional */ }
    }
    emit('open', '');
    try { mirror.focus({ preventScroll: true }); } catch { try { mirror.focus(); } catch { /* focus can fail on a hidden page */ } }
    const end = mirror.value.length;
    placeCaret(mirror, end, end);
    opening = false;
    track();
  }

  function dismiss(reason) {
    if (!current) return null;
    const why = reason || 'done';
    const field = current.el;
    const plan = planDismiss(why === 'cancel' ? 'cancel' : 'commit', current.snapshot, readValue(field));
    if (why === 'cancel') writeValue(field, plan.value);
    for (let i = 0; i < plan.events.length; i += 1) {
      field.dispatchEvent(inputEvent(plan.events[i], { bubbles: true, cancelable: false }));
    }
    if (field.removeAttribute) field.removeAttribute('data-typing-live');
    const mounted = current.mounted;
    const match = current.match;
    current.mounted = null;
    if (mounted && typeof mounted.unmount === 'function') {
      try { mounted.unmount(); } catch { /* still close */ }
    }
    current = null;
    composing = false;
    emit('close', why, { field, match });
    destroyHost();
    ensureCover();
    track();
    blurPage();
    if (typeof port.onClose === 'function') {
      try { port.onClose({ reason: why, field, match }); } catch { /* the bind owns the latch */ }
    }
    if (why !== 'back' && port.history && typeof port.history.close === 'function') {
      try { port.history.close(); } catch { /* a missing history stack still closes the layer */ }
    }
    settleTries = 0;
    if (settleTimer) win.clearTimeout(settleTimer);
    if (!coverNeeded() || viewportSettled()) dropCover();
    else settleTimer = win.setTimeout(settleCover, 50);
    return field;
  }

  function onGeometry() { track(); }
  win.addEventListener('resize', onGeometry);
  if (win.visualViewport) {
    win.visualViewport.addEventListener('resize', onGeometry);
    win.visualViewport.addEventListener('scroll', onGeometry);
  }

  return {
    open,
    dismiss,
    registerAdapter,
    field() { return current ? current.el : null; },
    destroy() {
      win.removeEventListener('resize', onGeometry);
      if (win.visualViewport) {
        win.visualViewport.removeEventListener('resize', onGeometry);
        win.visualViewport.removeEventListener('scroll', onGeometry);
      }
      if (current) dismiss('done');
      dropCover();
    },
  };
}
