// Map popups (style.css "Map popup: one scroll body"): the header and the
// hearts stay put and everything between them is one scrolling body, in
// the feed's order (text, picture, X post). The text keeps its own capped
// box; at its top or end the scroll goes on in the body (no
// overscroll-behavior: contain inside the body, no script on the wheel or
// a touch); the X post never scrolls on its own.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One top-level function's source: from its line to the next one.
function topLevel(source, start) {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, start);
  const next = source.slice(at + start.length).search(/\n(export )?(async )?function /);
  return source.slice(at, next < 0 ? undefined : at + start.length + next);
}
// One rule's declarations, from its selector to its closing brace.
function rule(css, selector) {
  const at = css.indexOf(selector + " {");
  assert.notEqual(at, -1, selector);
  return css.slice(at, css.indexOf("}", at));
}

test("a popup builds its text, then its picture, then places the X post once the picture is there", () => {
  const popups = read("../processallmessages.js");
  for (const start of ["export function createMarkerPopupHTML(", "function createPolygonPopupHTML("]) {
    const fn = topLevel(popups, start);
    const text = fn.indexOf("contentSection.appendChild(msgDiv);");
    const picture = fn.indexOf("contentSection.appendChild(imageDiv);");
    assert.ok(text > 0 && picture > text, `${start} text first`);
    assert.ok(fn.indexOf("paintPopupXEmbeds(msgP, msgDiv);") > picture, start);
  }
});

// A few nodes, enough for xembed.js placing a list: children in order,
// siblings, matches() on one class, and a log of how each was put.
class Node {
  constructor(cls = "", log = null) {
    this.cls = cls;
    this.children = [];
    this.parentNode = null;
    this.root = false;
    this.log = log;
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node.root;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.children;
    return list[list.indexOf(this) + 1] || null;
  }
  get nextElementSibling() { return this.nextSibling; }
  get parentElement() { return this.parentNode; }
  matches(selectors) { return selectors.split(",").some((s) => s.trim() === `.${this.cls}`); }
  querySelector(selector) {
    const cls = selector.replace(":scope > .", "");
    return this.children.find((child) => child.cls === cls) || null;
  }
  put(node, before) {
    if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
    node.parentNode = this;
    const at = before ? this.children.indexOf(before) : -1;
    if (at < 0) this.children.push(node);
    else this.children.splice(at, 0, node);
    return node;
  }
  insertBefore(node, before) {
    if (this.log) this.log.push(node.isConnected ? "insert (moved)" : "insert");
    return this.put(node, before);
  }
  appendChild(node) { return this.insertBefore(node, null); }
}
const xembed = read("../xembed.js");
const place = new Function(`
  const MORE_BUTTONS = '.feed-more, .chat-msg-more, .swap-bio-more';
  ${topLevel(xembed, "function listSpot(")}
  ${topLevel(xembed, "function placeList(")}
  ${topLevel(xembed, "function moveList(")}
  return { placeList, moveList };
`)();
const names = (node) => node.children.map((child) => child.cls);

// A popup's body: the message box (text, Show more), then the picture.
function popupBody({ picture = true, moveBefore = true } = {}) {
  const log = [];
  const sheet = new Node("popup-sheet", log);
  sheet.root = true;
  const body = new Node("popup-body", log);
  const msg = new Node("popup-msg", log);
  const text = new Node("popup-text-bubble", log);
  sheet.put(body);
  body.put(msg);
  msg.put(text);
  msg.put(new Node("popup-more", log));
  if (picture) body.put(new Node("popup-media-card", log));
  if (moveBefore) {
    for (const node of [body, msg]) {
      node.moveBefore = function (moved, before) {
        log.push("moveBefore");
        return this.put(moved, before);
      };
    }
  }
  return { body, msg, text, log, list: new Node("x-embed-list", log) };
}

test("the X post is placed after the picture in portrait and last in the message box in landscape", () => {
  let landscape = false;
  const portrait = popupBody();
  const state = { host: portrait.msg, after: () => (landscape ? null : portrait.body.querySelector(":scope > .popup-media-card")) };
  assert.equal(place.placeList(portrait.list, state, portrait.text), true);
  assert.deepEqual(names(portrait.body), ["popup-msg", "popup-media-card", "x-embed-list"]);
  assert.deepEqual(names(portrait.msg), ["popup-text-bubble", "popup-more"]);

  landscape = true;
  const wide = popupBody();
  const wideState = { host: wide.msg, after: () => (landscape ? null : wide.body.querySelector(":scope > .popup-media-card")) };
  place.placeList(wide.list, wideState, wide.text);
  assert.deepEqual(names(wide.msg), ["popup-text-bubble", "popup-more", "x-embed-list"]);
  assert.deepEqual(names(wide.body), ["popup-msg", "popup-media-card"]);

  // No picture: last in the message box, in either orientation.
  landscape = false;
  const plain = popupBody({ picture: false });
  place.placeList(plain.list, { host: plain.msg, after: () => plain.body.querySelector(":scope > .popup-media-card") }, plain.text);
  assert.deepEqual(names(plain.msg), ["popup-text-bubble", "popup-more", "x-embed-list"]);
});

