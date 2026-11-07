// Popup settings arrow filters: custom video length and distance. No DOM.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const f = await import("../arrowfilters.js");

test("durations read as seconds, minutes:seconds or units", () => {
  assert.equal(f.parseDuration("90"), 90);
  assert.equal(f.parseDuration("1:30"), 90);
  assert.equal(f.parseDuration("0:45"), 45);
  assert.equal(f.parseDuration("1:02:03"), 3723);
  assert.equal(f.parseDuration("1m30s"), 90);
  assert.equal(f.parseDuration("2 min"), 120);
  assert.equal(f.parseDuration("45s"), 45);
  assert.equal(f.parseDuration(""), null);
  assert.ok(Number.isNaN(f.parseDuration("abc")));
  assert.ok(Number.isNaN(f.parseDuration("1:75")));
  assert.equal(f.formatDuration(90), "1:30");
  assert.equal(f.formatDuration(45), "0:45");
  assert.equal(f.formatDuration(3723), "1:02:03");
  assert.equal(f.formatDuration(null), "");
});

test("a custom length range keeps open ends and swaps a backwards range", () => {
  store.clear();
  assert.deepEqual(f.customLength(), { min: null, max: null });
  assert.deepEqual(f.setCustomLength(90, 10), { min: 10, max: 90 });
  assert.equal(f.secondsMatch(10, "custom"), true);
  assert.equal(f.secondsMatch(90, "custom"), true);
  assert.equal(f.secondsMatch(9, "custom"), false);
  assert.equal(f.secondsMatch(91, "custom"), false);
  f.setCustomLength(60, null);
  assert.equal(f.secondsMatch(3600, "custom"), true);
  assert.equal(f.secondsMatch(59, "custom"), false);
  assert.equal(f.customLengthLabel(), "Over 1:00");
  // A video of unknown length matches only Any.
  assert.equal(f.secondsMatch(null, "custom"), false);
  assert.equal(f.secondsMatch(null, "any"), true);
});

test("the presets keep their old meaning", () => {
  assert.equal(f.secondsMatch(29, "under"), true);
  assert.equal(f.secondsMatch(30, "under"), false);
  assert.equal(f.secondsMatch(30, "mid"), true);
  assert.equal(f.secondsMatch(120, "mid"), true);
  assert.equal(f.secondsMatch(121, "over"), true);
});

test("distances read in km, m or miles", () => {
  assert.equal(f.parseKm("12"), 12);
  assert.equal(f.parseKm("0,5"), 0.5);
  assert.equal(f.parseKm("800 m"), 0.8);
  assert.ok(Math.abs(f.parseKm("5 mi") - 8.04672) < 1e-9);
  assert.equal(f.parseKm(""), null);
  assert.ok(Number.isNaN(f.parseKm("far")));
  assert.equal(f.formatKm(0.5), "500 m");
  assert.equal(f.formatKm(25.4), "25 km");
});

test("distance limits the step to posts near the open one", () => {
  store.clear();
  const paris = [2.35, 48.85];
  const versailles = [2.13, 48.8];
  const london = [-0.12, 51.5];
  assert.ok(Math.abs(f.distanceKm(paris, london) - 343.5) < 2);
  assert.equal(f.radiusKm(), null);
  assert.equal(f.withinRadius(paris, london), true);
  f.setRadiusMode("100");
  assert.equal(f.radiusKm(), 100);
  assert.equal(f.withinRadius(paris, versailles), true);
  assert.equal(f.withinRadius(paris, london), false);
  assert.equal(f.withinRadius(paris, null), false);
  assert.equal(f.radiusLabel(), "within 100 km");
  // Custom with no number yet is Any.
  f.setRadiusMode("custom");
  assert.equal(f.radiusKm(), null);
  f.setCustomRadius(400);
  assert.equal(f.radiusKm(), 400);
  assert.equal(f.withinRadius(paris, london), true);
  f.setRadiusMode("nonsense");
  assert.equal(f.radiusMode(), "custom");
});
