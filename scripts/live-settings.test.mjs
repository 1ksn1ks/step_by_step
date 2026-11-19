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

const SLIDER_STEPS = Number(groups.match(/const SLIDER_STEPS = (\d+);/)[1]);
// The log scale and the slider itself, with a document that makes plain
// EventTargets for elements.
class FakeElement extends EventTarget {
  constructor() {
    super();
    this.value = "";
    this.textContent = "";
    this.attrs = {};
    this.title = null;
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  appendChild(child) { return child; }
  querySelector() { return this.title; }
}
const fakeDocument = { createElement: () => new FakeElement() };
const scale = new Function("document", `
  const LIVE_HOURS_MAX = 24;
  const LIVE_RADIUS_MIN_KM = 1;
  const LIVE_RADIUS_MAX_KM = 100;
  const SLIDER_STEPS = ${SLIDER_STEPS};
  let hours = 24;
  ${fnSource(groups, "hourTenths")}
  ${fnSource(groups, "cleanHours")}
  ${fnSource(groups, "cleanRadius")}
  ${fnSource(groups, "liveHoursName")}
  ${fnSource(groups, "sliderValue")}
  ${fnSource(groups, "sliderPos")}
  ${fnSource(groups, "addSlider")}
  return { sliderValue, sliderPos, addSlider, cleanHours, cleanRadius, liveHoursName };
`)(fakeDocument);

const km = (pos) => scale.cleanRadius(scale.sliderValue(pos, 1, 100));
const hrs = (pos) => scale.cleanHours(scale.sliderValue(pos, 0.1, 24));

test("the sliders are a log scale: 6 min to 1 h is 42% of Time, 1 to 10 km half of Distance", () => {
  const share = (value, min, max) => scale.sliderPos(value, min, max) / SLIDER_STEPS;
  assert.equal(scale.sliderPos(1, 1, 100), 0);
  assert.equal(scale.sliderPos(100, 1, 100), SLIDER_STEPS);
  assert.equal(scale.sliderPos(0.1, 0.1, 24), 0);
  assert.equal(scale.sliderPos(24, 0.1, 24), SLIDER_STEPS);
  assert.equal(km(0), 1);
  assert.equal(km(SLIDER_STEPS), 100);
  assert.equal(hrs(0), 0.1);
  assert.equal(hrs(SLIDER_STEPS), 24);
  // Linear these were 9% and 4%.
  assert.equal(share(10, 1, 100), 0.5);
  assert.ok(Math.abs(share(1, 0.1, 24) - 0.42) < 0.005);
  assert.ok(Math.abs(share(30 / 60, 0.1, 24) - 0.294) < 0.005);
  // Out of range clamps to the ends.
  assert.equal(scale.sliderPos(500, 1, 100), SLIDER_STEPS);
  assert.equal(scale.sliderPos(0.01, 0.1, 24), 0);
  assert.equal(km(-50), 1);
  assert.equal(km(SLIDER_STEPS * 2), 100);
});

test("every whole km and every tenth of an hour has a position, and dragging reaches each in order", () => {
  for (let n = 1; n <= 100; n++) assert.equal(km(scale.sliderPos(n, 1, 100)), n, `${n} km`);
  for (let t = 1; t <= 240; t++) {
    assert.equal(hrs(scale.sliderPos(t / 10, 0.1, 24)), t / 10, `${t / 10} h`);
  }
  const seenKm = new Set();
  const seenHours = new Set();
  let lastKm = 0;
  let lastHours = 0;
  for (let pos = 0; pos <= SLIDER_STEPS; pos++) {
    const k = km(pos);
    const h = hrs(pos);
    assert.ok(k >= lastKm && h >= lastHours, `position ${pos} goes back`);
    lastKm = k;
    lastHours = h;
    seenKm.add(k);
    seenHours.add(h);
  }
  assert.equal(seenKm.size, 100);
  assert.equal(seenHours.size, 240);
});

function makeSlider({ min, max, unit, clean, text }) {
  const section = new FakeElement();
  section.title = new FakeElement();
  const inputs = [];
  const commits = [];
  const ui = scale.addSlider(section, {
    label: "Test", min, max, unit, clean, text,
    onInput: (n) => inputs.push(n),
    onCommit: (n) => commits.push(n),
  });
  return { ui, inputs, commits };
}
const key = (input, name) => {
  const event = new Event("keydown", { cancelable: true });
  event.key = name;
  input.dispatchEvent(event);
  return event.defaultPrevented;
};

test("a drag tells each new km once, and the release keeps the last", () => {
  const { ui, inputs, commits } = makeSlider({ min: 1, max: 100, unit: 1, clean: scale.cleanRadius, text: (n) => `${n} km` });
  ui.set(1);
  assert.equal(ui.input.value, "0");
  assert.equal(ui.input.attrs["aria-valuetext"], "1 km");
  // Thumb from the left end to the middle, one position at a time: many
  // input events, one onInput per km.
  for (let pos = 1; pos <= SLIDER_STEPS / 2; pos++) {
    ui.input.value = String(pos);
    ui.input.dispatchEvent(new Event("input"));
  }
  assert.deepEqual(inputs, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(ui.input.attrs["aria-valuetext"], "10 km");
  ui.input.dispatchEvent(new Event("change"));
  assert.deepEqual(commits, [10]);
});

test("an arrow key steps one km or one tenth of an hour and keeps it", () => {
  const distance = makeSlider({ min: 1, max: 100, unit: 1, clean: scale.cleanRadius, text: (n) => `${n} km` });
  distance.ui.set(50);
  assert.equal(key(distance.ui.input, "ArrowRight"), true);
  assert.equal(key(distance.ui.input, "ArrowUp"), true);
  assert.deepEqual(distance.inputs, [51, 52]);
  assert.deepEqual(distance.commits, [51, 52]);
  assert.equal(km(Number(distance.ui.input.value)), 52);
  key(distance.ui.input, "ArrowLeft");
  key(distance.ui.input, "ArrowDown");
  key(distance.ui.input, "ArrowDown");
  assert.deepEqual(distance.commits, [51, 52, 51, 50, 49]);
  // At an end the key does nothing; other keys are the range's own.
  distance.ui.set(100);
  key(distance.ui.input, "ArrowRight");
  assert.deepEqual(distance.commits, [51, 52, 51, 50, 49]);
  assert.equal(key(distance.ui.input, "PageUp"), false);
  assert.equal(key(distance.ui.input, "Home"), false);

  const time = makeSlider({ min: 0.1, max: 24, unit: 0.1, clean: scale.cleanHours, text: scale.liveHoursName });
  time.ui.set(0.1);
  key(time.ui.input, "ArrowLeft");
  assert.deepEqual(time.commits, []);
  for (let i = 0; i < 10; i++) key(time.ui.input, "ArrowRight");
  assert.deepEqual(time.commits, [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1]);
  assert.equal(time.ui.input.attrs["aria-valuetext"], "1.1 h");
  assert.equal(hrs(Number(time.ui.input.value)), 1.1);
});

// The circle (liveradius.js), with the map and the bubble stubbed out:
// what matters is how often paint() reaches the map's source.
const radiusJs = read("../liveradius.js");
function makeCircle() {
  return new Function(`
    const SOURCE = 'live-radius';
    let preview = null;
    let area = null;
    let tag = null;
    let tagKm = null;
    let tagAt = null;
    let frame = 0;
    const frames = new Map();
    let nextFrame = 1;
    const requestAnimationFrame = (fn) => { const id = nextFrame++; frames.set(id, fn); return id; };
    const cancelAnimationFrame = (id) => { frames.delete(id); };
    const drawn = [];
    const map = { getSource: () => ({ setData: (data) => drawn.push(data) }) };
    const ensureLayers = () => true;
    const removeLayers = () => {};
    const ring = (at, km) => [[at.lng, at.lat + km], [at.lng, at.lat]];
    const formatKm = (km) => km + ' km';
    const buildTag = () => {
      tag = { setLngLat() { return this; }, addTo() { return this; }, remove() {} };
      tagKm = {};
    };
    const liftTag = () => {};
    const keepTagOffMoon = () => {};
    ${fnSource(radiusJs, "shape")}
    ${fnSource(radiusJs, "paint")}
    ${fnSource(radiusJs, "paintSoon")}
    ${fnSource(radiusJs, "followRadius")}
    return {
      drawn,
      pending: () => frames.size,
      tick: () => { const due = [...frames.values()]; frames.clear(); due.forEach((fn) => fn()); },
      show: (km) => { preview = { at: { lng: 16, lat: 45 }, km }; paint(); },
      hide: () => { preview = null; paint(); },
      drag: (km) => followRadius({ detail: km }),
      km: () => tagKm.textContent,
    };
  `)();
}

test("a drag redraws the circle once a frame, at the last km", () => {
  const circle = makeCircle();
  circle.show(50);
  assert.equal(circle.drawn.length, 1);
  circle.drag(51);
  circle.drag(52);
  circle.drag(53);
  assert.equal(circle.drawn.length, 1, "nothing is drawn before the frame");
  assert.equal(circle.pending(), 1, "one frame for the three km");
  circle.tick();
  assert.equal(circle.drawn.length, 2);
  assert.equal(circle.km(), "53 km");
  // The release saves the km the circle already shows: no frame.
  circle.drag(53);
  assert.equal(circle.pending(), 0);
  circle.tick();
  assert.equal(circle.drawn.length, 2);
});

test("a paint that cannot wait cancels the drag's frame", () => {
  const circle = makeCircle();
  circle.show(50);
  circle.drag(60);
  assert.equal(circle.pending(), 1);
  circle.hide();
  assert.equal(circle.pending(), 0);
  circle.tick();
  assert.equal(circle.drawn.length, 1);
  // No pin, no circle to follow.
  circle.drag(70);
  assert.equal(circle.pending(), 0);
  // A new pin starts from its own km; the next drag gets a frame again.
  circle.show(20);
  circle.drag(21);
  assert.equal(circle.pending(), 1);
  circle.tick();
  assert.equal(circle.km(), "21 km");
  assert.equal(circle.drawn.length, 3);
});

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
  assert.match(slider, /input\.min = '0'/);
  assert.match(slider, /input\.max = String\(SLIDER_STEPS\)/);
  assert.match(slider, /input\.step = '1'/);
  assert.match(slider, /addEventListener\('input'/);
  assert.match(slider, /addEventListener\('change'/);
  assert.match(slider, /addEventListener\('keydown'/);
  assert.match(slider, /onInput\(n\)/);
  assert.match(slider, /onCommit\(n\)/);
  assert.match(fnSource(groups, "paintSlider"), /ui\.set\(value\)/);

  const distance = build.slice(build.indexOf("settingsSection('Distance'"), build.indexOf("settingsSection('Time'"));
  assert.match(distance, /min: LIVE_RADIUS_MIN_KM/);
  assert.match(distance, /max: LIVE_RADIUS_MAX_KM/);
  assert.match(distance, /unit: 1,/);
  assert.match(distance, /clean: cleanRadius,/);
  assert.match(distance, /new CustomEvent\('live-radius-changed'/);
  assert.match(distance, /setLiveRadius\(n\)/);
  assert.match(distance, /settingsChanged\(\)/);
  const distanceInput = distance.slice(distance.indexOf("onInput:"), distance.indexOf("onCommit:"));
  assert.doesNotMatch(distanceInput, /setLiveRadius|settingsChanged/);

  const time = build.slice(build.indexOf("settingsSection('Time'"));
  assert.match(time, /min: LIVE_HOURS_MIN/);
  assert.match(time, /max: LIVE_HOURS_MAX/);
  assert.match(time, /unit: 0\.1,/);
  assert.match(time, /clean: cleanHours,/);
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
