// Hashinal (HCS-1) files rebuilt from fake mirror pages: chunk order, the
// memo hash, id checks, the R2 copy, shared rebuilds and the route, and
// the route's limits: the rate-limit key, the rebuild cap, the misses cap.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import express from "express";

import {
  HCS1_CACHE_CONTROL,
  HCS1_CACHE_ITEM_BYTES,
  HCS1_CORP,
  HCS1_CSP,
  HCS1_MAX_BYTES,
  HCS1_MAX_MESSAGES,
  HCS1_MAX_REBUILDS,
  HCS1_MISS_ENTRIES,
  HCS1_R2_TYPES,
  clearHcs1Cache,
  createHcs1Memory,
  createHcs1Misses,
  createHcs1RateLimit,
  decodeHcs1Text,
  getHcs1File,
  hcs1RateKey,
  hcs1Route,
  hcs1ServeType,
  hcs1Storable,
  isHcs1TopicId,
  joinHcs1Messages,
  parseHcs1Memo,
} from "../server/hcs1.js";

const MIRROR = "https://mirror.test";
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// A file inscribed the HCS-1 way: zstd, base64 behind a data: part, cut
// into chunks of `size` characters.
function inscribe(bytes, { mime = "image/png", size = 40, memoHash } = {}) {
  const text = `data:${mime};base64,` + zlib.zstdCompressSync(bytes).toString("base64");
  const chunks = [];
  for (let o = 0, at = 0; at < text.length; o++, at += size) chunks.push({ o, c: text.slice(at, at + size) });
  return { memo: `${memoHash || sha(bytes)}:zstd:base64`, chunks };
}

function row(part, seq) {
  return {
    message: Buffer.from(JSON.stringify(part)).toString("base64"),
    sequence_number: seq,
    consensus_timestamp: `1700000000.${String(seq).padStart(9, "0")}`,
  };
}

// A mirror with one topic: its memo, and its messages in pages of `page`
// that link on with links.next. `order` shuffles what was submitted.
function fakeMirror(topicId, { memo, chunks, extra = [], page = 3, order }) {
  const parts = order ? order.map((i) => chunks[i]) : chunks;
  const rows = [...parts, ...extra].map((part, i) => row(part, i + 1));
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === `/api/v1/topics/${topicId}`) {
      if (memo === null) throw new Error("mirror HTTP 404");
      return { topic_id: topicId, memo };
    }
    if (u.pathname === `/api/v1/topics/${topicId}/messages`) {
      const after = Number((u.searchParams.get("sequencenumber") || "gt:0").slice(3));
      const slice = rows.filter((r) => r.sequence_number > after).slice(0, page);
      const last = slice.length ? slice[slice.length - 1].sequence_number : after;
      const more = rows.some((r) => r.sequence_number > last);
      return {
        messages: slice,
        links: { next: more ? `/api/v1/topics/${topicId}/messages?limit=100&order=asc&sequencenumber=gt:${last}` : null },
      };
    }
    throw new Error("mirror HTTP 404");
  };
  return { fetchJson, calls };
}

// An R2 bucket in a Map, answering the three commands hcs1.js sends. By
// name: server/ loads its own copy of the S3 package, so instanceof differs.
function fakeR2() {
  const objects = new Map();
  const sent = [];
  return {
    objects,
    sent,
    async send(command) {
      sent.push(command.constructor.name);
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
        return { ContentLength: object.Body.length, ContentType: object.ContentType, Metadata: object.Metadata };
      }
      if (kind === "GetObjectCommand") {
        const body = Readable.from([object.Body]);
        body.transformToByteArray = async () => new Uint8Array(object.Body);
        return { Body: body, ContentLength: object.Body.length, ContentType: object.ContentType };
      }
      throw new Error("unexpected command");
    },
  };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  crypto.randomBytes(700),
  Buffer.from("IEND"),
]);

