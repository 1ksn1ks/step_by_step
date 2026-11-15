import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every text field that scrolls gets the reading ring", () => {
  const main = read("../main.js");
  assert.match(main, /import '\.\/fieldclear\.js';\s*import '\.\/fieldring\.js';/);

  const src = read("../fieldring.js");
  assert.match(src, /import \{ brightenRing, createRing, fitRing, paintRing \} from '\.\/readingring\.js'/);
  // Textareas and contenteditable editors you type in; not read-only ones.
  const isField = src.slice(src.indexOf("function isField"), src.indexOf("function hostOf"));
  assert.match(isField, /el\.tagName === 'TEXTAREA'\) return !el\.readOnly && !el\.disabled/);
  assert.match(isField, /el\.hasAttribute\('contenteditable'\) && el\.isContentEditable/);
  assert.match(src, /const SKIP_INSIDE = '\[data-no-ring\]'/);

  // On only while the field itself scrolls, gone once the text fits.
  const refresh = src.slice(src.indexOf("function refresh"), src.indexOf("function place"));
  assert.match(refresh, /const on = shown && room > 1 && scrolls\(field\)/);
  assert.match(refresh, /entry\.holder\.classList\.remove\('is-on'\)/);
  assert.match(refresh, /fitRing\(entry\.ring, field\);\s*place\(field, entry\.holder\);\s*paintRing\(entry\.ring, field\.scrollTop \/ room\)/);
  // Placed from layout offsets against a known origin, like fieldclear's ×.
  assert.match(src, /\(field\.offsetLeft \+ bl\) - holder\.offsetLeft/);

  // What keeps it up to date: typing, a script setting .value, focus,
  // size changes of the field and its parent, page resize, DOM changes,
  // and a scroll inside the field.
  assert.match(src, /const sizes = new ResizeObserver\(schedule\)/);
  assert.match(src, /if \(!uses\) sizes\.observe\(parent\)/);
  assert.match(src, /Object\.defineProperty\(Proto\.prototype, 'value'/);
  assert.match(src, /document\.addEventListener\('input'/);
  assert.match(src, /document\.addEventListener\('focusin'/);
  assert.match(src, /window\.addEventListener\('resize', schedule\)/);
  assert.match(src, /new MutationObserver\(/);
  assert.match(src, /document\.addEventListener\('scroll', \(event\) => \{[\s\S]*brightenRing\(entry\.ring\)/);
  assert.match(src, /\{ capture: true, passive: true \}/);

  const css = read("../style.css");
  assert.match(css, /\.field-ring \{\s*position: absolute !important;[^}]*display: none !important;[^}]*pointer-events: none !important;/);
  assert.match(css, /\.field-ring\.is-on \{\s*display: block !important;/);
  // The ring's size is inline as well as in attributes, so page svg rules
  // cannot resize it.
  const ring = read("../readingring.js");
  assert.match(ring, /svg\.style\.width = `\$\{w\}px`;\s*svg\.style\.height = `\$\{h\}px`;/);
});
