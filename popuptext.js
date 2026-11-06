// Map popup message text. The bubble takes as much of the popup as the
// layout gives it (style.css, .popup-msg). When the text is longer than
// that, the bubble stops scrolling inside itself: the last line fades and
// a "Show more" under it opens the whole text on its own full-screen page.
// Back (the arrow, Escape, or browser Back) closes that page.
import { paintHashtags } from './hashtag.js';

// bubble -> { host, flow, more, text, title }
const watched = new WeakMap();

// One observer for every popup bubble. The class change it makes resizes
// the bubble, so the change waits for the next frame instead of looping
// inside the observer callback.
let queued = new Set();
let queueFrame = 0;
const sizes = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const entry of entries) queued.add(entry.target);
    if (!queueFrame) queueFrame = requestAnimationFrame(flushQueue);
  })
  : null;

function flushQueue() {
  queueFrame = 0;
  const list = [...queued];
  queued = new Set();
  for (const bubble of list) {
    if (!bubble.isConnected) {
      if (sizes) sizes.unobserve(bubble);
      continue;
    }
    syncMore(bubble);
  }
}

// Clipped, the bubble no longer scrolls, so the inner flow box carries the
// overflow. Turn the clip off only once the text fits with the button
// still shown; that keeps it from flipping back and forth.
function syncMore(bubble) {
  const state = watched.get(bubble);
  if (!state) return;
  const clipped = state.host.classList.contains('is-more');
  const over = clipped
    ? state.flow.scrollHeight > state.flow.clientHeight + 1
    : bubble.scrollHeight > bubble.clientHeight + 1;
  if (over === clipped) return;
  state.host.classList.toggle('is-more', over);
  state.more.hidden = !over;
}

function queueSync(bubble) {
  queued.add(bubble);
  if (!queueFrame) queueFrame = requestAnimationFrame(flushQueue);
}

// host: the box around the bubble (the popup's message div).
// bubble: p.popup-text-bubble, already painted with the text.
export function watchPopupText(host, bubble, text, title) {
  if (!host || !bubble || watched.has(bubble)) return;
  // An image-only post keeps an empty bubble; style.css hides it with
  // :empty, which a flow box inside would defeat.
  if (!bubble.firstChild) return;
  host.classList.add('popup-msg');
  // The text moves into a flow box so the fade covers only the text and the
  // bubble keeps its border and background.
  const flow = document.createElement('span');
  flow.className = 'popup-text-flow';
  while (bubble.firstChild) flow.appendChild(bubble.firstChild);
  bubble.appendChild(flow);
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'popup-more';
  more.textContent = 'Show more';
  more.hidden = true;
  more.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const state = watched.get(bubble);
    if (!state) return;
    openPopupText({ text: state.text, title: state.title, from: bubble, opener: more });
  });
  host.appendChild(more);
  watched.set(bubble, { host, flow, more, text: String(text || ''), title: singleLine(title) });
  if (sizes) sizes.observe(bubble);
  else queueSync(bubble);
}

// Repaint a popup bubble (an edited post). Keeps the flow box and the
// full-screen text in step with what is shown.
export function setPopupText(bubble, text) {
  if (!bubble) return;
  const state = watched.get(bubble);
  if (!state) {
    paintHashtags(bubble, text);
    return;
  }
  state.text = String(text || '');
  paintHashtags(state.flow, state.text);
  queueSync(bubble);
}

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// Full-screen text page, built on first use.
let page = null;
let pageBack = null;
let pageTitle = null;
let pageScroll = null;
let pageText = null;
let lastOpen = null;
let returnFocus = null;
let motionTimer = 0;
let layerDefined = false;

function buildPage() {
  page = document.createElement('div');
  page.id = 'popup-text-page';
  page.hidden = true;
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-modal', 'true');
  page.setAttribute('aria-label', 'Post text');
  const bar = document.createElement('div');
  bar.className = 'popup-text-page-bar';
  pageBack = document.createElement('button');
  pageBack.type = 'button';
  pageBack.className = 'popup-text-page-back';
  pageBack.setAttribute('aria-label', 'Back');
  pageBack.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>';
  pageTitle = document.createElement('h2');
  pageTitle.className = 'popup-text-page-title';
  bar.append(pageBack, pageTitle);
  pageScroll = document.createElement('div');
  pageScroll.className = 'popup-text-page-scroll';
  pageText = document.createElement('p');
  pageText.className = 'popup-text-page-text';
  pageScroll.appendChild(pageText);
  page.append(bar, pageScroll);

  pageBack.addEventListener('click', (event) => {
    event.stopPropagation();
    closePopupText();
  });
  // A hashtag opens Search. Close first, so the results are not under here.
  page.addEventListener('click', (event) => {
    if (event.target.closest && event.target.closest('.post-hashtag')) closePopupText();
  }, true);
  // Taps stay on this page; the popup and the map under it do not see them.
  page.addEventListener('click', (event) => event.stopPropagation());
  page.addEventListener('pointerdown', (event) => event.stopPropagation());
  page.addEventListener('animationend', (event) => {
    if (event.target === page) endMotion();
  });
  // Escape closes this page only, not the popup under it.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !page || page.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closePopupText();
  }, true);
  document.body.appendChild(page);
}

function ensureLayer() {
  if (layerDefined || !window.defineLayer) return;
  layerDefined = true;
  window.defineLayer('popuptext', {
    // Browser Forward after Back: show the same text again.
    open: () => {
      if (lastOpen && page && page.hidden) showPage(lastOpen);
    },
    close: () => closePopupText(true),
  });
}

function endMotion() {
  clearTimeout(motionTimer);
  motionTimer = 0;
  if (page) page.classList.remove('is-entering', 'is-leaving');
}

function playMotion(kind) {
  endMotion();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  page.classList.add(kind === 'in' ? 'is-entering' : 'is-leaving');
  motionTimer = setTimeout(endMotion, 700);
}

function showPage(state) {
  pageTitle.textContent = state.title;
  pageTitle.hidden = !state.title;
  paintHashtags(pageText, state.text);
  // The popup's own text colour and size, never smaller than 18px.
  if (state.color) pageText.style.color = state.color;
  else pageText.style.removeProperty('color');
  if (state.size) pageText.style.fontSize = `max(18px, ${state.size})`;
  else pageText.style.removeProperty('font-size');
  page.hidden = false;
  pageScroll.scrollTop = 0;
  playMotion('in');
  pageBack.focus({ preventScroll: true, focusVisible: false });
}

export function openPopupText({ text, title, from, opener }) {
  if (!page) buildPage();
  ensureLayer();
  const cs = from ? getComputedStyle(from) : null;
  lastOpen = {
    text: String(text || ''),
    title: singleLine(title),
    color: cs ? cs.color : '',
    size: cs ? cs.fontSize : '',
  };
  returnFocus = opener || null;
  showPage(lastOpen);
  if (window.layerOpened) window.layerOpened('popuptext');
}

// fromHistory: browser Back already consumed the entry.
export function closePopupText(fromHistory) {
  if (!page || page.hidden) return;
  // The state flips now; .is-leaving keeps the page painted while it leaves.
  page.hidden = true;
  playMotion('out');
  if (!fromHistory && window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('popuptext')) {
    window.layerClosedByUI('popuptext');
  }
  if (returnFocus && returnFocus.isConnected) {
    returnFocus.focus({ preventScroll: true, focusVisible: false });
  }
  returnFocus = null;
}
