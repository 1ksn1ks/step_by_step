// X posts in user text. A link to an X post (a feed post, a map popup and
// its Show more page, a chat message, a Swap bio, a profile or topic bio)
// becomes a link that opens X in a new tab, and X's own embedded post
// shows under the text: X's widgets.js, twttr.widgets.createTweet.
//
// Each embed starts as a small placeholder. widgets.js is loaded once (one
// shared promise), and only when a placeholder comes near the screen
// (IntersectionObserver), so posts further down load nothing. While the
// post shows, its link is not shown in the text. The post is scaled so its
// text is the size of the text it sits under, on every device.
//
// Settings: Show X posts (this device, on by default; the feed's
// Settings > Media and Settings > Popups share it). Off, the link shows and
// nothing is loaded from X. If widgets.js cannot load, or X has no such
// post (deleted, private), the placeholder goes and the link shows.
//
// The embed is a sibling after the text block (never inside the bubble),
// so a clamp, a popup's flow box and its reading ring stay as they are.

export const X_EMBEDS_KEY = 'meritocracy-x-embeds';
export const X_WIDGETS_SRC = 'https://platform.twitter.com/widgets.js';
export const X_EMBED_OPTIONS = Object.freeze({ theme: 'dark', dnt: true, conversation: 'none', align: 'center' });
// X's post text in its embed, in X's own pixels (the name, time and buttons
// are 14-15). The post is scaled so this matches the text around it.
export const X_TEXT_PX = 20;
// X does not draw a post narrower than this; the scale leaves room for it.
const X_MIN_WIDTH = 250;
// Embeds under one text. A post that links more posts keeps the links.
const X_EMBED_MAX = 2;
const NEAR_MARGIN = '15% 0%';
// A widgets.js that did not load is not asked for again for a minute.
const WIDGETS_RETRY_MS = 60 * 1000;
// createTweet that never settles counts as a post X will not show.
const RENDER_TIMEOUT_MS = 20 * 1000;
// An unlocked post in a map popup locks again after this long with no
// touch on the card. Touches inside X's iframe cannot be seen.
const LOCK_IDLE_MS = 8000;
const LOCK_LABEL = 'Swipe to change post, tap to use';
const UNLOCK_LABEL = 'Using X post';

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

// Both switches call this. Texts on screen follow: off takes the posts
// away and shows the links, on brings the posts back.
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
    if (event.key !== X_EMBEDS_KEY) return;
    const next = readOn();
    if (next === embedsOn) return;
    embedsOn = next;
    document.dispatchEvent(new CustomEvent('x-embeds-change', { detail: next }));
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

