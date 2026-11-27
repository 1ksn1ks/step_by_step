// The Mint panel's Hashinal tab (minthashinal.js): the collection, the
// file, the details and traits, the key choice, the cost line, the confirm
// card, the progress card, the unfinished-run banner and the result card.
// The runner is a stand-in, except in the key test, which runs the real
// hashinaljob.js runner (with a stand-in mint) and checks that the key
// never lands anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PrivateKey } from "@hashgraph/sdk";

// toast.js sets window.toast as it loads; reduced motion makes the cards
// open and close at once.
globalThis.window = { matchMedia: () => ({ matches: true }) };

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const { bindMintPanel } = await import("../mintpanel.js");
const { bindMintNft } = await import("../mintnft.js");
const {
  HASHINAL_APPROVAL_HEAVY,
  HASHINAL_APPROVAL_WARN,
  HASHINAL_KEY_BAD_TEXT,
  HASHINAL_KEEP_OPEN_TEXT,
  HASHINAL_LOST_TEXT,
  HASHINAL_MEMORY_NOTE,
  HASHINAL_OVER_CAP_TEXT,
  HASHINAL_OWN_KEY_WARNING,
  HASHINAL_PERMANENT_TEXT,
  HASHINAL_REFILE_NOTE,
  approvalWarnings,
  bindMintHashinal,
  hashinalSizeText,
  hashinalTotals,
  shortKey,
} = await import("../minthashinal.js");
const { createHashinalRunner, generateOwnKey, loadHashinalJob, parseSubmitKey } = await import("../hashinaljob.js");
const { hashinalUrl } = await import("../hashinalurl.js");

// ── A document just big enough for the panel and its cards ─────────────
// (scripts/mint-nft-panel.test.mjs's, which does not export it)

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
    for (const child of this.children) child.parentNode = null;
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
function findAll(root, test, out = []) {
  if (test(root)) out.push(root);
  for (const child of root.children) findAll(child, test, out);
  return out;
}
const byClass = (root, name) => find(root, (el) => el.className.split(/\s+/).includes(name));
const byText = (root, text) => find(root, (el) => el.tagName === "BUTTON" && el.textContent === text);

// The Mint column as index.html builds it: the tabs, the Token form, and
// the NFT and Hashinal placeholders ("Coming next."). An element made by
// a script is found by its id too.
function page() {
  const doc = { activeElement: null, keys: [], events: new Map(), created: [] };
  doc.createElement = (tag) => {
    const el = new El(doc, tag);
    doc.created.push(el);
    return el;
  };
  doc.body = new El(doc, "body");
  doc.documentElement = new El(doc, "html");
  const ids = new Map();
  doc.getElementById = (id) => ids.get(id) || find(doc.body, (el) => el.id === id);
  doc.addEventListener = (type, fn) => {
    if (type === "keydown") doc.keys.push(fn);
    else doc.events.set(type, [...(doc.events.get(type) || []), fn]);
  };
  doc.removeEventListener = (type, fn) => { doc.keys = doc.keys.filter((f) => f !== fn); };
  const make = (tag, id, parent, props = {}) => {
    const el = new El(doc, tag);
    Object.assign(el, props);
    ids.set(id, el);
    parent.appendChild(el);
    return el;
  };
  const placeholder = (key) => {
    const panel = make("div", `mint-panel-${key}`, column, { hidden: true, className: "mint-card mint-soon" });
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `mint-tab-${key}`);
    const soon = new El(doc, "p");
    soon.className = "mint-note";
    soon.textContent = "Coming next.";
    panel.appendChild(soon);
    return panel;
  };
  const column = make("div", "mint-column", doc.body);
  const tabs = make("div", "mint-tabs", column);
  for (const key of ["token", "nft", "hashinal"]) make("button", `mint-tab-${key}`, tabs, { className: "mint-tab" });
  const form = make("form", "mint-panel-token", column);
  placeholder("nft");
  placeholder("hashinal");
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
  return { doc, $: (id) => ids.get(id) };
}

function stand() {
  const log = [];
  const toast = {
    error: (msg) => log.push(["error", msg]),
    success: (msg) => log.push(["success", msg]),
    info: (msg) => log.push(["info", msg]),
    hold: (msg) => {
      log.push(["hold", msg]);
      return { done: () => log.push(["done", msg]) };
    },
  };
  return { log, toast };
}

// The estimate waits on a 0 ms timer, so a wait lets timers run too.
const tick = (i) => new Promise((resolve) => (i % 4 === 3 ? setTimeout(resolve, 1) : setImmediate(resolve)));
async function waitFor(get) {
  for (let i = 0; i < 800; i += 1) {
    const value = get();
    if (value) return value;
    await tick(i);
  }
  throw new Error("timed out");
}
const flush = async () => {
  for (let i = 0; i < 12; i += 1) await tick(i);
};
const card = (doc, titleId) => doc.body.children.find((el) => el.getAttribute("aria-labelledby") === titleId);
const rowsOf = (dialog) => byClass(dialog, "onboard-rows").children
  .map((row) => [row.children[0].textContent, row.children[1].textContent, row.className.includes("is-warn")]);
const typeIn = (input, value) => {
  input.value = value;
  input.dispatch("input");
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// ── Stand-ins ──────────────────────────────────────────────────────────

const ME = "0.0.7";
const CATS = { tokenId: "0.0.900", name: "Cats", symbol: "CAT", totalSupply: "12", maxSupply: "10000" };
// A key that looks like Create keys' output; the stand-in parser reads it.
const PRIV = `302e020100300506032b657004220420${"ab".repeat(32)}`;
const PUB = `302a300506032b6570032100${"cd".repeat(32)}`;
const KEY = { publicKey: { toString: () => PUB }, isKey: true };
const PNG = { name: "cat.png", type: "image/png", size: 312 * 1024 };
const MP4 = { name: "clip.mp4", type: "video/mp4", size: 900 * 1024 };
const BIG = { name: "huge.png", type: "image/png", size: 3 * 1024 * 1024 };
const QUOTE = {
  file: { txCount: 7, usd: 0.07 },
  meta: { txCount: 2, usd: 0.0108 },
  mint: { txCount: 1, usd: 0.02 },
  total: { approvals: 10, usd: 0.1008 },
};
const quoteOf = (approvals) => ({
  file: { txCount: approvals - 3, usd: 1 },
  meta: { txCount: 2, usd: 0.0108 },
  mint: { txCount: 1, usd: 0.02 },
  total: { approvals, usd: 1.0308 },
});
const DONE = {
  tokenId: "0.0.900",
  serial: "7",
  fileTopicId: "0.0.501",
  metaTopicId: "0.0.502",
  txId: "0.0.7@1700000000.000000001",
  hashscanUrl: "https://hashscan.io/mainnet/transaction/0.0.7-1700000000-000000001",
};

function preparedFor(file) {
  return {
    bytes: new Uint8Array(file.preparedSize ?? file.size),
    mime: file.preparedMime ?? file.type,
    name: file.name,
    overCap: file.size > 2 * 1024 * 1024,
    txCount: 7,
    usd: 0.07,
  };
}

function fakeParse(text) {
  if (String(text).trim() === PRIV) return { key: KEY, publicKey: PUB, type: "ED25519" };
  const err = new Error("That is not a private key we can read");
  err.userFacing = true;
  throw err;
}

// A runner that records its calls; the test sends its events.
function fakeRunners(base = {}, hooks = {}) {
  const made = [];
  const createRunner = (options) => {
    const listeners = new Map();
    let state = {
      status: "idle",
      reason: "",
      step: "",
      needs: null,
      keyMode: "",
      publicKey: "",
      topics: { file: null, meta: null },
      progress: { step: "", sent: 0, total: 0, approvalsDone: 0, approvalsTotal: 0 },
      result: null,
      ...base,
    };
    let holding = false;
    const call = (name, input) => {
      runner.calls.push(name);
      runner.inputs.push(input);
      const next = runner.answers[name];
      return next ? next(input) : Promise.resolve({ ...state });
    };
    const runner = {
      options,
      calls: [],
      inputs: [],
      answers: {},
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return () => listeners.get(event).delete(fn);
      },
      emit(event, payload) {
        if (event === "status") state = { ...state, ...payload };
        if (event === "progress") state = { ...state, progress: { ...state.progress, ...payload } };
        for (const fn of [...(listeners.get(event) || [])]) fn(payload);
      },
      set(next) { state = { ...state, ...next }; },
      hold(on) { holding = on; },
      snapshot: () => ({ ...state }),
      holdsKey: () => holding,
      start: (input) => call("start", input),
      resume: (input) => call("resume", input),
      check: () => call("check"),
      forceRemint: () => call("forceRemint"),
      dismiss() {
        runner.calls.push("dismiss");
        state = { ...state, status: "idle", needs: null };
        if (hooks.onDismiss) hooks.onDismiss();
        return { ...state };
      },
    };
    made.push(runner);
    return runner;
  };
  return { made, createRunner };
}

