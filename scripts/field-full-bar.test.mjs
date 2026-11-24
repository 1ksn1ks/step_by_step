// The full-screen editor's header (#field-full, fieldexpand.js): its
// Save / Submit pill fits inside the shared page bar and lines up with the
// field's ✕ / collapse column below.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// style.css has CRLF line ends in the working copy.
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// The declarations of the first rule whose selector line is exactly this.
function rule(selector) {
  const at = css.indexOf(`\n${selector} {\n`);
  assert.ok(at >= 0, selector);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

test("the pill is shorter than the bar, so the bar centres it and keeps its height", () => {
  const pill = rule("#field-full .field-full-actions > button");
  assert.match(pill, /\n  height: calc\(var\(--page-bar-h\) - var\(--fu\) \* 0\.8\) !important;/);
  assert.equal(pill.includes("calc(var(--fu) * 3.6)"), false);
  // Everything else on the pill is as it was.
  for (const line of [
    "min-height: 0 !important;",
    "padding: 0 calc(var(--fu) * 1.3) !important;",
    "font-size: var(--ui-small) !important;",
    "border-radius: 10em !important;",
    "background: #22D3EE !important;",
    "color: #0a0a12 !important;",
    "line-height: 1 !important;",
  ]) {
    assert.ok(pill.includes(line), line);
  }
  // The visible pill gets no 44px floor; the tap target stays on ::after.
  assert.doesNotMatch(pill, /min-height: (?!0 )/);
  const after = rule("#field-full .field-full-actions > button::after");
  assert.match(after, /width: max\(2\.75rem, 100%\);/);
  assert.match(after, /height: max\(2\.75rem, 100%\);/);
  assert.match(after, /translate: -50% -50%;/);
});

test("the pill's right edge lines up with the ✕ / collapse column", () => {
  const actions = rule(".field-full-actions");
  assert.match(actions, /margin-left: auto;/);
  assert.match(actions, /margin-right: calc\(var\(--ui-gap\) - var\(--fu\) \* 0\.6\);/);
  // Bar padding 1.1fu + (--ui-gap - 0.6fu) = the body's 0.5fu + --ui-gap.
  assert.match(rule(".field-full-body"), /padding: calc\(var\(--fu\) \* 0\.8\) calc\(var\(--fu\) \* 0\.5\);/);
});

test("the shared page bar is unchanged: no vertical padding, the same row height", () => {
  const start = css.indexOf(":is(\n  #feed-profile > .feed-chat-bar,");
  const bar = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const list = css.slice(start, css.indexOf("{", start));
  assert.match(list, /\.field-full-bar\n\)/);
  assert.match(bar, /--page-bar-h: max\(44px, calc\(var\(--page-title\) \* 1\.2\)\);/);
  assert.match(bar, /min-height: var\(--page-bar-h\);/);
  assert.match(bar, /padding: 0 calc\(var\(--fu\) \* 1\.1\);/);
  assert.match(bar, /align-items: center;/);
});

test("the changed rules add no fixed px", () => {
  const pill = rule("#field-full .field-full-actions > button");
  const actions = rule(".field-full-actions");
  for (const block of [pill, actions]) {
    assert.equal(/\dpx/.test(block), false);
  }
});
