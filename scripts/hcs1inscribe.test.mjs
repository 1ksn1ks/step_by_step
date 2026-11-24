// HCS-1 inscribing without a wallet: the chunks this app writes are the
// chunks server/hcs1.js reads, and a failed submit can be resumed. Also the
// route's cap on new mirror rebuilds and its daily R2 write budget.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { Readable } from "node:stream";

import {
  HCS1_CHUNK_MAX,
  HCS1_INSCRIBE_MAX_BYTES,
  assertInscribeGate,
  buildHcs1Inscription,
  estimateHcs1Cost,
  inscribeHcs1,
} from "../hcs1inscribe.js";
import { prepareInscribeFile, startInscribe } from "../hcs1inscribewallet.js";
import {
  HCS1_NEW_REBUILD_PER_IP_HOUR,
  HCS1_NEW_REBUILD_WINDOW_MS,
  HCS1_R2_DAILY_IP_MB,
  HCS1_R2_DAILY_TOTAL_MB,
  HCS1_R2_DAY_MS,
  clearHcs1Cache,
  decodeHcs1Text,
  getHcs1File,
  hcs1Route,
  joinHcs1Messages,
} from "../server/hcs1.js";

const MIRROR = "https://mirror.test";

function rowsOf(messages) {
  return messages.map((message) => ({ message: Buffer.from(message, "utf8").toString("base64") }));
}

async function roundTrip(bytes, mime) {
  const raw = Buffer.from(bytes);
  const built = await buildHcs1Inscription(raw, mime);
  assert.equal(built.sha256, crypto.createHash("sha256").update(raw).digest("hex"));
  assert.equal(built.memo, `${built.sha256}:zstd:base64`);
  assert.match(built.memo, /^[0-9a-f]{64}:zstd:base64$/);
  assert.equal(built.byteLength, raw.length);
  assert.equal(built.txCount, built.messages.length + 1);
  assert.equal(built.usd, estimateHcs1Cost(built.messages.length).usd);
  assert.ok(built.messages.length > 0);
  assert.ok(built.messages.length <= 12000);

  built.messages.forEach((message, index) => {
    assert.ok(Buffer.byteLength(message) <= HCS1_CHUNK_MAX, `${index} is ${Buffer.byteLength(message)}`);
    const part = JSON.parse(message);
    assert.equal(part.o, index);
    assert.equal(typeof part.c, "string");
  });
  const first = JSON.parse(built.messages[0]);
  assert.ok(first.c.startsWith(`data:${mime};base64,`));

  const joined = joinHcs1Messages(rowsOf(built.messages));
  assert.equal(joined.ok, true);
  const file = decodeHcs1Text(joined.text, built.sha256);
  assert.equal(file.ok, true, file.error);
  assert.equal(file.mime, mime);
  assert.equal(file.sha256, built.sha256);
  assert.deepEqual(file.bytes, raw);
  return built;
}

test("estimateHcs1Cost is one topic create plus each message", () => {
  assert.deepEqual(estimateHcs1Cost(0), { txCount: 1, usd: 0.01 });
  assert.equal(estimateHcs1Cost(1).txCount, 2);
  assert.ok(Math.abs(estimateHcs1Cost(1).usd - 0.0108) < 1e-12);
  assert.equal(estimateHcs1Cost(10).txCount, 11);
  assert.ok(Math.abs(estimateHcs1Cost(10).usd - 0.018) < 1e-12);
  assert.equal(HCS1_CHUNK_MAX, 1024);
  assert.equal(HCS1_INSCRIBE_MAX_BYTES, 2 * 1024 * 1024);
});

test("the fee gate is open until a check is plugged in", async () => {
  assert.deepEqual(await assertInscribeGate({ bytes: Buffer.from("x"), mime: "text/plain" }), { ok: true });
});

test("tiny text, 50 KB and PNG bytes round-trip through the HCS-1 reader", async () => {
  const text = await roundTrip(Buffer.from("hi"), "text/plain");
  assert.equal(text.messages.length, 1);

  const random = await roundTrip(crypto.randomBytes(50 * 1024), "application/octet-stream");
  assert.ok(random.messages.length > 1);

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crypto.randomBytes(400),
    Buffer.from("IEND"),
  ]);
  await roundTrip(png, "image/png");
});

