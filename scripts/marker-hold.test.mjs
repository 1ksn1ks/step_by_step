import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindMarkerHold, holdMoveLimit, MARKER_HOLD_MS, MARKER_SWALLOW_MS } from "../markerhold.js";

function target() {
  const listeners = new Map();
  return {
    addEventListener(type, fn, opts) {
      const capture = opts === true || !!(opts && opts.capture);
      const list = listeners.get(type) || [];
      list.push({ fn, capture });
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((entry) => entry.fn !== fn));
    },
    dispatch(type, event) {
      const list = (listeners.get(type) || []).slice();
      let stopped = false;
      event.stopImmediatePropagation = () => { stopped = true; };
      event.stopPropagation = () => {};
      event.preventDefault = () => { event.defaultPrevented = true; };
      for (const entry of list) {
        if (!entry.capture) continue;
        entry.fn(event);
        if (stopped) return;
      }
      for (const entry of list) {
        if (entry.capture) continue;
        entry.fn(event);
        if (stopped) return;
      }
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function press(el, view, type, extra) {
  const event = { pointerId: 1, pointerType: "touch", clientX: 0, clientY: 0, ...extra };
  (type === "pointerdown" || type === "click" ? el : view).dispatch(type, event);
  return event;
}

function setup(show) {
  const el = target();
  const view = target();
  const tip = { className: "marker-title-tip", hidden: true };
  let opened = 0;
  let shownAt = null;
  bindMarkerHold(el, {
    listen: view,
    holdMs: 40,
    swallowMs: 50,
    moveLimit: () => holdMoveLimit(16),
    show(node, x, y) {
      shownAt = { x, y };
      return show(tip, node, x, y);
    },
  });
  el.addEventListener("click", () => { opened += 1; });
  return { el, view, tip, shownAt: () => shownAt, opened: () => opened };
}

test("a touch hold shows the title pill and does not open the popup", async () => {
  const rig = setup((tip) => {
    tip.hidden = false;
    return true;
  });
  press(rig.el, rig.view, "pointerdown", { clientX: 30, clientY: 80 });
  await wait(55);
  assert.equal(rig.tip.hidden, false);
  assert.equal(rig.tip.className, "marker-title-tip");
  assert.deepEqual(rig.shownAt(), { x: 30, y: 80 });
  press(rig.el, rig.view, "pointerup");
  press(rig.el, rig.view, "click");
  assert.equal(rig.opened(), 0);
  assert.equal(rig.tip.hidden, false);
});

test("a click after the swallow window still opens the popup", async () => {
  const rig = setup((tip) => {
    tip.hidden = false;
    return true;
  });
  press(rig.el, rig.view, "pointerdown");
  await wait(55);
  press(rig.el, rig.view, "pointerup");
  await wait(70);
  press(rig.el, rig.view, "click");
  assert.equal(rig.opened(), 1);
  assert.equal(rig.tip.hidden, false);
});

test("map movement before the hold fires cancels it", async () => {
  const el = target();
  const view = target();
  let shown = 0;
  let opened = 0;
  const hold = bindMarkerHold(el, {
    listen: view,
    holdMs: 40,
    show() {
      shown += 1;
      return true;
    },
  });
  el.addEventListener("click", () => { opened += 1; });
  press(el, view, "pointerdown");
  hold.cancelPending();
  await wait(55);
  assert.equal(shown, 0);
  press(el, view, "pointerup");
  press(el, view, "click");
  assert.equal(opened, 1);
});

test("a short tap still opens the popup", async () => {
  const rig = setup(() => {
    throw new Error("a short tap must not show the title");
  });
  press(rig.el, rig.view, "pointerdown", { clientX: 4, clientY: 6 });
  await wait(15);
  press(rig.el, rig.view, "pointerup");
  press(rig.el, rig.view, "click");
  assert.equal(rig.opened(), 1);
  assert.equal(rig.tip.hidden, true);
});

test("moving the finger more than half a rem cancels the hold", async () => {
  const rig = setup((tip) => {
    tip.hidden = false;
    return true;
  });
  const limit = holdMoveLimit(16);
  press(rig.el, rig.view, "pointerdown", { clientX: 10, clientY: 10 });
  press(rig.el, rig.view, "pointermove", { clientX: 10 + limit, clientY: 10 });
  await wait(55);
  assert.equal(rig.tip.hidden, false);

  const moved = setup((tip) => {
    tip.hidden = false;
    return true;
  });
  press(moved.el, moved.view, "pointerdown", { clientX: 10, clientY: 10 });
  press(moved.el, moved.view, "pointermove", { clientX: 10 + limit + 0.5, clientY: 10 });
  await wait(55);
  assert.equal(moved.tip.hidden, true);
  press(moved.el, moved.view, "pointerup");
  press(moved.el, moved.view, "click");
  assert.equal(moved.opened(), 1);
});

test("a hold that does not show the pill still opens the popup", async () => {
  const rig = setup(() => false);
  press(rig.el, rig.view, "pointerdown");
  await wait(55);
  assert.equal(rig.tip.hidden, true);
  press(rig.el, rig.view, "pointerup");
  press(rig.el, rig.view, "click");
  assert.equal(rig.opened(), 1);
});

test("the hold matches the bubble timing and half a rem", () => {
  assert.equal(MARKER_HOLD_MS, 480);
  assert.equal(MARKER_SWALLOW_MS, 600);
  assert.equal(holdMoveLimit(16), 8);
  assert.equal(holdMoveLimit(20), 10);
  assert.equal(holdMoveLimit(0), 8);
});

// marker.js and polygons.js import the map, so their hold cards run here
// from their own source, with a stand-in map, document and tip filler.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
function stubWorld() {
  const docListeners = [];
  const mapListeners = {};
  const canvas = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const node = () => ({
    hidden: false,
    className: "",
    style: {},
    classList: { toggle() {}, remove() {}, add() {} },
    querySelector: () => null,
    prepend() {},
    remove() {},
    setAttribute() {},
  });
  const document = {
    body: { appendChild() {} },
    createElement: node,
    addEventListener(type, fn, capture) { docListeners.push({ type, fn, capture }); },
  };
  const map = {
    on(type, a, b) { (mapListeners[type] ||= []).push(typeof a === "function" ? a : b); },
    getCanvas: () => canvas,
  };
  const press = () => {
    for (const l of docListeners) if (l.type === "pointerdown" && l.capture === true) l.fn({ pointerType: "touch" });
  };
  const fire = (type, event = {}) => { for (const fn of mapListeners[type] || []) fn(event); };
  return { document, map, press, fire, docListeners };
}

function markerTipRig() {
  const source = read("../marker.js");
  const start = source.indexOf("let markerTitleTip = null;");
  const end = source.indexOf("// A right-click on a dot shows its pill");
  assert.ok(start > 0 && end > start);
  const world = stubWorld();
  const api = new Function("document", "map", "window", "fillMapTip", "isPointerOnGlobe", "earlyHashinalNumber", "holdMoveLimit", "getComputedStyle", `
    ${source.slice(start, end)}
    return { showMarkerTitle, showHeldMarkerTitle, tip: () => markerTitleTip };
  `)(world.document, world.map, { matchMedia: () => ({ matches: false }) }, () => true, () => true, () => 0, holdMoveLimit, () => ({ fontSize: "16px" }));
  const dot = { _markerTip: { geometry: { coordinates: [0, 0] } }, _markerPayer: "", style: {} };
  return { ...world, ...api, dot };
}

function polygonTipRig() {
  const source = read("../polygons.js");
  const start = source.indexOf("let polygonTitleTip = null;");
  const end = source.indexOf("// A right-click on a polygon shows its pill");
  const from = source.indexOf("map.on('mouseleave', maskLayerId");
  const cancel = source.indexOf("map.on('touchcancel', maskLayerId");
  const to = source.indexOf("});", cancel) + 3;
  assert.ok(start > 0 && end > start && from > 0 && to > from);
  const world = stubWorld();
  const HOLD_MS = 500;
  const polygon = { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]], payer: "0.0.1" };
  const api = new Function("document", "map", "fillMapTip", "isPointerOnGlobe", "prefetchPersonFollow", "HOLD_MS", "MOVE_TOLERANCE", "polygon", "maskLayerId", `
    ${source.slice(start, end)}
    ${source.slice(from, to)}
    return { showPolygonTitle, tip: () => polygonTitleTip, fromTouch: () => polygonTitleFromTouch };
  `)(world.document, world.map, () => true, () => true, () => {}, HOLD_MS, 10, polygon, "polygon-mask");
  const touch = { point: { x: 50, y: 60 }, originalEvent: { touches: [{ clientX: 50, clientY: 60 }] } };
  return { ...world, ...api, polygon, touch, HOLD_MS };
}

