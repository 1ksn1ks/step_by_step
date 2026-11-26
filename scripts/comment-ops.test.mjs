// Author edit/delete, the 1000-character cap, newest/top order, and a
// reply tree deeper than one level. Pure helpers plus a source check that
// the server cache and both clients use them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMMENT_TEXT_MAX,
  applyCommentMutation,
  clipCommentText,
  commentImageUrl,
  commentImageValue,
  commentMediaShownUrl,
  createCommentState,
  filterCommentTree,
  insertComment,
  nestComments,
  reconcileCommentTree,
  sortCommentTree,
  visibleComments,
} from '../commentops.js';
import { isOwnR2Image } from '../r2public.js';

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

const payer = '0.0.10';
const other = '0.0.11';
const t0 = '2026-11-24T00:00:00.000Z';
const t1 = '2026-11-24T00:00:01.000Z';
const t2 = '2026-11-24T00:00:02.000Z';
const t3 = '2026-11-24T00:00:03.000Z';
const t4 = '2026-11-24T00:00:04.000Z';
const t5 = '2026-11-24T00:00:05.000Z';

function stateWith(text = 'hello') {
  const state = createCommentState();
  insertComment(state, { created: t0, payer, text, likeCount: 0 });
  return state;
}

test('clipCommentText keeps 1000, clips 1001, and counts a newline as two', () => {
  assert.equal(COMMENT_TEXT_MAX, 1000);
  assert.equal(clipCommentText('a'.repeat(1000)), 'a'.repeat(1000));
  assert.equal(clipCommentText('a'.repeat(1001)), 'a'.repeat(1000));
  assert.equal(clipCommentText('a'.repeat(301)).length, 301);
  assert.equal(clipCommentText(`${'a'.repeat(999)}\n`), 'a'.repeat(999));
  assert.equal(clipCommentText('\n\nhello\n\n'), 'hello');
  assert.equal(clipCommentText('  hello  '), 'hello');
  assert.equal(clipCommentText(''), '');
});

test('an empty edit is ignored and another payer cannot change the comment', () => {
  const state = stateWith();
  assert.equal(applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t1, text: '  \n' }), null);
  assert.equal(applyCommentMutation(state, { kind: 'edit', created: t0, payer: other, at: t1, text: 'nope' }), null);
  assert.equal(applyCommentMutation(state, { kind: 'delete', created: t0, payer: other, at: t1 }), null);
  const node = state.nodes[0];
  assert.equal(node.text, 'hello');
  assert.equal(node.edited, false);
  assert.equal(node.deleted, false);
  assert.equal(node.created, t0);
});

test('an edit that names a created in its own future is ignored', () => {
  const state = stateWith();
  assert.equal(applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t0, text: 'same instant' }), null);
  assert.equal(state.nodes[0].text, 'hello');
});

test('the latest edit wins even when the older one arrives later', () => {
  const state = stateWith();
  applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t3, text: 'newest' });
  applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t2, text: 'older' });
  assert.equal(state.nodes[0].text, 'newest');
  assert.equal(state.nodes[0].edited, true);
  assert.equal(state.nodes[0].created, t0);
});

test('a delete is terminal and a comment with no replies is omitted', () => {
  const state = stateWith();
  applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t1, text: 'edited once' });
  applyCommentMutation(state, { kind: 'delete', created: t0, payer, at: t2 });
  applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t4, text: 'later edit' });
  applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t1, text: 'earlier edit' });
  assert.equal(state.nodes[0].deleted, true);
  assert.equal(state.nodes[0].text, '');
  assert.equal(state.nodes[0].created, t0);
  assert.equal(state.nodes[0].edited, true);
  assert.deepEqual(visibleComments(state), []);
});

test('an older delete does not override a newer edit', () => {
  const state = stateWith();
  applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t3, text: 'kept' });
  applyCommentMutation(state, { kind: 'delete', created: t0, payer, at: t2 });
  assert.equal(state.nodes[0].deleted, false);
  assert.equal(state.nodes[0].text, 'kept');
});

test('a deleted comment with a visible reply stays as a placeholder', () => {
  const state = stateWith('parent');
  insertComment(state, { created: t1, payer: other, text: 'child' }, t0);
  applyCommentMutation(state, { kind: 'delete', created: t0, payer, at: t2 });
  const view = visibleComments(state);
  assert.equal(view.length, 1);
  assert.equal(view[0].deleted, true);
  assert.equal(view[0].text, '');
  assert.equal(view[0].created, t0);
  assert.equal(view[0].replies.length, 1);
  assert.equal(view[0].replies[0].text, 'child');
  assert.equal(view[0].replies[0].created, t1);
});

test('a late reply under a deleted parent brings the placeholder back', () => {
  const state = stateWith('parent');
  applyCommentMutation(state, { kind: 'delete', created: t0, payer, at: t1 });
  assert.deepEqual(visibleComments(state), []);
  insertComment(state, { created: t2, payer: other, text: 'late' }, t0);
  const view = visibleComments(state);
  assert.equal(view.length, 1);
  assert.equal(view[0].deleted, true);
  assert.equal(view[0].text, '');
  assert.equal(view[0].replies[0].text, 'late');
  assert.equal(view[0].created, t0);
});

