// Feed query state. No DOM and no feedlayout import.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearQuery, getQuery, isActive, matches, onChange, registerFilter, registerSort, setFilter, setSort, setText, sortCmp } from "../feedsearch.js";
import { VIEW_SORT_BATCH, VIEW_SORT_LIMIT, VIEW_SORT_WINDOW, keepScroll, rankedPaintHold, rankedWindowReady, retryAfterMs, viewCountBatches } from "../viewsort.js";

beforeEach(() => {
  clearQuery();
  registerFilter("kind", null);
  registerFilter("topic", null);
  registerFilter("extra", null);
  registerSort("oldest", null);
  registerSort("liked", null);
  registerSort("viewed", null);
});

const post = { payer: "0.0.5" };

test("text match uses the same fields, case, and array message", () => {
  let calls = 0;
  const stop = onChange(() => { calls += 1; });
  try {
    setText("Moon");
    assert.equal(getQuery().text, "Moon");
    assert.equal(calls, 1);
    setText("Moon");
    assert.equal(calls, 1);
    assert.equal(matches(post, { msg: "Hello Moon" }), true);
    assert.equal(matches(post, { msg: ["Hello Moon", "nope"] }), true);
    assert.equal(matches(post, { msg: [null, "moon"] }), false);
    assert.equal(matches(post, { title: "Moonwalk" }), true);
    assert.equal(matches(post, { username: "MoonUser" }), true);
    assert.equal(matches(post, { payer: "0.0.moon" }), true);
    assert.equal(matches(post, { payerInfo: "Moon payer" }), true);
    assert.equal(matches({ payer: "moon.account" }, {}), true);
    assert.equal(matches(post, { title: null, msg: "sun" }), false);
    assert.equal(matches(null, { title: "moon" }), false);
    setText("  Moon  ");
    assert.equal(getQuery().text, "  Moon  ");
    assert.equal(matches(post, { title: "moon" }), true);
    const copy = getQuery();
    copy.text = "nope";
    copy.filters.kind = "marker";
    assert.equal(getQuery().text, "  Moon  ");
    assert.deepEqual(getQuery().filters, {});
    setText("");
    assert.equal(matches(post, { title: "moon" }), false);
  } finally {
    stop();
  }
});

test("a registered filter combines with text", () => {
  registerFilter("kind", (item, record, value) => item.kind === value);
  setText("moon");
  setFilter("kind", "marker");
  const marker = { kind: "marker", payer: "0.0.9" };
  const record = { title: "Moon" };
  assert.equal(matches(marker, record), true);
  assert.equal(matches({ kind: "chat", payer: "0.0.9" }, record), false);
  assert.equal(matches(marker, { title: "sun" }), false);
  setFilter("kind", false);
  assert.deepEqual(getQuery().filters, {});
  assert.equal(matches(marker, record), true);
  setFilter("topic", "moon");
  assert.equal(matches(marker, record), true);
  setText("");
  assert.equal(matches(marker, { title: "moon topic" }), false);
});

test("clearQuery drops text and filters and a second clear is quiet", () => {
  const seen = [];
  const stop = onChange((query) => seen.push(query.text));
  try {
    setText("moon");
    setFilter("kind", "marker");
    clearQuery();
    assert.deepEqual(getQuery(), { text: "", filters: {}, sort: "newest" });
    assert.equal(matches({ kind: "marker", payer: "1" }, { title: "moon" }), false);
    const before = seen.length;
    clearQuery();
    assert.equal(seen.length, before);
    setText(null);
    assert.equal(getQuery().text, "");
    assert.equal(seen.length, before);
  } finally {
    stop();
  }
});

test("a query stays active with no page", () => {
  const events = [];
  const previous = globalThis.window;
  globalThis.window = {
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  const seen = [];
  const stop = onChange((query) => seen.push(query));
  try {
    setText("Moon");
    assert.equal(getQuery().text, "Moon");
    assert.equal(matches({ payer: "0.0.1" }, { title: "moon landing" }), true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].text, "Moon");
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "feed-search");
    assert.equal(events[0].detail.text, "Moon");
    assert.deepEqual(events[0].detail.filters, {});
    assert.equal(getQuery().text, "Moon");
    assert.equal(getQuery().sort, "newest");
    assert.equal(matches({ payer: "0.0.1" }, { title: "moon landing" }), true);
  } finally {
    stop();
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
    clearQuery();
  }
});