test("turning the phone moves the shown X post, keeping X's iframe where the browser can", () => {
  let landscape = false;
  const popup = popupBody();
  const state = { host: popup.msg, after: () => (landscape ? null : popup.body.querySelector(":scope > .popup-media-card")) };
  place.placeList(popup.list, state, popup.text);
  popup.log.length = 0;
  // Already where it belongs: nothing moves.
  place.moveList(popup.list, state, popup.text);
  assert.deepEqual(popup.log, []);
  landscape = true;
  place.moveList(popup.list, state, popup.text);
  assert.deepEqual(names(popup.msg), ["popup-text-bubble", "popup-more", "x-embed-list"]);
  landscape = false;
  place.moveList(popup.list, state, popup.text);
  assert.deepEqual(names(popup.body), ["popup-msg", "popup-media-card", "x-embed-list"]);
  assert.deepEqual(popup.log, ["moveBefore", "moveBefore"]);
  place.moveList(popup.list, state, popup.text);
  assert.deepEqual(popup.log, ["moveBefore", "moveBefore"]);

  // A browser with no moveBefore inserts it (X's iframe loads again).
  const old = popupBody({ moveBefore: false });
  const oldState = { host: old.msg, after: () => (landscape ? null : old.body.querySelector(":scope > .popup-media-card")) };
  place.placeList(old.list, oldState, old.text);
  landscape = true;
  place.moveList(old.list, oldState, old.text);
  assert.deepEqual(names(old.msg), ["popup-text-bubble", "popup-more", "x-embed-list"]);
  assert.deepEqual(old.log, ["insert", "insert (moved)"]);
});

test("a plain after node still puts the list after it and any Show more under it", () => {
  const log = [];
  const card = new Node("feed-card", log);
  card.root = true;
  const text = card.put(new Node("feed-text", log));
  const media = card.put(new Node("popup-media-card", log));
  card.put(new Node("feed-more", log));
  card.put(new Node("feed-dock", log));
  const list = new Node("x-embed-list", log);
  place.placeList(list, { host: null, after: media }, text);
  assert.deepEqual(names(card), ["feed-text", "popup-media-card", "feed-more", "x-embed-list", "feed-dock"]);
});

test("popuptext.js asks for the picture in portrait only, and moves the posts when the phone turns", () => {
  const source = read("../popuptext.js");
  const seen = [];
  const build = new Function("landscape", "paintXEmbeds", `
    ${topLevel(source, "export function paintPopupXEmbeds(").replace("export function", "function")}
    return paintPopupXEmbeds;
  `);
  const media = { matches: false };
  const paint = build(media, (bubble, opts) => seen.push(opts));
  const popup = popupBody();
  paint(popup.text, popup.msg);
  assert.equal(seen[0].host, popup.msg);
  assert.equal(seen[0].after(), popup.body.children[1]);
  media.matches = true;
  assert.equal(seen[0].after(), null);
  media.matches = false;
  const plain = popupBody({ picture: false });
  paint(plain.text, plain.msg);
  assert.equal(seen[1].after(), null);
  // One listener for the whole page: a turn places every shown post again.
  assert.match(source, /window\.matchMedia\('\(orientation: landscape\)'\)/);
  assert.match(source, /if \(landscape\) landscape\.addEventListener\('change', \(\) => placeXEmbeds\(\)\);/);
  const x = read("../xembed.js");
  const again = x.slice(x.indexOf("export function placeXEmbeds()"));
  assert.match(again, /if \(state && state\.list && typeof state\.after === 'function'\) moveList\(state\.list, state, textEl\);/);
  // An edit with the same posts keeps the list, at the place it answers now.
  assert.match(topLevel(x, "function mountList("), /if \(typeof state\.after === 'function'\) moveList\(state\.list, state, textEl\);/);
});

