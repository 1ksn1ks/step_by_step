// Feed query state. No DOM and no feedlayout import.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearQuery, getQuery, matches, onChange, registerFilter, setFilter, setText } from "../feedsearch.js";

beforeEach(() => {
  clearQuery();
  registerFilter("kind", null);
  registerFilter("topic", null);
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
    assert.deepEqual(getQuery(), { text: "", filters: {} });
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
    assert.equal(matches({ payer: "0.0.1" }, { title: "moon landing" }), true);
  } finally {
    stop();
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
    clearQuery();
  }
});