test("topic ids and memos are checked before anything is asked", () => {
  for (const id of ["0.0.4819119", "0.0.1", "0.0.9742046"]) assert.equal(isHcs1TopicId(id), true, id);
  for (const id of ["", "0.0.", "0.0.abc", "1.2.3", "0.1.5", "0.0.5/x", "../0.0.5", " 0.0.5", "0.0.5 ", "0.0.1.2", "0x0.0.5", null, 5, "0.0." + "9".repeat(40)]) {
    assert.equal(isHcs1TopicId(id), false, String(id));
  }
  const hash = "a".repeat(64);
  assert.deepEqual(parseHcs1Memo(`${hash}:zstd:base64`), { sha256: hash });
  assert.deepEqual(parseHcs1Memo(`${hash.toUpperCase()}:zstd:base64`), { sha256: hash });
  for (const memo of ["", "hello", `${hash}:brotli:base64`, `${hash}:zstd:hex`, `${hash.slice(1)}:zstd:base64`, `${hash}:zstd:base64:x`, null]) {
    assert.equal(parseHcs1Memo(memo), null, String(memo));
  }
});

test("chunks out of order are joined by o, decompressed and checked", () => {
  const { memo, chunks } = inscribe(PNG, { size: 25 });
  const shuffled = [...chunks].reverse();
  [shuffled[0], shuffled[3]] = [shuffled[3], shuffled[0]];
  const junk = [{ hello: 1 }, { o: -1, c: "x" }, { o: 1.5, c: "x" }, { o: 2, c: 7 }];
  const rows = [...shuffled, ...junk].map(row);
  rows.push({ message: "not base64 json" });
  // A later chunk claiming a place already taken does not replace it.
  rows.push(row({ o: 0, c: "data:text/html;base64,PHNjcmlwdD4=" }));
  const joined = joinHcs1Messages(rows);
  assert.equal(joined.ok, true);
  const file = decodeHcs1Text(joined.text, parseHcs1Memo(memo).sha256);
  assert.equal(file.ok, true);
  assert.equal(file.mime, "image/png");
  assert.deepEqual(file.bytes, PNG);
  assert.equal(file.sha256, sha(PNG));
  // No data: part: the type is unknown.
  const bare = zlib.zstdCompressSync(PNG).toString("base64");
  assert.equal(decodeHcs1Text(bare, sha(PNG)).mime, "application/octet-stream");
});

test("a file that is not what the memo says is never returned", () => {
  const { chunks } = inscribe(PNG);
  const text = chunks.map((c) => c.c).join("");
  const wrong = decodeHcs1Text(text, "0".repeat(64));
  assert.deepEqual([wrong.ok, wrong.status, wrong.error, wrong.bytes], [false, 422, "hash mismatch", undefined]);
  assert.equal(decodeHcs1Text("data:image/png;base64,@@@", sha(PNG)).status, 422);
  assert.equal(decodeHcs1Text("data:image/png;base64," + Buffer.from("not zstd").toString("base64"), sha(PNG)).status, 422);
  // Past the size cap.
  assert.equal(decodeHcs1Text(text, sha(PNG), { maxBytes: 100 }).status, 413);
  assert.equal(joinHcs1Messages([]).status, 404);
});

test("getHcs1File rebuilds from the mirror, pages included, and keeps it", async () => {
  clearHcs1Cache();
  const topic = "0.0.4819119";
  const { memo, chunks } = inscribe(PNG, { size: 30 });
  const order = chunks.map((_, i) => i).sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13));
  const mirror = fakeMirror(topic, { memo, chunks, order, page: 4 });
  const file = await getHcs1File(topic, { mirrorFetch: mirror.fetchJson, mirror: MIRROR });
  assert.equal(file.ok, true);
  assert.equal(file.source, "mirror");
  assert.deepEqual(file.bytes, PNG);
  assert.equal(file.mime, "image/png");
  assert.equal(file.sha256, sha(PNG));
  // Topic info, then every page by links.next.
  assert.equal(mirror.calls[0], `${MIRROR}/api/v1/topics/${topic}`);
  assert.equal(mirror.calls[1], `${MIRROR}/api/v1/topics/${topic}/messages?limit=100&order=asc`);
  assert.equal(mirror.calls.length, 1 + Math.ceil(chunks.length / 4));
  const before = mirror.calls.length;
  const again = await getHcs1File(topic, { mirrorFetch: mirror.fetchJson, mirror: MIRROR });
  assert.equal(again.source, "memory");
  assert.equal(mirror.calls.length, before);
});

