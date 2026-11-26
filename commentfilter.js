// Reader filters for one comments view. A fresh object each time the view
// opens; the feed's own search state is not used. No DOM.

import { commentImageValue } from './commentops.js';

export function freshCommentFilters() {
  return {
    hasImage: false,
    textOnly: false,
    mine: false,
    following: false,
    earlyHashinal: false,
    dateFrom: '',
    dateTo: '',
    sort: 'newest',
  };
}

export function commentFiltersActive(filters) {
  if (!filters) return false;
  return !!(filters.hasImage || filters.textOnly || filters.mine || filters.following
    || filters.earlyHashinal || filters.dateFrom || filters.dateTo);
}

function localDayMs(iso, end) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return null;
  const date = end
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999)
    : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function commentMs(node) {
  const ms = new Date(node && node.created).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function imageOf(node) {
  return commentImageValue(node && node.image) !== '';
}

function nodeMatches(node, filters, ctx) {
  const rules = filters || {};
  if (rules.hasImage && !imageOf(node)) return false;
  if (rules.textOnly) {
    if (imageOf(node)) return false;
    if (String((node && node.text) || '').trim() === '') return false;
  }
  if (rules.mine) {
    const me = ctx && ctx.me;
    if (!me || !node || node.payer !== me) return false;
  }
  if (rules.following) {
    const set = ctx && ctx.followSet;
    if (!set || typeof set.has !== 'function' || !node || !set.has(node.payer)) return false;
  }
  if (rules.earlyHashinal) {
    const ask = ctx && ctx.isEarly;
    if (typeof ask !== 'function' || !ask(node && node.payer)) return false;
  }
  if (rules.dateFrom) {
    const start = localDayMs(rules.dateFrom, false);
    const ms = commentMs(node);
    if (start == null || ms == null || ms < start) return false;
  }
  if (rules.dateTo) {
    const end = localDayMs(rules.dateTo, true);
    const ms = commentMs(node);
    if (end == null || ms == null || ms > end) return false;
  }
  return true;
}

// A node stays when it matches, or a reply under it does. A match keeps
// the parent chain. A reply that does not match, and leads to none, drops.
function keepBranch(node, filters, ctx) {
  if (!node) return null;
  const replies = [];
  for (const child of node.replies || []) {
    const kept = keepBranch(child, filters, ctx);
    if (kept) replies.push(kept);
  }
  if (!nodeMatches(node, filters, ctx) && replies.length === 0) return null;
  return { ...node, replies };
}

export function filterCommentsForReader(tree, filters, ctx) {
  const out = [];
  for (const node of tree || []) {
    const kept = keepBranch(node, filters, ctx);
    if (kept) out.push(kept);
  }
  return out;
}
