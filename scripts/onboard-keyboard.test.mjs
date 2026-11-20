import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHELL_SELECTOR } from "../keyboardlayout.js";

function source(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

function loadLift() {
  const src = source("../onboarding.js");
  const start = src.indexOf("export function onboardCardLift");
  const brace = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(start, end + 1).replace(/^export /, "");
  return new Function(`${body}\nreturn onboardCardLift;`)();
}

const onboardCardLift = loadLift();

test("the install card stays put when the Name field is already above the keyboard", () => {
  const lift = onboardCardLift({
    fieldBottom: 700,
    cardTop: 180,
    visibleBottom: 800,
    gap: 12,
    safeTop: 47,
    currentLift: 0,
  });
  assert.equal(lift, 0);
});

test("a covered Name field moves up by the overlap plus the gap", () => {
  const lift = onboardCardLift({
    fieldBottom: 840,
    cardTop: 180,
    visibleBottom: 800,
    gap: 12,
    safeTop: 47,
    currentLift: 0,
  });
  assert.equal(lift, 52);
});

test("a lift that is already right does not creep", () => {
  const lift = onboardCardLift({
    fieldBottom: 788,
    cardTop: 128,
    visibleBottom: 800,
    gap: 12,
    safeTop: 47,
    currentLift: 52,
  });
  assert.equal(lift, 52);
});

test("the card comes back down when the keyboard no longer covers the field", () => {
  const lift = onboardCardLift({
    fieldBottom: 700,
    cardTop: 128,
    visibleBottom: 900,
    gap: 12,
    safeTop: 47,
    currentLift: 52,
  });
  assert.equal(lift, 0);
});

test("the card top never passes the safe area", () => {
  const lift = onboardCardLift({
    fieldBottom: 840,
    cardTop: 50,
    visibleBottom: 800,
    gap: 12,
    safeTop: 47,
    currentLift: 0,
  });
  assert.equal(lift, 3);
  const stuck = onboardCardLift({
    fieldBottom: 840,
    cardTop: 40,
    visibleBottom: 800,
    gap: 12,
    safeTop: 47,
    currentLift: 10,
  });
  assert.equal(stuck, 3);
});

test("a broken measurement keeps the lift the card already has", () => {
  assert.equal(onboardCardLift({ currentLift: 12, fieldBottom: NaN }), 12);
  assert.equal(onboardCardLift(null), 0);
});

test("the intro is not a pinned sheet, and the Name field does not scroll into view", () => {
  assert.equal(SHELL_SELECTOR.includes("onboard"), false);
  const layout = source("../keyboardlayout.js");
  const placeAt = layout.indexOf("function place()");
  const onboardAt = layout.indexOf("#onboard-overlay", placeAt);
  const backAt = layout.indexOf("return;", onboardAt);
  const scrollAt = layout.indexOf("scrollIntoView", placeAt);
  assert.ok(placeAt >= 0 && onboardAt > placeAt && backAt > onboardAt && backAt < scrollAt);
  const css = source("../style.css");
  const ruleAt = css.indexOf("#onboard-overlay {");
  const rule = css.slice(ruleAt, css.indexOf("#onboard-overlay .onboard-card.is-kb-return"));
  assert.match(rule, /--onboard-kb-gap:\s*calc\(var\(--fu, var\(--u, 1rem\)\) \* 0\.75\)/);
  assert.equal(rule.includes("px"), false);
  const page = source("../onboarding.js");
  assert.match(page, /bindOnboardKeyboard\(overlay, card\)/);
  assert.match(page, /\.install-choice-input/);
  assert.doesNotMatch(source("../installchoice.js"), /onboardCardLift|visualViewport/);
});
