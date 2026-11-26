// Reader filters for one comments view: each flag, a reply that keeps its
// parents, oldest order, and a fresh filter object every time a view opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sortCommentTree } from '../commentops.js';
import {
  commentFiltersActive,
  filterCommentsForReader,
  freshCommentFilters,
} from '../commentfilter.js';

const ME = '0.0.10';
const FRIEND = '0.0.11';
const OTHER = '0.0.12';
const EARLY = '0.0.13';
const PIC = 'https://example.com/a.png';

function node(fields) {
  return {
    text: '',
    image: '',
    payer: OTHER,
    likeCount: 0,
    replies: [],
    ...fields,
  };
}

function localIso(year, month, day, hour) {
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

const day = localIso(2026, 6, 15, 15);
const before = localIso(2026, 6, 14, 15);
const after = localIso(2026, 6, 16, 15);

function tree() {
  return [
    node({
      created: before,
      payer: ME,
      text: 'mine text',
      replies: [
        node({ created: day, payer: FRIEND, text: 'friend pic', image: PIC }),
        node({ created: day, payer: OTHER, text: 'other text' }),
      ],
    }),
    node({
      created: day,
      payer: OTHER,
      text: 'plain',
      replies: [
        node({
          created: after,
          payer: EARLY,
          text: 'early',
          replies: [
            node({ created: after, payer: FRIEND, text: 'deep pic', image: PIC }),
            node({ created: after, payer: OTHER, text: 'deep text' }),
          ],
        }),
        node({ created: before, payer: OTHER, text: 'side' }),
      ],
    }),
    node({ created: after, payer: FRIEND, text: 'top pic', image: PIC }),
  ];
}

const follow = new Set([FRIEND]);
const ctx = {
  me: ME,
  followSet: follow,
  isEarly: (payer) => payer === EARLY,
};

function texts(list) {
  return (list || []).map((item) => item.text);
}

test('a fresh filter object starts at Newest with every filter off', () => {
  const first = freshCommentFilters();
  const second = freshCommentFilters();
  assert.notEqual(first, second);
  assert.equal(commentFiltersActive(first), false);
  first.hasImage = true;
  first.mine = true;
  first.dateFrom = '2026-06-15';
  first.sort = 'oldest';
  assert.deepEqual(second, {
    hasImage: false,
    textOnly: false,
    mine: false,
    following: false,
    earlyHashinal: false,
    dateFrom: '',
    dateTo: '',
    sort: 'newest',
  });
  assert.equal(commentFiltersActive(second), false);
  assert.equal(commentFiltersActive(first), true);
});

test('with no filters on, every comment stays and the input is not mutated', () => {
  const input = tree();
  const snapshot = JSON.stringify(input);
  const out = filterCommentsForReader(input, freshCommentFilters(), ctx);
  assert.equal(out.length, 3);
  assert.equal(out[0].replies.length, 2);
  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(out, input);
  assert.notEqual(out[0], input[0]);
});

test('has image keeps a picture and the parents of a picture, and drops the rest', () => {
  const out = filterCommentsForReader(tree(), { ...freshCommentFilters(), hasImage: true }, ctx);
  assert.deepEqual(texts(out), ['mine text', 'plain', 'top pic']);
  assert.deepEqual(texts(out[0].replies), ['friend pic']);
  assert.deepEqual(texts(out[1].replies), ['early']);
  assert.deepEqual(texts(out[1].replies[0].replies), ['deep pic']);
  assert.equal(out[2].replies.length, 0);
});

test('text only keeps writing without a picture', () => {
  const out = filterCommentsForReader(tree(), { ...freshCommentFilters(), textOnly: true }, ctx);
  assert.deepEqual(texts(out), ['mine text', 'plain']);
  assert.deepEqual(texts(out[0].replies), ['other text']);
  assert.deepEqual(texts(out[1].replies), ['early', 'side']);
  assert.deepEqual(texts(out[1].replies[0].replies), ['deep text']);
});

test('mine matches the connected payer, including a reply under someone else', () => {
  const out = filterCommentsForReader(tree(), { ...freshCommentFilters(), mine: true }, ctx);
  assert.deepEqual(texts(out), ['mine text']);
  assert.deepEqual(out[0].replies, []);
  const nobody = filterCommentsForReader(tree(), { ...freshCommentFilters(), mine: true }, { ...ctx, me: '' });
  assert.deepEqual(nobody, []);
});

test('following matches the feed follow set and matches nothing without one', () => {
  const out = filterCommentsForReader(tree(), { ...freshCommentFilters(), following: true }, ctx);
  assert.deepEqual(texts(out), ['mine text', 'plain', 'top pic']);
  assert.deepEqual(texts(out[0].replies), ['friend pic']);
  assert.deepEqual(texts(out[1].replies), ['early']);
  assert.deepEqual(texts(out[1].replies[0].replies), ['deep pic']);
  const empty = filterCommentsForReader(tree(), { ...freshCommentFilters(), following: true }, { ...ctx, followSet: null });
  assert.deepEqual(empty, []);
});

test('early Hashinal matches the payer the context marks', () => {
  const out = filterCommentsForReader(tree(), { ...freshCommentFilters(), earlyHashinal: true }, ctx);
  assert.deepEqual(texts(out), ['plain']);
  assert.deepEqual(texts(out[0].replies), ['early']);
  assert.deepEqual(out[0].replies[0].replies, []);
});

test('dates use the comment timestamp, from the start of the day through the end', () => {
  const from = filterCommentsForReader(tree(), { ...freshCommentFilters(), dateFrom: '2026-06-15' }, ctx);
  assert.deepEqual(texts(from), ['mine text', 'plain', 'top pic']);
  assert.deepEqual(texts(from[0].replies), ['friend pic', 'other text']);
  assert.deepEqual(texts(from[1].replies), ['early']);
  const to = filterCommentsForReader(tree(), { ...freshCommentFilters(), dateTo: '2026-06-15' }, ctx);
  assert.deepEqual(texts(to), ['mine text', 'plain']);
  assert.deepEqual(texts(to[0].replies), ['friend pic', 'other text']);
  assert.deepEqual(texts(to[1].replies), ['side']);
  const both = filterCommentsForReader(tree(), {
    ...freshCommentFilters(),
    dateFrom: '2026-06-15',
    dateTo: '2026-06-15',
  }, ctx);
  assert.deepEqual(texts(both), ['mine text', 'plain']);
  assert.deepEqual(texts(both[0].replies), ['friend pic', 'other text']);
  const bad = filterCommentsForReader(
    [node({ created: 'not-a-time', payer: ME, text: 'bad' })],
    { ...freshCommentFilters(), dateFrom: '2026-06-15' },
    ctx,
  );
  assert.deepEqual(bad, []);
});

test('combined filters all have to match the same comment', () => {
  const filters = { ...freshCommentFilters(), following: true, hasImage: true, dateFrom: '2026-06-15' };
  const out = filterCommentsForReader(tree(), filters, ctx);
  assert.deepEqual(texts(out), ['mine text', 'plain', 'top pic']);
  assert.deepEqual(texts(out[0].replies), ['friend pic']);
  assert.deepEqual(texts(out[1].replies), ['early']);
  assert.deepEqual(texts(out[1].replies[0].replies), ['deep pic']);
});

test('a matching reply keeps its parent chain and drops sibling replies', () => {
  const input = [
    node({
      created: day,
      text: 'parent',
      replies: [
        node({ created: day, text: 'nope' }),
        node({
          created: day,
          text: 'child',
          replies: [
            node({ created: day, text: 'nope child' }),
            node({ created: day, payer: ME, text: 'hit' }),
          ],
        }),
      ],
    }),
    node({ created: day, text: 'gone' }),
  ];
  const out = filterCommentsForReader(input, { ...freshCommentFilters(), mine: true }, ctx);
  assert.deepEqual(texts(out), ['parent']);
  assert.deepEqual(texts(out[0].replies), ['child']);
  assert.deepEqual(texts(out[0].replies[0].replies), ['hit']);
  assert.equal(input[0].replies.length, 2);
});

test('oldest is created ascending at every level and does not use likes', () => {
  const rows = [
    node({ created: after, text: 'new', likeCount: 9, replies: [
      node({ created: after, text: 'later' }),
      node({ created: before, text: 'sooner' }),
    ] }),
    node({ created: before, text: 'old', likeCount: 0 }),
    node({ created: day, text: 'mid', likeCount: 4 }),
  ];
  const oldest = sortCommentTree(rows, 'oldest');
  assert.deepEqual(texts(oldest), ['old', 'mid', 'new']);
  assert.deepEqual(texts(oldest[2].replies), ['sooner', 'later']);
  const liked = [
    node({ created: day, text: 'a', likeCount: 1 }),
    node({ created: day, text: 'b', likeCount: 8 }),
  ];
  assert.deepEqual(texts(sortCommentTree(liked, 'oldest')), ['a', 'b']);
  assert.deepEqual(texts(sortCommentTree(liked, 'top')), ['b', 'a']);
});

test('opening a comments view resets reader filters, and Escape closes the panel first', () => {
  const client = readFileSync(new URL('../processallmessages.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(client, /section\._readerFilters = freshCommentFilters\(\);/);
  const reset = client.slice(client.indexOf('section._resetSort = () =>'), client.indexOf('section._syncSortBar'));
  assert.match(reset, /section\._readerFilters = freshCommentFilters\(\);/);
  assert.match(reset, /section\._closeCommentSettings\(\)/);
  assert.match(client, /className = 'comments-more-button'/);
  assert.match(client, /aria-label', 'Comment settings'/);
  assert.match(client, /id = 'comments-settings-panel'/);
  assert.match(client, /className = 'comments-settings-card'/);
  assert.match(client, /commentFilterSection\('Filter'/);
  assert.match(client, /bar\.append\(back, title, commentsMoreButton\(\)\)/);
  assert.match(client, /wrapper\.appendChild\(commentsCloseButton\(section\)\);\n\s*wrapper\.appendChild\(commentsMoreButton\(\)\)/);
  assert.match(client, /cardContent\.appendChild\(commentsCloseButton\(section\)\);\n\s*cardContent\.appendChild\(commentsMoreButton\(\)\)/);
  const escape = client.slice(client.indexOf("if (event.key !== 'Escape'"), client.indexOf('wallet-account-changed'));
  const panelClose = escape.indexOf('panel.hidden = true');
  const commentsClose = escape.indexOf('closeCommentsModal()');
  assert.ok(panelClose >= 0 && panelClose < commentsClose);
  assert.match(client, /Connect your wallet to use Mine and Following/);
  assert.match(client, /feedFollowSet\(\)/);
  assert.doesNotMatch(client, /filterCommentTree\(reader/);
});
