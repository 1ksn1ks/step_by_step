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

function readFn(name) {
  const source = fs.readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
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
  assert.fail(`${name} did not close`);
}

function readUncover() {
  return readFn("uncoverPopupUnderProfile");
}

function classList(initial) {
  const classes = new Set(initial);
  return {
    contains: (name) => classes.has(name),
    add: (...names) => { for (const name of names) classes.add(name); },
    remove: (...names) => { for (const name of names) classes.delete(name); },
    toggle(name, on) {
      const next = on === undefined ? !classes.has(name) : !!on;
      if (next) classes.add(name);
      else classes.delete(name);
      return next;
    },
  };
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
    closeOverlays: 0,
    closeMenu: 0,
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
    "closeFeedOverlays",
    "closeMenu",
    "drawerItem",
    "menu",
    readLoadTail(),
  )(
    windowObj,
    () => feedOn,
    () => { calls.closeFeedProfile += 1; },
    () => { calls.ensure += 1; },
    () => { calls.hide += 1; },
    () => { calls.show += 1; },
    "0.0.9779355",
    () => { calls.closeOverlays += 1; },
    () => { calls.closeMenu += 1; },
    "",
    { dataset: {} },
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
  assert.equal(calls.closeOverlays, 0);
  assert.equal(calls.closeMenu, 0);
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
  const calls = {
    dismiss: 0,
    closeProfileLayer: 0,
    closeFeedProfile: 0,
    closeOverlays: 0,
    closeMenu: 0,
    ensure: 0,
    hide: 0,
    show: 0,
  };
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
    "closeFeedOverlays",
    "closeMenu",
    "drawerItem",
    "menu",
    source,
  )(
    windowObj,
    () => true,
    () => { calls.closeFeedProfile += 1; },
    () => { calls.ensure += 1; },
    () => { calls.hide += 1; },
    () => { calls.show += 1; },
    "0.0.9779355",
    () => { calls.closeOverlays += 1; },
    () => { calls.closeMenu += 1; },
    "",
    { dataset: {} },
  );
  assert.equal(calls.dismiss, 0);
  assert.equal(calls.closeProfileLayer, 0);
  assert.equal(calls.closeFeedProfile, 0);
  assert.equal(calls.closeOverlays, 0);
  assert.equal(calls.closeMenu, 0);
  assert.equal(windowObj.__profileCoversPopup, false);
  assert.equal(calls.ensure, 1);
  assert.equal(calls.hide, 1);
  assert.equal(calls.show, 1);
});

test("map mode Load posts closes every overlay and does not open the feed", () => {
  const calls = {
    dismiss: 0,
    closeFeedProfile: 0,
    closeFeedOverlays: 0,
    ensure: 0,
    show: 0,
    closeProfileLayer: 0,
  };
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
    "closeFeedOverlays",
    "closeMenu",
    "drawerItem",
    "menu",
    readLoadTail(),
  )(
    windowObj,
    () => false,
    () => { calls.closeFeedProfile += 1; },
    () => { calls.ensure += 1; },
    () => {},
    () => { calls.show += 1; },
    "0.0.9779355",
    () => { calls.closeFeedOverlays += 1; },
    () => {},
    "",
    { dataset: {} },
  );
  assert.equal(calls.dismiss, 1);
  assert.equal(calls.closeFeedOverlays, 1);
  assert.equal(calls.closeFeedProfile, 0);
  assert.equal(calls.ensure, 0);
  assert.equal(calls.show, 0);
  assert.equal(calls.closeProfileLayer, 0);
  assert.equal(windowObj.__profileCoversPopup, true);
});

