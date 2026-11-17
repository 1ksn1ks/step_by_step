import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  POST_IMAGE_MAX,
  galleryImages,
  pickKind,
  placeholderMediaUrl,
  postCover,
  postImageArray,
  registerPostDraft,
  wireCover,
  wireImageArray,
  draftPending,
} from "../postimages.js";
import { compressedName, fitLongestSide } from "../imagecompress.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const bytes = (text) => new TextEncoder().encode(text).length;
const R2 = "https://pub-243bb90aeefc464884cd212612165e5b.r2.dev";
const pic = (i, ext = "webp") => `${R2}/markers/1763390000${String(i).padStart(3, "0")}-a1b2c3.${ext}`;

test("a post's pictures: old one-image posts, up to four, never a video", () => {
  // Old posts: a bare string, or the one-entry array the form always wrote.
  assert.deepEqual(galleryImages(pic(0)), [pic(0)]);
  assert.deepEqual(galleryImages([pic(0)]), [pic(0)]);
  assert.deepEqual(galleryImages([""]), []);
  assert.deepEqual(galleryImages(undefined), []);
  assert.deepEqual(galleryImages([pic(0), pic(1), pic(2), pic(3)]), [pic(0), pic(1), pic(2), pic(3)]);
  assert.equal(galleryImages([pic(0), pic(1), pic(2), pic(3), pic(4)]).length, POST_IMAGE_MAX);
  // A video post has no gallery; a stray video later in the list is skipped.
  assert.deepEqual(galleryImages([`${R2}/markers/1-abc-d12.mp4`, pic(1)]), []);
  assert.deepEqual(galleryImages([pic(0), `${R2}/markers/1-abc.webm`, pic(2)]), [pic(0), pic(2)]);
  // Only addresses the feed and popups can show; whitespace is trimmed.
  assert.deepEqual(galleryImages([" " + pic(0) + " ", "javascript:alert(1)", "data:image/png;base64,AA", 7, pic(1)]), [pic(0), pic(1)]);
  assert.deepEqual(galleryImages(["ipfs://bafy/cat.png"]), ["ipfs://bafy/cat.png"]);
});

test("what a picked file is for the media slot", () => {
  assert.equal(pickKind({ type: "image/jpeg" }), "still");
  assert.equal(pickKind({ type: "image/png" }), "still");
  assert.equal(pickKind({ type: "image/webp" }), "still");
  // A GIF becomes a video on upload, so it is not a gallery picture.
  assert.equal(pickKind({ type: "image/gif" }), "motion");
  assert.equal(pickKind({ type: "video/mp4" }), "motion");
  assert.equal(pickKind({ type: "image/heic" }), "other");
  assert.equal(pickKind(null), "other");
});

test("with no pictures in the form the post keeps its old single shape", async () => {
  assert.deepEqual(postImageArray("nothing", "https://x/v.mp4"), ["https://x/v.mp4"]);
  assert.deepEqual(postImageArray("nothing", ""), [""]);
  assert.deepEqual(wireImageArray("nothing", ""), [""]);
  assert.equal(wireCover("nothing", ""), "");
  assert.equal(await postCover("nothing", "", null), "");
  assert.equal(draftPending("nothing"), 0);
});

test("the form's pictures reach the post, and the counter counts the ones on their way", async () => {
  const state = { done: [pic(0), pic(1)], pending: 2, coverCalls: 0 };
  registerPostDraft("test-marker", {
    count: () => state.done.length + state.pending,
    pending: () => state.pending,
    images: () => state.done.slice(),
    cover: async () => {
      state.coverCalls += 1;
      return pic(9, "jpg");
    },
  });
  assert.equal(draftPending("test-marker"), 2);
  assert.deepEqual(postImageArray("test-marker", pic(0)), [pic(0), pic(1)]);
  const wire = wireImageArray("test-marker", pic(0));
  assert.equal(wire.length, 4);
  assert.equal(wire[2], placeholderMediaUrl());
  // The stand-in is as long as a real upload address.
  assert.equal(placeholderMediaUrl().length, pic(0).length);
  assert.equal(wireCover("test-marker", ""), placeholderMediaUrl("jpg"));
  // A picked cover always wins and nothing is uploaded for it.
  assert.equal(wireCover("test-marker", pic(7, "jpg")), pic(7, "jpg"));
  assert.equal(await postCover("test-marker", pic(7, "jpg"), null), pic(7, "jpg"));
  assert.equal(state.coverCalls, 0);
  assert.equal(await postCover("test-marker", "", null), pic(9, "jpg"));
  assert.equal(state.coverCalls, 1);
});

