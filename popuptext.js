// Map popup message text. The bubble takes as much of the popup as the
// layout gives it (style.css, .popup-msg). When the text is longer than
// that, it scrolls inside the bubble, the edges with more text past them
// fade, and a "Show more" under it opens the whole text on its own
// full-screen page. Back (the arrow, Escape, or browser Back) closes that
// page.
import { paintHashtags } from './hashtag.js';
import { toast } from './toast.js';
import { copyTextToClipboard } from './handleallmessages.js';

// bubble -> { host, flow, more, text, title }
const watched = new WeakMap();
// An empty bubble (an image-only post) -> { host, title }, kept so an edit
// that adds text can still start watching it.
const parked = new WeakMap();

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
  if (over !== clipped) {
    state.host.classList.toggle('is-more', over);
    state.more.hidden = !over;
  }
  paintEdges(state);
}

// Fade the edge that has more text past it: none at the top, none at the
// end. Writes only when an edge changes.
function paintEdges(state) {
  state.edgeFrame = 0;
  const flow = state.flow;
  const on = state.host.classList.contains('is-more');
  const room = flow.scrollHeight - flow.clientHeight;
  const above = on && flow.scrollTop > 1;
  const below = on && flow.scrollTop < room - 1;
  if (flow.classList.contains('is-above') !== above) flow.classList.toggle('is-above', above);
  if (flow.classList.contains('is-below') !== below) flow.classList.toggle('is-below', below);
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
  if (!bubble.firstChild) {
    parked.set(bubble, { host, title });
    return;
  }
  parked.delete(bubble);
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
  const state = { host, flow, more, text: String(text || ''), title: singleLine(title), edgeFrame: 0 };
  flow.addEventListener('scroll', () => {
    if (!state.edgeFrame) state.edgeFrame = requestAnimationFrame(() => paintEdges(state));
  }, { passive: true });
  watched.set(bubble, state);
  if (sizes) sizes.observe(bubble);
  else queueSync(bubble);
}

// Repaint a popup bubble (an edited post). Keeps the flow box and the
// full-screen text in step with what is shown. An edit that empties the
// text takes the flow box and Show more out again, so the bubble is
// :empty and collapses; one that adds text to an empty bubble starts
// watching it.
export function setPopupText(bubble, text) {
  if (!bubble) return;
  const state = watched.get(bubble);
  if (!state) {
    paintHashtags(bubble, text);
    const spot = parked.get(bubble);
    if (spot && bubble.firstChild) watchPopupText(spot.host, bubble, text, spot.title);
    return;
  }
  state.text = String(text || '');
  if (!state.text) {
    unwatch(bubble, state);
    return;
  }
  paintHashtags(state.flow, state.text);
  queueSync(bubble);
}

function unwatch(bubble, state) {
  if (sizes) sizes.unobserve(bubble);
  queued.delete(bubble);
  watched.delete(bubble);
  state.more.remove();
  state.host.classList.remove('popup-msg', 'is-more');
  bubble.replaceChildren();
  parked.set(bubble, { host: state.host, title: state.title });
}

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// Full-screen text page, built on first use. A reading view: a glass bar
// (back, the post's title, copy) with a reading-progress line, the
// author as the popup shows them (picture, name, account, time) with the
// reading time once it is 2 minutes or more, the text on a glass card at a
// reading size between quote marks, and an end with a way back. ↑ returns
// to the top of a long text.
let page = null;
let pageBack = null;
let pageTitle = null;
let pageScroll = null;
let pageText = null;
let pageProgress = null;
let pageAuthor = null;
let pageAvatar = null;
let pageInitial = null;
let pageName = null;
let pageMeta = null;
let pageRead = null;
let pageTop = null;
let lastOpen = null;
let returnFocus = null;
let motionTimer = 0;
let layerDefined = false;
let progressFrame = 0;

const SVG = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

function chip(className, label, paths) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `popup-text-page-chip ${className}`;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = SVG(paths);
  return btn;
}

