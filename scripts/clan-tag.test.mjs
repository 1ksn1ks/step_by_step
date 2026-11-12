import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { clanChipModel, clanOfferOf, clanTagLabel, clanTokenLookup, clanWatcherCount, mountClanTag, refreshClanWatchers, sweepClanWatchers } from "../clantag.js";
import { formatSwapStat } from "../swapoffer.js";
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

test("the token lookup is fetched once and reused", async () => {
  const cache = new Map();
  const calls = [];
  const fetchToken = async (id) => {
    calls.push(id);
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
  assert.equal(clanChipModel(null), null);
});

test("a null or thrown clan token lookup is dropped so the next call can retry", async () => {
  const cache = new Map();
  const calls = [];
  let pending = null;
  const fetchToken = (id) => {
    calls.push(id);
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
    });
  };

  const id = "0.0.717171";
  const first = clanTokenLookup(id, fetchToken, cache);
  const second = clanTokenLookup(id, fetchToken, cache);
  assert.equal(first, second);
  assert.equal(cache.get(id), first);
  await Promise.resolve();
  assert.deepEqual(calls, [id]);
  pending.resolve(null);
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal(cache.has(id), false);

  const third = clanTokenLookup(id, fetchToken, cache);
  assert.notEqual(third, first);
  assert.equal(cache.get(id), third);
  await Promise.resolve();
  assert.deepEqual(calls, [id, id]);
  pending.resolve({ tokenId: id, symbol: "gib" });
  assert.equal((await third).symbol, "gib");
  assert.equal(cache.get(id), third);
  assert.equal(clanTokenLookup(id, fetchToken, cache), third);
  assert.deepEqual(calls, [id, id]);

  const bad = "0.0.717172";
  const thrown = clanTokenLookup(bad, fetchToken, cache);
  const thrownAgain = clanTokenLookup(bad, fetchToken, cache);
  assert.equal(thrown, thrownAgain);
  assert.equal(cache.get(bad), thrown);
  await Promise.resolve();
  assert.equal(calls.filter((item) => item === bad).length, 1);
  pending.reject(new Error("down"));
  assert.equal(await thrown, null);
  assert.equal(await thrownAgain, null);
  assert.equal(cache.has(bad), false);
  assert.equal(cache.get(id), third);

  const retry = clanTokenLookup(bad, fetchToken, cache);
  assert.notEqual(retry, thrown);
  await Promise.resolve();
  pending.resolve(null);
  assert.equal(await retry, null);
  assert.equal(calls.filter((item) => item === bad).length, 2);
  assert.equal(cache.has(bad), false);
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
  assert.match(clan, /const stats = createSwapStats\(\)/);
  assert.match(clan, /paintSwapStats\(stats, token\)/);
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
  assert.match(clanCss, /\.clan-token \.swap-token \{[^}]*background: #17171a/);
  assert.match(clanCss, /\.clan-token \.swap-token \{[^}]*border-radius: calc\(var\(--fu, var\(--u\)\) \* 1\.7\)/);
  assert.match(clanCss, /font-family: ui-monospace, monospace/);
  assert.match(clanCss, /\.clan-token \.swap-links \{[^}]*flex: 1 0 100%/);
  assert.match(clanCss, /\.clan-token \.swap-stats \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(clanCss, /@container clan-card \(max-width: calc\(var\(--fu, var\(--u\)\) \* 46\)\)/);
  assert.match(clanCss, /grid-column: span 2/);
  assert.match(clanCss, /grid-column: span 3/);
  assert.match(clanCss, /\.clan-token \.swap-stat-label \{[^}]*overflow: visible/);
  const tokenRule = clanCss.slice(clanCss.indexOf(".clan-token .swap-token {"), clanCss.indexOf(".clan-token .swap-token-icon"));
  assert.equal(tokenRule.includes("999rem"), false);
  assert.equal(tokenRule.includes("box-shadow"), false);
  const swapTokenCss = css.slice(css.indexOf("  .swap-token {"), css.indexOf("  .swap-token[hidden]"));
  assert.match(swapTokenCss, /width: min\(100%, 23\.75rem\)/);
  assert.equal(swapTokenCss.includes("--fu"), false);
});

test("a profile bubble without a username keeps the named name-block height", () => {
  const src = fs.readFileSync(new URL("../processallmessages.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function buildPopupProfile"), src.indexOf("const POPUP_GEAR"));
  const branch = body.slice(body.indexOf("if (trimmedUsername)"), body.indexOf("const payerLink"));
  assert.match(branch, /if \(trimmedUsername\) \{\s*h2\.appendChild\(payerUsernameNode\(trimmedUsername, click2link, \{ className: 'username' \}\)\)/);
  assert.equal(branch.slice(0, branch.indexOf("} else")).includes("no-username"), false);
  assert.match(branch, /\} else \{\s*profileSection\.classList\.add\('no-username'\)/);
  assert.equal(body.includes("createElement('br')"), false);

  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rule = css.match(/\.popup-profile-bubble\.no-username h2,[\s\S]*?justify-content: center;\s*\}/);
  assert.ok(rule);
  assert.match(rule[0], /\.popup-profile-bubble\.no-username h2,\s*\.popup-profile-bubble\.no-username \.payer-names \{/);
  assert.match(rule[0], /min-height: calc\(var\(--fu, var\(--u\)\) \* \(1\.85 \* 1\.25 \+ 0\.08 \+ 1\.4 \* 1\.25\)\)/);
  assert.equal(rule[0].includes("px"), false);
  assert.equal(rule[0].includes("#feed-column"), false);
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

function domNode(tag) {
  const node = {
    tag,
    className: "",
    id: "",
    hidden: false,
    title: "",
    textContent: "",
    dataset: {},
    children: [],
    parentNode: null,
    parentElement: null,
    isConnected: false,
    listeners: {},
  };
  node.classList = {
    add(name) {
      const set = new Set(node.className.split(/\s+/).filter(Boolean));
      set.add(name);
      node.className = [...set].join(" ");
    },
    remove(name) {
      node.className = node.className.split(/\s+/).filter((token) => token && token !== name).join(" ");
    },
  };
  node.setAttribute = () => {};
  node.addEventListener = (type, fn) => {
    (node.listeners[type] = node.listeners[type] || []).push(fn);
  };
  node.appendChild = (child) => {
    const old = child.parentNode;
    if (old) {
      const at = old.children.indexOf(child);
      if (at >= 0) old.children.splice(at, 1);
    }
    child.parentNode = node;
    child.parentElement = node;
    child.isConnected = node.isConnected;
    node.children.push(child);
    return child;
  };
  node.append = (...kids) => {
    for (const child of kids) node.appendChild(child);
  };
  node.after = (child) => {
    const parent = node.parentNode;
    if (!parent) return;
    const at = parent.children.indexOf(node);
    child.parentNode = parent;
    child.parentElement = parent;
    child.isConnected = parent.isConnected;
    parent.children.splice(at + 1, 0, child);
  };
  node.remove = () => {
    const parent = node.parentNode;
    if (!parent) return;
    const at = parent.children.indexOf(node);
    if (at >= 0) parent.children.splice(at, 1);
    node.parentNode = null;
    node.parentElement = null;
    node.isConnected = false;
  };
  node.querySelector = (sel) => {
    const want = sel.match(/^\[data-swap-stat="([^"]+)"\]$/);
    const walk = (current) => {
      for (const child of current.children) {
        const hit = want
          ? child.dataset && child.dataset.swapStat === want[1]
          : sel.startsWith(".") && child.className.split(/\s+/).includes(sel.slice(1));
        if (hit) return child;
        const nested = walk(child);
        if (nested) return nested;
      }
      return null;
    };
    return walk(node);
  };
  return node;
}

test("the opened clan card shows the five stats from the lookup", async () => {
  const tokenId = "0.0.424242";
  let fetches = 0;
  const body = {
    tokenId,
    symbol: "gib",
    stats: {
      priceUsd: 0.0016,
      marketCapUsd: 1.58e6,
      totalSupply: 980e6,
      circulating: -5,
    },
  };
  await clanTokenLookup(tokenId, async () => {
    fetches += 1;
    return body;
  });

  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  globalThis.document = {
    addEventListener() {},
    createElement(tag) { return domNode(tag); },
  };
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 0;
  };
  let bubble = null;
  try {
    const parent = domNode("div");
    parent.isConnected = true;
    bubble = domNode("section");
    parent.appendChild(bubble);
    const h2 = domNode("h2");
    const payerLink = domNode("a");
    h2.appendChild(payerLink);
    bubble.appendChild(h2);

    mountClanTag({
      bubble,
      payerLink,
      payer: "0.0.200",
      swaps: () => ({ "0.0.200": { enabled: true, tokenId, feeBps: 40 } }),
      createCard() { return domNode("div"); },
      paintToken() {},
      paintLinks() {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = (() => {
      const walk = (node) => {
        if (node.className === "clan-tag") return node;
        for (const child of node.children) {
          const hit = walk(child);
          if (hit) return hit;
        }
        return null;
      };
      return walk(bubble);
    })();
    assert.ok(button);
    const event = { preventDefault() {}, stopPropagation() {} };
    for (const fn of button.listeners.click) fn(event);

    const card = parent.children.find((child) => child.className.split(/\s+/).includes("clan-token"));
    assert.ok(card);
    const tiles = [];
    const walkTiles = (node) => {
      if (node.className === "swap-stat") tiles.push(node);
      for (const child of node.children) walkTiles(child);
    };
    walkTiles(card);
    assert.equal(tiles.length, 5);
    const labelOf = (tile) => tile.children.find((child) => child.className === "swap-stat-label").textContent;
    const valueOf = (tile) => tile.children.find((child) => child.className === "swap-stat-value").textContent;
    assert.deepEqual(tiles.map(labelOf), ["Price", "Market cap", "Liquidity", "Total supply", "Circulating"]);
    assert.equal(valueOf(tiles[0]), formatSwapStat(0.0016, true));
    assert.equal(valueOf(tiles[1]), formatSwapStat(1.58e6, true));
    assert.equal(valueOf(tiles[2]), formatSwapStat(null, true));
    assert.equal(valueOf(tiles[3]), formatSwapStat(980e6, false));
    assert.equal(valueOf(tiles[4]), formatSwapStat(null, false));
    assert.equal(tiles[4].title, "Total supply minus the treasury account's balance");
    assert.equal(fetches, 1);
  } finally {
    if (bubble) bubble.isConnected = false;
    sweepClanWatchers();
    globalThis.document = previous.document;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
  }
});

test("an unreviewed clan token shows the SaucerSwap notice under the card", async () => {
  const clan = fs.readFileSync(new URL("../clantag.js", import.meta.url), "utf8");
  const build = clan.slice(clan.indexOf("function buildCard"), clan.indexOf("function openCard"));
  assert.match(build, /if \(token && token\.dueDiligenceComplete === false\) clip\.append\(inner, clanReviewNote\(\), stats\)/);
  assert.match(build, /else clip\.append\(inner, stats\)/);
  assert.match(clan, /className = "swap-note"/);
  assert.match(clan, /className = "swap-note-text"/);
  assert.match(clan, /textContent = "Not reviewed by SaucerSwap\."/);

  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const clanCss = css.slice(css.indexOf(".popup-profile-bubble .payer-row"), css.indexOf("Early holder: the pill border"));
  const note = clanCss.match(/\.clan-token \.swap-note \{[^}]*\}/);
  const icon = clanCss.match(/\.clan-token \.swap-note \.swap-ico \{[^}]*\}/);
  assert.ok(note);
  assert.ok(icon);
  assert.match(note[0], /font-size: calc\(var\(--fu, var\(--u\)\) \* 1\.25\)/);
  assert.match(note[0], /gap: calc\(var\(--fu, var\(--u\)\) \* 0\.65\)/);
  assert.match(note[0], /line-height: 1\.35/);
  assert.match(note[0], /color: rgba\(255, 255, 255, 0\.5\)/);
  assert.match(icon[0], /width: calc\(var\(--fu, var\(--u\)\) \* 1\.45\)/);
  assert.match(icon[0], /height: calc\(var\(--fu, var\(--u\)\) \* 1\.45\)/);
  assert.match(icon[0], /margin-top: calc\(var\(--fu, var\(--u\)\) \* 0\.18\)/);
  assert.equal(note[0].includes("px"), false);
  assert.equal(icon[0].includes("px"), false);

  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  globalThis.document = {
    addEventListener() {},
    createElement(tag) { return domNode(tag); },
    createElementNS(_ns, tag) { return domNode(tag); },
  };
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 0;
  };

  const bubbles = [];
  async function openCard(payer, tokenId, token) {
    await clanTokenLookup(tokenId, async () => token);
    const parent = domNode("div");
    parent.isConnected = true;
    const bubble = domNode("section");
    bubbles.push(bubble);
    parent.appendChild(bubble);
    const h2 = domNode("h2");
    const payerLink = domNode("a");
    h2.appendChild(payerLink);
    bubble.appendChild(h2);
    mountClanTag({
      bubble,
      payerLink,
      payer,
      swaps: () => ({ [payer]: { enabled: true, tokenId, feeBps: 40 } }),
      createCard() { return domNode("div"); },
      paintToken() {},
      paintLinks() {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = (() => {
      const walk = (node) => {
        if (node.className === "clan-tag") return node;
        for (const child of node.children) {
          const hit = walk(child);
          if (hit) return hit;
        }
        return null;
      };
      return walk(bubble);
    })();
    assert.ok(button);
    for (const fn of button.listeners.click) fn({ preventDefault() {}, stopPropagation() {} });
    const card = parent.children.find((child) => child.className.split(/\s+/).includes("clan-token"));
    assert.ok(card);
    const clip = card.children.find((child) => child.className === "clan-token-clip");
    assert.ok(clip);
    return clip;
  }

  function noteText(clip) {
    const row = clip.children.find((child) => child.className === "swap-note");
    if (!row) return "";
    const text = row.children.find((child) => child.className === "swap-note-text");
    return text ? text.textContent : "";
  }

  try {
    const unreviewed = await openCard("0.0.515151", "0.0.616161", {
      tokenId: "0.0.616161",
      symbol: "gib",
      dueDiligenceComplete: false,
    });
    assert.deepEqual(unreviewed.children.map((child) => child.className), ["", "swap-note", "swap-stats"]);
    assert.equal(noteText(unreviewed), "Not reviewed by SaucerSwap.");

    const reviewed = await openCard("0.0.515152", "0.0.616162", {
      tokenId: "0.0.616162",
      symbol: "gib",
      dueDiligenceComplete: true,
    });
    assert.deepEqual(reviewed.children.map((child) => child.className), ["", "swap-stats"]);
    assert.equal(noteText(reviewed), "");

    const unknown = await openCard("0.0.515153", "0.0.616163", {
      tokenId: "0.0.616163",
      symbol: "gib",
    });
    assert.deepEqual(unknown.children.map((child) => child.className), ["", "swap-stats"]);
    assert.equal(noteText(unknown), "");
    await new Promise((resolve) => setTimeout(resolve, 450));
  } finally {
    for (const bubble of bubbles) bubble.isConnected = false;
    sweepClanWatchers();
    globalThis.document = previous.document;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
  }
});

test("a connected bubble keeps its clan watcher and follows Swap token changes", async () => {
  const clan = fs.readFileSync(new URL("../clantag.js", import.meta.url), "utf8");
  const mount = clan.slice(clan.indexOf("export function mountClanTag"));
  assert.match(mount, /let paintedId = ""/);
  assert.match(mount, /clanTokenLookup\(offer\.tokenId\)/);
  assert.match(mount, /if \(armed && !bubble\.isConnected\) \{\s*forget\(\)/);
  assert.equal(mount.includes("started = true"), false);
  assert.equal(mount.match(/forget\(\)/g).length, 1);
  assert.match(clan, /WATCH_SWEEP_MS = 30000/);

  const payer = "0.0.818181";
  const firstId = "0.0.919191";
  const secondId = "0.0.919192";
  await clanTokenLookup(firstId, async () => ({ tokenId: firstId, symbol: "gib" }));
  await clanTokenLookup(secondId, async () => ({ tokenId: secondId, symbol: "zip" }));
  const profile = { enabled: true, tokenId: firstId, feeBps: 40 };
  const swaps = { [payer]: profile };

  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  globalThis.document = {
    addEventListener() {},
    createElement(tag) { return domNode(tag); },
  };
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 0;
  };

  const parent = domNode("div");
  parent.isConnected = true;
  const bubble = domNode("section");
  parent.appendChild(bubble);
  const h2 = domNode("h2");
  const username = domNode("span");
  username.className = "username";
  username.textContent = "Ada";
  const payerLink = domNode("a");
  h2.append(username, payerLink);
  bubble.appendChild(h2);

  function chips() {
    const found = [];
    const walk = (node) => {
      if (node.className === "clan-tag") found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(bubble);
    return found;
  }
  function symbolOf(button) {
    const text = button.children.find((child) => child.className === "clan-tag-symbol");
    return text ? text.textContent : "";
  }

  try {
    assert.equal(clanWatcherCount(), 0);
    mountClanTag({
      bubble,
      payerLink,
      payer,
      swaps: () => swaps,
      createCard() { return domNode("div"); },
      paintToken() {},
      paintLinks() {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const painted = chips();
    assert.equal(painted.length, 1);
    assert.equal(symbolOf(painted[0]), "gib");
    assert.equal(clanWatcherCount(), 1);
    const row = h2.children.find((child) => child.className === "payer-row");
    assert.ok(row);
    assert.equal(username.parentElement, row.children.find((child) => child.className === "payer-names"));

    for (const fn of painted[0].listeners.click) fn({ preventDefault() {}, stopPropagation() {} });
    const card = parent.children.find((child) => child.className.split(/\s+/).includes("clan-token"));
    assert.ok(card);
    assert.equal(card.isConnected, true);

    refreshClanWatchers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(chips()[0], painted[0]);
    assert.equal(card.isConnected, true);

    profile.tokenId = secondId;
    refreshClanWatchers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const replaced = chips();
    assert.equal(replaced.length, 1);
    assert.notEqual(replaced[0], painted[0]);
    assert.equal(symbolOf(replaced[0]), "zip");
    assert.equal(card.isConnected, false);
    assert.equal(parent.children.includes(card), false);
    assert.equal(clanWatcherCount(), 1);
    assert.equal(h2.children.filter((child) => child.className === "payer-row").length, 1);

    profile.enabled = false;
    refreshClanWatchers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(chips().length, 0);
    assert.equal(h2.children.some((child) => child.className === "payer-row"), false);
    assert.equal(username.parentElement, h2);
    assert.equal(payerLink.parentElement, h2);
    assert.deepEqual(h2.children, [username, payerLink]);
    assert.equal(clanWatcherCount(), 1);

    profile.enabled = true;
    refreshClanWatchers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(chips().length, 1);
    assert.equal(symbolOf(chips()[0]), "zip");
    assert.equal(clanWatcherCount(), 1);
  } finally {
    bubble.isConnected = false;
    sweepClanWatchers();
    assert.equal(clanWatcherCount(), 0);
    globalThis.document = previous.document;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
  }
});
