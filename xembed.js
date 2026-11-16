// X posts in user text. A link to an X post (a feed post, a map popup and
// its Show more page, a chat message, a Swap bio, a profile or topic bio)
// becomes a link that opens X in a new tab, and X's own embedded post
// shows under the text: X's widgets.js, twttr.widgets.createTweet.
//
// Each embed starts as a small placeholder. widgets.js is loaded once (one
// shared promise), and only when a placeholder comes near the screen
// (IntersectionObserver), so posts further down load nothing.
//
// Settings: Show X posts (this device, on by default; the feed's
// Settings > Media and Settings > Popups share it). Off, or with the
// feed's Data saver on, nothing loads by itself: the placeholder has a
// Show post from X button. If widgets.js cannot load, or X has no such
// post (deleted, private), the placeholder goes and the link stays.
//
// The embed is a sibling after the text block (never inside the bubble),
// so a clamp, a popup's flow box and its reading ring stay as they are.

export const X_EMBEDS_KEY = 'meritocracy-x-embeds';
export const X_WIDGETS_SRC = 'https://platform.twitter.com/widgets.js';
export const X_EMBED_OPTIONS = Object.freeze({ theme: 'dark', dnt: true, conversation: 'none', align: 'center' });
// feedlayout.js FEED_SETTING.data: 'on' while Data saver is on.
const DATA_SAVER_KEY = 'feed-setting-data';
// Embeds under one text. A post that links more posts keeps the links.
const X_EMBED_MAX = 2;
const NEAR_MARGIN = '15% 0%';
// A widgets.js that did not load is not asked for again for a minute.
const WIDGETS_RETRY_MS = 60 * 1000;
// createTweet that never settles counts as a post X will not show.
const RENDER_TIMEOUT_MS = 20 * 1000;

// ── Links ────────────────────────────────────────────────────────────────

const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);
const X_USER = /^[A-Za-z0-9_]{1,15}$/;
// Post ids are positive 64-bit numbers: at most 20 digits, no leading 0.
const X_ID = /^[1-9]\d{0,19}$/;
const X_MEDIA_INDEX = /^\d{1,2}$/;

// Path segments, or null when the path has an empty segment in the middle
// ("//"). One trailing slash is fine.
function pathParts(pathname) {
  const parts = String(pathname || '').split('/').slice(1);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  if (parts.some((part) => part === '')) return null;
  return parts;
}

// The part after the id: nothing, or one /photo/N or /video/N.
function restIsMedia(rest) {
  if (rest.length === 0) return true;
  if (rest.length !== 2) return false;
  const kind = rest[0].toLowerCase();
  return (kind === 'photo' || kind === 'video') && X_MEDIA_INDEX.test(rest[1]);
}

// Only http(s) links to x.com or twitter.com (also www. and mobile.) whose
// path names one post: /<user>/status/<id>, /i/web/status/<id> or
// /i/status/<id>. A trailing /photo/N or /video/N, the query and the hash
// are ignored. A user name or password, a port, another host, or any other
// path (a profile, a list, a search) is not a post link.
// { url, user, id }: url is https://twitter.com/<user>/status/<id>, or
// https://twitter.com/i/web/status/<id> when the link names no user.
export function parseXStatusUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  // new URL drops the scheme's own default port, so any port left is odd.
  if (url.port) return null;
  if (!X_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = pathParts(url.pathname);
  if (!parts || parts.length < 3) return null;
  const first = parts[0].toLowerCase();
  let user = '';
  let id = '';
  let rest = [];
  if (first === 'i' && parts[1].toLowerCase() === 'web' && parts.length >= 4 && parts[2].toLowerCase() === 'status') {
    id = parts[3];
    rest = parts.slice(4);
  } else if (first === 'i' && parts[1].toLowerCase() === 'status') {
    id = parts[2];
    rest = parts.slice(3);
  } else if (parts[1].toLowerCase() === 'status' && X_USER.test(parts[0]) && first !== 'i') {
    user = parts[0];
    id = parts[2];
    rest = parts.slice(3);
  } else {
    return null;
  }
  if (!X_ID.test(id) || !restIsMedia(rest)) return null;
  const canonical = user
    ? `https://twitter.com/${user}/status/${id}`
    : `https://twitter.com/i/web/status/${id}`;
  return { url: canonical, user, id };
}

// The canonical link, or "".
export function xStatusUrl(value) {
  const hit = parseXStatusUrl(value);
  return hit ? hit.url : '';
}

