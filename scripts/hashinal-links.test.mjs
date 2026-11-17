// Hashinal links stored in a post (a Kiloscribe inscription link, or
// hcs://1/<id>) read from our route /api/hcs1/<id> on every path that
// shows them: the dot's and the shape's cover, the popup picture, the feed
// card and the gallery. Kiloscribe answers 500 with no CORS header, so a
// raw Kiloscribe cover never loads (commit 6987f13 let one through).
// processallmessages.js, feedlayout.js and polygons.js touch the DOM when
// imported, so their functions are read from the source and compiled here
// with the real resolveHashinalSrc.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveHashinalSrc } from "../hashinalurl.js";
import { galleryImages } from "../postimages.js";

// hashinalurl.js reads the origin on each call; the page has one.
globalThis.location = { origin: "https://app.test" };

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const pam = read("../processallmessages.js");
const feed = read("../feedlayout.js");
const polygons = read("../polygons.js");
// node cannot import the uppercase .JS extension: compile its source.
const isValidUrl = new Function(`${read("../ISVALIDURL.JS").replace(/\bexport\s+/g, "")}\nreturn isValidUrl;`)();

// One function's source, by matching braces from its name.
function readFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  let started = false;
  for (let end = start; end < source.length; end++) {
    const ch = source[end];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, end + 1);
    }
  }
  throw new Error(`no end for ${name}`);
}

// A long function's source, up to the next top-level function.
function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const next = source.slice(start + 1).search(/\n(?:export )?(?:async )?function /);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

const KILOSCRIBE_COVER = ["https://kiloscribe.com/api/inscription-cdn/0.0.4841271"];
const HCS1_IMAGE = "hcs://1/0.0.4819899";
const COVER_ROUTE = "https://app.test/api/hcs1/0.0.4841271";
const IMAGE_ROUTE = "https://app.test/api/hcs1/0.0.4819899";
const PROFILE = "https://app.test/api/hcs1/0.0.4819119";
const R2 = "https://pub-243bb90aeefc464884cd212612165e5b.r2.dev/markers/1763390000000-a1b2c3.webp";

const post = new Function(
  "resolveHashinalSrc",
  "isValidUrl",
  `${["firstMediaUrl", "postMediaUrl", "coverImageUrl"].map((name) => readFn(pam, name)).join("\n")}
return { postMediaUrl, coverImageUrl };`,
)(resolveHashinalSrc, isValidUrl);

test("the dot's and the shape's cover is the resolved first entry, a string", () => {
  assert.equal(post.coverImageUrl(KILOSCRIBE_COVER, PROFILE), COVER_ROUTE);
  assert.equal(post.coverImageUrl([HCS1_IMAGE], PROFILE), IMAGE_ROUTE);
  assert.equal(post.coverImageUrl(HCS1_IMAGE, PROFILE), IMAGE_ROUTE);
  assert.equal(typeof post.coverImageUrl(KILOSCRIBE_COVER, PROFILE), "string");
  // Any other link is kept; no cover is the author's picture.
  assert.equal(post.coverImageUrl([R2], PROFILE), R2);
  assert.equal(post.coverImageUrl([""], PROFILE), PROFILE);
  assert.equal(post.coverImageUrl(undefined, PROFILE), PROFILE);
  assert.equal(post.coverImageUrl(["s3://bucket/x.png"], PROFILE), PROFILE);

  // Every marker and polygon reader (three of each) takes the cover through
  // it, and none keeps the raw coverimage array.
  // A marker falls back to the author's thumbnail (avatarsrc.js); a
  // polygon's 512 fill keeps the full picture.
  assert.equal(pam.match(/imageUrl: coverImageUrl\(parsedMessage\.marker\.data\.coverimage, avatarSrc\(profileUrl\)\)/g).length, 3);
  assert.equal(pam.match(/imageUrl: coverImageUrl\(parsedMessage\.polygon\.data\.coverimage, profileUrl\)/g).length, 3);
  assert.doesNotMatch(pam, /\? parsedMessage\.(marker|polygon)\.data\.coverimage :/);
});

