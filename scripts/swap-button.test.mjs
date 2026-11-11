import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ASSOCIATION_CUT_WARNING,
  SWAP_WIDGET_SRC,
  associationCutWarning,
  fetchSwapToken,
  fillSwapWidget,
  mountSwapWidgetScript,
  resolveSwapButton,
  swapButtonShows,
  swapNotice,
  swapOfferFromProfile,
  swapWidgetConfig,
} from "../swapoffer.js";

const AUTHOR = "0.0.200";
const VIEWER = "0.0.100";
const SAUCE = "0.0.731861";
const ON = { enabled: true, tokenId: SAUCE, feeBps: 40 };

function isolated() {
  return { cache: new Map(), flights: new Map() };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function tokenFetch(body, status = 200) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (status === 0) throw new Error("network");
    return jsonResponse(status, body);
  };
  return { fetchImpl, calls };
}

test("Swap stays hidden when the profile is off or the token id is bad", async () => {
  const cases = [
    null,
    {},
    { enabled: false, tokenId: SAUCE, feeBps: 0 },
    { enabled: true, tokenId: "", feeBps: 0 },
    { enabled: true, tokenId: "hbar", feeBps: 0 },
    { enabled: true, tokenId: "0.0", feeBps: 0 },
  ];
  for (const swap of cases) {
    assert.equal(swapOfferFromProfile(swap), null);
    const { fetchImpl, calls } = tokenFetch({ pool: true });
    const result = await resolveSwapButton({
      author: AUTHOR,
      viewer: VIEWER,
      swap,
      fetchImpl,
      ...isolated(),
    });
    assert.equal(result.show, false);
    assert.equal(calls.length, 0);
  }
});

test("Swap stays hidden on your own post and does not ask the token route", async () => {
  const { fetchImpl, calls } = tokenFetch({ pool: true, symbol: "SAUCE" });
  const result = await resolveSwapButton({
    author: "0.0.200-abc",
    viewer: AUTHOR,
    swap: ON,
    fetchImpl,
    ...isolated(),
  });
  assert.equal(result.show, false);
  assert.equal(calls.length, 0);
  assert.equal(swapButtonShows({
    author: AUTHOR,
    viewer: "",
    offer: { tokenId: SAUCE, feeBps: 0 },
    token: { pool: true, tokenId: SAUCE },
  }), true);
});

test("Swap shows only when the token route says pool is true", async () => {
  const ready = tokenFetch({
    tokenId: SAUCE,
    symbol: "SAUCE",
    pool: true,
    dueDiligenceComplete: true,
  });
  const shown = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl: ready.fetchImpl,
    ...isolated(),
  });
  assert.equal(shown.show, true);
  assert.equal(shown.token.symbol, "SAUCE");
  assert.equal(ready.calls.length, 1);
  assert.equal(ready.calls[0], `/api/swap/token/${SAUCE}`);

  const none = tokenFetch({ tokenId: SAUCE, symbol: "SAUCE", pool: false, dueDiligenceComplete: false });
  const hidden = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: { enabled: true, tokenId: SAUCE, feeBps: 0 },
    fetchImpl: none.fetchImpl,
    ...isolated(),
  });
  assert.equal(hidden.show, false);
  assert.equal(hidden.token.pool, false);

  const missing = tokenFetch({ error: "not found" }, 404);
  const gone = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl: missing.fetchImpl,
    ...isolated(),
  });
  assert.equal(gone.show, false);
  assert.equal(gone.token, null);

  const down = tokenFetch(null, 0);
  const failed = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl: down.fetchImpl,
    ...isolated(),
  });
  assert.equal(failed.show, false);
  assert.equal(failed.token, null);
});

test("a pool flag that is not strictly true stays hidden", async () => {
  const { fetchImpl } = tokenFetch({ pool: "true", symbol: "SAUCE", tokenId: SAUCE });
  const result = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl,
    ...isolated(),
  });
  assert.equal(result.show, false);
});

