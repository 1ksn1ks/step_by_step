// The map Toolbar's Mint panel (#mint-column, index.html): three tabs and
// the Token form. Token makes a fungible token with tokenmint.js; the
// connected wallet signs and pays, is the treasury and holds the supply
// key. Nothing is saved anywhere: the result card is the only output. The
// NFT tab is mintnft.js, which uses the cards and the wallet step from
// here. The Hashinal tab is minthashinal.js.
//
// The flow is the Inscribe row's: the form's checks, the wallet (connected
// already, or the connect sheet over the drawer), a confirm card, the
// wallet's transaction, then the result card. The cards are
// hcs1inscribenotice.js's (the intro's classes, dialog, focus ring,
// dismissals and motion), copied here because its builder is private.
//
// ensureWallet (feedlayout.js) is read when the wallet step runs, as
// tokenmint.js reads web3.js, so this file also loads in a test.

import { createFungibleToken, validateTokenFields } from "./tokenmint.js";
import { toast as appToast } from "./toast.js";

// inscriberow.js's INSCRIBE_CONNECT_CLASS: on <html> while the wallet step
// runs, the connect sheet sits over the map drawer (style.css), which stays
// open under it.
export const MINT_CONNECT_CLASS = "inscribe-connect";
export const ADMIN_OFF_WARNING = "Without an admin key this token can never be changed or deleted.";
export const MINT_FAIL_TEXT = "Token create failed. Nothing was charged if your wallet did not approve.";
export const MINT_NETWORK_FEE = "≈ $1, paid by your wallet";
// A wallet that was closed or said no: no message.
const QUIET = /reject|cancel|denied|closed/i;

export function isQuietWalletError(err) {
  return QUIET.test(textOf(err && (err.message || err)));
}

function fieldError(message, field) {
  const err = new Error(message);
  err.userFacing = true;
  if (field) err.field = field;
  return err;
}

function textOf(value) {
  return value == null ? "" : String(value);
}

// "8" -> 8: a whole number from 0 to 18 (tokenmint.js's words).
export function readDecimals(text) {
  const value = textOf(text).trim();
  if (!/^\d{1,2}$/.test(value) || Number(value) > 18) {
    throw fieldError("Decimals must be a whole number from 0 to 18", "decimals");
  }
  return Number(value);
}

// A typed amount ("1000", "12.5") as a count of the smallest unit, a
// decimal string: "12.5" with 8 decimals is "1250000000". String and
// BigInt only, never a float, so any size stays exact. Zeros at the end of
// the fraction do not count against the decimals.
export function toSmallestUnits(text, decimals, label = "Amount") {
  const value = textOf(text).trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    throw fieldError(`${label} must be a number like 1000 or 12.5`);
  }
  const [whole, fraction = ""] = value.split(".");
  const digits = fraction.replace(/0+$/, "");
  if (digits.length > decimals) {
    throw fieldError(decimals === 0
      ? `${label} must be a whole number: this token has 0 decimals`
      : `${label} can have at most ${decimals} decimal places`);
  }
  return BigInt((whole || "0") + digits.padEnd(decimals, "0")).toString();
}

