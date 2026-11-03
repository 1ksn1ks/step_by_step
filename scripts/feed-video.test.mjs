// Which feed video is allowed to play. No DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { FEED_VIDEO_MIN, FEED_VIDEO_THRESHOLDS, feedAutoplayAllowed, pickFeedVideo } from "../feedvideo.js";

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

test("reduced motion and Save-Data refuse autoplay", () => {
  assert.equal(feedAutoplayAllowed({ autoplay: true }), true);
  assert.equal(feedAutoplayAllowed({ autoplay: false }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, reducedMotion: true }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, saveData: true }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, dataSaver: true, connectionKnown: false }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, dataSaver: true, connectionKnown: true, constrained: true }), false);
  assert.equal(feedAutoplayAllowed({ autoplay: true, dataSaver: true, connectionKnown: true, constrained: false }), true);
});