test("two requests while a topic rebuilds share one rebuild", async () => {
  clearHcs1Cache();
  const topic = "0.0.700";
  const { memo, chunks } = inscribe(PNG);
  const mirror = fakeMirror(topic, { memo, chunks, page: 100 });
  const [a, b] = await Promise.all([
    getHcs1File(topic, { mirrorFetch: mirror.fetchJson, mirror: MIRROR }),
    getHcs1File(topic, { mirrorFetch: mirror.fetchJson, mirror: MIRROR }),
  ]);
  assert.equal(a, b);
  assert.equal(mirror.calls.length, 2);
});

test("a rebuilt file is stored in R2 once and read from there next time", async () => {
  clearHcs1Cache();
  const topic = "0.0.9742046";
  const glb = Buffer.concat([Buffer.from("glTF"), crypto.randomBytes(2000)]);
  const { memo, chunks } = inscribe(glb, { mime: "model/gltf-binary", size: 200 });
  const mirror = fakeMirror(topic, { memo, chunks, page: 5 });
  const r2 = fakeR2();
  const opts = { mirrorFetch: mirror.fetchJson, mirror: MIRROR, s3: r2, bucket: "bucket" };
  const first = await getHcs1File(topic, opts);
  assert.equal(first.source, "mirror");
  const stored = r2.objects.get(`hcs1/${topic}`);
  assert.ok(stored);
  assert.deepEqual(stored.Body, glb);
  assert.equal(stored.Bucket, "bucket");
  assert.equal(stored.ContentType, "model/gltf-binary");
  assert.equal(stored.CacheControl, "public, max-age=31536000, immutable");
  assert.deepEqual(stored.Metadata, { sha256: sha(glb), mime: "model/gltf-binary" });
  // A fresh process: memory is empty, R2 answers, the mirror is not asked.
  clearHcs1Cache();
  const calls = mirror.calls.length;
  const second = await getHcs1File(topic, opts);
  assert.equal(second.source, "r2");
  assert.deepEqual(second.bytes, glb);
  assert.equal(second.sha256, sha(glb));
  assert.equal(mirror.calls.length, calls);
  assert.deepEqual(r2.sent.slice(-2), ["HeadObjectCommand", "GetObjectCommand"]);
  // An R2 copy that does not match its hash is not served; it is rebuilt.
  clearHcs1Cache();
  r2.objects.get(`hcs1/${topic}`).Body = Buffer.from("tampered");
  const third = await getHcs1File(topic, opts);
  assert.equal(third.source, "mirror");
  assert.deepEqual(third.bytes, glb);
});

test("only pictures (not SVG), video, sound and glTF are sent as their own type", () => {
  const inline = [
    "image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "image/x-icon",
    "video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/wav",
    "model/gltf-binary", "model/gltf+json",
  ];
  for (const type of inline) assert.deepEqual(hcs1ServeType(type), { contentType: type, attachment: false }, type);
  assert.deepEqual(hcs1ServeType(" IMAGE/PNG "), { contentType: "image/png", attachment: false });
  const download = { contentType: "application/octet-stream", attachment: true };
  const downloads = [
    "image/svg+xml", "image/foo+xml", "text/html", "text/plain", "text/javascript", "text/css", "text/xml",
    "application/javascript", "application/json", "application/xhtml+xml", "application/xml",
    "application/pdf", "application/wasm", "model/obj", "application/octet-stream",
    "nonsense", "", undefined, null,
  ];
  for (const type of downloads) assert.deepEqual(hcs1ServeType(type), download, String(type));
});

