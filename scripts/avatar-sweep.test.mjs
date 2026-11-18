// The R2 sweep of profile picture thumbnails (server/avatarsweep.js): a
// thumbnail nobody asked for in 90 days is deleted, one asked for is kept,
// nothing is deleted before the server has counted for 90 days, and only
// keys of a thumbnail's own shape under avatars/v<n>/ are ever touched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";

import { avatarKey, clearAvatarCache, createProfileSources, getAvatarThumb } from "../server/avatar.js";
import {
  AVATAR_SEEN_EVERY_MS,
  AVATAR_SWEEP_PREFIX,
  AVATAR_SWEEP_UNUSED_MS,
  createAvatarSeen,
  deleteAvatarThumb,
  isAvatarThumbKey,
  listAvatarThumbs,
  planAvatarSweep,
  runAvatarSweep,
} from "../server/avatarsweep.js";

const DAY = 24 * 60 * 60 * 1000;
const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 90, b: 200 } } }).png().toBuffer();
const key = (name) => avatarKey(`https://cdn.example/${name}.png`);

// An R2 bucket in a Map: lists in pages, deletes, and the reads and writes
// avatar.js makes. clock() stamps what is written.
function fakeBucket(objects = [], { clock = () => 0, pageSize = 2, failOn = new Set() } = {}) {
  const store = new Map(objects.map((item) => [item.key, { ...item, body: Buffer.alloc(1) }]));
  const sent = [];
  return {
    store,
    sent,
    async send(command) {
      const kind = command.constructor.name;
      sent.push([kind, command.input.Key || command.input.Prefix]);
      const { Key } = command.input;
      if (kind === "ListObjectsV2Command") {
        const all = [...store.values()].filter((item) => item.key.startsWith(command.input.Prefix)).sort((a, b) => a.key.localeCompare(b.key));
        const start = Number(command.input.ContinuationToken || 0);
        const next = start + pageSize;
        return {
          Contents: all.slice(start, next).map((item) => ({ Key: item.key, LastModified: new Date(item.modifiedMs) })),
          IsTruncated: next < all.length,
          NextContinuationToken: next < all.length ? String(next) : undefined,
        };
      }
      if (kind === "DeleteObjectCommand") {
        if (failOn.has(Key)) throw new Error("delete failed");
        store.delete(Key);
        return {};
      }
      if (kind === "PutObjectCommand") {
        store.set(Key, { key: Key, modifiedMs: clock(), body: Buffer.from(command.input.Body) });
        return {};
      }
      const item = store.get(Key);
      if (!item) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      if (kind === "HeadObjectCommand") return { ContentLength: item.body.length };
      return { Body: { transformToByteArray: async () => new Uint8Array(item.body) } };
    },
  };
}

test("only a thumbnail's own key is ever swept", () => {
  assert.equal(AVATAR_SWEEP_PREFIX, "avatars/v1/");
  assert.equal(isAvatarThumbKey(key("a")), true);
  for (const other of ["avatars/1763390000000-a1b2c3.jpg", "avatars/v1/notes.txt", `avatars/v1/${"a".repeat(64)}.png`,
    `avatars/v2/${"a".repeat(64)}.webp`, "markers/1700000000000-abc123.png", "hcs1/0.0.1", "", null]) {
    assert.equal(isAvatarThumbKey(other), false, String(other));
  }
});

test("which thumbnails a sweep deletes", () => {
  const now = 1000 * DAY;
  const since = now - 365 * DAY;
  const objects = [
    { key: key("never-asked-for"), modifiedMs: now - 120 * DAY },
    { key: key("asked-for-lately"), modifiedMs: now - 120 * DAY },
    { key: key("asked-for-long-ago"), modifiedMs: now - 300 * DAY },
    { key: key("just-made"), modifiedMs: now - 5 * DAY },
    { key: key("exactly-90-days"), modifiedMs: now - 90 * DAY },
    { key: "avatars/v1/notes.txt", modifiedMs: 0 },
    { key: "markers/1700000000000-abc123.png", modifiedMs: 0 },
  ];
  const seen = new Map([[key("asked-for-lately"), now - 10 * DAY], [key("asked-for-long-ago"), now - 95 * DAY]]);
  assert.deepEqual(planAvatarSweep(objects, (k) => seen.get(k), { now, since }), [key("never-asked-for"), key("asked-for-long-ago")]);

  // Counting began less than 90 days ago (a first start, a wiped database):
  // nothing, however old the objects.
  assert.deepEqual(planAvatarSweep(objects, () => 0, { now, since: now - 89 * DAY }), []);
  // No count start known: nothing.
  assert.deepEqual(planAvatarSweep(objects, () => 0, { now }), []);
  assert.equal(AVATAR_SWEEP_UNUSED_MS, 90 * DAY);
});