function buildPage() {
  page = document.createElement('div');
  page.id = 'popup-text-page';
  page.hidden = true;
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-modal', 'true');
  page.setAttribute('aria-label', 'Post text');

  const bar = document.createElement('div');
  bar.className = 'popup-text-page-bar';
  pageBack = chip('popup-text-page-back', 'Back', '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>');
  pageTitle = document.createElement('h2');
  pageTitle.className = 'popup-text-page-title';
  const copy = chip('popup-text-page-copy', 'Copy text', '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
  pageProgress = document.createElement('span');
  pageProgress.className = 'popup-text-page-progress';
  pageProgress.setAttribute('aria-hidden', 'true');
  bar.append(pageBack, pageTitle, copy, pageProgress);

  pageScroll = document.createElement('div');
  pageScroll.className = 'popup-text-page-scroll';
  const inner = document.createElement('div');
  inner.className = 'popup-text-page-inner';

  pageAuthor = document.createElement('div');
  pageAuthor.className = 'popup-text-page-author';
  const face = document.createElement('span');
  face.className = 'popup-text-page-face';
  pageAvatar = document.createElement('img');
  pageAvatar.alt = '';
  pageAvatar.decoding = 'async';
  pageAvatar.addEventListener('error', () => { pageAvatar.hidden = true; pageInitial.hidden = false; });
  pageInitial = document.createElement('span');
  pageInitial.className = 'popup-text-page-initial';
  face.append(pageAvatar, pageInitial);
  const who = document.createElement('span');
  who.className = 'popup-text-page-who';
  pageName = document.createElement('span');
  pageName.className = 'popup-text-page-name';
  pageMeta = document.createElement('span');
  pageMeta.className = 'popup-text-page-meta';
  who.append(pageName, pageMeta);
  pageRead = document.createElement('span');
  pageRead.className = 'popup-text-page-read';
  pageAuthor.append(face, who, pageRead);

  const card = document.createElement('article');
  card.className = 'popup-text-page-card';
  pageText = document.createElement('p');
  pageText.className = 'popup-text-page-text';
  card.appendChild(pageText);

  const end = document.createElement('div');
  end.className = 'popup-text-page-end';
  const dots = document.createElement('span');
  dots.className = 'popup-text-page-dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.textContent = '• • •';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'popup-text-page-done';
  done.innerHTML = SVG('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>') + '<span>Back to post</span>';
  end.append(dots, done);

  inner.append(pageAuthor, card, end);
  pageScroll.appendChild(inner);
  pageTop = chip('popup-text-page-top', 'Back to top', '<path d="m18 15-6-6-6 6"/>');
  page.append(bar, pageScroll, pageTop);

  pageBack.addEventListener('click', (event) => {
    event.stopPropagation();
    closePopupText();
  });
  done.addEventListener('click', (event) => {
    event.stopPropagation();
    closePopupText();
  });
  copy.addEventListener('click', async (event) => {
    event.stopPropagation();
    const text = lastOpen ? lastOpen.text : '';
    try {
      await copyTextToClipboard(text);
      toast.success('Text copied');
    } catch {
      toast.error('Could not copy the text');
    }
  });
  pageTop.addEventListener('click', (event) => {
    event.stopPropagation();
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pageScroll.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  });
  pageScroll.addEventListener('scroll', () => {
    if (progressFrame) return;
    progressFrame = requestAnimationFrame(paintProgress);
  }, { passive: true });
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

// The bar's line fills as the text is read; ↑ shows once a screen down.
function paintProgress() {
  progressFrame = 0;
  if (!pageScroll) return;
  const room = pageScroll.scrollHeight - pageScroll.clientHeight;
  const done = room > 1 ? Math.min(1, Math.max(0, pageScroll.scrollTop / room)) : 1;
  pageProgress.style.transform = `scaleX(${done.toFixed(4)})`;
  page.classList.toggle('is-scrolled', pageScroll.scrollTop > pageScroll.clientHeight * 0.6);
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
  pageTitle.textContent = state.title || 'Post';
  pageTitle.classList.toggle('is-untitled', !state.title);
  paintHashtags(pageText, state.text);
  // The popup's own text colour (popup settings); the size is the page's.
  if (state.color) pageText.style.color = state.color;
  else pageText.style.removeProperty('color');
  const author = state.author;
  pageAuthor.hidden = !author;
  if (author) {
    const label = author.name || author.account || '';
    pageName.textContent = label;
    pageMeta.textContent = [author.name && author.account ? author.account : '', author.time].filter(Boolean).join(' · ');
    pageMeta.hidden = !pageMeta.textContent;
    pageInitial.textContent = (label.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0) || '•').toUpperCase();
    if (author.picture) {
      pageAvatar.hidden = false;
      pageInitial.hidden = true;
      if (pageAvatar.getAttribute('src') !== author.picture) pageAvatar.src = author.picture;
    } else {
      pageAvatar.hidden = true;
      pageAvatar.removeAttribute('src');
      pageInitial.hidden = false;
    }
  }
  const words = state.text.trim() ? state.text.trim().split(/\s+/).length : 0;
  // Under 2 minutes the estimate says nothing; the pill shows from there.
  const minutes = Math.round(words / 220);
  pageRead.hidden = minutes < 2;
  pageRead.textContent = `${minutes} min read`;
  page.hidden = false;
  pageScroll.scrollTop = 0;
  page.classList.remove('is-scrolled');
  paintProgress();
  playMotion('in');
  pageBack.focus({ preventScroll: true, focusVisible: false });
}

// Who wrote it, read off the popup or feed card the text came from. A feed
// card with a picture has its own inner .popup-sheet without the author,
// so the card is looked for first.
function authorOf(from) {
  if (!from || !from.closest) return null;
  const sheet = from.closest('.feed-card') || from.closest('.popup-sheet, .maplibregl-popup-content');
  if (!sheet) return null;
  const profile = sheet.querySelector('.popup-profile-bubble');
  if (!profile) return null;
  const pic = profile.querySelector(':scope > img, :scope > video, :scope > .early-hashinal > img, :scope > .early-hashinal > video');
  let picture = '';
  if (pic && pic.tagName === 'VIDEO') picture = pic.poster || '';
  else if (pic) picture = pic.currentSrc || pic.getAttribute('src') || '';
  if (!/^(https?:|data:image\/|blob:)/i.test(picture)) picture = '';
  const name = singleLine(profile.querySelector('.username') && profile.querySelector('.username').textContent);
  const account = singleLine(profile.querySelector('.payer-info') && profile.querySelector('.payer-info').textContent);
  // A feed card's time has a long and a short form; the long one.
  const stamp = sheet.querySelector('.feed-time-full') || sheet.querySelector('.popup-timestamp');
  const time = singleLine(stamp && stamp.textContent);
  if (!name && !account) return null;
  return { picture, name, account, time };
}

export function openPopupText({ text, title, from, opener }) {
  if (!page) buildPage();
  ensureLayer();
  const cs = from ? getComputedStyle(from) : null;
  lastOpen = {
    text: String(text || ''),
    title: singleLine(title),
    color: cs ? cs.color : '',
    author: authorOf(from),
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
