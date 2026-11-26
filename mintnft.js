// The Mint panel's NFT tab (#mint-panel-nft, index.html). Two ways in:
// "New collection" makes an NFT collection (tokenmint.js
// createNftCollection), and "Mint into collection" mints a list of links
// into one of yours, ten per wallet-signed transaction (nftbatch.js
// createBatchMinter), with a progress card for long runs and a banner that
// offers an unfinished saved run back. Mainnet only. The connected wallet
// signs and pays; nothing goes to the profile.
//
// index.html keeps "Coming next." in the panel for a page without scripts.
// bindMintNft replaces the panel's content and keeps the element, its id,
// role and aria. The cards and the wallet step are mintpanel.js's.
//
// Nothing sends without a tap: Start (after its card), Resume, and "Mint
// that batch again anyway" (after a second card) are the only ways in.
// A list of 10,000 links is never drawn as 10,000 rows: an imported file
// is a summary card, and the progress card changes a few texts per event.

import { createNftCollection, listMyCollections, validateTokenFields } from "./tokenmint.js";
import { createBatchMinter, discardJob, listSavedJobs, parseLinkList, readCollectionSupply } from "./nftbatch.js";
import { hbarToTinybar, mirrorTxPath } from "./donationmath.js";
import { toast as appToast } from "./toast.js";
import { appEnsureWallet, confirmCard, idResultCard, isQuietWalletError, mintWalletStep } from "./mintpanel.js";

export const NFT_ADMIN_OFF_WARNING = "Without an admin key this collection can never be changed or deleted.";
export const NFT_CREATE_FAIL_TEXT = "Collection create failed. Nothing was charged if your wallet did not approve.";
export const NFT_FIXED_NOTE = "Max supply and royalty can't be changed later. Hedera mainnet, about $1 (about $2 with a royalty).";
export const NFT_FALLBACK_HELP = "Charged when an NFT is traded for no HBAR";
export const NFT_AUTO_APPROVE_NOTE = "Turn on auto-approve in HashPack for long runs.";
export const NFT_PERSIST_TEXT = "Progress can't be saved on this device. Keep this tab open.";
export const NFT_UNCONFIRMED_TEXT = "Your wallet may have sent the last batch, but Hedera hasn't confirmed it yet. Nothing will be minted twice.";
export const NFT_FILE_ACCEPT = ".txt,.csv,.json,text/plain,text/csv,application/json";
// Hedera's limit per mint transaction, and about $0.02 of HBAR per NFT.
export const NFT_PER_TX = 10;
export const NFT_CENTS_EACH = 2;
// Over this many, "Copy serials" copies runs ("1-10000") instead.
export const SERIAL_LIST_LIMIT = 200;
const PROBLEM_LIMIT = 50;
const ACCOUNT_ID = /^\d+\.\d+\.\d+$/;
const FULL = "max supply reached";

function textOf(value) {
  return value == null ? "" : String(value);
}

const count = (n) => (Number(n) || 0).toLocaleString("en-US");
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

// A decimal string (a supply or a serial) grouped like 10,000, exactly.
function groupDigits(value) {
  const text = textOf(value);
  return /^\d+$/.test(text) ? text.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : text;
}

function fieldError(message, field) {
  const err = new Error(message);
  err.userFacing = true;
  if (field) err.field = field;
  return err;
}

const NFT_FIELD_OF = [
  ["Name", "name"],
  ["Symbol", "symbol"],
  ["Memo", "memo"],
  ["Max supply", "max"],
  ["Enter a max supply", "max"],
  ["Royalty percent", "percent"],
  ["Enter an account id", "receiver"],
  ["Enter a collector", "receiver"],
  ["Enter a fallback", "fallback"],
];

function tagField(err) {
  if (err && typeof err === "object" && !err.field) {
    const message = textOf(err.message);
    const hit = NFT_FIELD_OF.find(([prefix]) => message.startsWith(prefix));
    if (hit) err.field = hit[1];
  }
  return err;
}

// ── Pure parts (the test reads these) ──────────────────────────────────

// "5% to your account, fallback 1 HBAR", or "Off".
export function royaltyText(royalty) {
  if (!royalty) return "Off";
  let text = `${royalty.percent}% to ${royalty.collector || "your account"}`;
  if (royalty.fallbackHbar) text += `, fallback ${royalty.fallbackHbar} HBAR`;
  return text;
}

export function nftCreateFee(royalty) {
  return royalty ? "≈ $2, paid by your wallet" : "≈ $1, paid by your wallet";
}

// values, as typed: { name, symbol, max, memo, adminKey, royaltyOn,
// percent, receiver, fallback }. Returns { fields, display }: fields is
// what createNftCollection takes. Throws the first problem in
// createNftCollection's own order and words: tokenmint.js's field checks,
// then "Enter a max supply", then the royalty.
export function readNftFields(values, validate = validateTokenFields) {
  const v = values && typeof values === "object" ? values : {};
  const maxText = textOf(v.max).trim();
  const base = {
    name: v.name,
    symbol: v.symbol,
    memo: v.memo,
    decimals: 0,
    initialSupply: "0",
    maxSupply: maxText === "" ? null : maxText,
  };
  let parsed;
  try {
    parsed = validate(base);
  } catch (err) {
    throw tagField(err);
  }
  if (parsed.maxSupply == null) throw fieldError("Enter a max supply", "max");
  let royalty = null;
  if (v.royaltyOn) {
    const percentText = textOf(v.percent).trim();
    const percent = percentText === "" ? Number.NaN : Number(percentText);
    const collector = textOf(v.receiver).trim();
    try {
      validate({ ...base, percent, ...(collector ? { collector } : {}) });
    } catch (err) {
      throw tagField(err);
    }
    const fallback = textOf(v.fallback).trim();
    if (fallback && hbarToTinybar(fallback) == null) {
      throw fieldError("Enter a fallback from 0.1 to 1000000 HBAR, with at most 8 decimals", "fallback");
    }
    royalty = { percent, collector, fallbackHbar: fallback };
  }
  return {
    fields: {
      name: parsed.name,
      symbol: parsed.symbol,
      maxSupply: parsed.maxSupply.toString(),
      memo: parsed.memo,
      adminKey: v.adminKey !== false,
      royalty,
    },
    display: { max: groupDigits(parsed.maxSupply.toString()), royalty: royaltyText(royalty) },
  };
}

// Whole cents, so 10,012 NFTs are exactly $200.24.
export function usdText(cents) {
  const whole = Math.floor(Math.max(0, Math.round(cents)) / 100);
  const rest = Math.max(0, Math.round(cents)) % 100;
  return rest ? `${count(whole)}.${String(rest).padStart(2, "0")}` : count(whole);
}

