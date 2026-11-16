// Pictures from other sites: a GIF check that fails (no CORS, a network
// error, a refused answer) never stops the picture from showing, and a
// stored link that cannot be shown (s3://) falls back to the default.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyImageUrl, gifCheckFailed, readGifCache, resetGifCache } from "../mediaurl.js";
import { presentImage } from "../loopmedia.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// ISVALIDURL.JS has an upper-case extension, which Node does not load as
// a module; its source is loaded as one.
const { isValidUrl } = await import(
  "data:text/javascript," + encodeURIComponent(read("../ISVALIDURL.JS"))
);

function memStore() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

function fakeImg() {
  const attrs = new Map();
  const classes = new Set();
  return {
    dataset: {},
    classList: {
      add: (...names) => { for (const name of names) classes.add(name); },
      remove: (...names) => { for (const name of names) classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    getAttribute: (key) => (attrs.has(key) ? attrs.get(key) : null),
    setAttribute: (key, value) => attrs.set(key, String(value)),
    removeAttribute: (key) => attrs.delete(key),
    previousElementSibling: null,
    parentNode: null,
    isConnected: false,
    closest: () => null,
    get src() { return attrs.get("src") || ""; },
    set src(value) { attrs.set("src", String(value)); },
  };
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a GIF check blocked by CORS resolves to unknown, once per address", async () => {
  resetGifCache();
  const box = memStore();
  const url = "https://photos.app.goo.gl/m1pvyUGAe1Hiqpi1A";
  let calls = 0;
  // What a CORS refusal looks like to fetch(): a TypeError.
  const blocked = async () => {
    calls += 1;
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await classifyImageUrl(url, { fetch: blocked, storage: box }), null);
  assert.equal(gifCheckFailed(url), true);
  assert.equal(readGifCache(url, box), null);
  const first = calls;
  assert.ok(first >= 1);
  assert.equal(await classifyImageUrl(url, { fetch: blocked, storage: box }), null);
  assert.equal(calls, first);
  // A fetch that throws before it returns a promise is unknown too.
  const sync = "https://dweb.link/ipfs/QmSyncThrow";
  assert.equal(await classifyImageUrl(sync, { fetch: () => { throw new Error("boom"); }, storage: box }), null);
  assert.equal(gifCheckFailed(sync), true);
  resetGifCache();
});

test("a refused answer (403, 500) is unknown, never a GIF", async () => {
  resetGifCache();
  const box = memStore();
  for (const status of [403, 404, 500]) {
    const url = `https://kiloscribe.com/api/inscription-cdn/0.0.${status}`;
    const found = await classifyImageUrl(url, {
      fetch: async () => new Response("<html>error</html>", { status, headers: { "content-type": "image/gif" } }),
      storage: box,
    });
    assert.equal(found, null, String(status));
    assert.equal(gifCheckFailed(url), true);
  }
  // A real answer still decides, and a .gif address is a GIF as before.
  assert.equal(await classifyImageUrl("https://cdn.example/a-file", {
    fetch: async () => new Response(new Uint8Array(), { status: 200, headers: { "content-type": "image/gif" } }),
    storage: box,
  }), true);
  assert.equal(await classifyImageUrl("https://cdn.example/b.gif", { fetch: () => { throw new Error("not asked"); }, storage: box }), true);
  resetGifCache();
});

test("a sniff failure still gives a displayable picture", async () => {
  resetGifCache();
  const url = "https://ipfs.example/ipfs/QmNoCors";
  let calls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError("Failed to fetch");
  };
  try {
    const img = fakeImg();
    presentImage(img, url);
    await nextTurn();
    // Shown as a normal picture, with no crossOrigin on it.
    assert.equal(img.getAttribute("src"), url);
    assert.equal(img.getAttribute("crossorigin"), null);
    assert.equal(img.classList.contains("is-media-pending"), false);
    // Another element with the same address is painted at once.
    const again = fakeImg();
    const before = calls;
    presentImage(again, url);
    assert.equal(again.getAttribute("src"), url);
    assert.equal(again.classList.contains("is-media-pending"), false);
    await nextTurn();
    assert.equal(calls, before);
  } finally {
    globalThis.fetch = previous;
    resetGifCache();
  }
});

test("isValidUrl accepts only links the app can show", () => {
  for (const ok of [
    "https://pub-x.r2.dev/markers/1",
    "http://example.com/a.png",
    "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
    "blob:https://onlyonhbar.com/5f1c-uuid",
    "ipfs://bafybeia6c3xbncy6ww7iaye32haz5hliiy7s2o4gyr",
    "  https://example.com/space.png  ",
  ]) {
    assert.equal(isValidUrl(ok), true, ok);
  }
  for (const bad of [
    "s3://1mhabr-website/0.0.png",
    "S3://bucket/key.png",
    "file:///C:/pic.png",
    "javascript:alert(1)",
    "ftp://example.com/a.png",
    "hcs://1/0.0.4819119",
    "mailto:a@b.c",
    "not a url",
    "",
    "   ",
    null,
    undefined,
    42,
    ["https://x.com/a.png"],
  ]) {
    assert.equal(isValidUrl(bad), false, String(bad));
  }
});

test("one isValidUrl for the popups and both chats; covers keep the real picture", () => {
  for (const name of ["processallmessages.js", "topicchat.js", "encryptedtopicchat.js"]) {
    const source = read(`../${name}`);
    assert.match(source, /import \{ isValidUrl \} from '\.\/ISVALIDURL\.JS';/, name);
    assert.equal(/function isValidUrl/.test(source), false, name);
  }
  const polygons = read("../polygons.js");
  const resized = polygons.slice(polygons.indexOf("function createResizedImage"), polygons.indexOf("// ── Animated covers"));
  // A failed check no longer swaps the picture for the fallback.
  assert.equal(resized.includes("gif == null"), false);
  assert.equal(resized.includes("unverified image"), false);
  assert.match(resized, /await classifyImageUrl\(url\) === true/);
  assert.match(resized, /return loadElementImage\(url, maxWidth, maxHeight, fallbackUrl\);/);
  const loop = read("../loopmedia.js");
  assert.match(loop, /if \(cached === false \|\| \(cached !== true && gifCheckFailed\(painted\)\)\) \{/);
});