test("a polygon's map cover reads the resolved link, including a raw array left on a shape", async () => {
  const line = /const coverUrl = (.+);/.exec(polygons);
  assert.ok(line, "polygons.js coverUrl");
  const coverUrl = new Function("resolveHashinalSrc", "polygon", `return ${line[1]};`);
  assert.equal(coverUrl(resolveHashinalSrc, { imageUrl: KILOSCRIBE_COVER }), COVER_ROUTE);
  assert.equal(coverUrl(resolveHashinalSrc, { imageUrl: HCS1_IMAGE }), IMAGE_ROUTE);
  assert.equal(coverUrl(resolveHashinalSrc, { imageUrl: [R2] }), R2);
  assert.equal(coverUrl(resolveHashinalSrc, { imageUrl: undefined }), "");

  // The texture loader is asked for our route, never Kiloscribe.
  const asked = [];
  const createResizedImage = new Function(
    "resolveHashinalSrc", "resizedImageCache", "preferGateway", "isGifUrl", "needsGifCheck", "loadElementImage",
    `${readFn(polygons, "createResizedImage")}\nreturn createResizedImage;`,
  )(
    resolveHashinalSrc,
    new Map(),
    () => "",
    () => false,
    () => false,
    async (url) => { asked.push(url); return url; },
  );
  assert.equal(await createResizedImage(KILOSCRIBE_COVER[0], 512, 512), COVER_ROUTE);
  assert.equal(await createResizedImage(HCS1_IMAGE, 512, 512), IMAGE_ROUTE);
  assert.deepEqual(asked, [COVER_ROUTE, IMAGE_ROUTE]);
});

test("the marker and polygon popups show the resolved picture, the same one the gallery heads with", () => {
  for (const name of ["createMarkerPopupHTML", "createPolygonPopupHTML"]) {
    const body = bodyOf(pam, name);
    assert.match(body, /const popupImageUrl = postMediaUrl\(image\);/, name);
    assert.match(body, /isValidUrl\(popupImageUrl\)/, name);
    assert.match(body, /galleryImages\(image\)/, name);
  }
  assert.equal(post.postMediaUrl(KILOSCRIBE_COVER), COVER_ROUTE);
  assert.equal(post.postMediaUrl([HCS1_IMAGE]), IMAGE_ROUTE);
  assert.equal(post.postMediaUrl(HCS1_IMAGE), IMAGE_ROUTE);
  assert.ok(isValidUrl(post.postMediaUrl([HCS1_IMAGE])));
  assert.equal(post.postMediaUrl([R2]), R2);
  // The "+N" badge shows only when the popup's picture heads the gallery.
  const image = [HCS1_IMAGE, KILOSCRIBE_COVER[0], R2];
  assert.equal(galleryImages(image)[0], post.postMediaUrl(image));
});

test("a feed card's picture is the resolved link, the same one the gallery heads with", () => {
  const mediaOf = new Function("resolveHashinalSrc", `${readFn(feed, "mediaOf")}\nreturn mediaOf;`)(resolveHashinalSrc);
  assert.equal(mediaOf(KILOSCRIBE_COVER), COVER_ROUTE);
  assert.equal(mediaOf([HCS1_IMAGE]), IMAGE_ROUTE);
  assert.equal(mediaOf(HCS1_IMAGE), IMAGE_ROUTE);
  assert.equal(mediaOf([R2]), R2);
  assert.equal(mediaOf(["ipfs://bafy/cat.png"]), "");
  // buildCard shows the grid only when the card's picture heads the gallery.
  const image = [HCS1_IMAGE, R2];
  assert.equal(galleryImages(image)[0], mediaOf(image));
});

test("the gallery reads both kinds of Hashinal link from our route", () => {
  assert.deepEqual(galleryImages([HCS1_IMAGE]), [IMAGE_ROUTE]);
  assert.deepEqual(galleryImages(KILOSCRIBE_COVER), [COVER_ROUTE]);
  assert.deepEqual(galleryImages([` ${HCS1_IMAGE} `, KILOSCRIBE_COVER[0], R2]), [IMAGE_ROUTE, COVER_ROUTE, R2]);
  // Not a Hashinal link: unchanged, and still refused when not showable.
  assert.deepEqual(galleryImages(["hcs://1/not-a-topic", "javascript:alert(1)"]), []);
});