test('a branch whose every node is deleted is omitted', () => {
  const state = stateWith('parent');
  insertComment(state, { created: t1, payer, text: 'child' }, t0);
  insertComment(state, { created: t2, payer: other, text: 'grand' }, t1);
  applyCommentMutation(state, { kind: 'delete', created: t2, payer: other, at: t3 });
  applyCommentMutation(state, { kind: 'delete', created: t1, payer, at: t4 });
  applyCommentMutation(state, { kind: 'delete', created: t0, payer, at: t5 });
  assert.deepEqual(visibleComments(state), []);
  assert.equal(state.nodes[0].created, t0);
});

test('sortCommentTree orders newest and top at every level without mutating the input', () => {
  const leafLow = { created: t0, payer, text: 'low', likeCount: 0, replies: [] };
  const leafHigh = { created: t1, payer, text: 'high', likeCount: 4, replies: [] };
  const input = [
    {
      created: t1,
      payer,
      text: 'few',
      likeCount: 1,
      replies: [leafLow],
    },
    {
      created: t0,
      payer,
      text: 'many',
      likeCount: 1,
      replies: [
        { created: t2, payer, text: 'mid', likeCount: 0, replies: [leafHigh, leafLow] },
        { created: t4, payer, text: 'plain', likeCount: 0, replies: [] },
      ],
    },
    { created: t2, payer, text: 'loved', likeCount: 5, replies: [] },
  ];
  const snapshot = JSON.stringify(input);
  const newest = sortCommentTree(input);
  assert.deepEqual(newest.map((node) => node.text), ['loved', 'few', 'many']);
  assert.deepEqual(newest[2].replies.map((node) => node.text), ['plain', 'mid']);
  assert.deepEqual(newest[2].replies[1].replies.map((node) => node.text), ['high', 'low']);
  const top = sortCommentTree(input, 'top');
  assert.deepEqual(top.map((node) => node.text), ['loved', 'many', 'few']);
  assert.deepEqual(top[1].replies.map((node) => node.text), ['mid', 'plain']);
  assert.deepEqual(top[1].replies[0].replies.map((node) => node.created), [t1, t0]);
  const oldest = sortCommentTree(input, 'oldest');
  assert.deepEqual(oldest.map((node) => node.text), ['many', 'few', 'loved']);
  assert.deepEqual(oldest[0].replies.map((node) => node.text), ['mid', 'plain']);
  assert.deepEqual(oldest[0].replies[0].replies.map((node) => node.text), ['low', 'high']);
  const tied = [
    { created: t0, text: 'a', likeCount: 1, replies: [] },
    { created: t0, text: 'b', likeCount: 9, replies: [] },
  ];
  assert.deepEqual(sortCommentTree(tied, 'oldest').map((node) => node.text), ['a', 'b']);
  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(newest, input);
  assert.equal(filterCommentTree(input)[0].replies.length, 1);
});

test('nestComments builds a reply under a reply', () => {
  const byParent = new Map([
    [t0, [{ created: t1, payer, text: 'child' }]],
    [t1, [{ created: t2, payer: other, text: 'grand' }]],
  ]);
  const tree = nestComments([{ created: t0, payer, text: 'root' }], (created) => byParent.get(created) || []);
  assert.equal(tree[0].replies[0].text, 'child');
  assert.equal(tree[0].replies[0].replies[0].text, 'grand');
  assert.equal(nestComments([{ created: t0, text: 'x' }], () => [], 51).length, 0);
});

test('a real comment replaces one optimistic row and leaves the next one up', () => {
  const previous = [];
  const pending = {
    parentId: null,
    node: { created: t1, payer, text: 'hi', pending: true, replies: [] },
  };
  const held = reconcileCommentTree(previous, previous, [pending]);
  assert.equal(held.tree.length, 1);
  assert.equal(held.tree[0].pending, true);
  const incoming = [{ created: t2, payer, text: 'hi', replies: [] }];
  const dropped = reconcileCommentTree(previous, incoming, held.pendings);
  assert.equal(dropped.pendings.length, 0);
  assert.equal(dropped.tree.length, 1);
  assert.equal(dropped.tree[0].created, t2);
});

