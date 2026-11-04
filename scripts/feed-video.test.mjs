// Which feed video is allowed to play. No DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEED_VIDEO_DWELL_MS, FEED_VIDEO_MIN, FEED_VIDEO_RELEASE_MS, FEED_VIDEO_THRESHOLDS, feedAutoplayAllowed, feedVideoHeld, feedVideoPreloadOnPause, feedVideoShouldRelease, feedVideoStartDelay, feedVideosToMeasure, pickFeedVideo } from "../feedvideo.js";

test("the feed video observer thresholds include the 0.6 play line", () => {
  assert.equal(FEED_VIDEO_MIN, 0.6);
  assert.deepEqual([...FEED_VIDEO_THRESHOLDS], [0, 0.25, 0.5, 0.6, 0.75, 1]);
});

test("autoplay picks the single most visible video at or above 0.6", () => {
  const rows = [
    { id: "low", ratio: 0.5 },
    { id: "edge", ratio: 0.6 },
    { id: "best", ratio: 0.91 },
    { id: "mid", ratio: 0.75 },
  ];
  assert.equal(pickFeedVideo(rows), "best");
  assert.equal(pickFeedVideo([{ id: "a", ratio: 0.59 }, { id: "b", ratio: 0 }]), null);
  assert.equal(pickFeedVideo([]), null);
  assert.equal(pickFeedVideo(null), null);
});

test("a video that falls under 0.6 yields to the next best", () => {
  const rows = [
    { id: "was", ratio: 0.4 },
    { id: "next", ratio: 0.7 },
    { id: "small", ratio: 0.6 },
  ];
  assert.equal(pickFeedVideo(rows, { current: "was" }), "next");
});

test("an equal visible ratio keeps the video that is already playing", () => {
  const rows = [{ id: "a", ratio: 0.8 }, { id: "b", ratio: 0.8 }];
  assert.equal(pickFeedVideo(rows, { current: "b" }), "b");
  assert.equal(pickFeedVideo(rows, { current: "a" }), "a");
  assert.equal(pickFeedVideo(rows), "a");
});

test("a video the user started stays until it leaves the scroller", () => {
  const both = [{ id: "tapped", ratio: 0.25 }, { id: "taller", ratio: 1 }];
  assert.equal(pickFeedVideo(both, { preferred: "tapped", current: "taller" }), "tapped");
  const gone = [{ id: "tapped", ratio: 0 }, { id: "taller", ratio: 0.8 }];
  assert.equal(pickFeedVideo(gone, { preferred: "tapped" }), "taller");
});

test("autoplay waits a quarter second and a user start does not", () => {
  assert.equal(FEED_VIDEO_DWELL_MS, 250);
  assert.equal(feedVideoStartDelay({ id: "a" }), 250);
  assert.equal(feedVideoStartDelay({ id: "a", user: true }), 0);
  assert.equal(feedVideoStartDelay({ id: "a", playing: true }), 0);
  assert.equal(feedVideoStartDelay(null), 0);
});

test("an autoplay pause drops preload to metadata and a visible user video does not", () => {
  assert.equal(feedVideoPreloadOnPause({ hasSrc: true, ratio: 0.2, user: false }), "metadata");
  assert.equal(feedVideoPreloadOnPause({ hasSrc: true, ratio: 0, user: true }), "metadata");
  assert.equal(feedVideoPreloadOnPause({ hasSrc: true, ratio: 0.4, user: true }), "");
  assert.equal(feedVideoPreloadOnPause({ hasSrc: true, ratio: 0.8, held: true }), "");
  assert.equal(feedVideoPreloadOnPause({ hasSrc: false, ratio: 0 }), "");
  assert.equal(feedVideoHeld({ ratio: 0.2, user: true }), true);
  assert.equal(feedVideoHeld({ ratio: 0, user: true }), false);
});