test("a file over 2 MB is refused, and 2 MB is accepted", async () => {
  let created = false;
  await assert.rejects(
    () => inscribeHcs1({
      bytes: Buffer.alloc(HCS1_INSCRIBE_MAX_BYTES + 1),
      mime: "application/octet-stream",
      createTopic: async () => { created = true; return "0.0.1"; },
      submitMessage: async () => {},
    }),
    /over 2 MB/,
  );
  assert.equal(created, false);
  const built = await buildHcs1Inscription(Buffer.alloc(HCS1_INSCRIBE_MAX_BYTES), "application/octet-stream");
  assert.equal(built.byteLength, HCS1_INSCRIBE_MAX_BYTES);
  assert.ok(built.messages.every((message) => Buffer.byteLength(message) <= HCS1_CHUNK_MAX));
});

test("more messages than the cap is refused", async () => {
  await assert.rejects(
    () => buildHcs1Inscription(crypto.randomBytes(20 * 1024), "application/octet-stream", { maxMessages: 2 }),
    /too many messages/,
  );
});

test("inscribeHcs1 submits every chunk in order, one at a time", async () => {
  const bytes = crypto.randomBytes(50 * 1024);
  const built = await buildHcs1Inscription(bytes, "application/octet-stream");
  const sent = [];
  const progress = [];
  let topics = 0;
  let pending = null;
  const result = await inscribeHcs1({
    bytes,
    mime: "application/octet-stream",
    createTopic: async ({ memo, submitKey }) => {
      topics += 1;
      assert.equal(memo, built.memo);
      assert.equal(typeof submitKey.publicKey.toString(), "string");
      return "0.0.555";
    },
    submitMessage: async ({ topicId, submitKey, message }) => {
      assert.equal(pending, null);
      pending = message;
      assert.equal(topicId, "0.0.555");
      assert.ok(submitKey);
      await Promise.resolve();
      sent.push(message);
      pending = null;
    },
    onProgress: (state) => progress.push(state),
  });
  assert.equal(topics, 1);
  assert.deepEqual(sent, built.messages);
  assert.equal(progress.length, built.messages.length);
  assert.deepEqual(progress[0], { sent: 1, total: built.messages.length, topicId: "0.0.555" });
  assert.deepEqual(progress.at(-1), { sent: built.messages.length, total: built.messages.length, topicId: "0.0.555" });
  assert.equal(result.topicId, "0.0.555");
  assert.equal(result.hrl, "hcs://1/0.0.555");
  assert.equal(result.sha256, built.sha256);
  assert.equal(result.total, built.messages.length);
  assert.equal(Object.hasOwn(result, "submitKey"), false);
});

test("a failed submit keeps the topic, the key and the indexes already sent", async () => {
  const bytes = crypto.randomBytes(50 * 1024);
  const built = await buildHcs1Inscription(bytes, "application/octet-stream");
  const seen = [];
  let key = null;
  await assert.rejects(
    () => inscribeHcs1({
      bytes,
      mime: "application/octet-stream",
      createTopic: async ({ submitKey }) => {
        key = submitKey;
        return "0.0.42";
      },
      submitMessage: async ({ message }) => {
        if (seen.length === 1) throw new Error("wallet closed");
        seen.push(message);
      },
    }),
    (err) => {
      assert.equal(err.message, "wallet closed");
      assert.equal(err.topicId, "0.0.42");
      assert.equal(err.submitKey, key);
      assert.deepEqual(err.sentIndexes, [0]);
      return true;
    },
  );
  assert.deepEqual(seen, [built.messages[0]]);

  const resume = { topicId: "0.0.42", submitKey: key, sentIndexes: [0] };
  const rest = [];
  const done = await inscribeHcs1({
    bytes,
    mime: "application/octet-stream",
    resume,
    createTopic: async () => { throw new Error("topic already exists"); },
    submitMessage: async ({ topicId, submitKey, message }) => {
      assert.equal(topicId, "0.0.42");
      assert.equal(submitKey, key);
      rest.push(message);
    },
  });
  assert.deepEqual(rest, built.messages.slice(1));
  assert.equal(done.hrl, "hcs://1/0.0.42");
  assert.equal(done.total, built.messages.length);
  assert.equal(resume.submitKey, null);
});

