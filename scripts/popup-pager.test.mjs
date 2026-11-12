import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("a touch swipe on popup media uses the same prev and next as the sheet", () => {
  const src = fs.readFileSync(new URL("../processallmessages.js", import.meta.url), "utf8");
  const start = src.indexOf("function touchOnVideoControls");
  const end = src.indexOf("function shownShareState");
  const body = src.slice(start, end);

  assert.equal(body.includes(".popup-media-card, .payer-link"), false);
  assert.match(body, /e\.target\.closest\('\.payer-link, \.comments-modal--in-card, textarea'\)/);
  assert.match(body, /if \(touchOnVideoControls\(e\)\) return;/);
  assert.match(body, /e\.pointerType !== 'touch'/);
  assert.match(body, /Math\.abs\(dx\) < 50 \|\| Math\.abs\(dx\) < Math\.abs\(dy\) \* 1\.5/);
  assert.match(body, /if \(dx < 0\) goNext\(\);\s*else goPrev\(\);/);

  const pager = body.slice(body.indexOf("function bindPopupPager"));
  const gate = pager.indexOf("Math.abs(dx) < 50");
  const swallow = pager.indexOf("armPopupMediaClickSwallow()");
  const page = pager.indexOf("if (dx < 0) goNext()");
  assert.ok(gate > 0 && swallow > gate && page > swallow);

  assert.match(body, /!video\.controls \|\| video\.classList\.contains\('loop-face'\)/);
  assert.match(body, /target\.closest\('\.popup-media-card'\)/);
  assert.match(body, /addEventListener\('click', swallow, true\)/);
  assert.equal(body.includes("feed-card"), false);
});
