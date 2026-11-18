import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("feed cards and map popups share one media frame module", () => {
  const frame = read("../mediaframe.js");
  assert.match(frame, /export function mountMediaBackdrop\(media, source\)/);
  assert.match(frame, /export function mountMediaTools\(media, \{/);
  // No shared start size: the feed and popups each pass their own.
  assert.equal(frame.includes("MediaWideDefault"), false);
  assert.match(frame, /startsWide = \(\) => false,/);
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
  assert.match(src, /import \{ mountMediaBackdrop, mountMediaTools \} from '\.\/mediaframe\.js'/);
  const fillAt = src.indexOf("function fillPopupMedia(imageDiv, url, hint, key, gallery = [])");
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
  assert.match(starts, /return popupMediaWideOn;/);
  // Each post keeps its own size choice across the popup's rebuilds, and
  // hands over its pictures for the "+N" and the gallery viewer.
  assert.match(src, /fillPopupMedia\(imageDiv, popupImageUrl, posterHintFor\(data\.payer, data\.created, data\.timestamp\), \['m', topicId, data\.payer, data\.created, markernumber\]\.join\(':'\), galleryImages\(image\)\)/);
  assert.match(src, /fillPopupMedia\(imageDiv, popupImageUrl, posterHintFor\(data\.payer, data\.created, data\.timestamp\), \['p', topicId, data\.payer, data\.created, polygonnumber\]\.join\(':'\), galleryImages\(image\)\)/);
  // Several pictures: the first shows with "+N" (opening the viewer at the
  // second); Fullscreen opens the same gallery at the first.
  assert.match(fill, /gallery\.length > 1 && gallery\[0\] === raw/);
  assert.match(fill, /if \(many\) openGallery\(gallery, 0\);\s*else openPreview\(url\);/);
  assert.match(fill, /if \(many\) mountMoreBadge\(imageDiv, gallery\.length - 1, \(\) => openGallery\(gallery, 1\)\)/);
});

test("popup media starts in the feed's compact 16:9 frame and the text gets the room", () => {
  const css = read("../style.css");
  const at = css.indexOf("/* ── Map popup media: the feed's frame");
  assert.ok(at > 0);
  const block = css.slice(at, css.indexOf("/* Text longer than the bubble", at));
  const card = block.slice(block.indexOf(".popup-body > .popup-media-card:not(.draw-popup-media) {"));
  // The feed's frame: the body's full width, edge to edge like the text,
  // at 16:9, pictures and videos alike; no fixed width.
  const width = card.slice(0, card.indexOf("}")).match(/\n\s*width: ([^;]+);/);
  assert.ok(width);
  assert.equal(width[1], "100%");
  assert.doesNotMatch(card.slice(0, card.indexOf("}")), /\d+px|var\(--fu\) \* 16|62\.5%/);
  assert.match(card, /aspect-ratio: 16 \/ 9/);
  assert.match(card, /flex: 0 0 auto/);
  assert.match(block, /object-fit: contain/);
  assert.match(block, /background-color: transparent/);
  // The blur is the feed's own rule, shared; the popup keeps only its hiding rules.
  assert.doesNotMatch(block, /filter: blur\(/);
  const blur = css.slice(css.indexOf(":is(#feed-column, .feed-comments-stage) .feed-card .popup-media-card > .feed-media-backdrop,"));
  assert.match(blur.slice(0, blur.indexOf("}")), /^:is\(#feed-column, \.feed-comments-stage\) \.feed-card \.popup-media-card > \.feed-media-backdrop,\s*:is\(\.maplibregl-map, :where\(#popup-settings-preview\)\) \.popup-media-card:not\(\.draw-popup-media\) > :is\(img, canvas\)\.feed-media-backdrop \{[^}]*filter: blur\(max\(12px, calc\(var\(--fu\) \* 0\.7\)\)\) brightness\(0\.55\) saturate\(1\.2\)/);
  // Make bigger outside the scroll body (the settings sample on a wide
  // screen): the old fill-the-room view. Portrait's is the feed's
  // (popup-scroll.test.mjs).
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

test("the reading ring runs round a box's border, clockwise (popup text and Swap bio)", () => {
  const ring = read("../readingring.js");
  // No app imports: popups and the Swap sheet both use it, cycle-free.
  assert.equal(/^import /m.test(ring), false);
  // One rounded rect on the border's centre line with the box's corners;
  // a rect's outline starts after the top-left curve and runs clockwise.
  const fit = ring.slice(ring.indexOf("export function fitRing"), ring.indexOf("export function paintRing"));
  assert.match(fit, /line\.setAttribute\('x', String\(half\)\)/);
  assert.match(fit, /const rx = Math\.max\(0, Math\.min\(radius - half, rw \/ 2, rh \/ 2\)\)/);
  assert.match(fit, /ring\.perim = 2 \* \(rw \+ rh\) - \(8 - 2 \* Math\.PI\) \* rx/);
  assert.match(fit, /svg\.style\.left = `\$\{-bw\}px`/);
  const paint = ring.slice(ring.indexOf("export function paintRing"), ring.indexOf("export const RING_SETTLE_MS"));
  assert.match(paint, /ring\.line\.style\.strokeDasharray = `\$\{lit\} \$\{ring\.perim \+ 1\}`/);
  assert.match(paint, /ring\.line\.style\.visibility = lit > 0 \? 'visible' : 'hidden'/);
  assert.equal(paint.includes("scaleX("), false);

  const js = read("../popuptext.js");
  assert.match(js, /import \{ brightenRing, createRing, fitRing, paintRing \} from '\.\/readingring\.js'/);
  assert.match(js, /const ring = createRing\('popup-text-rail'\)/);
  // Resizes re-measure it.
  assert.match(js.slice(js.indexOf("function syncMore"), js.indexOf("function paintEdges")), /fitRing\(state\.ring, bubble\);\s*paintEdges\(state\);/);
  assert.match(js, /paintRing\(state\.ring, on && room > 1 \? flow\.scrollTop \/ room : 0\)/);

  const css = read("../style.css");
  // The bubble does not clip the ring. The popup's scroll body does clip
  // (it scrolls), so it keeps padding above the text for the glow, and no
  // rule turns its overflow back to visible while the ring shows.
  assert.match(css, /\.popup-body > \.popup-msg\.is-more > \.popup-text-bubble \{\s*display: flex;\s*flex-direction: column;\s*overflow: visible;/);
  assert.doesNotMatch(css, /\.popup-body:has\(> \.popup-msg\.is-more\)/);
  assert.doesNotMatch(css, /\.popup-body > div\.popup-msg\.is-more \{\s*overflow: visible;/);
  assert.match(css, /> \.popup-sheet > \.popup-body \{\s*margin: 0 var\(--popup-edge\) !important;\s*padding-top: var\(--popup-gap\);/);
  assert.match(css, /> \.popup-sheet > \.popup-body > div\.popup-msg \{[^}]*margin-top: 0;\s*padding-top: calc\(var\(--u\) \* 0\.8\);/);
  assert.match(css, /\.reading-ring > \.reading-ring-line \{\s*fill: none;\s*stroke-width: var\(--ring-w\);/);
  // Hidden until its box shows it.
  assert.match(css, /\.reading-ring \{[^}]*display: none;/);
  assert.match(css, /\.popup-msg\.is-more > \.popup-text-bubble > \.popup-text-rail \{\s*display: block;/);
});

test("popups have their own Show media full size switch, apart from the feed's", () => {
  const page = read("../index.html");
  const panel = page.slice(page.indexOf('id="popup-options-column"'), page.indexOf('id="popup-settings-preview"'));
  // The second row of the Screen corners card, under the Roundness slider
  // (its note and Back to Auto stay with the slider).
  const corners = panel.slice(panel.indexOf('class="mb-card mb-corners-card"'), panel.indexOf('class="mb-card mb-color-grid"'));
  assert.ok(corners.indexOf('id="screen-corners"') > 0);
  assert.ok(corners.indexOf('id="popup-media-wide"') > corners.indexOf('id="screen-corners-auto"'));
  // Show X embeds (x-embed.test.mjs) is the row after it.
  assert.match(corners, /<button type="button" id="popup-media-wide" class="feed-settings-switch mb-switch-row" role="switch" aria-checked="false"><span>Show media full size<\/span><span class="feed-settings-switch-ui" aria-hidden="true"><\/span><\/button>\s*<!--[\s\S]*?-->\s*<button type="button" id="popup-x-embeds"/);
  assert.equal(panel.includes("mb-media-card"), false);
  assert.equal(panel.includes('<div class="mb-card-title">Media</div>'), false);
  const help = page.slice(page.indexOf('id="popup-style-help-overlay"'), page.indexOf('id="popup-options-column"'));
  assert.match(help, /Show media full size starts every picture and video in a popup big/);

  const src = read("../processallmessages.js");
  // Its own key on this device, not the feed's feed-setting-pictures-wide.
  assert.match(src, /const POPUP_MEDIA_WIDE_KEY = 'meritocracy-popup-media-wide'/);
  assert.equal(src.includes("feed-setting-pictures-wide"), false);
  assert.match(src, /localStorage\.setItem\(POPUP_MEDIA_WIDE_KEY, on \? 'on' : 'off'\)/);
  // The switch paints its state, flips it, and resizes popups already open.
  const bind = src.slice(src.indexOf("function bindPopupMediaWide"), src.indexOf("bindPopupMediaWide();"));
  assert.match(bind, /button\.setAttribute\('aria-checked', popupMediaWideOn \? 'true' : 'false'\)/);
  assert.match(bind, /setPopupMediaWide\(!popupMediaWideOn\);\s*paint\(\);\s*resizePopupMedia\(\);/);
  const resize = src.slice(src.indexOf("function resizePopupMedia"), src.indexOf("function bindPopupMediaWide"));
  assert.match(resize, /\.maplibregl-popup \.popup-media-card\[data-picture\]/);
  assert.match(resize, /popupMediaStartsWide\(media\.dataset\.mediaKey \|\| ''\)/);
  assert.match(resize, /media\._paintSize\(\)/);
  assert.equal(resize.includes(".pause("), false);

  const feed = read("../feedlayout.js");
  assert.equal(feed.includes("meritocracy-popup-media-wide"), false);

  // Laid out as one of the page's rows: same height, padding and label size.
  const css = read("../style.css");
  assert.match(css, /\.in-drawer \.mb-card > \.mb-switch-row \{\s*box-sizing: border-box;\s*min-height: max\(44px, 6dvh\);\s*margin: 0;\s*padding: 0 16px;\s*gap: 12px;\s*box-shadow: inset 0 1px 0 rgba\(255, 255, 255, 0\.12\);\s*font-size: calc\(var\(--fu\) \* 1\.6\);\s*font-weight: 400;/);
  // It fades with the rest while the corners are being tuned.
  assert.match(css, /html\.is-tuning-corners #popup-options-column \.mb-corners-card > \.mb-switch-row/);
  assert.match(css, /\.in-drawer \.mb-row \{\s*box-sizing: border-box;\s*min-height: max\(44px, 6dvh\);\s*margin: 0;\s*padding: 0 16px;/);
});
