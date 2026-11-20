// Live settings (livegroups.js): Time and Distance are sliders. A tenth of
// an hour is minutes, a whole km from 1 to 100 is kept, and a drag of the
// distance moves the map circle before the release saves it. A pointer
// drag stops at round values, touch is placed from pointer events (iOS
// drags a range only from its thumb), and − / + step one unit.
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

// A top-level const's whole statement, which may run over several lines.
function constSource(source, name) {
  const start = source.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, name);
  const end = source.indexOf(";\n", start);
  return source.slice(start, end + 1);
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
const STEP_HOLD_MS = Number(groups.match(/const STEP_HOLD_MS = (\d+);/)[1]);
const STEP_REPEAT_MS = Number(groups.match(/const STEP_REPEAT_MS = (\d+);/)[1]);
const SWALLOW_MS = Number(groups.match(/const SWALLOW_MS = (\d+);/)[1]);

// The snap bands buildSettings gives each slider, read from its source.
const build = fnSource(groups, "buildSettings");
const distanceSource = build.slice(build.indexOf("settingsSection('Distance'"), build.indexOf("settingsSection('Time'"));
const timeSource = build.slice(build.indexOf("settingsSection('Time'"));
const bands = (source) => new Function("LIVE_RADIUS_MAX_KM", "LIVE_HOURS_MAX",
  `return ${source.match(/snaps: (\[\[.*\]\]),/)[1]};`)(100, 24);
const DISTANCE_SNAPS = bands(distanceSource);
const TIME_SNAPS = bands(timeSource);

// The slider with a document of plain EventTargets, a window to lift the
// pointer on, and a clock and timers the test moves by hand.
class FakeElement extends EventTarget {
  constructor() {
    super();
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.attrs = {};
    this.children = [];
    this.title = null;
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
    // The range's box: 300px from x = 100, a 20px thumb (10px padding a
    // side), so the thumb's centre runs from x = 120 to x = 380.
    this.rect = { left: 100, width: 300 };
    this.padding = 10;
    this.captured = null;
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  querySelector() { return this.title; }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(id) { this.captured = id; }
}
const fakeDocument = { createElement: () => new FakeElement() };
const fakeWindow = new EventTarget();
const clock = {
  now: 0,
  timers: new Map(),
  next: 1,
  // Runs every timer due by now + ms, in order, as time passes.
  advance(ms) {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = until;
  },
};
const fakeTimeout = (fn, ms) => { const id = clock.next++; clock.timers.set(id, { fn, at: clock.now + ms }); return id; };
const fakeClear = (id) => { clock.timers.delete(id); };
const fakeStyle = (el) => ({ paddingLeft: `${el.padding}px`, paddingRight: `${el.padding}px` });

const scale = new Function("document", "window", "performance", "setTimeout", "clearTimeout", "getComputedStyle", `
  const LIVE_HOURS_MAX = 24;
  const LIVE_RADIUS_MIN_KM = 1;
  const LIVE_RADIUS_MAX_KM = 100;
  const SLIDER_STEPS = ${SLIDER_STEPS};
  const SWALLOW_MS = ${SWALLOW_MS};
  let hours = 24;
  ${fnSource(groups, "hourTenths")}
  ${fnSource(groups, "cleanHours")}
  ${fnSource(groups, "cleanRadius")}
  ${fnSource(groups, "liveHoursName")}
  ${fnSource(groups, "sliderValue")}
  ${fnSource(groups, "sliderPos")}
  ${fnSource(groups, "snapPoints")}
  ${fnSource(groups, "rangePosAt")}
  ${fnSource(groups, "rangeX")}
  ${constSource(groups, "STEP_HOLD_MS")}
  ${constSource(groups, "STEP_REPEAT_MS")}
  ${constSource(groups, "STEP_ICONS")}
  ${fnSource(groups, "addSlider")}
  return { sliderValue, sliderPos, snapPoints, rangePosAt, rangeX, addSlider, cleanHours, cleanRadius, liveHoursName };
`)(fakeDocument, fakeWindow, { now: () => clock.now }, fakeTimeout, fakeClear, fakeStyle);

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

test("a drag stops at round values: each km to 10, 5 to 50, 10 above; 6 min, 12 min, half hours, hours", () => {
  const distance = scale.snapPoints(1, 100, DISTANCE_SNAPS, scale.cleanRadius);
  assert.deepEqual(distance, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100]);
  const time = scale.snapPoints(0.1, 24, TIME_SNAPS, scale.cleanHours);
  const expected = [];
  for (let t = 1; t <= 10; t++) expected.push(t / 10); // 6 min to 1 h
  for (let t = 12; t <= 60; t += 2) expected.push(t / 10); // 12 min to 6 h
  for (let t = 65; t <= 120; t += 5) expected.push(t / 10); // half hours to 12 h
  for (let h = 13; h <= 24; h++) expected.push(h); // hours to 24
  assert.deepEqual(time, expected);
  // Each is a value the slider keeps and shows as itself.
  for (const n of time) assert.equal(scale.cleanHours(n), n);
  for (const n of time) assert.equal(hrs(scale.sliderPos(n, 0.1, 24)), n);
  for (const n of distance) assert.equal(km(scale.sliderPos(n, 1, 100)), n);
  assert.deepEqual(time.filter((n) => n >= 12 && n <= 20), [12, 13, 14, 15, 16, 17, 18, 19, 20]);
});

