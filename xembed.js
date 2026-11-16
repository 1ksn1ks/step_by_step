// X post cards. A link to an X post in user text (a feed post, a map
// popup and its Show more page, a chat message, a Swap bio, a profile or
// topic bio) becomes a link that opens X in a new tab, and a small card
// under the text shows who posted it and what it says.
//
// X's widgets.js is never loaded and X's HTML never reaches the page: the
// server (server/xembed.js, GET /api/x-embed) turns X's oEmbed answer into
// plain fields and the card is filled with textContent.
//
// A card starts as a compact placeholder and asks the server only once an
// IntersectionObserver sees it near the screen. One request per post at a
// time, and answers are kept for the visit, so the same post in several
// places, or a card rebuilt when the feed scrolls back, asks once.
//
// Settings: Show X embeds (this device, on by default; the feed's
// Settings > Media and Settings > Popups share it). Off, no card is
// mounted or fetched; the link in the text stays. Data saver (the feed's
// switch) keeps cards from loading by themselves: the placeholder has a
// Show post from X button instead.
//
// The card is a sibling after the text block (never inside the bubble),
// so a clamp, a popup's flow box and its reading ring stay as they are.
import { xStatusMatches } from './server/xembed.js';

export const X_EMBEDS_KEY = 'meritocracy-x-embeds';
// feedlayout.js FEED_SETTING.data: 'on' while Data saver is on.
const DATA_SAVER_KEY = 'feed-setting-data';
// Cards under one text. A post that links more posts keeps the links.
const X_EMBED_MAX = 2;
const HIT_MS = 60 * 60 * 1000;
const MISS_MS = 15 * 60 * 1000;
const CACHE_MAX = 300;
const FETCH_TIMEOUT_MS = 12000;
const NEAR_MARGIN = '25% 0%';
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

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

// Both switches call this. Cards on screen follow: off removes them, on
// mounts them again under every text that links a post.
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

// ── Answers ──────────────────────────────────────────────────────────────
// url -> { data, until }; data is null for a post the server will not
// describe. Capped; a read moves the url to the end.
const answers = new Map();
const flights = new Map();
let backoffUntil = 0;

function remember(url, data) {
  if (answers.has(url)) answers.delete(url);
  answers.set(url, { data, until: Date.now() + (data ? HIT_MS : MISS_MS) });
  while (answers.size > CACHE_MAX) {
    const oldest = answers.keys().next().value;
    if (oldest === undefined) break;
    answers.delete(oldest);
  }
}

function known(url) {
  const hit = answers.get(url);
  if (!hit) return null;
  if (Date.now() >= hit.until) {
    answers.delete(url);
    return null;
  }
  answers.delete(url);
  answers.set(url, hit);
  return hit;
}

function text(value, max) {
  const out = typeof value === 'string' ? value : '';
  return out.length > max ? out.slice(0, max) : out;
}

// Only the fields the card shows, as strings. The link is always ours.
function cleanAnswer(body, url) {
  if (!body || typeof body !== 'object' || body.ok !== true) return null;
  const handle = text(body.authorHandle, 15);
  const data = {
    authorName: text(body.authorName, 100).replace(/\s+/g, ' ').trim(),
    authorHandle: HANDLE.test(handle) ? handle : '',
    text: text(body.text, 1200).trim(),
    url,
  };
  if (!data.text && !data.authorName) return null;
  return data;
}