// X builds its post at the width its box has when it is asked. A map
// popup is still being sized as it opens, so wait until the box keeps the
// same width for two frames (at most about half a second).
async function settledWidth(el) {
  if (typeof requestAnimationFrame !== 'function') return;
  let last = -1;
  let same = 0;
  for (let i = 0; i < 30 && same < 2; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const width = el.clientWidth;
    same = width > 0 && width === last ? same + 1 : 0;
    last = width;
  }
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

// While X's post shows under the text, its link is not shown in the text:
// the link and the spaces that only separated it go, so the words around
// it read as if it was never there. Which part of `value` (one text node)
// goes for each link; `before` and `after` are the text around the node.
//   "look <link> and more"  -> "look and more"   (the space before goes)
//   "Hello\n<link>\nWorld"  -> "Hello\nWorld"    (the line it was on goes)
//   "Hello\n\n<link>"       -> "Hello"           (nothing after: all of it)
// [{ hit, from, to }], from/to as indexes into value.
export function xHideRanges(value, before = '', after = '') {
  const text = String(value == null ? '' : value);
  const hits = xStatusMatches(text);
  const ranges = [];
  let last = 0;
  // What still shows before the current link (hidden links taken out).
  let kept = String(before || '');
  hits.forEach((hit, i) => {
    const start = hit.index;
    const end = start + hit.raw.length;
    let preStart = start;
    while (preStart > last && /\s/.test(text[preStart - 1])) preStart -= 1;
    const limit = i + 1 < hits.length ? hits[i + 1].index : text.length;
    let postEnd = end;
    while (postEnd < limit && /\s/.test(text[postEnd])) postEnd += 1;
    const lineStart = /(^|\n)[ \t]*$/.test(kept + text.slice(last, start));
    let from = lineStart ? start : preStart;
    const to = lineStart ? postEnd : end;
    // Nothing but space after it: the space before goes too.
    if (!/\S/.test(text.slice(to) + after)) from = preStart;
    ranges.push({ hit, from, to });
    kept += text.slice(last, from);
    last = to;
  });
  return ranges;
}

// Post links in root's text nodes become anchors, each inside a span with
// the spacing that goes with it (xHideRanges), so the span can be hidden
// while X's post shows and shown again if it cannot. Hashtag buttons,
// topic id spans and links already made are left alone; the text is kept
// as written, so root.textContent does not change (Show more and Copy read
// it). Returns every post link in root, in order, the ones made before
// included: [{ url, id }].
function linkify(root) {
  if (typeof document === 'undefined' || !root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const all = [];
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    all.push(node);
    const value = node.nodeValue;
    if (!value || value.indexOf('://') < 0) continue;
    if (insideSkipped(node, root)) continue;
    nodes.push(node);
  }
  const texts = all.map((node) => node.nodeValue || '');
  for (const node of nodes) {
    const value = node.nodeValue;
    const at = all.indexOf(node);
    const ranges = xHideRanges(value, texts.slice(0, at).join(''), texts.slice(at + 1).join(''));
    if (!ranges.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const { hit, from, to } of ranges) {
      if (from > last) frag.append(value.slice(last, from));
      const span = document.createElement('span');
      span.className = 'x-status';
      span.dataset.xId = hit.id;
      if (hit.index > from) span.append(value.slice(from, hit.index));
      const link = document.createElement('a');
      link.className = 'x-status-link';
      link.href = hit.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.xId = hit.id;
      link.textContent = hit.raw;
      // The card or popup under it has its own taps.
      link.addEventListener('click', (event) => event.stopPropagation());
      span.append(link);
      const end = hit.index + hit.raw.length;
      if (to > end) span.append(value.slice(end, to));
      frag.append(span);
      last = to;
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

// The links of posts shown under the text are hidden; the text itself is
// hidden when nothing else is left in it (only a link was posted), and a
// map popup's message box then gives X's post all its room.
function paintLinks(textEl, state) {
  const shown = new Set(state.list ? [...state.list.querySelectorAll('.x-embed')].map((card) => card.dataset.xId) : []);
  for (const span of textEl.querySelectorAll('.x-status[data-x-id]')) {
    const hide = shown.has(span.dataset.xId);
    if (span.classList.contains('is-hidden') !== hide) span.classList.toggle('is-hidden', hide);
  }
  let visible = false;
  let hidden = false;
  const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/\S/.test(node.nodeValue || '')) continue;
    const span = node.parentElement && node.parentElement.closest('.x-status');
    if (span && textEl.contains(span) && span.classList.contains('is-hidden')) {
      hidden = true;
      continue;
    }
    visible = true;
    break;
  }
  const only = hidden && !visible;
  if (textEl.classList.contains('is-x-only') !== only) textEl.classList.toggle('is-x-only', only);
  if (state.host && state.host.classList.contains('has-x-only') !== only) state.host.classList.toggle('has-x-only', only);
  // An edit that leaves only the link (or brings text back) fits again.
  if (state.list) {
    for (const card of state.list.querySelectorAll('.x-embed.is-ready')) {
      fitEmbed(card);
      if (fitter) fitter.observe(state.list);
    }
  }
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

// The placeholder: the X mark and a word.
function embedWait() {
  const wait = document.createElement('div');
  wait.className = 'x-embed-wait';
  const note = document.createElement('span');
  note.className = 'x-embed-note';
  note.textContent = 'Post on X';
  wait.append(xMark(), note);
  return wait;
}

// createTweet puts X's post into .x-embed-frame.
function buildEmbed(post) {
  const card = document.createElement('div');
  card.className = 'x-embed is-pending';
  card.dataset.xId = post.id;
  card.dataset.xUrl = post.url;
  const frame = document.createElement('div');
  frame.className = 'x-embed-frame';
  card.append(embedWait(), frame);
  return card;
}

function restoreWait(card) {
  const note = card.querySelector('.x-embed-note');
  if (note) {
    note.textContent = 'Post on X';
    return;
  }
  const frame = card.querySelector('.x-embed-frame');
  const wait = embedWait();
  if (frame) card.insertBefore(wait, frame);
  else card.append(wait);
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
    if (!card.classList.contains('is-pending')) continue;
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
      // X changed its post's height: fit it to a popup again.
      fitEmbed(card);
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

// ── Text size ────────────────────────────────────────────────────────────
// X's post text is X_TEXT_PX at X's own size, whatever the device. The
// post is scaled (CSS zoom on its frame) so its text is the size of the
// text it sits under: the feed's caption, a popup's message, a chat
// bubble, a bio. Those sizes follow each device's screen and the popup's
// own size and font settings, so the post does too. The scale leaves the
// box at least X_MIN_WIDTH of X's pixels, or X would cut its own post.
// It is set before X builds the post, so X builds it at the box's width.
// A list with --xe-fit: height (a landscape map popup's left card) also
// keeps the whole post in its height (xEmbedFitZoom).

// The scale for a post under text of textPx pixels in a box boxWidth wide.
export function xEmbedZoom(textPx, boxWidth) {
  const want = textPx > 0 ? textPx / X_TEXT_PX : 1;
  const most = boxWidth > 0 ? boxWidth / X_MIN_WIDTH : want;
  const zoom = Math.max(0.5, Math.min(want, most, 3));
  return Math.round(zoom * 1000) / 1000;
}

// A list that must show its whole posts (--xe-fit: height, a landscape map
// popup's left card): the text-size scale, but no more than lets the
// post's height at scale 1 (natural) fit its share of the box's height
// (share; two posts share it). Never under 0.5: past that the card
// scrolls.
export function xEmbedFitZoom(textPx, boxWidth, share, natural) {
  const zoom = xEmbedZoom(textPx, boxWidth);
  if (!(share > 0) || !(natural > 0)) return zoom;
  const fit = Math.floor((share / natural) * 1000) / 1000;
  return Math.max(0.5, Math.min(zoom, fit));
}

function fitEmbed(card) {
  const frame = card.querySelector('.x-embed-frame');
  const list = card.parentElement;
  const textEl = card._xText;
  if (!frame || !list || !textEl) return;
  // A text hidden because it was only the link still has its size.
  const textPx = parseFloat(getComputedStyle(textEl).fontSize) || 0;
  const box = getComputedStyle(list);
  let zoom;
  if (box.getPropertyValue('--xe-fit').trim() === 'height') {
    zoom = heightZoom(card, frame, list, box, textPx);
  } else {
    card._xFit = null;
    zoom = xEmbedZoom(textPx, list.clientWidth);
  }
  const value = Math.abs(zoom - 1) < 0.01 ? '' : String(zoom);
  if (frame.style.zoom !== value) frame.style.zoom = value;
}

// The scale in a --xe-fit: height list. The post's height at scale 1 is
// the card's height over its scale now. X lays its post out again at each
// scale (narrower text wraps more), so within one size of the box the
// scale only goes down: a smaller post never asks for a bigger scale, and
// the two never flip. A new box size starts from the text size again.
// Until X has built the post there is no height to fit yet.
function heightZoom(card, frame, list, box, textPx) {
  const px = (name) => parseFloat(box.getPropertyValue(name)) || 0;
  const width = list.clientWidth - px('padding-left') - px('padding-right');
  const height = list.clientHeight - px('padding-top') - px('padding-bottom');
  if (!card.classList.contains('is-ready')) return xEmbedZoom(textPx, width);
  const count = list.querySelectorAll(':scope > .x-embed').length || 1;
  const share = (height - px('row-gap') * (count - 1)) / count;
  const now = parseFloat(frame.style.zoom) || 1;
  const natural = card.offsetHeight / now;
  let zoom = xEmbedFitZoom(textPx, width, share, natural);
  // The box's outer size: a scroll bar coming or going is not a new size.
  const key = `${list.offsetWidth}x${list.offsetHeight}x${count}`;
  const last = card._xFit;
  if (last && last.key === key && zoom > last.zoom) zoom = last.zoom;
  card._xFit = { key, zoom };
  return zoom;
}

// A box that changes size (the window, a phone turned, Settings > Popups >
// Size) scales its post again.
const fitter = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const entry of entries) {
      const list = entry.target;
      if (!list.isConnected) {
        fitter.unobserve(list);
        continue;
      }
      for (const card of list.querySelectorAll('.x-embed')) fitEmbed(card);
    }
  })
  : null;

function size(card) {
  if (!resizer || sized.has(card)) return;
  sized.add(card);
  resizer.observe(card);
}

function unsize(card) {
  dropLockWatch(card);
  if (!sized.has(card)) return;
  sized.delete(card);
  heights.delete(card);
  if (resizer) resizer.unobserve(card);
}

// The height the feed spacers keep: the card's layout height, or the last
// one the resizer stored once the feed is no longer measured.
function heldHeight(card) {
  const live = card.offsetHeight;
  if (live > 0) return live;
  const known = heights.get(card);
  return typeof known === 'number' && known > 0 ? known : 0;
}

// ── Map popup: swipe past X's iframe ────────────────────────────────────
// X's frame is a cross-origin iframe, so a touch on it never reaches the
// popup. While the post is locked, a shield over the frame takes the touch
// and lets it bubble: the popup's own pager turns the page. A tap (not a
// swipe, and under that same threshold) lifts the shield. The pager is not
// reimplemented here.

// A tap on the shield. A swipe is 50 or more across, and at least 1.5 times
// the vertical travel: the same test the popup pager uses. A vertical drag
// is not a tap either.
export function xEmbedLockTap(dx, dy) {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx >= 50 && adx >= ady * 1.5) return false;
  return Math.hypot(dx, dy) < 50;
}