test("a clientX is a position: the thumb's centre runs one thumb in from each edge", () => {
  const box = { left: 100, width: 300, padLeft: 10, padRight: 10 };
  assert.equal(scale.rangePosAt(120, box), 0);
  assert.equal(scale.rangePosAt(380, box), SLIDER_STEPS);
  assert.equal(scale.rangePosAt(250, box), SLIDER_STEPS / 2);
  // The ends of the strip read as the ends of the range.
  assert.equal(scale.rangePosAt(100, box), 0);
  assert.equal(scale.rangePosAt(400, box), SLIDER_STEPS);
  assert.equal(scale.rangePosAt(-50, box), 0);
  for (const pos of [0, 1234, 5000, SLIDER_STEPS]) {
    assert.equal(scale.rangePosAt(scale.rangeX(pos, box), box), pos);
  }
  // A range with no room to travel is at its start, not NaN.
  assert.equal(scale.rangePosAt(150, { left: 100, width: 20, padLeft: 10, padRight: 10 }), 0);
});

function makeSlider({ min, max, unit, snaps, clean, text }) {
  const section = new FakeElement();
  section.title = new FakeElement();
  const inputs = [];
  const commits = [];
  const ui = scale.addSlider(section, {
    label: "Test", min, max, unit, snaps, clean, text,
    onInput: (n) => inputs.push(n),
    onCommit: (n) => commits.push(n),
  });
  return { ui, inputs, commits, section };
}
const distanceSlider = () => makeSlider({ min: 1, max: 100, unit: 1, snaps: DISTANCE_SNAPS, clean: scale.cleanRadius, text: (n) => `${n} km` });
const timeSlider = () => makeSlider({ min: 0.1, max: 24, unit: 0.1, snaps: TIME_SNAPS, clean: scale.cleanHours, text: scale.liveHoursName });

const key = (input, name) => {
  const event = new Event("keydown", { cancelable: true });
  event.key = name;
  input.dispatchEvent(event);
  return event.defaultPrevented;
};
const pointer = (type, { x = 0, id = 1, kind = "touch", button = 0, primary = true } = {}) => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { clientX: x, pointerId: id, pointerType: kind, button, isPrimary: primary });
  return event;
};
const press = (el, opts) => { const e = pointer("pointerdown", opts); el.dispatchEvent(e); return e; };
const move = (el, opts) => el.dispatchEvent(pointer("pointermove", opts));
const lift = (opts) => fakeWindow.dispatchEvent(pointer("pointerup", opts));
const click = (el) => el.dispatchEvent(new Event("click"));
// The clientX of a value on the fake 300px range.
const box = { left: 100, width: 300, padLeft: 10, padRight: 10 };
const xOf = (n, min, max) => scale.rangeX(scale.sliderPos(n, min, max), box);

