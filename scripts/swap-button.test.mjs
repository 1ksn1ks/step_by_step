import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ASSOCIATION_CUT_WARNING,
  SWAP_WIDGET_SRC,
  associationCutWarning,
  fetchSwapToken,
  fillSwapWidget,
  formatSwapStat,
  swapCardWidth,
  swapColumnZoom,
  swapKeptLinks,
  swapPhoneColumnZoom,
  swapKeptStats,
  swapWidgetResizeNeedsFit,
  mountSwapWidgetScript,
  resolveSwapButton,
  swapButtonShows,
  associationMirrorPaths,
  swapBioText,
  swapFeeShare,
  swapSafetyLine,
  swapSheetText,
  swapOfferFromProfile,
  swapReturnTarget,
  swapSuccessToast,
  swapTabbables,
  swapTabDestination,
  swapTabWrap,
  widgetCallData,
  widgetEntityId,
  swapWidgetConfig,
  SWAP_MAINNET_NODES,
  prepareSwapContract,
  swapCappedFeeHbar,
  swapCappedFeeTinybars,
  swapGasLimit,
  swapAllowanceLong,
  swapPayableTinybars,
  swapApprovalToken,
  swapRouterId,
  swapSpenderId,
  createSwapSheetMotion,
  createSwapStats,
} from "../swapoffer.js";
import {
  AccountAllowanceApproveTransaction,
  AccountId,
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  TokenId,
  Transaction,
  TransactionId,
} from "@hiero-ledger/sdk";
import { swapProfileAction } from "../server/swapprofile.js";
import { foldSwapBio, swapBioAction, swapBioFromRow } from "../server/swapbio.js";

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

test("no Swap setting or a bad token id opens the default widget and does not ask the token route", async () => {
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
    assert.equal(result.show, true);
    assert.equal(result.offer, null);
    assert.equal(result.token, null);
    assert.equal(calls.length, 0);
  }
});

test("your own post uses your token without a cut, and no Swap setting stays the default widget", async () => {
  const { fetchImpl, calls } = tokenFetch({
    pool: true,
    symbol: "SAUCE",
    tokenId: SAUCE,
    dueDiligenceComplete: false,
    links: { website: "https://sauce.example", x: "javascript:alert(1)" },
  });
  const result = await resolveSwapButton({
    author: "0.0.200-abc",
    viewer: AUTHOR,
    swap: ON,
    fetchImpl,
    ...isolated(),
  });
  assert.equal(result.show, true);
  assert.equal(result.own, true);
  assert.deepEqual(result.offer, { tokenId: SAUCE, feeBps: 40 });
  assert.equal(result.token.symbol, "SAUCE");
  assert.equal(result.token.dueDiligenceComplete, false);
  assert.deepEqual(result.token.links, { website: "https://sauce.example" });
  assert.equal(calls.length, 1);
  assert.equal(swapSafetyLine({
    symbol: "SAUCE",
    tokenId: SAUCE,
    dueDiligenceComplete: false,
    feeBps: 0,
  }), "");
  assert.equal(swapSafetyLine({
    symbol: result.token.symbol,
    tokenId: result.offer.tokenId,
    dueDiligenceComplete: true,
    feeBps: 0,
  }), "");
  const config = swapWidgetConfig({
    projectId: "project-from-web3",
    tokenId: result.offer.tokenId,
    feeBps: 0,
    account: AUTHOR,
  });
  assert.equal(config.outputToken, SAUCE);
  assert.equal(config.integratorFeeBps, undefined);
  assert.equal(config.integratorFeeRecipient, undefined);
  assert.equal(swapButtonShows({
    author: AUTHOR,
    viewer: AUTHOR,
    offer: { tokenId: SAUCE, feeBps: 40 },
    token: { pool: true, tokenId: SAUCE },
  }), false);
  assert.equal(swapButtonShows({
    author: AUTHOR,
    viewer: "",
    offer: { tokenId: SAUCE, feeBps: 0 },
    token: { pool: true, tokenId: SAUCE },
  }), true);

  const off = tokenFetch({ pool: true, symbol: "SAUCE", tokenId: SAUCE });
  const plain = await resolveSwapButton({
    author: AUTHOR,
    viewer: AUTHOR,
    swap: { enabled: false, tokenId: SAUCE, feeBps: 40 },
    fetchImpl: off.fetchImpl,
    ...isolated(),
  });
  assert.equal(plain.show, true);
  assert.equal(plain.offer, null);
  assert.equal(plain.token, null);
  assert.equal(plain.own, false);
  assert.equal(off.calls.length, 0);

  const bad = tokenFetch({ pool: false, tokenId: SAUCE, symbol: "SAUCE" });
  const hidden = await resolveSwapButton({
    author: AUTHOR,
    viewer: AUTHOR,
    swap: ON,
    fetchImpl: bad.fetchImpl,
    ...isolated(),
  });
  assert.equal(hidden.offer, null);
  assert.equal(hidden.token, null);
  assert.equal(bad.calls.length, 1);

  const menu = fs.readFileSync(new URL("../postmenu.js", import.meta.url), "utf8");
  const donate = fs.readFileSync(new URL("../donations.js", import.meta.url), "utf8");
  assert.match(menu, /feeBps: creator && !swapReady\.own \? swapReady\.offer\.feeBps : 0/);
  assert.match(donate, /feeBps: creator && !result\.own \? result\.offer\.feeBps : 0/);
});

test("a real pool uses the author's token, and any other token answer opens the default widget", async () => {
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
  assert.equal(hidden.show, true);
  assert.equal(hidden.offer, null);
  assert.equal(hidden.token, null);

  const missing = tokenFetch({ error: "not found" }, 404);
  const gone = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl: missing.fetchImpl,
    ...isolated(),
  });
  assert.equal(gone.show, true);
  assert.equal(gone.offer, null);
  assert.equal(gone.token, null);

  const down = tokenFetch(null, 0);
  const failed = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl: down.fetchImpl,
    ...isolated(),
  });
  assert.equal(failed.show, true);
  assert.equal(failed.offer, null);
  assert.equal(failed.token, null);
});

test("a pool flag that is not strictly true opens the default widget", async () => {
  const { fetchImpl } = tokenFetch({ pool: "true", symbol: "SAUCE", tokenId: SAUCE });
  const result = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl,
    ...isolated(),
  });
  assert.equal(result.show, true);
  assert.equal(result.offer, null);
  assert.equal(result.token, null);
});

test("a looked-up token that is not the profile token opens the default widget", async () => {
  assert.equal(swapButtonShows({
    author: AUTHOR,
    viewer: VIEWER,
    offer: { tokenId: SAUCE, feeBps: 40 },
    token: { pool: true, tokenId: "0.0.1" },
  }), false);
  const { fetchImpl } = tokenFetch({ pool: true, symbol: "OTHER", tokenId: "0.0.1" });
  const result = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl,
    ...isolated(),
  });
  assert.equal(result.show, true);
  assert.equal(result.offer, null);
  assert.equal(result.token, null);
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

