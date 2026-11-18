// Thumbnail building when sources are slow or dead (server/avatar.js): a
// dead source is fetched once per wait whoever asks, the wait growing while
// it stays dead; a slow source holds a fetch slot only, never the slots a
// quick one is made in; a request finding the slots full waits briefly;
// thumbnails that work are made and served as before.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import sharp from "sharp";

import {
  AVATAR_DOWN_MAX_MS,
  AVATAR_DOWN_MS,
  AVATAR_FETCH_MS,
  AVATAR_MAX_BUILDS,
  AVATAR_MAX_FETCHES,
  AVATAR_MISS_MS,
  AVATAR_QUEUE_MS,
  AVATAR_TOTAL_MS,
  avatarKey,
  avatarWorkState,
  clearAvatarCache,
  fetchAvatarSource,
  getAvatarThumb,
  makeAvatarThumb,
} from "../server/avatar.js";

const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();

// A source that is down, the way the real fetch reports it (502).
const refused = (url) => fetchAvatarSource(url, {
  lookup: (host, options, callback) => callback(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })),
});

// A source that never answers and ignores the abort, like a read that
// cannot be stopped: only the deadline gives its slot back.
const never = () => new Promise(() => {});

// Node 22 cancels a test on beforeExit when nothing ref'd is left. The
// waits below sit on AbortSignal.timeout (server/avatar.js) and, with the
// fetch slots full, on the slot wait. Both timers are unref'd, so a live
// server is never held open by them. Node 24 holds the file open until the
// test settles. One ref'd timer for the test, cleared when it ends, keeps
// Node 22 on that same wait.
function holdLoop() {
  const timer = setInterval(() => {}, 2 ** 31 - 1);
  return () => clearInterval(timer);
}

const idle = () => assert.deepEqual(avatarWorkState(), { fetching: 0, building: 0, waiting: 0 });

test("the limits", () => {
  assert.equal(AVATAR_FETCH_MS, 5000);
  assert.equal(AVATAR_TOTAL_MS, 10000);
  assert.equal(AVATAR_QUEUE_MS, 2000);
  assert.ok(AVATAR_MAX_FETCHES > AVATAR_MAX_BUILDS, "more sources read than thumbnails made at once");
  assert.equal(AVATAR_DOWN_MS, 60 * 1000);
  assert.equal(AVATAR_DOWN_MAX_MS, AVATAR_MISS_MS);
});

test("a dead source is fetched once per wait whoever asks, the wait growing while it stays dead", async () => {
  clearAvatarCache();
  let now = 2_000_000;
  let alive = false;
  let asked = 0;
  const fetchSource = async (url) => {
    asked += 1;
    return alive ? png : refused(url);
  };
  const dead = "https://dead.example/face.png";
  const ask = (ip = "203.0.113.1") => getAvatarThumb(dead, { fetchSource, now: () => now, ip });

  // Twenty users at once, then again and again: one fetch.
  const first = await Promise.all(Array.from({ length: 20 }, (_, i) => ask(`203.0.113.${i + 1}`)));
  assert.ok(first.every((result) => result.status === 502));
  assert.equal(asked, 1);
  assert.equal(first[0].retryAfter, AVATAR_DOWN_MS / 1000);
  for (let i = 0; i < 10; i += 1) assert.equal((await ask(`198.51.100.${i + 1}`)).status, 502);
  assert.equal(asked, 1, "not fetched again within the wait");

  // The answer counts down to when it is fetched again.
  now += AVATAR_DOWN_MS - 1000;
  const late = await ask();
  assert.deepEqual([late.status, late.retryAfter, asked], [502, 1, 1]);

  // Each failure after a wait doubles the next one: 1, 2, 4, 8 minutes,
  // then 10 minutes for as long as it stays dead.
  now += 1000;
  let wait = AVATAR_DOWN_MS;
  for (const next of [2, 4, 8, 10, 10].map((minutes) => minutes * 60 * 1000)) {
    const again = await ask();
    assert.equal(again.retryAfter, next / 1000, `after waiting ${wait / 1000} s`);
    const fetched = asked;
    now += next - 1;
    assert.equal((await ask()).status, 502);
    assert.equal(asked, fetched, "nothing fetched before the wait is over");
    now += 1;
    wait = next;
  }

  // Back up: made, served from memory, and the failures are forgotten.
  alive = true;
  const made = await ask();
  assert.deepEqual([made.ok, made.from], [true, "built"]);
  assert.equal((await ask()).from, "memory");
  idle();
  clearAvatarCache();
});