// Back to a readable amount: "1250000000" with 8 decimals is "12.5", and
// the whole part is grouped ("1,000").
export function fromSmallestUnits(units, decimals) {
  const raw = BigInt(textOf(units) || "0").toString();
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = decimals ? padded.slice(padded.length - decimals).replace(/0+$/, "") : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

const FIELD_OF = [
  ["Name", "name"],
  ["Symbol", "symbol"],
  ["Memo", "memo"],
  ["Decimals", "decimals"],
  ["Initial supply", "initial"],
  ["Max supply", "max"],
];

function fieldOf(err) {
  if (err && err.field) return err.field;
  const message = textOf(err && err.message);
  const hit = FIELD_OF.find(([prefix]) => message.startsWith(prefix));
  return hit ? hit[1] : "";
}

// values: the form as typed, { name, symbol, decimals, initial, capped,
// max, memo, adminKey }. Returns { fields, display }: fields is what
// createFungibleToken takes (amounts in the smallest unit, maxSupply null
// for Unlimited); display has the amounts to read back. Throws the first
// problem: tokenmint.js's own checks in its order, then the amounts.
export function readMintFields(values, validate = validateTokenFields) {
  const v = values && typeof values === "object" ? values : {};
  let decimals = Number.NaN;
  let decimalsBad = false;
  try {
    decimals = readDecimals(v.decimals);
  } catch {
    decimalsBad = true;
  }
  let initialSupply = "0";
  let maxSupply = null;
  let amountError = null;
  if (!decimalsBad) {
    try {
      if (textOf(v.initial).trim() === "") throw fieldError("Initial supply is required. 0 is allowed", "initial");
      initialSupply = toSmallestUnits(v.initial, decimals, "Initial supply");
    } catch (err) {
      err.field = err.field || "initial";
      amountError = err;
    }
    if (v.capped) {
      try {
        if (textOf(v.max).trim() === "") throw fieldError("Max supply is required when the supply is capped", "max");
        maxSupply = toSmallestUnits(v.max, decimals, "Max supply");
      } catch (err) {
        err.field = err.field || "max";
        if (!amountError) amountError = err;
      }
    }
  }
  let parsed;
  try {
    parsed = validate({
      name: v.name,
      symbol: v.symbol,
      decimals,
      initialSupply,
      maxSupply,
      memo: v.memo,
    });
  } catch (err) {
    if (err && typeof err === "object" && !err.field) err.field = fieldOf(err);
    throw err;
  }
  if (amountError) throw amountError;
  return {
    fields: {
      name: parsed.name,
      symbol: parsed.symbol,
      decimals: parsed.decimals,
      initialSupply,
      maxSupply,
      memo: parsed.memo,
      adminKey: v.adminKey !== false,
    },
    display: {
      initial: fromSmallestUnits(initialSupply, parsed.decimals),
      max: maxSupply == null ? "" : fromSmallestUnits(maxSupply, parsed.decimals),
    },
  };
}

// ── The cards (hcs1inscribenotice.js's pattern) ─────────────────────────

let pending = null;

function reducedMotion() {
  try {
    const view = globalThis.window || globalThis;
    return !!(view.matchMedia && view.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

function canFocus(node) {
  if (!node || typeof node.focus !== "function") return false;
  if (node.isConnected === false) return false;
  if (node.disabled) return false;
  return true;
}

function focusNode(node) {
  if (!canFocus(node)) return;
  try {
    node.focus({ preventScroll: true });
  } catch {
    try { node.focus(); } catch { /* the button can refuse focus */ }
  }
}

function play(node, frames, options) {
  if (!node || typeof node.animate !== "function") return;
  try { node.animate(frames, options); } catch { /* a stub document */ }
}

function stop(event) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
}

function paragraph(doc, text, className = "onboard-body") {
  const para = doc.createElement("p");
  para.className = className;
  para.textContent = text;
  return para;
}

// rows: [label, value] pairs; a third item true marks a warning row.
function rowList(doc, rows) {
  const list = doc.createElement("div");
  list.className = "onboard-rows";
  for (const [label, value, warn] of rows) {
    const row = doc.createElement("div");
    row.className = warn ? "onboard-row is-warn" : "onboard-row";
    const name = doc.createElement("div");
    name.className = "onboard-row-name";
    name.textContent = label;
    const note = doc.createElement("div");
    note.className = "onboard-row-note";
    note.textContent = value;
    row.append(name, note);
    list.appendChild(row);
  }
  return list;
}

function navButton(doc, className, text) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function link(doc, href, text) {
  const a = doc.createElement("a");
  a.className = "swap-tx-link";
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  return a;
}

// Same open and close as the intro overlay. Reduced motion skips both.
// focusables is the Tab ring, in order. first takes focus on open; focus
// goes back to returnTo on close. close dismisses (false); accept is true.
function mountCard(doc, { titleId, titleText, parts, focusables, close, accept, first, returnTo }) {
  const back = canFocus(returnTo) ? returnTo : (canFocus(doc.activeElement) ? doc.activeElement : null);
  // Keys are read on the window, in capture: the map drawer's own Escape
  // (feedlayout.js) listens on the document in capture and would go back
  // a page under the card. This runs first and keeps Escape for the card.
  const view = doc.defaultView;
  const keys = view && typeof view.addEventListener === "function" ? view : doc;
  const overlay = doc.createElement("div");
  overlay.className = "onboard-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", titleId);

  const scrim = doc.createElement("div");
  scrim.className = "onboard-scrim";

  const card = doc.createElement("div");
  card.className = "onboard-card inscribe-notice mint-notice";

  const title = doc.createElement("h3");
  title.className = "onboard-title";
  title.id = titleId;
  title.textContent = titleText;

  const nav = doc.createElement("div");
  nav.className = "onboard-nav";
  nav.append(...[close, accept].filter(Boolean));
  card.append(title, ...parts, nav);
  overlay.append(scrim, card);

  let settled = false;
  let resolveCard = () => {};
  const promise = new Promise((resolve) => {
    resolveCard = resolve;
  });

  const finish = (accepted) => {
    if (settled) return;
    settled = true;
    keys.removeEventListener("keydown", onKey, true);
    const remove = () => {
      if (typeof overlay.remove === "function") overlay.remove();
      if (pending === promise) pending = null;
      focusNode(back);
      resolveCard(!!accepted);
    };
    if (reducedMotion()) {
      if (card.style) card.style.animation = "none";
      remove();
      return;
    }
    overlay.style.pointerEvents = "none";
    if (card.style) card.style.animation = "none";
    overlay.style.transition = "opacity 0.25s ease-out";
    overlay.style.opacity = "0";
    setTimeout(remove, 300);
  };

  function onKey(event) {
    if (!event) return;
    if (event.key === "Escape") {
      if (typeof event.preventDefault === "function") event.preventDefault();
      stop(event);
      finish(false);
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables;
    const index = items.indexOf(doc.activeElement);
    let next = null;
    if (event.shiftKey) {
      if (index <= 0) next = items[items.length - 1];
    } else if (index < 0 || index === items.length - 1) {
      next = items[0];
    }
    if (!next) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    stop(event);
    focusNode(next);
  }

  scrim.addEventListener("click", (event) => {
    stop(event);
    finish(false);
  });
  close.addEventListener("click", (event) => {
    stop(event);
    finish(false);
  });
  if (accept) {
    accept.addEventListener("click", (event) => {
      stop(event);
      finish(true);
    });
  }
  keys.addEventListener("keydown", onKey, true);

  doc.body.appendChild(overlay);
  if (!reducedMotion()) {
    play(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-out" });
    play(card, [
      { opacity: 0, transform: "translate(-50%, -50%) scale(0.9)" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
    ], { duration: 300, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  }
  focusNode(first);
  pending = promise;
  return promise;
}

// A confirm card: the rows ([label, value], or [label, value, true] for a
// warning), then the close button (Not now) and the accept button. true
// when accept is tapped. One card at a time.
export function confirmCard(doc, { titleId, titleText, rows = [], body = "", acceptText, closeText = "Not now", returnTo }) {
  if (pending || !doc || !doc.body) return Promise.resolve(false);
  const notNow = navButton(doc, "onboard-prev", closeText);
  const accept = navButton(doc, "onboard-next", acceptText);
  const parts = [];
  if (body) parts.push(paragraph(doc, body));
  if (rows.length) parts.push(rowList(doc, rows));
  return mountCard(doc, {
    titleId,
    titleText,
    parts,
    focusables: [notNow, accept],
    close: notNow,
    accept,
    first: accept,
    returnTo,
  });
}

// A result card: big (the id, or a short line) with a Copy button that
// copies copyValue, the links ([href, text]) under it, and Done. With
// acceptText a second button sits beside Done and resolves true; Done,
// Escape and the scrim resolve false.
export function idResultCard(doc, {
  titleId,
  titleText,
  big,
  copyValue = big,
  copyText = "Copy",
  copyLabel,
  copyFail,
  links: linkList = [],
  acceptText = "",
  returnTo,
  clipboard,
  toast = appToast,
}) {
  if (!doc || !doc.body) return Promise.resolve(false);
  const idRow = doc.createElement("div");
  idRow.className = "mint-result-id-row";
  const id = doc.createElement("div");
  id.className = "mint-result-id";
  id.textContent = big;
  const copy = navButton(doc, "onboard-prev mint-copy", copyText);
  if (copyLabel) copy.setAttribute("aria-label", copyLabel);
  let copiedTimer = 0;
  copy.addEventListener("click", async (event) => {
    stop(event);
    const board = clipboard || (globalThis.navigator && globalThis.navigator.clipboard);
    try {
      if (!board || typeof board.writeText !== "function") throw new Error("no clipboard");
      await board.writeText(copyValue);
      copy.textContent = "Copied";
      copy.classList.add("is-copied");
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copy.textContent = copyText;
        copy.classList.remove("is-copied");
      }, 2000);
    } catch {
      toast.error(copyFail);
    }
  });
  idRow.append(id, copy);
  const anchors = linkList.map(([href, text]) => link(doc, textOf(href), text));
  const links = doc.createElement("p");
  links.className = "onboard-body mint-result-links";
  links.append(...anchors);
  const done = navButton(doc, "onboard-next", "Done");
  const accept = acceptText ? navButton(doc, "onboard-next mint-result-next", acceptText) : null;
  return mountCard(doc, {
    titleId,
    titleText,
    parts: [idRow, links],
    focusables: [copy, ...anchors, done, ...(accept ? [accept] : [])],
    close: done,
    accept,
    first: done,
    returnTo,
  });
}

// true when the person taps Create. read: what readMintFields returned.
export function confirmMint(doc, read, returnTo) {
  const { fields, display } = read;
  return confirmCard(doc, {
    titleId: "mint-confirm-title",
    titleText: "Before you create",
    rows: [
      ["Name", fields.name],
      ["Symbol", fields.symbol],
      ["Decimals", String(fields.decimals)],
      ["Initial supply", `${display.initial} ${fields.symbol}`],
      ["Supply", fields.maxSupply == null ? "Unlimited" : `Capped at ${display.max} ${fields.symbol}`],
      ["Admin key", fields.adminKey ? "On" : `Off. ${ADMIN_OFF_WARNING}`],
      ["Network fee", MINT_NETWORK_FEE],
    ],
    acceptText: "Create",
    returnTo,
  });
}

// The token id, large, with Copy, the two HashScan links and Done.
// Resolves when it is closed.
export function showMintResult(doc, result, { returnTo, clipboard, toast = appToast } = {}) {
  const tokenId = textOf(result && result.tokenId);
  return idResultCard(doc, {
    titleId: "mint-result-title",
    titleText: "Token created",
    big: tokenId,
    copyLabel: `Copy token id ${tokenId}`,
    copyFail: "Could not copy the token id",
    links: [
      [result && result.tokenUrl, "View token on HashScan"],
      [result && result.hashscanUrl, "View transaction"],
    ],
    returnTo,
    clipboard,
    toast,
  });
}

// ── The panel ───────────────────────────────────────────────────────────

export async function appEnsureWallet() {
  const { ensureWallet } = await import("./feedlayout.js");
  return ensureWallet();
}

// ensureWallet clicks the hidden Connect. Its click would bubble to the
// document, whose CloseALL closes the drawer; this listener runs after
// web3.js's own and stops it there. Same as the Inscribe row. Resolves
// "ok", "cancel" or "fail".
export async function mintWalletStep(doc, ensureWallet = appEnsureWallet) {
  const root = doc.documentElement;
  if (root && root.classList) root.classList.add(MINT_CONNECT_CLASS);
  const connect = typeof doc.getElementById === "function" ? doc.getElementById("connect-wallet-btn") : null;
  const keepOpen = (event) => stop(event);
  if (connect) connect.addEventListener("click", keepOpen);
  try {
    return await ensureWallet();
  } catch {
    return "fail";
  } finally {
    if (connect) connect.removeEventListener("click", keepOpen);
    if (root && root.classList) root.classList.remove(MINT_CONNECT_CLASS);
  }
}

// Wires #mint-column. ensureWallet resolves "ok", "cancel" or "fail".
// Returns { run, selectTab, setCapped, setAdmin } for a test, or null.
export function bindMintPanel({
  doc = globalThis.document,
  ensureWallet = appEnsureWallet,
  createToken = createFungibleToken,
  validate = validateTokenFields,
  toast = appToast,
  clipboard,
} = {}) {
  if (!doc || typeof doc.getElementById !== "function") return null;
  const $ = (id) => doc.getElementById(id);
  const form = $("mint-panel-token");
  const create = $("mint-create");
  if (!form || !create) return null;
  const inputs = {
    name: $("mint-name"),
    symbol: $("mint-symbol"),
    decimals: $("mint-decimals"),
    initial: $("mint-initial"),
    max: $("mint-max"),
    memo: $("mint-memo"),
  };
  const errorLine = $("mint-error");
  const admin = $("mint-admin-key");
  const warning = $("mint-admin-warning");
  const unlimited = $("mint-supply-unlimited");
  const capped = $("mint-supply-capped");
  const maxWrap = $("mint-max-wrap");
  const tabs = ["token", "nft", "hashinal"]
    .map((key) => ({ tab: $(`mint-tab-${key}`), panel: $(`mint-panel-${key}`) }))
    .filter((pair) => pair.tab && pair.panel);

  let isCapped = false;
  let adminOn = true;
  let running = false;

  // Tabs: a click, or the arrows, Home and End on the row (one tab stop).
  function selectTab(index, focus) {
    tabs.forEach((pair, i) => {
      const on = i === index;
      pair.tab.setAttribute("aria-selected", on ? "true" : "false");
      pair.tab.tabIndex = on ? 0 : -1;
      pair.tab.classList.toggle("is-on", on);
      pair.panel.hidden = !on;
    });
    if (focus && tabs[index]) focusNode(tabs[index].tab);
  }
  tabs.forEach((pair, i) => {
    pair.tab.addEventListener("click", (event) => {
      stop(event);
      selectTab(i, false);
    });
    pair.tab.addEventListener("keydown", (event) => {
      const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
      if (!(event.key in moves)) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      selectTab((moves[event.key] + tabs.length) % tabs.length, true);
    });
  });

  // Unlimited or Capped. Capped shows Max supply.
  function setCapped(on) {
    isCapped = !!on;
    for (const [button, chosen] of [[unlimited, !isCapped], [capped, isCapped]]) {
      if (!button) continue;
      button.classList.toggle("is-on", chosen);
      button.setAttribute("aria-checked", chosen ? "true" : "false");
      button.tabIndex = chosen ? 0 : -1;
    }
    if (maxWrap) maxWrap.hidden = !isCapped;
  }
  for (const [button, value] of [[unlimited, false], [capped, true]]) {
    if (!button) continue;
    button.addEventListener("click", (event) => {
      stop(event);
      setCapped(value);
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      setCapped(!value);
      focusNode(value ? unlimited : capped);
    });
  }

  // Admin key: on by default; off shows the warning under it.
  function setAdmin(on) {
    adminOn = !!on;
    if (admin) {
      admin.classList.toggle("is-on", adminOn);
      admin.setAttribute("aria-checked", adminOn ? "true" : "false");
    }
    if (warning) warning.hidden = adminOn;
  }
  if (admin) {
    admin.addEventListener("click", (event) => {
      stop(event);
      setAdmin(!adminOn);
    });
  }

  function showError(err) {
    const message = err ? textOf(err.message || err) : "";
    if (errorLine) {
      errorLine.textContent = message;
      errorLine.hidden = !message;
    }
    const bad = err ? fieldOf(err) : "";
    for (const [key, input] of Object.entries(inputs)) {
      if (!input) continue;
      if (key === bad) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
    if (bad && inputs[bad]) focusNode(inputs[bad]);
  }

  function values() {
    const read = (input) => (input ? textOf(input.value) : "");
    return {
      name: read(inputs.name),
      symbol: read(inputs.symbol),
      decimals: read(inputs.decimals),
      initial: read(inputs.initial),
      capped: isCapped,
      max: read(inputs.max),
      memo: read(inputs.memo),
      adminKey: adminOn,
    };
  }

  const walletStep = () => mintWalletStep(doc, ensureWallet);

  // One run at a time: from Create until the result card closes. Resolves
  // what happened, for a test.
  async function run() {
    if (running) return "busy";
    running = true;
    try {
      showError(null);
      let read;
      try {
        read = readMintFields(values(), validate);
      } catch (err) {
        showError(err);
        return "invalid";
      }
      const status = await walletStep();
      if (status === "cancel") return "cancel";
      if (status !== "ok") {
        toast.error("Connect wallet first");
        return "fail";
      }
      if (!(await confirmMint(doc, read, create))) return "declined";
      create.disabled = true;
      const held = toast.hold("Waiting for your wallet…");
      let result;
      try {
        result = await createToken({ ...read.fields });
      } finally {
        if (held && typeof held.done === "function") held.done();
        create.disabled = false;
      }
      await showMintResult(doc, result, { returnTo: create, clipboard, toast });
      return "created";
    } catch (err) {
      if (isQuietWalletError(err)) return "quiet";
      toast.error(err && err.userFacing ? err.message : MINT_FAIL_TEXT);
      return "error";
    } finally {
      running = false;
    }
  }

  // The Create button submits; so does Enter in a field.
  form.addEventListener("submit", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    stop(event);
    run();
  });

  selectTab(0, false);
  setCapped(false);
  setAdmin(true);
  return { run, selectTab, setCapped, setAdmin };
}

// The ? help (#mint-help-overlay): one list per tab, the keys as on the
// panel's tabs. The ? opens it on the tab the panel has selected.
export function bindMintHelp(doc = globalThis.document) {
  const keys = ["token", "nft", "hashinal"];
  const $ = (id) => doc.getElementById(id);
  const tabs = keys.map((key) => $(`mint-help-tab-${key}`));
  if (!tabs.every(Boolean)) return null;
  function show(index, focus) {
    keys.forEach((key, i) => {
      tabs[i].setAttribute("aria-selected", i === index ? "true" : "false");
      tabs[i].tabIndex = i === index ? 0 : -1;
      $(`mint-help-panel-${key}`).hidden = i !== index;
    });
    if (focus) focusNode(tabs[index]);
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => show(i, false));
    tab.addEventListener("keydown", (event) => {
      const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: keys.length - 1 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      show((moves[event.key] + keys.length) % keys.length, true);
    });
  });
  const open = $("help-mint-column");
  if (open) open.addEventListener("click", () => {
    const on = keys.findIndex((key) => {
      const tab = $(`mint-tab-${key}`);
      return tab && tab.getAttribute("aria-selected") === "true";
    });
    show(Math.max(on, 0), false);
  });
  return { show };
}

// The page: wire the real panel (index.html is parsed before modules run).
if (globalThis.document && typeof globalThis.document.getElementById === "function"
  && globalThis.document.getElementById("mint-column")) {
  bindMintPanel();
  bindMintHelp();
}