// "10,012 NFTs · 1,002 wallet approvals · ≈ $200.24", with a no-break
// space after ≈ so it never ends a line by itself.
export function mintTotals(n) {
  const nfts = Math.max(0, Math.floor(Number(n) || 0));
  const approvals = Math.ceil(nfts / NFT_PER_TX);
  const usd = usdText(nfts * NFT_CENTS_EACH);
  return {
    nfts,
    approvals,
    usd,
    text: `${count(nfts)} ${plural(nfts, "NFT", "NFTs")} · ${count(approvals)} wallet ${plural(approvals, "approval", "approvals")} · ≈ $${usd}`,
  };
}

// The progress card's lines for a runner "progress" payload.
export function progressText({ minted = 0, total = 0, txDone = 0, txCount } = {}) {
  const txs = txCount == null ? Math.ceil(total / NFT_PER_TX) : txCount;
  return {
    count: `${count(minted)} / ${count(total)} minted`,
    tx: `Transaction ${count(txDone)} of ${count(txs)}`,
    value: `${count(minted)} of ${count(total)} NFTs minted`,
    percent: total > 0 ? Math.min(100, (minted / total) * 100) : 0,
  };
}

// The progress card's status line.
export function statusText(status, reason, progress = {}) {
  const txCount = Number(progress.txCount) || 0;
  const next = Math.min((Number(progress.txDone) || 0) + 1, Math.max(txCount, 1));
  switch (status) {
    case "running":
      return `Waiting for your wallet: transaction ${count(next)} of ${count(Math.max(txCount, 1))}`;
    case "paused":
      return reason ? `Paused: ${reason}` : "Paused";
    case "stopped":
      if (reason === FULL) return "Stopped: the collection is full.";
      return reason ? `Stopped: ${reason}` : "Stopped. You can resume later.";
    case "unconfirmed":
      return "Waiting for Hedera to confirm the last batch.";
    case "done":
      return "Done";
    default:
      return reason || "Ready";
  }
}

function sortSerials(serials) {
  return (Array.isArray(serials) ? serials.map(textOf).filter((s) => /^\d+$/.test(s)) : [])
    .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
}

// "Serials 1–10,000" (the first and the last), or "Serial 5".
export function serialRangeText(serials) {
  const list = sortSerials(serials);
  if (!list.length) return "No serials";
  if (list.length === 1) return `Serial ${groupDigits(list[0])}`;
  return `Serials ${groupDigits(list[0])}–${groupDigits(list[list.length - 1])}`;
}

// A comma list; a long one as runs: "1-10000", or "1-100,105,107-110".
export function serialsCopyText(serials) {
  const list = sortSerials(serials);
  if (list.length <= SERIAL_LIST_LIMIT) return list.join(",");
  const runs = [];
  let start = list[0];
  let prev = list[0];
  for (let i = 1; i <= list.length; i++) {
    const serial = list[i];
    if (serial !== undefined && serial === (BigInt(prev) + 1n).toString()) {
      prev = serial;
      continue;
    }
    runs.push(start === prev ? start : `${start}-${prev}`);
    start = serial;
    prev = serial;
  }
  return runs.join(",");
}

// The file's kind for parseLinkList, from its extension.
export function linkFileKind(name) {
  const lower = textOf(name).toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  return "text";
}

function tokenUrl(tokenId) {
  return `https://hashscan.io/mainnet/token/${tokenId}`;
}

function txUrl(txId) {
  const path = mirrorTxPath(txId);
  return path ? `https://hashscan.io/mainnet/transaction/${path}` : "";
}

function jobCounts(job) {
  let minted = 0;
  for (const row of (job && job.minted) || []) minted += Array.isArray(row.serials) ? row.serials.length : 0;
  const total = Array.isArray(job && job.links) ? job.links.length : 0;
  return { minted, total, txDone: ((job && job.minted) || []).length, txCount: Math.ceil(total / NFT_PER_TX) };
}

// ── The cards ──────────────────────────────────────────────────────────

// true when the person taps Create. read: what readNftFields returned.
export function confirmNftCreate(doc, read, returnTo) {
  const { fields, display } = read;
  return confirmCard(doc, {
    titleId: "mint-nft-confirm-title",
    titleText: "Before you create",
    rows: [
      ["Name", fields.name],
      ["Symbol", fields.symbol],
      ["Max supply", display.max],
      ["Royalty", display.royalty],
      ["Admin key", fields.adminKey ? "On" : `Off. ${NFT_ADMIN_OFF_WARNING}`],
      ["Network fee", nftCreateFee(fields.royalty)],
    ],
    acceptText: "Create",
    returnTo,
  });
}

// plan: { collection, nfts, duplicates, over }. true when Start is tapped.
export function confirmNftMint(doc, plan, returnTo) {
  const totals = mintTotals(plan.nfts);
  const rows = [
    ["Collection", plan.collection],
    ["NFTs", count(totals.nfts)],
    ["Transactions", `${count(totals.approvals)} (10 NFTs per transaction, the Hedera limit)`],
    ["Estimated fee", `≈ $${totals.usd} in HBAR, paid by your wallet`],
  ];
  if (plan.duplicates > 0) rows.push(["Duplicates", count(plan.duplicates)]);
  if (plan.over > 0) {
    rows.push(["Max supply", `This is ${count(plan.over)} more than the collection has left. Minting stops when it is full.`, true]);
  }
  return confirmCard(doc, {
    titleId: "mint-nft-start-title",
    titleText: "Before you mint",
    rows,
    acceptText: "Start",
    returnTo,
  });
}

// "Collection created": the id with Copy, the links, Done, and "Mint into
// it" (true).
export function showNftResult(doc, result, options = {}) {
  const tokenId = textOf(result && result.tokenId);
  return idResultCard(doc, {
    titleId: "mint-nft-result-title",
    titleText: "Collection created",
    big: tokenId,
    copyLabel: `Copy token id ${tokenId}`,
    copyFail: "Could not copy the token id",
    links: [
      [result && result.tokenUrl, "View collection on HashScan"],
      [result && result.hashscanUrl, "View transaction"],
    ],
    acceptText: "Mint into it",
    ...options,
  });
}

// "Minted N NFTs": the serial range with Copy serials, the collection and
// the last transaction on HashScan, and Done.
export function showNftMinted(doc, { tokenId, serials, txIds }, options = {}) {
  const n = Array.isArray(serials) ? serials.length : 0;
  const last = Array.isArray(txIds) && txIds.length ? txIds[txIds.length - 1] : "";
  const links = [[tokenUrl(tokenId), "View collection on HashScan"]];
  if (txUrl(last)) links.push([txUrl(last), "View last transaction"]);
  return idResultCard(doc, {
    titleId: "mint-nft-minted-title",
    titleText: `Minted ${count(n)} ${plural(n, "NFT", "NFTs")}`,
    big: serialRangeText(serials),
    copyValue: serialsCopyText(serials),
    copyText: "Copy serials",
    copyLabel: "Copy the serial numbers",
    copyFail: "Could not copy the serials",
    links,
    ...options,
  });
}

// ── The tab ────────────────────────────────────────────────────────────