test("a download type stored in R2 keeps its download headers", async () => {
  clearHcs1Cache();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const { memo, chunks } = inscribe(svg, { mime: "image/svg+xml" });
  const mirror = fakeMirror("0.0.801", { memo, chunks, page: 100 });
  const r2 = fakeR2();
  await getHcs1File("0.0.801", { mirrorFetch: mirror.fetchJson, mirror: MIRROR, s3: r2, bucket: "b", storeTypes: ["image/svg+xml"] });
  const stored = r2.objects.get("hcs1/0.0.801");
  assert.equal(stored.ContentType, "application/octet-stream");
  assert.equal(stored.ContentDisposition, 'attachment; filename="0.0.801"');
  assert.equal(stored.Metadata.mime, "image/svg+xml");
});

test("the R2 list is pictures, video, sound and glTF, never SVG, text, JS or HTML", () => {
  assert.deepEqual([...HCS1_R2_TYPES].sort(), [
    "audio/mpeg", "audio/ogg", "audio/wav",
    "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp",
    "model/gltf+json", "model/gltf-binary",
    "video/mp4", "video/webm",
  ]);
  for (const type of HCS1_R2_TYPES) {
    assert.equal(type, type.toLowerCase(), type);
    assert.equal(type.startsWith("text/"), false, type);
    assert.equal(/svg|html|javascript|ecmascript/.test(type), false, type);
    // Everything kept is also sent as itself.
    assert.equal(hcs1ServeType(type).attachment, false, type);
  }
  for (const type of ["image/svg+xml", "text/html", "text/plain", "text/javascript", "application/javascript", "application/xhtml+xml"]) {
    assert.equal(hcs1Storable(type), false, type);
  }
  assert.equal(hcs1Storable("image/png", new Set(["image/png"])), true);
  assert.equal(hcs1Storable(" IMAGE/PNG ", new Set(["image/png"])), true);
  assert.equal(hcs1Storable("text/html", new Set(["image/png"])), false);
  assert.equal(hcs1Storable("", new Set([""])), false);
  assert.equal(hcs1Storable(undefined, new Set(["image/png"])), false);
});

test("a rebuilt file is saved to R2 only when its type is on the list", async () => {
  clearHcs1Cache();
  const r2 = fakeR2();
  const files = {
    "0.0.802": { bytes: Buffer.from("<script>alert(1)</script>"), mime: "text/html" },
    "0.0.803": { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), mime: "image/svg+xml" },
    "0.0.804": { bytes: Buffer.from("alert(1)"), mime: "application/javascript" },
    "0.0.805": { bytes: PNG, mime: "image/png" },
  };
  for (const [id, { bytes, mime }] of Object.entries(files)) {
    const mirror = fakeMirror(id, { ...inscribe(bytes, { mime }), page: 100 });
    // The list in hcs1.js, not one passed in.
    const file = await getHcs1File(id, { mirrorFetch: mirror.fetchJson, mirror: MIRROR, s3: r2, bucket: "b" });
    // Each is still served (the route sends the first three as downloads).
    assert.equal(file.ok, true, id);
    assert.deepEqual(file.bytes, bytes, id);
  }
  assert.deepEqual([...r2.objects.keys()], ["hcs1/0.0.805"]);
  assert.equal(r2.objects.get("hcs1/0.0.805").ContentType, "image/png");
});