const idleTimers = new WeakMap();

function inPopup(card) {
  return !!(card.closest && card.closest('.maplibregl-popup'));
}

function clearIdle(card) {
  const timer = idleTimers.get(card);
  if (!timer) return;
  clearTimeout(timer);
  idleTimers.delete(card);
}

function armIdle(card) {
  clearIdle(card);
  const timer = setTimeout(() => {
    idleTimers.delete(card);
    if (!card.isConnected || card.classList.contains('is-locked')) return;
    lockCard(card);
  }, LOCK_IDLE_MS);
  idleTimers.set(card, timer);
}

function prefersReducedMotion() {
  try {
    return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function paintBadge(card, locked) {
  const badge = card.querySelector('.x-embed-lock');
  if (!badge) return;
  const text = locked ? '🔒' : '🔓';
  const label = locked ? LOCK_LABEL : UNLOCK_LABEL;
  if (badge.textContent === text && badge.getAttribute('aria-label') === label) return;
  const gen = (badge._xGen || 0) + 1;
  badge._xGen = gen;
  const apply = () => {
    if (badge._xGen !== gen || badge._xApplied === gen) return;
    badge._xApplied = gen;
    badge.textContent = text;
    badge.setAttribute('aria-label', label);
    badge.classList.remove('is-fading');
  };
  const first = badge.textContent !== '🔒' && badge.textContent !== '🔓';
  if (first || prefersReducedMotion()) {
    apply();
    return;
  }
  badge.classList.add('is-fading');
  const onEnd = (event) => {
    if (event.propertyName !== 'opacity') return;
    badge.removeEventListener('transitionend', onEnd);
    apply();
  };
  badge.addEventListener('transitionend', onEnd);
  setTimeout(() => {
    badge.removeEventListener('transitionend', onEnd);
    apply();
  }, 220);
}

function lockCard(card) {
  clearIdle(card);
  card.classList.add('is-locked');
  paintBadge(card, true);
}

// The tap that lifts the shield must not also reach the post. pointer-events
// is already none, so the click would land on the iframe; it is swallowed.
function swallowUnlockClick(card) {
  if (typeof document === 'undefined') return;
  let pending = true;
  let timer = 0;
  const swallow = (event) => {
    if (!pending) return;
    pending = false;
    document.removeEventListener('click', swallow, true);
    clearTimeout(timer);
    const target = event.target;
    if (!target || !target.closest || target.closest('.x-embed') !== card) return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener('click', swallow, true);
  timer = setTimeout(() => {
    pending = false;
    document.removeEventListener('click', swallow, true);
  }, 500);
}

function unlockCard(card) {
  card.classList.remove('is-locked');
  paintBadge(card, false);
  armIdle(card);
  swallowUnlockClick(card);
}

function bindShield(card, shield) {
  let x = null;
  let y = null;
  // A finger or a stylus. A mouse is left to the post.
  const direct = (event) => event.pointerType === 'touch' || event.pointerType === 'pen';
  shield.addEventListener('pointerdown', (event) => {
    if (!direct(event)) return;
    if (!card.classList.contains('is-locked')) return;
    x = event.clientX;
    y = event.clientY;
  });
  shield.addEventListener('pointerup', (event) => {
    if (!direct(event) || x === null) return;
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    x = y = null;
    if (!card.classList.contains('is-locked')) return;
    if (!xEmbedLockTap(dx, dy)) return;
    event.preventDefault();
    unlockCard(card);
  });
  shield.addEventListener('pointercancel', () => {
    x = y = null;
  });
}

// The iframe cannot reset the timer. A touch on the card's own border,
// outside the frame and the shield, does.
function bindCardIdle(card) {
  const rest = (event) => {
    if (card.classList.contains('is-locked')) return;
    const target = event.target;
    if (target && target.closest && (target.closest('.x-embed-frame') || target.closest('.x-embed-shield'))) return;
    armIdle(card);
  };
  card.addEventListener('pointerdown', rest);
  card.addEventListener('pointermove', rest);
  card.addEventListener('pointerup', rest);
  card.addEventListener('pointercancel', rest);
}

function ensureChrome(card) {
  if (card.querySelector('.x-embed-shield')) return;
  const shield = document.createElement('div');
  shield.className = 'x-embed-shield';
  shield.setAttribute('aria-hidden', 'true');
  const badge = document.createElement('span');
  badge.className = 'x-embed-lock';
  badge.setAttribute('role', 'img');
  card.append(shield, badge);
  bindShield(card, shield);
  bindCardIdle(card);
}

function dropLockWatch(card) {
  clearIdle(card);
  const observer = card._xLockObserver;
  if (observer) {
    observer.unobserve(card);
    card._xLockObserver = null;
  }
  // Detached (or dropped) while it was a popup post: come back locked.
  if (card.querySelector && card.querySelector('.x-embed-shield')) lockCard(card);
}

function watchVisibility(card) {
  if (card._xLockObserver || typeof IntersectionObserver !== 'function') return;
  const root = scrollRootOf(card);
  let observer;
  const onSeen = (entries) => {
    for (const entry of entries) {
      if (entry.target !== card) continue;
      const gone = !card.isConnected || !inPopup(card);
      if (gone || !entry.isIntersecting) lockCard(card);
      if (!gone) continue;
      observer.unobserve(card);
      if (card._xLockObserver === observer) card._xLockObserver = null;
    }
  };
  observer = new IntersectionObserver(onSeen, { root: root && root.isConnected ? root : null, threshold: 0 });
  card._xLockObserver = observer;
  observer.observe(card);
}

// First time a ready post is on a map popup it locks. A post already being
// watched keeps its lock state (a turn of the phone must not lock it again).
function armPopupLock(card) {
  if (!card.classList.contains('is-ready') || !inPopup(card)) return;
  ensureChrome(card);
  if (card._xLockObserver) return;
  watchVisibility(card);
  lockCard(card);
}

// Every popup card locks. A rebuilt popup (swipe, arrow keys, the chips)
// calls this, and so does a post that has just been shown.
export function lockPopupXEmbeds() {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  for (const card of document.querySelectorAll('.maplibregl-popup .x-embed.is-ready')) {
    ensureChrome(card);
    if (!card._xLockObserver) watchVisibility(card);
    lockCard(card);
  }
}

// ── States ───────────────────────────────────────────────────────────────

// A placeholder loads by itself as it comes near the screen.
function armCard(card) {
  if (!card.classList.contains('is-pending') || card.classList.contains('is-loading')) return;
  watchCard(card);
}

async function loadEmbed(card) {
  if (!card.classList.contains('is-pending') || card.classList.contains('is-loading')) return;
  unwatchCard(card);
  card.classList.add('is-loading');
  const epoch = card._xEpoch || 0;
  const note = card.querySelector('.x-embed-note');
  if (note) note.textContent = 'Loading post…';
  const frame = card.querySelector('.x-embed-frame');
  size(card);
  let shown = null;
  try {
    const twttr = await loadXWidgets();
    if (frame) {
      await settledWidth(frame);
      // The scale first, so X builds the post at the width it will have.
      fitEmbed(card);
    }
    // Gone while the script loaded (the feed dropped its card): no post.
    if (card.parentNode && frame) {
      shown = await withTimeout(twttr.widgets.createTweet(card.dataset.xId, frame, { ...X_EMBED_OPTIONS }), RENDER_TIMEOUT_MS);
    }
  } catch {
    shown = null;
  }
  // The feed slept this card while X was building it. Leave the placeholder.
  if ((card._xEpoch || 0) !== epoch) {
    if (!card.classList.contains('is-loading')) {
      const live = card.querySelector('.x-embed-frame');
      if (live) live.replaceChildren();
    }
    return;
  }
  card.classList.remove('is-loading');
  if (!card.parentNode) return;
  if (!shown) {
    card.style.minHeight = '';
    dropCard(card);
    return;
  }
  card.classList.remove('is-pending');
  card.classList.add('is-ready');
  card.style.minHeight = '';
  const wait = card.querySelector('.x-embed-wait');
  if (wait) wait.remove();
  fitEmbed(card);
  if (fitter) fitter.observe(card.parentElement);
  armPopupLock(card);
}

// X would not show it: the link in the text stays, the placeholder goes.
function dropCard(card) {
  unwatchCard(card);
  unsize(card);
  const list = card.parentElement;
  card.remove();
  if (list && list.classList.contains('x-embed-list') && !list.firstElementChild) list.remove();
  const textEl = card._xText;
  const state = textEl && hosts.get(textEl);
  if (state) paintLinks(textEl, state);
}

// A Show more the page put under the text after the embeds were first
// mounted (the feed's clamp adds its button a frame later). Embeds mounted
// again go after it, where they were.
const MORE_BUTTONS = '.feed-more, .chat-msg-more, .swap-bio-more';

// Where the list goes now: { parent, before } (before null: last), or null
// while there is no place yet. A function `after` answers each time (a map
// popup's picture in portrait, its message box in landscape); with no node
// from it the list goes last in the host.
function listSpot(state, textEl) {
  const after = typeof state.after === 'function' ? state.after() : state.after;
  if (!(after && after.parentNode) && state.host) return { parent: state.host, before: null };
  let node = after && after.parentNode ? after : textEl;
  if (!node.parentNode) return null;
  while (node.nextElementSibling && node.nextElementSibling.matches(MORE_BUTTONS)) {
    node = node.nextElementSibling;
  }
  return { parent: node.parentNode, before: node.nextSibling };
}

function placeList(list, state, textEl) {
  const spot = listSpot(state, textEl);
  if (!spot) return false;
  spot.parent.insertBefore(list, spot.before);
  return true;
}

// A shown list whose place changed. moveBefore keeps X's iframe loaded
// (Chrome); where there is none the iframe loads again in its new place.
function moveList(list, state, textEl) {
  const spot = listSpot(state, textEl);
  if (!spot) return;
  const { parent, before } = spot;
  if (before === list || (list.parentNode === parent && list.nextSibling === before)) return;
  if (typeof parent.moveBefore === 'function' && parent.isConnected && list.isConnected) {
    try {
      parent.moveBefore(list, before);
      return;
    } catch { /* not movable here: insert it */ }
  }
  parent.insertBefore(list, before);
}

function dropList(state) {
  if (!state.list) return;
  if (fitter) fitter.unobserve(state.list);
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
  const key = embedsOn ? state.posts.map((post) => post.id).join(' ') : '';
  if (state.list && key && state.key === key && state.list.isConnected === textEl.isConnected) {
    // The same posts: no second embed. Placeholders follow the settings,
    // and a list placed by a function `after` follows it.
    if (typeof state.after === 'function') moveList(state.list, state, textEl);
    for (const card of state.list.querySelectorAll('.x-embed.is-pending')) armCard(card);
    for (const card of state.list.querySelectorAll('.x-embed.is-ready')) armPopupLock(card);
    paintLinks(textEl, state);
    return;
  }
  dropList(state);
  if (key) {
    const list = document.createElement('div');
    list.className = 'x-embed-list';
    for (const post of state.posts) {
      const card = buildEmbed(post);
      card._xText = textEl;
      list.appendChild(card);
    }
    if (placeList(list, state, textEl)) {
      state.list = list;
      state.key = key;
    }
  }
  paintLinks(textEl, state);
  if (state.list) for (const card of [...state.list.children]) armCard(card);
}

// Call after the text is painted and placed (it needs a parent to put the
// embeds after). A repaint calls it again: the same posts keep their
// embeds, others replace them, none removes them.
// opts.after: the node the embeds follow (a Show more button under the
//   text); default the text itself. Or a function returning that node,
//   asked at each placement (placeXEmbeds places the shown ones again).
// opts.host: the box around the text (a map popup's message box, whose
//   Show more is added by popuptext.js). It gets .has-x-only when the link
//   is all the text, and the embeds go last in it when there is no
//   `after` node.
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

// A map popup, a chat, or a swap sheet keeps its post. Only the feed's cards sleep.
const EMBED_ELSEWHERE = '.maplibregl-popup, #swap-sheet, #feed-chat, #messages-from-topic-chat, #messages-from-encrypted-chat, #mb-chat-preview-outer';

function embedsIn(scope) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return [];
  const cards = [];
  for (const card of scope.querySelectorAll('.x-embed')) {
    if (card.closest && card.closest(EMBED_ELSEWHERE)) continue;
    cards.push(card);
  }
  return cards;
}

// The feed left the map. Drop X's iframe and put the placeholder back.
// The list and the card stay. The card keeps the height it had, the way a
// feed spacer keeps a card's measured height, so the column does not jump.
// Calling it again changes nothing.
export function sleepXEmbeds(scope) {
  for (const card of embedsIn(scope)) {
    if (!card.classList.contains('is-ready') && !card.classList.contains('is-loading')) continue;
    card._xEpoch = (card._xEpoch || 0) + 1;
    unwatchCard(card);
    const held = heldHeight(card);
    unsize(card);
    const frame = card.querySelector('.x-embed-frame');
    if (frame) frame.replaceChildren();
    restoreWait(card);
    card.classList.remove('is-ready', 'is-loading', 'is-locked');
    card.classList.add('is-pending');
    if (held > 0) card.style.minHeight = `${held}px`;
  }
}

// The feed covers the map again. Pending cards load when they come near
// the screen, through the same observer as the first time.
export function wakeXEmbeds(scope) {
  for (const card of embedsIn(scope)) armCard(card);
}

// Take a text's embeds away (its row closed, its text emptied).
export function clearXEmbeds(textEl) {
  const state = textEl && hosts.get(textEl);
  if (!state) return;
  dropList(state);
  state.posts = [];
  delete textEl.dataset.xEmbeds;
  paintLinks(textEl, state);
}

// A switch changed: placeholders on the page load near the screen again,
// or wait for their button. Posts already shown stay; nothing else in the
// feed is rebuilt.
export function refreshXEmbeds() {
  if (typeof document === 'undefined') return;
  for (const textEl of document.querySelectorAll('[data-x-embeds="1"]')) mountList(textEl);
}

// The layout changed (a map popup turned portrait or landscape): each shown
// list placed by a function `after` moves to where it answers now. Nothing
// is built again.
export function placeXEmbeds() {
  if (typeof document === 'undefined') return;
  for (const textEl of document.querySelectorAll('[data-x-embeds="1"]')) {
    const state = hosts.get(textEl);
    if (state && state.list && typeof state.after === 'function') moveList(state.list, state, textEl);
  }
}
