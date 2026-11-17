// Profile picture thumbnails (server/avatar.js): one small WebP per
// picture, made once and kept in R2; a GIF is its first frame; private
// addresses are never fetched; a failure is an error answer the page falls
// back from (avatar-src.test.mjs covers the page side).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import express from "express";
import sharp from "sharp";

import {
  AVATAR_CACHE_CONTROL,
  AVATAR_CORP,
  AVATAR_CSP,
  AVATAR_EDGE,
  avatarKey,
  avatarRoute,
  checkSourceUrl,
  clearAvatarCache,
  createAvatarRateLimit,
  fetchAvatarSource,
  getAvatarThumb,
  isBlockedAddress,
  makeAvatarThumb,
} from "../server/avatar.js";
import { clearHcs1Cache } from "../server/hcs1.js";
import { ipfsGatewayUrls } from "../ipfsimage.js";

const solid = (width, height, color, format = "png") => {
  const channels = format === "jpeg" ? 3 : 4;
  const background = channels === 3 ? { r: color[0], g: color[1], b: color[2] } : { r: color[0], g: color[1], b: color[2], alpha: color[3] ?? 1 };
  const image = sharp({ create: { width, height, channels, background } });
  return format === "jpeg" ? image.jpeg({ quality: 90 }).toBuffer() : image.png().toBuffer();
};

async function pixel(bytes, x, y) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * 4;
  return [...data.subarray(at, at + 4)];
}

const near = (actual, expected, slack = 24) => actual.every((v, i) => Math.abs(v - expected[i]) <= slack);

// An R2 bucket in a Map, answering the three commands avatar.js sends.
function fakeR2() {
  const objects = new Map();
  const sent = [];
  return {
    objects,
    sent,
    async send(command) {
      const kind = command.constructor.name;
      sent.push(kind);
      const { Key } = command.input;
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
      if (kind === "HeadObjectCommand") return { ContentLength: object.Body.length, ContentType: object.ContentType };
      const body = Readable.from([object.Body]);
      body.transformToByteArray = async () => new Uint8Array(object.Body);
      return { Body: body };
    },
  };
}

// A fake source: each URL answers bytes, or throws.
function fakeSource(map) {
  const asked = [];
  const fetchSource = async (url) => {
    asked.push(url);
    const answer = map[url];
    if (answer === undefined) throw Object.assign(new Error("not in the fake"), { status: 404 });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetchSource, asked };
}

async function serve(app) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("a 4000 px photo becomes one 384 px WebP, made once, kept in R2, served immutable", async () => {
  clearAvatarCache();
  const src = "https://cdn.example/me.jpg";
  const big = await solid(4000, 4000, [200, 30, 30], "jpeg");
  const source = fakeSource({ [src]: big });
  const r2 = fakeR2();
  const app = express();
  app.get("/api/avatar.webp", avatarRoute({ fetchSource: source.fetchSource, s3: r2, bucket: "b" }));
  const { base, close } = await serve(app);
  try {
    const url = `${base}/api/avatar.webp?src=${encodeURIComponent(src)}&v=1`;
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/webp");
    assert.equal(res.headers.get("cache-control"), AVATAR_CACHE_CONTROL);
    assert.equal(res.headers.get("cross-origin-resource-policy"), AVATAR_CORP);
    assert.equal(res.headers.get("content-security-policy"), AVATAR_CSP);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const body = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(body).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["webp", AVATAR_EDGE, AVATAR_EDGE]);
    assert.ok(body.length < 20 * 1024, `thumbnail is ${body.length} bytes`);
    assert.ok(near(await pixel(body, 100, 100), [200, 30, 30, 255]));
    // Kept in R2 under the source's hash.
    assert.equal(r2.objects.size, 1);
    const stored = r2.objects.get(avatarKey(src));
    assert.ok(stored);
    assert.equal(stored.ContentType, "image/webp");
    assert.equal(stored.CacheControl, AVATAR_CACHE_CONTROL);
    // The ETag revalidates.
    const again = await fetch(url, { headers: { "If-None-Match": res.headers.get("etag") } });
    assert.equal(again.status, 304);
    // Memory, then R2: the source is not asked again.
    clearAvatarCache();
    const fromR2 = await getAvatarThumb(src, { fetchSource: source.fetchSource, s3: r2, bucket: "b" });
    assert.equal(fromR2.from, "r2");
    assert.deepEqual(fromR2.bytes, body);
    assert.equal(source.asked.length, 1);
  } finally {
    await close();
    clearAvatarCache();
  }
});