test("resume sends only missing indexes, in order", async () => {
  const bytes = crypto.randomBytes(50 * 1024);
  const built = await buildHcs1Inscription(bytes, "application/octet-stream");
  assert.ok(built.messages.length > 3);
  const key = { publicKey: "kept" };
  const resume = { topicId: "0.0.7", submitKey: key, sentIndexes: [0, 2] };
  const sent = [];
  await inscribeHcs1({
    bytes,
    mime: "application/octet-stream",
    resume,
    createTopic: async () => { throw new Error("should not create"); },
    submitMessage: async ({ message }) => { sent.push(message); },
  });
  assert.deepEqual(sent, built.messages.filter((_, index) => index !== 0 && index !== 2));
  assert.equal(resume.submitKey, null);
});

test("GIF, video and glTF are not recompressed, and an over-cap file is flagged", async () => {
  const gif = crypto.randomBytes(300);
  const video = crypto.randomBytes(500);
  const model = crypto.randomBytes(700);
  const samples = [
    [gif, "anim.gif", "image/gif"],
    [video, "clip.mp4", "video/mp4"],
    [model, "model.glb", "model/gltf-binary"],
  ];
  for (const [raw, name, type] of samples) {
    const prepared = await prepareInscribeFile(new File([raw], name, { type }));
    assert.equal(prepared.overCap, false, type);
    assert.equal(prepared.mime, type);
    assert.equal(prepared.name, name);
    assert.deepEqual(prepared.bytes, new Uint8Array(raw));
    assert.equal(prepared.txCount, (await buildHcs1Inscription(raw, type)).txCount);
    assert.equal(typeof prepared.usd, "number");
  }
  const big = new File([new Uint8Array(HCS1_INSCRIBE_MAX_BYTES + 1)], "big.bin", { type: "application/octet-stream" });
  const over = await prepareInscribeFile(big);
  assert.equal(over.overCap, true);
  assert.equal(over.txCount, undefined);
  assert.equal(over.usd, undefined);
  await assert.rejects(() => startInscribe(big), /over 2 MB/);
});

// A file the server can rebuild, inscribed the way the reader expects.
function inscribed(bytes, mime) {
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const text = `data:${mime};base64,` + zlib.zstdCompressSync(bytes).toString("base64");
  const chunks = [];
  for (let o = 0, at = 0; at < text.length; o += 1, at += 180) chunks.push({ o, c: text.slice(at, at + 180) });
  return { memo: `${hash}:zstd:base64`, chunks };
}