async function appAccount() {
  try {
    const web3 = await import("./web3.js");
    return typeof web3.connectedAccount === "string" ? web3.connectedAccount.trim() : "";
  } catch {
    return "";
  }
}

function readText(file) {
  if (file && typeof file.text === "function") return file.text();
  return Promise.reject(new Error("unreadable"));
}

function stop(event) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
}

function focusNode(node) {
  if (!node || typeof node.focus !== "function" || node.hidden || node.disabled) return;
  try {
    node.focus({ preventScroll: true });
  } catch {
    try { node.focus(); } catch { /* it can refuse focus */ }
  }
}

// Wires #mint-panel-nft. Returns the tab's handles for a test, or null.
export function bindMintNft({
  doc = globalThis.document,
  ensureWallet = appEnsureWallet,
  getAccount = appAccount,
  createCollection = createNftCollection,
  listCollections = listMyCollections,
  readSupply = readCollectionSupply,
  createMinter = createBatchMinter,
  listJobs = listSavedJobs,
  dropJob = discardJob,
  parseLinks = parseLinkList,
  readFile = readText,
  validate = validateTokenFields,
  storage,
  toast = appToast,
  clipboard,
} = {}) {
  if (!doc || typeof doc.getElementById !== "function" || !doc.body) return null;
  const panel = doc.getElementById("mint-panel-nft");
  if (!panel) return null;

  // ── Building blocks ──────────────────────────────────────────────────
  const make = (tag, className, text) => {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };
  const button = (className, text) => {
    const el = make("button", className, text);
    el.type = "button";
    return el;
  };
  const note = (className, text, hidden = false) => {
    const el = make("p", className, text);
    el.hidden = hidden;
    return el;
  };
  const field = (id, label, placeholder, extra = {}) => {
    const name = make("label", "mint-label", label);
    name.htmlFor = id;
    const input = make("input", "toolbar-column");
    input.type = "text";
    input.id = id;
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    if (extra.inputMode) input.inputMode = extra.inputMode;
    if (extra.caps) input.setAttribute("autocapitalize", "characters");
    return { name, input };
  };
  const toggle = (id, label, on) => {
    const el = button(on ? "feed-settings-switch is-on mint-switch" : "feed-settings-switch mint-switch");
    el.id = id;
    el.setAttribute("role", "switch");
    el.setAttribute("aria-checked", on ? "true" : "false");
    const ui = make("span", "feed-settings-switch-ui");
    ui.setAttribute("aria-hidden", "true");
    el.append(make("span", "", label), ui);
    return el;
  };
  const setSwitch = (el, on) => {
    el.classList.toggle("is-on", on);
    el.setAttribute("aria-checked", on ? "true" : "false");
  };
  const row = (className, ...children) => {
    const el = make("div", className);
    el.append(...children);
    return el;
  };

  // ── The panel's content (the element, its id, role and aria stay) ───
  panel.textContent = "";
  panel.classList.remove("mint-card", "mint-soon");
  panel.classList.add("mint-form", "mint-nft");

  // Unfinished saved run.
  const banner = make("div", "mint-card mint-resume");
  banner.hidden = true;
  banner.setAttribute("role", "status");
  const bannerText = note("mint-resume-text", "");
  const bannerResume = button("mint-ghost", "Resume");
  const bannerCheck = button("mint-ghost", "Check again");
  const bannerDiscard = button("mint-ghost mint-danger", "Discard");
  banner.append(bannerText, row("mint-actions", bannerResume, bannerCheck, bannerDiscard));

  // The long run.
  const progress = make("div", "mint-card mint-progress");
  progress.hidden = true;
  const progressTitle = note("mint-progress-title", "");
  const bar = make("div", "mint-progress-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Minting progress");
  bar.setAttribute("aria-valuemin", "0");
  const fill = make("div", "mint-progress-fill");
  bar.appendChild(fill);
  const progressCount = note("mint-progress-count", "");
  const progressTx = note("mint-note mint-progress-tx", "");
  const progressStatus = note("mint-progress-status", "");
  progressStatus.setAttribute("aria-live", "polite");
  const persistLine = note("mint-warning mint-progress-persist", NFT_PERSIST_TEXT, true);
  const unconfirmed = make("div", "mint-unconfirmed");
  unconfirmed.hidden = true;
  const recheckBtn = button("mint-ghost", "Check again");
  const remintBtn = button("mint-ghost mint-danger", "Mint that batch again anyway");
  unconfirmed.append(note("mint-warning", NFT_UNCONFIRMED_TEXT), row("mint-actions", recheckBtn, remintBtn));
  const pauseBtn = button("mint-ghost", "Pause");
  const resumeBtn = button("mint-ghost", "Resume");
  const stopBtn = button("mint-ghost mint-danger", "Stop");
  const closeBtn = button("mint-ghost", "Close");
  progress.append(progressTitle, bar, progressCount, progressTx, progressStatus, persistLine, unconfirmed,
    row("mint-actions", pauseBtn, resumeBtn, stopBtn, closeBtn));

  // New collection / Mint into collection.
  const modes = make("div", "feed-settings-radios mint-supply mint-nft-mode");
  modes.setAttribute("role", "radiogroup");
  modes.setAttribute("aria-label", "What to do");
  const modeNew = button("feed-settings-choice is-on", "New collection");
  modeNew.id = "mint-nft-mode-new";
  const modeMint = button("feed-settings-choice", "Mint into collection");
  modeMint.id = "mint-nft-mode-mint";
  for (const choice of [modeNew, modeMint]) choice.setAttribute("role", "radio");
  modes.append(modeNew, modeMint);

  // A) New collection.
  const createForm = make("form", "mint-form");
  createForm.id = "mint-nft-create";
  createForm.setAttribute("novalidate", "");
  const nameField = field("mint-nft-name", "Name", "My collection");
  const symbolField = field("mint-nft-symbol", "Symbol", "MYC", { caps: true });
  const maxField = field("mint-nft-max", "Max supply", "10000", { inputMode: "numeric" });
  const memoField = field("mint-nft-memo", "Memo (optional)", "Memo");
  const royaltySwitch = toggle("mint-nft-royalty", "Royalty", false);
  const percentField = field("mint-nft-percent", "Percent (0.01 to 50)", "5", { inputMode: "decimal" });
  const receiverField = field("mint-nft-receiver", "Receiver", "Your account");
  const fallbackField = field("mint-nft-fallback", "Fallback fee in HBAR (optional)", "", { inputMode: "decimal" });
  const royaltyWrap = row("mint-max", percentField.name, percentField.input, receiverField.name, receiverField.input,
    fallbackField.name, fallbackField.input, note("mint-note", NFT_FALLBACK_HELP));
  royaltyWrap.id = "mint-nft-royalty-wrap";
  royaltyWrap.hidden = true;
  const adminSwitch = toggle("mint-nft-admin-key", "Admin key", true);
  const adminWarning = note("mint-warning", NFT_ADMIN_OFF_WARNING, true);
  adminWarning.id = "mint-nft-admin-warning";
  const createBtn = make("button", "toolbar-column-btns mint-submit", "Create collection");
  createBtn.type = "submit";
  createBtn.id = "mint-nft-create-btn";
  const createError = note("mint-error", "", true);
  createError.id = "mint-nft-create-error";
  createError.setAttribute("role", "alert");
  createForm.append(
    row("mint-card", nameField.name, nameField.input, symbolField.name, symbolField.input),
    row("mint-card", maxField.name, maxField.input, royaltySwitch, royaltyWrap),
    row("mint-card", memoField.name, memoField.input, adminSwitch, adminWarning,
      note("mint-note", NFT_FIXED_NOTE), createBtn, createError),
  );
  const createInputs = {
    name: nameField.input,
    symbol: symbolField.input,
    max: maxField.input,
    memo: memoField.input,
    percent: percentField.input,
    receiver: receiverField.input,
    fallback: fallbackField.input,
  };

  // B) Mint into collection.
  const mintForm = make("form", "mint-form");
  mintForm.id = "mint-nft-mint";
  mintForm.setAttribute("novalidate", "");
  mintForm.hidden = true;
  const selectName = make("label", "mint-label", "Collection");
  selectName.htmlFor = "mint-nft-collection";
  const select = make("select", "mint-select");
  select.id = "mint-nft-collection";
  const listStatus = note("mint-note", "", true);
  listStatus.setAttribute("aria-live", "polite");
  const retryBtn = button("mint-ghost", "Retry");
  retryBtn.hidden = true;
  const tokenField = field("mint-nft-token", "or paste a token id", "0.0.123", { inputMode: "decimal" });
  const supplyLine = note("mint-note mint-supply-line", "", true);
  supplyLine.setAttribute("aria-live", "polite");

  const linksName = make("span", "mint-label", "Links");
  const linkList = make("div", "mint-links");
  const addBtn = button("mint-ghost", "+ Add link");
  const importBtn = button("mint-ghost", "Import file");
  const fileInput = make("input");
  fileInput.type = "file";
  fileInput.accept = NFT_FILE_ACCEPT;
  fileInput.hidden = true;
  fileInput.tabIndex = -1;
  fileInput.setAttribute("aria-hidden", "true");
  // Every click that reaches the document runs CloseALL (cssLogic.js),
  // which would close the Toolbar under the picker (inscriberow.js).
  fileInput.addEventListener("click", stop);
  doc.body.appendChild(fileInput);

  const summary = make("div", "mint-import");
  summary.hidden = true;
  const summaryName = note("mint-import-name", "");
  const summaryCounts = note("mint-note mint-import-counts", "");
  const problems = make("details", "mint-import-details");
  problems.hidden = true;
  const problemsHead = make("summary", "", "Show bad lines and duplicates");
  const problemList = make("ul", "mint-import-list");
  problems.append(problemsHead, problemList);
  const removeFileBtn = button("mint-ghost", "Remove file");
  summary.append(summaryName, summaryCounts, problems, removeFileBtn);

  const totalsLine = note("mint-totals", "");
  totalsLine.setAttribute("aria-live", "polite");
  const startBtn = button("toolbar-column-btns mint-submit", "Start minting");
  startBtn.id = "mint-nft-start";
  startBtn.setAttribute("aria-describedby", "mint-nft-start-hint");
  const startHint = note("mint-note mint-hint", "");
  startHint.id = "mint-nft-start-hint";
  const mintError = note("mint-error", "", true);
  mintError.setAttribute("role", "alert");
  mintForm.append(
    row("mint-card", selectName, select, row("mint-status-row", listStatus, retryBtn),
      tokenField.name, tokenField.input, supplyLine),
    row("mint-card", linksName, summary, linkList, row("mint-actions", addBtn, importBtn)),
    row("mint-card", totalsLine, note("mint-note", NFT_AUTO_APPROVE_NOTE), startBtn, startHint, mintError),
  );

  panel.append(banner, progress, modes, createForm, mintForm);

  // ── State ────────────────────────────────────────────────────────────
  let mode = "new";
  let adminOn = true;
  let royaltyOn = false;
  let creating = false;
  let starting = false;
  let collections = null;
  const madeHere = [];
  let loadSeq = 0;
  let supply = null;
  let supplySeq = 0;
  let supplyTimer = 0;
  let imported = null;
  let importing = false;
  const rows = [];
  let rowSeq = 0;
  let minter = null;
  let runToken = "";
  let unsubscribe = [];
  let lastProgress = { minted: 0, total: 0, txDone: 0, txCount: 0 };
  let lastStatus = "idle";
  let lastReason = "";
  let savedJob = null;
  let acting = false;

  const walletStep = () => mintWalletStep(doc, ensureWallet);

  // ── Mode ─────────────────────────────────────────────────────────────
  function paintForms() {
    const runOn = !!minter;
    modes.hidden = runOn;
    createForm.hidden = runOn || mode !== "new";
    mintForm.hidden = runOn || mode !== "mint";
    progress.hidden = !runOn;
    if (runOn) banner.hidden = true;
  }

  function setMode(next, { load = true } = {}) {
    mode = next === "mint" ? "mint" : "new";
    for (const [choice, on] of [[modeNew, mode === "new"], [modeMint, mode === "mint"]]) {
      choice.classList.toggle("is-on", on);
      choice.setAttribute("aria-checked", on ? "true" : "false");
      choice.tabIndex = on ? 0 : -1;
    }
    paintForms();
    if (mode === "mint" && load && collections == null) return loadCollections();
    return Promise.resolve("shown");
  }
  for (const [choice, value] of [[modeNew, "new"], [modeMint, "mint"]]) {
    choice.addEventListener("click", (event) => {
      stop(event);
      setMode(value);
    });
    choice.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      setMode(value === "new" ? "mint" : "new");
      focusNode(value === "new" ? modeMint : modeNew);
    });
  }

  // ── A) New collection ────────────────────────────────────────────────
  function setAdmin(on) {
    adminOn = !!on;
    setSwitch(adminSwitch, adminOn);
    adminWarning.hidden = adminOn;
  }
  function setRoyalty(on) {
    royaltyOn = !!on;
    setSwitch(royaltySwitch, royaltyOn);
    royaltyWrap.hidden = !royaltyOn;
  }
  adminSwitch.addEventListener("click", (event) => {
    stop(event);
    setAdmin(!adminOn);
  });
  royaltySwitch.addEventListener("click", (event) => {
    stop(event);
    setRoyalty(!royaltyOn);
  });

  function showCreateError(err) {
    const message = err ? textOf(err.message || err) : "";
    createError.textContent = message;
    createError.hidden = !message;
    const bad = err && err.field;
    for (const [key, input] of Object.entries(createInputs)) {
      if (key === bad) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
    if (bad && createInputs[bad]) focusNode(createInputs[bad]);
  }

  function createValues() {
    const value = (input) => textOf(input.value);
    return {
      name: value(createInputs.name),
      symbol: value(createInputs.symbol),
      max: value(createInputs.max),
      memo: value(createInputs.memo),
      adminKey: adminOn,
      royaltyOn,
      percent: value(createInputs.percent),
      receiver: value(createInputs.receiver),
      fallback: value(createInputs.fallback),
    };
  }

  // From Create collection until its result card closes.
  async function runCreate() {
    if (creating) return "busy";
    creating = true;
    try {
      showCreateError(null);
      let read;
      try {
        read = readNftFields(createValues(), validate);
      } catch (err) {
        showCreateError(err);
        return "invalid";
      }
      const status = await walletStep();
      if (status === "cancel") return "cancel";
      if (status !== "ok") {
        toast.error("Connect wallet first");
        return "fail";
      }
      if (!(await confirmNftCreate(doc, read, createBtn))) return "declined";
      createBtn.disabled = true;
      const held = toast.hold("Waiting for your wallet…");
      let result;
      try {
        result = await createCollection({ ...read.fields });
      } finally {
        if (held && typeof held.done === "function") held.done();
        createBtn.disabled = false;
      }
      const next = await showNftResult(doc, result, { returnTo: createBtn, clipboard, toast });
      if (next) {
        const tokenId = textOf(result && result.tokenId);
        madeHere.push({ tokenId, name: read.fields.name, symbol: read.fields.symbol, totalSupply: "0", maxSupply: read.fields.maxSupply });
        await setMode("mint");
        chooseCollection(tokenId);
        focusNode(select);
      }
      return "created";
    } catch (err) {
      if (isQuietWalletError(err)) return "quiet";
      toast.error(err && err.userFacing ? err.message : NFT_CREATE_FAIL_TEXT);
      return "error";
    } finally {
      creating = false;
    }
  }
  createForm.addEventListener("submit", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    stop(event);
    runCreate();
  });

  // ── B) The collection ────────────────────────────────────────────────
  const collectionLabel = (c) => `${c.name || "Unnamed"} (${c.symbol || "?"}) · ${c.tokenId} · ${groupDigits(c.totalSupply)}/${groupDigits(c.maxSupply)}`;

  function knownCollections() {
    const list = Array.isArray(collections) ? collections.slice() : [];
    for (const made of madeHere) if (!list.some((c) => c.tokenId === made.tokenId)) list.unshift(made);
    return list;
  }

  function fillSelect() {
    const keep = textOf(select.value);
    select.textContent = "";
    const list = knownCollections();
    const first = make("option", "", list.length ? "Choose a collection" : "No collections yet");
    first.value = "";
    select.appendChild(first);
    for (const c of list) {
      const option = make("option", "", collectionLabel(c));
      option.value = c.tokenId;
      select.appendChild(option);
    }
    select.value = list.some((c) => c.tokenId === keep) ? keep : "";
  }

  function setListStatus(kind) {
    const lines = {
      loading: "Loading your collections…",
      connect: "Connect your wallet to see your collections.",
      fail: "Couldn't load your collections",
      empty: "No collections yet. Create one, or paste a token id.",
    };
    listStatus.textContent = lines[kind] || "";
    listStatus.hidden = !lines[kind];
    retryBtn.hidden = kind !== "fail" && kind !== "connect";
  }

  async function loadCollections() {
    const seq = ++loadSeq;
    setListStatus("loading");
    const status = await walletStep();
    if (seq !== loadSeq) return "stale";
    if (status === "cancel") {
      setListStatus("connect");
      return "cancel";
    }
    if (status !== "ok") {
      setListStatus("fail");
      return "fail";
    }
    const account = await getAccount();
    refreshJobs();
    let list;
    try {
      if (!ACCOUNT_ID.test(textOf(account))) throw new Error("Connect wallet first");
      list = await listCollections(account);
    } catch {
      if (seq === loadSeq) setListStatus("fail");
      return "fail";
    }
    if (seq !== loadSeq) return "stale";
    collections = Array.isArray(list) ? list : [];
    fillSelect();
    setListStatus(knownCollections().length ? "" : "empty");
    return "ok";
  }
  retryBtn.addEventListener("click", (event) => {
    stop(event);
    loadCollections();
  });

  // The pasted id wins when it is filled in.
  function chosenId() {
    const pasted = textOf(tokenField.input.value).trim();
    if (pasted) return ACCOUNT_ID.test(pasted) ? pasted : "";
    return textOf(select.value);
  }

  function chosenLabel(tokenId) {
    const found = knownCollections().find((c) => c.tokenId === tokenId);
    return found ? `${found.name || "Unnamed"} (${found.symbol || "?"}) · ${tokenId}` : tokenId;
  }

  function paintSupply() {
    let text = "";
    if (supply && supply.loading) text = "Reading the collection…";
    else if (supply && supply.error) text = supply.error;
    else if (supply && supply.remaining != null) text = `${groupDigits(supply.remaining)} of ${groupDigits(supply.maxSupply)} left`;
    else if (supply) text = `${groupDigits(supply.totalSupply)} minted · no max supply`;
    supplyLine.textContent = text;
    supplyLine.hidden = !text;
    supplyLine.classList.toggle("is-bad", !!(supply && supply.error));
  }

  async function readSupplyFor(tokenId) {
    const seq = ++supplySeq;
    if (!tokenId) {
      supply = null;
      paintSupply();
      return null;
    }
    supply = { tokenId, loading: true };
    paintSupply();
    let next;
    try {
      next = { tokenId, ...(await readSupply(tokenId)) };
    } catch (err) {
      next = { tokenId, error: textOf(err && err.message) || "Could not read the collection" };
    }
    if (seq !== supplySeq) return supply;
    supply = next;
    paintSupply();
    recompute();
    return supply;
  }

  function onCollectionChange() {
    clearTimeout(supplyTimer);
    const pasted = textOf(tokenField.input.value).trim();
    if (pasted && !ACCOUNT_ID.test(pasted)) {
      supplySeq += 1;
      supply = { tokenId: "", error: "Enter a token id like 0.0.123" };
      paintSupply();
      recompute();
      return;
    }
    readSupplyFor(chosenId());
    recompute();
  }

  function chooseCollection(tokenId) {
    fillSelect();
    tokenField.input.value = "";
    select.value = tokenId;
    if (textOf(select.value) !== tokenId) tokenField.input.value = tokenId;
    onCollectionChange();
  }

  select.addEventListener("change", () => onCollectionChange());
  tokenField.input.addEventListener("input", () => {
    recompute();
    clearTimeout(supplyTimer);
    const pasted = textOf(tokenField.input.value).trim();
    if (!pasted || ACCOUNT_ID.test(pasted)) supplyTimer = setTimeout(onCollectionChange, 350);
  });
  tokenField.input.addEventListener("change", () => onCollectionChange());

  // ── B) The links ─────────────────────────────────────────────────────
  function judgeRows() {
    const seen = new Set(imported ? imported.set : []);
    return rows.map((entry) => {
      const value = textOf(entry.input.value).trim();
      if (!value) return { entry, kind: "blank" };
      const parsed = parseLinks(value, { kind: "text" });
      if (parsed.bad.length) return { entry, kind: "bad", reason: parsed.bad[0].reason || "Not a link" };
      const link = parsed.links[0];
      const dup = seen.has(link);
      seen.add(link);
      return { entry, kind: dup ? "dup" : "ok", value: link };
    });
  }

  function paintRowMessages(judged) {
    for (const { entry, kind, reason } of judged) {
      if (!entry.touched) continue;
      const message = kind === "bad" ? reason : kind === "dup" ? "Duplicate of an earlier link" : "";
      entry.msg.textContent = message;
      entry.msg.hidden = !message;
      entry.msg.classList.toggle("is-dup", kind === "dup");
      if (kind === "bad") entry.input.setAttribute("aria-invalid", "true");
      else entry.input.removeAttribute("aria-invalid");
    }
  }

  // The whole list, as it would be minted: the file's links, then the rows.
  function plan() {
    const judged = judgeRows();
    const rowLinks = judged.filter((r) => r.kind === "ok" || r.kind === "dup").map((r) => r.value);
    const links = imported ? imported.links.concat(rowLinks) : rowLinks;
    const bad = (imported ? imported.bad.length : 0) + judged.filter((r) => r.kind === "bad").length;
    const duplicates = (imported ? imported.duplicates.length : 0) + judged.filter((r) => r.kind === "dup").length;
    return { judged, links, bad, duplicates, tokenId: chosenId() };
  }

  function recompute() {
    const now = plan();
    paintRowMessages(now.judged);
    totalsLine.textContent = mintTotals(now.links.length).text;
    let hint = "";
    if (now.bad > 0) hint = `Fix or remove ${count(now.bad)} bad ${plural(now.bad, "link", "links")}`;
    else if (!now.tokenId) hint = "Choose a collection";
    else if (supply && supply.tokenId === now.tokenId && supply.error === "This token is not an NFT collection") hint = supply.error;
    else if (!now.links.length) hint = "Add at least one link";
    startHint.textContent = hint;
    startHint.hidden = !hint;
    startBtn.disabled = !!hint || starting;
    return now;
  }

  function renumberRows() {
    rows.forEach((entry, index) => {
      entry.input.setAttribute("aria-label", `Link ${index + 1}`);
      entry.remove.setAttribute("aria-label", `Remove link ${index + 1}`);
    });
  }

  function addRow(value = "", focus = false) {
    const entry = { touched: false };
    entry.id = `mint-nft-link-${++rowSeq}`;
    entry.input = make("input", "toolbar-column mint-link-input");
    entry.input.type = "text";
    entry.input.id = entry.id;
    entry.input.placeholder = "ipfs://… or https://…";
    entry.input.autocomplete = "off";
    entry.input.spellcheck = false;
    entry.input.inputMode = "url";
    entry.input.value = value;
    entry.remove = button("mint-link-remove", "×");
    entry.msg = note("mint-link-msg", "", true);
    entry.wrap = row("mint-link-row", entry.input, entry.remove, entry.msg);
    // The row's own × is its clear: no fieldclear.js × inside the field.
    entry.wrap.setAttribute("data-no-clear", "");
    entry.input.addEventListener("input", () => recompute());
    entry.input.addEventListener("blur", () => {
      entry.touched = true;
      recompute();
    });
    // Enter starts the next link, not the form.
    entry.input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      entry.touched = true;
      const at = rows.indexOf(entry);
      if (at === rows.length - 1) addRow("", true);
      else focusNode(rows[at + 1].input);
      recompute();
    });
    entry.remove.addEventListener("click", (event) => {
      stop(event);
      removeRow(entry);
    });
    rows.push(entry);
    linkList.appendChild(entry.wrap);
    renumberRows();
    recompute();
    if (focus) focusNode(entry.input);
    return entry;
  }

  function removeRow(entry) {
    const at = rows.indexOf(entry);
    if (at < 0) return;
    rows.splice(at, 1);
    entry.wrap.remove();
    renumberRows();
    recompute();
    focusNode(rows[Math.min(at, rows.length - 1)] ? rows[Math.min(at, rows.length - 1)].input : addBtn);
  }

  addBtn.addEventListener("click", (event) => {
    stop(event);
    addRow("", true);
  });

  function paintImport() {
    summary.hidden = !imported;
    if (!imported) return;
    const { links, bad, duplicates } = imported;
    summaryName.textContent = imported.name;
    summaryCounts.textContent = `${count(links.length)} ${plural(links.length, "link", "links")} · ${count(bad.length)} bad · ${count(duplicates.length)} ${plural(duplicates.length, "duplicate", "duplicates")}`;
    problemList.textContent = "";
    for (const item of bad.slice(0, PROBLEM_LIMIT)) {
      problemList.appendChild(make("li", "is-bad", `line ${item.line}: ${item.reason}`));
    }
    for (const item of duplicates.slice(0, PROBLEM_LIMIT)) {
      problemList.appendChild(make("li", "is-dup", `line ${item.line}: Duplicate of line ${item.firstLine}`));
    }
    const more = Math.max(0, bad.length - PROBLEM_LIMIT) + Math.max(0, duplicates.length - PROBLEM_LIMIT);
    if (more) problemList.appendChild(make("li", "", `and ${count(more)} more`));
    problems.hidden = !(bad.length || duplicates.length);
  }

  // A file's links: one summary, never a row per link.
  async function importFile(file) {
    if (!file || importing) return "busy";
    importing = true;
    importBtn.disabled = true;
    try {
      let text;
      try {
        text = await readFile(file);
      } catch {
        toast.error("Could not read that file");
        return "unreadable";
      }
      const parsed = parseLinks(text, { kind: linkFileKind(file.name) });
      imported = {
        name: textOf(file.name) || "Links",
        links: parsed.links,
        bad: parsed.bad,
        duplicates: parsed.duplicates,
        set: new Set(parsed.links),
      };
      paintImport();
      recompute();
      return "imported";
    } finally {
      importing = false;
      importBtn.disabled = false;
    }
  }

  // The picker opens inside the same tap: a picker opened after an await
  // is blocked.
  importBtn.addEventListener("click", (event) => {
    stop(event);
    if (importing) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (file) importFile(file);
  });
  removeFileBtn.addEventListener("click", (event) => {
    stop(event);
    imported = null;
    paintImport();
    recompute();
    focusNode(importBtn);
  });

  // ── B) Start ─────────────────────────────────────────────────────────
  function showMintError(message) {
    mintError.textContent = message || "";
    mintError.hidden = !message;
  }

  async function runMint() {
    if (starting || minter) return "busy";
    const now = recompute();
    if (startBtn.disabled) return "blocked";
    starting = true;
    startBtn.disabled = true;
    showMintError("");
    try {
      const status = await walletStep();
      if (status === "cancel") return "cancel";
      if (status !== "ok") {
        toast.error("Connect wallet first");
        return "fail";
      }
      const account = textOf(await getAccount());
      if (!ACCOUNT_ID.test(account)) {
        toast.error("Connect wallet first");
        return "fail";
      }
      // A saved run for this collection would be resumed in place of
      // this list (nftbatch.js), so it is finished or discarded first.
      const saved = listJobs(account, storage).find((job) => job.tokenId === now.tokenId && job.status !== "done");
      if (saved) {
        await refreshJobs();
        toast.info(`Finish or discard the unfinished mint into ${now.tokenId} first`);
        return "saved";
      }
      let read = supply && supply.tokenId === now.tokenId && !supply.loading && !supply.error ? supply : null;
      if (!read) read = await readSupplyFor(now.tokenId);
      if (!read || read.error) {
        showMintError((read && read.error) || "Could not read the collection");
        return "invalid";
      }
      let over = 0;
      if (read.remaining != null) {
        const extra = BigInt(now.links.length) - BigInt(read.remaining);
        if (extra > 0n) over = Number(extra);
      }
      const yes = await confirmNftMint(doc, {
        collection: chosenLabel(now.tokenId),
        nfts: now.links.length,
        duplicates: now.duplicates,
        over,
      }, startBtn);
      if (!yes) return "declined";
      const made = createMinter({ tokenId: now.tokenId, links: now.links, accountId: account, storage });
      follow(made, now.tokenId);
      // Running from the tap on: the runner reads the supply before its
      // first status event.
      paintStatus({ status: "running" });
      focusRun();
      go(() => made.start());
      return "started";
    } finally {
      starting = false;
      recompute();
    }
  }
  startBtn.addEventListener("click", (event) => {
    stop(event);
    runMint();
  });
  mintForm.addEventListener("submit", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    stop(event);
  });

  // ── The progress card ────────────────────────────────────────────────
  function paintProgress(payload) {
    lastProgress = { ...lastProgress, ...payload };
    const lines = progressText(lastProgress);
    fill.style.width = `${lines.percent}%`;
    bar.setAttribute("aria-valuemax", String(lastProgress.total));
    bar.setAttribute("aria-valuenow", String(lastProgress.minted));
    bar.setAttribute("aria-valuetext", lines.value);
    progressCount.textContent = lines.count;
    progressTx.textContent = lines.tx;
    if (lastStatus === "running") progressStatus.textContent = statusText("running", "", lastProgress);
  }

  function checkPersist() {
    if (!minter) return;
    try {
      if (minter.state().persistError) persistLine.hidden = false;
    } catch {
      // A runner that cannot report its state keeps the line as it was.
    }
  }

  function paintStatus({ status, reason } = {}) {
    lastStatus = status || "idle";
    lastReason = textOf(reason);
    const running = lastStatus === "running";
    const full = lastStatus === "stopped" && lastReason === FULL;
    unconfirmed.hidden = lastStatus !== "unconfirmed";
    pauseBtn.hidden = !running;
    pauseBtn.disabled = false;
    stopBtn.hidden = !running;
    resumeBtn.hidden = !(lastStatus === "paused" || lastStatus === "idle" || (lastStatus === "stopped" && !full));
    closeBtn.hidden = running;
    recheckBtn.disabled = false;
    remintBtn.disabled = false;
    progressStatus.textContent = statusText(lastStatus, lastReason, lastProgress);
    checkPersist();
  }

  // The runner's events drive the card. One runner at a time.
  function follow(made, tokenId) {
    minter = made;
    runToken = tokenId;
    persistLine.hidden = true;
    progressTitle.textContent = `Minting into ${tokenId}`;
    const state = made.state();
    paintProgress(jobCounts(state));
    paintStatus({ status: state.status, reason: state.reason });
    unsubscribe = [
      made.on("progress", (payload) => paintProgress(payload)),
      made.on("status", (payload) => paintStatus(payload)),
      made.on("warning", (payload) => {
        toast.info(textOf(payload && payload.message));
        checkPersist();
      }),
      made.on("done", (payload) => finishRun(payload)),
    ];
    paintForms();
  }

  // The Start button is gone under the card: focus its first button.
  function focusRun() {
    const first = [pauseBtn, resumeBtn, recheckBtn, closeBtn].find((node) => !node.hidden
      && !(node === recheckBtn && unconfirmed.hidden));
    focusNode(first);
  }

  function letGo() {
    for (const off of unsubscribe) if (typeof off === "function") off();
    unsubscribe = [];
    minter = null;
    runToken = "";
    paintForms();
  }

  // start(), resume() and the re-mint settle by their events. A throw
  // (no wallet, the collection could not be read) pauses the card.
  function go(task) {
    let pending;
    try {
      pending = Promise.resolve(task());
    } catch (err) {
      pending = Promise.reject(err);
    }
    return pending.catch((err) => {
      if (!minter) return;
      const quiet = isQuietWalletError(err);
      paintStatus({ status: "paused", reason: quiet ? "Wallet declined" : (textOf(err && err.message) || "Minting stopped") });
    });
  }

  async function finishRun(summaryData) {
    const tokenId = runToken;
    letGo();
    imported = null;
    paintImport();
    for (const entry of rows.slice()) {
      rows.splice(rows.indexOf(entry), 1);
      entry.wrap.remove();
    }
    addRow("");
    readSupplyFor(chosenId());
    await showNftMinted(doc, {
      tokenId,
      serials: (summaryData && summaryData.serials) || [],
      txIds: (summaryData && summaryData.txIds) || [],
    }, { returnTo: startBtn, clipboard, toast });
    refreshJobs();
  }

  pauseBtn.addEventListener("click", (event) => {
    stop(event);
    if (!minter) return;
    minter.pause();
    pauseBtn.disabled = true;
    progressStatus.textContent = "Pausing after this transaction…";
  });

  stopBtn.addEventListener("click", async (event) => {
    stop(event);
    if (!minter) return;
    const yes = await confirmCard(doc, {
      titleId: "mint-nft-stop-title",
      titleText: "Stop minting?",
      body: "You can resume later.",
      acceptText: "Stop",
      closeText: "Keep minting",
      returnTo: stopBtn,
    });
    if (yes && minter) {
      minter.stop();
      progressStatus.textContent = "Stopping after this transaction…";
    }
  });

  resumeBtn.addEventListener("click", async (event) => {
    stop(event);
    if (!minter || acting) return;
    acting = true;
    try {
      const status = await walletStep();
      if (status !== "ok") {
        if (status !== "cancel") toast.error("Connect wallet first");
        return;
      }
      const made = minter;
      go(() => made.resume());
    } finally {
      acting = false;
    }
  });

  closeBtn.addEventListener("click", (event) => {
    stop(event);
    letGo();
    refreshJobs();
    focusNode(mode === "mint" ? startBtn : createBtn);
  });

  recheckBtn.addEventListener("click", async (event) => {
    stop(event);
    if (!minter || acting) return;
    acting = true;
    recheckBtn.disabled = true;
    remintBtn.disabled = true;
    progressStatus.textContent = "Checking Hedera…";
    try {
      await minter.recheck();
    } catch {
      paintStatus({ status: lastStatus, reason: lastReason });
    } finally {
      acting = false;
      recheckBtn.disabled = false;
      remintBtn.disabled = false;
    }
  });

  // The only way a maybe-sent batch goes out again: this tap, then a second
  // card that says it may mint twice.
  remintBtn.addEventListener("click", async (event) => {
    stop(event);
    if (!minter || acting) return;
    acting = true;
    try {
      const yes = await confirmCard(doc, {
        titleId: "mint-nft-remint-title",
        titleText: "Mint that batch again?",
        body: "If your wallet did send it, these NFTs will be minted twice: the same links under new serial numbers.",
        acceptText: "Mint again",
        returnTo: remintBtn,
      });
      if (!yes || !minter) return;
      const status = await walletStep();
      if (status !== "ok") {
        if (status !== "cancel") toast.error("Connect wallet first");
        return;
      }
      const made = minter;
      go(() => made.forceRemintUnconfirmed());
    } finally {
      acting = false;
    }
  });

  // ── Saved runs ───────────────────────────────────────────────────────
  async function refreshJobs() {
    if (minter) {
      banner.hidden = true;
      return null;
    }
    const account = textOf(await getAccount());
    if (minter) return null;
    let jobs = [];
    if (ACCOUNT_ID.test(account)) {
      try {
        jobs = listJobs(account, storage).filter((job) => job && job.status !== "done");
      } catch {
        jobs = [];
      }
    }
    jobs.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    savedJob = jobs[0] || null;
    banner.hidden = !savedJob;
    if (!savedJob) return null;
    const counts = jobCounts(savedJob);
    bannerText.textContent = `Unfinished mint: ${count(counts.minted)} / ${count(counts.total)} into ${savedJob.tokenId}`;
    bannerCheck.hidden = savedJob.status !== "unconfirmed";
    return savedJob;
  }

  // The saved run, back on the progress card. Nothing sends until Resume.
  function adopt(job) {
    const made = createMinter({ tokenId: job.tokenId, links: [], accountId: job.accountId, storage });
    banner.hidden = true;
    follow(made, job.tokenId);
    focusRun();
    return made;
  }

  bannerResume.addEventListener("click", async (event) => {
    stop(event);
    if (!savedJob || minter || acting) return;
    acting = true;
    try {
      const job = savedJob;
      const status = await walletStep();
      if (status !== "ok") {
        if (status !== "cancel") toast.error("Connect wallet first");
        return;
      }
      const account = textOf(await getAccount());
      if (account !== job.accountId) {
        toast.error(`Connect the wallet that started this mint (${job.accountId})`);
        return;
      }
      const made = adopt(job);
      if (made.state().status !== "unconfirmed") go(() => made.resume());
    } finally {
      acting = false;
    }
  });

  bannerCheck.addEventListener("click", async (event) => {
    stop(event);
    if (!savedJob || minter || acting) return;
    acting = true;
    try {
      const made = adopt(savedJob);
      progressStatus.textContent = "Checking Hedera…";
      await made.recheck();
    } catch {
      if (minter) paintStatus({ status: lastStatus, reason: lastReason });
    } finally {
      acting = false;
    }
  });

  bannerDiscard.addEventListener("click", async (event) => {
    stop(event);
    if (!savedJob || minter || acting) return;
    const job = savedJob;
    const yes = await confirmCard(doc, {
      titleId: "mint-nft-discard-title",
      titleText: "Discard this mint?",
      body: `The saved progress for ${job.tokenId} is deleted from this device. NFTs already minted stay in the collection.`,
      acceptText: "Discard",
      closeText: "Keep",
      returnTo: bannerDiscard,
    });
    if (!yes) return;
    dropJob(job.accountId, job.tokenId, storage);
    await refreshJobs();
  });

  // ── When the tab opens, and when the wallet changes ──────────────────
  let shown = !panel.hidden;
  const checkShown = () => {
    const now = !panel.hidden;
    if (now && !shown) refreshJobs();
    shown = now;
  };
  for (const key of ["token", "nft", "hashinal"]) {
    const tab = doc.getElementById(`mint-tab-${key}`);
    if (!tab) continue;
    // After mintpanel.js's own handler has shown or hidden the panel.
    tab.addEventListener("click", () => Promise.resolve().then(checkShown));
    tab.addEventListener("keydown", () => Promise.resolve().then(checkShown));
  }
  if (typeof doc.addEventListener === "function") {
    doc.addEventListener("wallet-account-changed", (event) => {
      const account = textOf(event && event.detail && event.detail.account);
      collections = null;
      madeHere.length = 0;
      fillSelect();
      if (mode === "mint" && !minter) {
        if (ACCOUNT_ID.test(account)) loadCollections();
        else setListStatus("connect");
      }
      // mintNfts signs the connected wallet and does not check the job account.
      // Pause here; Resume stays a tap, so a switch back does not continue.
      if (minter) {
        const started = minter.state().accountId;
        if (minter.state().running && account !== started) {
          minter.pause();
          pauseBtn.disabled = true;
          progressStatus.textContent = "Pausing after this transaction…";
          toast.error(`Connect the wallet that started this mint (${started})`);
        }
      }
      refreshJobs();
    });
  }

  setMode("new", { load: false });
  setAdmin(true);
  setRoyalty(false);
  fillSelect();
  addRow("");
  paintImport();
  recompute();

  return {
    els: {
      panel, banner, bannerText, bannerResume, bannerCheck, bannerDiscard,
      modes, modeNew, modeMint, createForm, mintForm, createBtn, createError, adminSwitch, adminWarning,
      royaltySwitch, royaltyWrap, createInputs, select, listStatus, retryBtn, tokenInput: tokenField.input, supplyLine,
      linkList, addBtn, importBtn, fileInput, summary, summaryName, summaryCounts, problems, problemList, removeFileBtn,
      totalsLine, startBtn, startHint, mintError,
      progress, progressTitle, bar, fill, progressCount, progressTx, progressStatus, persistLine,
      unconfirmed, recheckBtn, remintBtn, pauseBtn, resumeBtn, stopBtn, closeBtn,
    },
    rows,
    setMode,
    runCreate,
    runMint,
    loadCollections,
    chooseCollection,
    readSupplyFor,
    importFile,
    addRow,
    removeRow,
    refreshJobs,
    plan,
    current: () => minter,
  };
}

// The page: wire the real tab (index.html is parsed before modules run).
if (globalThis.document && typeof globalThis.document.getElementById === "function"
  && globalThis.document.getElementById("mint-panel-nft")) {
  bindMintNft();
}
