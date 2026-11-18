// Thumbnail decoding stays light (server/avatar.js, makeAvatarThumb): one
// libvips thread per decode, read in order, a picture decoded in full (PNG,
// WebP, GIF, AVIF) at most a 24 MP phone frame, and a JPEG, which is decoded
// at 1/8 of its size for a thumbnail this small, up to the largest 50 MP
// phone frame, so every 12–50 MP phone photo is kept. 413 above either,
// before anything is decoded.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";

import {
  AVATAR_EDGE,
  AVATAR_MAX_JPEG_PIXELS,
  AVATAR_MAX_PIXELS,
  AVATAR_SHARP_THREADS,
  clearAvatarCache,
  createProfileSources,
  getAvatarThumb,
  makeAvatarThumb,
} from "../server/avatar.js";

// Flat pictures: the limits read the header's size, and a flat picture is
// quick to make and small to hold whatever its size.
function flat(width, height, format, { orientation } = {}) {
  let image = sharp({ create: { width, height, channels: 3, background: { r: 30, g: 140, b: 90 } } });
  if (format === "jpeg") image = image.jpeg({ quality: 80 });
  else if (format === "webp") image = image.webp({ quality: 80, effort: 0 });
  else image = image.png({ compressionLevel: 9 });
  if (orientation) image = image.withMetadata({ orientation });
  return image.toBuffer();
}

const tooLarge = (err) => err && err.status === 413 && err.message === "source too large";

test("the limits: a 24 MP phone frame for any picture, the largest 50 MP phone frame for a JPEG; one thread", () => {
  assert.equal(AVATAR_MAX_PIXELS, 5712 * 4284);
  assert.equal(AVATAR_MAX_JPEG_PIXELS, 8192 * 6144);
  assert.equal(AVATAR_SHARP_THREADS, 1);
  assert.equal(sharp.concurrency(), AVATAR_SHARP_THREADS, "set for this process once avatar.js is loaded");
  const source = readFileSync(new URL("../server/avatar.js", import.meta.url), "utf8");
  assert.match(source, /const input = \{ animated: false, failOn: "none", sequentialRead: true \};/);
  assert.match(source, /sharp\(bytes, \{ \.\.\.input, limitInputPixels: Math\.max\(maxPixels, maxJpegPixels\) \}\)\.metadata\(\)/);
  assert.match(source, /sharp\(bytes, \{ \.\.\.input, limitInputPixels: limit \}\)/);
});

test("every phone photo size as a JPEG makes a thumbnail", async () => {
  for (const [name, width, height] of [
    ["12 MP", 4032, 3024],
    ["24 MP", 5712, 4284],
    ["48 MP", 8064, 6048],
    ["50 MP", 8160, 6144],
    ["50 MP, largest", 8192, 6144],
  ]) {
    const thumb = await makeAvatarThumb(await flat(width, height, "jpeg"));
    const meta = await sharp(thumb).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["webp", AVATAR_EDGE, AVATAR_EDGE], name);
  }
  // Held sideways, as a phone stores it (EXIF 6): turned upright.
  const sideways = await makeAvatarThumb(await flat(8064, 6048, "jpeg", { orientation: 6 }));
  assert.deepEqual([(await sharp(sideways).metadata()).width], [AVATAR_EDGE]);

  await assert.rejects(makeAvatarThumb(await flat(8192, 6145, "jpeg")), tooLarge, "one row past the largest phone frame");
});

test("a picture decoded in full is kept up to a 24 MP frame, and is a 413 past it, however small the file", async () => {
  const atLimit = await makeAvatarThumb(await flat(5712, 4284, "png"));
  assert.equal((await sharp(atLimit).metadata()).width, AVATAR_EDGE);
  await assert.rejects(makeAvatarThumb(await flat(5712, 4285, "png")), tooLarge);
  await assert.rejects(makeAvatarThumb(await flat(5712, 4285, "webp")), tooLarge);
  // A 48 MP PNG of one colour is under a megabyte, and would need far more
  // to decode: refused from its header.
  const bomb = await flat(8064, 6048, "png");
  assert.ok(bomb.length < 1024 * 1024);
  await assert.rejects(makeAvatarThumb(bomb), tooLarge);
  // Past both limits: refused when the header is read.
  await assert.rejects(makeAvatarThumb(await flat(10000, 10000, "png")), tooLarge);
});

test("the route answers a picture that is too large with 413, remembered, and makes a 48 MP JPEG", async () => {
  clearAvatarCache();
  const big = "https://cdn.example/big.png";
  const photo = "https://cdn.example/photo.jpg";
  const files = { [big]: await flat(5712, 4285, "png"), [photo]: await flat(8064, 6048, "jpeg") };
  const asked = [];
  const opts = {
    fetchSource: async (url) => {
      asked.push(url);
      return files[url];
    },
    isProfileSource: createProfileSources([big, photo]).has,
  };
  assert.deepEqual([(await getAvatarThumb(big, opts)).status, (await getAvatarThumb(big, opts)).status], [413, 413]);
  assert.equal(asked.filter((url) => url === big).length, 1, "not fetched again");
  const made = await getAvatarThumb(photo, opts);
  assert.deepEqual([made.ok, made.from], [true, "built"]);
  clearAvatarCache();
});