test("a sweep reads every page, deletes only those, counts a failed delete, and forgets old request times", async () => {
  const now = 2000 * DAY;
  const old = ["a", "b", "c", "d", "e"].map((name) => ({ key: key(name), modifiedMs: now - 200 * DAY }));
  const fresh = { key: key("fresh"), modifiedMs: now - DAY };
  const others = [
    { key: "avatars/v1/notes.txt", modifiedMs: 0 },
    { key: "avatars/1763390000000-a1b2c3.jpg", modifiedMs: 0 },
    { key: "markers/1700000000000-abc123.png", modifiedMs: 0 },
  ];
  const bucket = fakeBucket([...old, fresh, ...others], { failOn: new Set([old[2].key]) });

  const listed = await listAvatarThumbs(bucket, "b");
  assert.deepEqual(listed.map((item) => item.key).sort(), [...old, fresh].map((item) => item.key).sort());
  const lists = bucket.sent.filter(([kind]) => kind === "ListObjectsV2Command");
  assert.equal(lists.length, 4, "seven keys under the prefix, two a page");
  assert.ok(lists.every(([, prefix]) => prefix === AVATAR_SWEEP_PREFIX));

  const forgotten = [];
  const logs = [];
  const result = await runAvatarSweep({
    list: () => listAvatarThumbs(bucket, "b"),
    remove: (k) => deleteAvatarThumb(bucket, "b", k),
    lastSeen: () => 0,
    forgetBefore: (cutoff) => forgotten.push(cutoff),
    since: now - 365 * DAY,
    now: () => now,
    log: (line) => logs.push(line),
  });
  assert.deepEqual(result, { listed: 6, deleted: 4, failed: 1 });
  assert.deepEqual([...bucket.store.keys()].sort(), [old[2].key, fresh.key, ...others.map((item) => item.key)].sort());
  assert.deepEqual(forgotten, [now - AVATAR_SWEEP_UNUSED_MS]);
  assert.match(logs[0], /6 thumbnails, deleted 4, 1 failed/);
  const deletes = bucket.sent.filter(([kind]) => kind === "DeleteObjectCommand").map(([, k]) => k);
  assert.ok(deletes.every(isAvatarThumbKey), "nothing but thumbnails deleted");
  await assert.rejects(deleteAvatarThumb(bucket, "b", "markers/1700000000000-abc123.png"), /not a thumbnail key/);
});

test("each thumbnail answered writes its time, at most once a day; refusals and failures write nothing", async () => {
  clearAvatarCache();
  let now = 5000 * DAY;
  const writes = [];
  const seen = createAvatarSeen({ write: (k, at) => writes.push([k, at]), now: () => now });
  const face = "https://cdn.example/face.png";
  const opts = { fetchSource: async () => png, isProfileSource: createProfileSources([face]).has, seen, now: () => now };
  assert.equal((await getAvatarThumb(face, opts)).from, "built");
  assert.equal((await getAvatarThumb(face, opts)).from, "memory");
  assert.deepEqual(writes, [[key("face"), now]]);
  now += AVATAR_SEEN_EVERY_MS - 1;
  await getAvatarThumb(face, opts);
  assert.equal(writes.length, 1);
  now += 1;
  await getAvatarThumb(face, opts);
  assert.deepEqual(writes.at(-1), [key("face"), now]);

  assert.equal((await getAvatarThumb("https://cdn.example/stranger.png", opts)).status, 404);
  seen("markers/1700000000000-abc123.png");
  assert.equal(writes.length, 2);
  clearAvatarCache();
});

test("end to end: the thumbnail asked for again survives the sweep, the other is deleted and made again when asked for", async () => {
  clearAvatarCache();
  let now = 10_000 * DAY;
  const bucket = fakeBucket([], { clock: () => now });
  const table = new Map();
  const seen = createAvatarSeen({ write: (k, at) => table.set(k, Math.max(table.get(k) || 0, at)), now: () => now });
  const [kept, dropped] = ["https://cdn.example/kept.png", "https://cdn.example/dropped.png"];
  const sources = createProfileSources([kept, dropped]);
  const opts = { fetchSource: async () => png, s3: bucket, bucket: "b", isProfileSource: sources.has, seen, now: () => now };
  const since = now;
  for (const link of [kept, dropped]) assert.equal((await getAvatarThumb(link, opts)).from, "built");

  now += 80 * DAY;
  clearAvatarCache();
  assert.equal((await getAvatarThumb(kept, opts)).from, "r2", "a phone that had not drawn it yet");

  now += 20 * DAY;
  const sweep = {
    list: () => listAvatarThumbs(bucket, "b"),
    remove: (k) => deleteAvatarThumb(bucket, "b", k),
    lastSeen: (k) => table.get(k),
    forgetBefore: (cutoff) => {
      for (const [k, at] of table) if (at < cutoff) table.delete(k);
    },
    since,
    now: () => now,
    log: () => {},
  };
  assert.deepEqual(await runAvatarSweep(sweep), { listed: 2, deleted: 1, failed: 0 });
  assert.equal(bucket.store.has(key("kept")), true);
  assert.equal(bucket.store.has(key("dropped")), false);
  assert.equal(table.has(key("dropped")), false, "its old time is forgotten");

  clearAvatarCache();
  assert.equal((await getAvatarThumb(dropped, opts)).from, "built", "made again when asked for");
  assert.deepEqual(await runAvatarSweep(sweep), { listed: 2, deleted: 0, failed: 0 });
  clearAvatarCache();
});

test("server/index.js runs the sweep against R2 with the request times it writes", () => {
  const index = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(index, /CREATE TABLE IF NOT EXISTS avatar_seen \(key TEXT PRIMARY KEY, seen REAL NOT NULL\)/);
  assert.match(index, /INSERT OR IGNORE INTO meta \(key, value\) VALUES \('avatar_seen_since', \?\)/);
  assert.match(index, /const avatarSeen = createAvatarSeen\(\{ write: \(key, at\) => writeAvatarSeen\.run\(key, at\) \}\);/);
  assert.match(index, /if \(r2 && R2_BUCKET\) \{\s*startAvatarSweep\(\{\s*list: \(\) => listAvatarThumbs\(r2, R2_BUCKET\),\s*remove: \(key\) => deleteAvatarThumb\(r2, R2_BUCKET, key\),/);
  assert.match(index, /since: avatarSeenSince,/);
});