test("a source that failed long ago starts again at the shortest wait; a missing one stays 10 minutes", async () => {
  clearAvatarCache();
  let now = 7_000_000;
  const asked = [];
  const missing = "https://cdn.example/missing.png";
  const fetchSource = async (url) => {
    asked.push(url);
    if (url === missing) {
      return fetchAvatarSource(url, { lookup: (host, options, callback) => callback(Object.assign(new Error("nx"), { code: "ENOTFOUND" })) });
    }
    return refused(url);
  };
  const opts = { fetchSource, now: () => now };
  const dead = "https://dead.example/old.png";
  assert.equal((await getAvatarThumb(dead, opts)).retryAfter, AVATAR_DOWN_MS / 1000);
  now += AVATAR_DOWN_MS + AVATAR_DOWN_MAX_MS + 1;
  assert.equal((await getAvatarThumb(dead, opts)).retryAfter, AVATAR_DOWN_MS / 1000, "not a run: the first wait again");
  assert.equal(asked.length, 2);

  const gone = await getAvatarThumb(missing, opts);
  assert.equal(gone.status, 404);
  assert.equal(gone.retryAfter, undefined);
  now += AVATAR_MISS_MS - 1;
  assert.equal((await getAvatarThumb(missing, opts)).status, 404);
  assert.equal(asked.filter((url) => url === missing).length, 1);
  now += 1;
  await getAvatarThumb(missing, opts);
  assert.equal(asked.filter((url) => url === missing).length, 2);
  idle();
  clearAvatarCache();
});

test("three slow sources do not keep a fourth, quick one from being made", async () => {
  const release = holdLoop();
  try {
    clearAvatarCache();
    const good = "https://cdn.example/quick.png";
    const fetchSource = async (url) => (url === good ? png : never());
    const opts = { fetchSource, totalMs: 400 };
    const slow = [1, 2, 3].map((n) => getAvatarThumb(`https://slow${n}.example/face.png`, opts));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(avatarWorkState().fetching, 3);

    const started = Date.now();
    const made = await getAvatarThumb(good, opts);
    assert.deepEqual([made.ok, made.from], [true, "built"]);
    assert.ok(Date.now() - started < 300, "made while the slow ones still wait");
    assert.equal(avatarWorkState().fetching, 3, "the slow ones hold fetch slots only");

    // At their deadline the slow ones give their slots back, remembered as down.
    const answers = await Promise.all(slow);
    assert.ok(answers.every((answer) => answer.status === 502 && answer.error === "source timeout"));
    idle();
    const again = await getAvatarThumb("https://slow1.example/face.png", { fetchSource: () => assert.fail("fetched again") });
    assert.equal(again.status, 502);
    clearAvatarCache();
  } finally {
    release();
  }
});