function fakeWindow() {
  const win = {
    listeners: [],
    addEventListener(type, fn) { win.listeners.push([type, fn]); },
    removeEventListener(type, fn) { win.listeners = win.listeners.filter(([t, f]) => !(t === type && f === fn)); },
    unloads: () => win.listeners.filter(([t]) => t === "beforeunload").length,
  };
  return win;
}

function fakeUrls() {
  const urls = {
    made: [],
    revoked: [],
    createObjectURL(blob) {
      const url = `blob:test/${urls.made.length + 1}`;
      urls.made.push([url, blob]);
      return url;
    },
    revokeObjectURL(url) { urls.revoked.push(url); },
  };
  return urls;
}

// The Hashinal tab bound with stand-ins. extra replaces any of them.
function hashinalTab(extra = {}) {
  const { doc, $ } = page();
  const { log, toast } = stand();
  let job = extra.job || null;
  const run = fakeRunners(extra.state, { onDismiss: () => { job = null; } });
  const calls = { listed: [], flights: [], prepared: [], estimated: [], wallet: 0, generated: 0 };
  const win = fakeWindow();
  const urls = fakeUrls();
  const options = {
    doc,
    toast,
    ensureWallet: async () => {
      calls.wallet += 1;
      return extra.wallet || "ok";
    },
    getAccount: async () => {
      if (typeof extra.account === "function") return extra.account();
      return extra.account == null ? ME : extra.account;
    },
    createRunner: extra.createRunner || run.createRunner,
    prepare: async (file) => {
      calls.prepared.push(file);
      return preparedFor(file);
    },
    estimate: async (input) => {
      calls.estimated.push(input);
      if (extra.estimate) return extra.estimate(input);
      return extra.quote || QUOTE;
    },
    loadJob: extra.loadJob || ((account) => (account === ME ? job : null)),
    listCollections: async (account) => {
      calls.listed.push(account);
      if (extra.listError && calls.listed.length === 1) throw new Error("Could not read your collections");
      return extra.collections || [CATS];
    },
    preflight: async (tokenId, account) => {
      calls.flights.push([tokenId, account]);
      return (extra.flight && extra.flight(tokenId)) || { ok: true, reason: "", remaining: "5" };
    },
    parseKey: extra.parseKey || fakeParse,
    generateKey: extra.generateKey || (async () => {
      calls.generated += 1;
      return { privateKey: PRIV, publicKey: PUB };
    }),
    storage: extra.storage || "STORE",
    clipboard: extra.clipboard,
    urls,
    win,
    estimateDelay: 0,
  };
  bindMintPanel({ doc, ensureWallet: options.ensureWallet, createToken: async () => ({}), toast });
  if (extra.nft) {
    bindMintNft({
      doc,
      toast,
      ensureWallet: async () => "ok",
      getAccount: async () => ME,
      listCollections: async () => [],
      readSupply: async () => ({}),
      createMinter: () => ({}),
      listJobs: () => [],
      storage: "STORE",
    });
  }
  const tab = bindMintHashinal(options);
  return { doc, $, tab, log, calls, run, win, urls, setJob: (next) => { job = next; } };
}

async function pick(t, file, input = t.tab.els.picker) {
  input.files = [file];
  input.dispatch("change");
  if (input === t.tab.els.picker) await waitFor(() => !t.tab.els.fileBox.hidden || !t.tab.els.fileError.hidden);
}

// A collection chosen and checked, a file, and a name: ready to start.
async function ready(t, { file = PNG, name = "Cat #1" } = {}) {
  const { els } = t.tab;
  await t.tab.loadCollections();
  els.select.value = "0.0.900";
  els.select.dispatch("change");
  await waitFor(() => els.supplyLine.textContent === "5 left");
  await pick(t, file);
  typeIn(els.nameInput, name);
  await waitFor(() => /wallet approvals/.test(els.totalsLine.textContent));
}

// Start, its card, Start again: the runner's start is answered by answer
// (by default it stays in flight, like a real run). Returns the runner.
async function startRun(t, answer) {
  t.tab.els.startBtn.click();
  const confirm = await waitFor(() => card(t.doc, "mint-hashinal-confirm-title"));
  // The runner is made after the wallet step, before the card.
  const runner = t.run.made[0];
  const before = runner.calls.length;
  runner.answers.start = answer || (() => deferred().promise);
  byText(confirm, "Start").click();
  await waitFor(() => runner.calls.length > before);
  return runner;
}

// ── Building ───────────────────────────────────────────────────────────

test("the tab replaces only the placeholder's content: the element, its id, role and aria stay", () => {
  const { $, tab } = hashinalTab();
  const panel = $("mint-panel-hashinal");
  assert.equal(tab.els.panel, panel);
  assert.equal(panel.getAttribute("role"), "tabpanel");
  assert.equal(panel.getAttribute("aria-labelledby"), "mint-tab-hashinal");
  assert.equal(panel.textContent.includes("Coming next."), false);
  assert.equal(panel.classList.contains("mint-soon"), false);
  assert.ok(panel.classList.contains("mint-hashinal"));
  assert.equal(panel.hidden, true);
  // The Token form and the NFT placeholder are left as they were.
  assert.equal($("mint-panel-token").hidden, false);
  assert.equal($("mint-panel-nft").textContent, "Coming next.");
  assert.ok($("mint-panel-nft").classList.contains("mint-soon"));
  // The order, top to bottom: banner, run card, then the form's five cards.
  assert.deepEqual(panel.children.map((el) => el.className), ["mint-card mint-resume", "mint-card mint-progress", "mint-form"]);
  assert.equal(tab.els.form.children.length, 5);
  assert.equal(tab.els.banner.getAttribute("role"), "status");
  assert.equal(tab.els.banner.hidden, true);
  assert.equal(tab.els.progress.hidden, true);
  assert.equal(tab.els.startBtn.id, "mint-hashinal-start");
  assert.equal(tab.els.startBtn.className, "toolbar-column-btns mint-submit");
  assert.equal(tab.els.startBtn.getAttribute("aria-describedby"), "mint-hashinal-start-hint");
  assert.equal(tab.els.startBtn.disabled, true);
  assert.equal(tab.els.startHint.textContent, "Choose a collection");
  assert.equal(tab.els.select.id, "mint-hashinal-collection");
  assert.ok(tab.els.memoryNote.textContent === HASHINAL_MEMORY_NOTE && !tab.els.memoryNote.hidden);
  assert.equal(tab.els.ownPanel.hidden, true);
  assert.ok(tab.els.ownPanel.textContent.includes(HASHINAL_OWN_KEY_WARNING));
});

test("opening the tab is the tap: nothing loads before it, collections and the banner load after the wallet step", async () => {
  const t = hashinalTab();
  const { $, calls, tab } = t;
  await flush();
  assert.equal(calls.wallet, 0);
  assert.deepEqual(calls.listed, []);
  $("mint-tab-hashinal").click();
  await waitFor(() => calls.listed.length);
  assert.equal(calls.wallet, 1);
  assert.deepEqual(calls.listed, [ME]);
  await flush();
  assert.deepEqual(tab.els.select.children.map((o) => [o.value, o.textContent]), [
    ["", "Choose a collection"],
    ["0.0.900", "Cats (CAT) · 0.0.900 · 12/10,000"],
  ]);
  assert.equal(tab.els.listStatus.hidden, true);
  // Back to the tab later: the list is kept, no second wallet step.
  $("mint-tab-token").click();
  $("mint-tab-hashinal").click();
  await flush();
  assert.equal(calls.wallet, 1);
});

test("collections: Retry after a failure, connect when the wallet is closed, and no collections yet", async () => {
  const t = hashinalTab({ listError: true });
  const { els } = t.tab;
  assert.equal(await t.tab.loadCollections(), "fail");
  assert.equal(els.listStatus.textContent, "Couldn't load your collections");
  assert.equal(els.retryBtn.hidden, false);
  els.retryBtn.click();
  await waitFor(() => t.calls.listed.length === 2);
  await flush();
  assert.equal(els.select.children.length, 2);
  assert.equal(els.retryBtn.hidden, true);

  const closed = hashinalTab({ wallet: "cancel" });
  assert.equal(await closed.tab.loadCollections(), "cancel");
  assert.equal(closed.tab.els.listStatus.textContent, "Connect your wallet to see your collections.");
  assert.equal(closed.tab.els.retryBtn.hidden, false);

  const none = hashinalTab({ collections: [] });
  await none.tab.loadCollections();
  assert.equal(none.tab.els.listStatus.textContent, "No collections yet. Create one, or paste a token id.");
  assert.equal(none.tab.els.select.children[0].textContent, "No collections yet");
});

