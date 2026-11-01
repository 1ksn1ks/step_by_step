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

function readLoadTail() {
  const source = fs.readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const fn = source.indexOf("async function loadProfilePosts");
  const start = source.indexOf("if (!feedOn()) {", fn);
  const marker = "showLoadedProfileFeed(payer);";
  const end = source.indexOf(marker, start);
  assert.notEqual(fn, -1);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end + marker.length);
}

function readUncover() {
  const source = fs.readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const start = source.indexOf("function uncoverPopupUnderProfile()");
  assert.notEqual(start, -1);
  let depth = 0;
  let started = false;
  for (let end = start; end < source.length; end++) {
    const ch = source[end];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, end + 1);
    }
  }
  assert.fail("uncoverPopupUnderProfile did not close");
}

// Photo, Load posts, then Back, with the same window the page uses.
function peekLoadBack(feedOn) {
  const root = fakeRoot(feedOn ? "block" : "none", true);
  const calls = {
    reveal: 0,
    profile: 0,
    feedfly: 0,
    dismiss: 0,
    closeProfileLayer: 0,
    closeFeedProfile: 0,
    ensure: 0,
    hide: 0,
    show: 0,
    restore: 0,
    popup: true,
    feedflyOpen: true,
    feedprofileOpen: false,
  };
  const windowObj = {
    __profileCoversPopup: false,
    layerIsOpen(name) {
      if (name === "feedfly") return calls.feedflyOpen;
      if (name === "feedprofile") return calls.feedprofileOpen;
      return false;
    },
    layerClosedByUI(name) {
      if (name === "feedfly") {
        calls.feedfly += 1;
        calls.feedflyOpen = false;
      }
      if (name === "feedprofile") {
        calls.closeProfileLayer += 1;
        calls.feedprofileOpen = false;
      }
    },
    dismissBioPopups() {
      calls.dismiss += 1;
      calls.popup = false;
    },
    restorePopupsForPage() {
      calls.restore += 1;
      return calls.popup === true;
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
      calls.feedprofileOpen = true;
    },
  );
  const opened = open("0.0.9779355");
  new Function(
    "window",
    "feedOn",
    "closeFeedProfile",
    "ensureTopic",
    "hideProfilePage",
    "showLoadedProfileFeed",
    "payer",
    readLoadTail(),
  )(
    windowObj,
    () => feedOn,
    () => { calls.closeFeedProfile += 1; },
    () => { calls.ensure += 1; },
    () => { calls.hide += 1; },
    () => { calls.show += 1; },
    "0.0.9779355",
  );
  const back = new Function(
    "window",
    "feedOn",
    "root",
    "syncCover",
    "syncFeedMapBack",
    `let peek = false;\nlet revealToken = 0;\n${readUncover()}\nuncoverPopupUnderProfile();\nreturn { peek, flag: window.__profileCoversPopup, peekClass: root.classList.contains("is-peek") };`,
  )(
    windowObj,
    () => root.style.display !== "none",
    root,
    () => { calls.sync = (calls.sync || 0) + 1; },
    () => { calls.syncMap = (calls.syncMap || 0) + 1; },
  );
  return { opened, calls, root, back, windowObj };
}

test("peek mode Load posts drops the covered popup so Back does not restore it", () => {
  const { opened, calls, back, windowObj } = peekLoadBack(true);
  assert.equal(opened, true);
  assert.equal(calls.profile, 1);
  assert.equal(calls.reveal, 1);
  assert.equal(calls.feedfly, 1);
  assert.equal(calls.dismiss, 1);
  assert.equal(calls.popup, false);
  assert.equal(windowObj.__profileCoversPopup, false);
  assert.equal(calls.closeProfileLayer, 1);
  assert.equal(calls.feedprofileOpen, false);
  assert.equal(calls.closeFeedProfile, 0);
  assert.equal(calls.ensure, 1);
  assert.equal(calls.hide, 1);
  assert.equal(calls.show, 1);
  assert.equal(back.peek, false);
  assert.equal(back.peekClass, false);
  assert.equal(back.flag, false);
  assert.equal(calls.restore, 1);
  assert.equal(calls.sync || 0, 0);
});

test("a feed-card Load posts does not dismiss a popup or close profile history", () => {
  const source = readLoadTail();
  const calls = { dismiss: 0, closeProfileLayer: 0, closeFeedProfile: 0, ensure: 0, hide: 0, show: 0 };
  const windowObj = {
    __profileCoversPopup: false,
    layerIsOpen: () => true,
    layerClosedByUI() { calls.closeProfileLayer += 1; },
    dismissBioPopups() { calls.dismiss += 1; },
  };
  new Function(
    "window",
    "feedOn",
    "closeFeedProfile",
    "ensureTopic",
    "hideProfilePage",
    "showLoadedProfileFeed",
    "payer",
    source,
  )(
    windowObj,
    () => true,
    () => { calls.closeFeedProfile += 1; },
    () => { calls.ensure += 1; },
    () => { calls.hide += 1; },
    () => { calls.show += 1; },
    "0.0.9779355",
  );
  assert.equal(calls.dismiss, 0);
  assert.equal(calls.closeProfileLayer, 0);
  assert.equal(calls.closeFeedProfile, 0);
  assert.equal(windowObj.__profileCoversPopup, false);
  assert.equal(calls.ensure, 1);
  assert.equal(calls.hide, 1);
  assert.equal(calls.show, 1);
});

test("map mode Load posts still closes the profile and does not open the feed", () => {
  const calls = { dismiss: 0, closeFeedProfile: 0, ensure: 0, show: 0, closeProfileLayer: 0 };
  const windowObj = {
    __profileCoversPopup: true,
    dismissBioPopups() { calls.dismiss += 1; },
    layerIsOpen: () => true,
    layerClosedByUI() { calls.closeProfileLayer += 1; },
  };
  new Function(
    "window",
    "feedOn",
    "closeFeedProfile",
    "ensureTopic",
    "hideProfilePage",
    "showLoadedProfileFeed",
    "payer",
    readLoadTail(),
  )(
    windowObj,
    () => false,
    () => { calls.closeFeedProfile += 1; },
    () => { calls.ensure += 1; },
    () => {},
    () => { calls.show += 1; },
    "0.0.9779355",
  );
  assert.equal(calls.dismiss, 1);
  assert.equal(calls.closeFeedProfile, 1);
  assert.equal(calls.ensure, 0);
  assert.equal(calls.show, 0);
  assert.equal(calls.closeProfileLayer, 0);
  assert.equal(windowObj.__profileCoversPopup, true);
});