test("with every fetch slot held, a request waits briefly for one, then answers 503", async () => {
  const release = holdLoop();
  try {
    clearAvatarCache();
    const fetchSource = async (url) => (url.includes("quick") ? png : never());
    const hold = (totalMs) => Array.from({ length: AVATAR_MAX_FETCHES }, (_, i) => getAvatarThumb(`https://stuck${totalMs}-${i}.example/a.png`, { fetchSource, totalMs }));

    // A slot frees within the wait: it goes to the one waiting.
    const short = hold(300);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(avatarWorkState().fetching, AVATAR_MAX_FETCHES);
    const started = Date.now();
    const waited = await getAvatarThumb("https://cdn.example/quick-1.png", { fetchSource, queueMs: 2000 });
    assert.equal(waited.ok, true);
    assert.ok(Date.now() - started >= 250, "it waited for a slot");
    await Promise.all(short);
    idle();

    // None frees within the wait: 503, not remembered.
    const long = hold(1500);
    await new Promise((resolve) => setImmediate(resolve));
    const refusedNow = await getAvatarThumb("https://cdn.example/quick-2.png", { fetchSource, queueMs: 100 });
    assert.deepEqual([refusedNow.status, refusedNow.retryAfter > 0], [503, true]);
    assert.equal(avatarWorkState().waiting, 0, "it left the queue");
    await Promise.all(long);
    idle();
    assert.equal((await getAvatarThumb("https://cdn.example/quick-2.png", { fetchSource })).ok, true, "busy was not remembered");
    clearAvatarCache();
  } finally {
    release();
  }
});

test("a real source that stalls is cut off at the fetch limit and frees its slot", async () => {
  clearAvatarCache();
  const server = http.createServer((req, res) => {
    if (req.url === "/stall-body") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.write(png.subarray(0, 20));
    }
    // /stall-head: never answers.
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = String(server.address().port);
  const opts = {
    lookup: (host, options, callback) => callback(null, [{ address: "127.0.0.1", family: 4 }]),
    isBlocked: () => false,
    ports: ["", "80", "443", port],
    fetchMs: 200,
    totalMs: 1000,
  };
  try {
    for (const path of ["/stall-head", "/stall-body"]) {
      const started = Date.now();
      const answer = await getAvatarThumb(`http://slow.example:${port}${path}`, opts);
      assert.deepEqual([answer.status, answer.error], [502, "source timeout"], path);
      assert.ok(Date.now() - started < 900, `${path}: cut at the fetch limit, not the total`);
      idle();
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    clearAvatarCache();
  }
});

// An R2 bucket in a Map, for the two reads a stored thumbnail needs.
function storedR2(key, bytes) {
  return {
    async send(command) {
      if (command.input.Key !== key) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      if (command.constructor.name === "HeadObjectCommand") return { ContentLength: bytes.length };
      const body = Readable.from([bytes]);
      body.transformToByteArray = async () => new Uint8Array(bytes);
      return { Body: body };
    },
  };
}

test("thumbnails that work: made once for many requests, served from memory, and from R2 even while every slot is busy", async () => {
  const release = holdLoop();
  try {
    clearAvatarCache();
    let asked = 0;
    const fine = "https://cdn.example/fine.png";
    const fetchSource = async (url) => {
      asked += 1;
      return url === fine ? png : never();
    };
    const all = await Promise.all(Array.from({ length: 10 }, () => getAvatarThumb(fine, { fetchSource })));
    assert.ok(all.every((answer) => answer.ok && answer.bytes.length > 0));
    assert.equal(asked, 1);
    assert.equal((await getAvatarThumb(fine, { fetchSource })).from, "memory");
    idle();

    // Every fetch slot held by slow sources: a thumbnail already in R2 needs
    // no slot.
    const slow = Array.from({ length: AVATAR_MAX_FETCHES }, (_, i) => getAvatarThumb(`https://stuck-${i}.example/a.png`, { fetchSource, totalMs: 300 }));
    await new Promise((resolve) => setImmediate(resolve));
    const kept = "https://cdn.example/kept.png";
    const stored = await makeAvatarThumb(png);
    const fromR2 = await getAvatarThumb(kept, { fetchSource, s3: storedR2(avatarKey(kept), stored), bucket: "b", queueMs: 0 });
    assert.deepEqual([fromR2.ok, fromR2.from], [true, "r2"]);
    await Promise.all(slow);
    idle();
    clearAvatarCache();
  } finally {
    release();
  }
});
