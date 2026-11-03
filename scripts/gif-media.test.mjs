// GIF transcode plan and the one media-URL resolver. No ffmpeg and no network.
import test from "node:test";
import assert from "node:assert/strict";
import {
  COVER_MAX_EDGE,
  GIF_CONVERT_ERROR,
  applyGifTranscode,
  ffmpegStillArgs,
  ffmpegVideoArgs,
  inspectGif,
  ownGifKey,
  resolveMediaUrl,
  scaleFilter,
} from "../mediaurl.js";
import { readCappedBody } from "../server/giftranscode.js";

function gifBytes(delays) {
  const chunks = [
    Buffer.from("GIF89a"),
    Buffer.from([0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]),
  ];
  for (const delay of delays) {
    chunks.push(Buffer.from([
      0x21, 0xf9, 0x04, 0x00,
      delay & 0xff, (delay >> 8) & 0xff,
      0x00, 0x00,
    ]));
    chunks.push(Buffer.from([
      0x2c,
      0x00, 0x00, 0x00, 0x00,
      0x02, 0x00, 0x02, 0x00,
      0x00,
    ]));
    chunks.push(Buffer.from([0x02, 0x02, 0x4c, 0x01, 0x00]));
  }
  chunks.push(Buffer.from([0x3b]));
  return Buffer.concat(chunks);
}

const stubRun = (calls) => async (kind, job) => {
  calls.push({ kind, maxEdge: job.maxEdge });
  return Buffer.from(kind === "video" ? "mp4-bytes" : "jpeg-bytes");
};

test("a one-frame GIF is stored as a JPEG still", async () => {
  const calls = [];
  const out = await applyGifTranscode({
    bytes: gifBytes([8]),
    role: "avatar",
    run: stubRun(calls),
  });
  assert.equal(out.ok, true);
  assert.equal(out.ext, ".jpg");
  assert.equal(out.mime, "image/jpeg");
  assert.equal(out.poster, null);
  assert.equal(out.ext === ".gif", false);
  assert.deepEqual(calls, [{ kind: "still", maxEdge: COVER_MAX_EDGE }]);
  assert.equal(inspectGif(gifBytes([8])).frames, 1);
});

test("an animated GIF becomes an MP4 plus a first-frame poster", async () => {
  const calls = [];
  const out = await applyGifTranscode({
    bytes: gifBytes([10, 10]),
    role: "cover",
    run: stubRun(calls),
  });
  assert.equal(out.ok, true);
  assert.equal(out.ext, ".mp4");
  assert.equal(out.mime, "video/mp4");
  assert.equal(Buffer.from(out.poster).toString(), "jpeg-bytes");
  assert.equal(out.seconds, 0.2);
  assert.deepEqual(calls.map((row) => row.kind), ["video", "poster"]);
  assert.equal(calls[0].maxEdge, 512);
  const videoArgs = ffmpegVideoArgs("in.gif", "out.mp4", 512);
  assert.equal(videoArgs.includes("-an"), true);
  assert.equal(videoArgs.includes("+faststart"), true);
  assert.equal(videoArgs.includes("yuv420p"), true);
  assert.equal(videoArgs.includes("libx264"), true);
  assert.match(videoArgs.join(" "), /512/);
  const posterArgs = ffmpegStillArgs("in.gif", "out.jpg", 512);
  assert.equal(posterArgs.includes("1"), true);
  assert.equal(posterArgs.includes("-q:v"), true);
  assert.equal(scaleFilter(0), "scale=trunc(iw/2)*2:trunc(ih/2)*2");
  const mediaCalls = [];
  const media = await applyGifTranscode({
    bytes: gifBytes([10, 10]),
    role: "media",
    run: stubRun(mediaCalls),
  });
  assert.equal(media.ok, true);
  assert.equal(media.ext, ".mp4");
  assert.equal(mediaCalls[0].maxEdge, 0);
  assert.match(ffmpegVideoArgs("in.gif", "out.mp4", 0).join(" "), /trunc\(iw\/2\)\*2/);
});

test("a stored GIF forced to video stays an MP4 even with one frame", async () => {
  const calls = [];
  const out = await applyGifTranscode({
    bytes: gifBytes([5]),
    role: "media",
    forceVideo: true,
    run: stubRun(calls),
  });
  assert.equal(out.ok, true);
  assert.equal(out.ext, ".mp4");
  assert.ok(out.poster);
  assert.equal(calls[0].maxEdge, 0);
});