function mirrorOf(topics) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    const id = /topics\/(0\.0\.\d+)/.exec(url)[1];
    const topic = topics[id];
    if (!topic) throw new Error("mirror HTTP 404");
    if (url.includes("/messages")) {
      return {
        messages: topic.chunks.map((part, i) => ({
          message: Buffer.from(JSON.stringify(part)).toString("base64"),
          sequence_number: i + 1,
        })),
        links: { next: null },
      };
    }
    return { topic_id: id, memo: topic.memo };
  };
  return { fetchJson, calls };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async send(command) {
      const { Key } = command.input;
      const kind = command.constructor.name;
      if (kind === "PutObjectCommand") {
        objects.set(Key, { ...command.input, Body: Buffer.from(command.input.Body) });
        return {};
      }
      const object = objects.get(Key);
      if (!object) {
        const err = new Error("not found");
        err.name = "NotFound";
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      if (kind === "HeadObjectCommand") {
        return { ContentLength: object.Body.length, Metadata: object.Metadata };
      }
      if (kind === "GetObjectCommand") {
        const body = Readable.from([object.Body]);
        body.transformToByteArray = async () => new Uint8Array(object.Body);
        return { Body: body };
      }
      throw new Error(`unexpected command ${kind}`);
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    removeHeader(name) { delete this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
    end(body) { this.body = body; this.headersSent = true; return this; },
  };
}

test("new mirror rebuilds are capped per IP, and cache or R2 hits do not count", async () => {
  if (!process.env.HCS1_NEW_REBUILD_PER_IP_HOUR) assert.equal(HCS1_NEW_REBUILD_PER_IP_HOUR, 300);
  assert.equal(HCS1_NEW_REBUILD_WINDOW_MS, 60 * 60 * 1000);
  clearHcs1Cache();
  let at = 1_000_000;
  const windowMs = 60_000;
  const topics = {};
  for (const id of ["0.0.11", "0.0.12", "0.0.13", "0.0.14", "0.0.15"]) {
    topics[id] = inscribed(Buffer.from(`file-${id}`), "text/plain");
  }
  const mirror = mirrorOf(topics);
  const ask = (id, ip) => getHcs1File(id, {
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    ip,
    newRebuildMax: 2,
    newRebuildWindowMs: windowMs,
    now: () => at,
  });

  const first = await ask("0.0.11", "198.51.100.1");
  assert.equal(first.ok, true);
  const callsAfterFirst = mirror.calls.length;
  const again = await ask("0.0.11", "198.51.100.1");
  assert.equal(again.source, "memory");
  assert.equal(mirror.calls.length, callsAfterFirst);

  assert.equal((await ask("0.0.12", "198.51.100.1")).ok, true);
  const blockedCalls = mirror.calls.length;
  const blocked = await ask("0.0.13", "198.51.100.1");
  assert.deepEqual([blocked.ok, blocked.status, blocked.error], [false, 429, "rate limit"]);
  assert.equal(blocked.retryAfter, 60);
  assert.equal(mirror.calls.length, blockedCalls);
  // Still in memory, so the cap does not hide a file this IP already has.
  assert.equal((await ask("0.0.11", "198.51.100.1")).source, "memory");
  // Another IP has its own hour.
  assert.equal((await ask("0.0.13", "198.51.100.2")).source, "mirror");
  // The refusal was not remembered on the topic: the window opening serves it.
  at += windowMs;
  assert.equal((await ask("0.0.14", "198.51.100.1")).source, "mirror");

  // An R2 hit is not a new rebuild. Max 2: one rebuild, one R2 read, then
  // one more rebuild still fits, and the one after that does not.
  clearHcs1Cache();
  const pngA = Buffer.alloc(300, 7);
  const pngB = Buffer.alloc(300, 8);
  const pngC = Buffer.alloc(300, 9);
  const stored = {
    "0.0.21": inscribed(pngA, "image/png"),
    "0.0.22": inscribed(pngB, "image/png"),
    "0.0.23": inscribed(pngC, "image/png"),
  };
  const r2 = fakeR2();
  const r2Mirror = mirrorOf(stored);
  const fromR2 = (id) => getHcs1File(id, {
    mirrorFetch: r2Mirror.fetchJson,
    mirror: MIRROR,
    s3: r2,
    bucket: "b",
    ip: "203.0.113.5",
    newRebuildMax: 2,
    now: () => at,
  });
  assert.equal((await fromR2("0.0.21")).source, "mirror");
  assert.ok(r2.objects.has("hcs1/0.0.21"));
  clearHcs1Cache({ counters: false });
  const hit = await fromR2("0.0.21");
  assert.equal(hit.source, "r2");
  assert.deepEqual(hit.bytes, pngA);
  assert.equal((await fromR2("0.0.22")).source, "mirror");
  const third = await fromR2("0.0.23");
  assert.equal(third.status, 429);
  assert.equal(r2.objects.has("hcs1/0.0.23"), false);
});

test("the route answers 429 with Retry-After when the rebuild cap is hit", async () => {
  clearHcs1Cache();
  const topics = {
    "0.0.31": inscribed(Buffer.from("one"), "text/plain"),
    "0.0.32": inscribed(Buffer.from("two"), "text/plain"),
  };
  const mirror = mirrorOf(topics);
  const route = hcs1Route({
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    clientIp: (req) => req.ip,
    newRebuildMax: 1,
    newRebuildWindowMs: 3_600_000,
    now: () => 5_000,
  });
  const call = async (id) => {
    const res = fakeRes();
    await route({ params: { topicId: id }, ip: "192.0.2.9", headers: {}, method: "GET" }, res);
    return res;
  };
  const ok = await call("0.0.31");
  assert.equal(ok.statusCode, 200);
  const limited = await call("0.0.32");
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(limited.body, { ok: false, error: "rate limit" });
  assert.equal(limited.headers["retry-after"], "3600");
  assert.equal(limited.headers["cache-control"], "no-store");
  assert.equal(mirror.calls.some((url) => url.includes("0.0.32")), false);
});

test("over the daily R2 budget the file is served and the write is skipped", async () => {
  if (!process.env.HCS1_R2_DAILY_IP_MB) assert.equal(HCS1_R2_DAILY_IP_MB, 50);
  if (!process.env.HCS1_R2_DAILY_TOTAL_MB) assert.equal(HCS1_R2_DAILY_TOTAL_MB, 200);
  assert.equal(HCS1_R2_DAY_MS, 24 * 60 * 60 * 1000);
  clearHcs1Cache();
  let at = 10_000;
  const day = 1_000;
  const files = {
    "0.0.41": Buffer.alloc(400, 1),
    "0.0.42": Buffer.alloc(800, 2),
    "0.0.43": Buffer.alloc(400, 3),
    "0.0.44": Buffer.alloc(600, 4),
    "0.0.45": Buffer.alloc(600, 5),
  };
  const topics = {};
  for (const [id, bytes] of Object.entries(files)) topics[id] = inscribed(bytes, "image/png");
  const mirror = mirrorOf(topics);
  const r2 = fakeR2();
  const ask = (id, ip, budgets) => getHcs1File(id, {
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    s3: r2,
    bucket: "b",
    ip,
    r2DayMs: day,
    now: () => at,
    ...budgets,
  });

  const first = await ask("0.0.41", "198.51.100.8", { r2DailyIpBytes: 1000, r2DailyTotalBytes: 5000 });
  assert.equal(first.ok, true);
  assert.deepEqual(r2.objects.get("hcs1/0.0.41").Body, files["0.0.41"]);

  const skipped = await ask("0.0.42", "198.51.100.8", { r2DailyIpBytes: 1000, r2DailyTotalBytes: 5000 });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.source, "mirror");
  assert.deepEqual(skipped.bytes, files["0.0.42"]);
  assert.equal(r2.objects.has("hcs1/0.0.42"), false);

  // A different IP still has room in its own budget and in the total.
  assert.equal((await ask("0.0.43", "198.51.100.9", { r2DailyIpBytes: 1000, r2DailyTotalBytes: 5000 })).source, "mirror");
  assert.ok(r2.objects.has("hcs1/0.0.43"));

  clearHcs1Cache();
  const totalR2 = fakeR2();
  const totalMirror = mirrorOf(topics);
  const askTotal = (id, ip) => getHcs1File(id, {
    mirrorFetch: totalMirror.fetchJson,
    mirror: MIRROR,
    s3: totalR2,
    bucket: "b",
    ip,
    r2DailyIpBytes: 10_000,
    r2DailyTotalBytes: 1000,
    r2DayMs: day,
    now: () => at,
  });
  assert.ok(r2WriteFits(await askTotal("0.0.44", "192.0.2.1"), totalR2, "0.0.44"));
  const overTotal = await askTotal("0.0.45", "192.0.2.2");
  assert.equal(overTotal.ok, true);
  assert.deepEqual(overTotal.bytes, files["0.0.45"]);
  assert.equal(totalR2.objects.has("hcs1/0.0.45"), false);

  // The next day the budget is open again. Drop the in-memory copy so the
  // request is a new rebuild, and keep the counters so the old window has
  // to expire on its own.
  at += day;
  clearHcs1Cache({ counters: false });
  assert.ok(r2WriteFits(await askTotal("0.0.45", "192.0.2.2"), totalR2, "0.0.45"));
});

function r2WriteFits(file, r2, id) {
  assert.equal(file.ok, true);
  assert.ok(r2.objects.has(`hcs1/${id}`));
  return true;
}