test("portrait: the body is the one scroller, text, Show more, picture, X post in the code's order", () => {
  const css = read("../style.css");
  const block = css.slice(css.indexOf("/* ── Map popup: one scroll body"), css.indexOf("/* ── Popup settings: header"));
  assert.ok(block.length > 100);
  const body = ":is(.maplibregl-map, :where(#popup-settings-preview)) .maplibregl-popup-content > .popup-sheet > .popup-body";
  // It scrolls and ends the chain, so the page and the map never move. A
  // size container: cqi is the picture frame's width, cqb its visible height.
  assert.match(rule(block, body), /container-type: size;\s*overflow-x: hidden;\s*overflow-y: auto;\s*overscroll-behavior: contain;/);
  assert.match(rule(block, `${body} > .popup-msg`), /display: contents;/);
  // Nothing reorders the rows: a screen reader and Tab follow the code,
  // and the code is in the order on screen (popuptext.js places the post).
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /(^|[\s;{])order:/);
  // The text's cap: the body, less the picture's compact frame (the body's
  // full width at 16:9) when there is one, and less its Show more row once
  // it is capped.
  assert.match(rule(block, body), /--popup-msg-room: 100%;/);
  assert.match(rule(block, `${body}:has(> .popup-media-card:not(.draw-popup-media))`), /--popup-msg-room: calc\(100% - 100cqi \* 9 \/ 16 - var\(--popup-gap\)\);/);
  assert.match(rule(block, `${body} > .popup-msg > .popup-text-bubble`), /flex: 0 0 auto;\s*max-height: var\(--popup-msg-room\);/);
  assert.match(rule(block, `${body} > .popup-msg.is-more > .popup-text-bubble`), /max-height: calc\(var\(--popup-msg-room\) - var\(--popup-more-h\)\);/);
  // With an X post the text box is capped at the size it had next to the
  // post's own box (before the one scroll body): the room less that box's
  // share, min(26u, 66%), and its 0.5u margin, less Show more once capped.
  // A cap, not a height: a short text is as tall as its lines.
  // The post is after the picture, or in the message box with none.
  const withPost = `${body}:has(> .x-embed-list, > .popup-msg > .x-embed-list)`;
  const withX = rule(block, `${withPost} > .popup-msg > .popup-text-bubble`);
  assert.match(withX, /--popup-msg-x: calc\(var\(--popup-msg-room\) - min\(calc\(var\(--u\) \* 26\), calc\(var\(--popup-msg-room\) \* 0\.66\)\) - var\(--u\) \* 0\.5\);\s*height: auto;\s*max-height: var\(--popup-msg-x\);/);
  const withXMore = rule(block, `${withPost} > .popup-msg.is-more > .popup-text-bubble`);
  assert.match(withXMore, /max-height: calc\(var\(--popup-msg-x\) - var\(--popup-more-h\)\);/);
  assert.doesNotMatch(withXMore, /(^|[\s;{])height:/);
  // popuptext.js measures the overflow against that cap: the bubble's own
  // scroll box before .is-more, the flow box inside it after.
  const text = read("../popuptext.js");
  assert.match(text.slice(text.indexOf("function syncMore"), text.indexOf("function paintEdges")),
    /const over = clipped\s*\? state\.flow\.scrollHeight > state\.flow\.clientHeight \+ 1\s*: bubble\.scrollHeight > bubble\.clientHeight \+ 1;/);
  assert.match(rule(css, ".popup-msg.is-more > .popup-text-bubble > .popup-text-flow"), /flex: 1 1 auto;\s*min-height: 0;\s*overflow-x: hidden;\s*overflow-y: auto;/);
  // The share is the one the X post's box had then, now only for the text.
  assert.match(rule(css, ".maplibregl-popup .x-embed-list"), /flex: 0 0 auto;\s*align-self: stretch;\s*margin: calc\(var\(--u\) \* 0\.5\) calc\(var\(--u\) \* 0\.5\) 0;/);
  // The picture's compact frame is what the cap leaves room for: the
  // feed's, the body's full width at 16:9.
  const frame = rule(css, ":is(.maplibregl-map, :where(#popup-settings-preview)) .popup-body > .popup-media-card:not(.draw-popup-media)");
  assert.match(frame, /width: 100%;/);
  assert.match(frame, /aspect-ratio: 16 \/ 9;/);
  // Sizes in the popup's own units, no fixed pixels.
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /\d(px)\b/);
});

