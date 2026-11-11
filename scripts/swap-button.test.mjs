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
  associationMirrorPaths,
  swapNotice,
  swapOfferFromProfile,
  swapReturnTarget,
  swapSuccessToast,
  swapTabbables,
  swapTabDestination,
  swapTabWrap,
  widgetCallData,
  widgetEntityId,
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

test("the association warning stays quiet when the token is associated, slots are free, or the read is unknown", () => {
  const quiet = { associated: false, count: 0 };
  assert.equal(associationCutWarning({ ...quiet, max: -1 }), "");
  assert.equal(associationCutWarning({ ...quiet, max: "-1" }), "");
  assert.equal(associationCutWarning({ max: 0, associated: true, count: 0 }), "");
  assert.equal(associationCutWarning({ max: 10, associated: false, count: 3 }), "");
  assert.equal(associationCutWarning({ max: "10", associated: false, count: "9" }), "");
  assert.equal(associationCutWarning({ max: null, associated: false, count: 0 }), "");
  assert.equal(associationCutWarning({ max: 10, associated: null, count: 10 }), "");
  assert.equal(associationCutWarning({ max: 10, associated: false, count: null }), "");
  assert.equal(associationCutWarning({ max: 1.5, associated: false, count: 0 }), "");
  assert.equal(associationCutWarning(), "");

  assert.equal(associationCutWarning({ max: 0, associated: false, count: 0 }), ASSOCIATION_CUT_WARNING);
  assert.equal(associationCutWarning({ max: "0", associated: false, count: 0 }), ASSOCIATION_CUT_WARNING);
  assert.equal(associationCutWarning({ max: 10, associated: false, count: 10 }), ASSOCIATION_CUT_WARNING);
  assert.equal(associationCutWarning({ max: "10", associated: false, count: "10" }), ASSOCIATION_CUT_WARNING);
  assert.equal(associationCutWarning({ max: 10, associated: false, count: 11 }), ASSOCIATION_CUT_WARNING);

  const paths = associationMirrorPaths("0.0.200-abc", SAUCE);
  assert.equal(paths.account, "/api/v1/accounts/0.0.200");
  assert.equal(paths.token, "/api/v1/accounts/0.0.200/tokens?token.id=0.0.731861&limit=1");
  assert.equal(paths.list, "/api/v1/accounts/0.0.200/tokens?limit=100");
  assert.equal(associationMirrorPaths("", SAUCE), null);
});

test("a successful swap toasts the transaction id and a HashScan link", () => {
  assert.deepEqual(swapSuccessToast(null), { text: "Swap sent", id: "", href: "" });
  assert.deepEqual(swapSuccessToast({}), { text: "Swap sent", id: "", href: "" });
  assert.deepEqual(swapSuccessToast({ transactionId: "  " }), { text: "Swap sent", id: "", href: "" });
  const id = "0.0.100@1780000000.000000000";
  assert.deepEqual(swapSuccessToast({ transactionId: " " + id + " " }), {
    text: "Swap sent",
    id,
    href: "https://hashscan.io/mainnet/transaction/" + encodeURIComponent(id),
  });
});

