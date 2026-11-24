// Comment text, order, and author edit/delete. No DOM.
//
// HCS messages are immutable, so an edit or a delete is a later message
// that names the original comment by its ISO created time. Only that
// comment's payer counts. The latest author mutation wins. A delete is
// terminal: a later or earlier edit does not bring the text back.
// created itself never changes, because likes are keyed on it.

import { clipMessage, normalizeMessageNewlines } from './hcschunks.js';

export const COMMENT_TEXT_MAX = 1000;

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
export function readCommentEvents(message, payer, at) {
  const events = [];
  if (!message || typeof message !== 'object' || !payer) return events;
  for (const [field, bucket] of [['commentMarker', 'marker'], ['commentPolygon', 'polygon']]) {
    const body = message[field];
    if (!body || !body.timestamp) continue;
    events.push({
      type: 'comment',
      field,
      bucket,
      stamp: String(body.timestamp),
      payer,
      text: clipCommentText(body.text),
      created: at,
      at,
    });
  }
  for (const [field, bucket] of [['replyMarker', 'marker'], ['replyPolygon', 'polygon']]) {
    const body = message[field];
    if (!body || !body.parentId) continue;
    events.push({
      type: 'reply',
      field,
      bucket,
      stamp: body.timestamp ? String(body.timestamp) : '',
      parentId: String(body.parentId),
      payer,
      text: clipCommentText(body.text),
      created: at,
      at,
    });
  }
  for (const field of COMMENT_EDIT_FIELDS) {
    const body = message[field];
    if (!body || body.created == null || body.created === '') continue;
    events.push({
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
    });
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
    if (!text) return null;
    if (lastAt && at < lastAt) return null;
    return { kind: 'edit', text, edited: true, deleted: false, mutationAt: at };
  }
  if (event.kind === 'delete') {
    if (lastAt && at < lastAt) return null;
    return { kind: 'delete', text: '', edited: !!node.edited, deleted: true, mutationAt: at };
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
// visible reply stays as a placeholder (text ""). An all-deleted branch
// drops out from the leaves up. The input tree is not mutated.
export function filterCommentTree(nodes) {
  const out = [];
  for (const node of nodes || []) {
    if (!node) continue;
    const replies = filterCommentTree(node.replies);
    if (node.deleted && replies.length === 0) continue;
    out.push({
      ...node,
      text: node.deleted ? '' : node.text,
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
      const key = `${parentId || ''}|${node.payer || ''}|${node.text || ''}`;
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
    const key = `${(pending && pending.parentId) || ''}|${(node && node.payer) || ''}|${(node && node.text) || ''}`;
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