test("each slider is −, the range, + in a row; − and + are not tab stops", () => {
  const { ui, section } = distanceSlider();
  const row = section.children.at(-1);
  assert.equal(row.className, "live-settings-slider-row");
  assert.deepEqual(row.children, [ui.less, ui.input, ui.more]);
  assert.equal(ui.less.className, "live-settings-step");
  assert.equal(ui.less.tabIndex, -1);
  assert.equal(ui.more.tabIndex, -1);
  assert.equal(ui.less.attrs["aria-label"], "Less test");
  assert.equal(ui.more.attrs["aria-label"], "More test");
  assert.equal(ui.less.children[0].className, "live-settings-step-face");
  assert.match(ui.less.children[0].innerHTML, /<path d="M6 12h12"\/>/);
  assert.match(ui.more.children[0].innerHTML, /<path d="M12 6v12"\/>/);
});

test("without a pointer (Page Up / Down, Home, End) the range keeps every km, and change keeps it once", () => {
  const { ui, inputs, commits } = distanceSlider();
  ui.set(1);
  assert.equal(ui.input.value, "0");
  assert.equal(ui.input.attrs["aria-valuetext"], "1 km");
  for (let pos = 1; pos <= SLIDER_STEPS / 2; pos++) {
    ui.input.value = String(pos);
    ui.input.dispatchEvent(new Event("input"));
  }
  assert.deepEqual(inputs, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(ui.input.attrs["aria-valuetext"], "10 km");
  ui.input.dispatchEvent(new Event("change"));
  assert.deepEqual(commits, [10]);
  // A change with nothing new is not kept again.
  ui.input.dispatchEvent(new Event("change"));
  assert.deepEqual(commits, [10]);
});

test("a touch on the track moves the thumb there, follows the finger at each snap point, and the lift keeps it", () => {
  const { ui, inputs, commits } = distanceSlider();
  ui.set(1);
  const down = press(ui.input, { x: 250 }); // the middle: 10 km
  assert.equal(down.defaultPrevented, true);
  assert.equal(ui.input.captured, 1);
  assert.deepEqual(inputs, [10]);
  assert.equal(ui.input.value, String(scale.sliderPos(10, 1, 100)));
  assert.equal(ui.input.attrs["aria-valuetext"], "10 km");
  assert.deepEqual(commits, [], "nothing is kept before the lift");
  // The finger on to the right end, a pixel at a time: every snap point
  // above 10 once, in order, and the thumb on each.
  for (let x = 251; x <= 400; x++) {
    move(ui.input, { x });
    const n = inputs.at(-1);
    assert.equal(ui.input.value, String(scale.sliderPos(n, 1, 100)), `thumb at ${x}`);
  }
  assert.deepEqual(inputs, [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100]);
  // Another finger or a mouse does not move it.
  move(ui.input, { x: 200, id: 2 });
  assert.equal(inputs.at(-1), 100);
  lift({ x: 400, id: 2 });
  assert.deepEqual(commits, []);
  lift({ x: 400 });
  assert.deepEqual(commits, [100]);
  // After the lift a move is nothing.
  move(ui.input, { x: 200 });
  assert.deepEqual(commits, [100]);
  assert.equal(inputs.at(-1), 100);
});

test("a touch cancels the range's own touch handling", () => {
  const { ui } = distanceSlider();
  for (const type of ["touchstart", "touchmove", "touchend"]) {
    const event = new Event(type, { cancelable: true });
    ui.input.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, type);
  }
});

