// The Mint panel's NFT tab (mintnft.js): New collection and Mint into
// collection, the link rows and the file import summary, the totals, the
// confirm cards, the long-run progress card, the saved-run banner, and the
// Token tab's cards as they were.
import test from "node:test";
import assert from "node:assert/strict";

// toast.js sets window.toast as it loads; reduced motion makes the cards
// open and close at once.
globalThis.window = { matchMedia: () => ({ matches: true }) };

const { MINT_NETWORK_FEE, bindMintPanel } = await import("../mintpanel.js");
const {
  NFT_ADMIN_OFF_WARNING,
  NFT_CREATE_FAIL_TEXT,
  NFT_FIXED_NOTE,
  NFT_PERSIST_TEXT,
  NFT_UNCONFIRMED_TEXT,
  bindMintNft,
  linkFileKind,
  mintTotals,
  progressText,
  serialRangeText,
  serialsCopyText,
  statusText,
} = await import("../mintnft.js");
const { parseLinkList } = await import("../nftbatch.js");

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

// The Mint column as index.html builds it: the tabs, the Token form, the
// NFT placeholder ("Coming next.") and the Hashinal one.
function page() {
  const doc = { activeElement: null, keys: [], events: new Map() };
  doc.createElement = (tag) => new El(doc, tag);
  doc.body = new El(doc, "body");
  doc.documentElement = new El(doc, "html");
  const ids = new Map();
  doc.getElementById = (id) => ids.get(id) || null;
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
  const column = make("div", "mint-column", doc.body);
  const tabs = make("div", "mint-tabs", column);
  for (const key of ["token", "nft", "hashinal"]) make("button", `mint-tab-${key}`, tabs, { className: "mint-tab" });
  const form = make("form", "mint-panel-token", column);
  const nft = make("div", "mint-panel-nft", column, { hidden: true, className: "mint-card mint-soon" });
  nft.setAttribute("role", "tabpanel");
  nft.setAttribute("aria-labelledby", "mint-tab-nft");
  const soon = new El(doc, "p");
  soon.className = "mint-note";
  soon.textContent = "Coming next.";
  nft.appendChild(soon);
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

// A runner that records its calls; the test sends its events.
function runners(base = {}) {
  const made = [];
  const createMinter = (options) => {
    const listeners = new Map();
    let state = { status: "idle", links: (options.links || []).slice(), minted: [], persistError: false, ...base };
    const minter = {
      options,
      calls: [],
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return () => listeners.get(event).delete(fn);
      },
      off() {},
      emit(event, payload) {
        if (event === "status") state = { ...state, ...payload };
        for (const fn of [...(listeners.get(event) || [])]) fn(payload);
      },
      set(next) { state = { ...state, ...next }; },
      state: () => state,
      start() { minter.calls.push("start"); return Promise.resolve(state); },
      resume() { minter.calls.push("resume"); return Promise.resolve(state); },
      pause() { minter.calls.push("pause"); },
      stop() { minter.calls.push("stop"); },
      recheck() { minter.calls.push("recheck"); return Promise.resolve(state); },
      forceRemintUnconfirmed() { minter.calls.push("remint"); return Promise.resolve(state); },
      discard() { minter.calls.push("discard"); },
    };
    made.push(minter);
    return minter;
  };
  return { made, createMinter };
}

const ME = "0.0.7";
const CATS = { tokenId: "0.0.900", name: "Cats", symbol: "CAT", totalSupply: "12", maxSupply: "10000" };
const RESULT = {
  tokenId: "0.0.4242",
  txId: "0.0.7@1700000000.000000001",
  hashscanUrl: "https://hashscan.io/mainnet/transaction/0.0.7-1700000000-000000001",
  tokenUrl: "https://hashscan.io/mainnet/token/0.0.4242",
};