test("a video at zero visibility releases its file after 3 seconds", () => {
  assert.equal(FEED_VIDEO_RELEASE_MS, 3000);
  assert.equal(feedVideoShouldRelease({ ratio: 0, zeroSince: 1000 }, 3999), false);
  assert.equal(feedVideoShouldRelease({ ratio: 0, zeroSince: 1000 }, 4000), true);
  assert.equal(feedVideoShouldRelease({ ratio: 0.2, zeroSince: 0 }, 99999), false);
  assert.equal(feedVideoShouldRelease({ ratio: 0, user: true, zeroSince: 0 }, 3000), true);
  assert.equal(feedVideoShouldRelease({ ratio: 0.1, user: true, zeroSince: 0 }, 9000), false);
  assert.equal(feedVideoShouldRelease({ ratio: 0 }, 5000), false);
});

test("reduced motion and Save-Data refuse autoplay", () => {
  assert.equal(feedAutoplayAllowed({ autoplay: true }), true);
  assert.equal(feedAutoplayAllowed({ autoplay: false }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, reducedMotion: true }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, saveData: true }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, dataSaver: true, connectionKnown: false }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, dataSaver: true, connectionKnown: true, constrained: true }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, dataSaver: true, connectionKnown: true, constrained: false }), true);
});

test("a scroll frame measures visible videos plus the active and preferred ones", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  const d = { id: "d" };
  const ratios = new Map([[a, 0], [b, 0.2], [c, 0], [d, 1]]);
  assert.deepEqual(feedVideosToMeasure(ratios, c, a), [a, b, c, d]);
  assert.deepEqual(feedVideosToMeasure(new Map([[a, 0], [b, 0]]), null, null), []);
  assert.deepEqual(feedVideosToMeasure(new Map([[a, 0]]), a, a), [a]);
  assert.deepEqual(feedVideosToMeasure(new Map([[b, 0.4]]), null, null), [b]);
  const outside = { id: "out" };
  assert.deepEqual(feedVideosToMeasure(new Map([[b, 0.5]]), outside, null), [b, outside]);
  assert.deepEqual(feedVideosToMeasure(null, outside, outside), [outside]);
  assert.deepEqual(feedVideosToMeasure([[null, 1], [a, 0], [a, 1]], null, null), [a]);
  assert.deepEqual(feedVideosToMeasure([[a, 0.3], [a, 1]], null, null), [a]);
});

test("feed video ratios refresh once per scroll frame", () => {
  const src = readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const observerStart = src.indexOf("function ensureFeedVideoObserver");
  const preferStart = src.indexOf("function preferFeedVideo");
  assert.ok(observerStart > 0 && preferStart > observerStart);
  const observer = src.slice(observerStart, preferStart);
  assert.doesNotMatch(observer, /addEventListener\('scroll'/);
  assert.match(observer, /queueFeedVideos\(\)/);
  const frameStart = src.indexOf("function runScrollFrame");
  const frameEnd = src.indexOf("function viewObserverOptions");
  assert.ok(frameStart > 0 && frameEnd > frameStart);
  const frame = src.slice(frameStart, frameEnd);
  const refreshAt = frame.indexOf("refreshFeedVideoRatios(");
  const readAt = frame.indexOf("readScrollGeometry(");
  assert.ok(refreshAt > 0 && readAt > refreshAt);
  assert.match(frame, /scroller\.getBoundingClientRect\(\)/);
  const armStart = src.indexOf("function armFeedVideoStart");
  const releaseStart = src.indexOf("function releaseFeedVideo");
  assert.ok(armStart > 0 && releaseStart > armStart);
  const arm = src.slice(armStart, releaseStart);
  assert.match(arm, /feedVideoVisibleRatio\(video\)/);
  const refreshStart = src.indexOf("function refreshFeedVideoRatios");
  const refreshEnd = src.indexOf("function ensureFeedVideoObserver");
  const refresh = src.slice(refreshStart, refreshEnd);
  assert.match(refresh, /feedVideosToMeasure\(feedVideoRatio, activeFeedVideo, preferredFeedVideo\)/);
  assert.match(refresh, /if \(!feedVideoRatio\.has\(video\)\) continue/);
});