function retryAfterMs(res) {
  const secs = Number(res.headers && res.headers.get('Retry-After'));
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 120) * 1000;
  return 30 * 1000;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAnswer(url, retried) {
  const hold = backoffUntil - Date.now();
  if (hold > 0) await wait(hold);
  let res;
  try {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
      : undefined;
    res = await fetch(`/api/x-embed?url=${encodeURIComponent(url)}`, { signal });
  } catch {
    // Offline or timed out: not remembered, the next card asks again.
    return null;
  }
  if (res.status === 429 && !retried) {
    backoffUntil = Date.now() + retryAfterMs(res);
    return fetchAnswer(url, true);
  }
  if (res.status === 429) return null;
  if (!res.ok) {
    remember(url, null);
    return null;
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  const data = cleanAnswer(body, url);
  remember(url, data);
  return data;
}

// The post's fields, or null. One request per url at a time.
export function requestXEmbed(url) {
  const hit = known(url);
  if (hit) return Promise.resolve(hit.data);
  let flight = flights.get(url);
  if (!flight) {
    flight = fetchAnswer(url, false).finally(() => flights.delete(url));
    flights.set(url, flight);
  }
  return flight;
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

// ── Cards ────────────────────────────────────────────────────────────────

// textEl -> { urls, host, after, list, key }
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

function buildCard(url) {
  const card = document.createElement('article');
  card.className = 'x-embed is-pending';
  card.dataset.xUrl = url;
  card.setAttribute('aria-label', 'Post on X');
  const head = document.createElement('div');
  head.className = 'x-embed-head';
  const who = document.createElement('span');
  who.className = 'x-embed-who';
  const name = document.createElement('span');
  name.className = 'x-embed-name';
  const handle = document.createElement('span');
  handle.className = 'x-embed-handle';
  who.append(name, handle);
  head.append(xMark(), who);
  const body = document.createElement('p');
  body.className = 'x-embed-text';
  const foot = document.createElement('div');
  foot.className = 'x-embed-foot';
  const view = document.createElement('a');
  view.className = 'x-embed-view';
  view.href = url;
  view.target = '_blank';
  view.rel = 'noopener noreferrer';
  view.textContent = 'View on X';
  view.addEventListener('click', (event) => event.stopPropagation());
  foot.appendChild(view);
  card.append(head, body, foot);
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
      loadCard(card);
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

// Cards wait a frame for the page to place them, then the root is read
// for all of them in one go.
const toWatch = new Set();
// Cards an observer has: a feed card dropped off the page before it came
// near the screen gets no callback, so they are swept here.
const watching = new Set();
let watchFrame = 0;

function sweepWatching() {
  for (const card of watching) {
    if (card._xPlaced && !card.isConnected) unwatchCard(card);
  }
}

function flushWatch() {
  watchFrame = 0;
  if (watching.size > 40) sweepWatching();
  const cards = [...toWatch];
  toWatch.clear();
  for (const card of cards) {
    if (!card.classList.contains('is-pending') || card.classList.contains('is-saver')) continue;
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
    loadCard(card);
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

function showSaver(card) {
  unwatchCard(card);
  card.classList.add('is-saver');
  if (card.querySelector('.x-embed-load')) return;
  const load = document.createElement('button');
  load.type = 'button';
  load.className = 'x-embed-load';
  load.textContent = 'Show post from X';
  load.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.remove('is-saver');
    load.remove();
    loadCard(card);
  });
  const head = card.querySelector('.x-embed-head');
  if (head) head.after(load);
  else card.prepend(load);
}

function hideSaver(card) {
  card.classList.remove('is-saver');
  const load = card.querySelector('.x-embed-load');
  if (load) load.remove();
}

// A pending card loads by itself, or waits for a tap under Data saver.
function armCard(card) {
  const url = card.dataset.xUrl || '';
  const hit = known(url);
  if (hit) {
    if (hit.data) fillCard(card, hit.data);
    else dropCard(card);
    return;
  }
  if (card.classList.contains('is-loading')) return;
  if (dataSaverOn()) {
    showSaver(card);
    return;
  }
  hideSaver(card);
  watchCard(card);
}

async function loadCard(card) {
  if (!card.classList.contains('is-pending') || card.classList.contains('is-loading')) return;
  unwatchCard(card);
  card.classList.add('is-loading');
  const data = await requestXEmbed(card.dataset.xUrl || '');
  card.classList.remove('is-loading');
  if (!card.parentNode) return;
  if (data) fillCard(card, data);
  else dropCard(card);
}

function atEnd(root) {
  return root.scrollHeight - root.scrollTop - root.clientHeight <= 1;
}

function anchorsItself(root) {
  if (typeof CSS === 'undefined' || !CSS.supports || !CSS.supports('overflow-anchor', 'auto')) return false;
  return getComputedStyle(root).overflowAnchor !== 'none';
}

// The card grows when it fills. A card above the visible part of its
// scroller would push what is being read down, and a chat read at its
// end would leave the end; both are put back.
function keepPlace(card, change) {
  const root = card._xRoot && card._xRoot.isConnected ? card._xRoot : null;
  if (!root || !card.isConnected) {
    change();
    return;
  }
  const view = root.getBoundingClientRect();
  const before = card.getBoundingClientRect();
  const end = atEnd(root);
  change();
  const after = card.getBoundingClientRect();
  const grew = after.height - before.height;
  if (end) {
    root.scrollTop = root.scrollHeight;
  } else if (grew && before.top < view.top && !anchorsItself(root)) {
    root.scrollTop += grew;
  }
}

function fillCard(card, data) {
  unwatchCard(card);
  keepPlace(card, () => {
    hideSaver(card);
    card.classList.remove('is-pending', 'is-loading');
    card.classList.add('is-ready');
    const name = card.querySelector('.x-embed-name');
    const handle = card.querySelector('.x-embed-handle');
    const body = card.querySelector('.x-embed-text');
    const at = data.authorHandle ? '@' + data.authorHandle : '';
    if (name) name.textContent = data.authorName || at || 'Post on X';
    if (handle) {
      handle.textContent = data.authorName ? at : '';
      handle.hidden = !handle.textContent;
    }
    if (body) {
      body.textContent = data.text;
      body.hidden = !data.text;
    }
    const by = data.authorName || at;
    card.setAttribute('aria-label', by ? `Post on X by ${by}` : 'Post on X');
  });
}

// X would not describe it: the link in the text stays, the card goes.
function dropCard(card) {
  unwatchCard(card);
  const list = card.parentElement;
  card.remove();
  if (list && list.classList.contains('x-embed-list') && !list.firstElementChild) list.remove();
}

// A Show more the page put under the text after the cards were first
// mounted (the feed's clamp adds its button a frame later). Cards mounted
// again, after the switch, go after it, where they were.
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
  for (const card of state.list.querySelectorAll('.x-embed')) unwatchCard(card);
  state.list.remove();
  state.list = null;
  state.key = '';
}

function mountList(textEl) {
  const state = hosts.get(textEl);
  if (!state) return;
  const key = embedsOn && state.urls.length ? state.urls.join(' ') : '';
  if (state.list && key && state.key === key && state.list.isConnected === textEl.isConnected) {
    // The same posts: keep the cards, follow Data saver.
    for (const card of state.list.querySelectorAll('.x-embed.is-pending')) armCard(card);
    return;
  }
  dropList(state);
  if (!key) return;
  const list = document.createElement('div');
  list.className = 'x-embed-list';
  for (const url of state.urls) list.appendChild(buildCard(url));
  if (!placeList(list, state, textEl)) return;
  state.list = list;
  state.key = key;
  for (const card of [...list.children]) armCard(card);
}

// Call after the text is painted and placed (it needs a parent to put the
// cards after). Repaint calls it again: the same posts keep their cards,
// others replace them, none removes them.
// opts.after: the node the cards follow (a Show more button under the
//   text); default the text itself.
// opts.host: a box the cards go last in instead (a map popup's message
//   box, whose Show more is added by popuptext.js).
export function paintXEmbeds(textEl, opts = {}) {
  if (!textEl) return;
  let state = hosts.get(textEl);
  const value = textEl.textContent || '';
  if (!state && value.indexOf('://') < 0) return;
  const hits = value.indexOf('://') < 0 ? [] : linkify(textEl);
  const urls = [];
  const seen = new Set();
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    urls.push(hit.url);
    if (urls.length >= X_EMBED_MAX) break;
  }
  if (!state) {
    if (!urls.length) return;
    state = { urls: [], host: null, after: null, list: null, key: '' };
    hosts.set(textEl, state);
  }
  state.urls = urls;
  if (opts.host !== undefined) state.host = opts.host || null;
  if (opts.after !== undefined) state.after = opts.after || null;
  if (urls.length) textEl.dataset.xEmbeds = '1';
  else delete textEl.dataset.xEmbeds;
  mountList(textEl);
}

// Take a text's cards away (its row closed, its text emptied).
export function clearXEmbeds(textEl) {
  const state = textEl && hosts.get(textEl);
  if (!state) return;
  dropList(state);
  state.urls = [];
  delete textEl.dataset.xEmbeds;
}

// The switches changed: every text on the page that links a post mounts
// or drops its cards, and pending cards follow Data saver. Nothing else in
// the feed is rebuilt.
export function refreshXEmbeds() {
  if (typeof document === 'undefined') return;
  for (const textEl of document.querySelectorAll('[data-x-embeds="1"]')) mountList(textEl);
}