test("bad ids, missing files, mismatches, caps and rate limits", async () => {
  clearHcs1Cache();
  let asked = 0;
  const never = async () => { asked += 1; return {}; };
  assert.equal((await getHcs1File("0.0.abc", { mirrorFetch: never })).status, 400);
  assert.equal((await getHcs1File("../etc/passwd", { mirrorFetch: never })).status, 400);
  assert.equal(asked, 0);

  const { memo, chunks } = inscribe(PNG);
  const notHcs1 = fakeMirror("0.0.901", { memo: "just a topic", chunks });
  assert.equal((await getHcs1File("0.0.901", { mirrorFetch: notHcs1.fetchJson, mirror: MIRROR })).status, 404);
  const gone = fakeMirror("0.0.902", { memo: null, chunks });
  assert.equal((await getHcs1File("0.0.902", { mirrorFetch: gone.fetchJson, mirror: MIRROR })).status, 404);
  const empty = fakeMirror("0.0.903", { memo, chunks: [] });
  assert.equal((await getHcs1File("0.0.903", { mirrorFetch: empty.fetchJson, mirror: MIRROR })).status, 404);

  const wrong = fakeMirror("0.0.904", { memo: `${"1".repeat(64)}:zstd:base64`, chunks });
  const mismatch = await getHcs1File("0.0.904", { mirrorFetch: wrong.fetchJson, mirror: MIRROR });
  assert.deepEqual([mismatch.ok, mismatch.status, mismatch.bytes], [false, 422, undefined]);
  // Remembered for a while: the mirror is not asked again.
  const calls = wrong.calls.length;
  assert.equal((await getHcs1File("0.0.904", { mirrorFetch: wrong.fetchJson, mirror: MIRROR })).status, 422);
  assert.equal(wrong.calls.length, calls);

  const many = fakeMirror("0.0.905", { memo, chunks, page: 2 });
  assert.equal((await getHcs1File("0.0.905", { mirrorFetch: many.fetchJson, mirror: MIRROR, maxMessages: 3 })).status, 413);
  const big = fakeMirror("0.0.906", { memo, chunks, page: 100 });
  assert.equal((await getHcs1File("0.0.906", { mirrorFetch: big.fetchJson, mirror: MIRROR, maxBytes: 64 })).status, 413);

  const limited = async () => { const err = new Error("mirror 429"); err.rateLimited = true; throw err; };
  const slow = await getHcs1File("0.0.907", { mirrorFetch: limited, mirror: MIRROR });
  assert.deepEqual([slow.status, slow.retryAfter > 0], [502, true]);
  // A rate limit is not remembered: the next request asks again.
  const ok = fakeMirror("0.0.907", { memo, chunks, page: 100 });
  assert.equal((await getHcs1File("0.0.907", { mirrorFetch: ok.fetchJson, mirror: MIRROR })).ok, true);
});

test("the memory cache is capped by entries and bytes", () => {
  const lru = createHcs1Memory({ maxEntries: 2, maxBytes: 10 });
  const entry = (n) => ({ bytes: Buffer.alloc(n), mime: "image/png", sha256: "x", size: n });
  lru.set("a", entry(4));
  lru.set("b", entry(4));
  lru.get("a");
  lru.set("c", entry(4));
  assert.equal(lru.get("b"), null);
  assert.ok(lru.get("a"));
  lru.set("d", entry(9));
  assert.equal(lru.size, 1);
  assert.equal(lru.bytes, 9);
});

// An Express-like response that records what was sent.
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