test("the sheet shows no notice row without a cut and only the fee line with a cut", () => {
  assert.equal(swapSafetyLine({ symbol: "SAUCE", tokenId: SAUCE, dueDiligenceComplete: false, feeBps: 0 }), "");
  assert.equal(swapSafetyLine({ symbol: "SAUCE", tokenId: SAUCE, feeBps: 40 }), "0.4% goes to the poster.");
  assert.equal(swapSheetText({
    bio: "Buying the poster token.",
    symbol: "SAUCE",
    tokenId: "",
    feeBps: 40,
  }).safety, "");
  const cut = swapSheetText({
    bio: "Buying the poster token.",
    symbol: "SAUCE",
    tokenId: SAUCE,
    dueDiligenceComplete: false,
    feeBps: 40,
  });
  assert.equal(cut.safety, "0.4% goes to the poster.");
  assert.equal(cut.safety.includes("buying"), false);
  assert.equal(cut.safety.includes("Not reviewed"), false);
  assert.equal(swapSheetText({
    symbol: "SAUCE",
    tokenId: SAUCE,
    dueDiligenceComplete: false,
    feeBps: 0,
  }).safety, "");

  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  const offer = fs.readFileSync(new URL("../swapoffer.js", import.meta.url), "utf8");
  assert.match(sheet, /column\.append\(token, stats, bio, error, slot\)/);
  assert.match(sheet, /if \(!lines\.safety\) \{\s*if \(noteRow\) noteRow\.remove\(\)/);
  assert.match(sheet, /note\.textContent = lines\.safety/);
  assert.match(sheet, /errorSlot\.before\(noteRow\)/);
  assert.equal(sheet.includes("You're buying"), false);
  assert.equal(sheet.includes("Not reviewed by SaucerSwap."), false);
  assert.equal(offer.includes("You're buying"), false);
  assert.equal(offer.includes("Not reviewed by SaucerSwap."), false);
  assert.equal(offer.includes("DEFAULT_SAFETY"), false);
  assert.equal(offer.includes("function swapNotice"), false);
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
    themeAccent: "#22D3EE",
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
  assert.equal(el.getAttribute("theme-accent"), "#22D3EE");
  assert.equal(el.getAttribute("integrator-fee-bps"), "40");
  assert.equal(el.getAttribute("integrator-fee-recipient"), AUTHOR);
  fillSwapWidget(el, free);
  assert.equal(el.getAttribute("integrator-fee-bps"), null);
  assert.equal(el.getAttribute("integrator-fee-recipient"), null);
  assert.equal(swapWidgetConfig({ projectId, tokenId: SAUCE, feeBps: 40, account: "" }).integratorFeeBps, undefined);

  const defaults = swapWidgetConfig({ projectId, tokenId: "", feeBps: 40, account: AUTHOR });
  assert.equal(defaults.inputToken, "0.0.0");
  assert.equal(defaults.themeAccent, "#22D3EE");
  assert.equal(defaults.outputToken, undefined);
  assert.equal(defaults.integratorFeeBps, undefined);
  assert.equal(defaults.integratorFeeRecipient, undefined);
  fillSwapWidget(el, defaults);
  assert.equal(el.getAttribute("input-token"), "0.0.0");
  assert.equal(el.getAttribute("theme-accent"), "#22D3EE");
  assert.equal(el.getAttribute("output-token"), null);
  assert.equal(el.getAttribute("integrator-fee-bps"), null);
  assert.equal(el.getAttribute("integrator-fee-recipient"), null);
  assert.equal(swapSheetText({ bio: "Buying the poster token.", symbol: "SAUCE", tokenId: "", feeBps: 40 }).bio, "");
  assert.equal(swapSheetText({ bio: "Buying the poster token.", symbol: "SAUCE", tokenId: "", feeBps: 40 }).safety, "");
  assert.equal(swapSafetyLine({ symbol: "SAUCE", tokenId: "", feeBps: 40 }), "");
  assert.equal(swapSafetyLine({}), "");
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
  assert.match(menu, /let swapReady = \{ show: true, offer: null, token: null \}/);
  assert.match(menu, /swapItem\.hidden = !swapReady/);
  assert.match(menu, /setTimeout\(resolve, 1500\)/);
  assert.match(menu, /opener: swapItem/);
  assert.match(donations, /donate-swap/);
  assert.match(donations, /openSwapSheet\(/);
  assert.match(donations, /swapBtn\.hidden = false/);
  assert.match(donations, /setTimeout\(resolve, 1500\)/);
});

const UNIVERSAL = "0.0.10628061";
const UNIVERSAL_EVM = "0x0000000000000000000000000000000000a22bdd";
const ROUTER = "0.0.10495847";
const ROUTER_EVM = "0x0df73542cc68bdc01b361d231c60f726b0e0bc05";
const AMOUNT_ERROR = /Swap amount could not be read/;
const CONTRACT_ERROR = /Swap contract not allowed/;

test("a swap amount is a bigint, an integer, or a decimal string", () => {
  assert.equal(swapPayableTinybars(undefined), null);
  assert.equal(swapPayableTinybars(null), null);
  assert.equal(swapPayableTinybars(0n), null);
  assert.equal(swapPayableTinybars(0), null);
  assert.equal(swapPayableTinybars("0"), null);
  assert.equal(swapPayableTinybars(150n), 150n);
  assert.equal(swapPayableTinybars(150), 150n);
  assert.equal(swapPayableTinybars("150"), 150n);
  assert.equal(swapPayableTinybars(" 150 "), 150n);
  const wide = 9007199254740993n;
  assert.equal(swapPayableTinybars(wide), wide);
  assert.equal(swapPayableTinybars(wide.toString()), wide);
  for (const bad of ["", "   ", "1.5", "0x10", "01", "+15", "-1", "1e2", true, 1.5, -1, -1n, 2 ** 53, {}, [], "9007199254740993.0"]) {
    assert.throws(() => swapPayableTinybars(bad), AMOUNT_ERROR);
  }
  assert.throws(() => swapPayableTinybars(9223372036854775808n), AMOUNT_ERROR);

  const prepared = prepareSwapContract({
    to: UNIVERSAL,
    data: "0xabcd",
    valueTinybar: wide.toString(),
  });
  assert.equal(prepared.contractId, UNIVERSAL);
  assert.equal(prepared.payableTinybars, wide);
  const tx = new ContractExecuteTransaction()
    .setPayableAmount(Hbar.fromTinybars(prepared.payableTinybars.toString()));
  assert.equal(tx.payableAmount.toTinybars().toString(), wide.toString());

  const zero = prepareSwapContract({ to: UNIVERSAL_EVM, data: "0x", valueTinybar: 0n });
  assert.equal(zero.contractId, UNIVERSAL);
  assert.equal(zero.payableTinybars, null);
  assert.throws(() => prepareSwapContract({
    to: UNIVERSAL,
    data: "0xabcd",
    valueTinybar: "nope",
  }), AMOUNT_ERROR);

  const wallet = fs.readFileSync(new URL("../swapwallet.js", import.meta.url), "utf8");
  assert.match(wallet, /prepareSwapContract\(call\)/);
  assert.match(wallet, /prepared\.payableTinybars != null/);
  assert.match(wallet, /Hbar\.fromTinybars\(prepared\.payableTinybars\.toString\(\)\)/);
  assert.equal(wallet.includes('typeof call.valueTinybar === "bigint"'), false);
});

test("the swap fee stays at or below 10 HBAR and gas stays within the cap", () => {
  assert.equal(swapGasLimit(1), 1);
  assert.equal(swapGasLimit(1200000), 1200000);
  assert.equal(swapGasLimit(3000000), 3000000);
  for (const bad of [0, -1, 1.5, 3000001, 2 ** 53, "1200000", null, undefined, true]) {
    assert.equal(swapGasLimit(bad), 1200000);
  }
  const prepared = prepareSwapContract({ to: UNIVERSAL, data: "0xab", gasLimit: 2500000 });
  assert.equal(prepared.gasLimit, 2500000);
  assert.equal(prepareSwapContract({ to: UNIVERSAL, data: "0xab", gasLimit: 9000000 }).gasLimit, 1200000);
  assert.equal(prepareSwapContract({ to: UNIVERSAL, data: "0xab" }).gasLimit, 1200000);

  assert.equal(swapCappedFeeHbar(4), 4);
  assert.equal(swapCappedFeeHbar(10), 10);
  assert.equal(swapCappedFeeHbar(25), 10);
  assert.equal(swapCappedFeeHbar(0), 0);
  assert.equal(swapCappedFeeHbar(-1), null);
  assert.equal(swapCappedFeeHbar(Number.POSITIVE_INFINITY), null);
  assert.equal(swapCappedFeeHbar("10"), null);

  const cap = 1000000000n;
  const over = BigInt(new Hbar(25).toTinybars().toString());
  const under = BigInt(new Hbar(2).toTinybars().toString());
  assert.equal(swapCappedFeeTinybars(over), cap);
  assert.equal(swapCappedFeeTinybars(under), 200000000n);
  assert.equal(swapCappedFeeTinybars(cap), cap);
  assert.equal(swapCappedFeeTinybars(-1n), null);
  assert.equal(Hbar.fromTinybars(swapCappedFeeTinybars(over).toString()).toTinybars().toString(), cap.toString());

  const wallet = fs.readFileSync(new URL("../swapwallet.js", import.meta.url), "utf8");
  assert.match(wallet, /supplied instanceof Hbar/);
  assert.match(wallet, /swapCappedFeeTinybars\(tiny\)/);
  assert.match(wallet, /Hbar\.fromTinybars\(capped\.toString\(\)\)/);
  assert.match(wallet, /swapCappedFeeHbar\(supplied\)/);
  assert.match(wallet, /new Hbar\(capped\)/);
  assert.equal(wallet.includes("return request.maxTransactionFee"), false);
});

test("a swap contract call is limited to the widget routers", () => {
  assert.equal(swapRouterId(ROUTER), ROUTER);
  assert.equal(swapRouterId(ROUTER_EVM), ROUTER);
  assert.equal(swapRouterId("hedera:mainnet:" + ROUTER), ROUTER);
  assert.equal(swapRouterId(UNIVERSAL), UNIVERSAL);
  assert.equal(swapRouterId(UNIVERSAL_EVM), UNIVERSAL);
  assert.equal(swapRouterId("hedera:mainnet:" + UNIVERSAL_EVM), UNIVERSAL);
  assert.equal(swapRouterId(""), "");
  assert.equal(swapRouterId(null), "");
  for (const blocked of [
    "0.0.3045981",
    "0.0.3949434",
    "0.0.6755814",
    "0.0.10527448",
    "0.0.731861",
    "0x8d53a86b10b503f284a0ea9e8316bc6081432a96",
    "0xabc",
    "hedera:testnet:" + UNIVERSAL,
  ]) {
    assert.throws(() => swapRouterId(blocked), CONTRACT_ERROR);
  }
  assert.throws(() => prepareSwapContract({ to: "0.0.3", data: "0xab", valueTinybar: 1n }), CONTRACT_ERROR);
  assert.throws(() => prepareSwapContract({ to: "", data: "0xab" }), /Swap transaction could not be built/);
  assert.equal(prepareSwapContract({ to: ROUTER_EVM, data: "0xab" }).contractId, ROUTER);

  const wallet = fs.readFileSync(new URL("../swapwallet.js", import.meta.url), "utf8");
  assert.equal(wallet.includes("fromEvmAddress"), false);
});

test("an approval spender is a SaucerSwap router, and the token is the creator's", () => {
  assert.equal(swapSpenderId(ROUTER), ROUTER);
  assert.equal(swapSpenderId(ROUTER_EVM), ROUTER);
  assert.equal(swapSpenderId("hedera:mainnet:" + UNIVERSAL), UNIVERSAL);
  assert.equal(swapSpenderId(UNIVERSAL_EVM), UNIVERSAL);
  assert.throws(() => swapSpenderId("0.0.10527448"), /Swap spender not allowed/);
  assert.throws(() => swapSpenderId("0.0.731861"), /Swap spender not allowed/);
  assert.throws(() => swapSpenderId("hedera:testnet:" + UNIVERSAL), /Swap spender not allowed/);
  assert.throws(() => swapSpenderId(""), /Swap spender not allowed/);

  assert.equal(swapApprovalToken(SAUCE, SAUCE), SAUCE);
  assert.equal(swapApprovalToken(SAUCE, "hedera:mainnet:" + SAUCE), SAUCE);
  assert.throws(() => swapApprovalToken(SAUCE, "0.0.0"), /Swap token not allowed/);
  assert.throws(() => swapApprovalToken(SAUCE, "hedera:testnet:" + SAUCE), /Swap token not allowed/);
  assert.equal(swapApprovalToken("", SAUCE), SAUCE);
  assert.equal(swapApprovalToken(null, "hedera:mainnet:" + SAUCE), SAUCE);
  assert.throws(() => swapApprovalToken("", ""), /Swap token not allowed/);
  assert.throws(() => swapApprovalToken("", "0xabc"), /Swap token not allowed/);
  assert.throws(() => swapApprovalToken("", "hedera:testnet:" + SAUCE), /Swap token not allowed/);

  const wallet = fs.readFileSync(new URL("../swapwallet.js", import.meta.url), "utf8");
  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  assert.match(wallet, /swapSpenderId\(spenderId\)/);
  assert.match(wallet, /swapApprovalToken\(configuredToken, tokenId\)/);
  assert.match(wallet, /approve\(outputToken, tokenId, spenderId, amount, onStatusChange\)/);
  assert.match(sheet, /globeSwapWallet\(config\.outputToken\)/);
});

test("an allowance bigint round-trips as the SDK Long", () => {
  const amount = 9007199254740993n;
  const long = swapAllowanceLong(amount);
  assert.equal(long.toString(), amount.toString());
  const tx = new AccountAllowanceApproveTransaction().approveTokenAllowance(
    TokenId.fromString(SAUCE),
    AccountId.fromString(VIEWER),
    AccountId.fromString(ROUTER),
    long,
  );
  assert.equal(tx.tokenApprovals.length, 1);
  assert.equal(tx.tokenApprovals[0].amount.toString(), amount.toString());
  assert.throws(() => swapAllowanceLong(0n), /Allowance amount must be greater than zero/);
  assert.throws(() => swapAllowanceLong(-1n), /Allowance amount must be greater than zero/);
  assert.throws(() => swapAllowanceLong(1), /Allowance amount must be greater than zero/);
  const overflow = 9223372036854775808n;
  assert.throws(() => swapAllowanceLong(overflow), /Allowance amount must be greater than zero/);

  const wallet = fs.readFileSync(new URL("../swapwallet.js", import.meta.url), "utf8");
  assert.match(wallet, /swapAllowanceLong\(amount, balance\)/);
  assert.match(wallet, /approveTokenAllowance\(TokenId\.fromString\(token\), AccountId\.fromString\(session\.id\), AccountId\.fromString\(spender\), allowance\)/);
});

test("the default widget and the creator token refuse an oversized or max allowance", () => {
  const max256 = (1n << 256n) - 1n;
  const max64 = (1n << 63n) - 1n;
  assert.throws(() => swapAllowanceLong(5n, 4n), /Allowance is larger than the token balance/);
  assert.throws(() => swapAllowanceLong(max256, max256), /Allowance amount is not allowed/);
  assert.throws(() => swapAllowanceLong(max64, max64), /Allowance amount is not allowed/);
  assert.equal(swapAllowanceLong(5n, 5n).toString(), "5");
  assert.equal(swapAllowanceLong(5n, 9n).toString(), "5");
  assert.equal(swapAllowanceLong(max64).toString(), max64.toString());

  const wallet = fs.readFileSync(new URL("../swapwallet.js", import.meta.url), "utf8");
  const approveFn = wallet.slice(wallet.indexOf("async function approve"), wallet.indexOf("export function globeSwapWallet"));
  assert.match(approveFn, /swapSpenderId\(spenderId\)/);
  assert.match(approveFn, /swapApprovalToken\(configuredToken, tokenId\)/);
  assert.match(approveFn, /const balance = await mirrorTokenBalance\(session\.id, token\)/);
  assert.match(approveFn, /const allowance = swapAllowanceLong\(amount, balance\)/);
  assert.equal(/swapAllowanceLong\(amount\)/.test(approveFn), false);
  assert.match(wallet, /https:\/\/mainnet\.mirrornode\.hedera\.com/);
});

test("a frozen swap lists several mainnet nodes", () => {
  assert.deepEqual(SWAP_MAINNET_NODES, ["0.0.3", "0.0.4", "0.0.6"]);
  const tx = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(UNIVERSAL))
    .setGas(1200000)
    .setFunctionParameters(new Uint8Array([0xab]))
    .setTransactionId(TransactionId.generate(AccountId.fromString(VIEWER)))
    .setNodeAccountIds(SWAP_MAINNET_NODES.map((id) => AccountId.fromString(id)))
    .setPayableAmount(Hbar.fromTinybars("100"));
  tx.freeze();
  const parsed = Transaction.fromBytes(tx.toBytes());
  assert.deepEqual(parsed.nodeAccountIds.map((id) => id.toString()), SWAP_MAINNET_NODES);
  assert.equal(parsed.contractId.toString(), UNIVERSAL);
  assert.equal(parsed.payableAmount.toTinybars().toString(), "100");

  const wallet = fs.readFileSync(new URL("../swapwallet.js", import.meta.url), "utf8");
  assert.match(wallet, /SWAP_MAINNET_NODES\.map\(\(id\) => AccountId\.fromString\(id\)\)/);
  assert.equal(wallet.includes('AccountId.fromString("0.0.3")'), false);
});

test("the post menu lists Copy link, Follow user, Swap tokens, then Donate HBAR", () => {
  const menu = fs.readFileSync(new URL("../postmenu.js", import.meta.url), "utf8");
  const appended = menu.match(/pop\.append\(([^)]+)\)/);
  assert.ok(appended);
  assert.equal(appended[1], "copyItem, followItem, swapItem, donateItem");
  assert.match(menu, /menuItem\('post-menu-copy', 'Copy link'\)/);
  assert.match(menu, /menuItem\('post-menu-follow', 'Follow user'\)/);
  assert.match(menu, /menuItem\('post-menu-swap', 'Swap tokens'\)/);
  assert.match(menu, /menuItem\('post-menu-donate', ''\)/);
  assert.match(menu, /donateLabel\.textContent = 'Donate HBAR'/);
  assert.match(menu, /donateAmount\.className = 'donate-amount'/);
  assert.match(menu, /'Unfollow user' : 'Follow user'/);
  assert.match(menu, /followItem\.hidden = !followBtn \|\| own/);
  assert.match(menu, /donateItem\.hidden = own \|\| !canDonate/);
  assert.match(menu, /let swapReady = \{ show: true, offer: null, token: null \}/);
  assert.match(menu, /swapItem\.hidden = !swapReady/);
  assert.match(menu, /setTimeout\(resolve, 1500\)/);
});

