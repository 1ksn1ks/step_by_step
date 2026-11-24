// One optional media item on a comment or reply: the address check the
// server and both clients share, media-only comments, edits that replace,
// keep or clear the media, a delete that clears it, the upload caps, and
// a source check that every path carries it. No live upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMMENT_IMAGE_URL_MAX,
  COMMENT_TEXT_MAX,
  applyCommentMutation,
  commentImageUrl,
  commentImageValue,
  createCommentState,
  filterCommentTree,
  insertComment,
  readCommentEvents,
  reconcileCommentTree,
} from '../commentops.js';
import {
  COMMENT_GIF_MAX_BYTES,
  COMMENT_GIF_MAX_SECONDS,
  COMMENT_MEDIA_ACCEPT,
  COMMENT_STILL_EDGE,
  COMMENT_STILL_ORIGINAL_MAX,
  COMMENT_STILL_QUALITY,
  COMMENT_STILL_UPLOAD_MAX,
  COMMENT_VIDEO_MAX_BYTES,
  COMMENT_VIDEO_MAX_SECONDS,
  commentMediaKind,
  commentMediaReject,
  commentStillReject,
  commentVideoReject,
} from '../commentmedia.js';
import { COVER_VIDEO_MAX_SECONDS, COVER_VIDEO_UNKNOWN_TOAST } from '../covervideolimit.js';

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

const payer = '0.0.10';
const t0 = '2026-11-24T00:00:00.000Z';
const t1 = '2026-11-24T00:00:01.000Z';
const t2 = '2026-11-24T00:00:02.000Z';
const t3 = '2026-11-24T00:00:03.000Z';
const R2 = 'https://pub-test.r2.dev/media/abc.webp';
const CLIP = 'https://pub-test.r2.dev/media/def.mp4?gif=1';

test('commentImageUrl takes an http(s), ipfs or Hashinal address and refuses the rest', () => {
  assert.equal(commentImageValue(R2), R2);
  assert.equal(commentImageUrl(R2), R2);
  assert.equal(commentImageValue(`  ${CLIP}  `), CLIP);
  assert.equal(commentImageValue('http://example.com/a.png'), 'http://example.com/a.png');
  assert.equal(commentImageValue('ipfs://QmHash/a.png'), 'ipfs://QmHash/a.png');
  // A Hashinal is stored as written and painted from our route.
  assert.equal(commentImageValue('hcs://1/0.0.123'), 'hcs://1/0.0.123');
  assert.match(commentImageUrl('hcs://1/0.0.123'), /\/api\/hcs1\/0\.0\.123$/);
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:image/png;base64,AAAA',
    '',
    '   ',
    'https://',
    'http:///x',
    'ftp://example.com/a.png',
    '//example.com/a.png',
    'hcs://1/abc',
    'https://example.com/a b.png',
    'https://example.com/"onerror="x',
    null,
    undefined,
    42,
    { url: R2 },
    `https://example.com/${'a'.repeat(COMMENT_IMAGE_URL_MAX)}`,
  ]) {
    assert.equal(commentImageValue(bad), '', String(bad));
    assert.equal(commentImageUrl(bad), '', String(bad));
  }
});

test('a comment or reply may be media only, text only, or both; neither is not a comment', () => {
  const media = readCommentEvents({ commentMarker: { timestamp: '7', text: '', image: R2 } }, payer, t0);
  assert.equal(media.length, 1);
  assert.equal(media[0].text, '');
  assert.equal(media[0].image, R2);
  const both = readCommentEvents({ replyPolygon: { timestamp: '7', parentId: t0, text: 'look', image: CLIP } }, payer, t1);
  assert.deepEqual([both[0].type, both[0].text, both[0].image], ['reply', 'look', CLIP]);
  const text = readCommentEvents({ commentPolygon: { timestamp: '7', text: 'hi' } }, payer, t0);
  assert.deepEqual([text[0].text, text[0].image], ['hi', '']);
  // Empty text and no media, or media that cannot be shown: nothing.
  assert.deepEqual(readCommentEvents({ commentMarker: { timestamp: '7', text: '  ' } }, payer, t0), []);
  assert.deepEqual(readCommentEvents({ commentMarker: { timestamp: '7', text: '', image: 'javascript:alert(1)' } }, payer, t0), []);
  assert.deepEqual(readCommentEvents({ replyMarker: { parentId: t0, text: '', image: 'data:image/png;base64,AA' } }, payer, t1), []);
  // Text with a bad address keeps the text and drops the address.
  const kept = readCommentEvents({ commentMarker: { timestamp: '7', text: 'hello', image: 'javascript:x' } }, payer, t0);
  assert.deepEqual([kept[0].text, kept[0].image], ['hello', '']);
});

