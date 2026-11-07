// Scroll fills move into one animation frame. The chunk plan is pure.
// The feed module touches document on import, so the wiring is checked
// from source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FILL_PASSES, planFillDown } from "../scrollfill.js";

test("a full column pages a ranked feed and only notes the others", () => {
  const full = {
    top: 0,
    height: 3000,
    view: 800,
    rangeEnd: 30,
    listLen: 100,
    avg: 100,
    canPage: true,
    chunk: 30,
  };
  assert.deepEqual(planFillDown({ ...full, ranked: true }), {
    chunks: 0,
    page: true,
    empty: false,
    again: false,
  });
  assert.deepEqual(planFillDown({ ...full, ranked: false }), {
    chunks: 0,
    page: false,
    empty: true,
    again: false,
  });
});

test("short columns grow by whole chunks until two viewports remain", () => {
  const grown = planFillDown({
    top: 0,
    height: 100,
    view: 800,
    rangeEnd: 0,
    listLen: 500,
    avg: 20,
    canPage: true,
    ranked: false,
    chunk: 30,
  });
  assert.deepEqual(grown, { chunks: 4, page: false, empty: true, again: false });
  const ranked = planFillDown({
    top: 0,
    height: 804,
    view: 800,
    rangeEnd: 0,
    listLen: 100,
    avg: 100,
    canPage: true,
    ranked: true,
    chunk: 30,
  });
  assert.deepEqual(ranked, { chunks: 1, page: true, empty: false, again: false });
});

test("twelve passes stop without paging, and a hidden column adds one chunk", () => {
  assert.equal(FILL_PASSES, 12);
  const capped = planFillDown({
    top: 0,
    height: 0,
    view: 800,
    rangeEnd: 0,
    listLen: 10000,
    avg: 1,
    canPage: true,
    ranked: true,
    chunk: 30,
    cap: 12,
  });
  assert.deepEqual(capped, { chunks: 12, page: false, empty: false, again: false });
  assert.deepEqual(planFillDown({
    top: 0,
    height: 0,
    view: 0,
    rangeEnd: 0,
    listLen: 10,
    avg: 40,
    canPage: true,
    ranked: true,
    chunk: 30,
  }), { chunks: 1, page: false, empty: false, again: false });
  assert.deepEqual(planFillDown({
    top: 0,
    height: 0,
    view: 0,
    rangeEnd: 10,
    listLen: 10,
    avg: 40,
    canPage: true,
    ranked: false,
    chunk: 30,
  }), { chunks: 0, page: true, empty: false, again: false });
});

test("an unknown card height appends one chunk and asks for another frame", () => {
  assert.deepEqual(planFillDown({
    top: 0,
    height: 0,
    view: 800,
    rangeEnd: 0,
    listLen: 100,
    avg: 0,
    canPage: true,
    ranked: true,
    chunk: 30,
  }), { chunks: 1, page: false, empty: false, again: true });
  assert.deepEqual(planFillDown({
    top: 0,
    height: 0,
    view: 800,
    rangeEnd: 0,
    listLen: 20,
    avg: 0,
    canPage: false,
    ranked: false,
    chunk: 30,
  }), { chunks: 1, page: false, empty: false, again: false });
  const spent = planFillDown({
    top: 0,
    height: 0,
    view: 100,
    rangeEnd: 0,
    listLen: 40,
    avg: 1,
    canPage: true,
    ranked: false,
    chunk: 30,
  });
  assert.deepEqual(spent, { chunks: 2, page: true, empty: false, again: false });
});

test("the scroll listener records position and lets one frame fill", () => {
  const src = readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const start = src.indexOf("scroller.addEventListener('scroll', (event) => {");
  const end = src.indexOf("scroller.addEventListener('scrollend'");
  assert.ok(start > 0 && end > start);
  const handler = src.slice(start, end);
  assert.match(handler, /savedScroll = y/);
  assert.match(handler, /tabPending \+= y - tabLastY/);
  assert.match(handler, /queueTabFollow\(\)/);
  assert.match(handler, /armTabFinish\(\)/);
  assert.match(handler, /scheduleScrollWrite\(\)/);
  assert.match(handler, /scheduleScrollFrame\(\)/);
  assert.match(handler, /showFeedTabs\(\)/);
  assert.doesNotMatch(handler, /fillUp\(\)/);
  assert.doesNotMatch(handler, /fillDown\(\)/);
  assert.doesNotMatch(handler, /revealParked\(\)/);
  assert.doesNotMatch(handler, /paintSorted\(\)/);
  const frameStart = src.indexOf("function runScrollFrame");
  const frameEnd = src.indexOf("function viewObserverOptions");
  const frame = src.slice(frameStart, frameEnd);
  assert.ok(frameStart > 0 && frameEnd > frameStart);
  const readAt = frame.indexOf("readScrollGeometry(");
  const fillAt = frame.indexOf("frameFillUp(");
  assert.ok(readAt > 0 && fillAt > readAt);
  assert.match(frame, /paintSorted\(\)/);
  assert.match(frame, /planFillDown\(/);
  assert.match(frame, /frameReveal\(/);
  assert.match(frame, /syncVisibleViews\(\)/);
  assert.doesNotMatch(frame, /clampPending\(/);
  const restore = src.slice(src.indexOf("function restoreTabView"), src.indexOf("async function loadOlder"));
  assert.match(restore, /fillDown\(\)/);
  assert.match(restore, /fillUp\(\)/);
  assert.match(restore, /revealParked\(\)/);
  const finish = src.slice(src.indexOf("function finishRanked"), src.indexOf("function laneFloor"));
  assert.match(finish, /sortHold = false/);
  assert.match(finish, /paintSorted\(\)/);
  assert.match(finish, /fillDown\(\)/);
});

test("caption clamp measures after the class write and only when cards are added", () => {
  const src = readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const start = src.indexOf("function clampPending");
  const end = src.indexOf("function topicNow");
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.doesNotMatch(body, /getBoundingClientRect/);
  const addAt = body.indexOf("classList.add('is-clamped')");
  const readAt = body.indexOf("scrollHeight > text.clientHeight + 1");
  const dropAt = body.indexOf("classList.remove('is-clamped')");
  const moreAt = body.indexOf("textContent = 'Show more'");
  assert.ok(addAt > 0 && readAt > addAt && dropAt > readAt && moreAt > readAt);
  // Show more opens the full-screen text page, as in the popups; the card
  // stays clamped (no inline Show less).
  assert.match(body, /openPopupText\(/);
  assert.doesNotMatch(body, /Show less/);
  for (const name of ["function renderThrough", "function fillUp", "function frameFillUp", "function prependAbove", "function mountIncoming", "function frameReveal"]) {
    const at = src.indexOf(name);
    const next = src.indexOf("\nfunction ", at + name.length);
    const fn = src.slice(at, next);
    assert.match(fn, /requestAnimationFrame\(clampPending\)/);
  }
});
