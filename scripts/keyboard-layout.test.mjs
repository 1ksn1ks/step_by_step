import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  keyboardOpen, nextStableHeight, KB_RATIO, visibleBottom, KB_OPEN_CLASS,
  SHELL_SELECTOR, pinFrame, fieldBelowVisible, pinHeld, restoredScrollTop, scrollCorrection, acceptsShell,
  selectShell, shellAnchored, shellPlacement, settlesOnPin, isTextControl,
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

test("any fixed shell is pinned, and absolute only inside the viewport", () => {
  assert.equal(acceptsShell("fixed", true, false), true);
  assert.equal(acceptsShell("fixed", false, true), true);
  assert.equal(acceptsShell("fixed", false, false), true);
  assert.equal(acceptsShell("absolute", true, true), true);
  assert.equal(acceptsShell("absolute", true, true, true), true);
  assert.equal(acceptsShell("absolute", true, false), false);
  assert.equal(acceptsShell("absolute", false, true), true);
  assert.equal(acceptsShell("absolute", false, true, true), false);
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

test("a dynamically mounted bottom sheet is the shell without being listed", () => {
  const view = { width: 360, height: 800 };
  const sheet = {
    id: "dyn-sheet",
    position: "fixed",
    named: false,
    rect: { top: 520, left: 0, width: 360, height: 280, bottom: 800 },
  };
  const body = { id: "body", position: "fixed", named: false, pageRoot: true };
  const picked = selectShell([
    { position: "static", named: false },
    sheet,
    body,
  ], view);
  assert.equal(picked, sheet);
  assert.equal(SHELL_SELECTOR.includes("#dyn-sheet"), false);
  assert.equal(shellAnchored(sheet.rect, 800), true);
  assert.deepEqual(
    shellPlacement({ offsetTop: 0, viewH: 420, layoutH: 800, ownHeight: 280, bottomAnchored: true }),
    { top: 140, height: 280, bottom: "auto" },
  );
  assert.deepEqual(
    shellPlacement({ offsetTop: 12, viewH: 400, layoutH: 800, ownHeight: 520, bottomAnchored: true }),
    { top: 12, height: 400, bottom: "auto" },
  );
});

test("full-screen canvases stay put and named sheets still win", () => {
  const view = { width: 360, height: 800 };
  const full = { top: 0, left: 0, width: 360, height: 800, bottom: 800 };
  const map = { id: "map", position: "absolute", named: false, rect: full, parentRect: full };
  assert.equal(selectShell([map, { position: "fixed", pageRoot: true }], view), null);
  const frame = { id: "feed-frame", position: "absolute", named: false, rect: full, parentRect: full };
  const layout = { id: "feed-layout", position: "fixed", named: false, rect: full };
  assert.equal(selectShell([frame, layout], view), layout);
  const chat = { id: "feed-chat", position: "absolute", named: true, rect: full, parentRect: full };
  assert.equal(selectShell([chat, frame, layout], view), chat);
  const card = {
    id: "comments-modal",
    position: "absolute",
    named: true,
    rect: { top: 40, left: 180, width: 160, height: 400 },
    parentRect: { top: 20, left: 20, width: 200, height: 420 },
  };
  const popup = { id: "popup", position: "fixed", named: false, rect: full };
  assert.equal(selectShell([card, popup], view), popup);
  assert.equal(shellAnchored(full, 800), false);
  assert.deepEqual(
    shellPlacement({ offsetTop: 0, viewH: 420, layoutH: 800, ownHeight: 800, bottomAnchored: false }),
    { top: 0, height: 420, bottom: "auto" },
  );
});

test("an inputmode=decimal field is a text control", () => {
  const decimal = {
    nodeType: 1,
    tagName: "INPUT",
    type: "text",
    inputMode: "decimal",
    isContentEditable: false,
  };
  assert.equal(isTextControl(decimal), true);
  assert.equal(isTextControl({ ...decimal, type: "" }), true);
  assert.equal(isTextControl({ ...decimal, type: "number" }), true);
  assert.equal(isTextControl({ ...decimal, type: "checkbox" }), false);
  assert.equal(isTextControl({ ...decimal, type: "hidden" }), false);
  assert.equal(settlesOnPin({
    animationName: "donate-sheet-up",
    playState: "running",
    timing: { iterations: 1 },
    properties: ["transform"],
  }), true);
  assert.equal(settlesOnPin({
    animationName: "early-hashinal-angle",
    playState: "running",
    timing: { iterations: Infinity },
    properties: ["--eh-angle"],
  }), false);
  assert.equal(settlesOnPin({
    animationName: "early-holder-glow",
    playState: "running",
    timing: { iterations: "infinite" },
    properties: ["opacity"],
  }), false);
  assert.equal(settlesOnPin({
    playState: "running",
    timing: { iterations: 1 },
    properties: ["opacity"],
  }), false);
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