test('the media address is never part of the 1000-character text', () => {
  const long = 'a'.repeat(COMMENT_TEXT_MAX + 50);
  const [event] = readCommentEvents({ commentMarker: { timestamp: '7', text: long, image: R2 } }, payer, t0);
  assert.equal(event.text.length, COMMENT_TEXT_MAX);
  assert.equal(event.text.includes('https://'), false);
  assert.equal(event.image, R2);
  const state = createCommentState();
  const node = insertComment(state, { created: t0, payer, text: long, image: R2 });
  assert.equal(node.text.length, COMMENT_TEXT_MAX);
  assert.equal(node.image, R2);
});

test('an edit replaces, keeps or clears the media; latest wins and a delete is terminal', () => {
  const state = createCommentState();
  insertComment(state, { created: t0, payer, text: 'first', image: R2 });
  const node = state.nodes[0];
  // No image on the edit: the media stays.
  const [keep] = readCommentEvents({ editCommentMarker: { created: t0, text: 'second', timestamp: '7' } }, payer, t1);
  assert.equal('image' in keep, false);
  applyCommentMutation(state, keep);
  assert.deepEqual([node.text, node.image, node.edited], ['second', R2, true]);
  // A new image replaces it.
  const [swap] = readCommentEvents({ editCommentMarker: { created: t0, text: 'third', image: CLIP, timestamp: '7' } }, payer, t2);
  applyCommentMutation(state, swap);
  assert.deepEqual([node.text, node.image], ['third', CLIP]);
  // "" clears it; null clears it too.
  const [clear] = readCommentEvents({ editCommentMarker: { created: t0, text: 'fourth', image: '', timestamp: '7' } }, payer, t3);
  assert.equal(clear.image, '');
  applyCommentMutation(state, clear);
  assert.deepEqual([node.text, node.image], ['fourth', '']);
  // An older edit that arrives late does not bring the media back.
  applyCommentMutation(state, { ...swap });
  assert.deepEqual([node.text, node.image], ['fourth', '']);

  const other = createCommentState();
  insertComment(other, { created: t0, payer, text: 'x', image: R2 });
  const [nulled] = readCommentEvents({ editReplyPolygon: { created: t0, text: 'y', image: null, parentId: 'p' } }, payer, t1);
  assert.equal(nulled.image, '');
  applyCommentMutation(other, nulled);
  assert.equal(other.nodes[0].image, '');
});

test('a media-only comment can drop its text or its media, but not both', () => {
  const state = createCommentState();
  insertComment(state, { created: t0, payer, text: '', image: R2 });
  const node = state.nodes[0];
  assert.deepEqual([node.text, node.image], ['', R2]);
  // Clearing the only thing it shows is not an edit.
  assert.equal(applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t1, text: '', image: '' }), null);
  assert.deepEqual([node.text, node.image, node.edited], ['', R2, false]);
  // Text in, media kept: fine. Then media out, text kept: fine.
  applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t2, text: 'now with words' });
  assert.deepEqual([node.text, node.image], ['now with words', R2]);
  applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t3, text: 'now with words', image: '' });
  assert.deepEqual([node.text, node.image], ['now with words', '']);
});

test('a delete clears the media, and the placeholder shows none', () => {
  const state = createCommentState();
  insertComment(state, { created: t0, payer, text: 'parent', image: R2 });
  insertComment(state, { created: t1, payer: '0.0.11', text: 'child', image: CLIP }, t0);
  applyCommentMutation(state, { kind: 'delete', created: t0, payer, at: t2 });
  assert.deepEqual([state.nodes[0].text, state.nodes[0].image, state.nodes[0].deleted], ['', '', true]);
  // An edit after the delete changes nothing.
  assert.equal(applyCommentMutation(state, { kind: 'edit', created: t0, payer, at: t3, text: 'back', image: R2 }), null);
  const [placeholder] = filterCommentTree(state.nodes);
  assert.deepEqual([placeholder.deleted, placeholder.text, placeholder.image], [true, '', '']);
  assert.equal(placeholder.replies[0].image, CLIP);
  // A tree from the server with a stale address on a deleted row shows none.
  const [stale] = filterCommentTree([{ created: t0, payer, text: 'x', image: R2, deleted: true, replies: [{ created: t1, payer, text: 'r', replies: [] }] }]);
  assert.equal(stale.image, '');
  // A bad address on a live row is dropped when shown.
  const [bad] = filterCommentTree([{ created: t0, payer, text: 'x', image: 'javascript:alert(1)', replies: [] }]);
  assert.equal(bad.image, '');
});

