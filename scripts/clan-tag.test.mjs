import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { clanChipModel, clanOfferOf, clanTagLabel, clanTokenLookup, clanWatcherCount, mountClanTag, sweepClanWatchers } from "../clantag.js";
import { swapWebsiteLabel, swapXLabel } from "../server/swaptoken.js";

const SAUCE = "0.0.731861";
const AUTHOR = "0.0.200";

function on(tokenId, feeBps = 40) {
  return { enabled: true, tokenId, feeBps };
}

test("a clan chip is offered only when profile Swap is on with a real token", () => {
  const swaps = { [AUTHOR]: on(SAUCE) };
  assert.deepEqual(clanOfferOf(swaps, AUTHOR), { tokenId: SAUCE, feeBps: 40 });
  assert.equal(clanOfferOf(swaps, "0.0.201"), null);
  assert.equal(clanOfferOf(null, AUTHOR), null);
  assert.equal(clanOfferOf({}, AUTHOR), null);
  assert.equal(clanOfferOf({ [AUTHOR]: { enabled: false, tokenId: SAUCE, feeBps: 0 } }, AUTHOR), null);
  assert.equal(clanOfferOf({ [AUTHOR]: on("not-a-token") }, AUTHOR), null);
  assert.equal(clanOfferOf({ [AUTHOR]: on("") }, AUTHOR), null);
});

test("the chip needs a symbol, and an icon is optional", () => {
  assert.deepEqual(clanChipModel({ symbol: "gib", icon: "https://cdn.example/g.png" }), {
    symbol: "gib",
    icon: "https://cdn.example/g.png",
  });
  assert.deepEqual(clanChipModel({ symbol: " gib " }), { symbol: "gib", icon: "" });
  assert.deepEqual(clanChipModel({ symbol: "gib", icon: "http://cdn.example/g.png" }), { symbol: "gib", icon: "" });
  assert.equal(clanChipModel({ symbol: "   ", icon: "https://cdn.example/g.png" }), null);
  assert.equal(clanChipModel({ icon: "https://cdn.example/g.png" }), null);
  assert.equal(clanChipModel(null), null);
  assert.equal(clanTagLabel("gib"), "Clan tag: gib, show token");
});

test("the token lookup is fetched once and reused, including a failure", async () => {
  const cache = new Map();
  const calls = [];
  const fetchToken = async (id) => {
    calls.push(id);
    if (id === "0.0.9") return null;
    if (id === "0.0.8") throw new Error("down");
    return { tokenId: id, symbol: "gib", icon: "https://cdn.example/g.png" };
  };
  const first = clanTokenLookup(SAUCE, fetchToken, cache);
  const second = clanTokenLookup(SAUCE, fetchToken, cache);
  assert.equal(first, second);
  assert.equal((await first).symbol, "gib");
  await second;
  assert.deepEqual(calls, [SAUCE]);

  const other = await clanTokenLookup("0.0.731862", fetchToken, cache);
  assert.equal(other.symbol, "gib");
  assert.equal(calls.length, 2);

  assert.equal(await clanTokenLookup("0.0.9", fetchToken, cache), null);
  assert.equal(await clanTokenLookup("0.0.9", fetchToken, cache), null);
  assert.equal(clanChipModel(null), null);
  assert.equal(calls.filter((id) => id === "0.0.9").length, 1);

  assert.equal(await clanTokenLookup("0.0.8", fetchToken, cache), null);
  assert.equal(await clanTokenLookup("0.0.8", fetchToken, cache), null);
  assert.equal(calls.filter((id) => id === "0.0.8").length, 1);
});

test("token card links use the real website host and x.com handle", () => {
  assert.equal(swapWebsiteLabel("https://www.gib.news/path"), "gib.news");
  assert.equal(swapWebsiteLabel("https://gib.news"), "gib.news");
  assert.equal(swapXLabel("https://x.com/gib_plz"), "x.com/gib_plz");
  assert.equal(swapXLabel("https://twitter.com/gib_plz"), "x.com/gib_plz");
  assert.equal(swapXLabel("@gib_plz"), "x.com/gib_plz");
});