test("a looked-up token that is not the profile token stays hidden", () => {
  assert.equal(swapButtonShows({
    author: AUTHOR,
    viewer: VIEWER,
    offer: { tokenId: SAUCE, feeBps: 40 },
    token: { pool: true, tokenId: "0.0.1" },
  }), false);
});

test("an unreviewed token still shows Swap", async () => {
  const { fetchImpl } = tokenFetch({
    tokenId: SAUCE,
    symbol: "SAUCE",
    pool: true,
    dueDiligenceComplete: false,
  });
  const result = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl,
    ...isolated(),
  });
  assert.equal(result.show, true);
  assert.equal(result.token.dueDiligenceComplete, false);
});

test("a not-connected viewer still sees Swap on someone else's post", async () => {
  const { fetchImpl, calls } = tokenFetch({ pool: true, symbol: "SAUCE", tokenId: SAUCE });
  const result = await resolveSwapButton({
    author: AUTHOR,
    viewer: null,
    swap: ON,
    fetchImpl,
    ...isolated(),
  });
  assert.equal(result.show, true);
  assert.equal(calls.length, 1);
});

test("the token answer is reused until it expires, and one flight is shared", async () => {
  let clock = 1_000;
  const { fetchImpl, calls } = tokenFetch({ pool: true, symbol: "SAUCE", tokenId: SAUCE });
  const opts = { fetchImpl, ...isolated(), now: () => clock, cacheMs: 1_000, backend: "" };
  const first = await resolveSwapButton({ author: AUTHOR, viewer: VIEWER, swap: ON, ...opts });
  const second = await resolveSwapButton({ author: AUTHOR, viewer: VIEWER, swap: ON, ...opts });
  assert.equal(first.show, true);
  assert.equal(second.show, true);
  assert.equal(calls.length, 1);
  clock += 1_001;
  await resolveSwapButton({ author: AUTHOR, viewer: VIEWER, swap: ON, ...opts });
  assert.equal(calls.length, 2);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let concurrent = 0;
  const slow = isolated();
  const fetchImplSlow = async () => {
    concurrent += 1;
    await gate;
    return jsonResponse(200, { pool: false, tokenId: SAUCE });
  };
  const left = fetchSwapToken(SAUCE, { fetchImpl: fetchImplSlow, ...slow });
  const right = fetchSwapToken(SAUCE, { fetchImpl: fetchImplSlow, ...slow });
  release();
  const rows = await Promise.all([left, right]);
  assert.equal(concurrent, 1);
  assert.equal(rows[0].pool, false);
  assert.equal(rows[1].pool, false);
});

test("a failed lookup is not cached", async () => {
  const opts = isolated();
  let fail = true;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (fail) throw new Error("network");
    return jsonResponse(200, { pool: true, tokenId: SAUCE, symbol: "SAUCE" });
  };
  const first = await fetchSwapToken(SAUCE, { fetchImpl, ...opts, cacheMs: 10_000, now: () => 1 });
  assert.equal(first, null);
  fail = false;
  const second = await fetchSwapToken(SAUCE, { fetchImpl, ...opts, cacheMs: 10_000, now: () => 2 });
  assert.equal(second.pool, true);
  assert.equal(calls.length, 2);
});

test("the notice names the token and adds the review line only when the flag is false", () => {
  assert.equal(
    swapNotice({ symbol: "SAUCE", tokenId: SAUCE, dueDiligenceComplete: true }),
    "You're buying SAUCE (0.0.731861), not donating. Tokens can lose value."
  );
  assert.equal(
    swapNotice({ symbol: "SAUCE", tokenId: SAUCE, dueDiligenceComplete: false }),
    "You're buying SAUCE (0.0.731861), not donating. Tokens can lose value. Not reviewed by SaucerSwap."
  );
  assert.equal(
    swapNotice({ symbol: "  ", tokenId: SAUCE, dueDiligenceComplete: true }),
    "You're buying this token (0.0.731861), not donating. Tokens can lose value."
  );
});