test("a pasted id wins over the list, and the check reads N left or no limit", async () => {
  const t = hashinalTab({ flight: (tokenId) => (tokenId === "0.0.555" ? { ok: true, reason: "", remaining: null } : null) });
  const { els } = t.tab;
  await t.tab.loadCollections();
  els.select.value = "0.0.900";
  els.select.dispatch("change");
  await waitFor(() => els.supplyLine.textContent === "5 left");
  els.tokenInput.value = "0.0.555";
  els.tokenInput.dispatch("change");
  await waitFor(() => els.supplyLine.textContent === "No supply limit");
  assert.deepEqual(t.calls.flights.at(-1), ["0.0.555", ME]);
  els.tokenInput.value = "0.0.x";
  els.tokenInput.dispatch("change");
  await flush();
  assert.equal(els.startHint.textContent, "Enter a token id like 0.0.123");
});

test("a collection that fails the check shows its reason and keeps Start off", async () => {
  const reason = "Your wallet is not the treasury of this collection";
  const t = hashinalTab({ flight: () => ({ ok: false, reason, remaining: null }) });
  const { els } = t.tab;
  await t.tab.loadCollections();
  els.select.value = "0.0.900";
  els.select.dispatch("change");
  await waitFor(() => !els.flightWarning.hidden);
  assert.equal(els.flightWarning.textContent, reason);
  assert.ok(els.flightWarning.className.includes("mint-warning"));
  assert.equal(els.supplyLine.hidden, true);
  await pick(t, PNG);
  typeIn(els.nameInput, "Cat #1");
  await flush();
  assert.equal(els.startHint.textContent, reason);
  assert.equal(els.startBtn.disabled, true);
  assert.equal(await t.tab.runStart(), "blocked");
  assert.deepEqual(t.run.made.flatMap((r) => r.calls), []);
});

test("New collection clicks the NFT tab, then its New collection mode", async () => {
  const t = hashinalTab({ nft: true });
  const { doc, $ } = t;
  const order = [];
  $("mint-tab-nft").addEventListener("click", () => order.push("tab"));
  const modeNew = doc.getElementById("mint-nft-mode-new");
  const modeMint = doc.getElementById("mint-nft-mode-mint");
  modeNew.addEventListener("click", () => order.push("mode"));
  modeMint.click();
  assert.equal(modeNew.getAttribute("aria-checked"), "false");
  $("mint-tab-hashinal").click();
  assert.equal($("mint-panel-hashinal").hidden, false);
  t.tab.els.newCollectionBtn.click();
  assert.deepEqual(order, ["tab", "mode"]);
  assert.equal($("mint-panel-nft").hidden, false);
  assert.equal($("mint-panel-hashinal").hidden, true);
  assert.equal($("mint-tab-nft").getAttribute("aria-selected"), "true");
  assert.equal(modeNew.getAttribute("aria-checked"), "true");
  // No form of its own.
  assert.equal(find(t.tab.els.panel, (el) => el.id === "mint-nft-create"), null);
});

// ── The file ───────────────────────────────────────────────────────────

