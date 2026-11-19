// Live settings (livegroups.js): Time and Distance are sliders. A tenth of
// an hour is minutes, a whole km from 1 to 100 is kept, and a drag of the
// distance moves the map circle before the release saves it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const body = source.indexOf("{", source.indexOf(")", start));
  assert.notEqual(body, -1, name);
  let depth = 0;
  for (let end = body; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, end + 1);
    }
  }
  assert.fail(`${name} did not close`);
}

const groups = read("../livegroups.js");
const news = read("../localnews.js");
const css = read("../style.css");
const api = new Function(`
  const LIVE_HOURS_MAX = 24;
  const LIVE_RADIUS_MIN_KM = 1;
  const LIVE_RADIUS_MAX_KM = 100;
  let hours = 24;
  ${fnSource(groups, "hourTenths")}
  ${fnSource(groups, "cleanHours")}
  ${fnSource(groups, "cleanRadius")}
  ${fnSource(groups, "liveHoursName")}
  return { cleanHours, cleanRadius, liveHoursName };
`)();

test("time keeps a tenth of an hour from 0.1 to 24, and old whole hours still load", () => {
  assert.equal(api.cleanHours(null), null);
  assert.equal(api.cleanHours(""), null);
  assert.equal(api.cleanHours("no"), null);
  assert.equal(api.cleanHours(0), 0.1);
  assert.equal(api.cleanHours(0.1), 0.1);
  assert.equal(api.cleanHours(0.5), 0.5);
  assert.equal(api.cleanHours(1), 1);
  assert.equal(api.cleanHours(1.5), 1.5);
  assert.equal(api.cleanHours(1.55), 1.6);
  for (const saved of [1, 6, 12, 24]) assert.equal(api.cleanHours(saved), saved);
  assert.equal(api.cleanHours("8"), 8);
  assert.equal(api.cleanHours(30), 24);
  assert.equal(api.cleanHours(-3), 0.1);
});

test("under an hour the name is minutes, and from an hour up it is hours to a tenth", () => {
  assert.equal(api.liveHoursName(0.1), "6 min");
  assert.equal(api.liveHoursName(0.5), "30 min");
  assert.equal(api.liveHoursName(0.9), "54 min");
  assert.equal(api.liveHoursName(1), "1 h");
  assert.equal(api.liveHoursName(1.5), "1.5 h");
  assert.equal(api.liveHoursName(6), "6 h");
  assert.equal(api.liveHoursName(24), "24 h");
});

test("distance keeps any whole km from 1 to 100, including the old presets", () => {
  assert.equal(api.cleanRadius("country"), null);
  assert.equal(api.cleanRadius(0), null);
  assert.equal(api.cleanRadius(-4), null);
  assert.equal(api.cleanRadius(1), 1);
  assert.equal(api.cleanRadius(1.6), 2);
  for (const saved of [10, 25, 50, 100]) assert.equal(api.cleanRadius(saved), saved);
  assert.equal(api.cleanRadius(37), 37);
  assert.equal(api.cleanRadius(250), 100);
  assert.equal(api.cleanRadius(100.4), 100);
});

test("a fractional hour is that many milliseconds, and the empty toast uses the same name", () => {
  assert.equal(Math.round(0.1 * 3600 * 1000), 6 * 60 * 1000);
  assert.equal(Math.round(1.5 * 3600 * 1000), 90 * 60 * 1000);
  const look = fnSource(news, "showLocationMarkers");
  assert.match(look, /Date\.now\(\) - within \* 3600 \* 1000/);
  assert.match(look, /liveHoursName\(within\)/);
  const where = (km, within) => (within >= 24
    ? `${km} km`
    : `${km} km in the last ${api.liveHoursName(within)}`);
  assert.equal(`No live posts within ${where(50, 24)}`, "No live posts within 50 km");
  assert.equal(`No live posts within ${where(50, 0.1)}`, "No live posts within 50 km in the last 6 min");
  assert.equal(`No live posts within ${where(50, 1.5)}`, "No live posts within 50 km in the last 1.5 h");
});

