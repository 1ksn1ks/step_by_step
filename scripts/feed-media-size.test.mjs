// Feed media (style.css "Feed pictures and videos", feedlayout.js buildCard):
// every kind (a picture, a GIF, an uploaded video, a GIF turned into a loop,
// a video still waiting for its poster, an embedded player) shows in the
// same frame as a picture: the card's width at 16:9, the same blurred fill,
// the same ··· and the same Show media full size. A video once kept a
// narrower frame than a picture (a picture-only width rule).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const FEED = ":is(#feed-column, .feed-comments-stage)";

// A selector list split on its top-level commas (not those inside :is()).
function splitSelectors(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

// Every plain rule (selector list and declarations) in the file, nested
// ones inside @media included.
function rules(css) {
  const out = [];
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selectors: splitSelectors(m[1].trim()), body: m[2] });
  }
  return out;
}

test("one frame for every feed media kind: the card's width at 16:9", () => {
  const css = read("../style.css");
  const all = rules(css);
  const frame = all.find((rule) => rule.selectors.includes(`${FEED} .feed-card .popup-media-card`));
  assert.ok(frame, "the compact frame rule");
  assert.deepEqual(frame.selectors, [
    `${FEED} .feed-card .popup-media-card`,
    `${FEED} .feed-card .popup-media-card:has(video:not(.loop-face):not(.has-poster))`,
  ]);
  assert.match(frame.body, /width: 100%;/);
  assert.match(frame.body, /aspect-ratio: 16 \/ 9;/);
  assert.doesNotMatch(frame.body, /\d+px/, "no fixed width");

  // No later rule sizes a picture's card or a video's card on its own.
  for (const rule of all) {
    for (const selector of rule.selectors) {
      if (!selector.startsWith(`${FEED} .feed-card .popup-media-card`) || selector.includes(".is-wide") || selector.includes(">")) continue;
      if (/:not\(:has\(video|:has\(video\)/.test(selector)) assert.doesNotMatch(rule.body, /(^|[\s;])width:/, selector);
    }
  }

  // Each kind fills the frame, fitted whole.
  const face = all.find((rule) => rule.selectors.includes(`${FEED} .feed-card .popup-media-card > :is(img:not(.feed-media-backdrop), video:not(.loop-face), canvas.media-still, iframe, embed, object)`));
  assert.ok(face, "the media rule names every kind");
  assert.match(face.body, /width: 100%;\s*height: 100%;/);
  assert.match(face.body, /object-fit: contain;/);
});

test("the same blur, the same full size, and a tap layer that leaves a video's controls", () => {
  const css = read("../style.css");
  const all = rules(css);
  const blur = all.find((rule) => rule.selectors.includes(`${FEED} .feed-card .popup-media-card > .feed-media-backdrop`));
  assert.match(blur.body, /object-fit: cover;/);
  assert.match(blur.body, /filter: blur\(/);
  // Full size: the card's width at the media's own shape; what has no shape
  // of its own (a posterless video, a picture loading, an embedded player)
  // keeps 16:9.
  const wide = all.find((rule) => rule.selectors.includes(`${FEED} .feed-card .popup-media-card.is-wide`));
  assert.match(wide.body, /width: 100%;\s*aspect-ratio: auto;/);
  const shapeless = all.find((rule) => rule.selectors.some((s) => s.startsWith(`${FEED} .feed-card .popup-media-card.is-wide:is(.is-media-pending`)));
  assert.ok(shapeless.selectors[0].includes(":has(video:not(.loop-face):not(.has-poster))"));
  assert.ok(shapeless.selectors[0].includes(":has(> :is(iframe, embed, object))"));
  assert.match(shapeless.body, /aspect-ratio: 16 \/ 9;/);
  // The tap layer stops short of the native control strip.
  const tap = all.find((rule) => rule.selectors.includes(`${FEED} .feed-media-hit.is-video`));
  assert.match(tap.body, /bottom: calc\(var\(--fu\) \* 6\);/);
});

test("a video card is built like a picture card: blur from its poster, the ···, the feed's size memory", () => {
  const feed = read("../feedlayout.js");
  const build = feed.slice(feed.indexOf("function buildCard(post)"), feed.indexOf("function clampPending"));
  const video = build.slice(build.indexOf("if (video) {"), build.indexOf("} else {\n      node.alt = '';"));
  const picture = build.slice(build.indexOf("} else {\n      node.alt = '';"));
  for (const [name, part] of [["video", video], ["picture", picture]]) {
    assert.match(part, /mountMediaBackdrop\(media, node\);/, name);
    assert.match(part, /mountMediaTools\(media, feedMediaFrame\(post\.key, /, name);
    assert.match(part, /coverFeedPlayer\(media, /, name);
  }
  // A video's blur follows its poster (mediaframe.js).
  const frame = read("../mediaframe.js");
  assert.match(frame.slice(frame.indexOf("export function mountMediaBackdrop")), /source\.getAttribute\('poster'\)/);
  // Show media full size resizes every framed card, videos included.
  assert.match(feed.slice(feed.indexOf("function resizeFeedMedia")), /root\.querySelectorAll\('\.popup-media-card\[data-picture\]'\)/);
  assert.match(frame, /media\.dataset\.picture = '1';/);
});