test("a picked picture: one prepare, a preview tile, its size, resized when over the edge; Remove revokes the preview", async () => {
  const t = hashinalTab();
  const { els } = t.tab;
  assert.equal(els.picker.accept, "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.glb,.gltf,model/gltf-binary,model/gltf+json");
  assert.equal(els.picker.parentNode, t.doc.body);
  assert.equal(els.picker.hidden, true);
  // The toolbar's CloseALL never sees the picker's click.
  let stopped = false;
  els.picker.dispatch("click", { stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  // Choose file opens the picker in the same tap.
  let opened = 0;
  els.picker.addEventListener("click", () => { opened += 1; });
  els.chooseBtn.click();
  assert.equal(opened, 1);

  els.picker.files = [PNG];
  els.picker.dispatch("change");
  assert.equal(els.fileStatus.textContent, "Reading the file…");
  assert.equal(els.fileStatus.hidden, false);
  await waitFor(() => !els.fileBox.hidden);
  assert.deepEqual(t.calls.prepared, [PNG]);
  assert.equal(els.fileStatus.hidden, true);
  const tile = els.tileSlot.children[0];
  assert.equal(tile.tagName, "IMG");
  assert.equal(tile.className, "mint-file-tile");
  assert.equal(tile.src, "blob:test/1");
  assert.equal(tile.alt, "Preview of cat.png");
  assert.equal(els.fileName.textContent, "cat.png");
  assert.equal(els.fileMeta.textContent, "312 KB");
  tile.naturalWidth = 4000;
  tile.naturalHeight = 3000;
  tile.dispatch("load");
  assert.equal(els.fileMeta.textContent, "312 KB, resized to 2048 px");
  assert.equal(els.overCapLine.hidden, true);

  els.removeFileBtn.click();
  assert.equal(els.fileBox.hidden, true);
  assert.deepEqual(t.urls.revoked, ["blob:test/1"]);
  assert.equal(els.tileSlot.children.length, 0);
  assert.equal(els.startHint.textContent, "Choose a collection");

  // A video or a 3D file is a text tile, with no object URL.
  await pick(t, MP4);
  assert.equal(els.tileSlot.children[0].tagName, "DIV");
  assert.equal(els.tileSlot.children[0].className, "mint-file-tile is-text");
  assert.equal(els.tileSlot.children[0].textContent, "Video · video/mp4");
  await pick(t, { name: "ship.glb", type: "", size: 2048 });
  assert.equal(els.tileSlot.children[0].textContent, "3D model");
  assert.equal(t.urls.made.length, 1);
});

test("a file over 2 MB shows the limit and keeps Start off", async () => {
  const t = hashinalTab();
  const { els } = t.tab;
  await t.tab.loadCollections();
  els.select.value = "0.0.900";
  els.select.dispatch("change");
  await waitFor(() => els.supplyLine.textContent === "5 left");
  typeIn(els.nameInput, "Huge");
  await pick(t, BIG);
  assert.equal(els.overCapLine.hidden, false);
  assert.equal(els.overCapLine.textContent, HASHINAL_OVER_CAP_TEXT);
  assert.equal(HASHINAL_OVER_CAP_TEXT, "This file is over 2 MB, the limit for a Hashinal.");
  assert.equal(els.fileMeta.textContent, "3 MB");
  assert.equal(els.startHint.textContent, HASHINAL_OVER_CAP_TEXT);
  assert.equal(els.startBtn.disabled, true);
  await flush();
  assert.deepEqual(t.calls.estimated, []);
});

test("own key: a re-encoded picture can be saved as the prepared copy", async () => {
  const t = hashinalTab();
  const { els } = t.tab;
  await pick(t, { ...PNG, preparedSize: 200 * 1024, preparedMime: "image/webp" });
  assert.equal(els.savePreparedBtn.hidden, true);
  els.keyOwn.click();
  assert.equal(els.savePreparedBtn.hidden, false);
  els.savePreparedBtn.click();
  const [url, blob] = t.urls.made.at(-1);
  assert.equal(blob.type, "image/webp");
  assert.equal(blob.size, 200 * 1024);
  const anchor = t.doc.created.find((el) => el.tagName === "A" && el.href === url);
  assert.equal(anchor.download, "hashinal-prepared-cat.png");
  assert.equal(anchor.parentNode, null);
  // The file as picked needs no copy.
  await pick(t, PNG);
  assert.equal(els.savePreparedBtn.hidden, true);
});

// ── The details ────────────────────────────────────────────────────────

test("details: hashinalmint.js's own words, tagged to the field; a byte counter; up to 50 traits", async () => {
  const t = hashinalTab();
  const { els } = t.tab;
  await ready(t);
  typeIn(els.nameInput, "x".repeat(101));
  assert.equal(els.detailsError.textContent, "Name must be 1 to 100 bytes");
  assert.equal(els.nameInput.getAttribute("aria-invalid"), "true");
  typeIn(els.nameInput, "");
  // An empty name waits until the field is left.
  assert.equal(els.detailsError.hidden, true);
  assert.equal(els.startHint.textContent, "Add a name");
  assert.equal(els.totalsLine.textContent, "Add a name to see the cost.");
  els.nameInput.dispatch("blur");
  assert.equal(els.detailsError.textContent, "Name must be 1 to 100 bytes");
  typeIn(els.nameInput, "Cat #1");
  assert.equal(els.nameInput.getAttribute("aria-invalid"), null);

  typeIn(els.description, "é".repeat(501));
  assert.equal(els.descriptionCount.textContent, "1,002 / 1,000 bytes");
  assert.equal(els.descriptionCount.className, "mint-error mint-bytes");
  assert.equal(els.detailsError.textContent, "Description must be 1000 bytes or less");
  assert.equal(els.description.getAttribute("aria-invalid"), "true");
  typeIn(els.description, "A cat");
  assert.equal(els.descriptionCount.textContent, "5 / 1,000 bytes");
  assert.equal(els.descriptionCount.className, "mint-note mint-bytes");

  typeIn(els.creatorInput, "c".repeat(101));
  assert.equal(els.detailsError.textContent, "Creator must be 100 bytes or less");
  assert.equal(els.creatorInput.getAttribute("aria-invalid"), "true");
  typeIn(els.creatorInput, "Me");

  // Traits: + Add trait focuses the new name; Enter moves name, value, next.
  els.addTraitBtn.click();
  const first = t.tab.traits[0];
  assert.equal(t.doc.activeElement, first.name);
  assert.equal(first.name.getAttribute("aria-label"), "Trait 1 name");
  assert.equal(first.remove.getAttribute("aria-label"), "Remove trait 1");
  assert.equal(first.wrap.className, "mint-trait-row");
  assert.equal(first.wrap.getAttribute("data-no-clear"), "");
  typeIn(first.name, "Eyes");
  first.name.dispatch("keydown", { key: "Enter" });
  assert.equal(t.doc.activeElement, first.value);
  typeIn(first.value, "Green");
  first.value.dispatch("keydown", { key: "Enter" });
  assert.equal(t.tab.traits.length, 2);
  assert.equal(t.doc.activeElement, t.tab.traits[1].name);
  typeIn(t.tab.traits[1].name, "n".repeat(101));
  assert.equal(els.detailsError.textContent, "Trait names must be 100 bytes or less");
  assert.equal(t.tab.traits[1].name.getAttribute("aria-invalid"), "true");
  t.tab.traits[1].remove.click();
  assert.equal(t.tab.traits.length, 1);
  assert.equal(t.doc.activeElement, first.name);
  assert.equal(els.detailsError.hidden, true);
  while (t.tab.traits.length < 50) t.tab.addTrait();
  assert.equal(els.addTraitBtn.disabled, true);
  assert.equal(els.traitNote.hidden, false);
  assert.equal(t.tab.addTrait(), null);
  t.tab.traits.at(-1).remove.click();
  assert.equal(els.addTraitBtn.disabled, false);
  // What the cost was worked out from: the typed traits.
  await waitFor(() => t.calls.estimated.at(-1).attributes.length === 49);
  assert.deepEqual(t.calls.estimated.at(-1).attributes[0], { trait_type: "Eyes", value: "Green" });
});

// ── The cost ───────────────────────────────────────────────────────────

test("the cost line comes from the estimate, the HashPack tip above 50 approvals and the heavy line above 500", async () => {
  assert.equal(HASHINAL_APPROVAL_WARN, 50);
  assert.equal(HASHINAL_APPROVAL_HEAVY, 500);
  let next = QUOTE;
  const t = hashinalTab({ estimate: () => next });
  const { els } = t.tab;
  await ready(t);
  assert.equal(els.totalsLine.textContent, "10 wallet approvals, ≈ $0.1008: file 7 + details 2 + 1 mint");
  assert.equal(els.approvalsLine.hidden, true);
  assert.equal(els.heavyLine.hidden, true);
  assert.deepEqual(t.calls.estimated.at(-1), {
    prepared: t.calls.estimated.at(-1).prepared,
    name: "Cat #1",
    description: "",
    creator: "",
    attributes: [],
  });

  next = quoteOf(51);
  typeIn(els.nameInput, "Cat #2");
  await waitFor(() => els.totalsLine.textContent.startsWith("51 "));
  assert.equal(els.approvalsLine.hidden, false);
  assert.equal(els.approvalsLine.children[0].tagName, "STRONG");
  assert.equal(els.approvalsLine.textContent, "This takes 51 wallet approvals. Turn on auto-approve in HashPack first, or you will confirm every one.");
  assert.equal(els.heavyLine.hidden, true);

  next = quoteOf(501);
  typeIn(els.nameInput, "Cat #3");
  await waitFor(() => els.totalsLine.textContent.startsWith("501 "));
  assert.equal(els.heavyLine.hidden, false);
  assert.equal(els.heavyLine.textContent, "That is a lot. A smaller file is much cheaper and faster.");
  assert.deepEqual(approvalWarnings(50), []);
});

test("a slow estimate for older fields is dropped", async () => {
  const slow = deferred();
  let calls = 0;
  const t = hashinalTab({
    estimate: () => {
      calls += 1;
      return calls === 1 ? slow.promise : QUOTE;
    },
  });
  const { els } = t.tab;
  await pick(t, PNG);
  typeIn(els.nameInput, "First");
  await waitFor(() => calls === 1);
  typeIn(els.nameInput, "Second");
  await waitFor(() => els.totalsLine.textContent.startsWith("10 "));
  slow.resolve(quoteOf(999));
  await flush();
  assert.ok(els.totalsLine.textContent.startsWith("10 "));
});

// ── The key ────────────────────────────────────────────────────────────

test("own key: Generate shows both keys, Copy and Download work, Start waits for I saved this key", async () => {
  const written = [];
  const t = hashinalTab({ clipboard: { writeText: async (text) => { written.push(text); } } });
  const { els } = t.tab;
  await ready(t);
  assert.equal(els.startHint.textContent, "");
  assert.equal(els.startBtn.disabled, false);
  els.keyOwn.click();
  assert.equal(els.keyOwn.getAttribute("aria-checked"), "true");
  assert.equal(els.keyMemory.getAttribute("aria-checked"), "false");
  assert.equal(els.memoryNote.hidden, true);
  assert.equal(els.ownPanel.hidden, false);
  assert.equal(els.startHint.textContent, "Generate a key, or paste one");
  assert.equal(els.startBtn.disabled, true);

  els.generateBtn.click();
  await waitFor(() => els.privateArea.value);
  assert.equal(t.calls.generated, 1);
  assert.equal(els.publicArea.value, PUB);
  assert.equal(els.privateArea.value, PRIV);
  assert.equal(els.publicArea.readOnly, true);
  assert.equal(els.privateArea.readOnly, true);
  assert.equal(els.generated.hidden, false);
  const labels = findAll(els.generated, (el) => el.tagName === "LABEL").map((el) => [el.textContent, el.htmlFor]);
  assert.deepEqual(labels, [["Public Key", "mint-hashinal-public"], ["Private Key", "mint-hashinal-private"]]);
  assert.equal(els.startHint.textContent, "Turn on “I saved this key”");
  assert.equal(els.startBtn.disabled, true);

  els.copyKeyBtn.click();
  await waitFor(() => written.length);
  assert.deepEqual(written, [PRIV]);
  assert.equal(els.copyKeyBtn.textContent, "Copied");

  els.downloadKeyBtn.click();
  const [url, blob] = t.urls.made.at(-1);
  assert.equal(await blob.text(), `Public Key: ${PUB}\nPrivate Key: ${PRIV}\n`);
  const anchor = t.doc.created.find((el) => el.tagName === "A" && el.href === url);
  assert.equal(anchor.download, "hashinal-key.txt");
  assert.equal(anchor.parentNode, null);

  els.savedSwitch.click();
  assert.equal(els.savedSwitch.getAttribute("aria-checked"), "true");
  assert.equal(els.startHint.textContent, "");
  assert.equal(els.startBtn.disabled, false);

  // Remove key empties both and turns the switch off.
  els.removeKeyBtn.click();
  assert.equal(els.privateArea.value, "");
  assert.equal(els.publicArea.value, "");
  assert.equal(els.savedSwitch.getAttribute("aria-checked"), "false");
  assert.equal(els.generated.hidden, true);
  assert.equal(els.startBtn.disabled, true);
});

test("a pasted key: a bad one is an inline error, a good one shows only its public key", async () => {
  const t = hashinalTab();
  const { els } = t.tab;
  await ready(t);
  els.keyOwn.click();
  assert.equal(els.pasteInput.type, "password");
  assert.equal(els.pasteInput.autocomplete, "off");
  assert.equal(els.pasteInput.spellcheck, false);
  assert.equal(els.pasteInput.name, undefined);
  assert.equal(els.pasteWrap.getAttribute("data-no-clear"), "");
  typeIn(els.pasteInput, "not a key");
  // Not until the field is left.
  assert.equal(els.pasteError.hidden, true);
  assert.equal(els.startHint.textContent, HASHINAL_KEY_BAD_TEXT);
  els.pasteInput.dispatch("blur");
  assert.equal(els.pasteError.hidden, false);
  assert.equal(els.pasteError.className, "mint-error");
  assert.equal(els.pasteError.textContent, "That is not a private key we can read");
  assert.equal(els.pasteInput.getAttribute("aria-invalid"), "true");
  assert.equal(els.startBtn.disabled, true);

  typeIn(els.pasteInput, PRIV);
  els.pasteInput.dispatch("blur");
  assert.equal(els.pasteError.hidden, true);
  assert.equal(els.pasteInput.getAttribute("aria-invalid"), null);
  assert.equal(els.pastePublic.hidden, false);
  assert.equal(els.pastePublic.className, "mint-key");
  assert.equal(els.pastePublic.textContent, `Public key ${PUB}`);
  // A pasted key needs no switch.
  assert.equal(els.startHint.textContent, "");
  assert.equal(els.startBtn.disabled, false);
  assert.equal(shortKey(PUB), "302a…cdcd");
});

// ── The confirm card and Start ─────────────────────────────────────────

test("the confirm card (key kept in this tab), and Start runs the runner only after its accept", async () => {
  const t = hashinalTab();
  const { doc } = t;
  const { els } = t.tab;
  await ready(t);
  els.startBtn.click();
  const confirm = await waitFor(() => card(doc, "mint-hashinal-confirm-title"));
  assert.equal(byClass(confirm, "onboard-title").textContent, "Before you inscribe and mint");
  assert.deepEqual(rowsOf(confirm), [
    ["Collection", "Cats (CAT) · 0.0.900", false],
    ["File", "cat.png, 312 KB", false],
    ["Name", "Cat #1", false],
    ["Approvals", "10: file 7 + details 2 + 1 mint", false],
    ["Estimated fee", "≈ $0.1008 in HBAR, paid by your wallet", false],
    ["Key", "Kept in this tab", false],
    ["Permanent", HASHINAL_PERMANENT_TEXT, true],
  ]);
  assert.equal(HASHINAL_PERMANENT_TEXT, "The inscriptions have no admin key and cannot be edited or deleted.");
  assert.deepEqual(byClass(confirm, "onboard-nav").children.map((b) => b.textContent), ["Not now", "Start"]);
  byText(confirm, "Not now").click();
  await flush();
  assert.deepEqual(t.run.made.flatMap((r) => r.calls), []);
  assert.equal(els.form.hidden, false);

  const runner = await startRun(t);
  assert.equal(t.run.made.length, 1);
  assert.deepEqual(runner.options, { accountId: ME, storage: "STORE" });
  assert.deepEqual(runner.calls, ["start"]);
  const input = runner.inputs[0];
  assert.deepEqual(Object.keys(input), ["tokenId", "prepared", "name", "description", "creator", "attributes", "keyMode"]);
  assert.equal(input.tokenId, "0.0.900");
  // The bytes prepared at the pick, not a second prepare.
  assert.equal(t.calls.prepared.length, 1);
  assert.equal(input.prepared.name, "cat.png");
  assert.equal(input.prepared.bytes.byteLength, PNG.size);
  assert.equal(input.name, "Cat #1");
  assert.equal(input.keyMode, "memory");
  assert.deepEqual(input.attributes, []);
  assert.equal(els.form.hidden, true);
  assert.equal(els.progress.hidden, false);
});

test("the confirm card with your own key: its first and last four characters, the tip and the key warning", async () => {
  const t = hashinalTab({ quote: quoteOf(60) });
  const { els } = t.tab;
  await ready(t);
  els.keyOwn.click();
  typeIn(els.pasteInput, PRIV);
  els.pasteInput.dispatch("blur");
  els.startBtn.click();
  const confirm = await waitFor(() => card(t.doc, "mint-hashinal-confirm-title"));
  const rows = rowsOf(confirm);
  assert.deepEqual(rows.find(([name]) => name === "Key"), ["Key", "Your own key (public key 302a…cdcd)", false]);
  assert.deepEqual(rows.slice(-3), [
    ["Permanent", HASHINAL_PERMANENT_TEXT, true],
    ["Auto-approve", "This takes 60 wallet approvals. Turn on auto-approve in HashPack first, or you will confirm every one.", true],
    ["Your key", "Keep your key private until you are done, then delete it.", true],
  ]);
  assert.equal(confirm.textContent.includes(PUB), false);
  assert.equal(confirm.textContent.includes(PRIV), false);
  t.run.made[0].answers.start = () => deferred().promise;
  byText(confirm, "Start").click();
  await waitFor(() => t.run.made[0].calls.length);
  const input = t.run.made[0].inputs[0];
  assert.equal(input.keyMode, "own");
  assert.equal(input.submitKey, KEY);
});

test("a saved unfinished run is finished or dismissed before a new start", async () => {
  const t = hashinalTab({ job: { accountId: ME, tokenId: "0.0.900", status: "paused", step: "file", keyMode: "memory", reason: "Wallet declined", topics: { file: { topicId: "0.0.501", total: 3 }, meta: null } } });
  await ready(t);
  assert.equal(await t.tab.runStart(), "saved");
  assert.deepEqual(t.log.at(-1), ["info", "Finish or dismiss the unfinished Hashinal first"]);
  assert.equal(t.tab.els.banner.hidden, false);
  assert.equal(card(t.doc, "mint-hashinal-confirm-title"), undefined);
});

test("an early refusal goes back to the form with the runner's own words; a declined wallet stays quiet", async () => {
  const t = hashinalTab();
  const { els } = t.tab;
  const errors = () => t.log.filter(([kind]) => kind === "error");
  await ready(t);
  const err = new Error("Name must be 1 to 100 bytes");
  err.userFacing = true;
  await startRun(t, () => Promise.reject(err));
  await waitFor(() => errors().length);
  await flush();
  assert.deepEqual(errors(), [["error", "Name must be 1 to 100 bytes"]]);
  assert.equal(els.form.hidden, false);
  assert.equal(els.progress.hidden, true);
  assert.equal(els.startError.textContent, "Name must be 1 to 100 bytes");
  assert.equal(els.nameInput.getAttribute("aria-invalid"), "true");

  await startRun(t, () => Promise.reject(new Error("User rejected the request")));
  await flush();
  assert.equal(errors().length, 1);
  assert.equal(els.form.hidden, false);

  // Another error's own text is never shown: it could hold anything.
  await startRun(t, () => Promise.reject(new Error(`boom ${PRIV}`)));
  await waitFor(() => errors().length === 2);
  assert.deepEqual(t.log.at(-1), ["error", "Hashinal mint failed. Nothing was charged if your wallet did not approve."]);
  // Even the app's own words are dropped when they look like a key.
  const keyish = new Error(`Bad ${PRIV}`);
  keyish.userFacing = true;
  await startRun(t, () => Promise.reject(keyish));
  await waitFor(() => errors().length === 3);
  assert.deepEqual(t.log.at(-1), ["error", "Hashinal mint failed. Nothing was charged if your wallet did not approve."]);
});

// ── The progress card ──────────────────────────────────────────────────

test("progress events move the three steps and the bar; beforeunload is on only while the runner holds a key", async () => {
  const t = hashinalTab();
  const { els } = t.tab;
  await ready(t);
  els.startBtn.click();
  const run = deferred();
  const confirm = await waitFor(() => card(t.doc, "mint-hashinal-confirm-title"));
  // The runner is made after the wallet step, before the card.
  t.run.made[0].answers.start = () => run.promise;
  byText(confirm, "Start").click();
  await waitFor(() => t.run.made[0].calls.length);
  const runner = t.run.made[0];
  const stepsNow = () => ["file", "meta", "mint"].map((step) => [els.stepRows[step].className, els.stepRows[step].textContent]);
  assert.equal(els.progressTitle.textContent, "Inscribing and minting into 0.0.900");
  assert.equal(els.steps.tagName, "OL");
  assert.deepEqual(stepsNow(), [
    ["mint-step is-now", "Inscribing the file, 0 of 7"],
    ["mint-step is-wait", "Inscribing the details, 0 of 2"],
    ["mint-step is-wait", "Minting your NFT"],
  ]);
  assert.equal(els.stepRows.file.getAttribute("aria-current"), "step");
  assert.equal(els.bar.getAttribute("role"), "progressbar");
  assert.equal(els.bar.getAttribute("aria-label"), "Inscribing and minting progress");
  assert.equal(els.bar.getAttribute("aria-valuemin"), "0");
  assert.equal(els.bar.getAttribute("aria-valuemax"), "10");
  assert.equal(els.bar.getAttribute("aria-valuenow"), "0");
  assert.equal(els.progressStatus.getAttribute("aria-live"), "polite");
  assert.equal(els.progressStatus.textContent, "Waiting for your wallet: approval 1 of 10");
  assert.equal(els.closeBtn.hidden, true);
  assert.equal(t.win.unloads(), 0);

  runner.emit("status", { status: "running", reason: "" });
  runner.emit("topic", { step: "file", topicId: "0.0.501", memo: "m", total: 6 });
  assert.equal(els.stepRows.file.textContent, "Inscribing the file, 1 of 7");
  runner.hold(true);
  runner.emit("progress", { step: "file", sent: 3, total: 6, approvalsDone: 4, approvalsTotal: 8 });
  assert.equal(els.stepRows.file.textContent, "Inscribing the file, 4 of 7");
  assert.equal(els.bar.getAttribute("aria-valuenow"), "4");
  assert.equal(els.bar.getAttribute("aria-valuemax"), "10");
  assert.equal(els.fill.style.width, "40%");
  assert.equal(els.progressStatus.textContent, "Waiting for your wallet: approval 5 of 10");
  assert.equal(t.win.unloads(), 1);
  assert.equal(els.keepOpen.hidden, false);
  assert.equal(els.keepOpen.textContent, HASHINAL_KEEP_OPEN_TEXT);
  const [, onUnload] = t.win.listeners.find(([type]) => type === "beforeunload");
  const leave = { prevented: false, preventDefault() { this.prevented = true; } };
  onUnload(leave);
  assert.equal(leave.prevented, true);
  assert.equal(leave.returnValue, "");
  // A second event does not add a second listener.
  runner.emit("progress", { step: "file", sent: 6, total: 6, approvalsDone: 7, approvalsTotal: 8 });
  assert.equal(t.win.unloads(), 1);

  runner.emit("topic", { step: "meta", topicId: "0.0.502", memo: "m", total: 1 });
  runner.emit("progress", { step: "meta", sent: 1, total: 1, approvalsDone: 9, approvalsTotal: 10 });
  assert.deepEqual(stepsNow(), [
    ["mint-step is-done", "Inscribing the file, 7 of 7"],
    ["mint-step is-now", "Inscribing the details, 2 of 2"],
    ["mint-step is-wait", "Minting your NFT"],
  ]);
  runner.hold(false);
  runner.emit("progress", { step: "mint", sent: 0, total: 1, approvalsDone: 9, approvalsTotal: 10 });
  assert.equal(t.win.unloads(), 0);
  assert.equal(els.keepOpen.hidden, true);
  assert.deepEqual(stepsNow().map(([cls]) => cls), ["mint-step is-done", "mint-step is-done", "mint-step is-now"]);

  runner.set({ status: "done" });
  runner.emit("done", DONE);
  const result = await waitFor(() => card(t.doc, "mint-hashinal-result-title"));
  run.resolve({ status: "done" });
  await flush();
  assert.equal(els.progress.hidden, true);
  assert.equal(els.form.hidden, false);
  assert.equal(t.win.unloads(), 0);
  byText(result, "Done").click();
  await flush();
});

test("a paused run: the reason, Resume, and the key field again when the runner needs it; Close only when stopped", async () => {
  const t = hashinalTab();
  const { els } = t.tab;
  await ready(t);
  els.keyOwn.click();
  typeIn(els.pasteInput, PRIV);
  const run = deferred();
  const runner = await startRun(t, () => run.promise);
  runner.set({ keyMode: "own" });
  runner.emit("status", { status: "paused", reason: "Wallet declined" });
  // start() settles when the run pauses.
  run.resolve(runner.snapshot());
  await flush();
  assert.equal(els.progress.hidden, false);
  assert.equal(els.progressStatus.textContent, "Paused: Wallet declined");
  assert.equal(els.resumeBtn.hidden, false);
  assert.equal(els.closeBtn.hidden, false);
  assert.equal(els.runKeyWrap.hidden, true);

  runner.set({ needs: "key" });
  runner.emit("status", { status: "interrupted", reason: "That key does not match this inscription" });
  assert.equal(els.progressStatus.textContent, "Stopped: That key does not match this inscription");
  assert.equal(els.runKeyWrap.hidden, false);
  assert.equal(els.runKey.type, "password");
  els.runKey.value = PRIV;
  els.resumeBtn.click();
  await waitFor(() => runner.calls.length === 2);
  assert.deepEqual(runner.inputs[1], { submitKey: PRIV });
  await flush();
  assert.equal(els.runKey.value, "");

  runner.emit("status", { status: "unconfirmed", reason: "Not confirmed on Hedera yet" });
  assert.equal(els.unconfirmed.hidden, false);
  assert.equal(els.closeBtn.hidden, true);
  assert.equal(els.resumeBtn.hidden, true);
});

test("unconfirmed: Check again checks, and Mint again anyway needs the second card before forceRemint", async () => {
  const t = hashinalTab();
  const { els } = t.tab;
  await ready(t);
  const run = deferred();
  const runner = await startRun(t, () => run.promise);
  runner.emit("status", { status: "unconfirmed", reason: "Not confirmed on Hedera yet" });
  run.resolve(runner.snapshot());
  await flush();
  assert.equal(els.progressStatus.textContent, "Waiting for Hedera to confirm the mint.");
  assert.equal(els.unconfirmed.hidden, false);
  els.recheckBtn.click();
  await waitFor(() => runner.calls.includes("check"));
  await flush();
  els.remintBtn.click();
  const ask = await waitFor(() => card(t.doc, "mint-hashinal-remint-title"));
  assert.equal(byClass(ask, "onboard-title").textContent, "Mint again?");
  assert.ok(ask.textContent.includes("Your NFT may already exist"));
  assert.ok(ask.textContent.includes("this mints a second one"));
  byText(ask, "Not now").click();
  await flush();
  assert.equal(runner.calls.includes("forceRemint"), false);
  els.remintBtn.click();
  byText(await waitFor(() => card(t.doc, "mint-hashinal-remint-title")), "Mint again").click();
  await waitFor(() => runner.calls.includes("forceRemint"));
  assert.deepEqual(runner.calls, ["start", "check", "forceRemint"]);
});

// ── The banner ─────────────────────────────────────────────────────────

const savedJob = (extra) => ({
  accountId: ME,
  tokenId: "0.0.900",
  keyMode: "memory",
  step: "file",
  reason: "",
  topics: { file: { topicId: "0.0.501", memo: "m", total: 6 }, meta: null },
  ...extra,
});
const shownButtons = (els) => [els.bannerResume, els.bannerRetry, els.bannerCheck, els.bannerRemint, els.bannerDismiss]
  .filter((b) => !b.hidden).map((b) => b.textContent);

test("a lost run shows only Dismiss, which asks first and clears every key field", async () => {
  const t = hashinalTab({ job: savedJob({ status: "lost", reason: "That inscription was cut off and its key is gone" }) });
  const { els } = t.tab;
  await t.tab.refreshBanner();
  assert.equal(els.banner.hidden, false);
  assert.equal(els.bannerText.textContent, HASHINAL_LOST_TEXT);
  assert.equal(HASHINAL_LOST_TEXT, "That inscription was cut off and its key is gone. The fee for the cut-off part cannot be recovered.");
  assert.equal(els.bannerStatus.hidden, true);
  assert.deepEqual(shownButtons(els), ["Dismiss"]);
  assert.equal(els.bannerKeyWrap.hidden, true);
  assert.equal(els.bannerFileWrap.hidden, true);
  els.keyOwn.click();
  typeIn(els.pasteInput, PRIV);
  els.bannerDismiss.click();
  const ask = await waitFor(() => card(t.doc, "mint-hashinal-dismiss-title"));
  assert.equal(byClass(ask, "onboard-title").textContent, "Dismiss this unfinished Hashinal?");
  byText(ask, "Keep").click();
  await flush();
  assert.deepEqual(t.run.made[0].calls, []);
  els.bannerDismiss.click();
  byText(await waitFor(() => card(t.doc, "mint-hashinal-dismiss-title")), "Dismiss").click();
  await waitFor(() => t.run.made[0].calls.length);
  await flush();
  assert.deepEqual(t.run.made[0].calls, ["dismiss"]);
  assert.equal(els.banner.hidden, true);
  assert.equal(els.pasteInput.value, "");
});

test("an unconfirmed saved run: Check again, and Mint again anyway behind the second card", async () => {
  const t = hashinalTab({ job: savedJob({ status: "unconfirmed", step: "mint", reason: "Not confirmed on Hedera yet" }) });
  const { els } = t.tab;
  await t.tab.refreshBanner();
  assert.deepEqual(shownButtons(els), ["Check again", "Mint again anyway", "Dismiss"]);
  assert.ok(els.bannerRemint.className.includes("mint-danger"));
  els.bannerCheck.click();
  await waitFor(() => t.run.made[0].calls.length);
  assert.deepEqual(t.run.made[0].calls, ["check"]);
  // Check again reads Hedera; it needs no wallet approval.
  assert.equal(t.calls.wallet, 0);
  await flush();
  els.bannerRemint.click();
  byText(await waitFor(() => card(t.doc, "mint-hashinal-remint-title")), "Not now").click();
  await flush();
  assert.deepEqual(t.run.made[0].calls, ["check"]);
  els.bannerRemint.click();
  byText(await waitFor(() => card(t.doc, "mint-hashinal-remint-title")), "Mint again").click();
  await waitFor(() => t.run.made[0].calls.length === 2);
  assert.deepEqual(t.run.made[0].calls, ["check", "forceRemint"]);
  assert.equal(t.calls.wallet, 1);
});

test("a failed mint: Try again calls resume", async () => {
  const t = hashinalTab({ job: savedJob({ status: "paused", step: "mint", reason: "The mint failed on Hedera. Nothing was minted." }) });
  const { els } = t.tab;
  await t.tab.refreshBanner();
  assert.equal(els.bannerText.textContent, "Unfinished Hashinal: the mint did not go through.");
  assert.equal(els.bannerStatus.textContent, "The mint failed on Hedera. Nothing was minted.");
  assert.deepEqual(shownButtons(els), ["Try again", "Dismiss"]);
  els.bannerRetry.click();
  await waitFor(() => t.run.made[0].calls.length);
  assert.deepEqual(t.run.made[0].calls, ["resume"]);
  assert.deepEqual(t.run.made[0].inputs, [{}]);
});

test("needs key: the banner takes the key, Resume passes what was typed, and a wrong key's reason shows", async () => {
  const t = hashinalTab({ job: savedJob({ status: "interrupted", keyMode: "own" }) });
  const { els } = t.tab;
  await t.tab.refreshBanner();
  assert.equal(els.bannerText.textContent, "Unfinished Hashinal: the file was cut off. Paste your key to finish it.");
  assert.equal(els.bannerKeyWrap.hidden, false);
  assert.equal(els.bannerKey.type, "password");
  assert.equal(els.bannerKey.autocomplete, "off");
  assert.equal(els.bannerKey.name, undefined);
  assert.equal(els.bannerKeyWrap.getAttribute("data-no-clear"), "");
  assert.deepEqual(shownButtons(els), ["Resume", "Dismiss"]);
  assert.equal(els.bannerStatus.getAttribute("aria-live"), "polite");
  const runner = t.run.made[0];
  runner.answers.resume = async () => {
    runner.set({ status: "interrupted", needs: "key", reason: "That key does not match this inscription" });
    runner.emit("status", { status: "interrupted", reason: "That key does not match this inscription" });
    return runner.snapshot();
  };
  els.bannerKey.value = PRIV;
  els.bannerResume.click();
  await waitFor(() => runner.calls.length);
  assert.deepEqual(runner.inputs, [{ submitKey: PRIV }]);
  await flush();
  assert.equal(els.bannerKey.value, "");
  assert.equal(els.bannerStatus.textContent, "That key does not match this inscription");
  assert.equal(els.bannerStatus.hidden, false);
  assert.equal(els.banner.hidden, false);
  assert.equal(els.progress.hidden, true);

  // The details step: "the details were cut off".
  const meta = hashinalTab({ job: savedJob({ status: "interrupted", keyMode: "own", step: "meta", topics: { file: { topicId: "0.0.501", total: 6 }, meta: { topicId: "0.0.502", total: 1 } } }) });
  await meta.tab.refreshBanner();
  assert.equal(meta.tab.els.bannerText.textContent, "Unfinished Hashinal: the details were cut off. Paste your key to finish it.");
});

test("needs file: pick the same file again, then Resume passes it; the run that starts moves to the progress card", async () => {
  const t = hashinalTab({ job: savedJob({ status: "interrupted", keyMode: "memory", topics: { file: null, meta: null } }) });
  const { els } = t.tab;
  await t.tab.refreshBanner();
  assert.equal(els.bannerText.textContent, "Unfinished Hashinal: pick the same file again.");
  assert.equal(els.bannerFileWrap.hidden, false);
  assert.ok(els.bannerFileWrap.textContent.includes(HASHINAL_REFILE_NOTE));
  assert.equal(HASHINAL_REFILE_NOTE, "If it was a picture, pick the prepared copy you saved, if you have one.");
  assert.equal(els.bannerPicker.accept, els.picker.accept);
  let opened = 0;
  els.bannerPicker.addEventListener("click", () => { opened += 1; });
  els.bannerChoose.click();
  assert.equal(opened, 1);
  await pick(t, PNG, els.bannerPicker);
  assert.equal(els.bannerFileName.textContent, "Picked: cat.png");
  const runner = t.run.made[0];
  const going = deferred();
  runner.answers.resume = () => {
    runner.emit("status", { status: "running", reason: "" });
    return going.promise;
  };
  els.bannerResume.click();
  await waitFor(() => runner.calls.length);
  assert.deepEqual(runner.inputs, [{ file: PNG }]);
  assert.equal(els.banner.hidden, true);
  assert.equal(els.progress.hidden, false);
  assert.equal(els.progressTitle.textContent, "Inscribing and minting into 0.0.900");
  going.resolve(runner.snapshot());
  await flush();
});

test("a runner's own needs beat a guess, and a resume from another wallet is refused", async () => {
  const t = hashinalTab({ job: savedJob({ status: "interrupted", keyMode: "memory" }), state: { status: "interrupted", needs: "file" } });
  await t.tab.refreshBanner();
  assert.equal(t.tab.els.bannerFileWrap.hidden, false);

  let who = ME;
  const other = hashinalTab({ account: () => who, job: savedJob({ status: "paused", reason: "Wallet declined" }) });
  const { els } = other.tab;
  await other.tab.refreshBanner();
  assert.equal(els.bannerText.textContent, "Unfinished Hashinal into 0.0.900.");
  assert.equal(els.bannerStatus.textContent, "Wallet declined");
  assert.deepEqual(shownButtons(els), ["Resume", "Dismiss"]);
  who = "0.0.8";
  els.bannerResume.click();
  await waitFor(() => other.log.length);
  await flush();
  assert.deepEqual(other.log, [["error", "Connect the wallet that started this Hashinal (0.0.7)"]]);
  assert.deepEqual(other.run.made.flatMap((r) => r.calls), []);
});

// ── The result ─────────────────────────────────────────────────────────

test("done shows Hashinal minted: the NFT, the file, the details and the transaction", async () => {
  const written = [];
  const t = hashinalTab({ clipboard: { writeText: async (text) => { written.push(text); } } });
  const { els } = t.tab;
  await ready(t);
  const runner = await startRun(t);
  runner.set({ status: "done" });
  runner.emit("done", DONE);
  const result = await waitFor(() => card(t.doc, "mint-hashinal-result-title"));
  assert.equal(byClass(result, "onboard-title").textContent, "Hashinal minted");
  assert.equal(byClass(result, "mint-result-id").textContent, "0.0.900 #7");
  const copy = byText(result, "Copy");
  assert.equal(copy.getAttribute("aria-label"), "Copy token id and serial");
  copy.click();
  await waitFor(() => written.length);
  assert.deepEqual(written, ["0.0.900 #7"]);
  const anchors = findAll(result, (el) => el.tagName === "A").map((a) => [a.href, a.textContent]);
  assert.deepEqual(anchors, [
    ["https://hashscan.io/mainnet/token/0.0.900/7", "View NFT on HashScan"],
    [hashinalUrl("0.0.501"), "View the file"],
    [hashinalUrl("0.0.502"), "View the details"],
    [DONE.hashscanUrl, "View transaction"],
  ]);
  // The form is ready for the next one: no file, no name.
  assert.equal(els.fileBox.hidden, true);
  assert.equal(els.nameInput.value, "");
  assert.deepEqual(t.urls.revoked, ["blob:test/1"]);
  byText(result, "Done").click();
  await flush();
});

// ── The key never leaks ────────────────────────────────────────────────

test("no key ever leaks: not in an attribute, aria text, a toast, storage or the console, and its fields are empty after done", async () => {
  const store = new Map();
  const writes = [];
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      writes.push(String(value));
      store.set(key, String(value));
    },
    removeItem: (key) => { store.delete(key); },
  };
  const seen = { keys: [], unloads: [] };
  let t;
  const fakeRun = async ({ tokenId, onTopic, onProgress, submitKey }) => {
    seen.keys.push(submitKey);
    await onTopic({ step: "file", topicId: "0.0.501", memo: "m1", total: 2 });
    await onProgress({ step: "file", sent: 1, total: 2 });
    seen.unloads.push(t.win.unloads());
    await onProgress({ step: "file", sent: 2, total: 2 });
    await onTopic({ step: "meta", topicId: "0.0.502", memo: "m2", total: 1 });
    await onProgress({ step: "meta", sent: 1, total: 1 });
    await onProgress({ step: "mint", sent: 0, total: 1 });
    await onProgress({ step: "mint", sent: 1, total: 1 });
    return { ...DONE, tokenId, fileHrl: "hcs://1/0.0.501", metaHrl: "hcs://1/0.0.502" };
  };
  const printed = [];
  const saved = {};
  for (const name of ["log", "info", "warn", "error", "debug"]) {
    saved[name] = console[name];
    console[name] = (...args) => printed.push(args.map(String).join(" "));
  }
  try {
    t = hashinalTab({
      storage,
      loadJob: loadHashinalJob,
      parseKey: parseSubmitKey,
      generateKey: () => generateOwnKey({
        generate: async () => {
          const key = PrivateKey.generateED25519();
          return { privateKey: key.toString(), publicKey: key.publicKey.toString() };
        },
      }),
      createRunner: (options) => createHashinalRunner({
        ...options,
        run: fakeRun,
        preflight: async () => ({ ok: true, reason: "", remaining: "5" }),
      }),
    });
    const { els } = t.tab;
    await ready(t);
    els.keyOwn.click();
    els.generateBtn.click();
    await waitFor(() => els.privateArea.value);
    const secret = els.privateArea.value;
    const raw = PrivateKey.fromStringDer(secret).toStringRaw();
    const publicKey = els.publicArea.value;
    assert.ok(secret.length > 64 && raw.length === 64);
    els.savedSwitch.click();
    els.startBtn.click();
    const confirm = await waitFor(() => card(t.doc, "mint-hashinal-confirm-title"));
    assert.equal(confirm.textContent.includes(secret) || confirm.textContent.includes(raw), false);
    byText(confirm, "Start").click();
    const result = await waitFor(() => card(t.doc, "mint-hashinal-result-title"));
    await flush();

    // The real runner got the parsed key, and held it while writing.
    assert.equal(seen.keys.length, 1);
    assert.equal(seen.keys[0].toStringRaw(), raw);
    assert.deepEqual(seen.unloads, [1]);
    assert.equal(t.win.unloads(), 0);

    const leaks = (text) => String(text).includes(secret) || String(text).toLowerCase().includes(raw.toLowerCase());
    for (const el of t.doc.created.concat(findAll(t.doc.body, () => true))) {
      for (const [name, value] of el.attrs) assert.equal(leaks(value), false, `${el.tagName} ${name}`);
      for (const prop of ["href", "src", "download", "placeholder", "title", "id", "htmlFor", "alt"]) {
        if (el[prop] != null) assert.equal(leaks(el[prop]), false, `${el.tagName}.${prop}`);
      }
      assert.equal(leaks(el.value), false, `${el.tagName} value`);
    }
    assert.equal(leaks(t.doc.body.textContent), false, "page text");
    for (const entry of t.log) assert.equal(leaks(entry.join(" ")), false, "toast");
    assert.ok(writes.length > 0, "the runner saved its checkpoint");
    for (const value of writes) assert.equal(leaks(value), false, "storage");
    assert.ok(writes.some((value) => value.includes(publicKey)), "the public key may be saved");
    assert.equal(store.size, 0, "the finished job is dropped");
    for (const line of printed) assert.equal(leaks(line), false, "console");

    // The fields are empty and the switch is off.
    assert.equal(els.privateArea.value, "");
    assert.equal(els.publicArea.value, "");
    assert.equal(els.pasteInput.value, "");
    assert.equal(els.bannerKey.value, "");
    assert.equal(els.runKey.value, "");
    assert.equal(els.savedSwitch.getAttribute("aria-checked"), "false");
    assert.equal(byClass(result, "onboard-title").textContent, "Hashinal minted");
    byText(result, "Done").click();
    await flush();
  } finally {
    for (const [name, fn] of Object.entries(saved)) console[name] = fn;
  }
});