test("the widget is mainnet HBAR to the author's token, and the fee is set only above 0", () => {
  const projectId = "project-from-web3";
  const free = swapWidgetConfig({ projectId, tokenId: SAUCE, feeBps: 0, account: AUTHOR });
  assert.deepEqual(free, {
    network: "mainnet",
    projectId,
    inputToken: "0.0.0",
    outputToken: SAUCE,
    theme: "dark",
  });
  const paid = swapWidgetConfig({ projectId, tokenId: SAUCE, feeBps: 40, account: AUTHOR });
  assert.equal(paid.integratorFeeBps, 40);
  assert.equal(paid.integratorFeeRecipient, AUTHOR);

  const el = {
    attrs: new Map(),
    setAttribute(name, value) { this.attrs.set(name, String(value)); },
    removeAttribute(name) { this.attrs.delete(name); },
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; },
  };
  fillSwapWidget(el, paid);
  assert.equal(el.getAttribute("network"), "mainnet");
  assert.equal(el.getAttribute("project-id"), projectId);
  assert.equal(el.getAttribute("input-token"), "0.0.0");
  assert.equal(el.getAttribute("output-token"), SAUCE);
  assert.equal(el.getAttribute("theme"), "dark");
  assert.equal(el.getAttribute("integrator-fee-bps"), "40");
  assert.equal(el.getAttribute("integrator-fee-recipient"), AUTHOR);
  fillSwapWidget(el, free);
  assert.equal(el.getAttribute("integrator-fee-bps"), null);
  assert.equal(el.getAttribute("integrator-fee-recipient"), null);
  assert.equal(swapWidgetConfig({ projectId, tokenId: SAUCE, feeBps: 40, account: "" }).integratorFeeBps, undefined);
});

test("the association warning shows only when the mirror value is not unlimited", () => {
  assert.equal(associationCutWarning(-1), "");
  assert.equal(associationCutWarning("-1"), "");
  assert.equal(associationCutWarning(null), "");
  assert.equal(associationCutWarning(undefined), "");
  assert.equal(associationCutWarning(1.5), "");
  for (const max of [0, 10, "0", "10"]) {
    assert.equal(associationCutWarning(max), ASSOCIATION_CUT_WARNING);
  }
});

test("the widget script tag is created once and only from the sheet opener", () => {
  const nodes = [];
  const doc = {
    createElement() {
      return { type: "", src: "", async: false };
    },
    querySelector(selector) {
      assert.equal(selector, `script[src="${SWAP_WIDGET_SRC}"]`);
      return nodes.find((node) => node.src === SWAP_WIDGET_SRC) || null;
    },
    head: { appendChild(node) { nodes.push(node); } },
  };
  const first = mountSwapWidgetScript(doc);
  const second = mountSwapWidgetScript(doc);
  assert.equal(first, second);
  assert.equal(nodes.length, 1);
  assert.equal(first.type, "module");
  assert.equal(first.src, SWAP_WIDGET_SRC);
  assert.equal(first.async, true);

  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  const offer = fs.readFileSync(new URL("../swapoffer.js", import.meta.url), "utf8");
  assert.equal(sheet.includes("/api/donations"), false);
  assert.equal(offer.includes("/api/donations"), false);
  assert.match(sheet, /loadWidgetScript\(\)/);
  assert.match(sheet, /mountSwapWidgetScript\(document\)/);
  const menu = fs.readFileSync(new URL("../postmenu.js", import.meta.url), "utf8");
  const donations = fs.readFileSync(new URL("../donations.js", import.meta.url), "utf8");
  assert.match(menu, /post-menu-swap/);
  assert.match(menu, /swapItem\.hidden = own \|\| !swapReady/);
  assert.match(donations, /donate-swap/);
  assert.match(donations, /openSwapSheet\(/);
});