// A link in running text: http(s):// and the characters a URL can hold.
// It cannot start in the middle of a word ("foohttps://...").
const LINK = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
// Sentence punctuation right after a link is not part of it.
const LINK_TAIL = /[.,;:!?'"*)\]]+$/;

// Every post link in the text, in order, with where it sits. One post
// linked twice is listed twice; xStatusUrlsIn lists it once.
// [{ index, raw, url, user, id }]: raw is the text as written (the part
// an anchor covers), url the canonical link.
export function xStatusMatches(text) {
  const source = String(text == null ? '' : text);
  const found = [];
  if (!/https?:\/\//i.test(source)) return found;
  for (const match of source.matchAll(LINK)) {
    const before = match.index > 0 ? source[match.index - 1] : '';
    if (before && /[\p{L}\p{N}_]/u.test(before)) continue;
    const raw = match[0].replace(LINK_TAIL, '');
    const hit = parseXStatusUrl(raw);
    if (!hit) continue;
    found.push({ index: match.index, raw, ...hit });
  }
  return found;
}

// The canonical post links in a body, each post once (by its id, so
// x.com/a/status/1 and twitter.com/i/web/status/1 are one post).
export function xStatusUrlsIn(text) {
  const urls = [];
  const seen = new Set();
  for (const hit of xStatusMatches(text)) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    urls.push(hit.url);
  }
  return urls;
}

// ── Settings ─────────────────────────────────────────────────────────────

function readOn() {
  try {
    return localStorage.getItem(X_EMBEDS_KEY) !== 'off';
  } catch {
    return true;
  }
}

let embedsOn = readOn();

export function xEmbedsOn() {
  return embedsOn;
}

function dataSaverOn() {
  try {
    return localStorage.getItem(DATA_SAVER_KEY) === 'on';
  } catch {
    return false;
  }
}

// Posts load as they come near the screen only while the switch is on and
// Data saver is off; otherwise each one waits for its button.
function loadsByItself() {
  return embedsOn && !dataSaverOn();
}

// Both switches call this. Placeholders on screen follow; posts already
// shown stay.
export function setXEmbedsOn(on) {
  const next = !!on;
  if (next === embedsOn) return;
  embedsOn = next;
  try { localStorage.setItem(X_EMBEDS_KEY, next ? 'on' : 'off'); } catch { /* this visit only */ }
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('x-embeds-change', { detail: next }));
  }
  refreshXEmbeds();
}

// A switch row (role="switch") bound to the setting: paints its state,
// flips it, and stays in step with the other switch.
export function bindXEmbedsSwitch(button) {
  if (!button || button.dataset.xBound === '1') return;
  button.dataset.xBound = '1';
  const paint = () => {
    button.classList.toggle('is-on', embedsOn);
    button.setAttribute('aria-checked', embedsOn ? 'true' : 'false');
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setXEmbedsOn(!embedsOn);
    paint();
  });
  document.addEventListener('x-embeds-change', paint);
  paint();
}

if (typeof window !== 'undefined') {
  // Another tab changed it.
  window.addEventListener('storage', (event) => {
    if (event.key !== X_EMBEDS_KEY && event.key !== DATA_SAVER_KEY) return;
    if (event.key === X_EMBEDS_KEY) {
      const next = readOn();
      if (next !== embedsOn) {
        embedsOn = next;
        document.dispatchEvent(new CustomEvent('x-embeds-change', { detail: next }));
      }
    }
    refreshXEmbeds();
  });
}

// ── widgets.js ───────────────────────────────────────────────────────────

let widgets = null;
let widgetsFailedAt = 0;

function widgetsReady() {
  const twttr = typeof window !== 'undefined' ? window.twttr : null;
  return !!(twttr && twttr.widgets && typeof twttr.widgets.createTweet === 'function');
}

// X's script, added once; every embed waits on the same promise.
export function loadXWidgets() {
  if (widgets) return widgets;
  if (widgetsReady()) {
    widgets = Promise.resolve(window.twttr);
    return widgets;
  }
  if (widgetsFailedAt && Date.now() - widgetsFailedAt < WIDGETS_RETRY_MS) {
    return Promise.reject(new Error('x widgets'));
  }
  let script = null;
  widgets = new Promise((resolve, reject) => {
    script = document.createElement('script');
    script.async = true;
    script.charset = 'utf-8';
    script.src = X_WIDGETS_SRC;
    script.onload = () => {
      const twttr = window.twttr;
      if (twttr && typeof twttr.ready === 'function') {
        twttr.ready(() => (widgetsReady() ? resolve(window.twttr) : reject(new Error('x widgets'))));
      } else if (widgetsReady()) {
        resolve(window.twttr);
      } else {
        reject(new Error('x widgets'));
      }
    };
    script.onerror = () => reject(new Error('x widgets'));
    document.head.appendChild(script);
  }).catch((err) => {
    // Blocked or offline: the links stay, and a later post may try again.
    widgets = null;
    widgetsFailedAt = Date.now();
    if (script) script.remove();
    throw err;
  });
  return widgets;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ── Links in the text ────────────────────────────────────────────────────

function insideSkipped(node, root) {
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.classList.contains('x-embed-list')) return true;
  }
  return false;
}