// ── Pure parts ─────────────────────────────────────────────────────────

test("sizes, totals and the key's short form", () => {
  assert.equal(hashinalSizeText(512), "512 bytes");
  assert.equal(hashinalSizeText(1), "1 byte");
  assert.equal(hashinalSizeText(312 * 1024), "312 KB");
  assert.equal(hashinalSizeText(1.5 * 1024 * 1024), "1.5 MB");
  assert.equal(hashinalSizeText(2 * 1024 * 1024), "2 MB");
  assert.deepEqual(hashinalTotals(QUOTE), {
    approvals: 10,
    file: 7,
    meta: 2,
    cost: "≈ $0.1008",
    text: "10 wallet approvals, ≈ $0.1008: file 7 + details 2 + 1 mint",
    split: "10: file 7 + details 2 + 1 mint",
  });
  assert.deepEqual(approvalWarnings(51).length, 1);
  assert.deepEqual(approvalWarnings(501).length, 2);
  assert.equal(shortKey("abcd"), "abcd");
});

// ── Where it lives ─────────────────────────────────────────────────────

test("the page: imported after mintnft.js, its help list, the comment, and the placeholder kept", () => {
  assert.match(read("../main.js"), /import '\.\/mintnft\.js'\nimport '\.\/minthashinal\.js'\n/);
  const html = read("../index.html");
  assert.ok(html.includes("<li>Inscribes one file on Hedera, then its details, then mints one NFT into your collection that points at them.</li>"));
  assert.equal(html.includes("NFT and Hashinal minting are coming next."), false);
  assert.ok(html.includes('<div id="mint-panel-hashinal" class="mint-card mint-soon" role="tabpanel" aria-labelledby="mint-tab-hashinal" hidden>\n            <p class="mint-note">Coming next.</p>\n          </div>'));
  assert.equal((html.match(/<p class="mint-note">Coming next\.<\/p>/g) || []).length, 2);
  const panel = read("../mintpanel.js");
  assert.ok(panel.includes("// here. The Hashinal tab is minthashinal.js.\n"));
  assert.equal(panel.includes('Hashinal says "Coming next." for now.'), false);
});