test("the popup puts the display name above the account id and shares the feed rules", () => {
  const src = fs.readFileSync(new URL("../processallmessages.js", import.meta.url), "utf8");
  const start = src.indexOf("export function buildPopupProfile");
  const end = src.indexOf("const POPUP_GEAR");
  const body = src.slice(start, end);
  const nameAt = body.indexOf("payerUsernameNode");
  const idAt = body.indexOf("h2.appendChild(payerLink)");
  assert.ok(nameAt > 0 && idAt > nameAt);
  assert.match(body, /className = 'payer-info'/);
  assert.match(body, /explore\.hashpack\.app/);
  assert.match(body, /mountClanTag\(/);
  assert.match(body, /clanTokenLookup\(offer\.tokenId\)|swaps: \(\) => profileSwaps/);
  assert.equal(body.includes("openSwapSheet"), false);

  const clan = fs.readFileSync(new URL("../clantag.js", import.meta.url), "utf8");
  assert.match(clan, /clanTokenLookup\(offer\.tokenId\)/);
  assert.match(clan, /const lookups = new Map\(\)/);
  assert.equal(clan.slice(clan.indexOf("export function mountClanTag")).includes("new Map()"), false);
  assert.match(clan, /type = "button"/);
  assert.match(clan, /aria-expanded/);
  assert.match(clan, /aria-controls/);
  assert.match(clan, /clanTagLabel\(model\.symbol\)/);
  assert.match(clan, /paintLinks\(inner\.querySelector\("\.swap-links"\), token && token\.links\)/);
  assert.match(clan, /paintToken\(inner, token\)/);
  assert.match(clan, /prefers-reduced-motion: reduce/);
  assert.equal(clan.includes("openSwapSheet"), false);
  assert.match(clan, /if \(!model\) return/);

  const feed = fs.readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const listener = feed.slice(feed.indexOf("profile.addEventListener('click'"), feed.indexOf("openFeedProfile"));
  const guard = listener.indexOf(".clan-tag");
  const profileHit = listener.indexOf("img, video.loop-face, h2");
  assert.ok(guard > 0 && profileHit > guard);

  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  assert.match(sheet, /export function createSwapTokenCard/);
  assert.match(sheet, /export function paintSwapToken/);
  assert.match(sheet, /export function paintSwapLinks/);
  assert.match(sheet, /const token = createSwapTokenCard\(\)/);
  assert.match(sheet, /aria-label", kind \+ ": " \+ text/);
  assert.equal(sheet.includes("innerHTML"), false);

  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.popup-profile-bubble h2 \{\s*display: flex;/);
  assert.match(css, /\.popup-profile-bubble \.username \{\s*order: -1;/);
  assert.match(css, /\.popup-profile-bubble \.payer-info \{\s*order: 1;\s*color: rgba\(255, 255, 255, 0\.55\);/);
  assert.match(css, /\.maplibregl-popup \.popup-profile-bubble \{\s*--fu: var\(--u\);/);
  const sharedAt = css.search(/\.popup-profile-bubble h2 \{\s*display: flex;/);
  const shared = css.slice(sharedAt, css.indexOf(":is(", sharedAt));
  assert.equal(shared.includes("#feed-column"), false);
  assert.match(shared, /\.username \{\s*order: -1;/);
  assert.match(shared, /\.payer-info \{\s*order: 1;/);

  const clanCss = css.slice(css.indexOf(".popup-profile-bubble .payer-row"), css.indexOf("Early holder: the pill border"));
  assert.equal(clanCss.includes("px"), false);
  assert.match(clanCss, /max-width: 8ch/);
  assert.match(clanCss, /#22D3EE/);
  assert.match(clanCss, /rgba\(34, 211, 238, 0\.08\)/);
  assert.match(clanCss, /rgba\(34, 211, 238, 0\.35\)/);
  assert.match(clanCss, /flex: 0 100 auto/);
  assert.match(clanCss, /flex-flow: row nowrap/);
  assert.match(clanCss, /gap: calc\(var\(--fu, var\(--u\)\) \* 0\.6\)/);
  assert.match(clanCss, /\.clan-tag \{[^}]*align-self: stretch/);
  assert.match(clanCss, /\.clan-tag \{[^}]*flex: 0 0 auto/);
  assert.match(clanCss, /font-size: calc\(var\(--fu, var\(--u\)\) \* 1\.68\)/);
  assert.match(clanCss, /\.clan-tag-symbol \{[^}]*line-height: 1\.3/);
  assert.match(clanCss, /\.clan-tag-symbol \{[^}]*padding-top: 0\.1em/);
  assert.match(clanCss, /\* 0\.85\)/);
  assert.match(clan, /className = "payer-names"/);
  assert.match(clan, /names\.append\(payerLink\)/);
  assert.match(clan, /row\.append\(names, button\)/);
  assert.match(clanCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(clanCss, /transition: none/);
  assert.match(clanCss, /margin-left: var\(--popup-edge, 0\)/);
  assert.match(clanCss, /margin-right: var\(--popup-edge, 0\)/);
  assert.match(clanCss, /\.clan-token \.swap-token \{[\s\S]*?width: 100%/);
  assert.match(clanCss, /calc\(var\(--fu, var\(--u\)\) \* 4\.2\)/);
  assert.match(clanCss, /font-size: calc\(var\(--fu, var\(--u\)\) \* 1\.85\)/);
  assert.match(clanCss, /font-weight: 700/);
  assert.match(clanCss, /font-size: calc\(var\(--fu, var\(--u\)\) \* 1\.4\)/);
  assert.match(clanCss, /height: calc\(var\(--fu, var\(--u\)\) \* 2\.05\)/);
  assert.match(clanCss, /\.clan-token \.swap-link-label \{[^}]*line-height: 1\.3/);
  assert.match(clanCss, /\.clan-token \.swap-link-label \{[^}]*padding-top: 0\.1em/);
  assert.match(clanCss, /flex-wrap: wrap/);
  assert.match(clanCss, /margin: 0 0 0 auto/);
  const swapTokenCss = css.slice(css.indexOf("  .swap-token {"), css.indexOf("  .swap-token[hidden]"));
  assert.match(swapTokenCss, /width: min\(100%, 23\.75rem\)/);
  assert.equal(swapTokenCss.includes("--fu"), false);
});

test("removed bubbles for authors without Swap leave no watchers after a sweep", () => {
  assert.equal(clanWatcherCount(), 0);
  const bubbles = [];
  for (let i = 0; i < 40; i++) {
    const bubble = { isConnected: true };
    mountClanTag({
      bubble,
      payerLink: { replaceWith() {} },
      payer: "0.0." + (5000 + i),
      swaps: () => ({}),
      createCard() { return {}; },
      paintToken() {},
      paintLinks() {},
    });
    bubbles.push(bubble);
  }
  const stay = bubbles.pop();
  assert.equal(clanWatcherCount(), 40);
  for (const bubble of bubbles) bubble.isConnected = false;
  sweepClanWatchers();
  assert.equal(clanWatcherCount(), 1);
  stay.isConnected = false;
  sweepClanWatchers();
  assert.equal(clanWatcherCount(), 0);

  const clan = fs.readFileSync(new URL("../clantag.js", import.meta.url), "utf8");
  assert.match(clan, /WATCH_SWEEP_MS = 30000/);
  assert.match(clan, /setInterval\(sweepClanWatchers, WATCH_SWEEP_MS\)/);
  assert.match(clan, /clearInterval\(sweepTimer\)/);
  assert.match(clan, /sweepClanWatchers\(\);\s*for \(const tick of \[\.\.\.watchers\.keys\(\)\]\) tick\(\)/);
});