test("a press on the thumb holds it where it was grabbed: a tap keeps a value off the snap points", () => {
  const { ui, inputs, commits } = timeSlider();
  ui.set(7.3); // saved from − / +, not a snap point
  assert.equal(ui.input.attrs["aria-valuetext"], "7.3 h");
  assert.equal(hrs(Number(ui.input.value)), 7.3);
  const at = xOf(7.3, 0.1, 24);
  press(ui.input, { x: at + 4 });
  move(ui.input, { x: at + 6 }); // a finger's wobble
  lift({ x: at + 6 });
  assert.deepEqual(inputs, []);
  assert.deepEqual(commits, []);
  assert.equal(ui.input.attrs["aria-valuetext"], "7.3 h");
  // A real drag from the thumb moves it by the finger's travel, less the
  // quarter thumb (5px here) it waited for, not to the finger.
  press(ui.input, { x: at + 4 });
  move(ui.input, { x: xOf(20, 0.1, 24) + 4 + 5 });
  assert.equal(inputs.at(-1), 20);
  lift({});
  assert.deepEqual(commits, [20]);
});

test("a drag from the thumb does not skip the snap point next to it", () => {
  for (const [start, next, back] of [[12, 13, 11.5], [37, 40, 35]]) {
    const slider = start === 12 ? timeSlider() : distanceSlider();
    const [min, max] = start === 12 ? [0.1, 24] : [1, 100];
    const { ui, inputs } = slider;
    ui.set(start);
    const at = xOf(start, min, max);
    for (const [dir, expected] of [[1, next], [-1, back]]) {
      inputs.length = 0;
      press(ui.input, { x: at });
      for (let d = 1; d <= 40 && !inputs.length; d++) move(ui.input, { x: at + dir * d });
      lift({});
      assert.equal(inputs[0], expected, `${start} ${dir > 0 ? "up" : "down"}`);
      ui.set(start);
    }
  }
});

test("12 h and 20 h are a much wider target for a drag than for the old tenths", () => {
  const { ui, inputs } = timeSlider();
  ui.set(0.1);
  // A mouse drag: the range moves itself and sends input events.
  const down = press(ui.input, { kind: "mouse" });
  assert.equal(down.defaultPrevented, false, "the range's own mouse drag stays");
  const hits = new Map();
  for (let pos = 0; pos <= SLIDER_STEPS; pos++) {
    ui.input.value = String(pos);
    ui.input.dispatchEvent(new Event("input"));
    const n = inputs.length ? inputs.at(-1) : 0.1;
    hits.set(n, (hits.get(n) || 0) + 1);
    // The thumb jumps to the snap point.
    assert.equal(ui.input.value, String(scale.sliderPos(n, 0.1, 24)));
  }
  lift({ kind: "mouse" });
  assert.deepEqual([...hits.keys()], scale.snapPoints(0.1, 24, TIME_SNAPS, scale.cleanHours));
  for (const h of [12, 20]) {
    let tenths = 0;
    for (let pos = 0; pos <= SLIDER_STEPS; pos++) if (hrs(pos) === h) tenths++;
    // 12 h has the half hour below it and the hour above: 7.5 times; 20 h 10.
    assert.ok(hits.get(h) >= tenths * 7, `${h} h: ${hits.get(h)} positions, a tenth had ${tenths}`);
  }
});

test("a mouse drag snaps and its lift keeps the value once, whatever the range's change does", () => {
  const { ui, inputs, commits } = distanceSlider();
  ui.set(50);
  press(ui.input, { kind: "mouse", id: 7 });
  ui.input.value = String(scale.sliderPos(23, 1, 100));
  ui.input.dispatchEvent(new Event("input"));
  assert.deepEqual(inputs, [25]);
  assert.equal(ui.input.attrs["aria-valuetext"], "25 km");
  lift({ kind: "mouse", id: 7 });
  assert.deepEqual(commits, [25]);
  ui.input.dispatchEvent(new Event("change"));
  assert.deepEqual(commits, [25]);
  assert.deepEqual(inputs, [25]);
  // A right press is not a drag: the range rounds to the km again.
  press(ui.input, { kind: "mouse", button: 2 });
  ui.input.value = String(scale.sliderPos(23, 1, 100));
  ui.input.dispatchEvent(new Event("input"));
  assert.equal(inputs.at(-1), 23);
});