test("an animated GIF becomes a still of its first frame", async () => {
  clearAvatarCache();
  const red = await solid(800, 800, [255, 0, 0]);
  const blue = await solid(800, 800, [0, 0, 255]);
  const gif = await sharp([red, blue], { join: { animated: true } }).gif({ delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 2);
  const src = "https://cdn.example/dance.gif";
  const thumb = await getAvatarThumb(src, { fetchSource: fakeSource({ [src]: gif }).fetchSource });
  assert.equal(thumb.ok, true);
  const meta = await sharp(thumb.bytes, { animated: true }).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.pages || 1, 1);
  assert.deepEqual([meta.width, meta.height], [AVATAR_EDGE, AVATAR_EDGE]);
  assert.ok(near(await pixel(thumb.bytes, 192, 192), [255, 0, 0, 255]));
  clearAvatarCache();
});

test("the thumbnail shows what the page showed: upright, the centre square, transparency kept, never enlarged", async () => {
  // Stored sideways (EXIF 6): left half red, right half blue. Shown upright
  // the red half is on top.
  const halves = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .composite([{ input: await solid(100, 100, [0, 0, 255], "jpeg"), left: 100, top: 0 }])
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const upright = await makeAvatarThumb(halves);
  const meta = await sharp(upright).metadata();
  assert.deepEqual([meta.width, meta.height], [100, 100]);
  assert.ok(near(await pixel(upright, 50, 10), [255, 0, 0, 255]), "top is red");
  assert.ok(near(await pixel(upright, 50, 90), [0, 0, 255, 255]), "bottom is blue");

  const clear = await makeAvatarThumb(await solid(600, 600, [0, 0, 0, 0]));
  assert.equal((await pixel(clear, 10, 10))[3], 0, "transparent stays transparent");

  const small = await makeAvatarThumb(await solid(120, 80, [10, 200, 10]));
  const smallMeta = await sharp(small).metadata();
  assert.deepEqual([smallMeta.width, smallMeta.height], [80, 80]);
});

test("private, loopback and link-local sources are never fetched", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.20", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12::3", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::", "not an ip"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }

  // Refused before anything is fetched: the source fake is never asked.
  clearAvatarCache();
  const source = fakeSource({});
  for (const src of ["http://127.0.0.1/a.png", "http://10.0.0.1/a.png", "http://169.254.169.254/latest/meta-data",
    "http://[::1]/a.png", "http://[::ffff:127.0.0.1]/a.png", "http://2130706433/a.png", "http://0177.0.0.1/a.png",
    "https://cdn.example:8443/a.png"]) {
    const result = await getAvatarThumb(src, { fetchSource: source.fetchSource });
    assert.equal(result.status, 403, src);
  }
  for (const src of ["ftp://cdn.example/a.png", "file:///etc/passwd", "javascript:alert(1)", "",
    "http://user:pass@cdn.example/a.png"]) {
    assert.equal((await getAvatarThumb(src, { fetchSource: source.fetchSource })).status, 400, src);
  }
  assert.equal(source.asked.length, 0);

  // A name is checked when it resolves: localhost, and a name pointed at a
  // private address, never connect.
  assert.equal((await getAvatarThumb("http://localhost/a.png")).status, 403);
  const privateName = (hostname, options, callback) => callback(null, [{ address: "192.168.1.20", family: 4 }]);
  assert.equal((await getAvatarThumb("http://pics.example/a.png", { lookup: privateName })).status, 403);
  const mixed = (hostname, options, callback) => callback(null, [{ address: "93.184.216.34", family: 4 }, { address: "::ffff:127.0.0.1", family: 6 }]);
  assert.equal((await getAvatarThumb("http://pics2.example/a.png", { lookup: mixed })).status, 403);
  clearAvatarCache();
});