test("four pictures and their cover still fit one 1024-byte HCS message", () => {
  const sealed = (plain) => {
    const raw = 48 + plain;
    const mod = raw % 3;
    return bytes(JSON.stringify({ ciphertext: "x".repeat(Math.floor(raw / 3) * 4 + (mod === 1 ? 2 : mod === 2 ? 3 : 0)) }));
  };
  const title = "x".repeat(20);
  const images = [pic(0), pic(1), pic(2), pic(3)];
  const marker = JSON.stringify({ marker: { data: { title, image: images, coverimage: [pic(9, "jpg")], msg: "", cord: "-122.419416,37.774929" } } });
  const cord = "[-122.419416,37.774929], [-122.419416,37.764929], [-122.409416,37.764929], [-122.409416,37.774929]";
  const polygon = JSON.stringify({ polygon: { data: { title, image: images, coverimage: [pic(9, "jpg")], msg: "", cord } } });
  assert.ok(bytes(marker) < 1024, `marker ${bytes(marker)}`);
  assert.ok(bytes(polygon) < 1024, `polygon ${bytes(polygon)}`);
  assert.ok(sealed(bytes(marker)) < 1024, `sealed marker ${sealed(bytes(marker))}`);
  assert.ok(sealed(bytes(polygon)) < 1024, `sealed polygon ${sealed(bytes(polygon))}`);
});

test("compression keeps the shape, never upscales, and names the new type", () => {
  assert.deepEqual(fitLongestSide(4032, 3024), { width: 2048, height: 1536 });
  assert.deepEqual(fitLongestSide(3024, 4032), { width: 1536, height: 2048 });
  assert.deepEqual(fitLongestSide(1200, 800), { width: 1200, height: 800 });
  assert.deepEqual(fitLongestSide(0, 800), { width: 0, height: 0 });
  assert.equal(compressedName("IMG_0042.JPG", "image/webp"), "IMG_0042.webp");
  assert.equal(compressedName("shot.png", "image/jpeg"), "shot.jpg");
  assert.equal(compressedName("", "image/webp"), "image.webp");
  const src = read("../imagecompress.js");
  assert.match(src, /toBlob\(canvas, "image\/webp", quality\)/);
  // Safari writes PNG for an unknown type: anything but WebP falls back to JPEG.
  assert.match(src, /if \(!blob \|\| blob\.type !== "image\/webp"\)/);
  assert.match(src, /toBlob\(canvas, "image\/jpeg", quality\)/);
  assert.match(src, /imageOrientation: "from-image"/);
});

