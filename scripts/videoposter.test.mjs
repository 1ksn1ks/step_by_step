// Video posters: resize, the upload choice, and a sealed chat still.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  THUMB_EDGE,
  e2eeWireBytes,
  fitThumb,
  packSealedThumb,
  posterFlags,
  posterPlan,
  posterSrc,
  sealedThumbHidden,
  unpackSealedThumb,
} from "../videoposter.js";

test("a thumbnail keeps an even long edge of 720 and does not grow", () => {
  assert.equal(THUMB_EDGE, 720);
  assert.deepEqual(fitThumb(1000, 400), { width: 720, height: 288 });
  assert.deepEqual(fitThumb(100, 40), { width: 100, height: 40 });
  assert.deepEqual(fitThumb(31, 11), { width: 30, height: 10 });
  assert.deepEqual(fitThumb(0, 40), { width: 0, height: 0 });
  const wide = fitThumb(2000, 1001);
  assert.ok(wide.width <= 720 && wide.height <= 720);
  assert.equal(wide.width % 2, 0);
  assert.equal(wide.height % 2, 0);
});

test("a custom picture wins, a removal uploads nothing, and a missed frame does not block", () => {
  const custom = { name: "custom" };
  const frame = { name: "frame" };
  assert.deepEqual(posterPlan({ removed: true, custom, captured: frame }), {
    upload: false,
    file: null,
    reason: "removed",
  });
  assert.deepEqual(posterPlan({ custom, captured: frame }), {
    upload: true,
    file: custom,
    reason: "custom",
  });
  assert.deepEqual(posterPlan({ captured: frame }), {
    upload: true,
    file: frame,
    reason: "frame",
  });
  assert.deepEqual(posterPlan({}), {
    upload: false,
    file: null,
    reason: "capture-failed",
  });
});

test("a poster address is the sibling still, unless the sender turned it off", () => {
  const video = "https://cdn.example/markers/12-ab.mp4";
  assert.equal(posterSrc(video, { posterOff: true }), "");
  assert.equal(posterSrc(video, { poster: "data:image/jpeg;base64,QQ" }), "data:image/jpeg;base64,QQ");
  assert.equal(posterSrc(video, { posterV: 9 }), "https://cdn.example/markers/12-ab.poster.jpg?v=9");
  assert.deepEqual(posterFlags({ posterOff: true, posterV: 9 }), { posterOff: true, posterV: 0 });
  assert.deepEqual(posterFlags({ posterV: 9 }), { posterOff: false, posterV: 9 });
});

test("an e2ee thumbnail is inside the sealed payload and absent from the outer message", () => {
  const thumb = "data:image/jpeg;base64,AAAA";
  const packed = packSealedThumb("hello", "https://cdn.example/markers/12-ab.mp4", thumb);
  assert.match(packed, /data:image\/jpeg;base64,AAAA/);
  assert.equal(unpackSealedThumb(packed).poster, thumb);
  assert.equal(unpackSealedThumb("\u001echat1\n" + JSON.stringify({ t: "hi", i: "https://cdn.example/a.jpg" })).poster, "");
  const outer = JSON.stringify({ encryptedMessage: { ciphertext: "c2VhbGVk" } });
  assert.equal(outer.includes(thumb), false);
  assert.equal(sealedThumbHidden(outer, thumb), true);
  assert.equal(typeof e2eeWireBytes(packed), "number");
  assert.ok(e2eeWireBytes(packed) > thumb.length);
  const upload = readFileSync(new URL("../uploadmedia.js", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../chatimage.js", import.meta.url), "utf8");
  assert.match(upload, /Sealed thumbs never become a public poster/);
  assert.match(chat, /packSealedThumb/);
  assert.doesNotMatch(readFileSync(new URL("../encryptedtopicchat.js", import.meta.url), "utf8"), /x-poster-for/i);
});