test("an arrow key steps one km or one tenth of an hour and keeps it", () => {
  const distance = distanceSlider();
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

  const time = timeSlider();
  time.ui.set(0.1);
  key(time.ui.input, "ArrowLeft");
  assert.deepEqual(time.commits, []);
  for (let i = 0; i < 10; i++) key(time.ui.input, "ArrowRight");
  assert.deepEqual(time.commits, [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1]);
  assert.equal(time.ui.input.attrs["aria-valuetext"], "1.1 h");
  assert.equal(hrs(Number(time.ui.input.value)), 1.1);
  // Off the snap points too.
  time.ui.set(7.3);
  key(time.ui.input, "ArrowRight");
  assert.equal(time.ui.input.attrs["aria-valuetext"], "7.4 h");
});

test("− and + step one unit: a press at once, then repeating while held, kept once on the lift", () => {
  const { ui, inputs, commits } = timeSlider();
  ui.set(7.3);
  press(ui.more, { x: 0 });
  assert.equal(ui.more.classList.contains("is-pressed"), true);
  assert.deepEqual(inputs, [7.4]);
  assert.equal(ui.input.attrs["aria-valuetext"], "7.4 h");
  clock.advance(STEP_HOLD_MS - 1);
  assert.deepEqual(inputs, [7.4]);
  clock.advance(1);
  assert.deepEqual(inputs, [7.4, 7.5]);
  clock.advance(STEP_REPEAT_MS * 3);
  assert.deepEqual(inputs, [7.4, 7.5, 7.6, 7.7, 7.8]);
  assert.deepEqual(commits, [], "nothing is kept while held");
  assert.equal(hrs(Number(ui.input.value)), 7.8);
  lift({});
  assert.deepEqual(commits, [7.8]);
  assert.equal(ui.more.classList.contains("is-pressed"), false);
  clock.advance(STEP_REPEAT_MS * 5);
  assert.deepEqual(inputs, [7.4, 7.5, 7.6, 7.7, 7.8], "the lift stops it");
  // The click the press ends with is not another step.
  click(ui.more);
  assert.deepEqual(inputs, [7.4, 7.5, 7.6, 7.7, 7.8]);
  // A click with no press (Enter, a screen reader) steps and keeps.
  clock.advance(SWALLOW_MS);
  click(ui.less);
  assert.deepEqual(inputs.at(-1), 7.7);
  assert.deepEqual(commits, [7.8, 7.7]);
  // A right press does nothing.
  press(ui.less, { kind: "mouse", button: 2 });
  assert.equal(inputs.at(-1), 7.7);
  // A mouse press leaves the focus where it was.
  const down = new Event("mousedown", { cancelable: true });
  ui.less.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
});

