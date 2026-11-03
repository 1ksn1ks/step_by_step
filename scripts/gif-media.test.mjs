// Device GIF geometry, progress, and the media-URL resolver. No browser and no network.
import test from "node:test";
import assert from "node:assert/strict";
import { posterTargetKey, resolveMediaUrl } from "../mediaurl.js";
import {
  GIF_BROWSER_ERROR,
  conversionRatio,
  frameBox,
  gifDurationReject,
  mapGifProgress,
  pickRecorderMime,
  recorderFallback,
  storedType,
} from "../gifvideo.js";

test("cover roles centre-crop to an even edge of at most 512", () => {
  assert.deepEqual(frameBox(1000, 400, "cover"), {
    width: 400, height: 400, sx: 300, sy: 0, sw: 400, sh: 400,
  });
  assert.deepEqual(frameBox(2000, 1000, "avatar"), {
    width: 512, height: 512, sx: 500, sy: 0, sw: 1000, sh: 1000,
  });
  assert.deepEqual(frameBox(513, 513, "polygon-cover"), {
    width: 512, height: 512, sx: 0, sy: 0, sw: 513, sh: 513,
  });
  const narrow = frameBox(31, 45, "cover");
  assert.equal(narrow.width, 30);
  assert.equal(narrow.height, 30);
  assert.equal(narrow.sx, 0);
  assert.equal(narrow.sy, 7);
  assert.equal(narrow.sw, 31);
  assert.equal(narrow.sh, 31);
  assert.equal(narrow.width % 2, 0);
  assert.equal(narrow.height % 2, 0);
});

test("media keeps its size and only evens each side", () => {
  assert.deepEqual(frameBox(101, 51, "media"), {
    width: 100, height: 50, sx: 0, sy: 0, sw: 101, sh: 51,
  });
  const odd = frameBox(3, 5, "media");
  assert.equal(odd.width, 2);
  assert.equal(odd.height, 4);
  assert.equal(odd.sx, 0);
  assert.equal(odd.sy, 0);
  assert.equal(odd.sw, 3);
  assert.equal(odd.sh, 5);
  assert.notEqual(frameBox(800, 200, "media").width, frameBox(800, 200, "cover").width);
});

test("conversion fills 0–70 and the upload fills 70–100", () => {
  assert.equal(mapGifProgress("convert", 0), 0);
  assert.equal(mapGifProgress("convert", 0.5), 35);
  assert.equal(mapGifProgress("convert", 1), 70);
  assert.equal(mapGifProgress("convert", 2), 70);
  assert.equal(mapGifProgress("upload", 0), 70);
  assert.equal(mapGifProgress("upload", 0.5), 85);
  assert.equal(mapGifProgress("upload", 1), 100);
  assert.equal(mapGifProgress("upload", -1), 70);
  assert.equal(conversionRatio(1, 2, 0, 1000), 0.5);
  assert.equal(conversionRatio(0, 2, 800, 1000), 0.8);
  assert.equal(conversionRatio(3, 2, 5000, 1000), 1);
  assert.equal(conversionRatio(0, 0, 0, 0), 0);
});

test("an unsupported recorder refuses the upload and never stores a gif", () => {
  assert.equal(recorderFallback(false, "video/mp4"), GIF_BROWSER_ERROR);
  assert.equal(recorderFallback(true, ""), GIF_BROWSER_ERROR);
  assert.equal(recorderFallback(true, "image/gif"), GIF_BROWSER_ERROR);
  assert.equal(recorderFallback(true, "video/webm"), "");
  assert.equal(pickRecorderMime(() => false), "");
  assert.equal(pickRecorderMime((type) => type === "video/webm;codecs=vp8"), "video/webm;codecs=vp8");
  assert.equal(
    pickRecorderMime((type) => type === "video/mp4" || type === "video/webm;codecs=vp9"),
    "video/mp4",
  );
  assert.deepEqual(storedType("video/mp4;codecs=avc1.42E01E"), { type: "video/mp4", ext: ".mp4" });
  assert.deepEqual(storedType("video/webm;codecs=vp9"), { type: "video/webm", ext: ".webm" });
  assert.equal(storedType("image/gif"), null);
  assert.equal(storedType("video/mp4").ext === ".gif", false);
});

test("only a polygon cover longer than 30 seconds is rejected", () => {
  assert.equal(gifDurationReject("polygon-cover", 31), "Cover video max 30 seconds");
  assert.equal(gifDurationReject("polygon-cover", 30), "");
  assert.equal(gifDurationReject("polygon-cover", 30.5), "");
  assert.equal(gifDurationReject("media", 31), "");
  assert.equal(gifDurationReject("cover", 90), "");
  assert.equal(gifDurationReject("avatar", 90), "");
});

test("a gif address is not rendered and other media stays put", () => {
  assert.deepEqual(resolveMediaUrl("https://pub-abc.r2.dev/markers/a.gif?x=1#y"), {
    kind: "image", src: "", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://cdn.r2.pub/old.gif"), {
    kind: "image", src: "", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://ipfs.io/ipfs/bafy.gif"), {
    kind: "image", src: "", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://example.com/anim.GIF"), {
    kind: "image", src: "", poster: "",
  });
  assert.equal(resolveMediaUrl("https://ipfs.io/ipfs/bafy.gif").src.includes("/api/media/gif"), false);
  assert.deepEqual(resolveMediaUrl("https://pub-abc.r2.dev/a.jpg"), {
    kind: "image", src: "https://pub-abc.r2.dev/a.jpg", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://example.com/clip.mp4"), {
    kind: "video", src: "https://example.com/clip.mp4", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://example.com/clip.webm"), {
    kind: "video", src: "https://example.com/clip.webm", poster: "",
  });
  assert.deepEqual(resolveMediaUrl(""), { kind: "image", src: "", poster: "" });
});

test("a poster is stored only beside our own mp4 or webm", () => {
  const base = "https://pub-243.r2.dev";
  assert.equal(
    posterTargetKey(base, "https://pub-243.r2.dev/markers/1700000000000-ab12cd.mp4"),
    "markers/1700000000000-ab12cd.poster.jpg",
  );
  assert.equal(
    posterTargetKey(base, "https://pub-243.r2.dev/markers/1700000000000-ab12cd-d12.webm?x=1"),
    "markers/1700000000000-ab12cd-d12.poster.jpg",
  );
  assert.equal(posterTargetKey(base, "https://evil.example/markers/1-ab.mp4"), "");
  assert.equal(posterTargetKey(base, "https://pub-243.r2.dev/markers/%2e%2e%2fsecret.mp4"), "");
  assert.equal(posterTargetKey(base, "https://pub-243.r2.dev/markers/1-ab.gif"), "");
  assert.equal(posterTargetKey(base, "https://pub-243.r2.dev/markers/1-ab.mov"), "");
  assert.equal(posterTargetKey("", "https://pub-243.r2.dev/markers/1-ab.mp4"), "");
});
