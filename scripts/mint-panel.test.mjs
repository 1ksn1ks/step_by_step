// The map Toolbar's Mint row and panel (mintpanel.js): typed amounts to the
// smallest unit with string and BigInt math, the form's checks, the wallet
// step, the confirm and result cards, and where the panel is registered.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// toast.js sets window.toast as it loads; reduced motion makes the cards
// open and close at once.
globalThis.window = { matchMedia: () => ({ matches: true }) };

const {
  ADMIN_OFF_WARNING,
  MINT_CONNECT_CLASS,
  MINT_FAIL_TEXT,
  MINT_NETWORK_FEE,
  bindMintPanel,
  fromSmallestUnits,
  readDecimals,
  readMintFields,
  toSmallestUnits,
} = await import("../mintpanel.js");

// The working copy has CRLF line ends.
function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

// ── A document just big enough for the panel and its cards ─────────────

class El {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this.className = "";
    this.text = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.tabIndex = 0;
  }
  get classList() {
    const names = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const write = (set) => { this.className = [...set].join(" "); };
    return {
      add: (...list) => { const set = names(); list.forEach((n) => set.add(n)); write(set); },
      remove: (...list) => { const set = names(); list.forEach((n) => set.delete(n)); write(set); },
      contains: (name) => names().has(name),
      toggle: (name, force) => {
        const set = names();
        const on = force === undefined ? !set.has(name) : !!force;
        if (on) set.add(name);
        else set.delete(name);
        write(set);
        return on;
      },
    };
  }
  set textContent(value) {
    this.children = [];
    this.text = String(value);
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument.body;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((f) => f !== fn));
  }
  dispatch(type, extra = {}) {
    const event = { type, target: this, stopPropagation() {}, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
    return event;
  }
  click() { return this.dispatch("click"); }
  focus() { this.ownerDocument.activeElement = this; }
  appendChild(node) {
    if (node.parentNode) node.remove();
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

function find(root, test) {
  if (test(root)) return root;
  for (const child of root.children) {
    const hit = find(child, test);
    if (hit) return hit;
  }
  return null;
}
const byClass = (root, name) => find(root, (el) => el.className.split(/\s+/).includes(name));
const byText = (root, text) => find(root, (el) => el.tagName === "BUTTON" && el.textContent === text);

// The panel as index.html builds it, on the page.
function page() {
  const doc = { activeElement: null, keys: [] };
  doc.createElement = (tag) => new El(doc, tag);
  doc.body = new El(doc, "body");
  doc.documentElement = new El(doc, "html");
  const ids = new Map();
  doc.getElementById = (id) => ids.get(id) || null;
  doc.addEventListener = (type, fn) => { if (type === "keydown") doc.keys.push(fn); };
  doc.removeEventListener = (type, fn) => { doc.keys = doc.keys.filter((f) => f !== fn); };
  const make = (tag, id, parent, props = {}) => {
    const el = new El(doc, tag);
    Object.assign(el, props);
    ids.set(id, el);
    parent.appendChild(el);
    return el;
  };
  const column = make("div", "mint-column", doc.body);
  const tabs = make("div", "mint-tabs", column);
  for (const key of ["token", "nft", "hashinal"]) make("button", `mint-tab-${key}`, tabs, { className: "mint-tab" });
  const form = make("form", "mint-panel-token", column);
  make("div", "mint-panel-nft", column, { hidden: true });
  make("div", "mint-panel-hashinal", column, { hidden: true });
  for (const id of ["mint-name", "mint-symbol", "mint-initial", "mint-memo"]) make("input", id, form);
  make("input", "mint-decimals", form, { value: "8" });
  make("button", "mint-supply-unlimited", form, { className: "feed-settings-choice is-on" });
  make("button", "mint-supply-capped", form, { className: "feed-settings-choice" });
  const wrap = make("div", "mint-max-wrap", form, { hidden: true });
  make("input", "mint-max", wrap);
  make("button", "mint-admin-key", form, { className: "feed-settings-switch is-on" });
  make("p", "mint-admin-warning", form, { hidden: true });
  make("button", "mint-create", form);
  make("p", "mint-error", form, { hidden: true });
  make("button", "connect-wallet-btn", doc.body);
  const $ = (id) => ids.get(id);
  const fill = (values) => {
    for (const [key, value] of Object.entries(values)) $(`mint-${key}`).value = value;
  };
  return { doc, $, fill };
}

function stand() {
  const log = [];
  const toast = {
    error: (msg) => log.push(["error", msg]),
    success: (msg) => log.push(["success", msg]),
    hold: (msg) => {
      log.push(["hold", msg]);
      return { done: () => log.push(["done", msg]) };
    },
  };
  return { log, toast };
}

const RESULT = {
  tokenId: "0.0.4242",
  txId: "0.0.1001@1700000000.000000001",
  hashscanUrl: "https://hashscan.io/mainnet/transaction/0.0.1001-1700000000-000000001",
  tokenUrl: "https://hashscan.io/mainnet/token/0.0.4242",
};

async function waitFor(get) {
  for (let i = 0; i < 100; i += 1) {
    const value = get();
    if (value) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("timed out");
}
const card = (doc, titleId) => doc.body.children.find((el) => el.getAttribute("aria-labelledby") === titleId);

// ── Amounts ────────────────────────────────────────────────────────────

test("a typed amount becomes whole smallest units, by string and BigInt only", () => {
  assert.equal(toSmallestUnits("1000", 8), "100000000000");
  assert.equal(toSmallestUnits("12.5", 8), "1250000000");
  assert.equal(toSmallestUnits(" 7 ", 0), "7");
  assert.equal(toSmallestUnits("0", 8), "0");
  assert.equal(toSmallestUnits(".5", 2), "50");
  assert.equal(toSmallestUnits("12.", 2), "1200");
  assert.equal(toSmallestUnits("007.250", 3), "7250");
  // Zeros at the end of the fraction do not count against the decimals.
  assert.equal(toSmallestUnits("12.50000000000", 8), "1250000000");
  // One place too many: an error, not a rounding.
  assert.throws(() => toSmallestUnits("0.000000001", 8, "Initial supply"), /Initial supply can have at most 8 decimal places/);
  assert.throws(() => toSmallestUnits("12.5", 0, "Max supply"), /Max supply must be a whole number: this token has 0 decimals/);
  // Big values stay exact: no float on the way.
  assert.equal(toSmallestUnits("123456789012345678901234567890", 18), "123456789012345678901234567890" + "0".repeat(18));
  assert.equal(toSmallestUnits("92233720368.54775807", 8), "9223372036854775807");
  assert.equal(toSmallestUnits("9007199254740993", 2), "900719925474099300");
  for (const bad of ["", "abc", "1e3", "-1", "1,000", "1.2.3", "+5", "0x10", "1 000"]) {
    assert.throws(() => toSmallestUnits(bad, 8), /must be a number like 1000 or 12\.5/, bad);
  }
  for (const [units, decimals, text] of [["1250000000", 8, "12.5"], ["100000000000", 8, "1,000"], ["5", 8, "0.00000005"], ["0", 0, "0"], ["1234567", 0, "1,234,567"]]) {
    assert.equal(fromSmallestUnits(units, decimals), text);
  }
  assert.equal(readDecimals("8"), 8);
  assert.equal(readDecimals(" 0 "), 0);
  assert.equal(readDecimals("18"), 18);
  for (const bad of ["19", "8.5", "", "-1", "abc", "100"]) {
    assert.throws(() => readDecimals(bad), /Decimals must be a whole number from 0 to 18/, bad);
  }
});

test("the form's fields go to tokenmint.js's checks: Unlimited is null, Capped is the cap in smallest units", () => {
  const base = { name: " Coin ", symbol: "CN", decimals: "8", initial: "12.5", memo: "", adminKey: true };
  const open = readMintFields({ ...base, capped: false, max: "999" });
  assert.deepEqual(open.fields, { name: "Coin", symbol: "CN", decimals: 8, initialSupply: "1250000000", maxSupply: null, memo: "", adminKey: true });
  assert.deepEqual(open.display, { initial: "12.5", max: "" });
  const capped = readMintFields({ ...base, capped: true, max: "1000000", adminKey: false });
  assert.equal(capped.fields.maxSupply, "100000000000000");
  assert.equal(capped.fields.adminKey, false);
  assert.equal(capped.display.max, "1,000,000");
  // tokenmint.js's words and order: name first, then the amounts.
  const fail = (values) => {
    try {
      readMintFields({ ...base, capped: false, ...values });
    } catch (err) {
      return [err.message, err.field];
    }
    return null;
  };
  assert.deepEqual(fail({ name: "  " }), ["Name must be 1 to 100 bytes", "name"]);
  assert.deepEqual(fail({ symbol: "" }), ["Symbol must be 1 to 100 bytes", "symbol"]);
  assert.deepEqual(fail({ name: "", initial: "1.123456789" }), ["Name must be 1 to 100 bytes", "name"]);
  assert.deepEqual(fail({ decimals: "19" }), ["Decimals must be a whole number from 0 to 18", "decimals"]);
  assert.deepEqual(fail({ initial: "0.000000001" }), ["Initial supply can have at most 8 decimal places", "initial"]);
  assert.deepEqual(fail({ initial: "" }), ["Initial supply is required. 0 is allowed", "initial"]);
  assert.deepEqual(fail({ capped: true, max: "" }), ["Max supply is required when the supply is capped", "max"]);
  assert.deepEqual(fail({ capped: true, max: "10" }), ["Max supply must be at least the initial supply", "max"]);
  assert.deepEqual(fail({ initial: "92233720368.54775808" }), ["Initial supply is above the network maximum", "initial"]);
  assert.deepEqual(fail({ memo: "x".repeat(101) }), ["Memo must be 100 bytes or less", "memo"]);
  assert.equal(readMintFields({ ...base, initial: "0" }).fields.initialSupply, "0");
});

// ── The panel ──────────────────────────────────────────────────────────

test("the tabs: Token first, a click or the arrows pick another, NFT and Hashinal hide the form", () => {
  const { doc, $ } = page();
  bindMintPanel({ doc, ensureWallet: async () => "ok", createToken: async () => RESULT, toast: stand().toast });
  assert.equal($("mint-tab-token").getAttribute("aria-selected"), "true");
  assert.equal($("mint-tab-token").tabIndex, 0);
  assert.equal($("mint-tab-nft").tabIndex, -1);
  assert.equal($("mint-panel-token").hidden, false);
  assert.equal($("mint-panel-nft").hidden, true);
  $("mint-tab-nft").click();
  assert.equal($("mint-tab-nft").getAttribute("aria-selected"), "true");
  assert.equal($("mint-tab-token").getAttribute("aria-selected"), "false");
  assert.equal($("mint-panel-token").hidden, true);
  assert.equal($("mint-panel-nft").hidden, false);
  $("mint-tab-nft").dispatch("keydown", { key: "ArrowRight" });
  assert.equal($("mint-panel-hashinal").hidden, false);
  assert.equal(doc.activeElement, $("mint-tab-hashinal"));
  $("mint-tab-hashinal").dispatch("keydown", { key: "ArrowRight" });
  assert.equal($("mint-panel-token").hidden, false);
  assert.equal(doc.activeElement, $("mint-tab-token"));
});

test("Admin key is on; off shows the warning under it, on again hides it", () => {
  const { $, doc } = page();
  bindMintPanel({ doc, ensureWallet: async () => "ok", createToken: async () => RESULT, toast: stand().toast });
  const admin = $("mint-admin-key");
  assert.equal(admin.getAttribute("aria-checked"), "true");
  assert.equal($("mint-admin-warning").hidden, true);
  admin.click();
  assert.equal(admin.getAttribute("aria-checked"), "false");
  assert.equal(admin.classList.contains("is-on"), false);
  assert.equal($("mint-admin-warning").hidden, false);
  admin.click();
  assert.equal(admin.getAttribute("aria-checked"), "true");
  assert.equal($("mint-admin-warning").hidden, true);
  assert.equal(ADMIN_OFF_WARNING, "Without an admin key this token can never be changed or deleted.");
  assert.ok(read("../index.html").includes(`<p class="mint-warning" id="mint-admin-warning" hidden>${ADMIN_OFF_WARNING}</p>`));
});

test("a field problem shows inline under the form, and the wallet is not asked", async () => {
  const { doc, $, fill } = page();
  const { log, toast } = stand();
  let asked = 0;
  const panel = bindMintPanel({ doc, ensureWallet: async () => { asked += 1; return "ok"; }, createToken: async () => RESULT, toast });
  fill({ name: "", symbol: "CN", initial: "1" });
  assert.equal(await panel.run(), "invalid");
  assert.equal($("mint-error").hidden, false);
  assert.equal($("mint-error").textContent, "Name must be 1 to 100 bytes");
  assert.equal($("mint-name").getAttribute("aria-invalid"), "true");
  assert.equal(doc.activeElement, $("mint-name"));
  fill({ name: "Coin", initial: "0.000000001" });
  assert.equal(await panel.run(), "invalid");
  assert.equal($("mint-error").textContent, "Initial supply can have at most 8 decimal places");
  assert.equal($("mint-name").getAttribute("aria-invalid"), null);
  assert.equal($("mint-initial").getAttribute("aria-invalid"), "true");
  assert.equal(asked, 0);
  assert.deepEqual(log, []);
  assert.equal(card(doc, "mint-confirm-title"), undefined);
});

test("a cancelled wallet stays quiet; a wallet that cannot connect says so; the drawer stays open under the sheet", async () => {
  const { doc, $, fill } = page();
  const { log, toast } = stand();
  let during = null;
  let status = "cancel";
  const panel = bindMintPanel({
    doc,
    ensureWallet: async () => {
      during = {
        cls: doc.documentElement.classList.contains(MINT_CONNECT_CLASS),
        keepOpen: ($("connect-wallet-btn").listeners.get("click") || []).length,
      };
      return status;
    },
    createToken: async () => { throw new Error("not reached"); },
    toast,
  });
  fill({ name: "Coin", symbol: "CN", initial: "1000" });
  assert.equal(await panel.run(), "cancel");
  assert.deepEqual(during, { cls: true, keepOpen: 1 });
  assert.equal(MINT_CONNECT_CLASS, "inscribe-connect");
  assert.equal(doc.documentElement.classList.contains(MINT_CONNECT_CLASS), false);
  assert.equal(($("connect-wallet-btn").listeners.get("click") || []).length, 0);
  assert.deepEqual(log, []);
  assert.equal($("mint-error").hidden, true);
  status = "fail";
  assert.equal(await panel.run(), "fail");
  assert.deepEqual(log, [["error", "Connect wallet first"]]);
  // A wallet step that throws is a fail too.
  log.length = 0;
  const thrower = bindMintPanel({ doc, ensureWallet: async () => { throw new Error("boom"); }, toast });
  assert.equal(await thrower.run(), "fail");
  assert.deepEqual(log, [["error", "Connect wallet first"]]);
});

// Runs Create through the confirm card to the result card.
async function createThrough(doc, panel, { decline = false } = {}) {
  const running = panel.run();
  const confirm = await waitFor(() => card(doc, "mint-confirm-title"));
  const rows = [];
  const list = byClass(confirm, "onboard-rows");
  for (const row of list.children) rows.push([row.children[0].textContent, row.children[1].textContent]);
  if (decline) {
    byText(confirm, "Not now").click();
    return { rows, status: await running };
  }
  byText(confirm, "Create").click();
  return { rows, running };
}

test("Unlimited sends maxSupply null and Capped sends the cap; the confirm card lists the token", async () => {
  const { doc, $, fill } = page();
  const { log, toast } = stand();
  const calls = [];
  const panel = bindMintPanel({
    doc,
    ensureWallet: async () => "ok",
    createToken: async (fields) => {
      calls.push({ fields, disabled: $("mint-create").disabled });
      return RESULT;
    },
    toast,
  });
  fill({ name: "Coin", symbol: "CN", initial: "12.5", memo: "hello" });
  const first = await createThrough(doc, panel);
  assert.deepEqual(first.rows, [
    ["Name", "Coin"],
    ["Symbol", "CN"],
    ["Decimals", "8"],
    ["Initial supply", "12.5 CN"],
    ["Supply", "Unlimited"],
    ["Admin key", "On"],
    ["Network fee", MINT_NETWORK_FEE],
  ]);
  assert.equal(MINT_NETWORK_FEE, "≈ $1, paid by your wallet");
  const result = await waitFor(() => card(doc, "mint-result-title"));
  byText(result, "Done").click();
  assert.equal(await first.running, "created");
  assert.deepEqual(calls[0], {
    fields: { name: "Coin", symbol: "CN", decimals: 8, initialSupply: "1250000000", maxSupply: null, memo: "hello", adminKey: true },
    disabled: true,
  });
  assert.equal($("mint-create").disabled, false);
  assert.deepEqual(log, [["hold", "Waiting for your wallet…"], ["done", "Waiting for your wallet…"]]);

  // Capped, admin key off.
  $("mint-supply-capped").click();
  assert.equal($("mint-max-wrap").hidden, false);
  assert.equal($("mint-supply-capped").getAttribute("aria-checked"), "true");
  assert.equal($("mint-supply-unlimited").getAttribute("aria-checked"), "false");
  $("mint-admin-key").click();
  fill({ max: "1000000" });
  const second = await createThrough(doc, panel);
  assert.deepEqual(second.rows.slice(4, 6), [["Supply", "Capped at 1,000,000 CN"], ["Admin key", `Off. ${ADMIN_OFF_WARNING}`]]);
  byText(await waitFor(() => card(doc, "mint-result-title")), "Done").click();
  assert.equal(await second.running, "created");
  assert.equal(calls[1].fields.maxSupply, "100000000000000");
  assert.equal(calls[1].fields.adminKey, false);

  // Back to Unlimited: null again, and Max supply hides.
  $("mint-supply-unlimited").click();
  assert.equal($("mint-max-wrap").hidden, true);
  const third = await createThrough(doc, panel);
  byText(await waitFor(() => card(doc, "mint-result-title")), "Done").click();
  await third.running;
  assert.equal(calls[2].fields.maxSupply, null);

  // Not now: nothing is created.
  const declined = await createThrough(doc, panel, { decline: true });
  assert.equal(declined.status, "declined");
  assert.equal(calls.length, 3);
  assert.equal(doc.activeElement, $("mint-create"));
});

test("the result card shows the token id with Copy, both HashScan links and Done", async () => {
  const { doc, $, fill } = page();
  const { toast } = stand();
  const copied = [];
  const panel = bindMintPanel({
    doc,
    ensureWallet: async () => "ok",
    createToken: async () => RESULT,
    toast,
    clipboard: { writeText: async (text) => { copied.push(text); } },
  });
  fill({ name: "Coin", symbol: "CN", initial: "1000" });
  const { running } = await createThrough(doc, panel);
  const result = await waitFor(() => card(doc, "mint-result-title"));
  assert.equal(result.getAttribute("role"), "dialog");
  assert.equal(result.getAttribute("aria-modal"), "true");
  assert.equal(byClass(result, "onboard-title").textContent, "Token created");
  assert.equal(byClass(result, "mint-result-id").textContent, "0.0.4242");
  const links = [];
  find(result, (el) => {
    if (el.tagName === "A") links.push(el);
    return false;
  });
  assert.deepEqual(links.map((a) => [a.textContent, a.href, a.target, a.rel, a.className]), [
    ["View token on HashScan", RESULT.tokenUrl, "_blank", "noopener", "swap-tx-link"],
    ["View transaction", RESULT.hashscanUrl, "_blank", "noopener", "swap-tx-link"],
  ]);
  // Done takes focus; Tab goes round Copy, the links and Done.
  const done = byText(result, "Done");
  assert.equal(doc.activeElement, done);
  doc.keys[0]({ key: "Tab", shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(doc.activeElement, byText(result, "Copy"));
  await byText(result, "Copy").dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, ["0.0.4242"]);
  assert.ok(byText(result, "Copied"));
  // Escape closes it; focus goes back to Create.
  doc.keys[0]({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(await running, "created");
  assert.equal(card(doc, "mint-result-title"), undefined);
  assert.equal(doc.activeElement, $("mint-create"));
});

test("the cards read keys on the window, ahead of the drawer's own Escape on the document", async () => {
  const { doc, $, fill } = page();
  const windowKeys = [];
  doc.defaultView = {
    addEventListener: (type, fn, capture) => { if (type === "keydown") windowKeys.push({ fn, capture }); },
    removeEventListener: (type, fn) => {
      const at = windowKeys.findIndex((entry) => entry.fn === fn);
      if (at >= 0) windowKeys.splice(at, 1);
    },
  };
  const panel = bindMintPanel({ doc, ensureWallet: async () => "ok", createToken: async () => RESULT, toast: stand().toast });
  fill({ name: "Coin", symbol: "CN", initial: "1" });
  const running = panel.run();
  await waitFor(() => card(doc, "mint-confirm-title"));
  assert.equal(doc.keys.length, 0);
  assert.equal(windowKeys.length, 1);
  assert.equal(windowKeys[0].capture, true);
  let stopped = false;
  windowKeys[0].fn({ key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(await running, "declined");
  assert.equal(windowKeys.length, 0);
  assert.equal(doc.activeElement, $("mint-create"));
});

test("a wallet that says no closes quietly; other errors toast; a second Create while one runs does nothing", async () => {
  const { doc, fill } = page();
  const { log, toast } = stand();
  let fail = new Error("USER_REJECT: Request Rejected");
  const panel = bindMintPanel({ doc, ensureWallet: async () => "ok", createToken: async () => { throw fail; }, toast });
  fill({ name: "Coin", symbol: "CN", initial: "1000" });
  for (const message of ["USER_REJECT: Request Rejected", "User cancelled", "Permission denied", "Modal closed"]) {
    fail = new Error(message);
    log.length = 0;
    const { running } = await createThrough(doc, panel);
    assert.equal(await running, "quiet", message);
    assert.deepEqual(log.filter(([kind]) => kind === "error"), [], message);
  }
  fail = new Error("INSUFFICIENT_PAYER_BALANCE");
  log.length = 0;
  let run = await createThrough(doc, panel);
  assert.equal(await run.running, "error");
  assert.deepEqual(log.filter(([kind]) => kind === "error"), [["error", MINT_FAIL_TEXT]]);
  fail = Object.assign(new Error("This account uses a multi-key (threshold or key list) setup. Minting here needs a single-key account."), { userFacing: true });
  log.length = 0;
  run = await createThrough(doc, panel);
  assert.equal(await run.running, "error");
  assert.deepEqual(log.filter(([kind]) => kind === "error"), [["error", fail.message]]);
  assert.equal(MINT_FAIL_TEXT, "Token create failed. Nothing was charged if your wallet did not approve.");

  // Double submit: the second run is refused while the first is up.
  let release;
  const slow = bindMintPanel({ doc, ensureWallet: () => new Promise((resolve) => { release = resolve; }), createToken: async () => RESULT, toast });
  const first = slow.run();
  assert.equal(await slow.run(), "busy");
  release("cancel");
  assert.equal(await first, "cancel");
});

// ── Where it lives ─────────────────────────────────────────────────────

test("Mint sits right under Inscribe, with a coin icon, and opens its own page", () => {
  const html = read("../index.html");
  const inscribe = html.indexOf('id="Inscribe_Hashinal"');
  const mint = html.indexOf('<div class="toolbar-column set-nav" id="Mint_Token"><span class="set-nav-copy"><span class="set-nav-label">Mint</span><span class="set-nav-desc">Create a token or NFT on Hedera</span></span></div>');
  const create = html.indexOf('id="Create_New_Topic"');
  assert.ok(inscribe > 0 && mint > inscribe && create > mint);
  assert.equal(html.slice(inscribe, mint).split("\n").length, 2, "the next line");
  const layout = read("../feedlayout.js");
  const at = layout.indexOf("  Mint_Token: [");
  const icon = layout.slice(at, layout.indexOf("\n  ],", at));
  assert.match(icon, /\['circle', \{ cx: '12', cy: '12', r: '9' \}\]/);
  assert.equal(icon.includes("stroke-width"), false);
  assert.match(layout, /  Mint_Token: 'mint-column',/);
});

test("the panel is copied from Create and Domain: same shell, help, and every list Create is in", () => {
  const html = read("../index.html");
  assert.ok(html.includes('<div id="mint-column" class="toolbar-containers" onclick="event.stopPropagation();" style="display: none; position: absolute; z-index: 1002; top:10vh;">'));
  assert.ok(html.includes('<button class="panel-help-btn" id="help-mint-column">?</button>'));
  assert.ok(html.includes('<div id="mint-column-container">'));
  assert.ok(html.includes('<div class="options-column-title">🪙 MINT</div>'));
  const help = html.slice(html.indexOf('<div id="mint-help-overlay" class="info-overlay">'));
  assert.match(help, /<h3 class="info-overlay-title">Mint<\/h3>/);
  for (const line of [
    "creates a fungible token. Your wallet is the treasury and keeps the supply key.",
    "Costs about $1 in HBAR on mainnet.",
    "With no admin key, the token can never be changed.",
    "NFT and Hashinal minting are coming next.",
  ]) assert.ok(help.slice(0, 1200).includes(line), line);
  // Tabs.
  assert.match(html, /<div class="mint-tabs" role="tablist"/);
  for (const [key, label, on] of [["token", "Token", "true"], ["nft", "NFT", "false"], ["hashinal", "Hashinal", "false"]]) {
    assert.match(html, new RegExp(`role="tab" id="mint-tab-${key}" aria-selected="${on}" aria-controls="mint-panel-${key}"[^>]*>${label}</button>`));
  }
  assert.equal((html.match(/<p class="mint-note">Coming next\.<\/p>/g) || []).length, 2);
  assert.ok(html.includes("Your wallet is the treasury and holds the supply key, so you can mint more later. Hedera mainnet, about $1 in HBAR."));
  assert.match(html, /<button type="submit" class="toolbar-column-btns mint-submit" id="mint-create">Create token<\/button>/);
  assert.match(html, /id="mint-decimals" value="8"/);
  // Every list Create's panel and help are in, Mint's are in too.
  const files = ["../cssLogic.js", "../ui.js", "../feedlayout.js"];
  for (const file of files) {
    const src = read(file);
    const creates = src.split(/["']create-column["']/).length - 1;
    const mints = src.split(/["']mint-column["']/).length - 1;
    assert.ok(creates > 0);
    assert.equal(mints, creates, `${file}: mint-column wherever create-column is`);
    assert.equal(src.split(/["']mint-help-overlay["']/).length - 1, src.split(/["']create-topic-help-overlay["']/).length - 1, file);
  }
  const logic = read("../cssLogic.js");
  assert.ok(logic.includes('["mint-column", "mint-help-overlay"],'));
  assert.ok(logic.includes('subColumn("mint-column", "Mint_Token", "toolbar", "toggle-toolbar-btn", ["mint-column-container"]);'));
  assert.match(logic, /document\.getElementById\("Mint_Token"\)\.addEventListener\("click", \(event\) => \{\s*event\.stopPropagation\(\);\s*CloseALL\(\);\s*document\.getElementById\("mint-column"\)\.style\.display = "block";\s*document\.getElementById\("mint-column-container"\)\.style\.display = "block";\s*OpenToggleToolbar\(\);\s*removeUfoModel\(\);/);
  // Loaded after the Inscribe row.
  assert.match(read("../main.js"), /import '\.\/inscribebutton\.js'\nimport '\.\/mintpanel\.js'/);
});

test("mintpanel.js reads only tokenmint.js, toast.js and feedlayout.js's ensureWallet, and adds no fixed px", () => {
  const src = read("../mintpanel.js");
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  const statics = [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(statics, ["./tokenmint.js", "./toast.js"]);
  const lazy = [...code.matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(lazy, ["./feedlayout.js"]);
  assert.equal(/processallmessages|localStorage|fetch\(/.test(code), false);
  const css = read("../style.css");
  const block = css.slice(css.indexOf("/* Mint page (mintpanel.js)"), css.indexOf("/* Update topic: one shared id"));
  assert.ok(block.length > 500);
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /\d(\.\d+)?px/);
  assert.match(block, /#mint-column \.mint-tabs \{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);\s*gap: var\(--ui-gap\);/);
  assert.match(block, /border-radius: var\(--ui-card-radius\);/);
});