test("the rate limit is one budget per client IP for the whole route", () => {
  assert.equal(hcs1RateKey("203.0.113.7"), "203.0.113.7 /api/hcs1");
  // The key never carries the topic, whatever the request path.
  assert.equal(hcs1RateKey("::1"), "::1 /api/hcs1");
  assert.equal(hcs1RateKey(undefined), "unknown /api/hcs1");

  let at = 1_000_000;
  const limit = createHcs1RateLimit({ clientIp: (req) => req.ip, max: 3, windowMs: 60_000, now: () => at });
  const ask = (ip, topic) => {
    const req = { ip, path: `/api/hcs1/${topic}`, params: { topicId: topic } };
    const res = fakeRes();
    let passed = false;
    limit(req, res, () => { passed = true; });
    return { passed, res };
  };
  // Three different topics from one IP spend one budget of three.
  assert.equal(ask("198.51.100.1", "0.0.1").passed, true);
  assert.equal(ask("198.51.100.1", "0.0.2").passed, true);
  assert.equal(ask("198.51.100.1", "0.0.3").passed, true);
  const blocked = ask("198.51.100.1", "0.0.4");
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.deepEqual(blocked.res.body, { ok: false, error: "rate limit" });
  assert.equal(blocked.res.headers["retry-after"], "60");
  assert.equal(blocked.res.headers["cache-control"], "no-store");
  // Another IP has its own budget.
  assert.equal(ask("198.51.100.2", "0.0.4").passed, true);
  // A new window, a new budget.
  at += 60_000;
  assert.equal(ask("198.51.100.1", "0.0.4").passed, true);
  // Its own counters: a second limiter starts from zero.
  const other = createHcs1RateLimit({ clientIp: (req) => req.ip, max: 1, now: () => at });
  let passed = false;
  other({ ip: "198.51.100.1", path: "/api/hcs1/0.0.1" }, fakeRes(), () => { passed = true; });
  assert.equal(passed, true);
});

test("past two rebuilds at once the answer is 503 busy with Retry-After, not remembered", async () => {
  clearHcs1Cache();
  assert.equal(HCS1_MAX_REBUILDS, 2);
  // Mirrors for four topics; 601 and 602 hang until released.
  const held = [];
  const mirrors = {};
  for (const id of ["0.0.601", "0.0.602", "0.0.603", "0.0.604"]) {
    const { memo, chunks } = inscribe(PNG);
    const real = fakeMirror(id, { memo, chunks, page: 100 });
    let release = () => {};
    const hangs = id === "0.0.601" || id === "0.0.602";
    const gate = hangs ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
    if (hangs) held.push(release);
    mirrors[id] = { calls: real.calls, fetchJson: async (url) => { await gate; return real.fetchJson(url); } };
  }
  const mirrorFetch = (url) => mirrors[/topics\/(0\.0\.\d+)/.exec(url)[1]].fetchJson(url);
  const opts = { mirrorFetch, mirror: MIRROR };
  // One file the app already has, in memory.
  assert.equal((await getHcs1File("0.0.604", opts)).source, "mirror");

  const first = getHcs1File("0.0.601", opts);
  const second = getHcs1File("0.0.602", opts);
  const busy = await getHcs1File("0.0.603", opts);
  assert.deepEqual([busy.ok, busy.status, busy.error], [false, 503, "busy"]);
  assert.ok(busy.retryAfter > 0);
  // Busy before asking the mirror at all.
  assert.equal(mirrors["0.0.603"].calls.length, 0);

  // Through the route: 503, Retry-After the app can read, not cached.
  const res = fakeRes();
  await hcs1Route(opts)({ params: { topicId: "0.0.603" }, headers: {}, method: "GET" }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: "busy" });
  assert.equal(res.headers["retry-after"], String(busy.retryAfter));
  assert.equal(res.headers["access-control-expose-headers"], "Retry-After");
  assert.equal(res.headers["cache-control"], "no-store");

  // A file already in memory is still served while the rebuilds run.
  const known = await getHcs1File("0.0.604", opts);
  assert.deepEqual([known.ok, known.source], [true, "memory"]);

  for (const release of held) release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok && b.ok, true);
  // The two places are free again, and the busy answer was not kept.
  const later = await getHcs1File("0.0.603", opts);
  assert.equal(later.ok, true);
  assert.equal(later.source, "mirror");
});

