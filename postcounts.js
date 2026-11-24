// Likes and views on the map's hold / right-click info card (maptip.js)
// and on each row of a cluster's post list (markerstack.js). A snapshot of
// what is known when the card or the row is painted: nothing is fetched,
// no heart can be tapped, and no view is counted (only the full popup
// counts one, processallmessages.js paintPopupView). Its own module, so
// neither of those imports processallmessages.js (they would loop).
import { knownPopupViews } from './msgbackend.js';
import { formatCount } from './countformat.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// The popup's views chip (processallmessages.js VIEWS_BARS).
export const VIEWS_BARS = [
  ['line', { x1: '18', x2: '18', y1: '20', y2: '10' }],
  ['line', { x1: '12', x2: '12', y1: '20', y2: '4' }],
  ['line', { x1: '6', x2: '6', y1: '20', y2: '14' }],
];

// A plain heart outline: a count, not a button.
export const HEART = [
  ['path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' }],
];

// A count from a record: a number, or a numeric string. Anything else
// (missing, empty, negative, not a number) is null.
function countOf(value) {
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value)
      : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

// The ISO time the server keys a post's views by, or ''.
function isoOf(value) {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

// record: a post's popup record (popupData). { likes, views }.
// likes: the marker or polygon count; a share or live pin may set both,
// so the larger one, and 0 when neither is known.
// views: the popup's own counter for the post (topic|created), as the
// popup reads it while it is built, or the pin's viewCount when that is
// all there is (the larger of the two when both are). null when neither
// is known: that topic's counts have not arrived.
export function countsFor(record) {
  const r = record && typeof record === 'object' ? record : {};
  const likes = Math.max(0, countOf(r.likeCountMarker) ?? 0, countOf(r.likeCountPolygon) ?? 0);
  const topic = String(r.topicId || '').trim();
  const iso = isoOf(r.created);
  let views = /^\d+\.\d+\.\d+$/.test(topic) && iso ? knownPopupViews(topic, iso) : null;
  views = countOf(views);
  const fallback = countOf(r.viewCount);
  if (fallback != null) views = views == null ? fallback : Math.max(views, fallback);
  return { likes, views };
}

function icon(parts) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [name, attrs] of parts) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

// One count: its icon and the short number. The exact one is its label.
function stat(kind, parts, n, word) {
  const el = document.createElement('span');
  el.className = `post-count post-count-${kind}`;
  const label = n === 1 ? `1 ${word}` : `${n} ${word}s`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.title = label;
  const num = document.createElement('span');
  num.className = 'post-count-n';
  num.textContent = formatCount(n);
  el.append(icon(parts), num);
  return el;
}

// A span of className holding the heart and the likes, then the bars and
// the views (left out while views is null). null with no record.
export function countsNode(record, className) {
  if (!record || typeof record !== 'object') return null;
  const { likes, views } = countsFor(record);
  const wrap = document.createElement('span');
  wrap.className = className;
  wrap.appendChild(stat('likes', HEART, likes, 'like'));
  if (views != null) wrap.appendChild(stat('views', VIEWS_BARS, views, 'view'));
  return wrap;
}