test("ffmpeg failing rejects the upload and never returns a gif", async () => {
  const thrown = await applyGifTranscode({
    bytes: gifBytes([10, 10]),
    role: "media",
    run: async () => { throw new Error("ffmpeg missing"); },
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.status, 422);
  assert.equal(thrown.error, GIF_CONVERT_ERROR);
  assert.equal(thrown.ext, undefined);
  assert.equal(Object.hasOwn(thrown, "body"), false);

  const empty = await applyGifTranscode({
    bytes: gifBytes([10, 10]),
    role: "cover",
    run: async () => Buffer.alloc(0),
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.status, 422);
  assert.equal(empty.error, GIF_CONVERT_ERROR);
});

test("a polygon-cover GIF longer than 30 seconds is rejected before ffmpeg", async () => {
  let ran = false;
  const out = await applyGifTranscode({
    bytes: gifBytes([2000, 2000]),
    role: "polygon-cover",
    run: async () => { ran = true; return Buffer.from("nope"); },
  });
  assert.equal(ran, false);
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(out.error, "Cover video max 30 seconds");
});

test("an oversized GIF stream stops at the cap", async () => {
  let pulls = 0;
  let cancelled = false;
  const endless = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(8));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () => readCappedBody(endless, 10),
    (err) => err && err.code === 413 && err.message === "size",
  );
  assert.equal(pulls, 2);
  assert.equal(cancelled, true);

  let readers = 0;
  const declared = {
    getReader() {
      readers += 1;
      throw new Error("should not read");
    },
    cancel() {
      cancelled = true;
      return Promise.resolve();
    },
  };
  cancelled = false;
  await assert.rejects(
    () => readCappedBody(declared, 10, "11"),
    (err) => err && err.code === 413,
  );
  assert.equal(readers, 0);
  assert.equal(cancelled, true);

  const kept = await readCappedBody(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4]));
      controller.close();
    },
  }), 10, "4");
  assert.deepEqual([...kept], [1, 2, 3, 4]);
});

test("bytes that are not a GIF are refused", async () => {
  const out = await applyGifTranscode({
    bytes: Buffer.from("not a gif"),
    role: "media",
    run: async () => Buffer.from("x"),
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 415);
});

test("the resolver maps hosted, remote, still, and video addresses", () => {
  const hosted = resolveMediaUrl("https://pub-abc.r2.dev/markers/a.gif?x=1#y");
  assert.equal(hosted.kind, "video");
  assert.equal(hosted.src, "https://pub-abc.r2.dev/markers/a.mp4");
  assert.equal(hosted.poster, "https://pub-abc.r2.dev/markers/a.poster.jpg");

  const pub = resolveMediaUrl("https://cdn.r2.pub/old.gif");
  assert.equal(pub.src, "https://cdn.r2.pub/old.mp4");
  assert.equal(pub.poster, "https://cdn.r2.pub/old.poster.jpg");

  const ipfs = resolveMediaUrl("https://ipfs.io/ipfs/bafy.gif");
  assert.equal(ipfs.kind, "video");
  assert.equal(ipfs.remote, true);
  assert.equal(ipfs.src, "/api/media/gif?url=" + encodeURIComponent("https://ipfs.io/ipfs/bafy.gif"));
  assert.equal(ipfs.poster, ipfs.src + "&poster=1");

  const remote = resolveMediaUrl("https://example.com/anim.GIF");
  assert.equal(remote.remote, true);
  assert.match(remote.src, /^\/api\/media\/gif\?url=/);

  const jpg = resolveMediaUrl("https://pub-abc.r2.dev/a.jpg");
  assert.deepEqual(jpg, { kind: "image", src: "https://pub-abc.r2.dev/a.jpg", poster: "" });

  const mp4 = resolveMediaUrl("https://example.com/clip.mp4");
  assert.deepEqual(mp4, { kind: "video", src: "https://example.com/clip.mp4", poster: "" });

  assert.deepEqual(resolveMediaUrl(""), { kind: "image", src: "", poster: "" });
  assert.equal(ownGifKey("https://pub-243.r2.dev/markers/a.gif", "https://pub-243.r2.dev"), "markers/a.gif");
  assert.equal(ownGifKey("https://evil.example/markers/a.gif", "https://pub-243.r2.dev"), "");
  assert.equal(ownGifKey("https://pub-243.r2.dev/markers/%2e%2e%2fsecret.gif", "https://pub-243.r2.dev"), "");
});
