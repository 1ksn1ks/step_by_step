// Plain short counts (countformat.js) read by their exact number, the way
// postcounts.js stat() labels one: role="img", and aria-label and title
// both "1234 views", "1 follower", "1234 following", "Received 1.50 HBAR".
// The short text stays what shows. Each painter keeps all three in step,
// and drops them when there is no number to read.
//
// The painters live in modules that load the map and the wallet, so each
// is read from its source and run here with stand-ins for what it calls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatCount, formatHbarCount } from "../countformat.js";
import { followerCountOrNull } from "../followcount.js";
import { followingCountText } from "../followingstate.js";
import { bareAccount, formatDonationAmount, formatHbar } from "../donationmath.js";

// The working copy has CRLF line ends.
function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

// One function's source, by its braces.
function fn(src, name) {
  const at = src.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.ok(at >= 0, name);
  const brace = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1).replace(/^export /, "");
    }
  }
  throw new Error(`no end for ${name}`);
}

class El {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.isConnected = true;
    this.className = "";
    this.text = "";
  }
  get classList() {
    const names = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const write = (set) => { this.className = [...set].join(" "); };
    return {
      add: (...list) => { const set = names(); list.forEach((n) => set.add(n)); write(set); },
      remove: (...list) => { const set = names(); list.forEach((n) => set.delete(n)); write(set); },
      contains: (name) => names().has(name),
      toggle: (name, force) => {
        const set = names();
        const on = force === undefined ? !set.has(name) : !!force;
        if (on) set.add(name);
        else set.delete(name);
        write(set);
        return on;
      },
    };
  }
  // As in a browser: the title property is the title attribute.
  get title() { return this.getAttribute("title") || ""; }
  set title(value) { this.setAttribute("title", value); }
  set textContent(value) {
    this.children = [];
    this.text = String(value);
  }
  get textContent() {
    return this.text + this.children.map((kid) => kid.textContent).join("");
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  replaceChildren(...nodes) { this.text = ""; this.children = []; this.append(...nodes); }
  querySelectorAll(selector) {
    const name = selector.replace(/^\./, "");
    const found = [];
    const walk = (node) => {
      for (const kid of node.children) {
        if (kid.className.split(/\s+/).includes(name)) found.push(kid);
        walk(kid);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const doc = { createElement: (tag) => new El(tag), createElementNS: (ns, tag) => new El(tag) };

function named(node) {
  return { role: node.getAttribute("role"), label: node.getAttribute("aria-label"), title: node.getAttribute("title") };
}
const img = (label) => ({ role: "img", label, title: label });
const none = { role: null, label: null, title: null };

const popups = read("../processallmessages.js");

test("feed and popup views: the chip is one image named by its exact views, and an update renames it", () => {
  const { viewsChip, setViewsCount } = new Function("document", "formatCount", "popupStrokeIcon", "VIEWS_BARS", `
    ${fn(popups, "viewLabel")}
    ${fn(popups, "viewsChip")}
    ${fn(popups, "setViewsCount")}
    return { viewsChip, setViewsCount };
  `)(doc, formatCount, () => new El("svg"), []);
  const chip = viewsChip(1234);
  assert.equal(chip.className, "feed-views");
  assert.equal(chip.querySelector(".feed-view-count").textContent, "1.2k");
  assert.deepEqual(named(chip), img("1234 views"));
  setViewsCount(chip, 1);
  assert.equal(chip.querySelector(".feed-view-count").textContent, "1");
  assert.deepEqual(named(chip), img("1 view"));
  setViewsCount(chip, 0);
  assert.deepEqual(named(chip), img("0 views"));
  setViewsCount(chip, 1_250_000);
  assert.equal(chip.querySelector(".feed-view-count").textContent, "1.2M");
  assert.deepEqual(named(chip), img("1250000 views"));
  assert.deepEqual(named(viewsChip(1)), img("1 view"));
  // Every update goes through setViewsCount: the popup's count, its
  // settings sample, and the feed (feedlayout.js).
  const paint = fn(popups, "paintPopupView");
  assert.equal(paint.split("setViewsCount(").length - 1, 2);
  assert.match(popups, /if \(views\) \{\s*setViewsCount\(views, 2\);/);
  assert.match(read("../feedlayout.js"), /setViewsCount\(node\.parentElement, num\);/);
});

test("the settings sample's follower chip reads and shows 0 followers", () => {
  const { showPreviewFollowZero } = new Function(`${fn(popups, "showPreviewFollowZero")} return { showPreviewFollowZero };`)();
  const root = new El();
  const box = root.appendChild(new El());
  box.className = "topic-follow";
  const count = box.appendChild(new El());
  count.className = "topic-follow-count is-loading";
  count.setAttribute("role", "img");
  count.setAttribute("aria-label", "Followers");
  const value = count.appendChild(new El("span"));
  value.className = "topic-follow-num-value";
  showPreviewFollowZero(root);
  assert.deepEqual(named(count), img("0 followers"));
  assert.equal(value.textContent, "0");
  assert.equal(count.classList.contains("is-loading"), false);
});

test("the follower chip: the short count shows, the exact one and its word are its name and title", () => {
  const follow = read("../followtopic.js");
  const { countChip, paintFollowerCount, paintFollowerUnknown } = new Function(
    "document", "window", "followerCountOrNull", "formatCount", "followIcon", "svgEl", `
    ${fn(follow, "countValue")}
    ${fn(follow, "countChip")}
    ${fn(follow, "paintFollowerCount")}
    ${fn(follow, "paintFollowerUnknown")}
    return { countChip, paintFollowerCount, paintFollowerUnknown };
  `)(doc, { matchMedia: () => ({ matches: true }) }, followerCountOrNull, formatCount, () => new El("svg"), () => new El("path"));
  const chip = countChip();
  // Loading: an image named "Followers", no number yet, no title.
  assert.deepEqual(named(chip), { role: "img", label: "Followers", title: null });
  paintFollowerCount(chip, 1234);
  assert.equal(chip.querySelector(".topic-follow-num-value").textContent, "1.2k");
  assert.deepEqual(named(chip), img("1234 followers"));
  paintFollowerCount(chip, 1);
  assert.deepEqual(named(chip), img("1 follower"));
  paintFollowerCount(chip, 0);
  assert.deepEqual(named(chip), img("0 followers"));
  // No number: left as it is.
  paintFollowerCount(chip, null);
  assert.deepEqual(named(chip), img("0 followers"));
  // A failed read keeps its own words; a later count replaces them.
  paintFollowerUnknown(chip);
  assert.deepEqual(named(chip), { role: "img", label: "Followers couldn't load", title: "Couldn't load" });
  assert.equal(chip.querySelector(".topic-follow-num-value").textContent, "–");
  paintFollowerCount(chip, 5);
  assert.deepEqual(named(chip), img("5 followers"));
  assert.equal(follow.includes("NumberFormat"), false);
});

test("the live bar: a count is an image named by its raw numbers; Connect wallet and Loading are read as they show", () => {
  const news = read("../localnews.js");
  const live = new Function("formatCount", "el", `
    let liveAll = [];
    let localList = [];
    let group = 'all';
    let wallet = '0.0.1';
    let followLoad = false;
    let holdersReady = true;
    const groupNow = () => group;
    const needsWallet = (g) => g === 'following' || g === 'mine';
    const walletNow = () => wallet;
    const earlyHashinalReady = () => holdersReady;
    const liveGroupName = () => group;
    let liveBar = null;
    const livePillName = el();
    const livePill = el();
    const liveCount = el();
    liveCount.setAttribute('aria-live', 'polite');
    const ensureLiveBar = () => { liveBar = liveBar || el(); return liveBar; };
    const hideLiveBar = () => { if (liveBar) liveBar.hidden = true; };
    ${fn(news, "liveCountCopy")}
    ${fn(news, "paintLiveBar")}
    return {
      liveCount,
      liveCountCopy,
      paintLiveBar,
      set(state) {
        if ('all' in state) liveAll = Array.from({ length: state.all });
        if ('shown' in state) localList = Array.from({ length: state.shown });
        if ('group' in state) group = state.group;
        if ('wallet' in state) wallet = state.wallet;
        if ('followLoad' in state) followLoad = state.followLoad;
        if ('holdersReady' in state) holdersReady = state.holdersReady;
      },
    };
  `)(formatCount, () => new El("span"));
  const show = (state) => {
    live.set(state);
    live.paintLiveBar();
    return { text: live.liveCount.textContent, ...named(live.liveCount), live: live.liveCount.getAttribute("aria-live") };
  };
  assert.deepEqual(show({ all: 1234, shown: 1234, group: "all" }), { text: "1.2k posts", ...img("1234 posts"), live: "polite" });
  assert.deepEqual(show({ all: 1, shown: 1 }), { text: "1 post", ...img("1 post"), live: "polite" });
  // No live posts hides the bar; the copy would read 0 posts.
  live.set({ all: 0, shown: 0 });
  assert.deepEqual(live.liveCountCopy(), { text: "0 posts", exact: "0 posts" });
  // A filtered group reads "shown of total".
  assert.deepEqual(show({ all: 1234, shown: 12, group: "holders" }), { text: "12 of 1.2k", ...img("12 of 1234 posts"), live: "polite" });
  assert.deepEqual(show({ all: 1, shown: 1 }), { text: "1 of 1", ...img("1 of 1 post"), live: "polite" });
  assert.deepEqual(show({ all: 3400, shown: 1200, group: "following", followLoad: false }), { text: "1.2k of 3.4k", ...img("1200 of 3400 posts"), live: "polite" });
  // No number: no image, no name, no title. aria-live stays.
  assert.deepEqual(show({ group: "following", wallet: "" }), { text: "Connect wallet", ...none, live: "polite" });
  assert.deepEqual(show({ wallet: "0.0.1", followLoad: true }), { text: "Loading…", ...none, live: "polite" });
  assert.deepEqual(show({ group: "holders", holdersReady: false }), { text: "Loading…", ...none, live: "polite" });
  // And back to a count.
  assert.deepEqual(show({ holdersReady: true, all: 2, shown: 1 }), { text: "1 of 2", ...img("1 of 2 posts"), live: "polite" });
  assert.equal(news.includes("NumberFormat"), false);
});

test("the Following picker's count: \"1234 following\" when ready, nothing before", () => {
  const picker = read("../picker.js");
  const pick = new Function("el", `
    let countEl = el();
    ${fn(picker, "paintFollowingExact")}
    return { countEl, paintFollowingExact };
  `)(() => new El("div"));
  const paint = (status, n) => {
    pick.countEl.textContent = followingCountText(status, n);
    pick.paintFollowingExact(status, n);
    return { text: pick.countEl.textContent, ...named(pick.countEl) };
  };
  // Loading, as the picker is built: no text, no name.
  assert.deepEqual(paint("loading", 0), { text: "", ...none });
  assert.deepEqual(paint("ready", 1234), { text: "1.2k following", ...img("1234 following") });
  assert.deepEqual(paint("ready", 1), { text: "1 following", ...img("1 following") });
  assert.deepEqual(paint("ready", 0), { text: "0 following", ...img("0 following") });
  assert.deepEqual(paint("offline", 0), { text: "", ...none });
  // rebuild paints the text and the name together.
  assert.match(fn(picker, "rebuild"), /countEl\.textContent = followingCountText\(status, tabItems\.length\);\s*paintFollowingExact\(status, tabItems\.length\);/);
  assert.match(picker, /countEl\.className = 'picker-count';\s*countEl\.textContent = followingCountText\('loading', 0\);/);
  assert.equal(picker.includes("NumberFormat"), false);
});

test("paintReceived: an image named by the exact amount, cleared when it paints again", async () => {
  const donations = read("../donations.js");
  let reply = { received: "1234.5" };
  const fetches = [];
  const paintReceived = new Function(
    "bareAccount", "BACKEND_URL", "fetch", "formatHbar", "formatDonationAmount", "formatHbarCount",
    `${fn(donations, "paintReceived")} return paintReceived;`,
  )(bareAccount, "https://backend.test", async (url) => {
    fetches.push(url);
    return { ok: true, json: async () => reply };
  }, formatHbar, formatDonationAmount, formatHbarCount);
  const el = new El("span");
  paintReceived(el, "0.0.55");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(el.textContent, "Received 1.2k HBAR");
  assert.deepEqual(named(el), img("Received 1234.50 HBAR"));
  // Painting another account clears the old name with the old text.
  reply = { received: "1.5" };
  paintReceived(el, "0.0.56");
  assert.deepEqual({ text: el.textContent, ...named(el) }, { text: "", ...none });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual({ text: el.textContent, ...named(el) }, { text: "Received 1.50 HBAR", ...img("Received 1.50 HBAR") });
  paintReceived(el, "");
  assert.deepEqual({ text: el.textContent, ...named(el) }, { text: "", ...none });
  assert.equal(fetches.length, 2);
});

test("controls keep their own names: the heart, the comment count and Follow get no role=\"img\"", () => {
  for (const name of ["createHeartLike", "writeCount", "applyHeartView"]) {
    assert.equal(/'role'|"role"/.test(fn(popups, name)), false, name);
  }
  const follow = read("../followtopic.js");
  assert.equal(/'role'|"role"/.test(fn(follow, "paintFollowButton")), false);
  // postcounts.js is the pattern and is left as it is.
  const counts = read("../postcounts.js");
  assert.match(fn(counts, "stat"), /el\.setAttribute\(['"]role['"], ['"]img['"]\);\s*el\.setAttribute\(['"]aria-label['"], label\);\s*el\.title = label;/);
});
