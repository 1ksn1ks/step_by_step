import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { createSwapTokenLookup, isHbarSide, readSaucerLists, swapTokenRoute, WHBAR_TOKEN_IDS } from "../server/swaptoken.js";

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
  return {
    token_id: id,
    name: extra.name ?? "Sauce",
    symbol: extra.symbol ?? "SAUCE",
    decimals: extra.decimals ?? "6",
    type: "FUNGIBLE_COMMON",
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
    fail: options.fail || null,
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    if (state.fail && state.fail(url)) return jsonResponse(503, {});
    if (url.includes("/api/v1/tokens/")) {
      const id = decodeURIComponent(url.split("/api/v1/tokens/")[1]);
      const row = state.mirror[id];
      if (!row) return jsonResponse(404, { _status: { messages: [{ message: "Not found" }] } });
      return jsonResponse(200, row);
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

test("the server route uses the public rate limit", () => {
  const source = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(
    source,
    /app\.get\("\/api\/swap\/token\/:tokenId", publicPostLimit, swapTokenRoute\(swapTokenLookup\)\)/
  );
});