test('an optimistic media-only row is replaced by its real message, and only by that one', () => {
  const pending = { parentId: null, node: { payer, text: '', image: R2, created: t3, pending: true, replies: [] } };
  const other = { created: t1, payer, text: '', image: CLIP, replies: [] };
  const left = reconcileCommentTree([], [other], [pending]);
  assert.equal(left.pendings.length, 1);
  const real = { created: t2, payer, text: '', image: R2, replies: [] };
  const done = reconcileCommentTree([other], [other, real], [pending]);
  assert.equal(done.pendings.length, 0);
});

test('stills, GIFs and videos have the post and cover caps, and a video 25 MB and 30 seconds', () => {
  assert.equal(COMMENT_VIDEO_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(COMMENT_VIDEO_MAX_SECONDS, 30);
  assert.equal(COMMENT_VIDEO_MAX_SECONDS, COVER_VIDEO_MAX_SECONDS);
  assert.equal(COMMENT_STILL_ORIGINAL_MAX, 10 * 1024 * 1024);
  assert.equal(COMMENT_STILL_UPLOAD_MAX, 2 * 1024 * 1024);
  assert.equal(COMMENT_STILL_EDGE, 2048);
  assert.equal(COMMENT_STILL_QUALITY, 0.8);
  assert.equal(COMMENT_GIF_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(COMMENT_GIF_MAX_SECONDS, 30);
  assert.equal(COMMENT_MEDIA_ACCEPT, 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm');

  const file = (type, size) => ({ type, size });
  assert.equal(commentMediaKind(file('image/jpeg', 1)), 'still');
  assert.equal(commentMediaKind(file('image/gif', 1)), 'gif');
  assert.equal(commentMediaKind(file('video/webm', 1)), 'video');
  for (const type of ['video/quicktime', 'image/svg+xml', 'application/pdf', '']) {
    assert.equal(commentMediaKind(file(type, 1)), '', type);
    assert.equal(commentMediaReject(file(type, 1)), 'Only PNG, JPG, WebP, GIF, MP4, WebM', type);
  }
  assert.equal(commentMediaReject(null), 'Only PNG, JPG, WebP, GIF, MP4, WebM');
  assert.equal(commentMediaReject(file('image/png', 10 * 1024 * 1024)), '');
  assert.equal(commentMediaReject(file('image/png', 10 * 1024 * 1024 + 1)), 'Image is over 10 MB');
  assert.equal(commentStillReject(file('image/webp', 2 * 1024 * 1024)), '');
  assert.equal(commentStillReject(file('image/webp', 2 * 1024 * 1024 + 1)), 'Image is still over 2 MB after compression');
  assert.equal(commentMediaReject(file('image/gif', 8 * 1024 * 1024)), '');
  assert.equal(commentMediaReject(file('image/gif', 8 * 1024 * 1024 + 1)), 'GIF max 8 MB');
  assert.equal(commentMediaReject(file('video/mp4', 25 * 1024 * 1024)), '');
  assert.equal(commentMediaReject(file('video/mp4', 25 * 1024 * 1024 + 1)), 'Video max 25 MB');
  // Length: the cover video's check, said for a comment.
  assert.equal(commentVideoReject(30), '');
  assert.equal(commentVideoReject(30.4), '');
  assert.equal(commentVideoReject(31), 'Video max 30 seconds');
  assert.equal(commentVideoReject(null), COVER_VIDEO_UNKNOWN_TOAST);
  assert.equal(commentVideoReject(Number.NaN), COVER_VIDEO_UNKNOWN_TOAST);
  assert.equal(commentVideoReject(0), COVER_VIDEO_UNKNOWN_TOAST);
});

test('the server, both clients and the uploader carry the one media field', () => {
  const server = read('../server/index.js');
  assert.match(server, /edited_at  TEXT,\n(?:\s*--[^\n]*\n)*\s*image      TEXT,\n\s*PRIMARY KEY \(topic_id, target_key, created, payer\)/);
  assert.match(server, /"ALTER TABLE comments ADD COLUMN image TEXT",/);
  assert.match(server, /INSERT OR IGNORE INTO comments \(topic_id, target_key, created, payer, text, parent_id, image\)\s*VALUES \(\?, \?, \?, \?, \?, \?, \?\)/);
  assert.match(server, /SELECT created, payer, text, parent_id, edited, deleted, edited_at, image FROM comments WHERE topic_id = \? AND target_key = \?/);
  assert.match(server, /SELECT created, payer, text, parent_id, edited, deleted, edited_at, image FROM comments WHERE topic_id = \? AND created = \? AND payer = \?/);
  assert.match(server, /UPDATE comments SET text = \?, image = \?, edited = \?, deleted = \?, edited_at = \?/);
  assert.match(server, /q\.insertComment\.run\(topicId, event\.stamp, created, payer, event\.text, null, event\.image \|\| null\);/);
  assert.match(server, /q\.insertComment\.run\(topicId, event\.parentId, created, payer, event\.text, event\.parentId, event\.image \|\| null\);/);
  assert.match(server, /image: row\.image \|\| "",/);
  assert.match(server, /verdict\.image \|\| null,/);
  assert.match(server, /image: deleted \? "" : commentImageValue\(row\.image \|\| ""\),/);

  const client = read('../processallmessages.js');
  assert.match(client, /takeStoredComment\(bag, map, key, \{ payer: payerId, text: event\.text, image: event\.image, created: at \}\);/);
  assert.match(client, /node\.image = verdict\.image \|\| '';/);
  for (const name of ['sendMarkerComment', 'sendPolygonComment']) {
    assert.match(client, new RegExp(`window\\.${name} = function\\(timestamp, topicId, input, media\\)`));
  }
  for (const name of ['sendMarkerReply', 'sendPolygonReply']) {
    assert.match(client, new RegExp(`window\\.${name} = function\\(postTimestamp, parentId, topicId, input, media\\)`));
  }
  const send = client.slice(client.indexOf('async function sendCommentOrReply'), client.indexOf('window.sendMarkerComment ='));
  assert.match(send, /if \(!text && !image\) \{\s*toast\.error\('Comment is empty'\);/);
  assert.match(send, /if \(image\) body\.image = image;/);
  assert.match(send, /rememberSentComment\(input, text, parentId, image\);/);
  assert.match(client, /window\.sendEditMarkerReply = \(timestamp, topicId, created, text, payer, parentId, media\)/);
  const edit = client.slice(client.indexOf('async function sendCommentEdit'), client.indexOf('async function sendCommentDelete'));
  assert.match(edit, /if \(!clipped && !image\) \{\s*toast\.error\('Comment is empty'\);/);
  assert.match(edit, /if \(edit\.set\) payload\.image = edit\.image;/);
  assert.match(client, /patchMountedComment\(kind, topicId, timestamp, created, \{ text: '', image: '', deleted: true \}\);/);
  // Public comments never take the sealed (e2ee) upload.
  const feed = read('../feedlayout.js');
  assert.equal(feed.split('image: event.image,').length - 1, 2);
  assert.match(feed, /node\.image = verdict\.image \|\| '';/);

  const upload = read('../uploadmedia.js');
  const helper = upload.slice(upload.indexOf('export async function uploadCommentMedia'), upload.indexOf('function showSavedProfilePreview'));
  assert.ok(helper.length > 200);
  assert.match(helper, /compressPostImage\(file\)/);
  assert.match(helper, /uploadPostImage\(small,/);
  assert.match(helper, /uploadToR2\(file, "Uploading GIF", null, anchor, "media"\)/);
  assert.match(helper, /commentVideoReject\(seconds\)/);
  assert.match(helper, /uploadToR2\(file, "Uploading video",/);
  assert.equal(/seal/i.test(helper.replace(/^\s*\/\/.*$/gm, '')), false);
  // Chat and post uploads are as they were.
  assert.match(upload, /export async function uploadChatImage\(file, anchor, options\) \{\s*const kind = options && \(options\.kind === "topic" \|\| options\.kind === "e2ee"\)/);
});