test("a second tap while the token lookup is waiting does not open another sheet", () => {
  const menu = fs.readFileSync(new URL("../postmenu.js", import.meta.url), "utf8");
  const donations = fs.readFileSync(new URL("../donations.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const openSwap = menu.slice(menu.indexOf("async function openSwapItem"), menu.indexOf("pick(swapItem"));
  assert.match(openSwap, /if \(swapOpening\) return/);
  assert.match(openSwap, /swapItem\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(openSwap, /swapItem\.removeAttribute\('aria-busy'\)/);
  assert.equal(openSwap.split("openSwapSheet(").length - 1, 1);
  const openDonate = donations.slice(donations.indexOf("function openDonateSwap"), donations.indexOf("async function loadDonateSwap"));
  assert.match(openDonate, /if \(sheetBusy \|\| !donateSwap \|\| donateSwapOpening\) return/);
  assert.match(openDonate, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(openDonate, /removeAttribute\('aria-busy'\)/);
  assert.equal(openDonate.split("openSwapSheet(").length - 1, 1);
  const menuBusy = css.slice(css.indexOf('.post-menu-item[aria-busy="true"]'), css.indexOf("  .post-menu-label {"));
  assert.match(menuBusy, /opacity: 0\.6/);
  assert.match(menuBusy, /cursor: wait/);
  assert.equal(menuBusy.includes("px"), false);
  const donateBusy = css.slice(css.indexOf('.donate-swap[aria-busy="true"]'), css.indexOf("  .donate-done {"));
  assert.match(donateBusy, /opacity: 0\.6/);
  assert.match(donateBusy, /cursor: wait/);
  assert.equal(donateBusy.includes("px"), false);
});

test("a swap bio folds into its own column and stops at 280 characters", () => {
  const note = "Buying the poster token.";
  assert.equal(swapBioAction({ swap: { enabled: true, tokenId: SAUCE, feeBps: 40 } }), null);
  assert.equal(swapProfileAction({ swapBio: note }), null);
  assert.deepEqual(swapBioAction({ swapBio: note }), { text: note });
  assert.deepEqual(swapBioAction({ swapBio: "" }), { text: "" });
  assert.deepEqual(swapBioAction({ swapBio: "a".repeat(280) }), { text: "a".repeat(280) });
  assert.deepEqual(swapBioAction({ swapBio: "a".repeat(281) }), { error: "length" });
  assert.deepEqual(swapBioAction({ swapBio: 12 }), { error: "swapBio" });

  const swapRow = { account_id: AUTHOR, swap_on: 1, swap_token: SAUCE, swap_fee: 40, swap_bio: null };
  const ignored = foldSwapBio(swapRow, { swap: { enabled: true, tokenId: SAUCE, feeBps: 40 } });
  assert.equal(ignored.wrote, false);
  assert.equal(ignored.row.swap_on, 1);
  assert.equal(ignored.row.swap_token, SAUCE);

  const saved = foldSwapBio(swapRow, { swapBio: note });
  assert.equal(saved.wrote, true);
  assert.equal(saved.row.swap_bio, note);
  assert.equal(saved.row.swap_fee, 40);
  assert.equal(swapBioFromRow(saved.row), note);
  assert.equal(foldSwapBio(saved.row, { swapBio: note }).wrote, false);

  const cleared = foldSwapBio(saved.row, { swapBio: "" });
  assert.equal(cleared.wrote, true);
  assert.equal(cleared.row.swap_bio, "");
  assert.equal(swapBioFromRow(cleared.row), "");
  assert.equal(foldSwapBio({ swap_bio: null }, { swapBio: "" }).wrote, false);
  assert.equal(foldSwapBio(null, { swapBio: "" }).wrote, false);
  assert.equal(foldSwapBio(saved.row, { swapBio: "a".repeat(281) }).wrote, false);
  assert.equal(foldSwapBio(saved.row, { swapBio: "a".repeat(281) }).row.swap_bio, note);

  const server = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(server, /ADD COLUMN swap_bio TEXT/);
  assert.match(server, /settingSwapBio/);
  assert.match(server, /saveSwapBio\(payer, swapBio\.text, tsMs\)/);
  assert.match(server, /swapBio: swapBioFromRow\(row\)/);
  const cache = fs.readFileSync(new URL("../settingscache.js", import.meta.url), "utf8");
  assert.match(cache, /swapBio: typeof row\.swapBio === "string" \? row\.swapBio : ""/);
});

test("creator token links stay https on the way to the sheet", async () => {
  assert.deepEqual(swapKeptLinks({
    website: " https://sauce.example ",
    x: "https://twitter.com/gib_plz",
    telegram: "https://t.me/sauce",
    discord: "https://discord.com/invite/sauce",
  }), {
    website: "https://sauce.example",
    x: "https://x.com/gib_plz",
  });
  assert.deepEqual(swapKeptLinks("@sauce"), {});
  assert.deepEqual(swapKeptLinks(null), {});

  const { fetchImpl } = tokenFetch({
    tokenId: SAUCE,
    symbol: "SAUCE",
    pool: true,
    links: {
      website: "https://www.gib.news/",
      x: "https://twitter.com/gib_plz",
      telegram: "https://t.me/sauce",
      discord: "https://discord.com/invite/sauce",
    },
    icon: " https://cdn.example/sauce.png ",
  });
  const result = await resolveSwapButton({
    author: AUTHOR,
    viewer: VIEWER,
    swap: ON,
    fetchImpl,
    ...isolated(),
  });
  assert.deepEqual(result.token.links, {
    website: "https://www.gib.news/",
    x: "https://x.com/gib_plz",
  });
  assert.equal(result.token.icon, "https://cdn.example/sauce.png");

  const menu = fs.readFileSync(new URL("../postmenu.js", import.meta.url), "utf8");
  const donate = fs.readFileSync(new URL("../donations.js", import.meta.url), "utf8");
  assert.match(menu, /links: creator \? swapReady\.token\.links : null/);
  assert.match(menu, /icon: creator \? swapReady\.token\.icon : ""/);
  assert.match(menu, /stats: creator \? swapReady\.token\.stats : null/);
  assert.match(donate, /links: creator \? result\.token\.links : null/);
  assert.match(donate, /icon: creator \? result\.token\.icon : ""/);
  assert.match(donate, /stats: creator \? result\.token\.stats : null/);
});

test("the swap sheet shows the creator bio above the fee line", () => {
  const html = "<a href=\"https://example.test\">click</a>";
  const shown = swapSheetText({
    bio: html,
    symbol: "SAUCE",
    tokenId: SAUCE,
    dueDiligenceComplete: false,
    feeBps: 40,
  });
  assert.equal(shown.bio, html);
  assert.equal(shown.safety, "0.4% goes to the poster.");
  assert.equal(swapBioText(html), html);
  assert.equal(swapSheetText({
    bio: "",
    symbol: "SAUCE",
    tokenId: SAUCE,
    dueDiligenceComplete: true,
    feeBps: 0,
  }).safety, "");
  assert.equal(swapFeeShare(1), "0.01% goes to the poster.");
  assert.equal(swapFeeShare(25), "0.25% goes to the poster.");
  assert.equal(swapFeeShare(100), "1% goes to the poster.");
  assert.equal(swapFeeShare(500), "5% goes to the poster.");
  assert.equal(swapFeeShare(0), "");
  assert.equal(swapSafetyLine({ symbol: "SAUCE", tokenId: SAUCE, feeBps: 10 }), "0.1% goes to the poster.");
  assert.equal(swapSheetText({ bio: "a".repeat(281), symbol: "SAUCE", tokenId: SAUCE, feeBps: 40 }).bio, "");

  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  const appended = sheet.match(/card\.append\(([^)]+)\)/);
  assert.ok(appended);
  assert.equal(appended[1], "column");
  assert.match(sheet, /column\.append\(token, stats, bio, error, slot\)/);
  assert.match(sheet, /if \(!lines\.safety\) \{\s*if \(noteRow\) noteRow\.remove\(\)/);
  assert.match(sheet, /errorSlot\.before\(noteRow\)/);
  assert.equal(sheet.includes("swap-grab"), false);
  assert.match(sheet, /paintSwapBio\(root\.querySelector\("\.swap-bio"\), author, lines\.bio\)/);
  assert.match(sheet, /note\.textContent = lines\.safety/);
  assert.match(sheet, /name\.textContent = text/);
  assert.match(sheet, /aria-label", kind \+ ": " \+ text/);
  assert.match(sheet, /link\.rel = "noopener noreferrer nofollow"/);
  assert.match(sheet, /link\.target = "_blank"/);
  assert.match(sheet, /bareAccount\(offer\.tokenId\) \? offer\.links : null/);
  assert.equal(sheet.includes("innerHTML"), false);

  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const linksCss = css.slice(css.indexOf("  .swap-links {"), css.indexOf("  .swap-error {"));
  assert.equal(linksCss.includes("px"), false);
  assert.match(linksCss, /\.swap-links\[hidden\]/);
  assert.match(linksCss, /text-overflow: ellipsis/);
  assert.match(linksCss, /\.swap-link-label \{[^}]*line-height: 1\.3/);
  assert.match(linksCss, /padding-top: 0\.1em/);
  assert.match(linksCss, /padding-bottom: 0\.1em/);
  assert.match(sheet, /M18\.244 2\.25h3\.308l-7\.227 8\.26 8\.502 11\.24H16\.17l-5\.214-6\.817L4\.99 21\.75H1\.68l7\.73-8\.835L1\.254 2\.25H8\.08l4\.713 6\.231zm-1\.161 17\.52h1\.833L7\.084 4\.126H5\.117z/);
  assert.match(sheet, /fill: "currentColor"/);
  assert.equal(sheet.includes('stroke: "currentColor", d: "M18.244'), false);
  assert.match(css, /--swap-side-gap: 0\.75rem/);
  assert.match(css, /padding-left: max\(var\(--swap-side-gap\), var\(--corner-clear\)\)/);
  assert.match(css, /padding-right: max\(var\(--swap-side-gap\), var\(--corner-clear\)\)/);
  const cardAt = css.indexOf("  .swap-card {");
  const cardCss = css.slice(cardAt, css.indexOf("  @media (hover: hover) and (pointer: fine)", cardAt));
  assert.match(cardCss, /--swap-r-bottom: max\(var\(--swap-r\), var\(--screen-r-bottom, 0dvh\)\)/);
  assert.match(cardCss, /border-radius: 2\.4dvh 2\.4dvh var\(--swap-r-bottom\) var\(--swap-r-bottom\)/);
  assert.match(cardCss, /--corner-clear: max\(0dvh, calc\(\(var\(--screen-r-bottom, 0dvh\) - 2\.2dvh\) \* 0\.293 \+ 0\.4dvh\)\)/);
  assert.match(cardCss, /env\(safe-area-inset-bottom, 0\)/);
  assert.equal(cardCss.includes("px"), false);
  const bioCss = css.slice(css.indexOf(".swap-bio {"), css.indexOf(".swap-note {"));
  assert.equal(bioCss.includes("px"), false);
  const countCss = css.slice(css.indexOf(".swap-bio-count {"), css.indexOf("#edit-profile-key-note"));
  assert.equal(countCss.includes("px"), false);

  const page = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const column = page.slice(page.indexOf('id="show-public-key-from-edit-profile"'), page.indexOf('id="edit-profile-picture"'));
  assert.match(column, /id="show-swap-bio-from-edit-profile"/);
  assert.match(column, /Swap bio ✅/);
  assert.match(column, /Swap bio ⛔/);
  const swapFields = page.slice(page.indexOf('id="edit-profile-swap-token"'), page.indexOf('id="edit-profile-swap-bio"'));
  assert.match(swapFields, /placeholder="Token ID \(0\.0\.x\)" aria-label="Token ID \(0\.0\.x\)"/);
  assert.match(swapFields, /placeholder="Fee bps, 0–500" aria-label="Fee bps, 0–500"/);
  const editor = page.slice(page.indexOf('id="edit-profile-swap-bio"'), page.indexOf('id="domain-help-overlay"'));
  assert.match(editor, /placeholder="Swap bio" aria-label="Swap bio" aria-describedby="swap-bio-count"/);
  assert.match(editor, /id="swap-bio-count" class="swap-bio-count" aria-live="polite"/);
  assert.match(editor, /maxlength="280"/);
  assert.match(editor, />Save</);
  assert.equal(editor.includes("px"), false);
  const rest = fs.readFileSync(new URL("../rest.js", import.meta.url), "utf8");
  assert.match(rest, /JSON\.stringify\(\{ data: \{ swapBio: parsed\.text \} \}\)/);
  assert.match(rest, /toast\.error\("Swap bio not saved"\)/);
});

function animHost() {
  let handler = null;
  return {
    addEventListener(type, fn) {
      assert.equal(type, "animationend");
      handler = fn;
    },
    removeEventListener(type, fn) {
      if (handler === fn) handler = null;
    },
    fire(event) {
      if (handler) handler(event);
    },
  };
}

function motionHarness(fallbackMs) {
  const card = animHost();
  const flags = { reduced: false };
  let cleaned = 0;
  const motion = createSwapSheetMotion({
    reduced: () => flags.reduced,
    target: () => card,
    listen(fn) { card.addEventListener("animationend", fn); },
    unlisten(fn) { card.removeEventListener("animationend", fn); },
    cleanup() { cleaned += 1; },
    fallbackMs,
  });
  return { card, flags, motion, cleaned: () => cleaned };
}

test("swap close runs cleanup only after the slide, and a reopen cancels it", async () => {
  const slide = motionHarness(500);
  slide.motion.open();
  slide.motion.close();
  slide.motion.close();
  assert.equal(slide.cleaned(), 0);
  slide.card.fire({ animationName: "swap-backdrop-out", target: slide.card });
  slide.card.fire({ animationName: "swap-sheet-down", target: {} });
  assert.equal(slide.cleaned(), 0);
  slide.card.fire({ animationName: "swap-sheet-down", target: slide.card });
  assert.equal(slide.cleaned(), 1);
  slide.card.fire({ animationName: "swap-sheet-down", target: slide.card });
  assert.equal(slide.cleaned(), 1);

  const reopened = motionHarness(40);
  reopened.motion.open();
  reopened.motion.close();
  reopened.motion.open();
  reopened.card.fire({ animationName: "swap-sheet-down", target: reopened.card });
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(reopened.cleaned(), 0);

  const missed = motionHarness(30);
  missed.motion.open();
  missed.motion.close();
  assert.equal(missed.cleaned(), 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(missed.cleaned(), 1);

  const reduced = motionHarness(500);
  reduced.flags.reduced = true;
  reduced.motion.open();
  reduced.motion.close();
  assert.equal(reduced.cleaned(), 1);
  reduced.card.fire({ animationName: "swap-sheet-down", target: reduced.card });
  assert.equal(reduced.cleaned(), 1);
});

test("the swap sheet preloads the widget and reserves its height", () => {
  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  const offer = fs.readFileSync(new URL("../swapoffer.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const closeFn = sheet.slice(sheet.indexOf("function closeSheet"), sheet.indexOf("function swapLoadingNote"));
  assert.equal(closeFn.includes("sheet.hidden = true"), false);
  assert.match(closeFn, /if \(!sheet \|\| sheet\.hidden\) return/);
  assert.match(closeFn, /is-closing/);
  assert.match(closeFn, /sheetMotion\(\)\.close\(\)/);
  assert.match(sheet, /createSwapSheetMotion\(/);
  assert.match(sheet, /addEventListener\("animationend", fn\)/);
  assert.match(sheet, /sheetMotion\(\)\.open\(\)/);
  assert.match(sheet, /Loading swap…/);
  assert.match(sheet, /note\.setAttribute\("role", "status"\)/);
  assert.match(sheet, /note\.setAttribute\("aria-live", "polite"\)/);
  assert.match(sheet, /if \(fitFrame\) return/);
  assert.match(sheet, /requestAnimationFrame\(\(\) => \{\s*fitFrame = 0;\s*fitSwapSheet\(\);/);
  assert.match(sheet, /new ResizeObserver/);
  const scrollFn = sheet.slice(sheet.indexOf("function onViewportScroll"), sheet.indexOf("function watchWidgetSize"));
  assert.equal(scrollFn.includes("fitColumnZoom"), false);
  assert.equal(scrollFn.includes("fitSwapSheet"), false);
  assert.equal(scrollFn.includes("--swap-h"), false);
  assert.match(scrollFn, /--swap-top/);
  assert.match(sheet, /visualViewport\.addEventListener\("scroll", onViewportScroll\)/);
  const stopFn = sheet.slice(sheet.indexOf("function stopFit"), sheet.indexOf("function paintChrome"));
  assert.match(stopFn, /widgetObserver\.disconnect\(\)/);
  assert.match(stopFn, /cancelAnimationFrame\(fitFrame\)/);
  assert.match(sheet, /prefers-reduced-motion: reduce/);
  assert.match(sheet, /function finishClose\(\)[\s\S]*sheet\.hidden = true/);
  assert.match(offer, /if \(show\) preloadSwapWidget\(\)/);
  assert.match(offer, /import\("\.\/swapsheet\.js"\)\.then\(\(mod\) => mod\.loadWidgetScript\(\)\)\.catch\(\(\) => \{\}\)/);

  assert.match(css, /animation: swap-sheet-up 0\.28s ease-out/);
  assert.match(css, /animation: swap-sheet-down 0\.28s ease-out forwards/);
  assert.match(css, /animation: swap-backdrop-in 0\.28s ease-out/);
  assert.match(css, /animation: swap-backdrop-out 0\.28s ease-out forwards/);
  assert.match(css, /@keyframes swap-sheet-up \{\s*from \{ transform: translateY\(100%\); \}/);
  assert.match(css, /animation-name: donate-pop/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\s*#swap-sheet \{\s*align-items: center;/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.swap-card\.early-holder-popup \{\s*animation-name: donate-pop, early-hashinal-angle;/);
  const swapCss = css.slice(css.indexOf("  #swap-sheet {"), css.indexOf("  .profile-live-bio {"));
  assert.equal(swapCss.includes("min-width: 100dvh"), false);
  const widgetCss = css.slice(css.indexOf("  .swap-widget {"), css.indexOf("  .swap-trap {"));
  assert.equal(widgetCss.includes("60.43dvh"), false);
  assert.match(sheet, /slot\.style\.minHeight = \(widgetH \/ rootPx\) \+ "rem"/);
  assert.match(sheet, /column\.style\.zoom = "1"/);
  assert.match(sheet, /card\.style\.removeProperty\("width"\)/);
  assert.match(sheet, /zoom = swapColumnZoom\(naturalW, naturalH, freeW, freeH\)/);
  assert.match(sheet, /const freeW = viewW - 2 \* gap - borderX/);
  assert.match(sheet, /zoom = swapPhoneColumnZoom\(naturalW, naturalH, freeW, freeH\)/);
  assert.match(offer, /let zoom = Math\.min\(freeW \/ naturalW, freeH \/ naturalH\)/);
  assert.match(offer, /if \(zoom > 2\.4\) zoom = 2\.4/);
  assert.match(sheet, /column\.style\.zoom = String\(zoom\)/);
  assert.equal(sheet.includes("widget.style.zoom"), false);
  assert.equal(sheet.includes("zoom > 1.6"), false);
  const columnCss = css.slice(css.indexOf("  .swap-column {"), css.indexOf("  .swap-x {"));
  assert.equal(columnCss.includes("px"), false);
  assert.match(columnCss, /width: min\(23\.75rem, calc\(100dvw - 2 \* var\(--swap-pad\)\)\)/);
  assert.equal(columnCss.includes("max-width: 100%"), false);
  assert.match(columnCss, /gap: 0\.75rem/);
  assert.equal(columnCss.includes("dvh"), false);
  assert.equal(columnCss.includes("align-self: flex-start"), false);
  assert.match(columnCss, /align-self: center/);
  assert.match(sheet, /const side = padX \+ edgePx\(pad\.borderLeftWidth\) \+ edgePx\(pad\.borderRightWidth\)/);
  assert.match(sheet, /card\.style\.width = \(swapCardWidth\(naturalW, zoom, side\) \/ rootPx\) \+ "rem"/);
  assert.match(sheet, /if \(!swapWidgetResizeNeedsFit\(widgetNaturalH, current\.offsetHeight, scale, slack\)\) return/);
  assert.match(stopFn, /widgetNaturalH = 0/);
  assert.match(css, /--swap-pad: 1\.6dvh;\s*width: min\(86dvw, 56dvh\);\s*max-width: min\(86dvw, 56dvh\);\s*padding: var\(--swap-pad\)/);
  assert.equal(css.includes(".swap-grab"), false);
  assert.match(sheet, /slot\.replaceChildren\(el\);\s*paintSwapButtonInk\(el\)/);
  assert.match(sheet, /style\[data-swap-ink\]/);
  assert.match(sheet, /"\.ss-primary-btn:disabled"/);
  assert.match(sheet, /"\.ss-primary-btn\.ss-primary-btn-loading:disabled"/);
  assert.match(sheet, /\{color:#000\}/);
  assert.equal(widgetCss.includes("px"), false);
  const cardAt = css.indexOf("  .swap-card {");
  const cardCss = css.slice(cardAt, css.indexOf("  @media (hover: hover) and (pointer: fine)", cardAt));
  assert.match(cardCss, /max-height: 100%/);
  assert.equal(cardCss.includes("px"), false);
});

test("the card width is the natural column times zoom plus padding, and a zoom-only resize is skipped", () => {
  assert.equal(swapCardWidth(200, 1.5, 32), 200 * 1.5 + 32);
  assert.equal(swapCardWidth(23.75, 2.4, 8), 23.75 * 2.4 + 8);
  assert.equal(swapColumnZoom(100, 80, 200, 240), 2);
  assert.equal(swapColumnZoom(100, 80, 50, 240), 1);
  assert.equal(swapColumnZoom(10, 10, 100, 100), 2.4);
  assert.equal(swapColumnZoom(10, 10, -4, 100), 1);
  assert.equal(swapColumnZoom(0, 0, 20, 20), 1);

  const narrowW = 320 - 2 * 0.75 * 16;
  assert.equal(swapPhoneColumnZoom(23.75 * 16, 640, narrowW, 700), narrowW / (23.75 * 16));
  assert.ok(swapPhoneColumnZoom(380, 400, 300, 900) < 1);
  assert.equal(swapPhoneColumnZoom(380, 800, 420, 600), 1);
  assert.equal(swapPhoneColumnZoom(380, 500, 760, 600), 1.2);
  assert.equal(swapPhoneColumnZoom(100, 100, 1000, 1000), 2.4);
  assert.equal(swapPhoneColumnZoom(380, 800, 300, 400), 0.5);

  const slack = 16 * 0.1;
  assert.equal(swapWidgetResizeNeedsFit(100, 200, 2, slack), false);
  assert.equal(swapWidgetResizeNeedsFit(100, 260, 2, slack), true);
  assert.equal(swapWidgetResizeNeedsFit(100, 130, 1, slack), true);
  assert.equal(swapWidgetResizeNeedsFit(100, 100.1, 1, slack), false);
  assert.equal(swapWidgetResizeNeedsFit(0, 100, 1, slack), true);

  assert.equal(formatSwapStat(0.0016, true), "$0.0016");
  assert.equal(formatSwapStat(1.58e6, true), "$1.58M");
  assert.equal(formatSwapStat(980e6, false), "980M");
  assert.equal(formatSwapStat(null, true), "–");
  assert.equal(formatSwapStat(Number.NaN, false), "–");
  assert.deepEqual(swapKeptStats({ priceUsd: -1, totalSupply: "980", marketCapUsd: 1.5 }), {
    totalSupply: null,
    circulating: null,
    liquidityUsd: null,
    marketCapUsd: 1.5,
    priceUsd: null,
  });

  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  const statsSrc = fs.readFileSync(new URL("../swapoffer.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(statsSrc, /if \(!id\) \{\s*grid\.hidden = true;/);
  assert.match(statsSrc, /stats\.hidden = true/);
  assert.match(statsSrc, /tile\.title = "Total supply minus the treasury account's balance"/);
  assert.match(sheet, /paintSwapStats\(root\.querySelector\("\.swap-stats"\), offer\)/);
  assert.match(sheet, /const stats = createSwapStats\(\)/);
  const statsCss = css.slice(css.indexOf("  .swap-stats {"), css.indexOf("  .swap-note {"));
  assert.equal(statsCss.includes("px"), false);
  assert.match(statsCss, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(statsCss, /width: min\(100%, 23\.75rem\)/);
  assert.match(statsSrc, /\["price", "Price", true\]/);
  assert.match(statsSrc, /\["cap", "Market cap", true\]/);
  assert.match(statsSrc, /\["liquidity", "Liquidity", true\]/);
  assert.match(statsSrc, /\["supply", "Total supply", false\]/);
  assert.match(statsSrc, /\["circulating", "Circulating", false\]/);
});

test("the circulating tile explains itself on focus and tap", () => {
  const src = fs.readFileSync(new URL("../swapoffer.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("function bindCirculatingTip"), src.indexOf("export function paintSwapStats"));
  assert.match(body, /tile\.title = "Total supply minus the treasury account's balance"/);
  assert.match(body, /tile\.tabIndex = 0/);
  assert.match(body, /setAttribute\("aria-describedby", tipId\)/);
  assert.match(body, /setAttribute\("role", "tooltip"\)/);
  assert.match(body, /addEventListener\("focus"/);
  assert.match(body, /addEventListener\("click"/);
  assert.match(body, /addEventListener\("blur"/);

  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const tip = css.match(/\.swap-stat-tip \{[^}]*\}/);
  const clanTip = css.match(/\.swap-stat-tip\.is-clan \{[^}]*\}/);
  assert.ok(tip);
  assert.ok(clanTip);
  assert.match(tip[0], /font-size: 1\.5dvh/);
  assert.match(tip[0], /max-width: 42dvw/);
  assert.match(tip[0], /padding: 0\.6dvh 1\.2dvw/);
  assert.match(clanTip[0], /font-size: calc\(var\(--fu, var\(--u\)\) \* 1\.25\)/);
  assert.match(clanTip[0], /max-width: calc\(var\(--fu, var\(--u\)\) \* 28\)/);
  assert.equal(tip[0].includes("px"), false);
  assert.equal(clanTip[0].includes("px"), false);

  function el(tag) {
    const node = {
      tag,
      className: "",
      id: "",
      title: "",
      hidden: false,
      textContent: "",
      tabIndex: -1,
      dataset: {},
      children: [],
      listeners: {},
      attrs: {},
      classList: { add() {} },
    };
    node.setAttribute = (name, value) => {
      node.attrs[name] = value;
    };
    node.addEventListener = (type, fn) => {
      (node.listeners[type] = node.listeners[type] || []).push(fn);
    };
    node.append = (...kids) => {
      for (const child of kids) {
        child.parentNode = node;
        node.children.push(child);
      }
    };
    return node;
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: el };
  try {
    const stats = createSwapStats();
    const tiles = stats.children;
    assert.equal(tiles.length, 5);
    for (const tile of tiles.slice(0, 4)) {
      assert.equal(tile.title, "");
      assert.equal(tile.tabIndex, -1);
      assert.equal(tile.attrs["aria-describedby"], undefined);
    }
    const tile = tiles[4];
    const note = tile.children[2];
    assert.equal(tile.title, "Total supply minus the treasury account's balance");
    assert.equal(tile.tabIndex, 0);
    assert.equal(tile.attrs["aria-describedby"], note.id);
    assert.equal(note.attrs.role, "tooltip");
    assert.equal(note.textContent, tile.title);
    assert.equal(note.hidden, true);

    tile.listeners.focus[0]();
    assert.equal(note.hidden, false);
    tile.listeners.click[0]({ stopPropagation() {} });
    assert.equal(note.hidden, false);
    tile.listeners.click[0]({ stopPropagation() {} });
    assert.equal(note.hidden, true);
    tile.listeners.click[0]({ stopPropagation() {} });
    assert.equal(note.hidden, false);
    tile.listeners.blur[0]();
    assert.equal(note.hidden, true);
    assert.equal(note.parentNode, tile);
  } finally {
    globalThis.document = previous;
  }
});

test("the swap sheet has no title row and the close button sits on the token card", () => {
  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const factory = sheet.slice(sheet.indexOf("export function createSwapTokenCard"), sheet.indexOf("function ensureSheet"));
  const openFn = sheet.slice(sheet.indexOf("export async function openSwapSheet"));

  assert.equal(sheet.includes("swap-head"), false);
  assert.equal(sheet.includes("swap-title"), false);
  assert.equal(sheet.includes('textContent = "Swap"'), false);
  assert.equal(css.includes(".swap-head"), false);
  assert.equal(css.includes(".swap-title"), false);
  assert.equal(factory.includes("swap-x"), false);

  assert.match(sheet, /aria-label", "Close Swap"/);
  assert.match(sheet, /function swapDialogLabel\(offer\) \{[\s\S]*?symbol \? "Swap " \+ symbol : "Swap"/);
  assert.match(openFn, /removeAttribute\("aria-labelledby"\)/);
  assert.match(openFn, /setAttribute\("aria-label", swapDialogLabel\(offer\)\)/);
  const paintAt = openFn.indexOf("paintSwapToken(");
  const placeAt = openFn.indexOf("placeSwapClose(");
  assert.ok(paintAt >= 0 && placeAt > paintAt);

  const place = sheet.slice(sheet.indexOf("function placeSwapClose"), sheet.indexOf("export function createSwapTokenCard"));
  assert.match(place, /if \(token && !token\.hidden\)/);
  assert.match(place, /links\.before\(cancel\)/);
  assert.match(place, /column\.insertBefore\(cancel, column\.firstChild\)/);
  assert.match(sheet, /cancel\.addEventListener\("click"[\s\S]*?closeSheet\(\)/);
  assert.match(sheet, /event\.key === "Escape"[\s\S]*?closeSheet\(\)/);
  assert.match(openFn, /closeBtn\.focus\(\{ preventScroll: true \}\)/);
  assert.match(openFn, /returnFocus = offer\.opener/);

  assert.equal(css.split("--swap-corner-size:").length - 1, 1);
  assert.match(css, /--swap-corner-size: calc\(var\(--fu, var\(--u\)\) \* 2\.05\)/);
  assert.match(css, /--swap-corner-inset-y: calc\(var\(--fu, var\(--u\)\) \* 1\.25\)/);
  assert.match(css, /--swap-corner-inset-x: calc\(var\(--fu, var\(--u\)\) \* 1\.45\)/);
  const closeRule = css.match(/\.swap-x \{[^}]*\}/);
  assert.ok(closeRule);
  assert.match(closeRule[0], /border-radius: 50%/);
  assert.match(closeRule[0], /background: rgba\(255, 255, 255, 0\.06\)/);
  assert.match(closeRule[0], /width: var\(--swap-corner-size\)/);
  assert.match(closeRule[0], /height: var\(--swap-corner-size\)/);
  assert.equal(closeRule[0].includes("px"), false);
  assert.equal(closeRule[0].includes("position: absolute"), false);
  assert.match(css, /\.swap-x:focus-visible \{[^}]*outline: 0\.2dvh solid #22D3EE/);
  assert.match(css, /\.clan-token \.clan-buy,\s*#swap-sheet \.swap-token > \.swap-x \{[^}]*align-self: flex-start/);
  assert.match(css, /\.clan-token \.clan-buy,\s*#swap-sheet \.swap-token > \.swap-x \{[^}]*margin: 0 0 0 auto/);
  assert.match(css, /#swap-sheet \.swap-column > \.swap-x \{[^}]*align-self: flex-end/);
  assert.match(css, /#swap-sheet \.swap-token > \.swap-links \{[^}]*flex: 1 0 100%/);
  assert.match(css, /\.swap-token-meta \{[^}]*min-width: 0/);
  assert.match(css, /\.swap-token-symbol \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.swap-card\.early-holder-popup \.swap-x \{[^}]*color: #f6e27a/);
  assert.match(css, /--swap-pad: 1\.6dvh;\s*width: min\(86dvw, 56dvh\);\s*max-width: min\(86dvw, 56dvh\);\s*padding: var\(--swap-pad\)/);
});

test("the swap bio is the author's banner, and it stays hidden without a bio", () => {
  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const offer = fs.readFileSync(new URL("../swapoffer.js", import.meta.url), "utf8");
  const build = sheet.slice(sheet.indexOf("function createSwapBio"), sheet.indexOf("function paintSwapBio"));
  const paint = sheet.slice(sheet.indexOf("function paintSwapBio"), sheet.indexOf("function ensureSheet"));

  assert.match(build, /className = "swap-bio"/);
  assert.match(build, /className = "feed-profile-banner-pic"/);
  assert.match(build, /className = "feed-profile-banner-name"/);
  assert.match(build, /className = "feed-profile-banner-handle"/);
  assert.match(build, /className = "feed-profile-banner-bio"/);
  assert.equal(build.includes("feed-profile-banner-back"), false);
  assert.match(build, /banner\.append\(open, body\)/);
  const closeAt = build.indexOf("closeSheet()");
  const profileAt = build.indexOf("openProfileFromPopup");
  assert.ok(closeAt > 0 && profileAt > closeAt);
  assert.match(build, /window\.openProfileFromPopup \|\| window\.openFeedProfile/);

  assert.match(paint, /if \(!text\) \{[\s\S]*banner\.hidden = true/);
  assert.match(paint, /profileUsername\(author\)/);
  assert.match(paint, /stored \? profileDisplayName\(author\) : ""/);
  assert.match(paint, /nameEl\.textContent = name/);
  assert.match(paint, /handleEl\.textContent = author \|\| ""/);
  assert.match(paint, /body\.textContent = text/);
  assert.match(paint, /banner\.classList\.toggle\("no-username", !name\)/);
  assert.match(paint, /setAttribute\("aria-label", "Bio from " \+ who\)/);
  assert.match(paint, /mountPicture\(pic, profilePicUrl\(author\)/);
  assert.match(paint, /fallback: DEFAULT_PIC/);
  assert.match(paint, /paintProfileAvatar\(mounted, author\)/);
  assert.match(sheet, /paintSwapBio\(root\.querySelector\("\.swap-bio"\), author, lines\.bio\)/);
  assert.match(sheet, /column\.append\(token, stats, bio, error, slot\)/);
  assert.match(offer, /if \(!bareAccount\(info\.tokenId\)\) return \{ bio: "", safety: "" \}/);

  const bioCss = css.slice(css.indexOf("  .swap-bio {"), css.indexOf("  .swap-stats {"));
  assert.equal(bioCss.includes("px"), false);
  assert.match(bioCss, /background: #17171a/);
  assert.match(bioCss, /border: 0\.0625rem solid rgba\(255, 255, 255, 0\.07\)/);
  assert.match(bioCss, /border-radius: 1rem/);
  assert.match(bioCss, /padding: var\(--swap-corner-inset-y\) var\(--swap-corner-inset-x\)/);
  assert.match(bioCss, /white-space: pre-wrap/);
  assert.match(bioCss, /font-family: ui-monospace, monospace/);
  assert.match(bioCss, /no-username[\s\S]*justify-content: center/);
  assert.equal(bioCss.includes("position: absolute"), false);
  assert.equal(bioCss.includes("--feed-banner-y"), false);
  assert.equal(bioCss.includes("feed-profile-banner-back"), false);
  assert.match(css, /\.feed-profile-banner-name \{[^}]*font-weight: 700/);
  assert.match(css, /\.feed-profile-banner-pic \{[^}]*width: calc\(var\(--fu\) \* 4\.2\)/);
});