// Post links in root's text nodes become anchors. Hashtag buttons, topic
// id spans and links already made are left alone; the anchor's text is
// the link as written, so root.textContent does not change. Returns every
// post link in root, in order, the ones made before included:
// [{ url, id }].
function linkify(root) {
  if (typeof document === 'undefined' || !root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue;
    if (!value || value.indexOf('://') < 0) continue;
    if (insideSkipped(node, root)) continue;
    nodes.push(node);
  }
  for (const node of nodes) {
    const value = node.nodeValue;
    const hits = xStatusMatches(value);
    if (!hits.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const hit of hits) {
      if (hit.index > last) frag.append(value.slice(last, hit.index));
      const link = document.createElement('a');
      link.className = 'x-status-link';
      link.href = hit.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.xId = hit.id;
      link.textContent = hit.raw;
      // The card or popup under it has its own taps.
      link.addEventListener('click', (event) => event.stopPropagation());
      frag.append(link);
      last = hit.index + hit.raw.length;
    }
    if (last < value.length) frag.append(value.slice(last));
    node.replaceWith(frag);
  }
  const found = [];
  for (const link of root.querySelectorAll('a.x-status-link[data-x-id]')) {
    found.push({ url: link.getAttribute('href') || '', id: link.dataset.xId || '' });
  }
  return found;
}

// ── Embeds ───────────────────────────────────────────────────────────────

// textEl -> { posts, host, after, list, key }
const hosts = new WeakMap();

const SVG_NS = 'http://www.w3.org/2000/svg';

function xMark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'x-embed-mark');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z');
  svg.appendChild(path);
  return svg;
}

// The placeholder: the X mark and a word, or the Show post from X button.
// createTweet puts X's post into .x-embed-frame.
function buildEmbed(post) {
  const card = document.createElement('div');
  card.className = 'x-embed is-pending';
  card.dataset.xId = post.id;
  card.dataset.xUrl = post.url;
  const wait = document.createElement('div');
  wait.className = 'x-embed-wait';
  const note = document.createElement('span');
  note.className = 'x-embed-note';
  note.textContent = 'Post on X';
  wait.append(xMark(), note);
  const frame = document.createElement('div');
  frame.className = 'x-embed-frame';
  card.append(wait, frame);
  return card;
}

// The nearest ancestor that scrolls now, so the near margin counts from
// its edges (a margin on the viewport does not reach inside a scroller).
function scrollRootOf(el) {
  for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
  }
  return null;
}

// root (null: the viewport) -> its observer.
const observers = new Map();

function observerFor(root) {
  let observer = observers.get(root);
  if (observer) return observer;
  const onSeen = (entries) => {
    for (const entry of entries) {
      const card = entry.target;
      if (!card.isConnected) {
        // It was on the page and left it. One watched before it was placed
        // keeps waiting.
        if (card._xPlaced) unwatchCard(card);
        continue;
      }
      card._xPlaced = true;
      if (!entry.isIntersecting) continue;
      unwatchCard(card);
      loadEmbed(card);
    }
    // A scroller that left the page takes its observer with it.
    if (root && !root.isConnected) {
      observer.disconnect();
      observers.delete(root);
    }
  };
  try {
    observer = new IntersectionObserver(onSeen, { root, rootMargin: NEAR_MARGIN, threshold: 0 });
  } catch {
    observer = new IntersectionObserver(onSeen, { root, threshold: 0 });
  }
  observers.set(root, observer);
  return observer;
}

// Placeholders wait a frame for the page to place them, then the root is
// read for all of them in one go.
const toWatch = new Set();
// Placeholders an observer has: a feed card dropped off the page before it
// came near the screen gets no callback, so they are swept here.
const watching = new Set();
let watchFrame = 0;

function sweep() {
  for (const card of watching) {
    if (card._xPlaced && !card.isConnected) unwatchCard(card);
  }
  for (const card of sized) {
    if (!card.isConnected) unsize(card);
  }
}