async function waitFor(get) {
  for (let i = 0; i < 200; i += 1) {
    const value = get();
    if (value) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("timed out");
}
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const card = (doc, titleId) => doc.body.children.find((el) => el.getAttribute("aria-labelledby") === titleId);
const rowsOf = (dialog) => byClass(dialog, "onboard-rows").children
  .map((row) => [row.children[0].textContent, row.children[1].textContent, row.className.includes("is-warn")]);

// The NFT tab bound with stand-ins. extra replaces any of them.
function nftTab(extra = {}) {
  const { doc, $ } = page();
  const { log, toast } = stand();
  const run = runners(extra.state);
  const calls = { created: [], listed: [], supply: [], jobs: 0, dropped: [], parsed: [], wallet: 0 };
  let jobs = extra.jobs || [];
  const options = {
    doc,
    toast,
    ensureWallet: async () => {
      calls.wallet += 1;
      return extra.wallet || "ok";
    },
    getAccount: async () => ME,
    createCollection: async (fields) => {
      calls.created.push(fields);
      if (extra.createError) throw extra.createError;
      return RESULT;
    },
    listCollections: async (account) => {
      calls.listed.push(account);
      if (extra.listError) throw new Error("Could not read your collections");
      return extra.collections || [CATS];
    },
    readSupply: async (tokenId) => {
      calls.supply.push(tokenId);
      return extra.supply || { maxSupply: "10000", totalSupply: "8766", remaining: "1234", type: "NON_FUNGIBLE_UNIQUE" };
    },
    createMinter: run.createMinter,
    listJobs: (account) => {
      calls.jobs += 1;
      return account === ME ? jobs : [];
    },
    dropJob: (account, tokenId, storage) => {
      calls.dropped.push([account, tokenId, storage]);
      jobs = jobs.filter((job) => job.tokenId !== tokenId);
    },
    parseLinks: extra.parseLinks
      ? (text, opts) => {
        calls.parsed.push(opts);
        return extra.parseLinks(text, opts);
      }
      : parseLinkList,
    readFile: async (file) => file.content,
    storage: "STORE",
    clipboard: extra.clipboard,
  };
  bindMintPanel({ doc, ensureWallet: options.ensureWallet, createToken: async () => RESULT, toast });
  const tab = bindMintNft(options);
  return { doc, $, tab, log, calls, run, setJobs: (next) => { jobs = next; } };
}

const typeIn = (input, value) => {
  input.value = value;
  input.dispatch("input");
};
const links = (n, start = 1) => Array.from({ length: n }, (_, i) => `ipfs://bafy${start + i}`);

// ── Building ───────────────────────────────────────────────────────────

test("the tab replaces only the placeholder's content: the element, its id, role and aria stay", () => {
  const { $, tab } = nftTab();
  const panel = $("mint-panel-nft");
  assert.equal(tab.els.panel, panel);
  assert.equal(panel.getAttribute("role"), "tabpanel");
  assert.equal(panel.getAttribute("aria-labelledby"), "mint-tab-nft");
  assert.equal(panel.textContent.includes("Coming next."), false);
  assert.equal(panel.classList.contains("mint-soon"), false);
  assert.ok(panel.classList.contains("mint-nft"));
  assert.equal($("mint-panel-hashinal").hidden, true);
  assert.ok(panel.textContent.includes(NFT_FIXED_NOTE));
  assert.equal(NFT_FIXED_NOTE, "Max supply and royalty can't be changed later. Hedera mainnet, about $1 (about $2 with a royalty).");
});

// ── The mode switch ────────────────────────────────────────────────────

test("New collection is on; Mint into collection shows its form and lists your collections after the wallet step", async () => {
  const { tab, calls } = nftTab({ collections: [CATS, { tokenId: "0.0.901", name: "Dogs", symbol: "DOG", totalSupply: "1500", maxSupply: "2000" }] });
  const { modeNew, modeMint, createForm, mintForm, select, listStatus } = tab.els;
  assert.equal(modeNew.getAttribute("aria-checked"), "true");
  assert.equal(modeMint.getAttribute("aria-checked"), "false");
  assert.equal(modeMint.tabIndex, -1);
  assert.equal(createForm.hidden, false);
  assert.equal(mintForm.hidden, true);
  modeMint.click();
  assert.equal(listStatus.textContent, "Loading your collections…");
  assert.equal(createForm.hidden, true);
  assert.equal(mintForm.hidden, false);
  await waitFor(() => calls.listed.length);
  await flush();
  assert.deepEqual(calls.listed, [ME]);
  assert.equal(calls.wallet, 1);
  assert.deepEqual(select.children.map((o) => [o.value, o.textContent]), [
    ["", "Choose a collection"],
    ["0.0.900", "Cats (CAT) · 0.0.900 · 12/10,000"],
    ["0.0.901", "Dogs (DOG) · 0.0.901 · 1,500/2,000"],
  ]);
  assert.equal(listStatus.hidden, true);
  // The arrows flip it back.
  modeMint.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(modeNew.getAttribute("aria-checked"), "true");
  assert.equal(createForm.hidden, false);
  // Listed once: going back to Mint does not ask again.
  modeMint.click();
  await flush();
  assert.equal(calls.listed.length, 1);
});

test("a list that fails says so with Retry; Retry loads it", async () => {
  const fail = nftTab({ listError: true });
  fail.tab.els.modeMint.click();
  await flush();
  assert.equal(fail.tab.els.listStatus.textContent, "Couldn't load your collections");
  assert.equal(fail.tab.els.retryBtn.hidden, false);
  const cancel = nftTab({ wallet: "cancel" });
  cancel.tab.els.modeMint.click();
  await flush();
  assert.equal(cancel.tab.els.listStatus.textContent, "Connect your wallet to see your collections.");
  assert.equal(cancel.tab.els.retryBtn.hidden, false);
  assert.deepEqual(cancel.calls.listed, []);
});

test("a picked collection shows what is left; a pasted id wins over the list", async () => {
  const { tab, calls } = nftTab();
  await tab.setMode("mint");
  tab.els.select.value = "0.0.900";
  tab.els.select.dispatch("change");
  await flush();
  assert.deepEqual(calls.supply, ["0.0.900"]);
  assert.equal(tab.els.supplyLine.textContent, "1,234 of 10,000 left");
  typeIn(tab.els.tokenInput, "0.0.555");
  tab.els.tokenInput.dispatch("change");
  await flush();
  assert.equal(calls.supply.at(-1), "0.0.555");
  assert.equal(tab.plan().tokenId, "0.0.555");
  typeIn(tab.els.tokenInput, "abc");
  tab.els.tokenInput.dispatch("change");
  assert.equal(tab.els.supplyLine.textContent, "Enter a token id like 0.0.123");
  assert.equal(tab.plan().tokenId, "");
  assert.equal(tab.els.startHint.textContent, "Choose a collection");
  assert.equal(tab.els.startBtn.disabled, true);
});

// ── New collection ─────────────────────────────────────────────────────

test("the royalty fields show only with Royalty on, and the confirm card reads the royalty and its fee", async () => {
  const { doc, tab, calls, log } = nftTab();
  const { royaltySwitch, royaltyWrap, createInputs } = tab.els;
  assert.equal(royaltySwitch.getAttribute("aria-checked"), "false");
  assert.equal(royaltyWrap.hidden, true);
  royaltySwitch.click();
  assert.equal(royaltySwitch.getAttribute("aria-checked"), "true");
  assert.equal(royaltyWrap.hidden, false);
  assert.equal(createInputs.receiver.placeholder, "Your account");
  assert.equal(createInputs.fallback.value, "");
  assert.ok(royaltyWrap.textContent.includes("Charged when an NFT is traded for no HBAR"));
  for (const [key, value] of Object.entries({ name: "Cats", symbol: "CAT", max: "10000", percent: "5", receiver: "0.0.77", fallback: "1" })) {
    createInputs[key].value = value;
  }
  const running = tab.runCreate();
  const confirm = await waitFor(() => card(doc, "mint-nft-confirm-title"));
  assert.equal(byClass(confirm, "onboard-title").textContent, "Before you create");
  assert.deepEqual(rowsOf(confirm), [
    ["Name", "Cats", false],
    ["Symbol", "CAT", false],
    ["Max supply", "10,000", false],
    ["Royalty", "5% to 0.0.77, fallback 1 HBAR", false],
    ["Admin key", "On", false],
    ["Network fee", "≈ $2, paid by your wallet", false],
  ]);
  byText(confirm, "Create").click();
  const result = await waitFor(() => card(doc, "mint-nft-result-title"));
  assert.deepEqual(calls.created[0], {
    name: "Cats", symbol: "CAT", maxSupply: "10000", memo: "", adminKey: true,
    royalty: { percent: 5, collector: "0.0.77", fallbackHbar: "1" },
  });
  assert.deepEqual(log.slice(0, 2), [["hold", "Waiting for your wallet…"], ["done", "Waiting for your wallet…"]]);
  assert.equal(byClass(result, "onboard-title").textContent, "Collection created");
  assert.equal(byClass(result, "mint-result-id").textContent, "0.0.4242");
  const anchors = findAll(result, (el) => el.tagName === "A").map((a) => [a.textContent, a.href]);
  assert.deepEqual(anchors, [["View collection on HashScan", RESULT.tokenUrl], ["View transaction", RESULT.hashscanUrl]]);
  assert.ok(byText(result, "Done"));
  // Mint into it: Mint into collection, with this id picked.
  byText(result, "Mint into it").click();
  assert.equal(await running, "created");
  await flush();
  assert.equal(tab.els.modeMint.getAttribute("aria-checked"), "true");
  assert.equal(tab.plan().tokenId, "0.0.4242");
  assert.ok(tab.els.select.children.some((o) => o.value === "0.0.4242" && o.textContent === "Cats (CAT) · 0.0.4242 · 0/10,000"));

  // Royalty off: "Off", the $1 fee, and no royalty sent.
  const plain = nftTab();
  for (const [key, value] of Object.entries({ name: "Dogs", symbol: "DOG", max: "50" })) plain.tab.els.createInputs[key].value = value;
  const second = plain.tab.runCreate();
  const rows = rowsOf(await waitFor(() => card(plain.doc, "mint-nft-confirm-title")));
  assert.deepEqual(rows[3], ["Royalty", "Off", false]);
  assert.deepEqual(rows[5], ["Network fee", "≈ $1, paid by your wallet", false]);
  byText(card(plain.doc, "mint-nft-confirm-title"), "Create").click();
  byText(await waitFor(() => card(plain.doc, "mint-nft-result-title")), "Done").click();
  assert.equal(await second, "created");
  assert.equal(plain.calls.created[0].royalty, null);
  assert.equal(plain.tab.els.modeNew.getAttribute("aria-checked"), "true");
});

test("Admin key off shows the warning and the confirm card says it", async () => {
  const { doc, tab, calls } = nftTab();
  const { adminSwitch, adminWarning, createInputs } = tab.els;
  assert.equal(adminSwitch.getAttribute("aria-checked"), "true");
  assert.equal(adminWarning.hidden, true);
  adminSwitch.click();
  assert.equal(adminSwitch.getAttribute("aria-checked"), "false");
  assert.equal(adminWarning.hidden, false);
  assert.equal(adminWarning.textContent, "Without an admin key this collection can never be changed or deleted.");
  assert.equal(NFT_ADMIN_OFF_WARNING, adminWarning.textContent);
  for (const [key, value] of Object.entries({ name: "Cats", symbol: "CAT", max: "10" })) createInputs[key].value = value;
  const running = tab.runCreate();
  const confirm = await waitFor(() => card(doc, "mint-nft-confirm-title"));
  assert.deepEqual(rowsOf(confirm)[4], ["Admin key", `Off. ${NFT_ADMIN_OFF_WARNING}`, false]);
  byText(confirm, "Create").click();
  byText(await waitFor(() => card(doc, "mint-nft-result-title")), "Done").click();
  await running;
  assert.equal(calls.created[0].adminKey, false);
  adminSwitch.click();
  assert.equal(adminWarning.hidden, true);
});

test("field problems show inline in tokenmint.js's words, and the wallet is not asked", async () => {
  const { tab, calls } = nftTab();
  const { createInputs, createError, royaltySwitch } = tab.els;
  const tryWith = async (values) => {
    for (const [key, input] of Object.entries(createInputs)) input.value = values[key] || "";
    assert.equal(await tab.runCreate(), "invalid");
    const bad = Object.entries(createInputs).find(([, input]) => input.getAttribute("aria-invalid") === "true");
    return [createError.textContent, bad && bad[0]];
  };
  assert.deepEqual(await tryWith({ symbol: "CAT", max: "10" }), ["Name must be 1 to 100 bytes", "name"]);
  assert.deepEqual(await tryWith({ name: "Cats", symbol: "CAT" }), ["Enter a max supply", "max"]);
  assert.deepEqual(await tryWith({ name: "Cats", symbol: "CAT", max: "1.5" }), ["Max supply must be a whole number", "max"]);
  assert.deepEqual(await tryWith({ name: "Cats", symbol: "CAT", max: "0" }), ["Max supply must be a whole number above 0", "max"]);
  royaltySwitch.click();
  assert.deepEqual(await tryWith({ name: "Cats", symbol: "CAT", max: "10" }), ["Royalty percent must be greater than 0 and at most 50", "percent"]);
  assert.deepEqual(await tryWith({ name: "Cats", symbol: "CAT", max: "10", percent: "50.5" }), ["Royalty percent must be greater than 0 and at most 50", "percent"]);
  assert.deepEqual(await tryWith({ name: "Cats", symbol: "CAT", max: "10", percent: "1.255" }), ["Royalty percent can have at most 2 decimal places", "percent"]);
  assert.deepEqual(await tryWith({ name: "Cats", symbol: "CAT", max: "10", percent: "5", receiver: "bob" }), ["Enter an account id like 0.0.123", "receiver"]);
  assert.deepEqual(await tryWith({ name: "Cats", symbol: "CAT", max: "10", percent: "5", fallback: "0.01" }), ["Enter a fallback from 0.1 to 1000000 HBAR, with at most 8 decimals", "fallback"]);
  assert.equal(calls.wallet, 0);
});

test("a wallet that says no stays quiet; other create errors toast", async () => {
  for (const [error, expected] of [
    [new Error("USER_REJECT: Request Rejected"), []],
    [new Error("INSUFFICIENT_PAYER_BALANCE"), [["error", NFT_CREATE_FAIL_TEXT]]],
    [Object.assign(new Error("This account uses a multi-key (threshold or key list) setup. Minting here needs a single-key account."), { userFacing: true }), null],
  ]) {
    const { doc, tab, log } = nftTab({ createError: error });
    for (const [key, value] of Object.entries({ name: "Cats", symbol: "CAT", max: "10" })) tab.els.createInputs[key].value = value;
    const running = tab.runCreate();
    byText(await waitFor(() => card(doc, "mint-nft-confirm-title")), "Create").click();
    const status = await running;
    const errors = log.filter(([kind]) => kind === "error");
    assert.deepEqual(errors, expected || [["error", error.message]]);
    assert.equal(status, expected && expected.length === 0 ? "quiet" : "error");
  }
  assert.equal(NFT_CREATE_FAIL_TEXT, "Collection create failed. Nothing was charged if your wallet did not approve.");
});

// ── Links ──────────────────────────────────────────────────────────────

test("+ Add link adds a row and focuses it; × removes it; a bad row blocks Start, a duplicate only says so", async () => {
  const { doc, tab } = nftTab();
  await tab.setMode("mint");
  tab.chooseCollection("0.0.900");
  await flush();
  assert.equal(tab.rows.length, 1);
  assert.equal(tab.els.startHint.textContent, "Add at least one link");
  tab.els.addBtn.click();
  assert.equal(tab.rows.length, 2);
  assert.equal(tab.els.linkList.children.length, 2);
  assert.equal(doc.activeElement, tab.rows[1].input);
  assert.equal(tab.rows[1].input.getAttribute("aria-label"), "Link 2");
  assert.equal(tab.rows[1].remove.getAttribute("aria-label"), "Remove link 2");
  // The row's × is its clear: fieldclear.js adds none inside the field.
  assert.equal(tab.rows[1].wrap.getAttribute("data-no-clear"), "");
  typeIn(tab.rows[0].input, "ipfs://bafyone");
  typeIn(tab.rows[1].input, "ftp://nope");
  // Checked on blur.
  assert.equal(tab.rows[1].msg.hidden, true);
  tab.rows[1].input.dispatch("blur");
  assert.equal(tab.rows[1].msg.textContent, "Must start with ipfs://, https://, or hcs://1/");
  assert.equal(tab.rows[1].input.getAttribute("aria-invalid"), "true");
  assert.equal(tab.els.startHint.textContent, "Fix or remove 1 bad link");
  assert.equal(tab.els.startBtn.disabled, true);
  typeIn(tab.rows[1].input, `https://x.io/${"a".repeat(100)}`);
  assert.equal(tab.rows[1].msg.textContent, "Over 100 bytes");
  // A duplicate is flagged and does not block.
  typeIn(tab.rows[1].input, "ipfs://bafyone");
  assert.equal(tab.rows[1].msg.textContent, "Duplicate of an earlier link");
  assert.ok(tab.rows[1].msg.classList.contains("is-dup"));
  assert.equal(tab.rows[1].input.getAttribute("aria-invalid"), null);
  assert.equal(tab.els.startBtn.disabled, false);
  assert.equal(tab.els.totalsLine.textContent, "2 NFTs · 1 wallet approval · ≈\u00a0$0.04");
  // ×: the row goes, the totals follow.
  const second = tab.rows[1];
  second.remove.click();
  assert.equal(tab.rows.length, 1);
  assert.equal(tab.els.linkList.children.length, 1);
  assert.equal(second.wrap.parentNode, null);
  assert.equal(tab.els.totalsLine.textContent, "1 NFT · 1 wallet approval · ≈\u00a0$0.02");
  // Enter in the last row starts a new one.
  tab.rows[0].input.dispatch("keydown", { key: "Enter" });
  assert.equal(tab.rows.length, 2);
  assert.equal(doc.activeElement, tab.rows[1].input);
});

test("Import file opens the picker in the same tap; a big file is one summary card, and bad lines block Start", async () => {
  const bad = [
    { line: 42, value: "x", reason: "Over 100 bytes" },
    { line: 77, value: "ftp://a", reason: "Must start with ipfs://, https://, or hcs://1/" },
    { line: 90, value: "", reason: "Not a string" },
  ];
  const duplicates = Array.from({ length: 12 }, (_, i) => ({ line: 200 + i, value: "ipfs://bafy1", firstLine: 1 }));
  const { tab, calls, doc } = nftTab({
    parseLinks: (text, opts) => (opts.kind === "text" ? parseLinkList(text, opts) : { links: links(10000), bad, duplicates, total: 10003 }),
  });
  await tab.setMode("mint");
  tab.chooseCollection("0.0.900");
  await flush();
  // The picker opens inside the tap: the hidden input is clicked at once.
  let picked = 0;
  tab.els.fileInput.addEventListener("click", () => { picked += 1; });
  tab.els.importBtn.click();
  assert.equal(picked, 1);
  assert.equal(tab.els.fileInput.accept, ".txt,.csv,.json,text/plain,text/csv,application/json");
  assert.equal(tab.els.fileInput.hidden, true);
  assert.equal(tab.els.fileInput.parentNode, doc.body);
  // A picked file is read and parsed by its extension.
  tab.els.fileInput.files = [{ name: "drop.CSV", content: "metadata\nipfs://a" }];
  tab.els.fileInput.dispatch("change");
  await waitFor(() => !tab.els.summary.hidden);
  assert.deepEqual(calls.parsed.filter((o) => o.kind !== "text"), [{ kind: "csv" }]);
  assert.equal(tab.els.summaryName.textContent, "drop.CSV");
  assert.equal(tab.els.summaryCounts.textContent, "10,000 links · 3 bad · 12 duplicates");
  assert.deepEqual(tab.els.problemList.children.slice(0, 3).map((li) => li.textContent), [
    "line 42: Over 100 bytes",
    "line 77: Must start with ipfs://, https://, or hcs://1/",
    "line 90: Not a string",
  ]);
  assert.equal(tab.els.problemList.children[3].textContent, "line 200: Duplicate of line 1");
  assert.equal(tab.els.problems.hidden, false);
  // Never a row per link.
  assert.equal(tab.els.linkList.children.length, 1);
  assert.equal(tab.els.startHint.textContent, "Fix or remove 3 bad links");
  assert.equal(tab.els.startBtn.disabled, true);
  assert.equal(await tab.runMint(), "blocked");
  // Remove file: the file's links and problems go.
  tab.els.removeFileBtn.click();
  assert.equal(tab.els.summary.hidden, true);
  assert.equal(tab.els.startHint.textContent, "Add at least one link");

  // Only the first 50 of each kind are listed.
  const many = nftTab({
    parseLinks: (text, opts) => (opts.kind === "text" ? parseLinkList(text, opts)
      : { links: [], bad: Array.from({ length: 120 }, (_, i) => ({ line: i + 1, reason: "Over 100 bytes" })), duplicates: [], total: 120 }),
  });
  await many.tab.importFile({ name: "list.json", content: "[]" });
  assert.deepEqual(many.calls.parsed.at(-1), { kind: "json" });
  assert.equal(many.tab.els.problemList.children.length, 51);
  assert.equal(many.tab.els.problemList.children[50].textContent, "and 70 more");
  assert.equal(linkFileKind("links.txt"), "text");
  assert.equal(linkFileKind("noext"), "text");
});

test("the file's links and the rows add up: 10,012 NFTs, 1,002 approvals, ≈ $200.24", async () => {
  assert.deepEqual(mintTotals(10012), {
    nfts: 10012,
    approvals: 1002,
    usd: "200.24",
    text: "10,012 NFTs · 1,002 wallet approvals · ≈\u00a0$200.24",
  });
  assert.equal(mintTotals(10000).text, "10,000 NFTs · 1,000 wallet approvals · ≈\u00a0$200");
  assert.equal(mintTotals(1).text, "1 NFT · 1 wallet approval · ≈\u00a0$0.02");
  assert.equal(mintTotals(11).approvals, 2);
  assert.equal(mintTotals(0).text, "0 NFTs · 0 wallet approvals · ≈\u00a0$0");
  const { tab } = nftTab({ parseLinks: (text, opts) => (opts.kind === "text" ? parseLinkList(text, opts) : { links: links(10000), bad: [], duplicates: [], total: 10000 }) });
  await tab.setMode("mint");
  await tab.importFile({ name: "a.csv", content: "" });
  tab.rows[0].input.value = "ipfs://row0";
  for (let i = 1; i < 12; i += 1) tab.addRow(`ipfs://row${i}`);
  tab.rows[0].input.dispatch("input");
  assert.equal(tab.els.totalsLine.textContent, "10,012 NFTs · 1,002 wallet approvals · ≈\u00a0$200.24");
  // The file first, then the rows.
  const all = tab.plan().links;
  assert.equal(all.length, 10012);
  assert.equal(all[0], "ipfs://bafy1");
  assert.equal(all[10000], "ipfs://row0");
  assert.ok(tab.els.panel.textContent.includes("Turn on auto-approve in HashPack for long runs."));
});

// ── Start ──────────────────────────────────────────────────────────────

async function readyToMint(extra = {}, count = 1240) {
  const ctx = nftTab(extra);
  await ctx.tab.setMode("mint");
  ctx.tab.chooseCollection("0.0.900");
  await flush();
  ctx.tab.rows[0].input.value = "ipfs://bafy1";
  for (let i = 2; i <= count; i += 1) ctx.tab.addRow(`ipfs://bafy${i}`);
  ctx.tab.rows[0].input.dispatch("input");
  return ctx;
}

test("Before you mint lists the run, and a list over what is left gets a warning row", async () => {
  const { doc, tab, run } = await readyToMint({}, 1240);
  tab.addRow("ipfs://bafy1");
  assert.equal(tab.els.startBtn.disabled, false);
  const running = tab.runMint();
  const confirm = await waitFor(() => card(doc, "mint-nft-start-title"));
  assert.equal(byClass(confirm, "onboard-title").textContent, "Before you mint");
  assert.deepEqual(rowsOf(confirm), [
    ["Collection", "Cats (CAT) · 0.0.900", false],
    ["NFTs", "1,241", false],
    ["Transactions", "125 (10 NFTs per transaction, the Hedera limit)", false],
    ["Estimated fee", "≈ $24.82 in HBAR, paid by your wallet", false],
    ["Duplicates", "1", false],
    ["Max supply", "This is 7 more than the collection has left. Minting stops when it is full.", true],
  ]);
  assert.ok(byText(confirm, "Not now"));
  byText(confirm, "Start").click();
  assert.equal(await running, "started");
  assert.equal(run.made.length, 1);
  const minter = run.made[0];
  assert.equal(minter.options.tokenId, "0.0.900");
  assert.equal(minter.options.accountId, ME);
  assert.equal(minter.options.links.length, 1241);
  assert.equal(minter.options.storage, "STORE");
  assert.deepEqual(minter.calls, ["start"]);
  assert.equal(tab.els.progress.hidden, false);
  assert.equal(tab.els.mintForm.hidden, true);
  assert.equal(tab.els.modes.hidden, true);
  assert.equal(tab.els.progressTitle.textContent, "Minting into 0.0.900");

  // Within what is left: no warning row; Not now starts nothing.
  const fits = await readyToMint({}, 30);
  const second = fits.tab.runMint();
  const rows = rowsOf(await waitFor(() => card(fits.doc, "mint-nft-start-title")));
  assert.equal(rows.some(([, , warn]) => warn), false);
  assert.equal(rows.some(([label]) => label === "Duplicates"), false);
  byText(card(fits.doc, "mint-nft-start-title"), "Not now").click();
  assert.equal(await second, "declined");
  assert.equal(fits.run.made.length, 0);
});

test("a saved run for the same collection must be finished or discarded before a new list starts", async () => {
  const job = { accountId: ME, tokenId: "0.0.900", links: links(20), minted: [], status: "paused", updatedAt: 1 };
  const { doc, tab, log, run } = await readyToMint({ jobs: [job] }, 3);
  assert.equal(await tab.runMint(), "saved");
  assert.deepEqual(log.filter(([kind]) => kind === "info"), [["info", "Finish or discard the unfinished mint into 0.0.900 first"]]);
  assert.equal(card(doc, "mint-nft-start-title"), undefined);
  assert.equal(run.made.length, 0);
  assert.equal(tab.els.banner.hidden, false);
});

// ── The long run ───────────────────────────────────────────────────────

async function started(extra = {}) {
  const ctx = await readyToMint(extra, 20);
  const running = ctx.tab.runMint();
  byText(await waitFor(() => card(ctx.doc, "mint-nft-start-title")), "Start").click();
  await running;
  return { ...ctx, minter: ctx.run.made[0] };
}

test("progress: the bar, the count and the transaction, from each progress event", async () => {
  assert.deepEqual(progressText({ minted: 3420, total: 10000, txDone: 342, txCount: 1000 }), {
    count: "3,420 / 10,000 minted",
    tx: "Transaction 342 of 1,000",
    value: "3,420 of 10,000 NFTs minted",
    percent: 34.2,
  });
  assert.equal(statusText("running", "", { txDone: 342, txCount: 1000 }), "Waiting for your wallet: transaction 343 of 1,000");
  assert.equal(statusText("paused", "Wallet declined"), "Paused: Wallet declined");
  assert.equal(statusText("stopped", "max supply reached"), "Stopped: the collection is full.");
  assert.equal(statusText("stopped", ""), "Stopped. You can resume later.");
  const { tab, minter } = await started();
  const { bar, fill, progressCount, progressTx, progressStatus, pauseBtn, stopBtn, resumeBtn } = tab.els;
  assert.equal(bar.getAttribute("role"), "progressbar");
  assert.equal(progressStatus.textContent, "Waiting for your wallet: transaction 1 of 2");
  assert.equal(pauseBtn.hidden, false);
  assert.equal(stopBtn.hidden, false);
  assert.equal(resumeBtn.hidden, true);
  minter.emit("status", { status: "running" });
  minter.emit("progress", { minted: 3420, total: 10000, cursor: 3420, txCount: 1000, txDone: 342 });
  assert.equal(bar.getAttribute("aria-valuenow"), "3420");
  assert.equal(bar.getAttribute("aria-valuemax"), "10000");
  assert.equal(bar.getAttribute("aria-valuetext"), "3,420 of 10,000 NFTs minted");
  assert.equal(fill.style.width, "34.2%");
  assert.equal(progressCount.textContent, "3,420 / 10,000 minted");
  assert.equal(progressTx.textContent, "Transaction 342 of 1,000");
  assert.equal(progressStatus.textContent, "Waiting for your wallet: transaction 343 of 1,000");
});

test("Pause, Resume after a reason, and Stop after its card", async () => {
  const { doc, tab, minter } = await started();
  const { pauseBtn, resumeBtn, stopBtn, closeBtn, progressStatus } = tab.els;
  pauseBtn.click();
  assert.deepEqual(minter.calls, ["start", "pause"]);
  assert.equal(progressStatus.textContent, "Pausing after this transaction…");
  minter.emit("status", { status: "paused", reason: "Wallet declined" });
  assert.equal(progressStatus.textContent, "Paused: Wallet declined");
  assert.equal(resumeBtn.hidden, false);
  assert.equal(pauseBtn.hidden, true);
  assert.equal(closeBtn.hidden, false);
  resumeBtn.click();
  await flush();
  assert.deepEqual(minter.calls.slice(-1), ["resume"]);
  minter.emit("status", { status: "running" });
  stopBtn.click();
  const ask = await waitFor(() => card(doc, "mint-nft-stop-title"));
  assert.equal(byClass(ask, "onboard-title").textContent, "Stop minting?");
  assert.equal(byClass(ask, "onboard-body").textContent, "You can resume later.");
  byText(ask, "Keep minting").click();
  await flush();
  assert.equal(minter.calls.includes("stop"), false);
  stopBtn.click();
  byText(await waitFor(() => card(doc, "mint-nft-stop-title")), "Stop").click();
  await flush();
  assert.deepEqual(minter.calls.slice(-1), ["stop"]);
});

test("unconfirmed: Check again rechecks; Mint that batch again anyway needs a second card before it re-mints", async () => {
  const { doc, tab, minter } = await started();
  minter.emit("status", { status: "unconfirmed", reason: "Not confirmed on Hedera yet" });
  const { unconfirmed, recheckBtn, remintBtn, pauseBtn, resumeBtn } = tab.els;
  assert.equal(unconfirmed.hidden, false);
  assert.ok(unconfirmed.textContent.includes(NFT_UNCONFIRMED_TEXT));
  assert.equal(NFT_UNCONFIRMED_TEXT, "Your wallet may have sent the last batch, but Hedera hasn't confirmed it yet. Nothing will be minted twice.");
  assert.equal(pauseBtn.hidden, true);
  assert.equal(resumeBtn.hidden, true);
  recheckBtn.click();
  await flush();
  assert.deepEqual(minter.calls.slice(-1), ["recheck"]);
  remintBtn.click();
  const ask = await waitFor(() => card(doc, "mint-nft-remint-title"));
  assert.match(byClass(ask, "onboard-body").textContent, /minted twice/);
  byText(ask, "Not now").click();
  await flush();
  assert.equal(minter.calls.includes("remint"), false);
  remintBtn.click();
  byText(await waitFor(() => card(doc, "mint-nft-remint-title")), "Mint again").click();
  await waitFor(() => minter.calls.includes("remint"));
  assert.equal(minter.calls.filter((c) => c === "remint").length, 1);
});

test("a warning is a toast; progress that cannot be saved says to keep the tab open", async () => {
  const { tab, minter, log } = await started();
  assert.equal(tab.els.persistLine.hidden, true);
  minter.set({ persistError: true });
  minter.emit("warning", { message: "Could not save mint progress in this browser" });
  assert.deepEqual(log.filter(([kind]) => kind === "info"), [["info", "Could not save mint progress in this browser"]]);
  assert.equal(tab.els.persistLine.hidden, false);
  assert.equal(tab.els.persistLine.textContent, "Progress can't be saved on this device. Keep this tab open.");
  assert.equal(NFT_PERSIST_TEXT, tab.els.persistLine.textContent);
});

test("done: Minted N NFTs with the serial range, Copy serials and the links", async () => {
  const copied = [];
  const { doc, tab, minter } = await started({ clipboard: { writeText: async (text) => { copied.push(text); } } });
  minter.emit("done", { serials: ["3", "1", "2"], txIds: ["0.0.7@1700000000.000000001", "0.0.7@1700000005.000000002"] });
  const result = await waitFor(() => card(doc, "mint-nft-minted-title"));
  assert.equal(byClass(result, "onboard-title").textContent, "Minted 3 NFTs");
  assert.equal(byClass(result, "mint-result-id").textContent, "Serials 1–3");
  const anchors = findAll(result, (el) => el.tagName === "A").map((a) => [a.textContent, a.href]);
  assert.deepEqual(anchors, [
    ["View collection on HashScan", "https://hashscan.io/mainnet/token/0.0.900"],
    ["View last transaction", "https://hashscan.io/mainnet/transaction/0.0.7-1700000005-000000002"],
  ]);
  await byText(result, "Copy serials").dispatch("click");
  await flush();
  assert.deepEqual(copied, ["1,2,3"]);
  byText(result, "Done").click();
  // The form is back, empty, for the next list.
  assert.equal(tab.els.progress.hidden, true);
  assert.equal(tab.els.mintForm.hidden, false);
  assert.equal(tab.rows.length, 1);
  assert.equal(tab.rows[0].input.value, "");
  assert.equal(tab.current(), null);

  assert.equal(serialRangeText(["1", "10000"]), "Serials 1–10,000");
  assert.equal(serialRangeText(["7"]), "Serial 7");
  const tenK = Array.from({ length: 10000 }, (_, i) => String(i + 1));
  assert.equal(serialsCopyText(tenK), "1-10000");
  assert.equal(serialsCopyText([...tenK.slice(0, 300), "305", "306", "400"]), "1-300,305-306,400");
});

// ── Saved runs ─────────────────────────────────────────────────────────

function savedJob(status) {
  const minted = Array.from({ length: 342 }, (_, i) => ({ txId: "", serials: links(10, i * 10).map((_, j) => String(i * 10 + j + 1)) }));
  return { accountId: ME, tokenId: "0.0.900", links: links(10000), minted, status, updatedAt: 5 };
}

test("opening the tab offers an unfinished run back: Resume adopts it and resumes on the tap", async () => {
  const { $, tab, calls, run } = nftTab({ jobs: [savedJob("paused")] });
  assert.equal(tab.els.banner.hidden, true);
  const before = calls.jobs;
  $("mint-tab-nft").click();
  await flush();
  assert.ok(calls.jobs > before);
  const { banner, bannerText, bannerCheck, bannerResume } = tab.els;
  assert.equal(banner.hidden, false);
  assert.equal(bannerText.textContent, "Unfinished mint: 3,420 / 10,000 into 0.0.900");
  assert.equal(bannerCheck.hidden, true);
  // Nothing is created, and nothing sends, before the tap.
  assert.equal(run.made.length, 0);
  bannerResume.click();
  await waitFor(() => run.made.length);
  await flush();
  const minter = run.made[0];
  assert.deepEqual(minter.options, { tokenId: "0.0.900", links: [], accountId: ME, storage: "STORE" });
  assert.deepEqual(minter.calls, ["resume"]);
  assert.equal(tab.els.progress.hidden, false);
  assert.equal(banner.hidden, true);
});

test("an unconfirmed saved run offers Check again, and Resume does not send it", async () => {
  const { tab, run } = nftTab({ jobs: [savedJob("unconfirmed")], state: { status: "unconfirmed", reason: "Not confirmed on Hedera yet" } });
  await tab.refreshJobs();
  assert.equal(tab.els.bannerCheck.hidden, false);
  tab.els.bannerCheck.click();
  await waitFor(() => run.made.length);
  await flush();
  assert.deepEqual(run.made[0].calls, ["recheck"]);
  assert.equal(tab.els.unconfirmed.hidden, false);

  const other = nftTab({ jobs: [savedJob("unconfirmed")], state: { status: "unconfirmed" } });
  await other.tab.refreshJobs();
  other.tab.els.bannerResume.click();
  await waitFor(() => other.run.made.length);
  await flush();
  assert.deepEqual(other.run.made[0].calls, []);
  assert.equal(other.tab.els.unconfirmed.hidden, false);
});

test("Discard asks first, then drops the saved run", async () => {
  const { doc, tab, calls } = nftTab({ jobs: [savedJob("stopped")] });
  await tab.refreshJobs();
  tab.els.bannerDiscard.click();
  const ask = await waitFor(() => card(doc, "mint-nft-discard-title"));
  assert.equal(byClass(ask, "onboard-title").textContent, "Discard this mint?");
  byText(ask, "Keep").click();
  await flush();
  assert.deepEqual(calls.dropped, []);
  tab.els.bannerDiscard.click();
  byText(await waitFor(() => card(doc, "mint-nft-discard-title")), "Discard").click();
  await waitFor(() => calls.dropped.length);
  await flush();
  assert.deepEqual(calls.dropped, [[ME, "0.0.900", "STORE"]]);
  assert.equal(tab.els.banner.hidden, true);
});

// ── Token as it was ────────────────────────────────────────────────────

test("the Token tab's confirm and result cards read as before", async () => {
  const { doc, $ } = nftTab();
  for (const [key, value] of Object.entries({ name: "Coin", symbol: "CN", initial: "12.5" })) $(`mint-${key}`).value = value;
  $("mint-panel-token").dispatch("submit");
  const confirm = await waitFor(() => card(doc, "mint-confirm-title"));
  assert.equal(byClass(confirm, "onboard-title").textContent, "Before you create");
  assert.deepEqual(rowsOf(confirm).map(([a, b]) => [a, b]), [
    ["Name", "Coin"],
    ["Symbol", "CN"],
    ["Decimals", "8"],
    ["Initial supply", "12.5 CN"],
    ["Supply", "Unlimited"],
    ["Admin key", "On"],
    ["Network fee", MINT_NETWORK_FEE],
  ]);
  assert.deepEqual(confirm.children[1].children.at(-1).children.map((b) => b.textContent), ["Not now", "Create"]);
  byText(confirm, "Create").click();
  const result = await waitFor(() => card(doc, "mint-result-title"));
  assert.equal(byClass(result, "onboard-title").textContent, "Token created");
  assert.equal(byClass(result, "mint-result-id").textContent, "0.0.4242");
  assert.equal(byText(result, "Copy").getAttribute("aria-label"), "Copy token id 0.0.4242");
  const anchors = findAll(result, (el) => el.tagName === "A").map((a) => a.textContent);
  assert.deepEqual(anchors, ["View token on HashScan", "View transaction"]);
  assert.equal(byText(result, "Mint into it"), null);
  assert.deepEqual(byClass(result, "onboard-nav").children.map((b) => b.textContent), ["Done"]);
  byText(result, "Done").click();
});
