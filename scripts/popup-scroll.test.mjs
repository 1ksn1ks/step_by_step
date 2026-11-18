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

test("a popup builds its text before its picture; the X post goes last in the message box", () => {
  const popups = read("../processallmessages.js");
  for (const start of ["export function createMarkerPopupHTML(", "function createPolygonPopupHTML("]) {
    const fn = topLevel(popups, start);
    const text = fn.indexOf("contentSection.appendChild(msgDiv);");
    const picture = fn.indexOf("contentSection.appendChild(imageDiv);");
    assert.ok(text > 0 && picture > text, `${start} text first`);
    assert.ok(fn.indexOf("paintXEmbeds(msgP, { host: msgDiv });") > text, start);
  }
});

test("portrait: the body is the one scroller, ordered text, Show more, picture, X post", () => {
  const css = read("../style.css");
  const block = css.slice(css.indexOf("/* ── Map popup: one scroll body"), css.indexOf("/* ── Popup settings: header"));
  assert.ok(block.length > 100);
  const body = ":is(.maplibregl-map, :where(#popup-settings-preview)) .maplibregl-popup-content > .popup-sheet > .popup-body";
  // It scrolls and ends the chain, so the page and the map never move.
  assert.match(rule(block, body), /container-type: inline-size;\s*overflow-x: hidden;\s*overflow-y: auto;\s*overscroll-behavior: contain;/);
  assert.match(rule(block, `${body} > .popup-msg`), /display: contents;/);
  for (const [part, order] of [["> .popup-msg > .popup-text-bubble", 1], ["> .popup-msg > .popup-more", 2], ["> .popup-media-card", 3], ["> .popup-msg > .x-embed-list", 4]]) {
    assert.match(rule(block, `${body} ${part}`), new RegExp(`order: ${order};`), part);
  }
  // The text's cap: the body, less the picture's compact frame (62.5% wide,
  // 16:9) when there is one, and less its Show more row once it is capped.
  assert.match(rule(block, body), /--popup-msg-room: 100%;/);
  assert.match(rule(block, `${body}:has(> .popup-media-card:not(.draw-popup-media))`), /--popup-msg-room: calc\(100% - 62\.5cqi \* 9 \/ 16 - var\(--popup-gap\)\);/);
  assert.match(rule(block, `${body} > .popup-msg > .popup-text-bubble`), /flex: 0 0 auto;\s*max-height: var\(--popup-msg-room\);/);
  assert.match(rule(block, `${body} > .popup-msg.is-more > .popup-text-bubble`), /max-height: calc\(var\(--popup-msg-room\) - var\(--popup-more-h\)\);/);
  // The picture's compact frame is what the cap leaves room for.
  const frame = rule(css, ":is(.maplibregl-map, :where(#popup-settings-preview)) .popup-body > .popup-media-card:not(.draw-popup-media)");
  assert.match(frame, /width: 62\.5%;/);
  assert.match(frame, /aspect-ratio: 16 \/ 9;/);
  // Sizes in the popup's own units, no fixed pixels.
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /\d(px)\b/);
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
  assert.match(rule(css, ".maplibregl-popup .popup-msg.has-x-only > .x-embed-list"), /flex: 1 0 auto;/);
  assert.match(rule(css, ".maplibregl-popup .popup-msg.has-x-only > .x-embed-list > .x-embed"), /margin-block: auto;/);
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
