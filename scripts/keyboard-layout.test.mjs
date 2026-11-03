import test from "node:test";
import assert from "node:assert/strict";
import {
  keyboardOpen, nextStableHeight, liftPx, fieldOutside, scrollDelta, KB_RATIO,
  visibleBottom,
  DOCK_SELECTOR, KB_OPEN_CLASS, SEARCH_HEAD_SHIFT, liftTransform, dockCover, revealLimit,
} from "../keyboardlayout.js";

test("the keyboard is a focused field and a drop past about 25%", () => {
  assert.equal(KB_RATIO, 0.75);
  assert.equal(keyboardOpen(true, 400, 740), true);
  assert.equal(keyboardOpen(true, 600, 740), false);
  assert.equal(keyboardOpen(false, 400, 740), false);
  assert.equal(keyboardOpen(true, 400, 0), false);
  assert.equal(keyboardOpen(true, 740, 740, 400), true);
  assert.equal(keyboardOpen(true, 400, 740, 740), true);
  assert.equal(keyboardOpen(false, 400, 740, 400), false);
  assert.equal(keyboardOpen(true, 600, 740, 600), false);
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

  const webview = { ...held, viewH: 740, layoutH: 400, dvh: 400 };
  assert.equal(nextStableHeight(webview), 740);

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

test("a dock uses the same lift and keeps the search head shift", () => {
  assert.equal(DOCK_SELECTOR, ".chat-compose, [data-kb-dock]");
  assert.equal(KB_OPEN_CLASS, "kb-open");
  assert.equal(liftTransform(308), "translateY(-308.00px)");
  assert.equal(liftTransform(308, SEARCH_HEAD_SHIFT), "translateY(calc(var(--feed-search-y, 0px) + -308.00px))");
  assert.equal(liftPx(392, -308, 400), 308);
  assert.equal(dockCover(390, 234, 48), 48);
  assert.equal(dockCover(200, 234, 48), 0);
  assert.equal(revealLimit(234, 48), 186);
  assert.equal(revealLimit(234, 0), 234);
  assert.equal(scrollDelta(200, 250, revealLimit(234, 48)), 72);
});

test("pinch-zoom is not the keyboard", () => {
  assert.equal(keyboardOpen(true, 370, 740, 740, 2), false);
  assert.equal(keyboardOpen(true, 370, 740, undefined, 2), false);
  assert.equal(keyboardOpen(true, 370, 740, 740, 1), true);
  assert.equal(keyboardOpen(true, 370, 740, 740, 1.01), true);
  assert.equal(keyboardOpen(true, 200, 740, 740, 2), true);
  assert.equal(keyboardOpen(true, 370, 740, 400, 2), true);

  const zoomed = {
    viewH: 370,
    layoutH: 740,
    dvh: 700,
    stableH: 740,
    stableW: 360,
    width: 360,
    orient: "port",
    prevOrient: "port",
    focused: true,
    scale: 2,
  };
  assert.equal(nextStableHeight(zoomed), 700);
  assert.equal(nextStableHeight({ ...zoomed, viewH: 200, dvh: 400 }), 740);

  const zoomedEdge = visibleBottom(0, 370, 740, 2);
  assert.equal(zoomedEdge, 740);
  assert.equal(liftPx(740, 0, zoomedEdge), liftPx(740, 0, visibleBottom(0, 740, 740)));
  assert.equal(liftPx(740, 0, visibleBottom(0, 200, 740, 2)), 348);
  assert.equal(visibleBottom(280, 200, 740, 2), 680);
});

test("the visible bottom includes the visual viewport offset", () => {
  assert.equal(visibleBottom(280, 400), 680);
  assert.equal(visibleBottom(280, 400, 740), 680);
  assert.equal(visibleBottom(0, 740, 400), 400);
  const edge = visibleBottom(280, 400);
  assert.equal(liftPx(740, 0, edge), 68);
  assert.equal(liftPx(672, -68, edge), 68);
  assert.equal(fieldOutside(300, 360, edge, 8, 280), false);
  assert.equal(fieldOutside(300, 700, edge, 8, 280), true);
  assert.equal(fieldOutside(200, 260, edge, 8, 280), true);
  assert.equal(scrollDelta(640, 700, edge, 8, 280), 28);
  assert.equal(scrollDelta(200, 260, edge, 8, 280), -88);
  assert.equal(dockCover(740, edge, 48), 48);
  assert.equal(dockCover(600, edge, 48), 0);
});
