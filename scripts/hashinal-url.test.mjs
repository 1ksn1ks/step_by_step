// Hashinal (HCS-1) links: our /api/hcs1/<topicId> route first, Kiloscribe
// only as the fallback, then the local copy of the default avatar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.location = { origin: "https://onlyonhbar.com" };
const {
  DEFAULT_AVATAR,
  DEFAULT_MODEL,
  HASHINAL_PLACEHOLDER,
  attachHashinalFallback,
  hashinalFallbackUrl,
  hashinalTopicOf,
  hashinalUrl,
  isHashinalTopicId,
  kiloscribeUrl,
  resolveHashinalSrc,
} = await import("../hashinalurl.js");

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("hashinalUrl points at our route, and only for a topic id", () => {
  assert.equal(hashinalUrl("0.0.4819119"), "https://onlyonhbar.com/api/hcs1/0.0.4819119");
  assert.equal(hashinalUrl("0.0.9742046"), "https://onlyonhbar.com/api/hcs1/0.0.9742046");
  assert.equal(DEFAULT_AVATAR, "https://onlyonhbar.com/api/hcs1/0.0.4819119");
  assert.equal(DEFAULT_MODEL, "https://onlyonhbar.com/api/hcs1/0.0.9742046");
  assert.equal(HASHINAL_PLACEHOLDER, "https://onlyonhbar.com/hashinal-placeholder.png");
  for (const bad of ["", "0.0.", "0.0.abc", "1.2.3", "0.0.5/../x", " 0.0.5", null, undefined, 5]) {
    assert.equal(isHashinalTopicId(bad), false, String(bad));
    assert.equal(hashinalUrl(bad), HASHINAL_PLACEHOLDER, String(bad));
    assert.equal(kiloscribeUrl(bad), HASHINAL_PLACEHOLDER, String(bad));
  }
  assert.equal(kiloscribeUrl("0.0.4819119"), "https://kiloscribe.com/api/inscription-cdn/0.0.4819119");
  // The placeholder ships with the app.
  assert.ok(fs.statSync(new URL("../public/hashinal-placeholder.png", import.meta.url)).size > 0);
});

test("hcs://1 and Kiloscribe links are read from our route; others stay", () => {
  assert.equal(resolveHashinalSrc("hcs://1/0.0.4819119"), "https://onlyonhbar.com/api/hcs1/0.0.4819119");
  assert.equal(resolveHashinalSrc(" hcs://1/0.0.123 "), "https://onlyonhbar.com/api/hcs1/0.0.123");
  assert.equal(resolveHashinalSrc("https://kiloscribe.com/api/inscription-cdn/0.0.77"), "https://onlyonhbar.com/api/hcs1/0.0.77");
  for (const same of [
    "https://pub-x.r2.dev/markers/1",
    "ipfs://QmSomething",
    "hcs://1/0.0.abc",
    "hcs://2/0.0.5",
    "https://kiloscribe.com/other/0.0.5",
    "",
  ]) {
    assert.equal(resolveHashinalSrc(same), same);
  }
  assert.equal(resolveHashinalSrc(null), null);
  assert.equal(resolveHashinalSrc(undefined), undefined);
});

test("models and our own links: the topic, and Kiloscribe as the backup", () => {
  assert.equal(hashinalTopicOf("https://onlyonhbar.com/api/hcs1/0.0.9742046"), "0.0.9742046");
  assert.equal(hashinalTopicOf("https://localhost:5173/api/hcs1/0.0.8412117?x=1"), "0.0.8412117");
  assert.equal(hashinalTopicOf("/api/hcs1/0.0.8392276"), "0.0.8392276");
  assert.equal(hashinalTopicOf("https://onlyonhbar.com/api/hcs1/0.0.9742046/extra"), "");
  assert.equal(hashinalTopicOf("https://kiloscribe.com/api/inscription-cdn/0.0.9742046"), "");
  assert.equal(hashinalFallbackUrl(DEFAULT_MODEL), "https://kiloscribe.com/api/inscription-cdn/0.0.9742046");
  assert.equal(hashinalFallbackUrl("https://pub-x.r2.dev/model.glb"), "");
});

// An <img> just big enough for the fallback steps.
function fakeImage(src) {
  const listeners = [];
  const img = {
    tagName: "IMG",
    dataset: {},
    src,
    getAttribute(name) { return name === "src" ? this.src : null; },
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
  };
  const fail = () => {
    let stopped = false;
    const event = { target: img, currentTarget: img, stopImmediatePropagation() { stopped = true; } };
    for (const l of listeners) if (l.type === "error") l.fn(event);
    return stopped;
  };
  return { img, fail, listeners };
}

