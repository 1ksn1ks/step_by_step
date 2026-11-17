// New posts at the top of the feed (feedlayout.js). The queue behind the
// "N new posts" pill is the front of a tab's list, not drawn yet. Posts
// arrive in batches from several topics, so a later batch can be older,
// and a pending send has no consensus time yet.
import { cmpTs } from './feedmerge.js';

// A post's place in time. A pending send's created time stands in until
// its consensus time is known, so it counts as the newest.
export function freshTs(post) {
  if (post && post.ts) return String(post.ts);
  const ms = Number(post && post.time);
  return Number.isFinite(ms) && ms > 0 ? (ms / 1000).toFixed(9) : '';
}

// Newest first.
export function cmpFresh(a, b) {
  const ts = cmpTs(freshTs(b), freshTs(a));
  if (ts) return ts;
  return (Number(b && b.seq) || 0) - (Number(a && a.seq) || 0);
}

function sortFront(list, count) {
  const head = list.slice(0, count).sort(cmpFresh);
  for (let i = 0; i < count; i++) list[i] = head[i];
}

// The queue (the first n posts) in time order, in place. Nothing in it is
// drawn, so this never moves a card on screen.
export function sortQueue(list, n) {
  const count = Math.min(n, list.length);
  if (count > 1) sortFront(list, count);
}

// Merging the queue: the first n posts and every post under them that is
// newer than the oldest queued one, sorted together, in place. Returns
// how far the sort reached. Past n, posts that can be on screen changed
// place (your own post under the queue, or a topic that ran late).
export function orderFresh(list, n) {
  const count = Math.min(n, list.length);
  if (!count) return 0;
  let oldest = list[0];
  for (let i = 1; i < count; i++) {
    if (cmpFresh(list[i], oldest) > 0) oldest = list[i];
  }
  let reach = count;
  while (reach < list.length && cmpFresh(list[reach], oldest) < 0) reach += 1;
  if (reach > 1) sortFront(list, reach);
  return reach;
}
