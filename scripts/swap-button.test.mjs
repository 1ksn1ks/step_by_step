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

test("your own post opens the default widget and does not ask the token route", async () => {
  const { fetchImpl, calls } = tokenFetch({ pool: true, symbol: "SAUCE" });
  const result = await resolveSwapButton({
    author: "0.0.200-abc",
    viewer: AUTHOR,
    swap: ON,
    fetchImpl,
    ...isolated(),
  });
  assert.equal(result.show, true);
  assert.equal(result.offer, null);
  assert.equal(result.token, null);
  assert.equal(calls.length, 0);
  assert.equal(swapButtonShows({
    author: AUTHOR,
    viewer: AUTHOR,
    offer: { tokenId: SAUCE, feeBps: 0 },
    token: { pool: true, tokenId: SAUCE },
  }), false);
  assert.equal(swapButtonShows({
    author: AUTHOR,
    viewer: "",
    offer: { tokenId: SAUCE, feeBps: 0 },
    token: { pool: true, tokenId: SAUCE },
  }), true);
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
  assert.equal(swapSafetyLine({ symbol: "SAUCE", tokenId: "", feeBps: 40 }), "Not reviewed by SaucerSwap.");
  assert.equal(swapSafetyLine({}).includes("buying"), false);
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
  assert.match(menu, /swapItem\.hidden = !swapReady/);
  assert.match(menu, /opener: swapItem/);
  assert.match(donations, /donate-swap/);
  assert.match(donations, /openSwapSheet\(/);
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
  assert.match(wallet, /swapAllowanceLong\(amount\)/);
  assert.match(wallet, /approveTokenAllowance\(TokenId\.fromString\(token\), AccountId\.fromString\(session\.id\), AccountId\.fromString\(spender\), allowance\)/);
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
  assert.match(menu, /swapItem\.hidden = !swapReady/);
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

test("the swap sheet shows the creator bio above the safety line", () => {
  const buying = "You're buying SAUCE (0.0.731861), not donating. Tokens can lose value.";
  const html = "<a href=\"https://example.test\">click</a>";
  const shown = swapSheetText({
    bio: html,
    symbol: "SAUCE",
    tokenId: SAUCE,
    dueDiligenceComplete: false,
    feeBps: 40,
  });
  assert.equal(shown.bio, html);
  assert.equal(shown.safety, buying + " Not reviewed by SaucerSwap. 0.4% goes to the poster.");
  assert.equal(shown.safety.startsWith(buying), true);
  assert.equal(swapBioText(html), html);
  assert.equal(swapSheetText({
    bio: "",
    symbol: "SAUCE",
    tokenId: SAUCE,
    dueDiligenceComplete: true,
    feeBps: 0,
  }).safety, buying);
  assert.equal(swapFeeShare(1), "0.01% goes to the poster.");
  assert.equal(swapFeeShare(25), "0.25% goes to the poster.");
  assert.equal(swapFeeShare(100), "1% goes to the poster.");
  assert.equal(swapFeeShare(500), "5% goes to the poster.");
  assert.equal(swapFeeShare(0), "");
  assert.equal(swapSafetyLine({ symbol: "SAUCE", tokenId: SAUCE, feeBps: 10 }), buying + " 0.1% goes to the poster.");
  assert.equal(swapSheetText({ bio: "a".repeat(281), symbol: "SAUCE", tokenId: SAUCE, feeBps: 40 }).bio, "");

  const sheet = fs.readFileSync(new URL("../swapsheet.js", import.meta.url), "utf8");
  const appended = sheet.match(/card\.append\(([^)]+)\)/);
  assert.ok(appended);
  assert.equal(appended[1], "head, bio, note, error, slot");
  assert.match(sheet, /bio\.textContent = lines\.bio/);
  assert.match(sheet, /note\.textContent = lines\.safety/);
  assert.equal(sheet.includes("innerHTML"), false);

  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const cardAt = css.indexOf("  .swap-card {");
  const cardCss = css.slice(cardAt, css.indexOf("  @media (min-width: 100dvh)", cardAt));
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
  const widgetCss = css.slice(css.indexOf("  .swap-widget {"), css.indexOf("  .swap-trap {"));
  assert.equal(widgetCss.includes("60.43dvh"), false);
  assert.match(sheet, /slot\.style\.minHeight = \(naturalH \/ rootPx\) \+ "rem"/);
  assert.equal(widgetCss.includes("px"), false);
  const cardAt = css.indexOf("  .swap-card {");
  const cardCss = css.slice(cardAt, css.indexOf("  @media (min-width: 100dvh)", cardAt));
  assert.match(cardCss, /max-height: 100%/);
  assert.equal(cardCss.includes("px"), false);
});
