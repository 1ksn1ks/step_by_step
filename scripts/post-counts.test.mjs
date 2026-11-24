// Likes and views on the map's hold / right-click info card (maptip.js)
// and on the rows of a cluster's post list (markerstack.js), both from
// postcounts.js: a snapshot of what is known, nothing fetched, no view
// counted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Any request from here on is a failure: the card and the list never ask
// the server for anything (POST /api/popup-view above all).
const requests = [];
globalThis.fetch = (...args) => {
  requests.push(args);
  return Promise.reject(new Error("no network in this test"));
};

// Just enough DOM for postcounts.js, fillMapTip and buildRow.
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.className = "";
    this.title = "";
    this.text = "";
    this.listeners = {};
  }
  set textContent(value) {
    this.children = [];
    this.text = value == null ? "" : String(value);
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  get childElementCount() { return this.children.length; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  appendChild(node) {
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  replaceChildren(...nodes) {
    this.children = [];
    this.text = "";
    this.append(...nodes);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
}
globalThis.document = {
  createElement: (tag) => new El(tag),
  createElementNS: (ns, tag) => Object.assign(new El(tag), { ns }),
  getElementById: () => null,
};
const has = (el, cls) => String(el.className || "").split(/\s+/).includes(cls);
function find(el, cls) {
  if (has(el, cls)) return el;
  for (const child of el.children) {
    const hit = find(child, cls);
    if (hit) return hit;
  }
  return null;
}

const { countsFor, countsNode, VIEWS_BARS, HEART } = await import("../postcounts.js");
const { takePopupViews } = await import("../msgbackend.js");

const created = "2026-11-20T10:00:00.000Z";

test("likes: the post's count, 0 when unknown, the larger one when a share or live pin sets both", () => {
  assert.equal(countsFor({ likeCountMarker: 12 }).likes, 12);
  assert.equal(countsFor({ likeCountPolygon: 3 }).likes, 3);
  assert.equal(countsFor({ likeCountMarker: 0 }).likes, 0);
  assert.equal(countsFor({}).likes, 0);
  assert.equal(countsFor(null).likes, 0);
  // Share and live pins write the same number to both.
  assert.equal(countsFor({ likeCountMarker: 5, likeCountPolygon: 5 }).likes, 5);
  assert.equal(countsFor({ likeCountMarker: 3, likeCountPolygon: 7 }).likes, 7);
  assert.equal(countsFor({ likeCountMarker: 9, likeCountPolygon: undefined }).likes, 9);
  // Missing or not a number counts as 0.
  assert.equal(countsFor({ likeCountMarker: NaN, likeCountPolygon: null }).likes, 0);
  assert.equal(countsFor({ likeCountMarker: "8" }).likes, 8);
  assert.equal(countsFor({ likeCountMarker: -4 }).likes, 0);
});

test("views: the popup's own counter, then the pin's viewCount, and null while neither is known", () => {
  // That topic's counts never loaded and no viewCount: unknown.
  assert.equal(countsFor({ topicId: "0.0.5", created, likeCountMarker: 2 }).views, null);
  takePopupViews("0.0.5", { [created]: 1999 });
  assert.equal(countsFor({ topicId: "0.0.5", created }).views, 1999);
  // The same time written another way names the same post.
  assert.equal(countsFor({ topicId: "0.0.5", created: "2026-11-20T10:00:00Z" }).views, 1999);
  // Loaded, but nobody has opened this one: 0.
  assert.equal(countsFor({ topicId: "0.0.5", created: "2026-11-21T10:00:00.000Z" }).views, 0);
  // A share or live pin's viewCount when the popup counter is not loaded,
  // the larger one when both are.
  assert.equal(countsFor({ topicId: "0.0.77", created, viewCount: 1_200_000 }).views, 1_200_000);
  assert.equal(countsFor({ topicId: "0.0.5", created, viewCount: 40 }).views, 1999);
  assert.equal(countsFor({ topicId: "0.0.5", created, viewCount: 5000 }).views, 5000);
  assert.equal(countsFor({ topicId: "0.0.77", created, viewCount: null }).views, null);
  // No topic or time to look up: only a viewCount can say.
  assert.equal(countsFor({ topicId: "Anonymous", created }).views, null);
  assert.equal(countsFor({ topicId: "0.0.5", created: "not a date" }).views, null);
  assert.equal(countsFor({ viewCount: 0 }).views, 0);
});

test("the counts read short (1.9k, 1.2M), with the exact number as the label, and no views while unknown", () => {
  const both = countsNode({ likeCountMarker: 1999, viewCount: 1_234_567 }, "map-tip-counts");
  assert.equal(both.className, "map-tip-counts");
  assert.equal(both.children.length, 2);
  const [likes, views] = both.children;
  assert.ok(has(likes, "post-count-likes"));
  assert.ok(has(views, "post-count-views"));
  assert.equal(find(likes, "post-count-n").textContent, "1.9k");
  assert.equal(find(views, "post-count-n").textContent, "1.2M");
  assert.equal(likes.getAttribute("aria-label"), "1999 likes");
  assert.equal(views.getAttribute("aria-label"), "1234567 views");
  assert.equal(likes.getAttribute("role"), "img");
  // Icons: the heart, then the popup's views bars.
  assert.equal(likes.children[0].tagName, "SVG");
  assert.equal(likes.children[0].getAttribute("aria-hidden"), "true");
  assert.deepEqual(views.children[0].children.map((line) => line.attrs), VIEWS_BARS.map(([, attrs]) => attrs));
  assert.equal(likes.children[0].children[0].getAttribute("d"), HEART[0][1].d);

  const zero = countsNode({ likeCountPolygon: 0, viewCount: 0 }, "x");
  assert.deepEqual(zero.children.map((stat) => find(stat, "post-count-n").textContent), ["0", "0"]);
  assert.equal(zero.children[0].getAttribute("aria-label"), "0 likes");
  assert.equal(countsNode({ likeCountMarker: 1, viewCount: 1 }, "x").children[1].getAttribute("aria-label"), "1 view");

  // Views unknown: likes only.
  const likesOnly = countsNode({ likeCountMarker: 4, topicId: "0.0.99", created }, "x");
  assert.equal(likesOnly.children.length, 1);
  assert.ok(has(likesOnly.children[0], "post-count-likes"));
  assert.equal(countsNode(null, "x"), null);
});

// One top-level function's source: from its line to the next one.
function topLevel(source, start) {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, start);
  const next = source.slice(at + start.length).search(/\n(export )?(async )?function /);
  return source.slice(at, next < 0 ? undefined : at + start.length + next);
}

// maptip.js as it is, its imports given here.
const tipSource = read("../maptip.js");
function tipFiller({ early = false } = {}) {
  const body = tipSource.slice(tipSource.indexOf("const HASHINAL_TIP_COLORS")).replace(/export function/g, "function");
  return new Function("usernames", "globalLoadedTopicIdsWithNames", "earlyHashinalNumber", "countsNode", "document", `
    ${body}
    return fillMapTip;
  `)({}, ["0.0.5 - Street art"], () => (early ? 7 : 0), countsNode, globalThis.document);
}
const markerRecord = (extra = {}) => ({
  title: "Mural",
  payer: "0.0.123",
  username: "Ana",
  topicId: "0.0.5",
  created,
  likeCountMarker: 1999,
  ...extra,
});

test("the info card keeps its title, By and On, then adds one row of likes and views", () => {
  const fill = tipFiller();
  const tip = new El("div");
  // A marker's lazy record.
  assert.equal(fill(tip, { properties: { popupData: () => markerRecord() } }), true);
  assert.equal(tip.children.length, 4);
  const [title, by, on, counts] = tip.children;
  assert.equal(find(title, "map-tip-title").textContent, "Mural");
  assert.equal(find(by, "map-tip-k").textContent, "By");
  assert.equal(find(by, "map-tip-id").textContent, "0.0.123");
  assert.equal(find(by, "map-tip-name").textContent, "Ana");
  assert.equal(find(on, "map-tip-k").textContent, "On");
  assert.equal(find(on, "map-tip-name").textContent, "Street art");
  // Under By and On, in no bubble of its own.
  assert.equal(counts.className, "map-tip-counts");
  assert.deepEqual(counts.children.map((stat) => find(stat, "post-count-n").textContent), ["1.9k", "1.9k"]);

  // A polygon's record (an object), views not loaded: likes only.
  const polygon = new El("div");
  fill(polygon, { popupData: { ...markerRecord({ topicId: "0.0.404", likeCountMarker: undefined, likeCountPolygon: 0 }) } });
  const row = polygon.children.at(-1);
  assert.equal(row.className, "map-tip-counts");
  assert.equal(row.children.length, 1);
  assert.equal(find(row, "post-count-n").textContent, "0");

  // A share pin: the fresh record once it has arrived, the larger like count.
  const share = new El("div");
  fill(share, { properties: {
    popupData: () => markerRecord({ likeCountMarker: 1, likeCountPolygon: 1, viewCount: 2 }),
    _shareRecord: markerRecord({ topicId: "0.0.77", likeCountMarker: 1_200_000, likeCountPolygon: 1_200_000, viewCount: 1_250_000 }),
  } });
  assert.deepEqual(share.children.at(-1).children.map((stat) => find(stat, "post-count-n").textContent), ["1.2M", "1.2M"]);

  // Refilled (another post): the row is replaced, not added again.
  fill(tip, { properties: { popupData: () => markerRecord({ likeCountMarker: 0, viewCount: 0, topicId: "0.0.77" }) } });
  assert.equal(tip.children.filter((child) => child.className === "map-tip-counts").length, 1);
  assert.deepEqual(tip.children.at(-1).children.map((stat) => find(stat, "post-count-n").textContent), ["0", "0"]);

  // An early holder's card keeps its colours and gains the same row.
  const early = new El("div");
  tipFiller({ early: true })(early, { properties: { popupData: () => markerRecord() } });
  assert.equal(find(early.children[0], "map-tip-title").style.color, "#ffffff");
  assert.equal(find(early.children[1], "map-tip-name").style.color, "#f6e27a");
  assert.equal(early.children.at(-1).className, "map-tip-counts");

  // Nothing to show: still no card.
  assert.equal(fill(new El("div"), { properties: {} }), false);
});

// markerstack.js's row as it is, its imports given here.
const stackSource = read("../markerstack.js");
function rowBuilder() {
  const picks = [];
  const build = new Function("avatarSrc", "pictureElement", "countsNode", "pick", "document", `
    const described = new WeakMap();
    ${topLevel(stackSource, "function recordOf(")}
    ${topLevel(stackSource, "function plainText(")}
    ${topLevel(stackSource, "function fold(")}
    ${topLevel(stackSource, "function describe(")}
    ${topLevel(stackSource, "function buildRow(")}
    return { buildRow, describe };
  `)(() => "", () => new El("img"), countsNode, (feature) => picks.push(feature), globalThis.document);
  return { ...build, picks };
}

test("a cluster list row keeps its title, name, date and account ID, and adds the counts after the ID", () => {
  const { buildRow, describe, picks } = rowBuilder();
  const feature = {
    payer: "0.0.123",
    properties: { popupData: () => markerRecord({ timestamp: "11/20/2026, 10:00:00", msg: "paint" }) },
  };
  const row = buildRow(feature);
  const body = find(row.el, "marker-stack-body");
  assert.deepEqual(body.children.map((child) => child.className), ["marker-stack-title", "marker-stack-meta", "marker-stack-account"]);
  assert.equal(body.children[0].textContent, "Mural");
  assert.equal(body.children[1].textContent, "Ana · 11/20/2026, 10:00:00");
  const line = body.children[2];
  // The ID first, as the line's own text, then the counts.
  assert.equal(line.text, "0.0.123");
  assert.ok(line.textContent.startsWith("0.0.123"));
  assert.equal(line.children.length, 1);
  const counts = line.children[0];
  assert.equal(counts.className, "marker-stack-counts");
  assert.deepEqual(counts.children.map((stat) => find(stat, "post-count-n").textContent), ["1.9k", "1.9k"]);
  // The search still reads the same text (no counts in it), and a tap
  // still opens the post.
  assert.equal(describe(feature).hay.includes("1.9k"), false);
  assert.ok(describe(feature).hay.includes("paint"));
  row.el.listeners.click[0]();
  assert.deepEqual(picks, [feature]);

  // A share pin with views unknown: the larger like count, likes only.
  const share = buildRow({ properties: { _shareRecord: markerRecord({ topicId: "0.0.808", likeCountMarker: 6, likeCountPolygon: 6 }) } });
  const shareCounts = find(share.el, "marker-stack-counts");
  assert.equal(shareCounts.children.length, 1);
  assert.equal(find(shareCounts, "post-count-n").textContent, "6");

  // No account ID: the counts still have their line.
  const anon = buildRow({ properties: { popupData: () => ({ title: "x", payerInfo: "", likeCountMarker: 0, viewCount: 1_000_000 }) } });
  const anonLine = find(anon.el, "marker-stack-account");
  assert.equal(anonLine.text, "");
  assert.deepEqual(find(anonLine, "marker-stack-counts").children.map((stat) => find(stat, "post-count-n").textContent), ["0", "1M"]);
});

test("nothing is fetched and no view is counted: no popup-view, no live heart, no popup module", () => {
  assert.deepEqual(requests, []);
  const counts = read("../postcounts.js");
  const imports = [...counts.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./msgbackend.js", "./countformat.js"]);
  for (const [name, source] of [["postcounts.js", counts], ["maptip.js", tipSource], ["markerstack.js", stackSource]]) {
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /popupView\(|\/api\/popup-view|fetch\(|createHeartLike|processallmessages/, name);
  }
  assert.match(tipSource, /import \{ countsNode \} from '\.\/postcounts\.js';/);
  assert.match(stackSource, /import \{ countsNode \} from '\.\/postcounts\.js';/);
  // The bars are the popup's own.
  const popup = read("../processallmessages.js");
  const bars = popup.slice(popup.indexOf("const VIEWS_BARS = ["), popup.indexOf("];", popup.indexOf("const VIEWS_BARS = [")));
  for (const [, attrs] of VIEWS_BARS) {
    assert.ok(bars.includes(`x1: '${attrs.x1}', x2: '${attrs.x2}', y1: '${attrs.y1}', y2: '${attrs.y2}'`));
  }
});

test("the counts' rules: in the tips and the list only, sized in em, no fixed px", () => {
  const css = read("../style.css");
  const tip = css.slice(css.indexOf("/* Likes and views (postcounts.js)"), css.indexOf("/* Payer CLICK2LINK"));
  const list = css.slice(css.indexOf("/* The post's likes and views after the account ID"), css.indexOf(".marker-stack-empty {"));
  for (const block of [tip, list]) {
    assert.ok(block.length > 100);
    const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(rules, /\d(\.\d+)?px/);
    for (const selector of rules.match(/^[^\s{}][^{}]*(?=\{)/gm)) {
      assert.match(selector, /^(:is\(\.marker-title-tip, \.polygon-title-tip\) > \.map-tip-counts|\.marker-stack )/, selector);
    }
  }
  assert.match(tip, /> \.map-tip-counts \{[^}]*font-size: 0\.6875em;[^}]*color: rgba\(255, 255, 255, 0\.62\);/);
  assert.match(tip, /> svg \{[^}]*width: 1\.15em;\s*height: 1\.15em;/);
  // The ID keeps its place: the line wraps the counts under it.
  assert.match(list, /\.marker-stack-account:has\(> \.marker-stack-counts\) \{\s*display: flex;\s*flex-wrap: wrap;/);
  assert.match(list, /\.marker-stack-counts \{[^}]*min-width: 0;/);
});
