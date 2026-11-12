import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import {
  createSwapTokenLookup,
  EMPTY_SWAP_STATS,
  isHbarSide,
  readSaucerLists,
  swapHttpsLink,
  swapTokenLinks,
  swapTokenRoute,
  swapTokenStats,
  swapTwitterLink,
  swapWebsiteLabel,
  swapXLabel,
  WHBAR_TOKEN_IDS,
} from "../server/swaptoken.js";

const SAUCE = "0.0.731861";
const WHBAR = WHBAR_TOKEN_IDS[0];
const OLD_WHBAR = WHBAR_TOKEN_IDS[1];
const USDC = "0.0.456858";

function side(id, extra = {}) {
  return {
    id,
    symbol: extra.symbol || "TOK",
    name: extra.name || "",
    decimals: extra.decimals ?? 6,
    dueDiligenceComplete: extra.due === true,
  };
}

function mirrorRow(id, extra = {}) {
  const { name, symbol, decimals, ...rest } = extra;
  return {
    token_id: id,
    name: name ?? "Sauce",
    symbol: symbol ?? "SAUCE",
    decimals: decimals ?? "6",
    type: "FUNGIBLE_COMMON",
    ...rest,
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function world(options = {}) {
  const calls = [];
  const state = {
    mirror: options.mirror || {},
    tokens: options.tokens || [],
    pools: options.pools || [],
    poolsV1: options.poolsV1 || [],
    details: options.details || {},
    balances: options.balances || {},
    prices: options.prices || {},
    fail: options.fail || null,
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    if (state.fail && state.fail(url)) return jsonResponse(503, {});
    const balances = url.match(/\/api\/v1\/tokens\/([^/]+)\/balances\?/);
    if (balances) {
      const id = decodeURIComponent(balances[1]);
      if (!Object.prototype.hasOwnProperty.call(state.balances, id)) return jsonResponse(404, {});
      return jsonResponse(200, state.balances[id]);
    }
    if (url.includes("/api/v1/tokens/")) {
      const id = decodeURIComponent(url.split("/api/v1/tokens/")[1]);
      const row = state.mirror[id];
      if (!row) return jsonResponse(404, { _status: { messages: [{ message: "Not found" }] } });
      return jsonResponse(200, row);
    }
    const prices = url.match(/\/tokens\/prices\/([^/?#]+)/);
    if (prices) {
      const id = decodeURIComponent(prices[1]);
      if (!Object.prototype.hasOwnProperty.call(state.prices, id)) return jsonResponse(404, {});
      return jsonResponse(200, state.prices[id]);
    }
    const detail = url.match(/\/tokens\/([^/?#]+)$/);
    if (detail) {
      const id = decodeURIComponent(detail[1]);
      if (!Object.prototype.hasOwnProperty.call(state.details, id)) return jsonResponse(404, {});
      return jsonResponse(200, state.details[id]);
    }
    if (url.endsWith("/tokens")) return jsonResponse(200, state.tokens);
    if (url.endsWith("/v2/pools")) return jsonResponse(200, state.pools);
    if (url.endsWith("/pools")) return jsonResponse(200, state.poolsV1);
    throw new Error("unexpected " + url);
  };
  return { fetchImpl, calls, state };
}

function lookupOf(env, extra = {}) {
  return createSwapTokenLookup({
    fetchImpl: env.fetchImpl,
    now: extra.now || (() => extra.clock ?? 1_000),
    cacheMs: extra.cacheMs ?? 1_000,
    cacheMax: extra.cacheMax,
    mirror: "https://mirror.test",
    saucer: "https://saucer.test",
  });
}

test("a bad token id is rejected before any request", async () => {
  const env = world();
  const lookup = lookupOf(env);
  const result = await lookup.lookup("hbar");
  assert.deepEqual(result, { status: 400, body: { error: "token" } });
  assert.equal(env.calls.length, 0);
});

test("a missing mirror token is not found and does not ask SaucerSwap", async () => {
  const env = world();
  const result = await lookupOf(env).lookup(SAUCE);
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: "not found" });
  assert.equal(env.calls.some((url) => url.includes("saucer.test")), false);
});

test("a WHBAR pool returns name, symbol, decimals, the pool, and due diligence", async () => {
  const env = world({
    mirror: { [SAUCE]: mirrorRow(SAUCE, { name: "SAUCE", symbol: "SAUCE", decimals: "6" }) },
    tokens: [{ id: SAUCE, symbol: "NOPE", name: "Wrong", decimals: 2, dueDiligenceComplete: true }],
    pools: [{ tokenA: side(SAUCE, { due: false }), tokenB: side(WHBAR, { symbol: "HBAR" }) }],
  });
  const result = await lookupOf(env).lookup("  " + SAUCE + "  ");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    tokenId: SAUCE,
    name: "SAUCE",
    symbol: "SAUCE",
    decimals: 6,
    pool: true,
    dueDiligenceComplete: true,
    icon: "",
    links: {},
    stats: { ...EMPTY_SWAP_STATS },
  });
});

test("a pool against the legacy WHBAR token counts", async () => {
  const legacy = world({
    mirror: { [SAUCE]: mirrorRow(SAUCE) },
    tokens: [{ id: SAUCE, dueDiligenceComplete: false }],
    pools: [{ tokenA: side(OLD_WHBAR, { symbol: "WHBAR" }), tokenB: side(SAUCE) }],
  });
  const result = await lookupOf(legacy).lookup(SAUCE);
  assert.equal(result.body.pool, true);
  assert.equal(result.body.dueDiligenceComplete, false);
});

test("a symbol of HBAR or WHBAR is not the HBAR side", async () => {
  assert.equal(isHbarSide(side("0.0.999", { symbol: "HBAR" })), false);
  assert.equal(isHbarSide(side("0.0.999", { symbol: "WHBAR" })), false);
  assert.equal(isHbarSide(side(WHBAR, { symbol: "SAUCE" })), true);
  const env = world({
    mirror: { [USDC]: mirrorRow(USDC, { name: "USD Coin", symbol: "USDC", decimals: "6" }) },
    tokens: [],
    pools: [{ tokenA: side(USDC, { due: true }), tokenB: side("0.0.999", { symbol: "HBAR" }) }],
  });
  const result = await lookupOf(env).lookup(USDC);
  assert.equal(result.body.pool, false);
  assert.equal(result.body.dueDiligenceComplete, false);
  assert.equal(result.body.name, "USD Coin");
  assert.equal(result.body.decimals, 6);
});

test("a V1 pool with WHBAR counts and the LP token does not", async () => {
  const lp = "0.0.1465866";
  const env = world({
    mirror: {
      [SAUCE]: mirrorRow(SAUCE),
      [lp]: mirrorRow(lp, { name: "LP", symbol: "LP" }),
    },
    tokens: [],
    pools: [],
    poolsV1: [{
      tokenA: side(SAUCE),
      tokenB: side(WHBAR),
      lpToken: { id: lp, symbol: "SAUCE - WHBAR" },
    }],
  });
  const lookup = lookupOf(env);
  const sauce = await lookup.lookup(SAUCE);
  const lpResult = await lookup.lookup(lp);
  assert.equal(sauce.body.pool, true);
  assert.equal(lpResult.body.pool, false);
  assert.equal(env.calls.filter((url) => url.endsWith("/pools") && !url.endsWith("/v2/pools")).length, 1);
});

test("a pool that is not paired with HBAR does not count", async () => {
  const env = world({
    mirror: { [SAUCE]: mirrorRow(SAUCE, { symbol: "SAUCE" }) },
    tokens: [{ id: SAUCE, dueDiligenceComplete: true }],
    pools: [{ tokenA: side(SAUCE), tokenB: side(USDC, { symbol: "USDC" }) }],
  });
  const result = await lookupOf(env).lookup(SAUCE);
  assert.equal(result.status, 200);
  assert.equal(result.body.pool, false);
  assert.equal(result.body.symbol, "SAUCE");
});

test("WHBAR itself is the HBAR side, not a token paired with WHBAR", () => {
  assert.equal(isHbarSide(side(WHBAR, { symbol: "HBAR" })), true);
  const lists = readSaucerLists(
    [],
    [{ tokenA: side(WHBAR, { symbol: "HBAR" }), tokenB: side(SAUCE, { symbol: "SAUCE" }) }]
  );
  assert.equal(lists.paired.has(SAUCE), true);
  assert.equal(lists.paired.has(WHBAR), false);
});

test("the token list's due diligence wins over the pool copy", () => {
  const lists = readSaucerLists(
    [{ id: SAUCE, dueDiligenceComplete: false }],
    [{ tokenA: side(SAUCE, { due: true }), tokenB: side(WHBAR, { symbol: "HBAR" }) }]
  );
  assert.equal(lists.byId.get(SAUCE).dueDiligenceComplete, false);
  assert.equal(lists.paired.has(SAUCE), true);
});

test("a result is reused until the cache window passes", async () => {
  let clock = 5_000;
  const env = world({
    mirror: { [SAUCE]: mirrorRow(SAUCE) },
    tokens: [{ id: SAUCE, dueDiligenceComplete: true }],
    pools: [{ tokenA: side(SAUCE), tokenB: side(WHBAR, { symbol: "HBAR" }) }],
  });
  const lookup = lookupOf(env, { now: () => clock, cacheMs: 1_000 });
  await lookup.lookup(SAUCE);
  const afterFirst = env.calls.length;
  await lookup.lookup(SAUCE);
  assert.equal(env.calls.length, afterFirst);
  clock += 1_001;
  await lookup.lookup(SAUCE);
  assert.ok(env.calls.length > afterFirst);
});

test("the answer cache drops the oldest entry past the cap", async () => {
  const env = world();
  let clock = 1_000;
  const lookup = lookupOf(env, { now: () => clock, cacheMs: 60_000, cacheMax: 2 });
  await lookup.lookup("0.0.1");
  await lookup.lookup("0.0.2");
  await lookup.lookup("0.0.3");
  const callsFor = (id) => env.calls.filter((url) => url.endsWith("/" + id)).length;
  assert.equal(callsFor("0.0.1"), 1);
  const beforeKept = env.calls.length;
  await lookup.lookup("0.0.2");
  assert.equal(env.calls.length, beforeKept);
  await lookup.lookup("0.0.1");
  assert.equal(callsFor("0.0.1"), 2);
});

test("a failed lookup is not cached", async () => {
  const env = world({
    mirror: { [SAUCE]: mirrorRow(SAUCE) },
    tokens: [{ id: SAUCE, dueDiligenceComplete: true }],
    pools: [{ tokenA: side(SAUCE), tokenB: side(WHBAR, { symbol: "HBAR" }) }],
    fail: (url) => url.endsWith("/v2/pools"),
  });
  const lookup = lookupOf(env);
  const failed = await lookup.lookup(SAUCE);
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.body, { error: "lookup" });
  env.state.fail = null;
  const again = await lookup.lookup(SAUCE);
  assert.equal(again.status, 200);
  assert.equal(again.body.pool, true);
});

test("two checks for one token share one mirror read", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/api/v1/tokens/")) await gate;
    if (url.includes("/api/v1/tokens/")) return jsonResponse(200, mirrorRow(SAUCE));
    if (url.endsWith("/tokens")) return jsonResponse(200, [{ id: SAUCE, dueDiligenceComplete: false }]);
    if (/\/tokens\/[^/]+$/.test(url)) return jsonResponse(404, {});
    if (url.endsWith("/v2/pools")) {
      return jsonResponse(200, [{ tokenA: side(SAUCE), tokenB: side(WHBAR, { symbol: "HBAR" }) }]);
    }
    if (url.endsWith("/pools")) return jsonResponse(200, []);
    throw new Error(url);
  };
  const lookup = createSwapTokenLookup({
    fetchImpl,
    mirror: "https://mirror.test",
    saucer: "https://saucer.test",
  });
  const first = lookup.lookup(SAUCE);
  const second = lookup.lookup(SAUCE);
  assert.equal(calls.filter((url) => url.includes("/api/v1/tokens/")).length, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200);
  assert.equal(b.body.pool, true);
  assert.equal(calls.filter((url) => url.includes("/api/v1/tokens/")).length, 1);
});

test("GET /api/swap/token/:tokenId returns the lookup", async () => {
  const env = world({
    mirror: { [SAUCE]: mirrorRow(SAUCE, { name: "SAUCE", symbol: "SAUCE", decimals: "6" }) },
    tokens: [{ id: SAUCE, dueDiligenceComplete: true }],
    pools: [{ tokenA: side(SAUCE), tokenB: side(WHBAR, { symbol: "WHBAR" }) }],
    details: {
      [SAUCE]: {
        website: " https://sauce.example ",
        twitterHandle: "@sauce",
        telegram: "http://t.me/nope",
        discord: "https://discord.com/invite/sauce",
        icon: " https://cdn.example/sauce.png ",
      },
    },
  });
  const app = express();
  app.get("/api/swap/token/:tokenId", swapTokenRoute(lookupOf(env)));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const { port } = server.address();
    const found = await fetch(`http://127.0.0.1:${port}/api/swap/token/${SAUCE}`);
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), {
      tokenId: SAUCE,
      name: "SAUCE",
      symbol: "SAUCE",
      decimals: 6,
      pool: true,
      dueDiligenceComplete: true,
      icon: "https://cdn.example/sauce.png",
      links: {
        website: "https://sauce.example",
        x: "https://x.com/sauce",
      },
      stats: { ...EMPTY_SWAP_STATS },
    });
    const missing = await fetch(`http://127.0.0.1:${port}/api/swap/token/nope`);
    assert.equal(missing.status, 400);
    assert.deepEqual(await missing.json(), { error: "token" });
    const down = await fetch(`http://127.0.0.1:${port}/api/swap/token/0.0.1`);
    assert.equal(down.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("the route handler turns a thrown lookup into 502", async () => {
  const app = express();
  app.get("/api/swap/token/:tokenId", swapTokenRoute({
    async lookup() {
      throw new Error("boom");
    },
  }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/swap/token/${SAUCE}`);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: "lookup" });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("a website, telegram, or discord value is kept only as an https URL", () => {
  assert.equal(swapHttpsLink("  https://sauce.example/docs  "), "https://sauce.example/docs");
  assert.equal(swapHttpsLink("https://sauce.example"), "https://sauce.example");
  assert.equal(swapHttpsLink("http://sauce.example"), "");
  assert.equal(swapHttpsLink("javascript:alert(1)"), "");
  assert.equal(swapHttpsLink("https://"), "");
  assert.equal(swapHttpsLink("https://ok.example/a b"), "");
  assert.equal(swapHttpsLink("https://ok.example/\npath"), "");
  assert.equal(swapHttpsLink(""), "");
  assert.equal(swapHttpsLink(null), "");
  assert.equal(swapHttpsLink("ftp://sauce.example"), "");
});

test("a twitter handle becomes an x.com link and anything else is dropped", () => {
  assert.equal(swapTwitterLink("@SaucerSwap"), "https://x.com/SaucerSwap");
  assert.equal(swapTwitterLink("  sauce_token  "), "https://x.com/sauce_token");
  assert.equal(swapTwitterLink("a"), "https://x.com/a");
  assert.equal(swapTwitterLink("a".repeat(15)), "https://x.com/" + "a".repeat(15));
  assert.equal(swapTwitterLink("bad-name"), "");
  assert.equal(swapTwitterLink("a".repeat(16)), "");
  assert.equal(swapTwitterLink("https://x.com/SaucerSwap"), "https://x.com/SaucerSwap");
  assert.equal(swapTwitterLink("https://twitter.com/gib_plz"), "https://x.com/gib_plz");
  assert.equal(swapTwitterLink("https://www.x.com/gib_plz/"), "https://x.com/gib_plz");
  assert.equal(swapTwitterLink("https://twitter.com/gib_plz/status/1"), "");
  assert.equal(swapTwitterLink("http://x.com/gib_plz"), "");
  assert.equal(swapTwitterLink("https://example.com/gib_plz"), "");
  assert.equal(swapTwitterLink("@"), "");
  assert.equal(swapTwitterLink("@@sauce"), "");
  assert.equal(swapTwitterLink("sauce token"), "");
  assert.equal(swapTwitterLink(""), "");
  assert.equal(swapTwitterLink(null), "");
});

test("token links keep a trimmed https website and an x handle, not telegram or discord", () => {
  assert.deepEqual(swapTokenLinks({
    website: " https://www.gib.news/ ",
    twitterHandle: "@gib_plz",
    telegram: "https://t.me/sauce",
    discord: "https://discord.com/invite/sauce",
  }), {
    website: "https://www.gib.news/",
    x: "https://x.com/gib_plz",
  });
  assert.deepEqual(swapTokenLinks({
    website: "javascript:alert(1)",
    twitterHandle: "https://twitter.com/gib_plz",
    telegram: " https://t.me/a b ",
    discord: "",
  }), {
    x: "https://x.com/gib_plz",
  });
  assert.deepEqual(swapTokenLinks(null), {});
  assert.equal(swapWebsiteLabel("https://www.gib.news/"), "gib.news");
  assert.equal(swapWebsiteLabel("https://gib.news/docs"), "gib.news");
  assert.equal(swapWebsiteLabel("http://gib.news"), "");
  assert.equal(swapXLabel("@gib_plz"), "x.com/gib_plz");
  assert.equal(swapXLabel("https://twitter.com/gib_plz"), "x.com/gib_plz");
  assert.equal(swapXLabel("https://x.com/gib_plz/"), "x.com/gib_plz");
});

test("token links come from the SaucerSwap token record and stay in the cache", async () => {
  let clock = 5_000;
  const env = world({
    mirror: { [SAUCE]: mirrorRow(SAUCE) },
    tokens: [{ id: SAUCE, dueDiligenceComplete: true }],
    pools: [{ tokenA: side(SAUCE), tokenB: side(WHBAR, { symbol: "HBAR" }) }],
    details: {
      [SAUCE]: {
        website: " https://sauce.example/docs ",
        twitterHandle: "@sauce_token",
        telegram: "https://t.me/sauce",
        discord: "not a url",
      },
    },
  });
  const lookup = lookupOf(env, { now: () => clock, cacheMs: 1_000 });
  const result = await lookup.lookup(SAUCE);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.links, {
    website: "https://sauce.example/docs",
    x: "https://x.com/sauce_token",
  });
  const detailCalls = () => env.calls.filter((url) => url === `https://saucer.test/tokens/${SAUCE}`).length;
  assert.equal(detailCalls(), 1);
  await lookup.lookup(SAUCE);
  assert.equal(detailCalls(), 1);
  clock += 1_001;
  await lookup.lookup(SAUCE);
  assert.equal(detailCalls(), 2);
});

test("a failed token-link read still returns the pool with no links", async () => {
  const env = world({
    mirror: { [SAUCE]: mirrorRow(SAUCE) },
    tokens: [{ id: SAUCE, dueDiligenceComplete: true }],
    pools: [{ tokenA: side(SAUCE), tokenB: side(WHBAR, { symbol: "HBAR" }) }],
    fail: (url) => url.startsWith("https://saucer.test/tokens/"),
  });
  const lookup = lookupOf(env);
  const result = await lookup.lookup(SAUCE);
  assert.equal(result.status, 200);
  assert.equal(result.body.pool, true);
  assert.deepEqual(result.body.links, {});
  const before = env.calls.length;
  await lookup.lookup(SAUCE);
  assert.equal(env.calls.length, before);
});

test("the server route uses the public rate limit", () => {
  const source = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(
    source,
    /app\.get\("\/api\/swap\/token\/:tokenId", publicPostLimit, swapTokenRoute\(swapTokenLookup\)\)/
  );
});

test("circulating supply is total minus treasury, and market cap is price times circulating", () => {
  const stats = swapTokenStats({
    supplyRaw: 1_000_000_000_000_000n,
    treasury: 20_000_000_000_000n,
    decimals: 6,
    priceUsd: 0.0016,
    liquidityUsd: 2500,
  });
  assert.equal(stats.totalSupply, 1_000_000_000);
  assert.equal(stats.circulating, 980_000_000);
  assert.equal(stats.marketCapUsd, 0.0016 * 980_000_000);
  assert.equal(stats.priceUsd, 0.0016);
  assert.equal(stats.liquidityUsd, 2500);

  const noTreasury = swapTokenStats({ supplyRaw: 5000n, decimals: 2, priceUsd: 3 });
  assert.equal(noTreasury.totalSupply, 50);
  assert.equal(noTreasury.circulating, null);
  assert.equal(noTreasury.marketCapUsd, null);
  assert.equal(noTreasury.priceUsd, 3);

  const over = swapTokenStats({
    supplyRaw: 100n,
    treasury: 101n,
    decimals: 0,
    priceUsd: 2,
    liquidityUsd: -1,
  });
  assert.equal(over.totalSupply, 100);
  assert.equal(over.circulating, null);
  assert.equal(over.marketCapUsd, null);
  assert.equal(over.liquidityUsd, null);

  const noPrice = swapTokenStats({
    supplyRaw: 10n,
    treasury: 4n,
    decimals: 0,
    priceUsd: null,
    liquidityUsd: "12.5",
  });
  assert.equal(noPrice.circulating, 6);
  assert.equal(noPrice.marketCapUsd, null);
  assert.equal(noPrice.liquidityUsd, 12.5);

  const full = swapTokenStats({ supplyRaw: 980n, treasury: 0n, decimals: 0, priceUsd: 1 });
  assert.equal(full.circulating, 980);
  assert.equal(full.marketCapUsd, 980);

  assert.deepEqual(swapTokenStats({ supplyRaw: "nope", priceUsd: "bad", liquidityUsd: -4 }), EMPTY_SWAP_STATS);
});

test("token stats use the mirror supply, the treasury balance, and the latest candle", async () => {
  const nowMs = 1_700_000_000_000;
  const env = world({
    mirror: {
      [SAUCE]: mirrorRow(SAUCE, {
        decimals: "6",
        total_supply: "1000000000000000",
        treasury_account_id: "0.0.98",
      }),
    },
    tokens: [{ id: SAUCE, dueDiligenceComplete: true }],
    pools: [{ tokenA: side(SAUCE), tokenB: side(WHBAR, { symbol: "HBAR" }) }],
    details: { [SAUCE]: { priceUsd: 0.0016 } },
    balances: { [SAUCE]: { balances: [{ account: "0.0.98", balance: "20000000000000" }] } },
    prices: {
      [SAUCE]: [
        { timestampSeconds: 10, liquidityUsd: 100 },
        { timestampSeconds: 50, liquidityUsd: 2500.5 },
        { timestampSeconds: 40, liquidityUsd: 9 },
      ],
    },
  });
  const lookup = lookupOf(env, { now: () => nowMs, cacheMs: 1_000 });
  const result = await lookup.lookup(SAUCE);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.stats, {
    totalSupply: 1_000_000_000,
    circulating: 980_000_000,
    liquidityUsd: 2500.5,
    marketCapUsd: 0.0016 * 980_000_000,
    priceUsd: 0.0016,
  });
  const to = Math.floor(nowMs / 1000);
  const from = to - 2 * 24 * 60 * 60;
  const prices = env.calls.find((url) => url.includes("/tokens/prices/"));
  assert.equal(prices.includes("interval=DAY"), true);
  assert.equal(prices.includes(`from=${from}`), true);
  assert.equal(prices.includes(`to=${to}`), true);
  const balances = env.calls.find((url) => url.includes("/balances"));
  assert.equal(balances.includes("account.id=0.0.98"), true);
  const before = env.calls.length;
  await lookup.lookup(SAUCE);
  assert.equal(env.calls.length, before);
});

test("a failed stats read leaves that field null and still returns the token", async () => {
  const env = world({
    mirror: {
      [SAUCE]: mirrorRow(SAUCE, {
        decimals: "6",
        total_supply: "1000000",
        treasury_account_id: "0.0.98",
      }),
    },
    tokens: [{ id: SAUCE, dueDiligenceComplete: true }],
    pools: [{ tokenA: side(SAUCE), tokenB: side(WHBAR, { symbol: "HBAR" }) }],
    details: { [SAUCE]: { priceUsd: "nope" } },
    fail: (url) => url.includes("/balances") || url.includes("/tokens/prices/"),
  });
  const result = await lookupOf(env).lookup(SAUCE);
  assert.equal(result.status, 200);
  assert.equal(result.body.pool, true);
  assert.deepEqual(result.body.stats, {
    totalSupply: 1,
    circulating: null,
    liquidityUsd: null,
    marketCapUsd: null,
    priceUsd: null,
  });
});
