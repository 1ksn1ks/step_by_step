// Comment text, order, and author edit/delete. No DOM.
//
// HCS messages are immutable, so an edit or a delete is a later message
// that names the original comment by its ISO created time. Only that
// comment's payer counts. The latest author mutation wins. A delete is
// terminal: a later or earlier edit does not bring the text back.
// created itself never changes, because likes are keyed on it.

import { clipMessage, normalizeMessageNewlines } from './hcschunks.js';
import { resolveHashinalSrc } from './hashinalurl.js';
import { isOwnR2Media, r2PublicBase } from './r2public.js';

export const COMMENT_TEXT_MAX = 1000;

// One optional media item per comment or reply: an image, a GIF clip or a
// short video, as one address beside the text (never inside it). Longer
// than this is not a link a browser keeps.
export const COMMENT_IMAGE_URL_MAX = 2048;

// Shown the way a post's pictures are (postimages.js galleryImages): an
// http(s) or ipfs address, or a Hashinal (hcs://1/<topic>) read from our
// route. Anything else (javascript:, data:, blank) is no media.
const SHOWN = /^(?:https?|ipfs):\/\/[^\s/]/i;
const HASHINAL_REF = /^hcs:\/\/1\/0\.0\.\d+$/;
const UNSAFE = /[\s"'<>\\\u0000-\u001f\u007f]/;

// The address to send and to store: the value as written when it can be
// shown, otherwise "". The server keeps only this (null when "").
export function commentImageValue(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > COMMENT_IMAGE_URL_MAX || UNSAFE.test(raw)) return '';
  if (HASHINAL_REF.test(raw)) return raw;
  if (!SHOWN.test(raw)) return '';
  if (/^https?:/i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    } catch {
      return '';
    }
  }
  return raw;
}

// The URL to paint: the stored address, with a Hashinal resolved to our
// route (hashinalurl.js). "" when there is no media to show.
export function commentImageUrl(value) {
  const stored = commentImageValue(value);
  if (!stored) return '';
  const url = resolveHashinalSrc(stored);
  return typeof url === 'string' ? url : '';
}

// The URL to draw as a picture or video: commentImageUrl, but only for
// media from our own R2 uploads (r2public.js isOwnR2Media), an ipfs://
// address, or a Hashinal (hcs://1/<topic>). Anything else is "", and the
// row shows its address as a plain link, so a comment never makes the page
// load another host's file. What is stored (commentImageValue) is the same.
export function commentMediaShownUrl(value, base = r2PublicBase()) {
  const stored = commentImageValue(value);
  if (!stored) return '';
  const ours = HASHINAL_REF.test(stored) || /^ipfs:\/\//i.test(stored) || isOwnR2Media(stored, base);
  return ours ? commentImageUrl(stored) : '';
}

function hasOwn(body, key) {
  return !!body && Object.prototype.hasOwnProperty.call(body, key);
}

export const COMMENT_EDIT_FIELDS = [
  'editCommentMarker',
  'editCommentPolygon',
  'editReplyMarker',
  'editReplyPolygon',
];

export const COMMENT_DELETE_FIELDS = [
  'deleteCommentMarker',
  'deleteCommentPolygon',
  'deleteReplyMarker',
  'deleteReplyPolygon',
];

export function clipCommentText(text) {
  return clipMessage(normalizeMessageNewlines(text).trim(), COMMENT_TEXT_MAX);
}

function bucketOf(field) {
  return String(field || '').includes('Polygon') ? 'polygon' : 'marker';
}

