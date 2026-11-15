import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("feed cards and map popups share one media frame module", () => {
  const frame = read("../mediaframe.js");
  assert.match(frame, /export function mountMediaBackdrop\(media, source\)/);
  assert.match(frame, /export function mountMediaTools\(media, \{/);
  assert.match(frame, /export function setMediaWideDefault\(on\)/);
  assert.match(frame, /export function mediaWideDefault\(\)/);
  // No feed-only names leak into the shared module.
  for (const name of ["feedActIdle", "wideMedia", "narrowMedia", "holdScroll", "mediaStartsWide("]) {
    assert.equal(frame.includes(name), false, name);
  }
  const feed = read("../feedlayout.js");
  assert.equal(feed.includes("function mountMediaTools"), false);
  assert.equal(feed.includes("function mountPictureBackdrop"), false);
});

test("every popup media kind gets the frame, the blur fill and the ···", () => {
  const src = read("../processallmessages.js");
  assert.match(src, /import \{ mediaWideDefault, mountMediaBackdrop, mountMediaTools \} from '\.\/mediaframe\.js'/);
  const fillAt = src.indexOf("function fillPopupMedia(imageDiv, url, hint, key)");
  assert.ok(fillAt > 0);
  const fill = src.slice(fillAt, src.indexOf("export function createMarkerPopupHTML", fillAt));
  // Video, GIF clip and picture: each mounts the blur fill and the tools.
  assert.equal(fill.split("mountMediaBackdrop(imageDiv, media)").length - 1, 2);
  assert.match(fill, /mountMediaTools\(imageDiv, frame\(openFull, media\)\)/);
  assert.match(fill, /if \(clip\) \{[\s\S]*mountMediaTools\(imageDiv, frame\(openFull, null\)\)/);
  assert.match(fill, /startsWide: popupMediaStartsWide/);
  assert.match(fill, /remember: rememberPopupMediaSize/);
  // A tap on a picture or GIF shows the ··· (its Fullscreen opens the viewer).
  assert.equal(fill.split('imageDiv.addEventListener("click", (event) => tools.tap(event))').length - 1, 2);
  assert.equal(fill.includes("zoom-in"), false);
  assert.equal(fill.includes("popup-media-expand"), false);
  // Fullscreen pauses the popup copy and carries on from its time.
  assert.match(fill, /if \(!media\.paused\) media\.pause\(\)/);
  assert.match(fill, /openPreview\(raw, Object\.assign\(\{ video: true, time \}, hint \|\| \{\}\)\)/);

  const starts = src.slice(src.indexOf("function popupMediaStartsWide"), src.indexOf("function rememberPopupMediaSize"));
  assert.match(starts, /if \(key && popupWideMedia\.has\(key\)\) return true/);
  assert.match(starts, /if \(key && popupNarrowMedia\.has\(key\)\) return false/);
  assert.match(starts, /return mediaWideDefault\(\)/);
  // Each post keeps its own size choice across the popup's rebuilds.
  assert.match(src, /fillPopupMedia\(imageDiv, popupImageUrl, posterHintFor\(data\.payer, data\.created, data\.timestamp\), \['m', topicId, data\.payer, data\.created, markernumber\]\.join\(':'\)\)/);
  assert.match(src, /fillPopupMedia\(imageDiv, popupImageUrl, posterHintFor\(data\.payer, data\.created, data\.timestamp\), \['p', topicId, data\.payer, data\.created, polygonnumber\]\.join\(':'\)\)/);
});

test("popup media starts in the feed's compact 16:9 frame and the text gets the room", () => {
  const css = read("../style.css");
  const at = css.indexOf("/* ── Map popup media: the feed's frame");
  assert.ok(at > 0);
  const block = css.slice(at, css.indexOf("/* Text longer than the bubble", at));
  const card = block.slice(block.indexOf(".popup-body > .popup-media-card:not(.draw-popup-media) {"));
  // Same size as a feed card's frame.
  assert.match(card, /width: max\(min\(100%, 240px\), calc\(var\(--fu\) \* 16\)\)/);
  assert.match(css, /\.feed-card \.popup-media-card:has\(video:not\(\.loop-face\):not\(\.has-poster\)\) \{\s*width: max\(min\(100%, 240px\), calc\(var\(--fu\) \* 16\)\)/);
  assert.match(card, /aspect-ratio: 16 \/ 9/);
  assert.match(card, /flex: 0 0 auto/);
  assert.match(block, /object-fit: contain/);
  assert.match(block, /background-color: transparent/);
  assert.match(block, /filter: blur\(max\(12px, calc\(var\(--fu\) \* 0\.7\)\)\) brightness\(0\.55\) saturate\(1\.2\)/);
  // Make bigger: the old fill-the-room view.
  assert.match(block, /\.popup-media-card\.is-wide:not\(\.draw-popup-media\) \{\s*flex: 1 1 0%/);
  // The compact frame lifts the 36% cap on the text.
  assert.match(block, /\.popup-body:has\(> \.popup-media-card:not\(\.is-wide\):not\(\.draw-popup-media\)\) > div:not\(\.popup-media-card\) \{\s*max-height: none;/);
  // The ··· styles reach map popups.
  assert.match(css, /:is\(#feed-column, \.feed-comments-stage, \.maplibregl-map, #popup-settings-preview\) \.feed-media-tools \{/);
  assert.match(css, /:is\(#feed-column, \.feed-comments-stage, \.maplibregl-map, #popup-settings-preview\) \.popup-media-card\.is-tools-shown > \.feed-media-tools/);
  // The hidden ⤢ chip is gone.
  assert.equal(css.includes("popup-media-expand"), false);
});

test("wide screens show a post with media as one card", () => {
  const css = read("../style.css");
  const at = css.indexOf("/* Wide screens: one card.");
  assert.ok(at > 0);
  const block = css.slice(at, css.indexOf("/* Text longer than the bubble", at));
  assert.match(block, /@media \(orientation: landscape\)/);
  // The popup starts where the right card did; the left card is gone.
  assert.match(block, /left: calc\(var\(--popup-left\) \+ env\(safe-area-inset-left\) \+ var\(--popup-two-card-w\) \* 0\.55 \+ var\(--u\) \* 0\.46\) !important/);
  assert.match(block, /\.popup-sheet:has\(\.popup-media-card\)::before \{\s*display: none;/);
  assert.match(block, /grid-template-columns: 0 minmax\(0, 1fr\)/);
  // Frame above the text, footer last.
  assert.match(block, /\.popup-media-card:not\(\.draw-popup-media\) \{\s*grid-column: 2;\s*grid-row: 4;/);
  assert.match(block, /> div:not\(\.popup-media-card\) \{\s*grid-row: 5;/);
  assert.match(block, /> \.popup-dock:has\(\.popup-top-topic\) \{\s*grid-row: 6;/);
  // Text-only posts keep the two cards (their rules still target :not(:has(media))).
  assert.match(css, /\.maplibregl-map \.popup-sheet:not\(:has\(\.popup-media-card\)\) \.popup-body > div:not\(\.popup-media-card\) \{\s*grid-column: 1;/);
});