test("− and + stop at the ends and show it", () => {
  const { ui, inputs, commits } = distanceSlider();
  ui.set(98);
  assert.equal(ui.more.attrs["aria-disabled"], "false");
  press(ui.more, { x: 0 });
  clock.advance(STEP_HOLD_MS);
  assert.deepEqual(inputs, [99, 100]);
  assert.equal(ui.more.attrs["aria-disabled"], "true");
  clock.advance(STEP_REPEAT_MS * 4);
  assert.deepEqual(inputs, [99, 100]);
  assert.equal(clock.timers.size, 0, "no timer left at the end");
  lift({});
  assert.deepEqual(commits, [100]);
  // At the end a press or a click changes nothing and keeps nothing.
  clock.advance(SWALLOW_MS);
  press(ui.more, { x: 0 });
  lift({});
  clock.advance(SWALLOW_MS);
  click(ui.more);
  assert.deepEqual(inputs, [99, 100]);
  assert.deepEqual(commits, [100]);
  ui.set(1);
  assert.equal(ui.less.attrs["aria-disabled"], "true");
  assert.equal(ui.more.attrs["aria-disabled"], "false");

  const time = timeSlider();
  time.ui.set(0.1);
  assert.equal(time.ui.less.attrs["aria-disabled"], "true");
  clock.advance(SWALLOW_MS);
  click(time.ui.more);
  assert.deepEqual(time.commits, [0.2]);
  assert.equal(time.ui.input.attrs["aria-valuetext"], "12 min");
  time.ui.set(24);
  assert.equal(time.ui.more.attrs["aria-disabled"], "true");
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
  assert.equal(api.cleanHours("7.3"), 7.3);
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
  assert.equal(api.liveHoursName(7.3), "7.3 h");
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
  assert.match(slider, /addEventListener\('pointerdown'/);
  assert.match(slider, /addEventListener\('pointermove'/);
  assert.match(slider, /\{ passive: false \}/);
  assert.match(slider, /onInput\(n\)/);
  assert.match(slider, /onCommit\(value\)/);
  assert.match(fnSource(groups, "paintSlider"), /ui\.set\(value\)/);

  assert.match(distanceSource, /min: LIVE_RADIUS_MIN_KM/);
  assert.match(distanceSource, /max: LIVE_RADIUS_MAX_KM/);
  assert.match(distanceSource, /unit: 1,/);
  assert.match(distanceSource, /snaps: \[\[10, 1\], \[50, 5\], \[LIVE_RADIUS_MAX_KM, 10\]\],/);
  assert.match(distanceSource, /clean: cleanRadius,/);
  assert.match(distanceSource, /new CustomEvent\('live-radius-changed'/);
  assert.match(distanceSource, /setLiveRadius\(n\)/);
  assert.match(distanceSource, /settingsChanged\(\)/);
  const distanceInput = distanceSource.slice(distanceSource.indexOf("onInput:"), distanceSource.indexOf("onCommit:"));
  assert.doesNotMatch(distanceInput, /setLiveRadius|settingsChanged/);

  assert.match(timeSource, /min: LIVE_HOURS_MIN/);
  assert.match(timeSource, /max: LIVE_HOURS_MAX/);
  assert.match(timeSource, /unit: 0\.1,/);
  assert.match(timeSource, /snaps: \[\[1, 0\.1\], \[6, 0\.2\], \[12, 0\.5\], \[LIVE_HOURS_MAX, 1\]\],/);
  assert.match(timeSource, /clean: cleanHours,/);
  assert.match(timeSource, /setLiveHours\(n\)/);
  assert.match(timeSource, /settingsChanged\(\)/);
});

// A rule's declarations, by the selector it starts with.
function rule(selector, from = 0) {
  const at = css.indexOf(`${selector} {`, from);
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf("}", at) + 1);
}

test("the thumb is about twice the label, sized in em of the panel, and the same on WebKit and Firefox", () => {
  const at = css.indexOf(".live-settings-slider-row {");
  const touch = css.indexOf("@media (pointer: coarse) {", at);
  assert.ok(at > 0 && touch > at);
  const block = css.slice(at, css.lastIndexOf("/*", touch));
  const row = rule(".live-settings-slider-row");
  assert.match(row, /--live-thumb: 1\.4em;/);
  assert.match(row, /--live-track: 0\.22em;/);
  // The panel's font is the page's 16px; the label is 11px.
  assert.doesNotMatch(rule(".live-settings"), /font-size/);
  assert.match(rule(".live-settings-title"), /font-size: 11px;/);
  const thumbPx = 1.4 * 16;
  assert.ok(thumbPx / 11 > 1.9 && thumbPx / 11 < 2.2);
  // The range takes the panel's font, not the browser's control font.
  const slider = rule(".live-settings-slider", at);
  assert.match(slider, /font-size: inherit;/);
  assert.match(slider, /height: var\(--live-thumb\);/);
  assert.match(slider, /padding: 0 calc\(var\(--live-thumb\) \/ 2\);/);
  assert.match(slider, /flex: 1 1 0;/);
  assert.match(slider, /touch-action: none/);
  // One thumb on both engines.
  const decls = (text) => text.slice(text.indexOf("{") + 1, text.lastIndexOf("}")).split(";")
    .map((d) => d.trim()).filter((d) => d && !/appearance|margin-top/.test(d));
  const webkit = decls(rule(".live-settings-slider::-webkit-slider-thumb"));
  const moz = decls(rule(".live-settings-slider::-moz-range-thumb"));
  assert.deepEqual(webkit, moz);
  assert.ok(webkit.includes("width: var(--live-thumb)"));
  assert.ok(webkit.includes("height: var(--live-thumb)"));
  assert.match(rule(".live-settings-slider::-webkit-slider-thumb"), /margin-top: calc\(\(var\(--live-track\) - var\(--live-thumb\)\) \/ 2\);/);
  assert.match(rule(".live-settings-slider::-webkit-slider-runnable-track"), /height: var\(--live-track\);/);
  assert.match(rule(".live-settings-slider::-moz-range-track"), /height: var\(--live-track\);/);
  // − / +: a ring the thumb's size, in a box a little wider.
  const step = rule(".live-settings-step");
  assert.match(step, /width: calc\(var\(--live-thumb\) \+ 0\.75em\);/);
  assert.match(step, /font: inherit;/);
  const face = rule(".live-settings-step-face");
  assert.match(face, /width: var\(--live-thumb\);/);
  assert.match(face, /height: var\(--live-thumb\);/);
  assert.match(block, /\.live-settings-step\[aria-disabled="true"\] \.live-settings-step-face \{\s*opacity: 0\.35;/);
  // No fixed px, no viewport unit: the panel's font sizes all of it.
  assert.doesNotMatch(block, /var\(--fu\)/);
  assert.doesNotMatch(block, /\dpx/);
  assert.match(block, /\.live-settings-slider:focus,\s*\.live-settings-slider:focus-visible \{\s*outline: none;/);
  assert.match(block, /:focus-visible::-webkit-slider-thumb \{\s*outline: 0\.06em solid/);
  assert.match(block, /:focus-visible::-moz-range-thumb \{\s*outline: 0\.06em solid/);
});

test("on a touch screen the row is a 44px strip in the gaps, and the thumb stays a plain circle", () => {
  const at = css.indexOf("@media (pointer: coarse) {", css.indexOf(".live-settings-slider-row {"));
  const end = css.indexOf(".live-settings-look {");
  assert.ok(at > 0 && end > at);
  const block = css.slice(at, end);
  // The strip: a finger's height, taking the section's 6px gap above and
  // the panel's 10px below, so it meets the hint and the next row.
  assert.match(block, /\.live-settings-slider-row \{\s*--live-hit: max\(44px, var\(--live-thumb\)\);\s*margin: -6px 0 -10px;/);
  assert.match(block, /\.live-settings-slider \{\s*height: var\(--live-hit\);/);
  assert.match(css, /\.live-settings-section \{[^}]*gap: 6px;/);
  assert.match(css, /\.live-settings \{[^}]*gap: 10px;/);
  // − / + stretch to the row's height.
  assert.match(rule(".live-settings-slider-row"), /align-items: stretch;/);
  // Touch is placed from pointer events, so the thumb needs no tall box.
  assert.doesNotMatch(block, /slider-thumb|range-thumb|radial-gradient/);
});
