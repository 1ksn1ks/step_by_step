// Polygon cover autoplay. No DOM and no map. The hook stays off, and the
// three viewer blocks stay in front of any later NFT or topic rule.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  COVER_LOW_BATTERY,
  COVER_RELEASE_MS,
  coverBatteryIsLow,
  coverHoldSrc,
  coverIdsToRelease,
  coverShouldRelease,
  shouldAutoplayCover,
} from "../coverautoplay.js";
import { siblingPosterUrl } from "../mediaurl.js";

const open = { saveData: false, lowBattery: false, reducedMotion: false };

test("cover autoplay stays off, including a later-shaped polygon", () => {
  const polygon = { nft: true, topic: "allow" };
  assert.equal(shouldAutoplayCover(polygon, open), false);
  assert.equal(shouldAutoplayCover(polygon, {}), false);
  assert.equal(shouldAutoplayCover(null, null), false);
  assert.equal(shouldAutoplayCover(undefined, undefined), false);
});

test("Save-Data, low battery, and reduced motion always refuse autoplay", () => {
  const polygon = { nft: true, topic: "allow" };
  assert.equal(shouldAutoplayCover(polygon, { ...open, saveData: true }), false);
  assert.equal(shouldAutoplayCover(polygon, { ...open, lowBattery: true }), false);
  assert.equal(shouldAutoplayCover(polygon, { ...open, reducedMotion: true }), false);
  assert.equal(shouldAutoplayCover(polygon, { saveData: true, lowBattery: true, reducedMotion: true }), false);
});

test("the autoplay hook checks Save-Data, battery, and motion before the rule", () => {
  const source = fs.readFileSync(new URL("../coverautoplay.js", import.meta.url), "utf8");
  const start = source.indexOf("export function shouldAutoplayCover");
  const end = source.indexOf("export function", start + 10);
  const body = source.slice(start, end);
  const save = body.indexOf("view.saveData");
  const battery = body.indexOf("view.lowBattery");
  const motion = body.indexOf("view.reducedMotion");
  const rule = body.lastIndexOf("return false");
  assert.ok(save !== -1 && battery !== -1 && motion !== -1 && rule !== -1);
  assert.ok(save < battery && battery < motion && motion < rule);
  assert.equal(body.includes("return true"), false);
});

test("a battery at 20% or below and not charging is low", () => {
  assert.equal(COVER_LOW_BATTERY, 0.2);
  assert.equal(coverBatteryIsLow({ level: 0.2, charging: false }), true);
  assert.equal(coverBatteryIsLow({ level: 0.19, charging: false }), true);
  assert.equal(coverBatteryIsLow({ level: 0, charging: false }), true);
  assert.equal(coverBatteryIsLow({ level: 0.2, charging: true }), false);
  assert.equal(coverBatteryIsLow({ level: 0.21, charging: false }), false);
  assert.equal(coverBatteryIsLow(null), false);
  assert.equal(coverBatteryIsLow({}), false);
  assert.equal(coverBatteryIsLow({ level: "low" }), false);
});

test("a paused cover keeps its file on screen and gives it back after 3 seconds away", () => {
  assert.equal(COVER_RELEASE_MS, 3000);
  const onScreen = { hasSrc: true, playing: false, userPaused: true, inView: true };
  assert.equal(coverHoldSrc(onScreen), true);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: true }), true);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: false }), false);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: false, inView: false }), false);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: true, hidden: true }), false);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: true, feed: true }), false);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: true, replaced: true }), false);
  assert.equal(coverHoldSrc({ hasSrc: false, playing: true, inView: true }), false);
  assert.equal(coverHoldSrc(null), false);
  assert.equal(coverShouldRelease(0, 2999), false);
  assert.equal(coverShouldRelease(0, 3000), true);
  assert.equal(coverShouldRelease(0, 5000), true);
  assert.equal(coverShouldRelease(null, 3000), false);
  assert.equal(coverShouldRelease(0, "soon"), false);
});