// One pass the server cache and both clients share. `at` is the envelope
// ISO time of this message. Comment and reply rows use it as created.
// A comment or reply carries its text and its media (image, "" for none);
// one with neither is not a comment. An edit carries image only when the
// message names one: "" (or null, or an address that cannot be shown)
// clears the media, no image keeps it.
export function readCommentEvents(message, payer, at) {
  const events = [];
  if (!message || typeof message !== 'object' || !payer) return events;
  for (const [field, bucket] of [['commentMarker', 'marker'], ['commentPolygon', 'polygon']]) {
    const body = message[field];
    if (!body || !body.timestamp) continue;
    const text = clipCommentText(body.text);
    const image = commentImageValue(body.image);
    if (!text && !image) continue;
    events.push({
      type: 'comment',
      field,
      bucket,
      stamp: String(body.timestamp),
      payer,
      text,
      image,
      created: at,
      at,
    });
  }
  for (const [field, bucket] of [['replyMarker', 'marker'], ['replyPolygon', 'polygon']]) {
    const body = message[field];
    if (!body || !body.parentId) continue;
    const text = clipCommentText(body.text);
    const image = commentImageValue(body.image);
    if (!text && !image) continue;
    events.push({
      type: 'reply',
      field,
      bucket,
      stamp: body.timestamp ? String(body.timestamp) : '',
      parentId: String(body.parentId),
      payer,
      text,
      image,
      created: at,
      at,
    });
  }
  for (const field of COMMENT_EDIT_FIELDS) {
    const body = message[field];
    if (!body || body.created == null || body.created === '') continue;
    const event = {
      type: 'edit',
      kind: 'edit',
      field,
      bucket: bucketOf(field),
      stamp: body.timestamp ? String(body.timestamp) : '',
      parentId: body.parentId ? String(body.parentId) : '',
      payer,
      created: String(body.created),
      at,
      text: body.text,
    };
    if (hasOwn(body, 'image')) event.image = commentImageValue(body.image);
    events.push(event);
  }
  for (const field of COMMENT_DELETE_FIELDS) {
    const body = message[field];
    if (!body || body.created == null || body.created === '') continue;
    events.push({
      type: 'delete',
      kind: 'delete',
      field,
      bucket: bucketOf(field),
      stamp: body.timestamp ? String(body.timestamp) : '',
      parentId: body.parentId ? String(body.parentId) : '',
      payer,
      created: String(body.created),
      at,
    });
  }
  return events;
}

// Null when the event must be ignored. Otherwise the fields to store.
// mutationAt is the winning envelope time, kept so a late older event loses.
export function mutationVerdict(node, event) {
  if (!node || !event) return null;
  if (!event.payer || event.payer !== node.payer) return null;
  const at = typeof event.at === 'string' ? event.at : '';
  if (!at || !node.created || at <= node.created) return null;
  const lastAt = node.mutationAt || '';
  if (event.kind === 'edit') {
    if (node.deleted) return null;
    const text = clipCommentText(event.text == null ? '' : event.text);
    // The edit's media when it names one ("" clears), else the comment's.
    const image = hasOwn(event, 'image') ? commentImageValue(event.image) : commentImageValue(node.image);
    if (!text && !image) return null;
    if (lastAt && at < lastAt) return null;
    return { kind: 'edit', text, image, edited: true, deleted: false, mutationAt: at };
  }
  if (event.kind === 'delete') {
    if (lastAt && at < lastAt) return null;
    return { kind: 'delete', text: '', image: '', edited: !!node.edited, deleted: true, mutationAt: at };
  }
  return null;
}

export function findComment(nodes, created) {
  for (const node of nodes || []) {
    if (!node) continue;
    if (node.created === created) return node;
    const hit = findComment(node.replies, created);
    if (hit) return hit;
  }
  return null;
}

export function createCommentState() {
  return { nodes: [], index: new Map(), pending: new Map() };
}

function assignVerdict(node, verdict) {
  const created = node.created;
  node.text = verdict.text;
  node.image = verdict.image || '';
  node.edited = verdict.edited;
  node.deleted = verdict.deleted;
  node.mutationAt = verdict.mutationAt;
  node.created = created;
}

export function insertComment(state, comment, parentId) {
  const created = comment && comment.created;
  const payer = comment && comment.payer;
  if (!state || !created || !payer) return null;
  const existing = state.index.get(created);
  if (existing) return existing;
  const node = {
    created,
    payer,
    text: clipCommentText(comment.text),
    image: commentImageValue(comment.image),
    likeCount: Number(comment.likeCount) || 0,
    edited: false,
    deleted: false,
    mutationAt: '',
    replies: [],
  };
  let list = state.nodes;
  if (parentId) {
    const parent = findComment(state.nodes, parentId);
    if (!parent) return null;
    if (!parent.replies) parent.replies = [];
    list = parent.replies;
  }
  list.push(node);
  state.index.set(created, node);
  const waiting = state.pending.get(created);
  if (waiting) {
    state.pending.delete(created);
    for (const event of waiting) applyCommentMutation(state, event);
  }
  return node;
}