test("several filters AND with text, setText keeps them, clearQuery resets sort", () => {
  registerFilter("kind", (item, record, value) => item.kind === value);
  registerFilter("topic", (item, record, value) => record.topic === value);
  registerSort("oldest", (a, b) => a.n - b.n);
  const seen = [];
  const stop = onChange((query) => seen.push(query.sort));
  try {
    setText("moon");
    setFilter("kind", "marker");
    setFilter("topic", "news");
    setSort("oldest");
    assert.equal(seen.at(-1), "oldest");
    assert.equal(getQuery().sort, "oldest");
    assert.equal(sortCmp()( { n: 1 }, { n: 2 } ), -1);
    const marker = { kind: "marker", payer: "0.0.9" };
    assert.equal(matches(marker, { title: "Moon", topic: "news" }), true);
    assert.equal(matches(marker, { title: "Moon", topic: "other" }), false);
    assert.equal(matches({ kind: "chat", payer: "0.0.9" }, { title: "Moon", topic: "news" }), false);
    assert.equal(matches(marker, { title: "sun", topic: "news" }), false);
    setText("");
    assert.equal(getQuery().text, "");
    assert.deepEqual(getQuery().filters, { kind: "marker", topic: "news" });
    assert.equal(getQuery().sort, "oldest");
    assert.equal(matches(marker, { title: "sun", topic: "news" }), true);
    assert.equal(matches(marker, { topic: "other" }), false);
    setSort("oldest");
    const before = seen.length;
    setSort("oldest");
    assert.equal(seen.length, before);
    setSort("");
    assert.equal(getQuery().sort, "newest");
    assert.equal(sortCmp(), null);
    assert.equal(matches(marker, { topic: "news" }), true);
    setSort("liked");
    const copy = getQuery();
    copy.sort = "viewed";
    copy.filters.extra = true;
    assert.equal(getQuery().sort, "liked");
    assert.equal(getQuery().filters.extra, undefined);
    clearQuery();
    assert.deepEqual(getQuery(), { text: "", filters: {}, sort: "newest" });
    const quiet = seen.length;
    clearQuery();
    assert.equal(seen.length, quiet);
    setSort("viewed");
    assert.equal(matches(marker, { title: "moon", topic: "news" }), false);
  } finally {
    stop();
  }
});

test("an unregistered filter key does not count as filtering or hide posts", () => {
  setFilter("nope", true);
  setSort("oldest");
  assert.equal(isActive(), false);
  assert.equal(getQuery().filters.nope, true);
  const posts = [
    [{ payer: "0.0.1", kind: "marker" }, { title: "Moon" }],
    [{ payer: "0.0.2", kind: "chat" }, { msg: ["hello", "there"] }],
    [{ payer: "0.0.3" }, { username: "ada" }],
  ];
  for (const [item, record] of posts) {
    assert.equal(isActive() && !matches(item, record), false);
  }
  setText("moon");
  assert.equal(isActive(), true);
  assert.equal(matches(posts[0][0], posts[0][1]), true);
  setText("   ");
  assert.equal(isActive(), false);
  assert.equal(isActive() && !matches(posts[0][0], posts[0][1]), false);
  setText("");
  registerFilter("kind", (item, _record, value) => item.kind === value);
  setFilter("kind", "marker");
  assert.equal(isActive(), true);
  assert.equal(matches(posts[0][0], { title: "sun" }), true);
  assert.equal(matches(posts[1][0], posts[1][1]), false);
  setFilter("kind", false);
  assert.equal(isActive(), false);
  assert.equal(getQuery().filters.nope, true);
});

test("viewed sort fetches stay under the public rate limit", () => {
  const ids = [];
  for (let i = 0; i < VIEW_SORT_WINDOW; i++) ids.push("m:0.0.1:0.0.2:t:" + i);
  ids.push(ids[0], "", ids[1]);
  const batches = viewCountBatches(ids);
  assert.equal(VIEW_SORT_BATCH, 400);
  assert.equal(batches.length, Math.ceil(VIEW_SORT_WINDOW / VIEW_SORT_BATCH));
  assert.ok(batches.length < VIEW_SORT_LIMIT);
  for (const batch of batches) assert.ok(batch.length <= VIEW_SORT_BATCH);
  assert.equal(batches.flat().length, VIEW_SORT_WINDOW);
  assert.equal(viewCountBatches(null).length, 0);
  assert.equal(viewCountBatches(["a", "a", "b"], 1).length, 2);
});

test("a 429 waits for Retry-After and a re-sort keeps a scrolled list", () => {
  assert.equal(retryAfterMs("12"), 12000);
  assert.equal(retryAfterMs(" 0 "), 0);
  assert.equal(retryAfterMs(""), 1000);
  assert.equal(retryAfterMs(null), 1000);
  assert.equal(retryAfterMs("soon"), 1000);
  const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
  assert.equal(retryAfterMs("Wed, 21 Oct 2015 07:28:05 GMT", now), 5000);
  assert.equal(retryAfterMs("Wed, 21 Oct 2015 07:27:00 GMT", now), 0);
  assert.equal(keepScroll(0), false);
  assert.equal(keepScroll(1.9), false);
  assert.equal(keepScroll(2), true);
  assert.equal(keepScroll("4"), true);
});

test("a ranked window paints once and a scrolled list keeps its place", () => {
  assert.equal(rankedWindowReady(0, 4, false, false), false);
  assert.equal(rankedWindowReady(3, 4, false, false), false);
  assert.equal(rankedWindowReady(4, 4, false, false), true);
  assert.equal(rankedWindowReady(1, 4, true, false), true);
  assert.equal(rankedWindowReady(1, 4, false, true), true);
  assert.equal(rankedPaintHold(false, 80), false);
  assert.equal(rankedPaintHold(true, 0), false);
  assert.equal(rankedPaintHold(true, 1.9), false);
  assert.equal(rankedPaintHold(true, 2), true);
  assert.equal(rankedPaintHold(true, "40"), true);
});
