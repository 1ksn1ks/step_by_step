// Polygon cover video length. No DOM and no upload.
import test from "node:test";
import assert from "node:assert/strict";
import { COVER_VIDEO_MAX_SECONDS, coverVideoTooLong } from "../covervideolimit.js";

test("polygon cover video length rule", () => {
  assert.equal(COVER_VIDEO_MAX_SECONDS, 30);
  assert.equal(coverVideoTooLong(10), false);
  assert.equal(coverVideoTooLong(30), false);
  assert.equal(coverVideoTooLong(30.4), false);
  assert.equal(coverVideoTooLong(30.5), false);
  assert.equal(coverVideoTooLong(31), true);
  assert.equal(coverVideoTooLong(0), true);
  assert.equal(coverVideoTooLong(NaN), true);
  assert.equal(coverVideoTooLong(Infinity), true);
});