test("Tab stays in the dialog and focus returns to the control that opened it", () => {
  const close = { disabled: false, hidden: false, tabIndex: 0, classList: { contains() { return false; } }, shadowRoot: null };
  const inner = { disabled: false, hidden: false, tabIndex: 0, classList: { contains() { return false; } }, shadowRoot: null };
  const widget = {
    disabled: false,
    hidden: false,
    tabIndex: -1,
    classList: { contains() { return false; } },
    shadowRoot: { querySelectorAll() { return [inner]; } },
  };
  const trap = {
    disabled: false,
    hidden: false,
    tabIndex: 0,
    classList: { contains(name) { return name === "swap-trap"; } },
    shadowRoot: null,
  };
  const root = { querySelectorAll() { return [trap, close, widget]; } };
  assert.deepEqual(swapTabbables(root), [close, inner]);
  assert.equal(swapTabWrap([close, inner], close, false), null);
  assert.equal(swapTabWrap([close, inner], inner, false), close);
  assert.equal(swapTabWrap([close, inner], close, true), inner);
  assert.equal(swapTabWrap([close, inner], inner, true), null);
  assert.equal(swapTabDestination([close], close, false, true), null);
  assert.equal(swapTabDestination([close], close, true, true), null);
  assert.equal(swapTabDestination([close, inner], inner, false, false), close);

  const visible = { hidden: false, parentElement: null, disabled: false, isConnected: true };
  assert.equal(swapReturnTarget(visible), visible);
  assert.equal(swapReturnTarget({ isConnected: false }), null);
  const trigger = { hidden: false, parentElement: null, disabled: false, isConnected: true };
  const menu = {
    hidden: false,
    parentElement: null,
    querySelector(sel) { return sel === ".post-menu-btn" ? trigger : null; },
  };
  const pop = { hidden: true, parentElement: menu, disabled: false, isConnected: true };
  const item = {
    hidden: false,
    parentElement: pop,
    disabled: false,
    isConnected: true,
    closest(sel) { return sel === ".post-menu" ? menu : null; },
  };
  assert.equal(swapReturnTarget(item), trigger);
  const hiddenSheet = { hidden: true, parentElement: null };
  const donateSwap = {
    hidden: false,
    parentElement: hiddenSheet,
    disabled: false,
    isConnected: true,
    closest() { return null; },
  };
  assert.equal(swapReturnTarget(donateSwap), null);
});

test("widget addresses become Hedera ids and calldata stays bytes", () => {
  assert.equal(widgetEntityId("0.0.731861"), SAUCE);
  assert.equal(widgetEntityId("hedera:mainnet:0.0.731861"), SAUCE);
  assert.equal(widgetEntityId("0x0df73542cc68bdc01b361d231c60f726b0e0bc05"), "0.0.10495847");
  const sauceHex = "0x" + (731861).toString(16).padStart(40, "0");
  assert.equal(widgetEntityId(sauceHex), SAUCE);
  assert.equal(widgetEntityId("0xabc"), "");
  assert.deepEqual([...widgetCallData("0xabcd")], [0xab, 0xcd]);
  assert.equal(widgetCallData("").length, 0);
  assert.equal(widgetCallData("0xzz"), null);
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
  const wallet = fs.readFileSync(new URL("../swapwallet.js", import.meta.url), "utf8");
  const rest = fs.readFileSync(new URL("../rest.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.equal(sheet.includes("/api/donations"), false);
  assert.equal(offer.includes("/api/donations"), false);
  assert.equal(wallet.includes("/api/donations"), false);
  assert.match(sheet, /loadWidgetScript\(\)/);
  assert.match(sheet, /mountSwapWidgetScript\(document\)/);
  assert.match(sheet, /swap-success/);
  assert.match(sheet, /swapSuccessToast\(event && event\.detail\)/);
  assert.match(sheet, /externalWallet/);
  assert.match(sheet, /walletconnect-request/);
  assert.match(sheet, /swapReturnTarget/);
  assert.match(sheet, /swap-trap/);
  assert.match(sheet, /globeSwapWallet/);
  assert.match(wallet, /signer\.call/);
  assert.match(wallet, /isEvm: false/);
  assert.match(rest, /associationMirrorPaths/);
  assert.match(rest, /associationCutWarning\(\{ max, associated, count \}\)/);
  const donateSwap = css.slice(css.indexOf(".donate-swap {"), css.indexOf(".donate-swap[hidden]"));
  assert.equal(donateSwap.includes("px"), false);
  assert.match(donateSwap, /border-radius: 999dvh/);
  const menu = fs.readFileSync(new URL("../postmenu.js", import.meta.url), "utf8");
  const donations = fs.readFileSync(new URL("../donations.js", import.meta.url), "utf8");
  assert.match(menu, /post-menu-swap/);
  assert.match(menu, /swapItem\.hidden = own \|\| !swapReady/);
  assert.match(menu, /opener: swapItem/);
  assert.match(donations, /donate-swap/);
  assert.match(donations, /openSwapSheet\(/);
});