test("starting one cover releases every other", () => {
  assert.deepEqual(coverIdsToRelease(["a", "b", "c"], "b"), ["a", "c"]);
  assert.deepEqual(coverIdsToRelease(["a"], "a"), []);
  assert.deepEqual(coverIdsToRelease(["a", ""], "b"), ["a"]);
  assert.deepEqual(coverIdsToRelease(null, "b"), []);
  assert.deepEqual(coverIdsToRelease(["a"], ""), []);
});

test("a markers video points at its sibling poster and nothing else does", () => {
  assert.equal(
    siblingPosterUrl("https://pub-243.r2.dev/markers/1700000000000-ab12cd.mp4"),
    "https://pub-243.r2.dev/markers/1700000000000-ab12cd.poster.jpg",
  );
  assert.equal(
    siblingPosterUrl("https://pub-243.r2.dev/markers/1700000000000-ab12cd-d12.webm?x=1#t"),
    "https://pub-243.r2.dev/markers/1700000000000-ab12cd-d12.poster.jpg",
  );
  assert.equal(
    siblingPosterUrl("https://example.invalid/media/markers/1-ab.mp4"),
    "https://example.invalid/media/markers/1-ab.poster.jpg",
  );
  assert.equal(siblingPosterUrl("https://pub-243.r2.dev/markers/%2e%2e%2fsecret.mp4"), "");
  assert.equal(siblingPosterUrl("https://pub-243.r2.dev/markers/1-ab.gif"), "");
  assert.equal(siblingPosterUrl("https://pub-243.r2.dev/markers/1-ab.mov"), "");
  assert.equal(siblingPosterUrl("https://cdn.example/ipfs/QmVideo"), "");
  assert.equal(siblingPosterUrl(""), "");
  assert.equal(siblingPosterUrl("not a url"), "");
});

test("a cover video does not take a src until play, except the one frame grab", () => {
  const source = fs.readFileSync(new URL("../polygons.js", import.meta.url), "utf8");
  assert.match(source, /shouldAutoplayCover\(cov\.polygon/);
  assert.match(source, /siblingPosterUrl\(url\)/);
  assert.match(source, /coverHoldSrc\(state\)/);
  assert.match(source, /coverShouldRelease\(cov\.releaseSince/);
  assert.match(source, /coverIdsToRelease\(busy, cov\.sourceId\)/);
  assert.equal(source.includes("preload = 'auto'"), false);
  assert.equal(source.includes('preload = "auto"'), false);

  const grabAt = source.indexOf("function grabCoverFrame");
  const playAt = source.indexOf("function playCover");
  const registerAt = source.indexOf("function registerCover");
  assert.ok(grabAt !== -1 && playAt !== -1 && registerAt !== -1 && grabAt < playAt);
  const grab = source.slice(grabAt, playAt);
  const play = source.slice(playAt, registerAt);
  const register = source.slice(registerAt, source.indexOf("function ensurePump", registerAt));
  assert.match(grab, /preload = 'metadata'/);
  assert.match(grab, /currentTime = 0/);
  assert.match(grab, /removeAttribute\('src'\)/);
  assert.match(grab, /drawImage\(video, 0, 0, 512, 512\)/);
  assert.equal(play.includes("video.src = cov.url"), true);
  assert.equal(register.includes("video.src"), false);
  assert.match(source, /className = 'polygon-cover-play'/);
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const ruleAt = css.indexOf(".polygon-cover-play {");
  assert.ok(ruleAt !== -1);
  const rule = css.slice(ruleAt, css.indexOf(".polygon-cover-play[hidden]", ruleAt));
  assert.match(rule, /max\(44px, calc\(var\(--fu\) \* 3\.6\)\)/);
  assert.match(rule, /#22D3EE/);
  assert.match(rule, /--fu:/);
  assert.match(rule, /--ui-label:/);
  assert.match(rule, /--ui-small:/);
  assert.equal(/\d+px/.test(rule.replaceAll("44px", "")), false);
});
