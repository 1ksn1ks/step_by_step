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
    this.style = {
      setProperty(name, value) { this[name] = String(value); },
      getPropertyValue(name) { return this[name] || ""; },
    };
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

// maptip.js as it is, its imports given here. The picture helpers are
// stubs: avatarSrc marks the address it was given, pictureElement makes
// an img (a video for an .mp4) that says what it was asked for, and
// forgetLoop is logged.
const tipSource = read("../maptip.js");
const DEFAULT_AVATAR = "https://example.test/default-avatar.png";
const forgotten = [];
function tipFiller({ early = false, profilePictures = {} } = {}) {
  const body = tipSource.slice(tipSource.indexOf("const HASHINAL_TIP_COLORS")).replace(/export function/g, "function");
  const avatarSrc = (url) => `thumb:${url}`;
  const pictureElement = (url, opts) => {
    const el = new El(/\.mp4$/.test(url) ? "video" : "img");
    el.className = opts.className;
    el.src = url;
    el.alt = opts.alt;
    el.fallback = opts.fallback;
    return el;
  };
  return new Function("usernames", "profilePictures", "globalLoadedTopicIdsWithNames", "earlyHashinalNumber", "countsNode", "avatarSrc", "pictureElement", "forgetLoop", "DEFAULT_AVATAR", "document", `
    ${body}
    return fillMapTip;
  `)({}, profilePictures, ["0.0.5 - Street art"], () => (early ? 7 : 0), countsNode, avatarSrc, pictureElement, (video) => forgotten.push(video), DEFAULT_AVATAR, globalThis.document);
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

test("the info card keeps its title, By and the topic (no \"On\"), then adds one row of likes and views", () => {
  const fill = tipFiller();
  const tip = new El("div");
  // A marker's lazy record.
  assert.equal(fill(tip, { properties: { popupData: () => markerRecord() } }), true);
  assert.equal(tip.children.length, 4);
  const [by, title, topic, counts] = tip.children;
  assert.equal(find(title, "map-tip-title").textContent, "Mural");
  assert.equal(find(by, "map-tip-k").textContent, "By");
  assert.equal(find(by, "map-tip-id").textContent, "0.0.123");
  assert.equal(find(by, "map-tip-name").textContent, "Ana");
  // The topic: its ID and name, with no label and no empty key.
  assert.equal(find(topic, "map-tip-k"), null);
  assert.equal(find(topic, "map-tip-id").textContent, "0.0.5");
  assert.equal(find(topic, "map-tip-name").textContent, "Street art");
  assert.equal(topic.textContent.includes("On"), false);
  // Under By and the topic, in no bubble of its own.
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
  assert.equal(find(early.children[1], "map-tip-title").style.color, "#ffffff");
  assert.equal(find(early.children[0], "map-tip-name").style.color, "#f6e27a");
  assert.equal(early.children.at(-1).className, "map-tip-counts");

  // Nothing to show: still no card.
  assert.equal(fill(new El("div"), { properties: {} }), false);
});

test("the info card is laid out as the popup: the creator's picture and name, the title, the topic chip, the counts", () => {
  const fill = tipFiller();
  const tip = new El("div");
  fill(tip, { properties: { popupData: () => markerRecord({ profileUrl: "https://example.test/ana.png" }) } });
  const [head, title, topic, counts] = tip.children;
  // The head: the picture, then the By row as it was (label, ID, name).
  assert.equal(head.className, "map-tip-bubble map-tip-head");
  assert.deepEqual(head.children.map((child) => child.className), ["map-tip-pic", "map-tip-row"]);
  const pic = head.children[0];
  assert.equal(pic.tagName, "IMG");
  assert.equal(pic.src, "thumb:https://example.test/ana.png");
  assert.equal(pic.alt, "");
  assert.equal(pic.fallback, DEFAULT_AVATAR);
  assert.equal(pic.getAttribute("aria-hidden"), "true");
  const by = head.children[1];
  assert.deepEqual(by.children.map((child) => child.className), ["map-tip-k", "map-tip-body"]);
  assert.deepEqual(by.children[1].children.map((child) => child.className), ["map-tip-id", "map-tip-name"]);
  assert.equal(find(by, "map-tip-id").style.color, "#ffffff");
  assert.equal(find(by, "map-tip-name").style.color, "#ffffff");
  // The title and the topic in their bubbles, the counts last on their own.
  assert.equal(title.className, "map-tip-bubble");
  assert.equal(find(title, "map-tip-title").style.color, "#ffffff");
  assert.equal(topic.className, "map-tip-bubble map-tip-topic");
  assert.deepEqual(topic.children[0].children.map((child) => child.className), ["map-tip-body"]);
  assert.deepEqual(topic.children[0].children[0].children.map((child) => child.className), ["map-tip-id", "map-tip-name"]);
  assert.equal(counts.className, "map-tip-counts");
  // The frame takes the popup's Border colour (the picker, white without it).
  assert.equal(tip.style.getPropertyValue("--popup-border-color"), "#ffffff");

  // No picture on the record: the person's known one, then the default.
  const known = new El("div");
  tipFiller({ profilePictures: { "0.0.123": { url: "https://example.test/known.png" } } })(known, { properties: { popupData: () => markerRecord({ profileUrl: "" }) } });
  assert.equal(find(known, "map-tip-pic").src, "thumb:https://example.test/known.png");
  const none = new El("div");
  fill(none, { properties: { popupData: () => markerRecord({ profileUrl: "" }) } });
  assert.equal(find(none, "map-tip-pic").src, `thumb:${DEFAULT_AVATAR}`);

  // No payer: no head, the title first.
  const anon = new El("div");
  fill(anon, { properties: { popupData: () => markerRecord({ payer: "", username: "" }) } });
  assert.deepEqual(anon.children.map((child) => child.className), ["map-tip-bubble", "map-tip-bubble map-tip-topic", "map-tip-counts"]);
  assert.equal(find(anon, "map-tip-pic"), null);

  // A looping video picture lets go of its loop when the card is refilled;
  // an img has none.
  const looping = new El("div");
  fill(looping, { properties: { popupData: () => markerRecord({ profileUrl: "https://example.test/loop.mp4" }) } });
  const video = find(looping, "map-tip-pic");
  assert.equal(video.tagName, "VIDEO");
  forgotten.length = 0;
  fill(looping, { properties: { popupData: () => markerRecord() } });
  assert.deepEqual(forgotten, [video]);
  fill(looping, { properties: {} });
  assert.equal(forgotten.length, 1);

  // An early holder: the gold frame and rims, the same order, counts last.
  const early = new El("div");
  tipFiller({ early: true })(early, { properties: { popupData: () => markerRecord() } });
  assert.equal(early.style.getPropertyValue("--popup-border-color"), "#f6e27a");
  assert.deepEqual(early.children.map((child) => child.className), ["map-tip-bubble map-tip-head", "map-tip-bubble", "map-tip-bubble map-tip-topic", "map-tip-counts"]);
  assert.equal(find(early, "map-tip-id").style.color, "#e9d5ff");

  // The picture is an element the browser draws from its cache: nothing
  // is fetched.
  assert.deepEqual(requests, []);
});

test("the info card's own rules use no fixed px (only the cover play button's 44px floor)", () => {
  const css = read("../style.css");
  const start = css.indexOf("/* The hold / right-click info card (maptip.js)");
  const end = css.indexOf("/* Likes and views (postcounts.js)");
  assert.ok(start > 0 && end > start);
  const block = css.slice(start, end);
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/max\(44px,/g, "max(");
  assert.doesNotMatch(rules, /\d(\.\d+)?px/);
  // The card's unit, made on the card from the screen, with no clamp.
  assert.match(block, /\.polygon-title-tip,\n\.marker-title-tip \{\s*--fu: calc\(min\(100dvw, var\(--app-h, 100dvh\)\) \* 0\.024\);\s*--tu: var\(--fu\);/);
  assert.match(block, /border: var\(--tip-bw\) solid var\(--popup-border-color, #ffffff\);/);
  // Its place above the press and its width are --tu too.
  assert.match(block, /transform: translate\(-50%, calc\(-100% - var\(--tu\) \* 1\.5\)\);/);
  assert.match(block, /max-width: min\(calc\(var\(--tu\) \* 30\), 86vw\);/);
  assert.match(block, /pointer-events: none;/);
  // The early card keeps its spin ring, as wide as the border, and its glow.
  assert.match(block, /\.marker-title-tip\.early > \.marker-tip-spin \{\s*position: absolute;\s*inset: calc\(var\(--tip-bw\) \* -1\);\s*border-radius: inherit;\s*padding: var\(--tip-bw\);/);
  assert.match(block, /\.marker-title-tip\.early > :not\(\.marker-tip-spin\) \{\s*position: relative;\s*z-index: 1;/);
  assert.match(block, /\.marker-title-tip\.early \.map-tip-bubble \{\s*--bubble-rim: #f6e27a;/);
  // "By" is hidden from sight only.
  const k = block.slice(block.indexOf("> .map-tip-head .map-tip-k {"));
  assert.match(k.slice(0, k.indexOf("}")), /clip-path: inset\(50%\);/);
  assert.doesNotMatch(k.slice(0, k.indexOf("}")), /display: none/);
  // The counts' popup colours: the heart is the popup's default grey
  // (.heart-like --clr), red only on a tapped one, as the views icon.
  const counts = css.slice(end, css.indexOf("/* Payer CLICK2LINK"));
  assert.match(counts, /> \.post-count-likes > svg \{\s*color: #777;/);
  assert.match(counts, /> \.post-count-views > svg \{\s*color: #777;/);
  assert.match(counts, /> \.post-count > \.post-count-n \{\s*color: rgba\(255, 255, 255, 0\.72\);/);
  assert.doesNotMatch(counts, /#ff3c41/);
  assert.match(css, /\.heart-like \{\s*--h: [^;]+;\s*--clr: #777;/);
});

// Each rule of the card (its selector names the tip or a .map-tip part):
// [selector, body], from the card's comment to the counts' end.
function tipRules(css) {
  const start = css.indexOf("/* The hold / right-click info card (maptip.js)");
  const end = css.indexOf("/* Payer CLICK2LINK");
  const text = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => [m[1].trim(), m[2]])
    .filter(([selector]) => /title-tip|map-tip/.test(selector));
}

test("the info card is sized in --tu only: the listed multiples, no px, rem or em floors", () => {
  const css = read("../style.css");
  const rules = tipRules(css);
  const body = (selector) => {
    const hit = rules.find(([s]) => s === selector);
    assert.ok(hit, selector);
    return hit[1];
  };
  const tip = ":is(.marker-title-tip, .polygon-title-tip)";
  for (const [selector, size] of [
    [".map-tip-title", "calc(var(--tu) * 2)"],
    [".map-tip-name", "calc(var(--tu) * 1.8)"],
    [".map-tip-id", "calc(var(--tu) * 1.4)"],
    [".map-tip-k", "calc(var(--tu) * 0.95)"],
    [`${tip} > .map-tip-topic`, "calc(var(--tu) * 1.15)"],
    [`${tip} > .map-tip-topic :is(.map-tip-name, .map-tip-id)`, "calc(var(--tu) * 1.15)"],
    [`${tip} > .map-tip-counts`, "calc(var(--tu) * 1.15)"],
  ]) {
    assert.ok(body(selector).includes(`font-size: ${size};`), selector);
  }
  const face = body(`${tip} > .map-tip-head > .map-tip-pic`);
  assert.match(face, /width: calc\(var\(--tu\) \* 6\);\s*height: calc\(var\(--tu\) \* 6\);/);
  // Sizes, spacing and icons: no px, rem or em anywhere. The "By" label's
  // visually-hidden clip and the 99em pill radii are the only exceptions.
  const sized = /^\s*(font-size|padding[\w-]*|margin[\w-]*|width|height|max-width|min-width|gap|column-gap|row-gap|border(-width)?|border-radius|transform|inset|top|left)\s*:\s*([^;]+);/gm;
  for (const [selector, text] of rules) {
    if (selector.endsWith("> .map-tip-head .map-tip-k")) continue;
    for (const m of text.matchAll(sized)) {
      if (m[1] === "border-radius" && /^99em$/.test(m[3].trim())) continue;
      assert.doesNotMatch(m[3], /\d(\.\d+)?(px|rem|em)\b/, `${selector} ${m[1]}: ${m[3]}`);
    }
  }
  // The early holder keeps its gold rims and the card stays untappable.
  assert.ok(body(".marker-title-tip.early .map-tip-bubble").includes("--bubble-rim: #f6e27a;"));
  assert.ok(body(".polygon-title-tip,\n.marker-title-tip").includes("pointer-events: none;"));
});

// maptip.js's topic lookup as it is, over a stand-in for the loaded topics
// list (letall.js globalLoadedTopicIdsWithNames).
function topicLookup(list = ["0.0.5 - Street art"]) {
  return new Function("globalLoadedTopicIdsWithNames", `
    ${topLevel(tipSource, "export function topicNameFromList(").replace("export function", "function")}
    return topicNameFromList;
  `)(list);
}

// markerstack.js's row as it is, its imports given here.
const stackSource = read("../markerstack.js");
function rowBuilder(lookup = topicLookup()) {
  const picks = [];
  const build = new Function("avatarSrc", "pictureElement", "countsNode", "topicNameFromList", "pick", "document", `
    const described = new WeakMap();
    ${topLevel(stackSource, "function recordOf(")}
    ${topLevel(stackSource, "function plainText(")}
    ${topLevel(stackSource, "function fold(")}
    ${topLevel(stackSource, "function describe(")}
    ${topLevel(stackSource, "function buildRow(")}
    return { buildRow, describe };
  `)(() => "", () => new El("img"), countsNode, lookup, (feature) => picks.push(feature), globalThis.document);
  return { ...build, picks };
}

test("a cluster list row reads top to bottom: title, likes and views, name and account ID, when, topic", () => {
  const { buildRow, describe, picks } = rowBuilder();
  const feature = {
    payer: "0.0.123",
    properties: { popupData: () => markerRecord({ timestamp: "11/20/2026, 10:00:00", msg: "paint" }) },
  };
  const row = buildRow(feature);
  const body = find(row.el, "marker-stack-body");
  assert.deepEqual(body.children.map((child) => child.className), ["marker-stack-title", "marker-stack-meta marker-stack-stats", "marker-stack-account", "marker-stack-meta", "marker-stack-topic"]);
  const [titleEl, stats, line, when, topic] = body.children;
  assert.equal(titleEl.textContent, "Mural");
  // The counts alone on their line (postcounts.js finds .marker-stack-counts).
  assert.equal(stats.text, "");
  assert.equal(stats.children.length, 1);
  const counts = stats.children[0];
  assert.equal(counts.className, "marker-stack-counts");
  assert.deepEqual(counts.children.map((stat) => find(stat, "post-count-n").textContent), ["1.9k", "1.9k"]);
  // The name, then the account ID; then when, alone.
  assert.equal(line.textContent, "Ana 0.0.123");
  assert.equal(line.children.length, 0);
  assert.equal(when.textContent, "11/20/2026, 10:00:00");
  // The topic's children as before.
  assert.deepEqual(topic.children.map((child) => [child.className, child.textContent]), [["marker-stack-topic-id", "0.0.5"], ["marker-stack-topic-name", "Street art"]]);
  // The search still reads the name, account ID, title, topic and text (no
  // counts in it), and a tap still opens the post.
  const hay = describe(feature).hay;
  for (const word of ["ana", "0.0.123", "mural", "0.0.5", "street art", "paint"]) assert.ok(hay.includes(word), word);
  assert.equal(hay.includes("1.9k"), false);
  row.el.listeners.click[0]();
  assert.deepEqual(picks, [feature]);

  // A share pin with views unknown: the larger like count, likes only.
  const share = buildRow({ properties: { _shareRecord: markerRecord({ topicId: "0.0.808", likeCountMarker: 6, likeCountPolygon: 6 }) } });
  const shareBody = find(share.el, "marker-stack-body");
  assert.deepEqual(shareBody.children.map((child) => child.className), ["marker-stack-title", "marker-stack-meta marker-stack-stats", "marker-stack-account", "marker-stack-topic"]);
  const shareCounts = find(shareBody.children[1], "marker-stack-counts");
  assert.equal(shareCounts.children.length, 1);
  assert.equal(find(shareCounts, "post-count-n").textContent, "6");
  assert.equal(shareBody.children[2].textContent, "Ana 0.0.123");

  // No name, no account ID and no date: the counts keep their line, no other.
  const anon = buildRow({ properties: { popupData: () => ({ title: "x", payerInfo: "", likeCountMarker: 0, viewCount: 1_000_000 }) } });
  const anonBody = find(anon.el, "marker-stack-body");
  assert.deepEqual(anonBody.children.map((child) => child.className), ["marker-stack-title", "marker-stack-meta marker-stack-stats"]);
  assert.deepEqual(find(anonBody.children[1], "marker-stack-counts").children.map((stat) => find(stat, "post-count-n").textContent), ["0", "1M"]);

  // A name alone or an ID alone stands alone on the account line.
  const nameOnly = buildRow({ properties: { popupData: () => ({ title: "x", payerInfo: "", username: "Bo" }) } });
  assert.equal(find(nameOnly.el, "marker-stack-account").textContent, "Bo");
});

test("a cluster list row names its topic as the popup's chip: the ID, then the name, both searchable", () => {
  const { buildRow, describe } = rowBuilder();
  // The record's topic ID, its name from the loaded topics list.
  const feature = { properties: { popupData: () => markerRecord() } };
  const topic = find(buildRow(feature).el, "marker-stack-topic");
  assert.deepEqual(topic.children.map((child) => child.className), ["marker-stack-topic-id", "marker-stack-topic-name"]);
  assert.deepEqual(topic.children.map((child) => child.textContent), ["0.0.5", "Street art"]);
  const hay = describe(feature).hay;
  assert.ok(hay.includes("0.0.5"));
  assert.ok(hay.includes("street art"));

  // The record's own loadedTopicName comes first.
  const named = buildRow({ properties: { popupData: () => markerRecord({ loadedTopicName: "Murals" }) } });
  assert.deepEqual(find(named.el, "marker-stack-topic").children.map((child) => child.textContent), ["0.0.5", "Murals"]);

  // No ID on the record: the feature's. A topic missing from the list: the ID alone.
  const fromFeature = buildRow({ topicId: "0.0.808", properties: { popupData: () => markerRecord({ topicId: "" }) } });
  const idOnly = find(fromFeature.el, "marker-stack-topic");
  assert.deepEqual(idOnly.children.map((child) => [child.className, child.textContent]), [["marker-stack-topic-id", "0.0.808"]]);

  // A name that is only the ID again is not repeated.
  const echo = buildRow({ properties: { popupData: () => markerRecord({ loadedTopicName: "0.0.5" }) } });
  assert.deepEqual(find(echo.el, "marker-stack-topic").children.map((child) => child.textContent), ["0.0.5"]);

  // No ID and no name: no line.
  const none = buildRow({ properties: { popupData: () => ({ title: "x", payer: "0.0.1" }) } });
  assert.equal(find(none.el, "marker-stack-topic"), null);
  assert.deepEqual(find(none.el, "marker-stack-body").children.map((child) => child.className), ["marker-stack-title", "marker-stack-meta marker-stack-stats", "marker-stack-account"]);
  assert.equal(find(none.el, "marker-stack-account").textContent, "0.0.1");

  // The lookup is the info card's own (maptip.js), imported, nothing fetched.
  assert.match(stackSource, /import \{ topicNameFromList \} from '\.\/maptip\.js';/);
  assert.match(tipSource, /export function topicNameFromList\(topicId\) \{/);
  assert.equal(topicLookup(["0.0.9 - Nine", "0.0.5 - Five"])("0.0.5"), "Five");
});

test("the cluster list row keeps its own sizes; the topic line takes the account line's size by sharing its rule", () => {
  const css = read("../style.css");
  const block = css.slice(css.indexOf("/* The post's topic (markerstack.js)"), css.indexOf("/* The post's likes and views after the account ID"));
  assert.ok(block.length > 100);
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...rules.matchAll(/^([^\s{}][^{}]*?)\s*\{/gm)].map((m) => m[1]);
  assert.deepEqual(selectors, [".marker-stack-topic", ".marker-stack-topic-id", ".marker-stack-topic-name"]);
  // No size or unit of its own: no --fu, no font-size, no px or rem.
  assert.doesNotMatch(rules, /--fu|font-size/);
  assert.doesNotMatch(rules, /\d(\.\d+)?(px|rem)\b/);
  // The account line's gap between its ID and counts.
  assert.match(css, /\.marker-stack-account:has\(> \.marker-stack-counts\) \{[^}]*column-gap: 0\.7em;/);
  assert.match(rules, /\.marker-stack-topic \{[^}]*gap: 0\.7em;[^}]*white-space: nowrap;/);
  // The ID in the meta's muted colour and never cut, the name in the
  // account's and cut with an ellipsis, both normal weight.
  assert.match(rules, /\.marker-stack-topic-id \{\s*flex: none;\s*font-weight: 400;\s*color: rgba\(255, 255, 255, 0\.55\);/);
  assert.match(rules, /\.marker-stack-topic-name \{[^}]*text-overflow: ellipsis;\s*font-weight: 400;\s*color: rgba\(255, 255, 255, 0\.72\);/);
  // Its size is the account rule's, shared by grouping.
  assert.match(css, /\n\.marker-stack-account,\n\.marker-stack-topic,\n\.marker-stack-topic-id,\n\.marker-stack-topic-name \{\s*font-size: 12px;\s*color: rgba\(255, 255, 255, 0\.72\);/);
  // The row as before eb7907d: its own px sizes, no --fu. A row with the
  // topic line is taller than its 52px minimum: in the scrolling list it
  // keeps that height instead of shrinking to it.
  const at = css.indexOf("\n.marker-stack-row {");
  const row = css.slice(at, css.indexOf("}", at));
  assert.doesNotMatch(row, /--fu/);
  assert.match(row, /display: flex;\s*flex-shrink: 0;\s*align-items: center;\s*gap: 10px;\s*width: 100%;\s*min-height: 52px;\s*margin: 0;\s*padding: 7px 8px;/);
  assert.match(row, /border: 1px solid transparent;\s*border-radius: 12px;/);
  assert.match(css, /\.marker-stack-pic \{[^}]*width: 40px;\s*height: 40px;[^}]*border: 1px solid rgba\(255, 255, 255, 0\.2\);/);
  assert.match(css, /\.marker-stack-body \{[^}]*gap: 2px;/);
  assert.match(css, /\.marker-stack-title \{\s*font-size: 14px;/);
  assert.match(css, /\.marker-stack-meta \{\s*font-size: 12px;/);
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

test("the counts' rules: in the tips and the list only, the tip's in --tu, the list's in em, no fixed px", () => {
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
  assert.match(tip, /> \.map-tip-counts \{[^}]*font-size: calc\(var\(--tu\) \* 1\.15\);[^}]*color: rgba\(255, 255, 255, 0\.62\);/);
  assert.match(tip, /> svg \{[^}]*width: calc\(var\(--tu\) \* 1\.3\);\s*height: calc\(var\(--tu\) \* 1\.3\);/);
  assert.doesNotMatch(tip.replace(/\/\*[\s\S]*?\*\//g, ""), /\d(\.\d+)?(rem|em)\b/);
  // The ID keeps its place: the line wraps the counts under it.
  assert.match(list, /\.marker-stack-account:has\(> \.marker-stack-counts\) \{\s*display: flex;\s*flex-wrap: wrap;/);
  assert.match(list, /\.marker-stack-counts \{[^}]*min-width: 0;/);
});
