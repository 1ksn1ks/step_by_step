import test from "node:test";
import assert from "node:assert/strict";
import { keyboardOpen, nextStableHeight, liftPx, fieldOutside, scrollDelta, KB_RATIO } from "../keyboardlayout.js";

test("the keyboard is a focused field and a drop past about 25%", () => {
  assert.equal(KB_RATIO, 0.75);
  assert.equal(keyboardOpen(true, 400, 740), true);
  assert.equal(keyboardOpen(true, 600, 740), false);
  assert.equal(keyboardOpen(false, 400, 740), false);
  assert.equal(keyboardOpen(true, 400, 0), false);
});

test("the frozen height holds through a keyboard shrink and follows a real resize", () => {
  const held = {
    viewH: 400,
    layoutH: 400,
    stableH: 740,
    stableW: 360,
    width: 360,
    orient: "port",
    prevOrient: "port",
    focused: true,
  };
  assert.equal(nextStableHeight(held), 740);

  const overlaid = { ...held, layoutH: 740 };
  assert.equal(nextStableHeight(overlaid), 740);

  const turned = { ...held, width: 800, layoutH: 360, viewH: 200, orient: "land" };
  assert.equal(nextStableHeight(turned), 360);

  const closed = { ...held, focused: false, viewH: 700, layoutH: 700 };
  assert.equal(nextStableHeight(closed), 700);

  const urlBar = { ...closed, dvh: 690, layoutH: 800, viewH: 690, stableH: 740 };
  assert.equal(nextStableHeight(urlBar), 690);

  assert.equal(nextStableHeight({ ...held, stableH: 0, viewH: 740, layoutH: 800 }), 800);
});

test("a composer lifts once and a field already on screen does not scroll", () => {
  assert.equal(liftPx(700, 0, 400), 308);
  assert.equal(liftPx(392, -308, 400), 308);
  assert.equal(liftPx(380, 0, 400), 0);
  assert.equal(fieldOutside(20, 80, 400), false);
  assert.equal(fieldOutside(-4, 40, 400), true);
  assert.equal(fieldOutside(20, 420, 400), true);
  assert.equal(scrollDelta(20, 80, 400), 0);
  assert.equal(scrollDelta(236, 270, 234), 44);
  assert.equal(scrollDelta(-12, 40, 400), -20);
});
