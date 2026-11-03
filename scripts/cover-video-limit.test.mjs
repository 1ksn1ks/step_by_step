// Polygon cover video length. No DOM and no upload.
import test from "node:test";
import assert from "node:assert/strict";
import { COVER_VIDEO_MAX_SECONDS, COVER_VIDEO_PROBE_MS, COVER_VIDEO_UNKNOWN_TOAST, coverVideoLengthUnknown, coverVideoReject, coverVideoTooLong } from "../covervideolimit.js";

test("polygon cover video length rule", () => {
  assert.equal(COVER_VIDEO_MAX_SECONDS, 30);
  assert.equal(COVER_VIDEO_PROBE_MS > 5000, true);
  assert.equal(coverVideoTooLong(10), false);
  assert.equal(coverVideoTooLong(30), false);
  assert.equal(coverVideoTooLong(30.4), false);
  assert.equal(coverVideoTooLong(30.5), false);
  assert.equal(coverVideoTooLong(30.51), true);
  assert.equal(coverVideoTooLong(31), true);
  assert.equal(coverVideoTooLong(0), false);
  assert.equal(coverVideoTooLong(NaN), false);
  assert.equal(coverVideoTooLong(Infinity), false);
  assert.equal(coverVideoTooLong(null), false);
  assert.equal(coverVideoLengthUnknown(null), true);
  assert.equal(coverVideoLengthUnknown(undefined), true);
  assert.equal(coverVideoLengthUnknown(0), true);
  assert.equal(coverVideoLengthUnknown(NaN), true);
  assert.equal(coverVideoLengthUnknown(Infinity), true);
  assert.equal(coverVideoLengthUnknown(-1), true);
  assert.equal(coverVideoLengthUnknown(10), false);
  assert.equal(coverVideoReject(31), "Cover video max 30 seconds");
  assert.equal(coverVideoReject(null), COVER_VIDEO_UNKNOWN_TOAST);
  assert.equal(coverVideoReject(0), COVER_VIDEO_UNKNOWN_TOAST);
  assert.notEqual(coverVideoReject(null), coverVideoReject(31));
  assert.match(COVER_VIDEO_UNKNOWN_TOAST, /MP4\/H\.264/);
  assert.equal(coverVideoReject(12), "");
  assert.equal(coverVideoReject(30.5), "");
});
