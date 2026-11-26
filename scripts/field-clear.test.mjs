// A clear of any non-empty field offers ↶, including a short one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../fieldclear.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function load(fire, schedule) {
  const start = source.indexOf("function endUndo(entry)");
  const end = source.indexOf("// The text must not run under the ×");
  assert.ok(start !== -1 && end > start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /LONG_CHARS/);
  const typing = source.slice(
    source.indexOf("const undo = !!(entry && entry.undo != null);"),
    source.indexOf("if (field.value === '' && !(entry && entry.undo != null))"),
  );
  const lookAt = source.indexOf("const undo = entry.undo != null;\n    btn.classList.toggle('is-undo', undo);");
  const look = source.slice(lookAt, source.indexOf("if (!entry.shown) {", lookAt));
  assert.match(typing, /field\.value !== ''\) endUndo\(entry\)/);
  assert.match(look, /classList\.toggle\('is-undo', undo\)/);
  assert.match(look, /aria-label', undo \? 'Undo clear' : 'Clear'/);
  const entries = new WeakMap();
  const api = new Function(
    "entries",
    "entryFor",
    "fire",
    "schedule",
    "UNDO_MS",
    `${body}
    function onType(field) {
      const entry = entries.get(field);
      ${typing}
    }
    function paint(entry) {
      const btn = entry.btn;
      ${look}
    }
    return { press, onType, paint };`,
  );
  const undoMs = Number(source.match(/const UNDO_MS = (\d+)/)[1]);
  return {
    undoMs,
    entries,
    api: (entryFor) => api(entries, entryFor, fire, schedule, undoMs),
  };
}

function button() {
  const classes = new Set();
  const attrs = {};
  return {
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    getAttribute(name) {
      return attrs[name];
    },
  };
}

test("the comment row gets a clear; the chat composers, draw coordinates and opted-out fields stay without one", () => {
  const skip = source.match(/const SKIP_INSIDE = '([^']*)';/);
  assert.ok(skip, "SKIP_INSIDE is a string");
  assert.equal(skip[1].includes(".comments-input-row"), false);
  assert.match(skip[1], /\.chat-compose/);
  assert.match(skip[1], /\.draw-coord-wrap/);
  assert.match(skip[1], /\[data-no-clear\]/);
  assert.match(source, /topic and E2EE chat composers/);
});

test("clearing a 3-character field offers undo, restores it, and then gives up", (t) => {
  assert.match(source, /↶ follows every clear/);
  assert.doesNotMatch(source, /LONG_CHARS/);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fired = [];
  let scheduled = 0;
  const { undoMs, entries, api } = load(
    (_field, inputType) => fired.push(inputType),
    () => { scheduled += 1; },
  );
  assert.equal(undoMs, 5000);
  const field = { value: "abc" };
  const entry = { btn: button(), undo: null, timer: 0 };
  const { press, onType, paint } = api(() => {
    entries.set(field, entry);
    return entry;
  });

  press(field);
  paint(entry);
  assert.equal(field.value, "");
  assert.equal(entry.undo, "abc");
  assert.equal(entry.btn.classList.contains("is-undo"), true);
  assert.equal(entry.btn.getAttribute("aria-label"), "Undo clear");
  assert.deepEqual(fired, ["deleteContentBackward"]);

  press(field);
  paint(entry);
  assert.equal(field.value, "abc");
  assert.equal(entry.undo, null);
  assert.equal(entry.btn.classList.contains("is-undo"), false);
  assert.equal(entry.btn.getAttribute("aria-label"), "Clear");
  assert.deepEqual(fired, ["deleteContentBackward", "historyUndo"]);

  field.value = "abc";
  press(field);
  field.value = "z";
  onType(field);
  paint(entry);
  assert.equal(entry.undo, null);
  assert.equal(entry.btn.classList.contains("is-undo"), false);
  t.mock.timers.tick(undoMs);
  assert.equal(entry.undo, null);

  field.value = "abc";
  press(field);
  paint(entry);
  assert.equal(entry.undo, "abc");
  t.mock.timers.tick(undoMs - 1);
  assert.equal(entry.undo, "abc");
  assert.equal(entry.btn.classList.contains("is-undo"), true);
  t.mock.timers.tick(1);
  paint(entry);
  assert.equal(entry.undo, null);
  assert.equal(entry.btn.classList.contains("is-undo"), false);
  assert.ok(scheduled > 0);
});