test("the form's limits: 10 MB originals, 2 MB after compression, two uploads at a time", () => {
  const images = read("../postimages.js");
  assert.match(images, /POST_IMAGE_ORIGINAL_MAX = 10 \* 1024 \* 1024/);
  assert.match(images, /POST_IMAGE_UPLOAD_MAX = 2 \* 1024 \* 1024/);
  assert.match(images, /POST_IMAGE_EDGE = 2048/);
  assert.match(images, /POST_IMAGE_QUALITY = 0\.8/);
  const gallery = read("../postgallery.js");
  assert.match(gallery, /file\.size > POST_IMAGE_ORIGINAL_MAX/);
  assert.match(gallery, /file\.size > POST_IMAGE_UPLOAD_MAX/);
  // The server allows two uploads at once from one address.
  const server = read("../server/index.js");
  const perIp = server.match(/UPLOAD_MAX_CONCURRENT_PER_IP = envPositiveInt\("UPLOAD_MAX_CONCURRENT_PER_IP", (\d+)\)/);
  assert.ok(perIp);
  assert.match(gallery, new RegExp(`const UPLOADS_AT_ONCE = ${perIp[1]};`));
  // One pill with Cancel for the batch, and one decode at a time.
  assert.match(gallery, /progressPill\(batchLabel\(batch\), \(\) => cancelBatch\(s, batch\)\)/);
  assert.match(gallery, /withCompressLock\(/);
  // A GIF or video alone keeps the one-file path (GIF to video there).
  assert.match(gallery, /if \(list\.length === 1 && !s\.items\.length\) \{\s*uploadSingleMedia\(s\.cfg\.field, motion\[0\]\);/);
  assert.match(gallery, /toast\.error\(POST_MEDIA_MIX\)/);
});

test("each picture spends its own Turnstile token, fetched one after another", () => {
  const src = read("../uploadmedia.js");
  assert.match(src, /export async function uploadPostImage\(file, \{ anchor, signal, onProgress, role = "media" \} = \{\}\)/);
  assert.match(src, /const turnstile = await queuedTurnstileToken\(anchor, signal\);/);
  assert.match(src, /turnstileChain = run\.catch\(\(\) => \{\}\);/);
  // The media pickers belong to postgallery.js now; the cover pickers stay.
  assert.equal(src.includes('bindUploader("upload-media-marker"'), false);
  assert.equal(src.includes('bindUploader("upload-media-polygon"'), false);
  assert.match(src, /bindUploader\("upload-cover-marker"/);
  assert.match(src, /bindUploader\("upload-cover-polygon"/);
  const html = read("../index.html");
  assert.match(html, /id="upload-media-marker-file" accept="[^"]+" multiple hidden/);
  assert.match(html, /id="upload-media-polygon-file" accept="[^"]+" multiple hidden/);
  assert.match(html, /id="draw-marker-gallery" class="draw-gallery" hidden/);
  assert.match(html, /id="draw-polygon-gallery" class="draw-gallery" hidden/);
  assert.match(read("../main.js"), /import '\.\/postgallery\.js'/);
});

test("all four submits send the list, wait for uploads and make the cover", () => {
  const src = read("../rest.js");
  assert.equal(src.split('draftPending("marker")').length - 1, 2);
  assert.equal(src.split('draftPending("polygon")').length - 1, 2);
  assert.equal(src.split('postImageArray("marker", cleanUrl)').length - 1, 2);
  assert.equal(src.split('postImageArray("polygon", cleanUrl)').length - 1, 2);
  assert.equal(src.split("coverimage: [cover]").length - 1, 4);
  assert.equal(src.includes("image: [cleanUrl]"), false);
  // The byte counter builds the same arrays.
  const draw = read("../drawpreview.js");
  assert.match(draw, /image: wireImageArray\("marker"/);
  assert.match(draw, /image: wireImageArray\("polygon"/);
  assert.match(draw, /coverimage: \[wireCover\("marker"/);
  assert.match(draw, /coverimage: \[wireCover\("polygon"/);
});

test("a stored cover array still dresses the marker dot and polygon fill", () => {
  // isValidUrl takes strings only (ISVALIDURL.JS), and covers are stored
  // as ["url"], so the first entry is what gets checked, and kept
  // (coverImageUrl; hashinal-links.test.mjs runs it).
  assert.match(read("../ISVALIDURL.JS"), /if \(typeof url !== "string" \|\| !url\.trim\(\)\) return false;/);
  const src = read("../processallmessages.js");
  assert.equal(/isValidUrl\(parsedMessage\.(marker|polygon)\.data\.coverimage\)/.test(src), false);
  assert.match(src, /function postMediaUrl\(value\) \{\s*return resolveHashinalSrc\(firstMediaUrl\(value\)\);/);
  assert.equal(src.split("coverImageUrl(parsedMessage.marker.data.coverimage, profileUrl)").length - 1, 3);
  assert.equal(src.split("coverImageUrl(parsedMessage.polygon.data.coverimage, profileUrl)").length - 1, 3);
});

test("the feed grid, the popup badge and the viewer's gallery", () => {
  const feed = read("../feedlayout.js");
  assert.match(feed, /const gallery = galleryImages\(record\.image\);/);
  assert.match(feed, /if \(gallery\.length > 1 && gallery\[0\] === src\) \{\s*media = buildMediaGrid\(gallery, \{/);
  assert.match(feed, /canTap: feedActIdle/);
  assert.match(feed, /openGallery\(gallery, index\)/);

  const grid = read("../mediagrid.js");
  assert.match(grid, /img\.loading = 'lazy';/);
  assert.match(grid, /if \(event\.detail > 0 && !canTap\(event\)\) return;/);

  const viewer = read("../fullscreenmedia.js");
  assert.match(viewer, /export function openGallery\(urls, index = 0\)/);
  assert.match(viewer, /layerOpened\('media', \{ src: list\[at\], video: false, gallery: list, index: at \}\)/);
  assert.match(viewer, /if \(state && Array\.isArray\(state\.gallery\)\) openGallery\(state\.gallery, state\.index\);/);
  assert.match(viewer, /g\.counter\.textContent = `\$\{index \+ 1\} \/ \$\{g\.list\.length\}`;/);
  assert.match(viewer, /e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowRight'/);
  // Data saving: nothing is fetched ahead under Save-Data or Data saver.
  assert.match(viewer, /localStorage\.getItem\('feed-setting-data'\) === 'on'/);
  assert.match(feed, /data: 'feed-setting-data'/);

  const css = read("../style.css");
  assert.match(css, /\.post-gallery\[data-count="3"\] > \.post-gallery-tile:first-child \{\s*grid-row: 1 \/ span 2;/);
  assert.match(css, /\.post-gallery:is\(\[data-count="3"\], \[data-count="4"\]\) \{\s*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\);/);
  // No fixed px in the new block.
  const at = css.indexOf("/* ── Several pictures per post");
  assert.ok(at > 0);
  assert.equal(/\d px\b|\dpx\b/.test(css.slice(at)), false);
});
