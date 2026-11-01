// Popup photo opens the feed profile in the feed, the peek, and map mode.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function readHook() {
  const source = fs.readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const start = source.indexOf("window.openProfileFromPopup =");
  assert.notEqual(start, -1);
  let depth = 0;
  let started = false;
  let end = start;
  for (; end < source.length; end++) {
    const ch = source[end];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
    }
    if (started && depth === 0 && ch === ";") return source.slice(start, end + 1);
  }
  assert.fail("openProfileFromPopup assignment did not close");
}

function fakeRoot(display, peek) {
  const classes = new Set(peek ? ["is-peek"] : []);
  return {
    style: { display },
    classList: {
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
    },
  };
}

function loadHook(root, calls, feedflyOpen) {
  const windowObj = {
    layerIsOpen: (name) => feedflyOpen === true && name === "feedfly",
    layerClosedByUI(name) {
      if (name === "feedfly") calls.feedfly += 1;
    },
  };
  const open = new Function(
    "window",
    "root",
    "feedOn",
    "feedCovers",
    "reveal",
    "openFeedProfile",
    `${readHook()}\nreturn window.openProfileFromPopup;`,
  )(
    windowObj,
    root,
    () => root.style.display !== "none",
    () => root.style.display !== "none" && !root.classList.contains("is-peek"),
    () => {
      calls.reveal += 1;
      root.classList.remove("is-peek");
    },
    (payer) => {
      calls.profile += 1;
      calls.payer = payer;
    },
  );
  return open;
}

test("openProfileFromPopup opens the profile when the feed is not covering", () => {
  const root = fakeRoot("none", false);
  const calls = { reveal: 0, profile: 0, feedfly: 0, payer: "" };
  const open = loadHook(root, calls, false);
  assert.equal(open("0.0.9779355"), true);
  assert.equal(calls.profile, 1);
  assert.equal(calls.payer, "0.0.9779355");
  assert.equal(calls.reveal, 0);
  assert.equal(calls.feedfly, 0);
});

test("openProfileFromPopup leaves the peek, then opens the profile", () => {
  const root = fakeRoot("block", true);
  const calls = { reveal: 0, profile: 0, feedfly: 0, payer: "" };
  const open = loadHook(root, calls, true);
  assert.equal(open("0.0.9779355"), true);
  assert.equal(calls.reveal, 1);
  assert.equal(calls.feedfly, 1);
  assert.equal(calls.profile, 1);
  assert.equal(calls.payer, "0.0.9779355");
  assert.equal(root.classList.contains("is-peek"), false);
});

test("openProfileFromPopup returns false for a non-account id", () => {
  const root = fakeRoot("none", false);
  const calls = { reveal: 0, profile: 0, feedfly: 0, payer: "" };
  const open = loadHook(root, calls, false);
  assert.equal(open("not-an-account"), false);
  assert.equal(calls.profile, 0);
  assert.equal(calls.reveal, 0);
});
