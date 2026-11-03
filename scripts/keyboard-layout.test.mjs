import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  keyboardOpen, nextStableHeight, KB_RATIO, visibleBottom, KB_OPEN_CLASS,
  SHELL_SELECTOR, pinFrame, fieldBelowVisible, pinHeld, restoredScrollTop, scrollCorrection, acceptsShell,
} from "../keyboardlayout.js";

function source(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

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

test("a shell pins to the visible band and restores its scroll", () => {
  assert.deepEqual(pinFrame(280, 400), { top: 280, height: 400, bottom: "auto" });
  assert.deepEqual(pinFrame(280, 400, 740), { top: 280, height: 400, bottom: "auto" });
  assert.equal(pinFrame(280, 400, 740).top + pinFrame(280, 400, 740).height, visibleBottom(280, 400, 740));
  assert.deepEqual(pinFrame(0, 400, 400), { top: 0, height: 400, bottom: "auto" });
  // Installed WebView: visualViewport.height stays full, innerHeight shrinks.
  assert.deepEqual(pinFrame(0, 740, 400), { top: 0, height: 400, bottom: "auto" });
  assert.equal(pinFrame(0, 740, 400).height, visibleBottom(0, 740, 400));
  assert.deepEqual(pinFrame(Number.NaN, -5, 0), { top: 0, height: 0, bottom: "auto" });

  assert.equal(fieldBelowVisible(682, 680), true);
  assert.equal(fieldBelowVisible(681, 680), false);
  assert.equal(fieldBelowVisible(680, 680), false);
  assert.equal(fieldBelowVisible(Number.NaN, 680), false);

  assert.equal(pinHeld(false, true, true, true, 400, 740), false);
  assert.equal(pinHeld(true, true, false, false, 400, 740), true);
  assert.equal(pinHeld(true, false, true, false, 700, 740), true);
  assert.equal(pinHeld(true, false, false, false, 700, 740), false);
  assert.equal(pinHeld(true, false, false, true, 700, 740), true);
  assert.equal(pinHeld(true, false, false, true, 738, 740), false);
  assert.equal(pinHeld(true, false, false, true, 0, 740), false);

  assert.equal(restoredScrollTop(120, 400), 120);
  assert.equal(restoredScrollTop(900, 400), 400);
  assert.equal(restoredScrollTop(0, 400), 0);
  assert.equal(restoredScrollTop(-4, 400), 0);
  assert.equal(restoredScrollTop(Number.NaN, 400), 0);

  // Layout-viewport scrollIntoView can leave the field above offsetTop.
  assert.equal(scrollCorrection(329, 400, 342, 828), -13);
  assert.equal(scrollCorrection(350, 900, 342, 828), 72);
  assert.equal(scrollCorrection(100, 900, 342, 828), 100 - 342);
  assert.equal(scrollCorrection(400, 500, 342, 828), 0);
  assert.equal(scrollCorrection(341, 400, 342, 828), 0);
  assert.equal(scrollCorrection(Number.NaN, 400, 342, 828), 0);
});

test("only a full-screen fixed or absolute shell is pinned", () => {
  assert.equal(acceptsShell("fixed", true, false), true);
  assert.equal(acceptsShell("fixed", false, true), true);
  assert.equal(acceptsShell("fixed", false, false), false);
  assert.equal(acceptsShell("absolute", true, true), true);
  assert.equal(acceptsShell("absolute", true, false), false);
  assert.equal(acceptsShell("absolute", false, true), false);
  assert.equal(acceptsShell("relative", true, true), false);
  assert.equal(KB_OPEN_CLASS, "kb-open");
  for (const id of [
    "#topic-chat-container",
    "#encrypted-chat-container",
    "#feed-chat",
    ".comments-modal",
    "#feed-search-page",
    "#popup-settings-card",
    ".picker-sheet",
    "#draw-column",
    "#search-bar",
    "#donate-sheet",
  ]) {
    assert.equal(SHELL_SELECTOR.includes(id), true);
  }
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

  assert.equal(visibleBottom(0, 370, 740, 2), 740);
  assert.equal(visibleBottom(0, 200, 740, 2), 400);
  assert.equal(visibleBottom(280, 200, 740, 2), 680);
  // The pin box stays on the raw visual viewport. Zoom never reaches it
  // because keyboardOpen is false and the field is not below that edge.
  assert.deepEqual(pinFrame(0, 370, 740), { top: 0, height: 370, bottom: "auto" });
});

test("the visible bottom includes the visual viewport offset", () => {
  assert.equal(visibleBottom(280, 400), 680);
  assert.equal(visibleBottom(280, 400, 740), 680);
  assert.equal(visibleBottom(0, 740, 400), 400);
  const edge = visibleBottom(280, 400);
  assert.equal(fieldBelowVisible(700, edge), true);
  assert.equal(fieldBelowVisible(360, edge), false);
  assert.equal(fieldBelowVisible(260, edge), false);
});

test("the dock lift and the padding hack are gone", () => {
  const layout = source("../keyboardlayout.js");
  for (const gone of ["liftBar", "sideDocks", "keepLifts", "data-kb-dock", "data-kb-pad", "data-kb-lift", "liftPx", "DOCK_SELECTOR"]) {
    assert.equal(layout.includes(gone), false, gone);
  }
  for (const rel of ["../index.html", "../style.css", "../feedlayout.js", "../donations.js", "../processallmessages.js"]) {
    const text = source(rel);
    assert.equal(text.includes("data-kb-dock"), false, rel);
    assert.equal(text.includes("kbDock"), false, rel);
    assert.equal(text.includes("data-kb-pad"), false, rel);
  }
});