function flushWatch() {
  watchFrame = 0;
  if (watching.size + sized.size > 40) sweep();
  const cards = [...toWatch];
  toWatch.clear();
  for (const card of cards) {
    if (!card.classList.contains('is-pending') || card.classList.contains('is-asking')) continue;
    if (card._xObserver) continue;
    let root = null;
    if (card.isConnected) {
      root = scrollRootOf(card);
    } else if ((card._xTries = (card._xTries || 0) + 1) < 30) {
      // Not on the page yet (built ahead of its parent): try next frame.
      toWatch.add(card);
      continue;
    }
    // Still off the page, or placed: the viewport observer reports it
    // once it is there.
    const observer = observerFor(root && root.isConnected ? root : null);
    card._xObserver = observer;
    card._xRoot = root;
    card._xPlaced = card.isConnected;
    watching.add(card);
    observer.observe(card);
  }
  if (toWatch.size && !watchFrame) watchFrame = requestAnimationFrame(flushWatch);
}

function watchCard(card) {
  if (typeof IntersectionObserver !== 'function') {
    loadEmbed(card);
    return;
  }
  toWatch.add(card);
  if (!watchFrame) watchFrame = requestAnimationFrame(flushWatch);
}

function unwatchCard(card) {
  toWatch.delete(card);
  watching.delete(card);
  if (card._xObserver) {
    card._xObserver.unobserve(card);
    card._xObserver = null;
  }
}

// ── Keeping the reader's place ───────────────────────────────────────────
// X's post grows the placeholder to its full height, in steps as it
// renders. Above the visible part of its scroller that would push what is
// being read down (the feed scroller does not anchor), and a chat read at
// its end would leave the end; both are put back.

const sized = new Set();
const heights = new WeakMap();

function anchorsItself(root) {
  if (typeof CSS === 'undefined' || !CSS.supports || !CSS.supports('overflow-anchor', 'auto')) return false;
  return getComputedStyle(root).overflowAnchor !== 'none';
}

const resizer = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const entry of entries) {
      const card = entry.target;
      if (!card.isConnected) {
        unsize(card);
        continue;
      }
      const height = card.getBoundingClientRect().height;
      const was = heights.get(card);
      heights.set(card, height);
      const grew = was === undefined ? 0 : height - was;
      const root = card._xRoot && card._xRoot.isConnected ? card._xRoot : null;
      if (!grew || !root) continue;
      const view = root.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      const fromEnd = root.scrollHeight - root.scrollTop - root.clientHeight;
      if (grew > 0 && box.top >= view.top && Math.abs(fromEnd - grew) <= 2) {
        // It was at the end before this card grew: stay there.
        root.scrollTop = root.scrollHeight;
      } else if (box.top < view.top && !anchorsItself(root)) {
        root.scrollTop += grew;
      }
    }
  })
  : null;

function size(card) {
  if (!resizer || sized.has(card)) return;
  sized.add(card);
  resizer.observe(card);
}

function unsize(card) {
  if (!sized.has(card)) return;
  sized.delete(card);
  heights.delete(card);
  if (resizer) resizer.unobserve(card);
}

// ── States ───────────────────────────────────────────────────────────────

// Off or under Data saver: a button asks first.
function askFirst(card) {
  unwatchCard(card);
  card.classList.add('is-asking');
  if (card.querySelector('.x-embed-load')) return;
  const load = document.createElement('button');
  load.type = 'button';
  load.className = 'x-embed-load';
  load.textContent = 'Show post from X';
  load.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    stopAsking(card);
    loadEmbed(card);
  });
  const wait = card.querySelector('.x-embed-wait');
  (wait || card).appendChild(load);
}

function stopAsking(card) {
  card.classList.remove('is-asking');
  const load = card.querySelector('.x-embed-load');
  if (load) load.remove();
}

// A placeholder loads near the screen, or waits for its button.
function armCard(card) {
  if (!card.classList.contains('is-pending') || card.classList.contains('is-loading')) return;
  if (!loadsByItself()) {
    askFirst(card);
    return;
  }
  stopAsking(card);
  watchCard(card);
}