test("a marker's touch-hold card stays open with no input; the next press or a map move closes it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const rig = markerTipRig();
  // The holding press went down before the card showed.
  rig.press();
  assert.equal(rig.showHeldMarkerTitle(rig.dot, 30, 80), true);
  const tip = rig.tip();
  assert.equal(tip.hidden, false);
  assert.equal(tip._held, true);
  // No timer closes it.
  t.mock.timers.tick(60_000);
  assert.equal(tip.hidden, false);
  // The next press does.
  rig.press();
  assert.equal(tip.hidden, true);
  // The map moving does too.
  rig.showHeldMarkerTitle(rig.dot, 30, 80);
  t.mock.timers.tick(10_000);
  assert.equal(tip.hidden, false);
  rig.fire("movestart");
  assert.equal(tip.hidden, true);
  // A right-click card (not held) is left to maptipclick.js.
  rig.showMarkerTitle(rig.dot, 30, 80);
  rig.press();
  assert.equal(tip.hidden, false);
  assert.doesNotMatch(read("../marker.js"), /HOLD_TIP_MS/);
});

test("a polygon's touch-hold card stays open after the finger lifts; the next press or a map move closes it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const rig = polygonTipRig();
  // The holding press: its pointerdown comes first, then the hold.
  rig.press();
  rig.fire("touchstart", rig.touch);
  assert.equal(rig.tip(), null, "nothing before the hold time");
  t.mock.timers.tick(rig.HOLD_MS);
  const tip = rig.tip();
  assert.equal(tip.hidden, false);
  assert.equal(rig.fromTouch(), true);
  // Lifting the finger, the mouse leaving, and time: it stays.
  rig.fire("touchend");
  rig.fire("mouseleave");
  t.mock.timers.tick(60_000);
  assert.equal(tip.hidden, false);
  // The next press closes it.
  rig.press();
  assert.equal(tip.hidden, true);
  assert.equal(rig.fromTouch(), false);
  // Held again, then the map moves.
  rig.press();
  rig.fire("touchstart", rig.touch);
  t.mock.timers.tick(rig.HOLD_MS);
  rig.fire("touchend");
  assert.equal(tip.hidden, false);
  rig.fire("movestart");
  assert.equal(tip.hidden, true);
  // A short tap never shows it.
  rig.fire("touchstart", rig.touch);
  t.mock.timers.tick(rig.HOLD_MS - 100);
  rig.fire("touchend");
  t.mock.timers.tick(5_000);
  assert.equal(tip.hidden, true);
  // A right-click card is maptipclick.js's: a press leaves it, and a touch
  // lifting on the mask still closes it after 1.2 s, as before.
  rig.showPolygonTitle(rig.polygon, { x: 50, y: 60 }, false);
  rig.press();
  assert.equal(tip.hidden, false);
  rig.fire("touchend");
  t.mock.timers.tick(1_199);
  assert.equal(tip.hidden, false);
  t.mock.timers.tick(1);
  assert.equal(tip.hidden, true);
});
