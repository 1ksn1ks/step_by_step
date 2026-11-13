import test from "node:test";
import assert from "node:assert/strict";
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
