// Hashinal (HCS-1) files from our own server: /api/hcs1/<topicId>
// (server/hcs1.js rebuilds the file from its topic on the mirror node).
// Kiloscribe's inscription CDN is only the fallback.
//
// An <img> pointing at our route that fails to load tries Kiloscribe, and
// if that fails too, a local copy of the default avatar in /public. Each
// step is marked on the image, so it never loops. Images on the page are
// covered by one capture listener on the document (installed when this file
// loads); an image that loads while detached (a canvas source) gets the
// same steps with attachHashinalFallback. Model loaders retry once on
// hashinalFallbackUrl.

const TOPIC_ID = /^0\.0\.\d+$/;
const ROUTE = /^(?:https?:\/\/[^/?#]+)?\/api\/hcs1\/(0\.0\.\d+)(?:[?#]|$)/;
const KILOSCRIBE = 'https://kiloscribe.com/api/inscription-cdn/';
const KILOSCRIBE_ID = /^https:\/\/kiloscribe\.com\/api\/inscription-cdn\/(0\.0\.\d+)(?:[?#]|$)/;
const HCS1_REF = /^hcs:\/\/1\/(0\.0\.\d+)$/;

function origin() {
  return typeof location !== 'undefined' && location && location.origin && location.origin !== 'null'
    ? location.origin
    : '';
}

// The local last resort: a copy of the default avatar (0.0.4819119) served
// with the app, so no network outside our own is needed.
export const HASHINAL_PLACEHOLDER = `${origin()}/hashinal-placeholder.png`;

export function isHashinalTopicId(topicId) {
  return typeof topicId === 'string' && topicId.length <= 32 && TOPIC_ID.test(topicId);
}

// Our server's copy of an HCS-1 file.
export function hashinalUrl(topicId) {
  if (!isHashinalTopicId(topicId)) return HASHINAL_PLACEHOLDER;
  return `${origin()}/api/hcs1/${topicId}`;
}

// Kiloscribe's copy, for the fallback only.
export function kiloscribeUrl(topicId) {
  if (!isHashinalTopicId(topicId)) return HASHINAL_PLACEHOLDER;
  return KILOSCRIBE + topicId;
}

export const DEFAULT_AVATAR = hashinalUrl('0.0.4819119');
export const DEFAULT_MODEL = hashinalUrl('0.0.9742046');

// The topic id in one of our route's URLs, or "".
export function hashinalTopicOf(url) {
  const match = ROUTE.exec(String(url || '').trim());
  return match ? match[1] : '';
}

// Where a model loader tries next when our route fails: Kiloscribe's copy
// of the same topic, or "" for any other URL.
export function hashinalFallbackUrl(url) {
  const topicId = hashinalTopicOf(url);
  return topicId ? kiloscribeUrl(topicId) : '';
}

// A stored picture link: hcs://1/<topicId>, and a Kiloscribe inscription
// link, read from our route (Kiloscribe stays the fallback). Anything
// else is returned as it is.
export function resolveHashinalSrc(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  const ref = HCS1_REF.exec(text) || KILOSCRIBE_ID.exec(text);
  return ref ? hashinalUrl(ref[1]) : value;
}

// Swaps per image and topic. A page that puts our failing route back
// (a repaint) gets new rounds up to this, then is left alone: no loop.
const MAX_SWAPS = 6;

function swapTo(img, step, src) {
  const data = img.dataset;
  const swaps = Number(data.hcs1Swaps || 0);
  if (swaps >= MAX_SWAPS) return false;
  data.hcs1Swaps = String(swaps + 1);
  data.hcs1Step = step;
  img.src = src;
  return true;
}

// One failed load of img: the next step, or false when this file has
// nothing more to try (the page's own error handling takes over).
// Our route -> Kiloscribe -> the local copy.
function nextStep(img) {
  if (!img || img.tagName !== 'IMG') return false;
  const src = img.getAttribute('src') || '';
  const data = img.dataset;
  const fromRoute = hashinalTopicOf(src);
  if (fromRoute) {
    if (data.hcs1Topic !== fromRoute) {
      data.hcs1Topic = fromRoute;
      delete data.hcs1Step;
      delete data.hcs1Swaps;
    }
    return swapTo(img, 'kiloscribe', kiloscribeUrl(fromRoute));
  }
  const fromKiloscribe = KILOSCRIBE_ID.exec(src);
  if (fromKiloscribe && data.hcs1Topic === fromKiloscribe[1] && data.hcs1Step === 'kiloscribe') {
    return swapTo(img, 'local', HASHINAL_PLACEHOLDER);
  }
  return false;
}

function onImageError(event) {
  // This file swapped the source: the page's own handlers wait for the
  // outcome instead of reacting to a load that is being retried.
  if (nextStep(event.target)) event.stopImmediatePropagation();
}

const attached = typeof WeakSet === 'function' ? new WeakSet() : null;

// For an image that may fail while it is not on the page (a canvas
// source): the same steps, on the image itself. A capture listener on the
// target runs before its onerror. topicId is optional; the steps read the
// topic from the source that failed.
export function attachHashinalFallback(img, topicId) {
  if (!img || img.tagName !== 'IMG') return img;
  if (isHashinalTopicId(topicId) && !img.dataset.hcs1Topic) img.dataset.hcs1Topic = topicId;
  if (attached && attached.has(img)) return img;
  if (attached) attached.add(img);
  img.addEventListener('error', onImageError, true);
  return img;
}

// An image that failed before this file was listening (index.html's own
// <img> tags, a card built and placed later).
function catchUp(img) {
  if (!img || img.tagName !== 'IMG' || !img.complete || img.naturalWidth > 0) return;
  if (!hashinalTopicOf(img.getAttribute('src'))) return;
  nextStep(img);
}

function install() {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  document.addEventListener('error', onImageError, true);
  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'IMG') catchUp(node);
    else if (node.querySelectorAll) node.querySelectorAll('img').forEach(catchUp);
  };
  if (typeof MutationObserver === 'function' && document.documentElement) {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) scan(node);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scan(document.documentElement);
  }
}

install();