test("a failed image tries Kiloscribe, then the local copy, and never loops", () => {
  const { img, fail, listeners } = fakeImage(DEFAULT_AVATAR);
  attachHashinalFallback(img, "0.0.4819119");
  attachHashinalFallback(img, "0.0.4819119");
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].capture, true);
  // Our route fails: Kiloscribe. The page's own handlers are held back.
  assert.equal(fail(), true);
  assert.equal(img.src, "https://kiloscribe.com/api/inscription-cdn/0.0.4819119");
  // Kiloscribe fails: the local copy.
  assert.equal(fail(), true);
  assert.equal(img.src, HASHINAL_PLACEHOLDER);
  // The local copy fails: nothing more from here; the page decides.
  assert.equal(fail(), false);
  assert.equal(img.src, HASHINAL_PLACEHOLDER);
  // A page that repaints our route gets a new round...
  img.src = DEFAULT_AVATAR;
  assert.equal(fail(), true);
  assert.equal(img.src, "https://kiloscribe.com/api/inscription-cdn/0.0.4819119");
  assert.equal(fail(), true);
  assert.equal(img.src, HASHINAL_PLACEHOLDER);
  // ...but one that puts it back on every error is left alone after six
  // swaps: no loop.
  let swaps = 4;
  for (let i = 0; i < 20; i++) {
    img.src = DEFAULT_AVATAR;
    if (fail()) swaps += 1;
    if (img.src.startsWith("https://kiloscribe.com/") && fail()) swaps += 1;
  }
  assert.equal(swaps, 6);
  img.src = DEFAULT_AVATAR;
  assert.equal(fail(), false);
  assert.equal(img.src, DEFAULT_AVATAR);
});

test("a new topic on the same image starts its own steps", () => {
  const { img, fail } = fakeImage(hashinalUrl("0.0.1"));
  attachHashinalFallback(img);
  assert.equal(fail(), true);
  assert.equal(img.src, kiloscribeUrl("0.0.1"));
  img.src = hashinalUrl("0.0.2");
  assert.equal(fail(), true);
  assert.equal(img.src, kiloscribeUrl("0.0.2"));
  // Other images are left to the page.
  const other = fakeImage("https://pub-x.r2.dev/markers/1");
  attachHashinalFallback(other.img);
  assert.equal(other.fail(), false);
  assert.equal(other.img.src, "https://pub-x.r2.dev/markers/1");
});

test("no client file hardcodes Kiloscribe; the defaults come from one place", () => {
  const files = fs.readdirSync(new URL("..", import.meta.url)).filter((name) => /\.(js|html)$/i.test(name));
  for (const name of files) {
    if (name === "hashinalurl.js") continue;
    assert.equal(read(`../${name}`).includes("kiloscribe.com"), false, name);
  }
  assert.match(read("../picturecache.js"), /export const DEFAULT_PROFILE_PIC = DEFAULT_AVATAR;/);
  assert.match(read("../profileface.js"), /export const DEFAULT_PIC = DEFAULT_AVATAR;/);
  assert.match(read("../polygons.js"), /const COVER_FALLBACK = DEFAULT_AVATAR;/);
  assert.match(read("../letall.js"), /export let defaultModelUrl = DEFAULT_MODEL;/);
  assert.match(read("../loadP2PModels.js"), /const BOT_URLS = \['0\.0\.9742046', '0\.0\.8412117', '0\.0\.8392276'\]\.map\(hashinalUrl\);/);
  // WalletConnect shows the icon outside the app: an absolute link.
  assert.match(read("../web3.js"), /icons: \["https:\/\/onlyonhbar\.com\/api\/hcs1\/0\.0\.4819119"\]/);
  assert.match(read("../index.html"), /<img class="mb-chat-preview-face" alt="" src="\/api\/hcs1\/0\.0\.4819119">/);
  // Both model loaders retry once on Kiloscribe.
  assert.match(read("../loadP2PModels.js"), /const backup = hashinalFallbackUrl\(url\);/);
  assert.match(read("../loadUFOModel.js"), /const backup = hashinalFallbackUrl\(modelUrl\);/);
  // Stored picture links are resolved where profile pictures are taken in.
  assert.equal(read("../loadalladata.js").split("resolveHashinalSrc(").length - 1, 3);
});
