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
  // A share of the popup, not of the screen: 62.5% is the feed's 240px
  // frame in a 384px phone popup, so a big popup gets a big frame.
  const width = card.slice(0, card.indexOf("}")).match(/\n\s*width: ([^;]+);/);
  assert.ok(width);
  assert.equal(width[1], "62.5%");
  assert.equal(card.slice(0, card.indexOf("}")).includes("var(--fu) * 16"), false);
  assert.match(card, /aspect-ratio: 16 \/ 9/);
  assert.match(card, /flex: 0 0 auto/);
  assert.match(block, /object-fit: contain/);
  assert.match(block, /background-color: transparent/);
  assert.match(block, /filter: blur\(max\(12px, calc\(var\(--fu\) \* 0\.7\)\)\) brightness\(0\.55\) saturate\(1\.2\)/);
  // Make bigger: the old fill-the-room view.
  assert.match(block, /\.popup-media-card\.is-wide:not\(\.draw-popup-media\) \{\s*flex: 1 1 0%/);
  // The compact frame lifts the 36% cap on the text.
  assert.match(block, /\.popup-body:has\(> \.popup-media-card:not\(\.is-wide\):not\(\.draw-popup-media\)\) > div:not\(\.popup-media-card\) \{\s*max-height: none;/);
  // A post with no text keeps its frame under the title, like any post.
  assert.equal(block.includes("justify-content: center"), false);
  // Make bigger fits the media to the room, never its smaller pixel size.
  assert.match(block, /\.popup-media-card\.is-wide:not\(\.draw-popup-media\) > :is\(img:not\(\.feed-media-backdrop\), video, canvas\.media-still\) \{\s*width: 100%;\s*height: 100%;/);
  // The ··· styles reach map popups.
  assert.match(css, /:is\(#feed-column, \.feed-comments-stage, \.maplibregl-map, #popup-settings-preview\) \.feed-media-tools \{/);
  assert.match(css, /:is\(#feed-column, \.feed-comments-stage, \.maplibregl-map, #popup-settings-preview\) \.popup-media-card\.is-tools-shown > \.feed-media-tools/);
  // The hidden ⤢ chip is gone.
  assert.equal(css.includes("popup-media-expand"), false);
});

test("wide screens keep the two cards, the media filling the left one", () => {
  const css = read("../style.css");
  // No one-card layout: the popup is not narrowed and the left card stays.
  assert.equal(css.includes("--popup-two-card-w"), false);
  assert.equal(/\.popup-sheet:has\(\.popup-media-card\)::before \{\s*display: none/.test(css), false);
  assert.equal(css.includes("grid-template-columns: 0 minmax(0, 1fr)"), false);
  // The landscape rules still put the media in column 1 across every row.
  assert.match(css, /\.maplibregl-map \.popup-media-card:has\(video\) \{\s*grid-column: 1;\s*grid-row: 1 \/ -1;/);
  const at = css.indexOf("/* Wide screens keep their two cards");
  assert.ok(at > 0);
  const block = css.slice(at, css.indexOf("/* Text longer than the bubble", at));
  assert.match(block, /@media \(orientation: landscape\)/);
  // The compact frame is undone there: the media fills the card again.
  assert.match(block, /\.maplibregl-map \.popup-body > \.popup-media-card:not\(\.draw-popup-media\),\s*\.maplibregl-map \.popup-body > \.popup-media-card\.is-wide:not\(\.draw-popup-media\) \{[^}]*height: 100%;[^}]*aspect-ratio: auto;/);
  assert.match(block, /max-height: 100%;\s*\}/);
  // Make bigger has nothing to grow into, so only Fullscreen shows.
  assert.match(block, /\.feed-media-tools > \.feed-media-size \{\s*display: none !important;/);
  // It comes after the phone frame rules, which it has to override.
  assert.ok(at > css.indexOf("/* ── Map popup media: the feed's frame"));
});

test("the popup text reading ring runs round the bubble's border, clockwise", () => {
  const js = read("../popuptext.js");
  // One rounded rect on the border's centre line with the bubble's corners;
  // a rect's outline starts after the top-left curve and runs clockwise.
  const layout = js.slice(js.indexOf("function layoutRail"), js.indexOf("// Fade the edge"));
  assert.match(layout, /ring\.setAttribute\('x', String\(half\)\)/);
  assert.match(layout, /const rx = Math\.max\(0, Math\.min\(radius - half, rw \/ 2, rh \/ 2\)\)/);
  assert.match(layout, /state\.perim = 2 \* \(rw \+ rh\) - \(8 - 2 \* Math\.PI\) \* rx/);
  assert.match(layout, /rail\.style\.left = `\$\{-bw\}px`/);
  const paint = js.slice(js.indexOf("function paintEdges"), js.indexOf("// The rail brightens"));
  assert.match(paint, /state\.ring\.style\.strokeDasharray = `\$\{lit\} \$\{perim \+ 1\}`/);
  assert.match(paint, /state\.ring\.style\.visibility = lit > 0 \? 'visible' : 'hidden'/);
  // No straight bar any more (the full-screen page keeps its own scaleX bar).
  assert.equal(paint.includes("scaleX("), false);
  assert.equal(paint.includes("scaleY("), false);
  // Resizes re-measure it.
  assert.match(js.slice(js.indexOf("function syncMore"), js.indexOf("function paintEdges")), /layoutRail\(state\);\s*paintEdges\(state\);/);

  const css = read("../style.css");
  // Nothing between the ring and the popup frame clips it or its glow.
  assert.match(css, /\.popup-body > \.popup-msg\.is-more > \.popup-text-bubble \{\s*display: flex;\s*flex-direction: column;\s*overflow: visible;/);
  assert.match(css, /\.popup-body:has\(> \.popup-msg\.is-more\),\s*:is\(\.maplibregl-map, :where\(#popup-settings-preview\)\) \.popup-sheet \.popup-body > div\.popup-msg\.is-more \{\s*overflow: visible;/);
  assert.match(css, /\.popup-text-rail > \.popup-text-rail-fill \{\s*fill: none;/);
});