test("the misses map holds at most its cap, the oldest dropped first", async () => {
  assert.equal(HCS1_MISS_ENTRIES, 5000);
  const misses = createHcs1Misses({ maxEntries: 3 });
  for (const id of ["a", "b", "c", "d"]) misses.set(id, { until: 1, result: { status: 404 } });
  assert.equal(misses.size, 3);
  assert.equal(misses.get("a"), null);
  assert.ok(misses.get("b") && misses.get("c") && misses.get("d"));
  // Set again, a miss is new: the oldest is now c.
  misses.set("b", { until: 2, result: { status: 404 } });
  misses.set("e", { until: 2, result: { status: 404 } });
  assert.equal(misses.get("c"), null);
  assert.deepEqual(["b", "d", "e"].map((id) => !!misses.get(id)), [true, true, true]);
  assert.equal(misses.size, 3);

  // The process's own map: past 5000 misses the first is asked about again.
  clearHcs1Cache();
  const asked = new Map();
  const notHcs1 = async (url) => {
    const id = /topics\/(0\.0\.\d+)/.exec(url)[1];
    asked.set(id, (asked.get(id) || 0) + 1);
    return { topic_id: id, memo: "just a topic" };
  };
  const opts = { mirrorFetch: notHcs1, mirror: MIRROR };
  for (let n = 1; n <= HCS1_MISS_ENTRIES + 1; n++) {
    assert.equal((await getHcs1File(`0.0.${100000 + n}`, opts)).status, 404);
  }
  // The newest is still remembered; the oldest was dropped and is asked again.
  await getHcs1File(`0.0.${100000 + HCS1_MISS_ENTRIES + 1}`, opts);
  assert.equal(asked.get(`0.0.${100000 + HCS1_MISS_ENTRIES + 1}`), 1);
  await getHcs1File("0.0.100001", opts);
  assert.equal(asked.get("0.0.100001"), 2);
  clearHcs1Cache();
});

test("the rebuild caps are about 10 MB and 12000 messages", () => {
  assert.equal(HCS1_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(HCS1_MAX_MESSAGES, 12000);
  // One HCS message holds at most about 1 KB: the message cap lets the
  // byte cap's worth of messages through.
  assert.ok(HCS1_MAX_MESSAGES * 1024 >= HCS1_MAX_BYTES);
});

// 0.0.4841271 is a real Hashinal of 3931 messages, about 4 MB. With the
// message cap at 2000 the route answered it 413 and remembered the miss.
test("a 3931-message Hashinal under 10 MB is rebuilt and served, not refused with 413", async () => {
  clearHcs1Cache();
  const topic = "0.0.4841271";
  const MESSAGES = 3931;
  // Random bytes do not compress, so the file stays about 3 MB.
  const file = Buffer.concat([PNG.subarray(0, 8), crypto.randomBytes(2_900_000)]);
  const text = "data:image/png;base64," + zlib.zstdCompressSync(file).toString("base64");
  // One chunk per message, the way an inscriber cuts it: just under 1 KB each.
  const chunks = [];
  for (let o = 0; o < MESSAGES; o++) {
    chunks.push({ o, c: text.slice(Math.floor((o * text.length) / MESSAGES), Math.floor(((o + 1) * text.length) / MESSAGES)) });
  }
  assert.ok(chunks.every((part) => part.c.length > 0 && part.c.length < 1024));
  assert.ok(file.length < HCS1_MAX_BYTES);
  assert.ok(MESSAGES > 2000 && MESSAGES <= HCS1_MAX_MESSAGES);
  const mirror = fakeMirror(topic, { memo: `${sha(file)}:zstd:base64`, chunks, page: 100 });

  const app = express();
  app.get("/api/hcs1/:topicId", hcs1Route({ mirrorFetch: mirror.fetchJson, mirror: MIRROR }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/hcs1/${topic}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), file);
    // Every page was read: topic info plus 40 pages of 100.
    assert.equal(mirror.calls.length, 1 + Math.ceil(MESSAGES / 100));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    clearHcs1Cache();
  }
});

