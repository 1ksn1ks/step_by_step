// Hashinal (HCS-1) files rebuilt from fake mirror pages: chunk order, the
// memo hash, id checks, the R2 copy, shared rebuilds and the route.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import express from "express";

import {
  HCS1_CACHE_CONTROL,
  clearHcs1Cache,
  createHcs1Memory,
  decodeHcs1Text,
  getHcs1File,
  hcs1Route,
  hcs1ServeType,
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

test("HTML and SVG are stored and sent as downloads", async () => {
  assert.deepEqual(hcs1ServeType("text/html"), { contentType: "application/octet-stream", attachment: true });
  assert.deepEqual(hcs1ServeType("image/svg+xml"), { contentType: "application/octet-stream", attachment: true });
  assert.deepEqual(hcs1ServeType("application/xml"), { contentType: "application/octet-stream", attachment: true });
  assert.deepEqual(hcs1ServeType("nonsense"), { contentType: "application/octet-stream", attachment: true });
  assert.deepEqual(hcs1ServeType("image/png"), { contentType: "image/png", attachment: false });
  assert.deepEqual(hcs1ServeType("model/gltf-binary"), { contentType: "model/gltf-binary", attachment: false });
  clearHcs1Cache();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const { memo, chunks } = inscribe(svg, { mime: "image/svg+xml" });
  const mirror = fakeMirror("0.0.801", { memo, chunks, page: 100 });
  const r2 = fakeR2();
  await getHcs1File("0.0.801", { mirrorFetch: mirror.fetchJson, mirror: MIRROR, s3: r2, bucket: "b" });
  const stored = r2.objects.get("hcs1/0.0.801");
  assert.equal(stored.ContentType, "application/octet-stream");
  assert.equal(stored.ContentDisposition, 'attachment; filename="0.0.801"');
  assert.equal(stored.Metadata.mime, "image/svg+xml");
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
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);

    const cached = await fetch(`${base}/0.0.4819119`, { headers: { "If-None-Match": `"${sha(PNG)}"` } });
    assert.equal(cached.status, 304);

    const head = await fetch(`${base}/0.0.4819119`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(PNG.length));

    const download = await fetch(`${base}/0.0.811`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
    assert.equal(download.headers.get("content-disposition"), 'attachment; filename="0.0.811"');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), svg);

    assert.equal((await fetch(`${base}/0.0.bad`)).status, 400);
    assert.equal((await fetch(`${base}/0.0.812`)).status, 422);
    assert.equal((await fetch(`${base}/0.0.813`)).status, 404);
    const limited = await fetch(`${base}/0.0.814`);
    assert.equal(limited.status, 502);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(limited.headers.get("cache-control"), "no-store");
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