// History matches historyLayers: a top close drops its entry. A close that
// is not the top leaves the entry, which is how Back would reopen the drawer.
function runDrawerProfile({ feed, action }) {
  const calls = {
    dismiss: 0,
    ensure: 0,
    hide: 0,
    show: 0,
    drop: 0,
    marked: "",
    buried: [],
    backs: [],
    seq: [],
  };
  const open = [];
  const entries = [];
  const menu = {
    hidden: false,
    dataset: {},
    classList: classList(feed ? ["is-open", "is-nav-back"] : ["is-open", "is-map-drawer", "is-nav-back"]),
  };
  const profilePage = { hidden: false };
  const feedChat = { hidden: true };
  const windowObj = {
    dismissBioPopups() { calls.dismiss += 1; },
    layerIsOpen: (name) => open.includes(name),
    layerIsTop: (name) => open[open.length - 1] === name,
    layerClosedByUI(name) {
      const i = open.lastIndexOf(name);
      if (i < 0) return;
      const top = i === open.length - 1;
      open.splice(i, 1);
      if (!top) {
        calls.buried.push(name);
        return;
      }
      if (entries[entries.length - 1] === name) {
        entries.pop();
        calls.backs.push(name);
      }
    },
  };
  if (feed) {
    open.push("feed");
    entries.push("feed");
  }
  open.push("feedmenu", "feedprofile");
  entries.push("feedmenu", "feedprofile");
  const body = `
    let drawerItem = "My profile";
    let suppressDrawerRestore = false;
    let profilePayer = "0.0.9779355";
    let profileEpoch = 1;
    let feedChatKind = "";
    let settingsOpen = false;
    function dismissProfileEditCover() {}
    function uncoverPopupUnderProfile() {}
    function hideProfilePage() {
      profilePage.hidden = true;
      calls.hide += 1;
      calls.seq.push("hide");
    }
    function clearProfileFilter() {}
    function holdNav() {}
    function markMenuItem(label) { calls.marked = label; }
    function paintMenu(openFlag) {
      menu.hidden = !openFlag;
      menu.classList.toggle("is-open", !!openFlag);
      if (!openFlag) markMenuItem("");
    }
    function dropDrawerHistory() {
      calls.drop += 1;
      calls.seq.push("menu");
      delete menu.dataset.cover;
      menu.classList.remove("is-nav-back", "is-nav-under", "is-page");
    }
    function feedCovers() { return feedCovering; }
    ${readFn("closeFeedProfile")}
    ${readFn("restoreDrawer")}
    ${readFn("closeMenu")}
    ${readFn("layerOpen")}
    ${readFn("closeFeedOverlays")}
    function runLoad() {
      ${readLoadTail()}
    }
    if (action === "load") runLoad();
    else closeFeedProfile();
    return drawerItem;
  `;
  const drawerItem = new Function(
    "window",
    "feedOn",
    "ensureTopic",
    "showLoadedProfileFeed",
    "payer",
    "calls",
    "menu",
    "profilePage",
    "feedChat",
    "feedCovering",
    "action",
    body,
  )(
    windowObj,
    () => feed,
    () => { calls.ensure += 1; calls.seq.push("ensure"); },
    () => { calls.show += 1; calls.seq.push("show"); },
    "0.0.9779355",
    calls,
    menu,
    profilePage,
    feedChat,
    feed,
    action,
  );
  return {
    calls,
    menu,
    profilePage,
    drawerItem,
    open: open.slice(),
    entries: entries.slice(),
  };
}

test("drawer My profile Load posts closes the drawer and Back returns to it", () => {
  for (const feed of [false, true]) {
    const loaded = runDrawerProfile({ feed, action: "load" });
    const where = feed ? "feed" : "map";
    assert.deepEqual(loaded.entries, feed ? ["feed"] : [], where);
    assert.deepEqual(loaded.open, loaded.entries, where);
    assert.deepEqual(loaded.calls.buried, [], where);
    assert.deepEqual(loaded.calls.backs, ["feedprofile", "feedmenu"], where);
    assert.equal(loaded.drawerItem, "", where);
    assert.equal(loaded.calls.marked, "", where);
    assert.equal(loaded.menu.hidden, true, where);
    assert.equal(loaded.menu.classList.contains("is-open"), false, where);
    assert.equal(loaded.menu.classList.contains("is-nav-back"), false, where);
    assert.equal(loaded.profilePage.hidden, true, where);
    assert.equal(loaded.calls.dismiss, feed ? 0 : 1, where);
    assert.equal(loaded.calls.show, feed ? 1 : 0, where);
    assert.equal(loaded.calls.ensure, feed ? 1 : 0, where);
    assert.equal(loaded.calls.drop, 1, where);
    if (feed) assert.deepEqual(loaded.calls.seq, ["ensure", "hide", "menu", "show"], where);
    else assert.deepEqual(loaded.calls.seq, ["hide", "menu"], where);

    const back = runDrawerProfile({ feed, action: "back" });
    assert.deepEqual(back.entries, feed ? ["feed", "feedmenu"] : ["feedmenu"], where);
    assert.deepEqual(back.open, back.entries, where);
    assert.deepEqual(back.calls.buried, [], where);
    assert.deepEqual(back.calls.backs, ["feedprofile"], where);
    assert.equal(back.drawerItem, "My profile", where);
    assert.equal(back.calls.marked, "My profile", where);
    assert.equal(back.calls.drop, 0, where);
    assert.equal(back.menu.hidden, false, where);
    assert.equal(back.menu.classList.contains("is-open"), true, where);
    assert.equal(back.menu.classList.contains("is-nav-back"), false, where);
    assert.equal(back.profilePage.hidden, true, where);
  }
});