// Latest author mutation. A missing comment keeps the event until insert.
export function applyCommentMutation(state, event) {
  if (!state || !event || !event.created) return null;
  const node = state.index.get(event.created) || findComment(state.nodes, event.created);
  if (!node) {
    const list = state.pending.get(event.created) || [];
    list.push(event);
    state.pending.set(event.created, list);
    return null;
  }
  if (!state.index.has(node.created)) state.index.set(node.created, node);
  const verdict = mutationVerdict(node, event);
  if (!verdict) return null;
  assignVerdict(node, verdict);
  return verdict;
}

// A deleted comment with nothing left to show is omitted. One with a
// visible reply stays as a placeholder (text "", no media). An all-deleted
// branch drops out from the leaves up. The input tree is not mutated.
export function filterCommentTree(nodes) {
  const out = [];
  for (const node of nodes || []) {
    if (!node) continue;
    const replies = filterCommentTree(node.replies);
    if (node.deleted && replies.length === 0) continue;
    out.push({
      ...node,
      text: node.deleted ? '' : node.text,
      image: node.deleted ? '' : commentImageValue(node.image),
      deleted: !!node.deleted,
      edited: !!node.edited,
      replies,
    });
  }
  return out;
}

function descendantCount(node) {
  const replies = (node && node.replies) || [];
  let total = 0;
  for (const child of replies) total += 1 + descendantCount(child);
  return total;
}

// New array, each level sorted. "newest" (the default) is created descending,
// so a just-sent comment is at the top. "top" is likes, then every nested
// reply, then created descending.
export function sortCommentTree(nodes, mode) {
  const top = mode === 'top';
  const copy = (nodes || []).map((node) => ({
    ...node,
    replies: sortCommentTree(node && node.replies, mode),
  }));
  copy.sort((a, b) => {
    if (top) {
      const likes = (Number(b.likeCount) || 0) - (Number(a.likeCount) || 0);
      if (likes) return likes;
      const replies = descendantCount(b) - descendantCount(a);
      if (replies) return replies;
    }
    if (a.created === b.created) return 0;
    return a.created < b.created ? 1 : -1;
  });
  return copy;
}

export function visibleComments(state, mode) {
  return sortCommentTree(filterCommentTree(state && state.nodes), mode);
}

// Full reply tree. repliesOf(created) returns the direct replies.
// Depth 50 matches the server and the popup builder.
export function nestComments(roots, repliesOf, depth = 0) {
  if (depth > 50 || !roots) return [];
  return roots.map((node) => ({
    ...node,
    replies: nestComments(
      typeof repliesOf === 'function' ? (repliesOf(node.created) || []) : [],
      repliesOf,
      depth + 1,
    ),
  }));
}

function cloneNodes(nodes) {
  return (nodes || []).map((node) => ({
    ...node,
    replies: cloneNodes(node && node.replies),
  }));
}

function countReal(nodes, parentId, into = new Map()) {
  for (const node of nodes || []) {
    if (!node) continue;
    if (!node.pending) {
      const key = `${parentId || ''}|${node.payer || ''}|${node.text || ''}|${node.image || ''}`;
      into.set(key, (into.get(key) || 0) + 1);
    }
    if (node.replies) countReal(node.replies, node.created, into);
  }
  return into;
}

function placePending(nodes, pending) {
  const node = pending && pending.node;
  if (!node) return;
  if (!pending.parentId) {
    nodes.push(node);
    return;
  }
  const parent = findComment(nodes, pending.parentId);
  if (!parent) {
    nodes.push(node);
    return;
  }
  if (!parent.replies) parent.replies = [];
  parent.replies.push(node);
}

// Authoritative incoming tree, plus optimistic rows whose real message
// is not in it yet. `previous` is the last authoritative tree (no pendings).
export function reconcileCommentTree(previous, incoming, pendings) {
  const prevCounts = countReal(previous);
  const nextCounts = countReal(incoming);
  const still = [];
  const used = new Map();
  for (const pending of pendings || []) {
    const node = pending && pending.node;
    const key = `${(pending && pending.parentId) || ''}|${(node && node.payer) || ''}|${(node && node.text) || ''}|${(node && node.image) || ''}`;
    const seen = used.get(key) || 0;
    const extra = (nextCounts.get(key) || 0) - (prevCounts.get(key) || 0) - seen;
    if (extra > 0) {
      used.set(key, seen + 1);
      continue;
    }
    still.push(pending);
  }
  const tree = cloneNodes(incoming);
  for (const pending of still) placePending(tree, pending);
  return { tree, pendings: still };
}