test("GET /api/hcs1/:topicId serves the file with its type, hash ETag and statuses", async () => {
  clearHcs1Cache();
  const { memo, chunks } = inscribe(PNG, { size: 50 });
  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
  const svgInscription = inscribe(svg, { mime: "image/svg+xml" });
  const mirrors = {
    "0.0.4819119": fakeMirror("0.0.4819119", { memo, chunks, page: 3 }),
    "0.0.811": fakeMirror("0.0.811", svgInscription),
    "0.0.812": fakeMirror("0.0.812", { memo: `${"2".repeat(64)}:zstd:base64`, chunks }),
    "0.0.813": fakeMirror("0.0.813", { memo: "plain", chunks }),
  };
  const mirrorFetch = async (url) => {
    if (url.includes("0.0.814")) { const err = new Error("mirror 429"); err.rateLimited = true; throw err; }
    const id = /topics\/(0\.0\.\d+)/.exec(url)[1];
    return mirrors[id].fetchJson(url);
  };
  const app = express();
  app.get("/api/hcs1/:topicId", hcs1Route({ mirrorFetch, mirror: MIRROR }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/hcs1`;
    const res = await fetch(`${base}/0.0.4819119`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cache-control"), HCS1_CACHE_CONTROL);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("etag"), `"${sha(PNG)}"`);
    assert.equal(res.headers.get("content-disposition"), null);
    assertFileHeaders(res, "GET");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);

    const cached = await fetch(`${base}/0.0.4819119`, { headers: { "If-None-Match": `"${sha(PNG)}"` } });
    assert.equal(cached.status, 304);
    assertFileHeaders(cached, "304");

    const head = await fetch(`${base}/0.0.4819119`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(PNG.length));
    assertFileHeaders(head, "HEAD");

    const download = await fetch(`${base}/0.0.811`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
    assert.equal(download.headers.get("content-disposition"), 'attachment; filename="0.0.811"');
    assertFileHeaders(download, "download");
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), svg);

    const errors = [
      [await fetch(`${base}/0.0.bad`), 400],
      [await fetch(`${base}/0.0.812`), 422],
      [await fetch(`${base}/0.0.813`), 404],
    ];
    for (const [answer, status] of errors) {
      assert.equal(answer.status, status);
      // Only a file answer carries the file headers.
      assert.equal(answer.headers.get("content-security-policy"), null, String(status));
      assert.equal(answer.headers.get("cross-origin-resource-policy"), null, String(status));
    }
    const limited = await fetch(`${base}/0.0.814`);
    assert.equal(limited.status, 502);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(limited.headers.get("cache-control"), "no-store");
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

// The headers every file answer carries: sandboxed with nothing allowed if
// opened as a page, and loadable from other origins.
function assertFileHeaders(res, label) {
  assert.equal(res.headers.get("content-security-policy"), "sandbox; default-src 'none'", label);
  assert.equal(HCS1_CSP, "sandbox; default-src 'none'");
  assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin", label);
  assert.equal(HCS1_CORP, "cross-origin");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", label);
}

test("a big file streamed from R2 carries the same headers", async () => {
  clearHcs1Cache();
  const topic = "0.0.820";
  const big = Buffer.alloc(HCS1_CACHE_ITEM_BYTES + 1, 7);
  const r2 = fakeR2();
  r2.objects.set(`hcs1/${topic}`, { Body: big, ContentType: "video/mp4", Metadata: { sha256: sha(big), mime: "video/mp4" } });
  const never = async () => { throw new Error("the mirror is not asked"); };
  const app = express();
  // Past the memory item size, so it streams; within this test's own cap.
  app.get("/api/hcs1/:topicId", hcs1Route({ mirrorFetch: never, mirror: MIRROR, s3: r2, bucket: "b", maxBytes: 2 * HCS1_CACHE_ITEM_BYTES }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/hcs1/${topic}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "video/mp4");
    assert.equal(res.headers.get("content-length"), String(big.length));
    assertFileHeaders(res, "stream");
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.length, big.length);
    assert.equal(sha(body), sha(big));
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