test('the clients and the server use the 1000 cap and a nested feed tree', () => {
  const ops = read('../commentops.js');
  const client = read('../processallmessages.js');
  const feed = read('../feedlayout.js');
  const server = read('../server/index.js');
  assert.match(ops, /COMMENT_TEXT_MAX = 1000/);
  assert.doesNotMatch(ops, /slice\(0,\s*300\)/);
  for (const src of [client, feed, server]) {
    assert.doesNotMatch(src, /slice\(0,\s*300\)/);
    assert.doesNotMatch(src, /clipMessage\([^)]*300\)/);
  }
  assert.equal(client.split('ingestParsedComments(').length - 1, 4);
  assert.equal(client.split('assembledComments(').length - 1, 8);
  assert.match(client, /maxLength = COMMENT_TEXT_MAX/);
  for (const name of [
    'sendEditMarkerComment',
    'sendEditPolygonComment',
    'sendEditMarkerReply',
    'sendEditPolygonReply',
    'sendDeleteMarkerComment',
    'sendDeletePolygonComment',
    'sendDeleteMarkerReply',
    'sendDeletePolygonReply',
  ]) {
    assert.match(client, new RegExp(`window\\.${name}\\b`));
  }
  assert.match(feed, /function commentsFor\(topic, bucket, stamp\)/);
  assert.match(feed.slice(feed.indexOf('function commentsFor')), /nestComments\(/);
  assert.match(feed, /filterCommentTree\(/);
  assert.match(feed, /sortCommentTree\(/);
  assert.match(server, /edited INTEGER NOT NULL DEFAULT 0/);
  assert.match(server, /deleted INTEGER NOT NULL DEFAULT 0/);
  assert.match(server, /edited_at TEXT/);
  assert.match(server, /ALTER TABLE comments ADD COLUMN edited INTEGER NOT NULL DEFAULT 0/);
  assert.match(server, /ALTER TABLE comments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0/);
  assert.match(server, /ALTER TABLE comments ADD COLUMN edited_at TEXT/);
  assert.match(server, /clipCommentText/);
  assert.match(server, /filterCommentTree\(/);
  assert.match(server, /sortCommentTree\(/);
});

test('commentMediaShownUrl draws only our R2, ipfs and Hashinal media; another host is a link, javascript: is nothing', () => {
  const base = 'https://pub-test.r2.dev';
  // Our own uploads: a still, a video, a converted GIF clip, a GIF.
  for (const ours of [
    `${base}/markers/1700000000000-abc123.webp`,
    `${base}/markers/1700000000000-abc123.mp4`,
    `${base}/markers/1700000000000-abc123.mp4?gif=1`,
    `${base}/markers/1700000000000-abc123.gif`,
  ]) {
    assert.equal(commentMediaShownUrl(ours, base), ours, ours);
  }
  // IPFS and a Hashinal: as commentImageUrl paints them.
  assert.equal(commentMediaShownUrl('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', base),
    'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
  assert.equal(commentMediaShownUrl('hcs://1/0.0.123', base), commentImageUrl('hcs://1/0.0.123'));
  assert.match(commentMediaShownUrl('hcs://1/0.0.123', base), /\/api\/hcs1\/0\.0\.123$/);
  // Another host: not drawn, but still stored as it was, so old comments
  // load and the row can show it as a link.
  const elsewhere = 'https://images.example.com/cat.png';
  assert.equal(commentMediaShownUrl(elsewhere, base), '');
  assert.equal(commentImageValue(elsewhere), elsewhere);
  assert.equal(commentImageUrl(elsewhere), elsewhere);
  // Our host, but not a file the upload makes: a query, another kind of
  // file, no name, a look-alike host.
  for (const near of [
    `${base}/markers/a.png?track=1`,
    `${base}/markers/a.mp4?gif=1&x=2`,
    `${base}/markers/a.html`,
    `${base}/`,
    'https://pub-test.r2.dev.evil.example/markers/a.png',
  ]) {
    assert.equal(commentMediaShownUrl(near, base), '', near);
  }
  // A base with a path: an address that climbs out of it is not ours.
  assert.equal(commentMediaShownUrl(`${base}/pub/a.png`, `${base}/pub`), `${base}/pub/a.png`);
  assert.equal(commentMediaShownUrl(`${base}/pub/../a.png`, `${base}/pub`), '');
  // javascript: and the like are no media at all.
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '', null, 42]) {
    assert.equal(commentMediaShownUrl(bad, base), '', String(bad));
    assert.equal(commentImageValue(bad), '', String(bad));
  }
  // No R2 base (local dev): only ipfs and Hashinals are drawn.
  assert.equal(commentMediaShownUrl(`${base}/markers/a.png`, ''), '');
  assert.equal(commentMediaShownUrl('hcs://1/0.0.123', ''), commentImageUrl('hcs://1/0.0.123'));
  // The base comes from the page by default, as r2public.js reads it.
  globalThis.__R2_PUBLIC_BASE = `${base}/`;
  try {
    assert.equal(commentMediaShownUrl(`${base}/markers/a.jpg`), `${base}/markers/a.jpg`);
  } finally {
    delete globalThis.__R2_PUBLIC_BASE;
  }
  // The app icon check is as it was: still images only, no query.
  assert.equal(isOwnR2Image(`${base}/markers/a.png`, base), true);
  assert.equal(isOwnR2Image(`${base}/markers/a.mp4`, base), false);
  assert.equal(isOwnR2Image(`${base}/markers/a.png?gif=1`, base), false);
});
