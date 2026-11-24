// The map popup's gear settings card is a solid dark card: the map and its
// labels never show through it, in portrait or in landscape's cards, and
// nothing behind it is blurred. Its layout is other tests' business.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = read("../style.css").replace(/\/\*[\s\S]*?\*\//g, "");

// Every innermost rule: { selector, body }. Rules inside @media come out
// with their own selector (the regex cannot cross the @media brace).
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim().replace(/\s+/g, " "),
  body: m[2],
}));
const decl = (body, prop) => [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());
const SOLID = "#0F0F14";

test("the card's own fill is solid #0F0F14 with no backdrop blur", () => {
  const card = rules.filter((r) => r.selector === "#popup-settings-card");
  const main = card.find((r) => r.body.includes("--ps-accent:"));
  assert.ok(main, "the card's main rule");
  assert.deepEqual(decl(main.body, "background-color"), [SOLID]);
  assert.deepEqual(decl(main.body, "backdrop-filter"), ["none"]);
  assert.deepEqual(decl(main.body, "-webkit-backdrop-filter"), ["none"]);
  // No rule on the card itself paints a see-through fill or blurs.
  for (const rule of rules.filter((r) => /^#popup-settings-card(:not\(\[style\*="display: none"\]\))?$/.test(r.selector))) {
    for (const value of [...decl(rule.body, "background-color"), ...decl(rule.body, "background")]) {
      // Landscape's shell is transparent: its two cards paint the surface.
      assert.ok(value === SOLID || value === "transparent", `${rule.selector}: ${value}`);
    }
    for (const value of [...decl(rule.body, "backdrop-filter"), ...decl(rule.body, "-webkit-backdrop-filter")]) {
      assert.equal(value, "none", rule.selector);
    }
  }
});

test("landscape: the painted card layers and the sticky title are solid too", () => {
  const layers = rules.find((r) => r.selector === "#popup-settings-card::before, #popup-settings-card::after");
  assert.ok(layers, "the landscape card layers");
  assert.deepEqual(decl(layers.body, "background-color"), [SOLID]);
  assert.equal(/backdrop-filter/.test(layers.body), false);
  // The ::after card keeps its rim; ::before stays off (the post's own
  // left card shows beside it).
  assert.match(layers.body, /border: calc\(var\(--u\) \* 0\.3\) solid var\(--popup-border-color, #ffffff\);/);
  assert.ok(rules.some((r) => r.selector === "#popup-settings-card::before" && /display: none;/.test(r.body)));
  assert.equal(rules.some((r) => /^#popup-settings-card::after$/.test(r.selector) && /background/.test(r.body)), false);
  const titles = rules.filter((r) => r.selector === "#popup-settings-card .options-column-title" && /position: sticky;/.test(r.body));
  assert.equal(titles.length, 1);
  assert.deepEqual(decl(titles[0].body, "background-color"), [SOLID]);
});

test("the dim layer behind the card is left as it was", () => {
  assert.match(read("../index.html"), /id="popup-settings-backdrop"[^>]*rgba\(0,\s*0,\s*0,\s*0\.45\)/);
});