test("the panel is two sliders, Posts from, and Look for Live", () => {
  const build = fnSource(groups, "buildSettings");
  assert.match(build, /settingsSection\('Posts from'\)/);
  assert.match(build, /textContent = '📡 Look for Live'/);
  assert.doesNotMatch(build, /live-settings-pill/);
  assert.doesNotMatch(groups, /LIVE_RADII|LIVE_HOURS = /);

  const slider = fnSource(groups, "addSlider");
  assert.match(slider, /input\.type = 'range'/);
  assert.match(slider, /input\.min = String\(min\)/);
  assert.match(slider, /input\.max = String\(max\)/);
  assert.match(slider, /input\.step = String\(step\)/);
  assert.match(slider, /addEventListener\('input'/);
  assert.match(slider, /addEventListener\('change'/);
  assert.match(slider, /onInput\(n\)/);
  assert.match(slider, /onCommit\(n\)/);

  const distance = build.slice(build.indexOf("settingsSection('Distance'"), build.indexOf("settingsSection('Time'"));
  assert.match(distance, /min: LIVE_RADIUS_MIN_KM/);
  assert.match(distance, /max: LIVE_RADIUS_MAX_KM/);
  assert.match(distance, /step: 1/);
  assert.match(distance, /new CustomEvent\('live-radius-changed'/);
  assert.match(distance, /setLiveRadius\(n\)/);
  assert.match(distance, /settingsChanged\(\)/);
  const distanceInput = distance.slice(distance.indexOf("onInput:"), distance.indexOf("onCommit:"));
  assert.doesNotMatch(distanceInput, /setLiveRadius|settingsChanged/);

  const time = build.slice(build.indexOf("settingsSection('Time'"));
  assert.match(time, /min: LIVE_HOURS_MIN/);
  assert.match(time, /max: LIVE_HOURS_MAX/);
  assert.match(time, /step: 0\.1/);
  assert.match(time, /setLiveHours\(n\)/);
  assert.match(time, /settingsChanged\(\)/);
});

test("the slider is sized in em of the panel, and keyboard focus rings the thumb", () => {
  const at = css.indexOf(".live-settings-slider {");
  const touch = css.indexOf("@media (pointer: coarse) {", at);
  const end = css.indexOf(".live-settings-look {");
  assert.ok(at > 0 && touch > at && end > touch);
  const block = css.slice(at, css.lastIndexOf("/*", touch));
  assert.match(block, /--live-thumb: 1\.15em;/);
  assert.match(block, /--live-track: 0\.18em;/);
  assert.match(block, /height: var\(--live-thumb\);/);
  assert.match(block, /padding: 0 calc\(var\(--live-thumb\) \/ 2\);/);
  assert.match(block, /margin-top: calc\(\(var\(--live-track\) - var\(--live-thumb\)\) \/ 2\);/);
  assert.match(block, /border: 0\.08em solid #22D3EE;/);
  assert.match(block, /box-shadow: 0 0 0\.35em rgba\(34, 211, 238, 0\.45\);/);
  assert.match(block, /touch-action: none/);
  assert.doesNotMatch(block, /var\(--fu\)/);
  assert.doesNotMatch(block, /\dpx/);
  assert.match(block, /\.live-settings-slider:focus,\s*\.live-settings-slider:focus-visible \{\s*outline: none;/);
  assert.match(block, /:focus-visible::-webkit-slider-thumb \{\s*outline: 0\.06em solid/);
  assert.match(block, /:focus-visible::-moz-range-thumb \{\s*outline: 0\.06em solid/);
});

test("on a touch screen the slider is a 44px strip in the gaps, and the WebKit thumb is that tall", () => {
  const at = css.indexOf("@media (pointer: coarse) {", css.indexOf(".live-settings-slider {"));
  const end = css.indexOf(".live-settings-look {");
  assert.ok(at > 0 && end > at);
  const block = css.slice(at, end);
  // The strip: a finger's height, taking the section's 6px gap above and
  // the panel's 10px below, so it meets the hint and the next row.
  assert.match(block, /--live-hit: max\(44px, var\(--live-thumb\)\);/);
  assert.match(block, /height: var\(--live-hit\);\s*margin: -6px 0 -10px;/);
  assert.match(css, /\.live-settings-section \{[^}]*gap: 6px;/);
  assert.match(css, /\.live-settings \{[^}]*gap: 10px;/);
  // iOS drags only from the thumb: it is as tall as the strip, one thumb
  // wide, with the same circle painted in its middle.
  const thumb = block.slice(block.indexOf("::-webkit-slider-thumb {"));
  assert.match(thumb, /height: var\(--live-hit\);/);
  assert.match(thumb, /margin-top: calc\(\(var\(--live-track\) - var\(--live-hit\)\) \/ 2\);/);
  assert.doesNotMatch(thumb, /width:/);
  assert.match(thumb, /border: 0;/);
  assert.match(thumb, /background: radial-gradient\(circle closest-side,/);
  assert.match(thumb, /#22D3EE calc\(100% - var\(--live-ring\)\)/);
  assert.match(thumb, /filter: drop-shadow\(0 0 0\.175em rgba\(34, 211, 238, 0\.45\)\);/);
  // Keyboard focus thickens the ring instead of outlining the tall box.
  assert.match(block, /--live-ring: 0\.08em;/);
  assert.match(block, /\.live-settings-slider:focus-visible \{\s*--live-ring: 0\.2em;/);
  assert.match(thumb, /outline: none;/);
  // Firefox grabs from anywhere on the range: its thumb is left alone.
  assert.doesNotMatch(block, /-moz-range-thumb/);
});
