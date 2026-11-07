// caretview.js — the caret stays on screen while a message grows.
//
// Message boxes grow with their text (the chat composers, the Draw post
// text, the popup edit box). The growth lands after the browser has
// already scrolled the caret into view, so a long text used to run on
// below the screen, or under the phone keyboard, until the user scrolled
// after it. After every edit in a text box, the nearest scrolling boxes
// and then the page move just enough to show the caret line again.
//
// Cheap on purpose: one read of the box per edit, and nothing more while
// the whole box is still in view. Only a box taller than what is visible
// measures its caret: a contenteditable through its selection, a textarea
// through a mirror copy kept in a shadow root, so the page DOM never
// changes on a keystroke (light-DOM mutations restyle :has() rules).

const MARGIN = 16;
let frame = 0;
let queued = null;

function isTextBox(el) {
  return !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable === true);
}

function editableHost(el) {
  let host = el;
  while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
  return host;
}

function scrollsY(el) {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const y = getComputedStyle(el).overflowY;
  return y === 'auto' || y === 'scroll' || y === 'overlay';
}

// The part of the screen where the box can show: the visual viewport
// (above the keyboard) cut down by every scrolling box around it.
function visibleBand(el) {
  const vv = window.visualViewport;
  let top = vv ? vv.offsetTop : 0;
  let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    if (!scrollsY(node)) continue;
    const r = node.getBoundingClientRect();
    top = Math.max(top, r.top + node.clientTop);
    bottom = Math.min(bottom, r.top + node.clientTop + node.clientHeight);
  }
  return { top, bottom };
}

let mirrorHost = null;
let mirror = null;
let mark = null;
const COPY = [
  'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch',
  'letterSpacing', 'lineHeight', 'textTransform', 'textIndent', 'wordSpacing',
  'tabSize', 'direction', 'textAlign', 'wordBreak', 'overflowWrap',
];

function textareaCaret(el) {
  if (!mirrorHost) {
    mirrorHost = document.createElement('div');
    mirrorHost.setAttribute('aria-hidden', 'true');
    mirrorHost.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
    const root = mirrorHost.attachShadow({ mode: 'open' });
    mirror = document.createElement('div');
    mark = document.createElement('span');
    root.appendChild(mirror);
    document.body.appendChild(mirrorHost);
  }
  const cs = getComputedStyle(el);
  for (const prop of COPY) mirror.style[prop] = cs[prop];
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '0';
  mirror.style.boxSizing = 'border-box';
  mirror.style.width = `${el.offsetWidth}px`;
  mirror.style.height = 'auto';
  mirror.style.whiteSpace = 'pre-wrap';
  if (cs.overflowWrap === 'normal') mirror.style.overflowWrap = 'break-word';
  const end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
  mirror.textContent = el.value.slice(0, end);
  mark.textContent = '​';
  mirror.appendChild(mark);
  const box = el.getBoundingClientRect();
  const lineHeight = mark.offsetHeight || parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3 || 20;
  const top = box.top + mark.offsetTop - el.scrollTop;
  return { top, bottom: top + lineHeight };
}

function editableCaret(host) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0).cloneRange();
  if (!host.contains(range.endContainer)) return null;
  range.collapse(false);
  let rect = range.getClientRects()[0] || range.getBoundingClientRect();
  if (!rect || (rect.top === 0 && rect.bottom === 0)) {
    // A fresh empty line has no text box: use the line's element, or the
    // box's last line.
    const node = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    if (node && node !== host && host.contains(node)) {
      rect = node.getBoundingClientRect();
    } else {
      const box = host.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(host).lineHeight) || 20;
      return { top: box.bottom - lineHeight, bottom: box.bottom };
    }
  }
  return { top: rect.top, bottom: rect.bottom };
}

function scrollAncestors(el, delta) {
  let left = delta;
  for (let node = el.parentElement; node && node !== document.body && Math.abs(left) >= 1; node = node.parentElement) {
    if (!scrollsY(node)) continue;
    const room = left > 0 ? node.scrollHeight - node.clientHeight - node.scrollTop : -node.scrollTop;
    const step = left > 0 ? Math.min(left, room) : Math.max(left, room);
    if (Math.abs(step) < 1) continue;
    node.scrollTop += step;
    left -= step;
  }
  if (Math.abs(left) >= 1) {
    const page = document.scrollingElement || document.documentElement;
    if (page && page.scrollHeight > page.clientHeight + 1) window.scrollBy(0, left);
  }
}

function follow(target) {
  const el = target.tagName === 'TEXTAREA' ? target : editableHost(target);
  if (!el.isConnected) return;
  const active = document.activeElement;
  if (active !== el && !el.contains(active)) return;
  const band = visibleBand(el);
  if (band.bottom - band.top < 24) return;
  const box = el.getBoundingClientRect();
  // The whole box is in view, so the caret is too.
  if (box.top >= band.top && box.bottom <= band.bottom) return;
  const caret = el.tagName === 'TEXTAREA' ? textareaCaret(el) : editableCaret(el);
  if (!caret) return;
  let delta = 0;
  if (caret.bottom + MARGIN > band.bottom) delta = caret.bottom + MARGIN - band.bottom;
  else if (caret.top - MARGIN < band.top) delta = caret.top - MARGIN - band.top;
  if (Math.abs(delta) >= 1) scrollAncestors(el, delta);
}

// After the box's own input handlers have grown it (they run in the same
// event); the next frame sees the new height.
document.addEventListener('input', (event) => {
  const el = event.target;
  if (!isTextBox(el)) return;
  queued = el;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const target = queued;
    queued = null;
    if (target) follow(target);
  });
}, true);