async function loadEmbed(card) {
  if (!card.classList.contains('is-pending') || card.classList.contains('is-loading')) return;
  unwatchCard(card);
  stopAsking(card);
  card.classList.add('is-loading');
  const note = card.querySelector('.x-embed-note');
  if (note) note.textContent = 'Loading post…';
  const frame = card.querySelector('.x-embed-frame');
  size(card);
  let shown = null;
  try {
    const twttr = await loadXWidgets();
    // Gone while the script loaded (the feed dropped its card): no post.
    if (card.parentNode && frame) {
      shown = await withTimeout(twttr.widgets.createTweet(card.dataset.xId, frame, { ...X_EMBED_OPTIONS }), RENDER_TIMEOUT_MS);
    }
  } catch {
    shown = null;
  }
  card.classList.remove('is-loading');
  if (!card.parentNode) return;
  if (!shown) {
    dropCard(card);
    return;
  }
  card.classList.remove('is-pending');
  card.classList.add('is-ready');
  const wait = card.querySelector('.x-embed-wait');
  if (wait) wait.remove();
}

// X would not show it: the link in the text stays, the placeholder goes.
function dropCard(card) {
  unwatchCard(card);
  unsize(card);
  const list = card.parentElement;
  card.remove();
  if (list && list.classList.contains('x-embed-list') && !list.firstElementChild) list.remove();
}

// A Show more the page put under the text after the embeds were first
// mounted (the feed's clamp adds its button a frame later). Embeds mounted
// again go after it, where they were.
const MORE_BUTTONS = '.feed-more, .chat-msg-more, .swap-bio-more';

function placeList(list, state, textEl) {
  if (state.host) {
    state.host.appendChild(list);
    return true;
  }
  let after = state.after && state.after.parentNode ? state.after : textEl;
  if (!after.parentNode) return false;
  while (after.nextElementSibling && after.nextElementSibling.matches(MORE_BUTTONS)) {
    after = after.nextElementSibling;
  }
  after.after(list);
  return true;
}

function dropList(state) {
  if (!state.list) return;
  for (const card of state.list.querySelectorAll('.x-embed')) {
    unwatchCard(card);
    unsize(card);
  }
  state.list.remove();
  state.list = null;
  state.key = '';
}

function mountList(textEl) {
  const state = hosts.get(textEl);
  if (!state) return;
  const key = state.posts.map((post) => post.id).join(' ');
  if (state.list && key && state.key === key && state.list.isConnected === textEl.isConnected) {
    // The same posts: no second embed. Placeholders follow the settings.
    for (const card of state.list.querySelectorAll('.x-embed.is-pending')) armCard(card);
    return;
  }
  dropList(state);
  if (!key) return;
  const list = document.createElement('div');
  list.className = 'x-embed-list';
  for (const post of state.posts) list.appendChild(buildEmbed(post));
  if (!placeList(list, state, textEl)) return;
  state.list = list;
  state.key = key;
  for (const card of [...list.children]) armCard(card);
}

// Call after the text is painted and placed (it needs a parent to put the
// embeds after). A repaint calls it again: the same posts keep their
// embeds, others replace them, none removes them.
// opts.after: the node the embeds follow (a Show more button under the
//   text); default the text itself.
// opts.host: a box the embeds go last in instead (a map popup's message
//   box, whose Show more is added by popuptext.js).
export function paintXEmbeds(textEl, opts = {}) {
  if (!textEl) return;
  let state = hosts.get(textEl);
  const value = textEl.textContent || '';
  if (!state && value.indexOf('://') < 0) return;
  const hits = value.indexOf('://') < 0 ? [] : linkify(textEl);
  const posts = [];
  const seen = new Set();
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    posts.push(hit);
    if (posts.length >= X_EMBED_MAX) break;
  }
  if (!state) {
    if (!posts.length) return;
    state = { posts: [], host: null, after: null, list: null, key: '' };
    hosts.set(textEl, state);
  }
  state.posts = posts;
  if (opts.host !== undefined) state.host = opts.host || null;
  if (opts.after !== undefined) state.after = opts.after || null;
  if (posts.length) textEl.dataset.xEmbeds = '1';
  else delete textEl.dataset.xEmbeds;
  mountList(textEl);
}

// Take a text's embeds away (its row closed, its text emptied).
export function clearXEmbeds(textEl) {
  const state = textEl && hosts.get(textEl);
  if (!state) return;
  dropList(state);
  state.posts = [];
  delete textEl.dataset.xEmbeds;
}

// A switch changed: placeholders on the page load near the screen again,
// or wait for their button. Posts already shown stay; nothing else in the
// feed is rebuilt.
export function refreshXEmbeds() {
  if (typeof document === 'undefined') return;
  for (const textEl of document.querySelectorAll('[data-x-embeds="1"]')) mountList(textEl);
}