test("each redirect is checked again, and a source over 10 MB is refused", async () => {
  let inner = "";
  const server = http.createServer((req, res) => {
    if (req.url === "/to-literal") {
      res.writeHead(302, { Location: "http://10.0.0.5/a.png" });
      return res.end();
    }
    if (req.url === "/to-name") {
      res.writeHead(302, { Location: inner });
      return res.end();
    }
    if (req.url === "/big") {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(11 * 1024 * 1024) });
      return res.end();
    }
    if (req.url === "/big-stream") {
      res.writeHead(200, { "Content-Type": "image/png" });
      const chunk = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < 11; i++) res.write(chunk);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = String(server.address().port);
  inner = `http://inner.example:${port}/a.png`;
  // start.example is this test server (allowed only for this name);
  // inner.example resolves to a private address.
  const lookup = (hostname, options, callback) => callback(null, [{ address: hostname === "start.example" ? "127.0.0.1" : "192.168.0.9", family: 4 }]);
  const opts = {
    lookup,
    isBlocked: (ip, host) => (host === "start.example" ? false : isBlockedAddress(ip)),
    ports: ["", "80", "443", port],
  };
  try {
    await assert.rejects(fetchAvatarSource(`http://start.example:${port}/to-literal`, opts), (err) => err.status === 403);
    await assert.rejects(fetchAvatarSource(`http://start.example:${port}/to-name`, opts), (err) => err.status === 403);
    await assert.rejects(fetchAvatarSource(`http://start.example:${port}/big`, opts), (err) => err.status === 413);
    await assert.rejects(fetchAvatarSource(`http://start.example:${port}/big-stream`, opts), (err) => err.status === 413);
    await assert.rejects(fetchAvatarSource(`http://start.example:${port}/missing`, opts), (err) => err.status === 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.throws(() => checkSourceUrl("http://cdn.example:22/a.png"), (err) => err.status === 403);
});

test("a source that is missing or not a picture is an error answer, remembered; one that is down is asked again", async () => {
  clearAvatarCache();
  const html = "https://cdn.example/page.html";
  const down = "https://cdn.example/down.png";
  const missing = "https://cdn.example/gone.png";
  const source = fakeSource({ [html]: Buffer.from("<html>not a picture</html>"), [down]: new Error("connection reset") });
  const sources = {
    fetchSource: async (url) => {
      if (url === missing) {
        source.asked.push(url);
        const { fetchAvatarSource: real } = await import("../server/avatar.js");
        // A 404 the way the real fetch reports it.
        return real(url, { lookup: (h, o, cb) => cb(Object.assign(new Error("nx"), { code: "ENOTFOUND" })) });
      }
      return source.fetchSource(url);
    },
  };
  const first = await getAvatarThumb(html, sources);
  assert.deepEqual([first.ok, first.status], [false, 415]);
  assert.equal((await getAvatarThumb(html, sources)).status, 415);
  assert.equal(source.asked.filter((url) => url === html).length, 1, "a picture that is not one is not fetched again");

  assert.equal((await getAvatarThumb(missing, sources)).status, 404);
  assert.equal((await getAvatarThumb(missing, sources)).status, 404);
  assert.equal(source.asked.filter((url) => url === missing).length, 1);

  const flaky = await getAvatarThumb(down, sources);
  assert.equal(flaky.status, 502);
  assert.ok(flaky.retryAfter > 0);
  await getAvatarThumb(down, sources);
  assert.equal(source.asked.filter((url) => url === down).length, 2, "a source that is down is asked again");

  // The route answers an error the page falls back from, never cached.
  const app = express();
  app.get("/api/avatar.webp", avatarRoute(sources));
  const { base, close } = await serve(app);
  try {
    const res = await fetch(`${base}/api/avatar.webp?src=${encodeURIComponent(html)}&v=1`);
    assert.equal(res.status, 415);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("content-type").startsWith("application/json"), true);
    const blocked = await fetch(`${base}/api/avatar.webp?src=${encodeURIComponent("http://127.0.0.1/a.png")}&v=1`);
    assert.equal(blocked.status, 403);
  } finally {
    await close();
    clearAvatarCache();
  }
});

// A file inscribed the HCS-1 way (zstd, base64 behind a data: part), on a
// fake mirror, as scripts/hcs1.test.mjs builds one.
function fakeHashinal(topicId, bytes) {
  const text = "data:image/png;base64," + zlib.zstdCompressSync(bytes).toString("base64");
  const rows = [];
  for (let o = 0, at = 0; at < text.length; o++, at += 900) {
    rows.push({ message: Buffer.from(JSON.stringify({ o, c: text.slice(at, at + 900) })).toString("base64"), sequence_number: o + 1 });
  }
  const memo = `${crypto.createHash("sha256").update(bytes).digest("hex")}:zstd:base64`;
  return async (url) => {
    const u = new URL(url);
    if (u.pathname === `/api/v1/topics/${topicId}`) return { topic_id: topicId, memo };
    if (u.pathname === `/api/v1/topics/${topicId}/messages`) return { messages: rows, links: { next: null } };
    throw new Error("mirror HTTP 404");
  };
}

test("a Hashinal is read through the hcs1 code, whatever link names it", async () => {
  clearAvatarCache();
  clearHcs1Cache();
  const topic = "0.0.4840719";
  const png = await solid(1000, 1000, [20, 160, 220]);
  const hcs1 = { mirrorFetch: fakeHashinal(topic, png), mirror: "https://mirror.test" };
  const source = fakeSource({});
  const viaKiloscribe = await getAvatarThumb(`https://kiloscribe.com/api/inscription-cdn/${topic}`, { hcs1, fetchSource: source.fetchSource });
  assert.equal(viaKiloscribe.ok, true);
  assert.equal(source.asked.length, 0, "Kiloscribe is not fetched");
  assert.ok(near(await pixel(viaKiloscribe.bytes, 50, 50), [20, 160, 220, 255]));
  // hcs://, our route and Kiloscribe are one thumbnail.
  for (const link of [`hcs://1/${topic}`, `https://app.example/api/hcs1/${topic}`]) {
    const same = await getAvatarThumb(link, { hcs1, fetchSource: source.fetchSource });
    assert.equal(same.from, "memory", link);
  }
  assert.equal(avatarKey(`hcs://1/${topic}`), avatarKey(`hcs://1/${topic}`));
  clearAvatarCache();
  clearHcs1Cache();
});

test("an IPFS file walks the page's gateways in order", async () => {
  clearAvatarCache();
  const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const gateways = ipfsGatewayUrls(`ipfs://${cid}/me.png`);
  assert.ok(gateways.length >= 3);
  const png = await solid(500, 500, [240, 200, 0]);
  const source = fakeSource({ [gateways[0]]: Object.assign(new Error("gateway down"), {}), [gateways[1]]: png });
  const thumb = await getAvatarThumb(`https://ipfs.io/ipfs/${cid}/me.png`, { fetchSource: source.fetchSource });
  assert.equal(thumb.ok, true);
  assert.deepEqual(source.asked, gateways.slice(0, 2));
  clearAvatarCache();
});

test("new thumbnails are capped per IP and at once; ones already made are not", async () => {
  clearAvatarCache();
  const png = await solid(100, 100, [1, 2, 3]);
  const a = "https://cdn.example/a.png";
  const b = "https://cdn.example/b.png";
  const source = fakeSource({ [a]: png, [b]: png });
  const opts = { fetchSource: source.fetchSource, ip: "203.0.113.7", buildRateMax: 1 };
  assert.equal((await getAvatarThumb(a, opts)).ok, true);
  const capped = await getAvatarThumb(b, opts);
  assert.deepEqual([capped.status, capped.retryAfter > 0], [429, true]);
  assert.equal((await getAvatarThumb(a, opts)).from, "memory", "a made thumbnail still answers");
  // Not remembered: with budget it is made.
  assert.equal((await getAvatarThumb(b, { ...opts, ip: "198.51.100.1" })).ok, true);

  clearAvatarCache();
  const busy = await getAvatarThumb(a, { fetchSource: source.fetchSource, maxBuilds: 0 });
  assert.deepEqual([busy.status, busy.retryAfter > 0], [503, true]);
  assert.equal((await getAvatarThumb(a, { fetchSource: source.fetchSource })).ok, true, "busy is not remembered");
  clearAvatarCache();
});

test("the route has its own rate limit per client IP", async () => {
  const app = express();
  app.get("/api/avatar.webp", createAvatarRateLimit({ clientIp: () => "203.0.113.9", max: 2 }), (req, res) => res.status(204).end());
  const { base, close } = await serve(app);
  try {
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await fetch(`${base}/api/avatar.webp?src=x&v=${i}`)).status);
    assert.deepEqual(statuses, [204, 204, 429]);
    const limited = await fetch(`${base}/api/avatar.webp?src=y`);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  } finally {
    await close();
  }
});