test("minthashinal.js stores nothing itself and prints nothing; its CSS block adds no fixed px", () => {
  const src = read("../minthashinal.js");
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/localStorage|sessionStorage|indexedDB|console\.|innerHTML|dataset/.test(code), false);
  const statics = [...code.matchAll(/^import [\s\S]*? from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(statics, [
    "./inscriberow.js",
    "./hashinalurl.js",
    "./hcs1inscribe.js",
    "./hcs1inscribenotice.js",
    "./hashinalmint.js",
    "./hashinaljob.js",
    "./tokenmint.js",
    "./postimages.js",
    "./toast.js",
    "./mintpanel.js",
  ]);
  const css = read("../style.css");
  const nftEnd = css.indexOf("#mint-column .mint-progress-fill {\n    transition: none;\n  }\n}\n");
  const at = css.indexOf("/* Hashinal tab (minthashinal.js)");
  const end = css.indexOf("/* Update topic: one shared id");
  assert.ok(nftEnd > 0 && at > nftEnd && end > at);
  const block = css.slice(at, end);
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /\d(\.\d+)?px/);
  for (const name of [".mint-file-tile", ".mint-steps", ".mint-step.is-wait", ".mint-step.is-now", ".mint-step.is-done", ".mint-key", ".mint-trait-row"]) {
    assert.ok(block.includes(`#mint-column ${name}`), name);
  }
  assert.match(block, /#mint-column \.mint-card textarea\.toolbar-column,\n:is\(#feed-menu, \.drawer-screen\) #mint-column\.in-drawer \.mint-card textarea\.toolbar-column \{/);
  assert.match(block, /min-height: calc\(var\(--ui-btn-h\) \* 2\) !important;/);
  assert.match(block, /resize: none;/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\n  #mint-column \.mint-step \{\n    transition: none;\n  \}\n\}/);
});