test("portrait full size (the ···) is the feed's: the media's own shape, the whole of it in view, no blur", () => {
  const css = read("../style.css");
  const block = css.slice(css.indexOf("/* ── Map popup: one scroll body"), css.indexOf("/* ── Popup settings: header"));
  const portrait = block.slice(block.indexOf("@media (orientation: portrait)"), block.indexOf("@media (orientation: landscape)"));
  const wide = ":is(.maplibregl-map, :where(#popup-settings-preview)) .maplibregl-popup-content > .popup-sheet > .popup-body > .popup-media-card.is-wide:not(.draw-popup-media)";
  const face = "> :is(img:not(.feed-media-backdrop), video, canvas.media-still)";
  assert.match(rule(portrait, wide), /flex: 0 0 auto;\s*width: 100%;\s*height: auto;\s*max-height: none;\s*aspect-ratio: auto;/);
  // At most the body's visible height (the body is a size container).
  assert.match(rule(portrait, `${wide} ${face}`), /width: 100%;\s*height: auto;\s*max-height: 100cqb;\s*object-fit: contain;/);
  // No shape of its own yet: 16:9, filled.
  const shapeless = `${wide}:is(.is-media-pending, :has(> video:not(.has-poster)))`;
  assert.match(rule(portrait, shapeless), /aspect-ratio: 16 \/ 9;/);
  assert.match(rule(portrait, `${shapeless} ${face}`), /height: 100%;/);
  // No blur, as in the feed's wide view.
  assert.match(rule(portrait, `${wide} > .feed-media-backdrop`), /display: none;/);
  // The feed's own wide view, the reference.
  const feedWide = rule(css, ":is(#feed-column, .feed-comments-stage) .feed-card .popup-media-card.is-wide,\n:is(#feed-column, .feed-comments-stage) .feed-card .popup-media-card.is-wide:has(video:not(.loop-face):not(.has-poster))");
  assert.match(feedWide, /width: 100%;\s*aspect-ratio: auto;/);
  // Landscape keeps its two cards and has no size button.
  const landscape = css.slice(css.indexOf("/* Wide screens keep their two cards"));
  assert.match(landscape.slice(0, 2000), /\.maplibregl-map \.popup-media-card \.feed-media-tools > \.feed-media-size \{\s*display: none !important;/);
});

test("landscape: the two cards stay; the message box is the one scroller", () => {
  const css = read("../style.css");
  const block = css.slice(css.indexOf("/* ── Map popup: one scroll body"), css.indexOf("/* ── Popup settings: header"));
  const msg = ".maplibregl-map .maplibregl-popup-content > .popup-sheet > .popup-body > div.popup-msg";
  assert.match(rule(block, msg), /overflow-x: hidden;\s*overflow-y: auto;\s*overscroll-behavior: contain;/);
  // A text that fits fills its card as before; a capped one leaves its Show more row.
  assert.match(rule(block, `${msg} > .popup-text-bubble`), /flex: 1 0 auto;\s*max-height: 100%;/);
  assert.match(rule(block, `${msg}.is-more > .popup-text-bubble`), /max-height: calc\(100% - var\(--popup-more-h\)\);/);
});

test("nothing inside the body holds a scroll back, and the X post never scrolls on its own", () => {
  const css = read("../style.css");
  assert.match(rule(css, ".popup-msg.is-more > .popup-text-bubble > .popup-text-flow"), /overscroll-behavior: auto;/);
  assert.match(rule(css, "  :is(.maplibregl-map, :where(#popup-settings-preview)) .popup-text-bubble"), /overscroll-behavior: auto;/);
  assert.doesNotMatch(rule(css, ".maplibregl-map .popup-sheet:not(:has(.popup-media-card)) .popup-text-bubble"), /overscroll-behavior/);
  const x = rule(css, ".maplibregl-popup .x-embed-list");
  assert.doesNotMatch(x, /max-height|overflow|overscroll/);
  assert.match(x, /flex: 0 0 auto;/);
  // Only the link: centred in the room while it fits, never shrunk below its post.
  // In the message box, or after the picture in portrait.
  assert.match(rule(css, ".maplibregl-popup .popup-msg.has-x-only > .x-embed-list,\n.maplibregl-popup .popup-body:has(> .popup-msg.has-x-only) > .x-embed-list"), /flex: 1 0 auto;/);
  assert.match(rule(css, ".maplibregl-popup .popup-msg.has-x-only > .x-embed-list > .x-embed,\n.maplibregl-popup .popup-body:has(> .popup-msg.has-x-only) > .x-embed-list > .x-embed"), /margin-block: auto;/);
  // No script stops a wheel or a touch at the text's edges.
  for (const file of ["../popuptext.js", "../xembed.js", "../readingring.js"]) {
    assert.doesNotMatch(read(file), /addEventListener\(\s*['"](wheel|touchstart|touchmove)['"]/, file);
  }
});

test("the feed card has the same order: text, picture, X post", () => {
  const feed = read("../feedlayout.js");
  const build = feed.slice(feed.indexOf("function buildCard(post)"), feed.indexOf("function clampPending"));
  assert.match(build, /section\.append\(msgDiv, media\);/);
  assert.match(build, new RegExp(esc("if (text) paintXEmbeds(text, media ? { after: media } : {});")));
  assert.match(rule(read("../style.css"), ":is(#feed-column, .feed-comments-stage) :is(.feed-card, .popup-body) > .x-embed-list"), /margin-top: 0;/);
});
