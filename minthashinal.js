// The Mint panel's Hashinal tab (#mint-panel-hashinal, index.html): one
// file inscribed on Hedera (HCS-1), its details inscribed after it, then one
// NFT minted into a collection of yours whose metadata points at those
// details. Mainnet only. The connected wallet signs and pays; nothing goes
// to the profile.
//
// hashinaljob.js runs it and keeps the only checkpoint: topic ids, counts
// and the form, never a key and never the file. This file draws the tab
// and calls the runner (start, resume, check, forceRemint, dismiss); it
// never mints by itself.
//
// index.html keeps "Coming next." in the panel for a page without scripts.
// bindMintHashinal replaces the panel's content and keeps the element, its
// id, role and aria. The cards and the wallet step are mintpanel.js's.
//
// The key: "Keep it in this tab" lets the inscriber hold its own key in
// memory. "Use my own key" takes a key the person generates here or pastes,
// so a closed tab can be finished later by typing it again. A key lives in
// a field or in memory only: never in storage, the URL, a data- attribute,
// aria text, a toast or the console. Its fields are emptied when the run is
// done, on Dismiss and on Remove key.
//
// Nothing sends without a tap: Start (after its card), Resume, Try again,
// and "Mint again anyway" (after a second card) are the only ways in.

import { INSCRIBE_ACCEPT } from "./inscriberow.js";
import { hashinalUrl } from "./hashinalurl.js";
import { HCS1_INSCRIBE_MAX_BYTES } from "./hcs1inscribe.js";
import { inscribeCostText } from "./hcs1inscribenotice.js";
import { buildHashinalMetadata, estimateHashinalMint, prepareHashinal } from "./hashinalmint.js";
import {
  createHashinalRunner,
  generateOwnKey,
  loadHashinalJob,
  parseSubmitKey,
  preflightCollection,
} from "./hashinaljob.js";
import { listMyCollections } from "./tokenmint.js";
import { POST_IMAGE_EDGE, POST_STILL_TYPES } from "./postimages.js";
import { toast as appToast } from "./toast.js";
import { appEnsureWallet, confirmCard, idResultCard, isQuietWalletError, mintWalletStep } from "./mintpanel.js";

// Above this many wallet approvals the tab says to turn on auto-approve;
// above the heavy one it also says a smaller file is cheaper.
export const HASHINAL_APPROVAL_WARN = 50;
export const HASHINAL_APPROVAL_HEAVY = 500;
export const HASHINAL_TRAIT_LIMIT = 50;
export const HASHINAL_DESCRIPTION_MAX = 1000;

export const HASHINAL_OVER_CAP_TEXT = "This file is over 2 MB, the limit for a Hashinal.";
export const HASHINAL_MEMORY_NOTE = "The key for the inscription stays in this tab. If the tab closes while the file or details are being written, that part cannot be finished and its fee is lost.";
export const HASHINAL_OWN_KEY_WARNING = "Keep this key private until your Hashinal is minted. It lets you finish after a closed tab. The app never stores it. Anyone with the key can add junk to the inscription and break the file, so delete it once you are done.";
export const HASHINAL_KEEP_OPEN_TEXT = "Keep this tab open until the file and details are written.";
export const HASHINAL_LOST_TEXT = "That inscription was cut off and its key is gone. The fee for the cut-off part cannot be recovered.";
export const HASHINAL_PERMANENT_TEXT = "The inscriptions have no admin key and cannot be edited or deleted.";
export const HASHINAL_KEY_BAD_TEXT = "That is not a private key we can read";
export const HASHINAL_REFILE_NOTE = "If it was a picture, pick the prepared copy you saved, if you have one.";
export const HASHINAL_UNCONFIRMED_TEXT = "Your wallet may have sent the mint, but Hedera hasn't confirmed it yet. Check again before you mint again.";
export const HASHINAL_START_FAIL_TEXT = "Hashinal mint failed. Nothing was charged if your wallet did not approve.";
export const HASHINAL_ACTION_FAIL_TEXT = "That did not work. Try again in a moment.";
export const HASHINAL_KEY_FILE_NAME = "hashinal-key.txt";

const ACCOUNT_ID = /^\d+\.\d+\.\d+$/;
// Anything that looks like key material never reaches the screen.
const KEY_LIKE = /[0-9a-fA-F]{40,}/;
const DETAIL_FIELD_OF = [
  ["Name", "name"],
  ["Description", "description"],
  ["Creator", "creator"],
  ["Trait", "traits"],
  ["Use 50 traits", "traits"],
  ["This file has no type", "file"],
];
const STEP_ORDER = ["file", "meta", "mint"];

function textOf(value) {
  return value == null ? "" : String(value);
}

const count = (n) => (Number(n) || 0).toLocaleString("en-US");
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

function groupDigits(value) {
  const text = textOf(value);
  return /^\d+$/.test(text) ? text.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : text;
}

function utf8Size(text) {
  return new TextEncoder().encode(textOf(text)).length;
}

// A line that could hold key material is not shown.
function safeLine(text, fallback = HASHINAL_ACTION_FAIL_TEXT) {
  const line = textOf(text);
  return line && !KEY_LIKE.test(line) ? line : fallback;
}

// ── Pure parts (the test reads these) ──────────────────────────────────

// hcs1inscribenotice.js's sizes: 1 MB is 1024 KB.
export function hashinalSizeText(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} ${plural(value, "byte", "bytes")}`;
  const kb = value / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const tenths = Math.round((kb / 1024) * 10) / 10;
  return `${tenths.toFixed(1).replace(/\.0$/, "")} MB`;
}

// The first and the last four characters: "302a…9f3c".
export function shortKey(publicKey) {
  const text = textOf(publicKey).trim();
  if (text.length <= 8) return text;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

// estimate: what estimateHashinalMint resolves.
export function hashinalTotals(estimate) {
  const file = Number(estimate && estimate.file && estimate.file.txCount) || 0;
  const meta = Number(estimate && estimate.meta && estimate.meta.txCount) || 0;
  const mint = Number(estimate && estimate.mint && estimate.mint.txCount) || 1;
  const approvals = Number(estimate && estimate.total && estimate.total.approvals) || file + meta + mint;
  const cost = inscribeCostText(estimate && estimate.total ? estimate.total.usd : Number.NaN);
  const split = `file ${count(file)} + details ${count(meta)} + 1 mint`;
  return {
    approvals,
    file,
    meta,
    cost,
    text: `${count(approvals)} wallet ${plural(approvals, "approval", "approvals")}, ${cost}: ${split}`,
    split: `${count(approvals)}: ${split}`,
  };
}

// The warning lines for that many approvals: none, the HashPack tip, or
// the tip and the heavy line.
export function approvalWarnings(approvals) {
  const n = Number(approvals) || 0;
  const lines = [];
  if (n > HASHINAL_APPROVAL_WARN) {
    lines.push(`This takes ${count(n)} wallet approvals. Turn on auto-approve in HashPack first, or you will confirm every one.`);
  }
  if (n > HASHINAL_APPROVAL_HEAVY) lines.push("That is a lot. A smaller file is much cheaper and faster.");
  return lines;
}

// The progress card's status line.
export function hashinalStatusText(status, reason, approvals = {}) {
  const total = Math.max(1, Number(approvals.total) || 0);
  const next = Math.min((Number(approvals.done) || 0) + 1, total);
  switch (status) {
    case "running":
      return `Waiting for your wallet: approval ${count(next)} of ${count(total)}`;
    case "paused":
      return reason ? `Paused: ${reason}` : "Paused";
    case "interrupted":
      return reason ? `Stopped: ${reason}` : "Stopped before it finished.";
    case "unconfirmed":
      return "Waiting for Hedera to confirm the mint.";
    case "lost":
      return `${reason || "That inscription was cut off"}. The fee for the cut-off part cannot be recovered.`;
    case "done":
      return "Done";
    default:
      return reason || "Ready";
  }
}

// One of the three step rows.
export function hashinalStepText(step, done, total) {
  if (step === "mint") return "Minting your NFT";
  const what = step === "meta" ? "Inscribing the details" : "Inscribing the file";
  return total > 0 ? `${what}, ${count(Math.min(done, total))} of ${count(total)}` : what;
}

function tagDetails(err) {
  if (err && typeof err === "object" && !err.field) {
    const message = textOf(err.message);
    const hit = DETAIL_FIELD_OF.find(([prefix]) => message.startsWith(prefix));
    if (hit) err.field = hit[1];
  }
  return err;
}

// ── The cards ──────────────────────────────────────────────────────────

// plan: { collection, fileName, fileSize, name, totals, keyMode,
// publicKey }. true when Start is tapped.
export function confirmHashinal(doc, plan, returnTo) {
  const totals = plan.totals;
  const rows = [
    ["Collection", plan.collection],
    ["File", `${plan.fileName}, ${plan.fileSize}`],
    ["Name", plan.name],
    ["Approvals", totals.split],
    ["Estimated fee", `${totals.cost} in HBAR, paid by your wallet`],
    ["Key", plan.keyMode === "own" ? `Your own key (public key ${shortKey(plan.publicKey)})` : "Kept in this tab"],
    ["Permanent", HASHINAL_PERMANENT_TEXT, true],
  ];
  const tip = approvalWarnings(totals.approvals)[0];
  if (tip) rows.push(["Auto-approve", tip, true]);
  if (plan.keyMode === "own") rows.push(["Your key", "Keep your key private until you are done, then delete it.", true]);
  return confirmCard(doc, {
    titleId: "mint-hashinal-confirm-title",
    titleText: "Before you inscribe and mint",
    rows,
    acceptText: "Start",
    returnTo,
  });
}

// "Hashinal minted": the token id and serial with Copy, the NFT, the file,
// the details and the transaction, and Done.
export function showHashinalMinted(doc, result, options = {}) {
  const tokenId = textOf(result && result.tokenId);
  const serial = textOf(result && result.serial);
  const big = `${tokenId} #${serial}`;
  const links = [
    [`https://hashscan.io/mainnet/token/${tokenId}/${serial}`, "View NFT on HashScan"],
    [hashinalUrl(result && result.fileTopicId), "View the file"],
    [hashinalUrl(result && result.metaTopicId), "View the details"],
  ];
  if (result && result.hashscanUrl) links.push([result.hashscanUrl, "View transaction"]);
  return idResultCard(doc, {
    titleId: "mint-hashinal-result-title",
    titleText: "Hashinal minted",
    big,
    copyValue: big,
    copyLabel: "Copy token id and serial",
    copyFail: "Could not copy the token id and serial",
    links,
    ...options,
  });
}

// ── The tab ────────────────────────────────────────────────────────────

// mintnft.js's appAccount (not exported there).
async function appAccount() {
  try {
    const web3 = await import("./web3.js");
    return typeof web3.connectedAccount === "string" ? web3.connectedAccount.trim() : "";
  } catch {
    return "";
  }
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

function fileKind(file, prepared) {
  const type = textOf((prepared && prepared.mime) || (file && file.type)).toLowerCase();
  const name = textOf((file && file.name) || (prepared && prepared.name)).toLowerCase();
  if (type.startsWith("image/")) return { kind: "image", label: "Picture" };
  if (type.startsWith("video/")) return { kind: "video", label: "Video" };
  if (type.startsWith("model/") || /\.(glb|gltf)$/.test(name)) return { kind: "model", label: "3D model" };
  return { kind: "file", label: "File" };
}

// Wires #mint-panel-hashinal. Returns the tab's handles for a test, or null.
export function bindMintHashinal({
  doc = globalThis.document,
  ensureWallet = appEnsureWallet,
  getAccount = appAccount,
  createRunner = createHashinalRunner,
  prepare = prepareHashinal,
  estimate = estimateHashinalMint,
  loadJob = loadHashinalJob,
  listCollections = listMyCollections,
  preflight = preflightCollection,
  parseKey = parseSubmitKey,
  generateKey = generateOwnKey,
  storage,
  toast = appToast,
  clipboard,
  urls = globalThis.URL,
  win = (doc && doc.defaultView) || globalThis.window,
  estimateDelay = 300,
} = {}) {
  if (!doc || typeof doc.getElementById !== "function" || !doc.body) return null;
  const panel = doc.getElementById("mint-panel-hashinal");
  if (!panel) return null;

  // ── Building blocks (mintnft.js's) ───────────────────────────────────
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
  const label = (id, text) => {
    const el = make("label", "mint-label", text);
    el.htmlFor = id;
    return el;
  };
  const field = (id, text, placeholder, extra = {}) => {
    const input = make("input", "toolbar-column");
    input.type = "text";
    input.id = id;
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    if (extra.inputMode) input.inputMode = extra.inputMode;
    return { name: label(id, text), input };
  };
  // A key field: password type, no name (no browser offer to save it), and
  // inside [data-no-clear], so fieldclear.js's undo never keeps a copy.
  const keyField = (id, text) => {
    const input = make("input", "toolbar-column mint-key-input");
    input.type = "password";
    input.id = id;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    const wrap = make("div", "mint-max");
    wrap.setAttribute("data-no-clear", "");
    wrap.append(label(id, text), input);
    return { wrap, input };
  };
  const toggle = (id, text, on) => {
    const el = button(on ? "feed-settings-switch is-on mint-switch" : "feed-settings-switch mint-switch");
    el.id = id;
    el.setAttribute("role", "switch");
    el.setAttribute("aria-checked", on ? "true" : "false");
    const ui = make("span", "feed-settings-switch-ui");
    ui.setAttribute("aria-hidden", "true");
    el.append(make("span", "", text), ui);
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
  const hiddenPicker = () => {
    const input = make("input");
    input.type = "file";
    input.accept = INSCRIBE_ACCEPT;
    input.hidden = true;
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    // Every click that reaches the document runs CloseALL (cssLogic.js),
    // which would close the Toolbar under the picker (inscriberow.js).
    input.addEventListener("click", stop);
    doc.body.appendChild(input);
    return input;
  };

  // ── The panel's content (the element, its id, role and aria stay) ───
  panel.textContent = "";
  panel.classList.remove("mint-card", "mint-soon");
  panel.classList.add("mint-form", "mint-hashinal");

  // 0) The unfinished run.
  const banner = make("div", "mint-card mint-resume");
  banner.hidden = true;
  banner.setAttribute("role", "status");
  const bannerText = note("mint-resume-text", "");
  const bannerStatus = note("mint-note mint-resume-status", "", true);
  bannerStatus.setAttribute("aria-live", "polite");
  const bannerKey = keyField("mint-hashinal-banner-key", "Your private key");
  bannerKey.wrap.hidden = true;
  const bannerFileWrap = make("div", "mint-max");
  bannerFileWrap.hidden = true;
  const bannerChoose = button("mint-ghost", "Choose file");
  const bannerFileName = note("mint-note", "", true);
  bannerFileWrap.append(bannerChoose, bannerFileName, note("mint-note", HASHINAL_REFILE_NOTE));
  const bannerPicker = hiddenPicker();
  const bannerResume = button("mint-ghost", "Resume");
  const bannerRetry = button("mint-ghost", "Try again");
  const bannerCheck = button("mint-ghost", "Check again");
  const bannerRemint = button("mint-ghost mint-danger", "Mint again anyway");
  const bannerDismiss = button("mint-ghost mint-danger", "Dismiss");
  banner.append(bannerText, bannerStatus, bannerKey.wrap, bannerFileWrap,
    row("mint-actions", bannerResume, bannerRetry, bannerCheck, bannerRemint, bannerDismiss));

  // 6) The run.
  const progress = make("div", "mint-card mint-progress");
  progress.hidden = true;
  const progressTitle = note("mint-progress-title", "");
  const steps = make("ol", "mint-steps");
  const stepRows = {};
  for (const step of STEP_ORDER) {
    stepRows[step] = make("li", "mint-step is-wait", hashinalStepText(step, 0, 0));
    steps.appendChild(stepRows[step]);
  }
  const bar = make("div", "mint-progress-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Inscribing and minting progress");
  bar.setAttribute("aria-valuemin", "0");
  const fill = make("div", "mint-progress-fill");
  bar.appendChild(fill);
  const progressStatus = note("mint-progress-status", "");
  progressStatus.setAttribute("aria-live", "polite");
  const keepOpen = note("mint-warning", HASHINAL_KEEP_OPEN_TEXT, true);
  const runKey = keyField("mint-hashinal-run-key", "Your private key");
  runKey.wrap.hidden = true;
  const unconfirmed = make("div", "mint-unconfirmed");
  unconfirmed.hidden = true;
  const recheckBtn = button("mint-ghost", "Check again");
  const remintBtn = button("mint-ghost mint-danger", "Mint again anyway");
  unconfirmed.append(note("mint-warning", HASHINAL_UNCONFIRMED_TEXT), row("mint-actions", recheckBtn, remintBtn));
  const resumeBtn = button("mint-ghost", "Resume");
  const closeBtn = button("mint-ghost", "Close");
  progress.append(progressTitle, steps, bar, progressStatus, keepOpen, runKey.wrap, unconfirmed,
    row("mint-actions", resumeBtn, closeBtn));

  const form = make("form", "mint-form");
  form.id = "mint-hashinal-form";
  form.setAttribute("novalidate", "");

  // 1) The collection.
  const select = make("select", "mint-select");
  select.id = "mint-hashinal-collection";
  const listStatus = note("mint-note", "", true);
  listStatus.setAttribute("aria-live", "polite");
  const retryBtn = button("mint-ghost", "Retry");
  retryBtn.hidden = true;
  const tokenField = field("mint-hashinal-token", "or paste a token id", "0.0.123", { inputMode: "decimal" });
  const supplyLine = note("mint-note mint-supply-line", "", true);
  supplyLine.setAttribute("aria-live", "polite");
  const flightWarning = note("mint-warning", "", true);
  flightWarning.setAttribute("aria-live", "polite");
  const newCollectionBtn = button("mint-ghost", "New collection");

  // 2) The file.
  const chooseBtn = button("mint-ghost", "Choose file");
  const picker = hiddenPicker();
  const fileStatus = note("mint-note", "", true);
  fileStatus.setAttribute("aria-live", "polite");
  const fileBox = make("div", "mint-import");
  fileBox.hidden = true;
  const tileSlot = make("div", "mint-file-slot");
  const fileName = note("mint-import-name", "");
  const fileMeta = note("mint-note", "");
  const overCapLine = note("mint-warning", HASHINAL_OVER_CAP_TEXT, true);
  const removeFileBtn = button("mint-ghost", "Remove file");
  const savePreparedBtn = button("mint-ghost", "Save prepared file");
  savePreparedBtn.hidden = true;
  fileBox.append(tileSlot, fileName, fileMeta, overCapLine, row("mint-actions", removeFileBtn, savePreparedBtn));
  const fileError = note("mint-error", "", true);
  fileError.setAttribute("role", "alert");

  // 3) The details.
  const nameField = field("mint-hashinal-name", "Name", "My Hashinal");
  const description = make("textarea", "toolbar-column");
  description.id = "mint-hashinal-description";
  description.placeholder = "What it is";
  description.rows = 3;
  description.spellcheck = true;
  const descriptionCount = note("mint-note mint-bytes", `0 / ${count(HASHINAL_DESCRIPTION_MAX)} bytes`);
  descriptionCount.setAttribute("aria-live", "polite");
  const creatorField = field("mint-hashinal-creator", "Creator (optional)", "Your name");
  const traitList = make("div", "mint-links mint-traits");
  const addTraitBtn = button("mint-ghost", "+ Add trait");
  const traitNote = note("mint-note", `Up to ${HASHINAL_TRAIT_LIMIT} traits`, true);
  const detailsError = note("mint-error", "", true);
  detailsError.setAttribute("role", "alert");

  // 4) The key.
  const keyModes = make("div", "feed-settings-radios mint-supply mint-hashinal-keymode");
  keyModes.setAttribute("role", "radiogroup");
  keyModes.setAttribute("aria-labelledby", "mint-hashinal-key-label");
  const keyLabel = make("span", "mint-label", "Key for the inscription");
  keyLabel.id = "mint-hashinal-key-label";
  const keyMemory = button("feed-settings-choice is-on", "Keep it in this tab");
  keyMemory.id = "mint-hashinal-key-memory";
  const keyOwn = button("feed-settings-choice", "Use my own key");
  keyOwn.id = "mint-hashinal-key-own";
  for (const choice of [keyMemory, keyOwn]) choice.setAttribute("role", "radio");
  keyModes.append(keyMemory, keyOwn);
  const memoryNote = note("mint-note", HASHINAL_MEMORY_NOTE);
  const ownPanel = make("div", "mint-max mint-hashinal-own");
  ownPanel.hidden = true;
  const generateBtn = button("mint-ghost", "Generate a new key");
  const generated = make("div", "mint-max");
  generated.hidden = true;
  const publicArea = make("textarea", "toolbar-column mint-key");
  publicArea.id = "mint-hashinal-public";
  publicArea.readOnly = true;
  publicArea.rows = 2;
  publicArea.spellcheck = false;
  const privateArea = make("textarea", "toolbar-column mint-key");
  privateArea.id = "mint-hashinal-private";
  privateArea.readOnly = true;
  privateArea.rows = 2;
  privateArea.spellcheck = false;
  const copyKeyBtn = button("mint-ghost", "Copy private key");
  const downloadKeyBtn = button("mint-ghost", "Download key file");
  const savedSwitch = toggle("mint-hashinal-saved", "I saved this key", false);
  generated.append(label(publicArea.id, "Public Key"), publicArea, label(privateArea.id, "Private Key"), privateArea,
    row("mint-actions", copyKeyBtn, downloadKeyBtn), savedSwitch);
  const paste = keyField("mint-hashinal-key-paste", "or paste a key you already have");
  const pasteError = note("mint-error", "", true);
  pasteError.id = "mint-hashinal-key-error";
  const pastePublic = make("div", "mint-key");
  pastePublic.hidden = true;
  pastePublic.setAttribute("aria-live", "polite");
  const removeKeyBtn = button("mint-ghost mint-danger", "Remove key");
  removeKeyBtn.hidden = true;
  ownPanel.append(generateBtn, generated, paste.wrap, pasteError, pastePublic, removeKeyBtn,
    note("mint-warning", HASHINAL_OWN_KEY_WARNING));

  // 5) The cost and Start.
  const totalsLine = note("mint-totals", "");
  totalsLine.setAttribute("aria-live", "polite");
  const approvalsLine = note("mint-warning", "", true);
  const heavyLine = note("mint-warning", "", true);
  const startBtn = button("toolbar-column-btns mint-submit", "Inscribe and mint");
  startBtn.id = "mint-hashinal-start";
  startBtn.setAttribute("aria-describedby", "mint-hashinal-start-hint");
  const startHint = note("mint-note mint-hint", "");
  startHint.id = "mint-hashinal-start-hint";
  const startError = note("mint-error", "", true);
  startError.setAttribute("role", "alert");

  form.append(
    row("mint-card", label(select.id, "Collection"), select, row("mint-status-row", listStatus, retryBtn),
      tokenField.name, tokenField.input, supplyLine, flightWarning, row("mint-actions", newCollectionBtn)),
    row("mint-card", make("span", "mint-label", "File"), fileBox, fileStatus, fileError, row("mint-actions", chooseBtn)),
    row("mint-card", nameField.name, nameField.input, label(description.id, "Description (optional)"), description,
      descriptionCount, creatorField.name, creatorField.input, make("span", "mint-label", "Traits (optional)"),
      traitList, row("mint-actions", addTraitBtn), traitNote, detailsError),
    row("mint-card", keyLabel, keyModes, memoryNote, ownPanel),
    row("mint-card", totalsLine, approvalsLine, heavyLine, startBtn, startHint, startError),
  );

  panel.append(banner, progress, form);

  // ── State ────────────────────────────────────────────────────────────
  let collections = null;
  let loadSeq = 0;
  let flight = null;
  let flightSeq = 0;
  let flightTimer = 0;
  let picked = null;
  let preparing = false;
  let pickSeq = 0;
  let quote = null;
  let quoteSeq = 0;
  let quoteTimer = 0;
  const traits = [];
  let traitSeq = 0;
  let keyMode = "memory";
  let savedOn = false;
  let pastedPublic = "";
  let pasteSeen = false;
  let nameTouched = false;
  let generating = false;
  let copiedTimer = 0;
  let runner = null;
  let runnerAccount = "";
  let offs = [];
  let following = false;
  let runToken = "";
  let starting = false;
  let inflight = 0;
  let unloadOn = false;
  let plan = null;
  let counts = { file: { done: 0, total: 0 }, meta: { done: 0, total: 0 } };
  let lastStep = "";
  let bannerJob = null;
  let bannerError = "";
  let bannerPending = "";
  let refile = null;

  const walletStep = () => mintWalletStep(doc, ensureWallet);
  const busy = () => starting || inflight > 0;

  function paintForms() {
    form.hidden = following;
    progress.hidden = !following;
    if (following) banner.hidden = true;
  }

  // ── 1) The collection (mintnft.js's) ─────────────────────────────────
  const collectionLabel = (c) => `${c.name || "Unnamed"} (${c.symbol || "?"}) · ${c.tokenId} · ${groupDigits(c.totalSupply)}/${groupDigits(c.maxSupply)}`;

  function fillSelect() {
    const keep = textOf(select.value);
    select.textContent = "";
    const list = Array.isArray(collections) ? collections : [];
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
    const account = textOf(await getAccount());
    refreshBanner();
    let list;
    try {
      if (!ACCOUNT_ID.test(account)) throw new Error("Connect wallet first");
      list = await listCollections(account);
    } catch {
      if (seq === loadSeq) setListStatus("fail");
      return "fail";
    }
    if (seq !== loadSeq) return "stale";
    collections = Array.isArray(list) ? list : [];
    fillSelect();
    setListStatus(collections.length ? "" : "empty");
    if (chosenId()) checkCollection(chosenId());
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
    const found = (Array.isArray(collections) ? collections : []).find((c) => c.tokenId === tokenId);
    return found ? `${found.name || "Unnamed"} (${found.symbol || "?"}) · ${tokenId}` : tokenId;
  }

  function paintFlight() {
    let text = "";
    let warn = "";
    if (flight && flight.loading) text = "Reading the collection…";
    else if (flight && flight.ok) text = flight.remaining != null ? `${groupDigits(flight.remaining)} left` : "No supply limit";
    else if (flight) warn = flight.reason;
    supplyLine.textContent = text;
    supplyLine.hidden = !text;
    flightWarning.textContent = warn;
    flightWarning.hidden = !warn;
  }

  // preflight: { ok, reason, remaining } for this token and account.
  async function checkCollection(tokenId) {
    const seq = ++flightSeq;
    if (!tokenId) {
      flight = null;
      paintFlight();
      recompute();
      return null;
    }
    flight = { tokenId, loading: true };
    paintFlight();
    recompute();
    const account = textOf(await getAccount());
    if (seq !== flightSeq) return flight;
    let next;
    if (!ACCOUNT_ID.test(account)) {
      next = null;
    } else {
      try {
        const read = await preflight(tokenId, account);
        const ok = !!(read && read.ok === true);
        next = {
          tokenId,
          account,
          ok,
          reason: ok ? "" : safeLine(read && read.reason, "Could not read the collection"),
          remaining: ok && read.remaining != null ? String(read.remaining) : null,
        };
      } catch {
        next = { tokenId, account, ok: false, reason: "Could not read the collection", remaining: null };
      }
    }
    if (seq !== flightSeq) return flight;
    flight = next;
    paintFlight();
    recompute();
    return flight;
  }

  function onCollectionChange() {
    clearTimeout(flightTimer);
    const pasted = textOf(tokenField.input.value).trim();
    if (pasted && !ACCOUNT_ID.test(pasted)) {
      flightSeq += 1;
      flight = null;
      paintFlight();
      recompute();
      return;
    }
    checkCollection(chosenId());
  }
  select.addEventListener("change", () => onCollectionChange());
  tokenField.input.addEventListener("input", () => {
    clearTimeout(flightTimer);
    const pasted = textOf(tokenField.input.value).trim();
    if (!pasted || ACCOUNT_ID.test(pasted)) {
      flightSeq += 1;
      flight = chosenId() ? { tokenId: chosenId(), loading: true } : null;
      paintFlight();
      flightTimer = setTimeout(onCollectionChange, 350);
    }
    recompute();
  });
  tokenField.input.addEventListener("change", () => onCollectionChange());

  // The NFT tab's own create form; no form is built here.
  newCollectionBtn.addEventListener("click", (event) => {
    stop(event);
    const tab = doc.getElementById("mint-tab-nft");
    if (tab && typeof tab.click === "function") tab.click();
    const mode = doc.getElementById("mint-nft-mode-new");
    if (mode && typeof mode.click === "function") mode.click();
  });

  // ── 2) The file ──────────────────────────────────────────────────────
  function preparedBytes() {
    const bytes = picked && picked.prepared && picked.prepared.bytes;
    return bytes && Number.isFinite(bytes.byteLength) ? bytes.byteLength : 0;
  }

  function isOverCap() {
    return !!(picked && (picked.prepared.overCap === true || preparedBytes() > HCS1_INSCRIBE_MAX_BYTES));
  }

  function paintFileMeta() {
    if (!picked) return;
    fileName.textContent = textOf(picked.prepared.name || picked.file.name) || "Untitled";
    fileMeta.textContent = `${hashinalSizeText(preparedBytes())}${picked.resized ? `, resized to ${POST_IMAGE_EDGE} px` : ""}`;
    overCapLine.hidden = !isOverCap();
    savePreparedBtn.hidden = !(keyMode === "own" && picked.reencoded && !isOverCap());
  }

  function forgetUrl() {
    if (picked && picked.url && urls && typeof urls.revokeObjectURL === "function") {
      try { urls.revokeObjectURL(picked.url); } catch { /* already gone */ }
    }
    if (picked) picked.url = "";
  }

  function clearFile() {
    pickSeq += 1;
    clearTimeout(quoteTimer);
    quoteSeq += 1;
    quote = null;
    forgetUrl();
    picked = null;
    preparing = false;
    tileSlot.textContent = "";
    fileBox.hidden = true;
    fileStatus.hidden = true;
    fileError.hidden = true;
    savePreparedBtn.hidden = true;
  }

  function drawTile() {
    tileSlot.textContent = "";
    const { kind, label: kindLabel } = fileKind(picked.file, picked.prepared);
    const mime = textOf(picked.prepared.mime || picked.file.type);
    if (kind === "image" && urls && typeof urls.createObjectURL === "function") {
      const img = make("img", "mint-file-tile");
      try {
        picked.url = urls.createObjectURL(picked.file);
      } catch {
        picked.url = "";
      }
      if (picked.url) {
        const mine = picked;
        img.alt = `Preview of ${textOf(picked.file.name) || "the picture"}`;
        // The Inscribe card's rule: a still picture over the edge is resized.
        img.addEventListener("load", () => {
          if (picked !== mine) return;
          const type = textOf(mine.file.type).toLowerCase();
          const longest = Math.max(Number(img.naturalWidth) || 0, Number(img.naturalHeight) || 0);
          if (POST_STILL_TYPES.includes(type) && longest > POST_IMAGE_EDGE) {
            mine.resized = true;
            paintFileMeta();
          }
        });
        img.src = picked.url;
        tileSlot.appendChild(img);
        return;
      }
    }
    tileSlot.appendChild(make("div", "mint-file-tile is-text", mime ? `${kindLabel} · ${mime}` : kindLabel));
  }

  // One prepare per pick: the runner gets these same bytes.
  async function pickFile(file) {
    if (!file) return "none";
    clearFile();
    const seq = pickSeq;
    preparing = true;
    fileStatus.textContent = "Reading the file…";
    fileStatus.hidden = false;
    recompute();
    let prepared;
    try {
      prepared = await prepare(file);
    } catch {
      if (seq !== pickSeq) return "stale";
      preparing = false;
      fileStatus.hidden = true;
      fileError.textContent = "Could not read that file";
      fileError.hidden = false;
      recompute();
      return "unreadable";
    }
    if (seq !== pickSeq) return "stale";
    preparing = false;
    fileStatus.hidden = true;
    const type = textOf(file.type).toLowerCase();
    const size = prepared && prepared.bytes ? prepared.bytes.byteLength : 0;
    picked = {
      file,
      prepared,
      url: "",
      resized: prepared && prepared.resized === true,
      // A re-encoded picture is not the file as picked: resuming a cut-off
      // inscription needs these exact bytes.
      reencoded: POST_STILL_TYPES.includes(type) && (textOf(prepared && prepared.mime) !== type || size !== file.size),
    };
    fileBox.hidden = false;
    drawTile();
    paintFileMeta();
    onDetailsChange();
    return isOverCap() ? "over" : "picked";
  }

  // The picker opens inside the same tap: a picker opened after an await
  // is blocked.
  chooseBtn.addEventListener("click", (event) => {
    stop(event);
    if (preparing) return;
    picker.click();
  });
  picker.addEventListener("change", () => {
    const file = picker.files && picker.files[0];
    picker.value = "";
    if (file) pickFile(file);
  });
  removeFileBtn.addEventListener("click", (event) => {
    stop(event);
    clearFile();
    onDetailsChange();
    focusNode(chooseBtn);
  });

  function saveBlob(blob, name) {
    if (!urls || typeof urls.createObjectURL !== "function") return false;
    let url = "";
    try {
      url = urls.createObjectURL(blob);
    } catch {
      return false;
    }
    const a = make("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    doc.body.appendChild(a);
    try {
      a.click();
    } finally {
      a.remove();
      // Let the download read it first.
      const timer = setTimeout(() => {
        try { urls.revokeObjectURL(url); } catch { /* already gone */ }
      }, 1000);
      if (timer && typeof timer.unref === "function") timer.unref();
    }
    return true;
  }

  savePreparedBtn.addEventListener("click", (event) => {
    stop(event);
    if (!picked || typeof Blob !== "function") return;
    const name = textOf(picked.prepared.name || picked.file.name) || "file";
    const blob = new Blob([picked.prepared.bytes], { type: textOf(picked.prepared.mime) });
    if (!saveBlob(blob, `hashinal-prepared-${name}`)) toast.error("Could not save the file");
  });

  // ── 3) The details ───────────────────────────────────────────────────
  function attributes() {
    return traits.map((entry) => ({ trait_type: textOf(entry.name.value), value: textOf(entry.value.value) }));
  }

  function detailValues() {
    return {
      name: textOf(nameField.input.value),
      description: textOf(description.value),
      creator: textOf(creatorField.input.value),
      attributes: attributes(),
    };
  }

  // hashinalmint.js's own checks and words, before any file is inscribed.
  function detailsProblem() {
    try {
      buildHashinalMetadata({
        ...detailValues(),
        mime: picked ? textOf(picked.prepared.mime) : "image/png",
        fileTopicId: "0.0.1",
      });
      return null;
    } catch (err) {
      return tagDetails(err);
    }
  }

  function paintDetails(problem = detailsProblem(), forced = false) {
    const bytes = utf8Size(textOf(description.value).trim());
    descriptionCount.textContent = `${count(bytes)} / ${count(HASHINAL_DESCRIPTION_MAX)} bytes`;
    descriptionCount.className = bytes > HASHINAL_DESCRIPTION_MAX ? "mint-error mint-bytes" : "mint-note mint-bytes";
    const field = problem && problem.field;
    // An empty name waits until the field is left (or Start); a long one
    // shows at once.
    const quiet = field === "name" && !textOf(nameField.input.value).trim() && !nameTouched && !forced;
    const message = problem && !quiet && field !== "file" ? textOf(problem.message) : "";
    detailsError.textContent = message;
    detailsError.hidden = !message;
    const marks = [
      [nameField.input, field === "name" && !quiet],
      [description, field === "description"],
      [creatorField.input, field === "creator"],
    ];
    const longTrait = field === "traits"
      ? traits.find((entry) => utf8Size(textOf(entry.name.value).trim()) > 100)
      : null;
    for (const entry of traits) marks.push([entry.name, entry === longTrait]);
    for (const [input, bad] of marks) {
      if (bad) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
    if (field === "file") {
      fileError.textContent = textOf(problem.message);
      fileError.hidden = false;
    } else if (fileError.textContent !== "Could not read that file") {
      fileError.hidden = true;
    }
    return problem;
  }

  function onDetailsChange() {
    paintDetails();
    scheduleQuote();
    recompute();
  }

  nameField.input.addEventListener("input", onDetailsChange);
  nameField.input.addEventListener("blur", () => {
    nameTouched = true;
    paintDetails();
  });
  description.addEventListener("input", onDetailsChange);
  creatorField.input.addEventListener("input", onDetailsChange);

  function renumberTraits() {
    traits.forEach((entry, index) => {
      entry.name.setAttribute("aria-label", `Trait ${index + 1} name`);
      entry.value.setAttribute("aria-label", `Trait ${index + 1} value`);
      entry.remove.setAttribute("aria-label", `Remove trait ${index + 1}`);
    });
    const full = traits.length >= HASHINAL_TRAIT_LIMIT;
    addTraitBtn.disabled = full;
    traitNote.hidden = !full;
  }

  function traitInput(className, placeholder) {
    const input = make("input", `toolbar-column ${className}`);
    input.type = "text";
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    return input;
  }

  function addTrait(name = "", value = "", focus = false) {
    if (traits.length >= HASHINAL_TRAIT_LIMIT) return null;
    const entry = { id: ++traitSeq };
    entry.name = traitInput("mint-trait-name", "Trait");
    entry.name.id = `mint-hashinal-trait-${entry.id}-name`;
    entry.name.value = name;
    entry.value = traitInput("mint-trait-value", "Value");
    entry.value.id = `mint-hashinal-trait-${entry.id}-value`;
    entry.value.value = value;
    entry.remove = button("mint-link-remove", "×");
    entry.wrap = row("mint-trait-row", entry.name, entry.value, entry.remove);
    // The row's own × is its clear: no fieldclear.js × inside the fields.
    entry.wrap.setAttribute("data-no-clear", "");
    for (const input of [entry.name, entry.value]) input.addEventListener("input", onDetailsChange);
    // Enter goes to the value, then to the next trait, not to the form.
    entry.name.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      focusNode(entry.value);
    });
    entry.value.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      const at = traits.indexOf(entry);
      if (at < traits.length - 1) focusNode(traits[at + 1].name);
      else if (!addTrait("", "", true)) focusNode(addTraitBtn);
    });
    entry.remove.addEventListener("click", (event) => {
      stop(event);
      removeTrait(entry);
    });
    traits.push(entry);
    traitList.appendChild(entry.wrap);
    renumberTraits();
    onDetailsChange();
    if (focus) focusNode(entry.name);
    return entry;
  }

  function removeTrait(entry) {
    const at = traits.indexOf(entry);
    if (at < 0) return;
    traits.splice(at, 1);
    entry.wrap.remove();
    renumberTraits();
    onDetailsChange();
    const next = traits[Math.min(at, traits.length - 1)];
    focusNode(next ? next.name : addTraitBtn);
  }

  addTraitBtn.addEventListener("click", (event) => {
    stop(event);
    addTrait("", "", true);
  });

  // ── 4) The key ───────────────────────────────────────────────────────
  // "pasted" while the paste field has text, "generated" while a made key
  // is shown, or "".
  function keySource() {
    if (textOf(paste.input.value).trim()) return "pasted";
    if (textOf(privateArea.value)) return "generated";
    return "";
  }

  function ownKeyText() {
    return keySource() === "pasted" ? textOf(paste.input.value).trim() : textOf(privateArea.value);
  }

  // Only the public key is kept; the parsed key is dropped here.
  function readPasted() {
    const text = textOf(paste.input.value).trim();
    if (!text) return "";
    try {
      return textOf(parseKey(text).publicKey);
    } catch {
      return null;
    }
  }

  function paintPaste(show) {
    const source = keySource();
    pastedPublic = source === "pasted" ? readPasted() : "";
    if (show) pasteSeen = source === "pasted";
    const bad = pasteSeen && pastedPublic === null;
    pasteError.textContent = bad ? HASHINAL_KEY_BAD_TEXT : "";
    pasteError.hidden = !bad;
    if (bad) {
      paste.input.setAttribute("aria-invalid", "true");
      paste.input.setAttribute("aria-describedby", pasteError.id);
    } else {
      paste.input.removeAttribute("aria-invalid");
      paste.input.removeAttribute("aria-describedby");
    }
    const good = pasteSeen && typeof pastedPublic === "string" && pastedPublic;
    pastePublic.textContent = good ? `Public key ${pastedPublic}` : "";
    pastePublic.hidden = !good;
  }

  function paintKey() {
    for (const [choice, on] of [[keyMemory, keyMode === "memory"], [keyOwn, keyMode === "own"]]) {
      choice.classList.toggle("is-on", on);
      choice.setAttribute("aria-checked", on ? "true" : "false");
      choice.tabIndex = on ? 0 : -1;
    }
    memoryNote.hidden = keyMode !== "memory";
    ownPanel.hidden = keyMode !== "own";
    generated.hidden = !textOf(privateArea.value);
    removeKeyBtn.hidden = !(textOf(privateArea.value) || textOf(paste.input.value));
    paintFileMeta();
  }

  function setSaved(on) {
    savedOn = !!on;
    setSwitch(savedSwitch, savedOn);
  }

  function setKeyMode(next) {
    keyMode = next === "own" ? "own" : "memory";
    paintKey();
    recompute();
  }
  for (const [choice, value] of [[keyMemory, "memory"], [keyOwn, "own"]]) {
    choice.addEventListener("click", (event) => {
      stop(event);
      setKeyMode(value);
    });
    choice.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      setKeyMode(value === "memory" ? "own" : "memory");
      focusNode(value === "memory" ? keyOwn : keyMemory);
    });
  }

  // Every key field and the switch, emptied: done, Dismiss, Remove key.
  function clearKeys() {
    privateArea.value = "";
    publicArea.value = "";
    paste.input.value = "";
    bannerKey.input.value = "";
    runKey.input.value = "";
    pastedPublic = "";
    pasteSeen = false;
    clearTimeout(copiedTimer);
    copyKeyBtn.textContent = "Copy private key";
    copyKeyBtn.classList.remove("is-copied");
    setSaved(false);
    paintPaste(false);
    paintKey();
  }

  generateBtn.addEventListener("click", async (event) => {
    stop(event);
    if (generating) return;
    generating = true;
    generateBtn.disabled = true;
    try {
      const made = await generateKey();
      paste.input.value = "";
      pasteSeen = false;
      publicArea.value = textOf(made && made.publicKey);
      privateArea.value = textOf(made && made.privateKey);
      setSaved(false);
    } catch {
      toast.error("Could not make a key");
    } finally {
      generating = false;
      generateBtn.disabled = false;
      paintPaste(false);
      paintKey();
      recompute();
    }
    focusNode(copyKeyBtn);
  });

  copyKeyBtn.addEventListener("click", async (event) => {
    stop(event);
    const board = clipboard || (globalThis.navigator && globalThis.navigator.clipboard);
    try {
      if (!board || typeof board.writeText !== "function" || !privateArea.value) throw new Error("no clipboard");
      await board.writeText(privateArea.value);
      copyKeyBtn.textContent = "Copied";
      copyKeyBtn.classList.add("is-copied");
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copyKeyBtn.textContent = "Copy private key";
        copyKeyBtn.classList.remove("is-copied");
      }, 2000);
    } catch {
      toast.error("Could not copy the key");
    }
  });

  // New: Toolbar > Create > Create keys has no download.
  downloadKeyBtn.addEventListener("click", (event) => {
    stop(event);
    if (!privateArea.value || typeof Blob !== "function") return;
    const blob = new Blob([`Public Key: ${publicArea.value}\nPrivate Key: ${privateArea.value}\n`], { type: "text/plain" });
    if (!saveBlob(blob, HASHINAL_KEY_FILE_NAME)) toast.error("Could not save the key file");
  });

  savedSwitch.addEventListener("click", (event) => {
    stop(event);
    setSaved(!savedOn);
    recompute();
  });

  paste.input.addEventListener("input", () => {
    pasteSeen = false;
    paintPaste(false);
    paintKey();
    recompute();
  });
  paste.input.addEventListener("blur", () => {
    paintPaste(true);
    recompute();
  });

  removeKeyBtn.addEventListener("click", (event) => {
    stop(event);
    clearKeys();
    recompute();
    focusNode(generateBtn);
  });

  // ── 5) The cost and Start ────────────────────────────────────────────
  function paintTotals() {
    let text = "";
    let lines = [];
    if (!picked) text = preparing ? "" : "Choose a file to see the cost.";
    else if (isOverCap()) text = "";
    else if (quote && quote.result) {
      const totals = hashinalTotals(quote.result);
      text = totals.text;
      lines = approvalWarnings(totals.approvals);
    } else if (quote && quote.error) {
      text = "Could not work out the cost.";
    } else if (detailsProblem()) {
      text = textOf(nameField.input.value).trim() ? "" : "Add a name to see the cost.";
    } else {
      text = "Working out the cost…";
    }
    totalsLine.textContent = text;
    totalsLine.hidden = !text;
    approvalsLine.textContent = "";
    if (lines[0]) approvalsLine.appendChild(make("strong", "", lines[0]));
    approvalsLine.hidden = !lines[0];
    heavyLine.textContent = lines[1] || "";
    heavyLine.hidden = !lines[1];
  }

  // Debounced; a result for older fields is dropped.
  function scheduleQuote() {
    clearTimeout(quoteTimer);
    const seq = ++quoteSeq;
    quote = null;
    if (!picked || isOverCap() || detailsProblem()) {
      paintTotals();
      return;
    }
    paintTotals();
    quoteTimer = setTimeout(async () => {
      const prepared = picked && picked.prepared;
      let next;
      try {
        next = { result: await estimate({ prepared, ...detailValues() }) };
      } catch (err) {
        next = { error: err };
      }
      if (seq !== quoteSeq) return;
      quote = next;
      paintTotals();
      recompute();
    }, estimateDelay);
  }

  // The first missing thing, in the order the form reads.
  function startProblem() {
    const tokenId = chosenId();
    if (!tokenId) return textOf(tokenField.input.value).trim() ? "Enter a token id like 0.0.123" : "Choose a collection";
    if (preparing) return "Reading the file…";
    if (!picked) return "Choose a file";
    if (isOverCap()) return HASHINAL_OVER_CAP_TEXT;
    const details = detailsProblem();
    if (details) {
      if (details.field === "name" && !textOf(nameField.input.value).trim()) return "Add a name";
      return textOf(details.message);
    }
    if (keyMode === "own") {
      const source = keySource();
      if (!source) return "Generate a key, or paste one";
      if (source === "pasted" && readPasted() === null) return HASHINAL_KEY_BAD_TEXT;
      if (source === "generated" && !savedOn) return "Turn on “I saved this key”";
    }
    if (!flight || flight.tokenId !== tokenId) return "Connect your wallet to check the collection";
    if (flight.loading) return "Reading the collection…";
    if (!flight.ok) return flight.reason;
    return "";
  }

  function paintBusy() {
    const off = busy();
    for (const node of [bannerResume, bannerRetry, bannerCheck, bannerRemint, bannerDismiss, bannerChoose,
      resumeBtn, recheckBtn, remintBtn]) node.disabled = off;
  }

  function recompute() {
    const hint = startProblem();
    startHint.textContent = hint;
    startHint.hidden = !hint;
    startBtn.disabled = !!hint || busy() || following;
    paintBusy();
    return hint;
  }

  function showStartError(message) {
    startError.textContent = message || "";
    startError.hidden = !message;
  }

  // Tell the person; never an error's raw text unless it is the app's own.
  function reportError(err, fallback) {
    if (isQuietWalletError(err)) return "";
    const message = err && err.userFacing ? safeLine(err.message, fallback) : fallback;
    toast.error(message);
    return message;
  }

  async function runStart() {
    if (busy() || following) return "busy";
    paintDetails(detailsProblem(), true);
    paintPaste(true);
    if (recompute()) return "blocked";
    starting = true;
    recompute();
    showStartError("");
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
      const run = runnerFor(account);
      let saved = null;
      try {
        saved = loadJob(account, storage);
      } catch {
        saved = null;
      }
      if (saved && saved.status !== "done") {
        await refreshBanner();
        toast.info("Finish or dismiss the unfinished Hashinal first");
        return "saved";
      }
      const tokenId = chosenId();
      const checked = flight && flight.tokenId === tokenId && flight.account === account && !flight.loading
        ? flight
        : await checkCollection(tokenId);
      if (!checked || !checked.ok) return "invalid";
      const values = detailValues();
      const file = picked;
      let priced;
      try {
        priced = await estimate({ prepared: file.prepared, ...values });
      } catch (err) {
        tagDetails(err);
        if (err && err.field) paintDetails(err, true);
        showStartError(err && err.userFacing ? safeLine(err.message, "Could not work out the cost") : "Could not work out the cost");
        return "invalid";
      }
      let parsed = null;
      if (keyMode === "own") {
        try {
          parsed = parseKey(ownKeyText());
        } catch {
          pasteSeen = true;
          paintPaste(true);
          showStartError(HASHINAL_KEY_BAD_TEXT);
          return "invalid";
        }
      }
      const totals = hashinalTotals(priced);
      const yes = await confirmHashinal(doc, {
        collection: chosenLabel(tokenId),
        fileName: textOf(file.prepared.name || file.file.name) || "Untitled",
        fileSize: hashinalSizeText(preparedBytes()),
        name: textOf(values.name).trim(),
        totals,
        keyMode,
        publicKey: parsed ? textOf(parsed.publicKey) : "",
      }, startBtn);
      if (!yes) {
        parsed = null;
        return "declined";
      }
      const input = {
        tokenId,
        prepared: file.prepared,
        name: values.name,
        description: values.description,
        creator: values.creator,
        attributes: values.attributes,
        keyMode,
      };
      if (keyMode === "own") input.submitKey = parsed.key;
      parsed = null;
      plan = totals;
      follow(run, tokenId);
      go(() => run.start(input), HASHINAL_START_FAIL_TEXT);
      return "started";
    } finally {
      starting = false;
      recompute();
    }
  }
  startBtn.addEventListener("click", (event) => {
    stop(event);
    runStart();
  });
  form.addEventListener("submit", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    stop(event);
  });

  // ── The runner ───────────────────────────────────────────────────────
  function dropRunner() {
    for (const off of offs) if (typeof off === "function") off();
    offs = [];
    runner = null;
    runnerAccount = "";
    syncUnload();
  }

  // One runner per account, made after the wallet step.
  function runnerFor(account) {
    if (runner && (runnerAccount === account || following)) return runner;
    dropRunner();
    const made = createRunner({ accountId: account, storage });
    runner = made;
    runnerAccount = account;
    offs = [
      made.on("status", (payload) => onStatus(made, payload)),
      made.on("progress", (payload) => onProgress(made, payload)),
      made.on("topic", (payload) => onTopic(made, payload)),
      made.on("done", (payload) => finishRun(made, payload)),
      made.on("warning", (payload) => {
        if (made === runner) toast.info(safeLine(payload && payload.message, "Could not save mint progress in this browser"));
      }),
    ];
    return made;
  }

  function holds() {
    try {
      return !!(runner && runner.holdsKey());
    } catch {
      return false;
    }
  }

  function onBeforeUnload(event) {
    if (!event) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    event.returnValue = "";
  }

  // The leave-page prompt, only while the runner holds a key it needs.
  function syncUnload() {
    const want = holds();
    if (!win || typeof win.addEventListener !== "function") return;
    if (want && !unloadOn) {
      win.addEventListener("beforeunload", onBeforeUnload);
      unloadOn = true;
    } else if (!want && unloadOn) {
      win.removeEventListener("beforeunload", onBeforeUnload);
      unloadOn = false;
    }
  }

  function snap() {
    try {
      return runner ? runner.snapshot() : null;
    } catch {
      return null;
    }
  }

  function follow(made, tokenId) {
    following = true;
    runToken = tokenId || runToken;
    progressTitle.textContent = `Inscribing and minting into ${runToken}`;
    const now = made.snapshot();
    const topics = (now && now.topics) || {};
    counts = {
      file: { done: 0, total: plan ? plan.file : (topics.file ? topics.file.total + 1 : 0) },
      meta: { done: 0, total: plan ? plan.meta : (topics.meta ? topics.meta.total + 1 : 0) },
    };
    lastStep = (now && now.step) || "";
    paintForms();
    paintRun();
    focusRun();
  }

  function letGo() {
    following = false;
    plan = null;
    runToken = "";
    lastStep = "";
    runKey.input.value = "";
    paintForms();
    recompute();
  }

  function focusRun() {
    const first = [resumeBtn, recheckBtn, closeBtn].find((node) => !node.hidden
      && !(node === recheckBtn && unconfirmed.hidden));
    focusNode(first);
  }

  function onStatus(made, payload) {
    if (made !== runner) return;
    const status = textOf(payload && payload.status);
    if (status === "running" && !following) follow(made, bannerJob ? bannerJob.tokenId : runToken);
    if (following) paintRun();
    else refreshBanner();
    syncUnload();
  }

  function onTopic(made, payload) {
    if (made !== runner || !following) return;
    const step = payload && payload.step === "meta" ? "meta" : "file";
    const total = Number(payload && payload.total) || 0;
    counts[step] = { done: 1, total: total + 1 };
    if (step === "meta") counts.file.done = counts.file.total;
    lastStep = step;
    paintRun();
    syncUnload();
  }

  function onProgress(made, payload) {
    if (made !== runner || !following) return;
    const step = textOf(payload && payload.step);
    const sent = Number(payload && payload.sent) || 0;
    const total = Number(payload && payload.total) || 0;
    if (step === "file" || step === "meta") {
      counts[step] = { done: sent + 1, total: Math.max(counts[step].total, total + 1) };
    }
    if (step === "meta" || step === "mint") counts.file.done = counts.file.total;
    if (step === "mint") counts.meta.done = counts.meta.total;
    if (step) lastStep = step;
    paintRun();
    syncUnload();
  }

  // The runner's counts; a run picked up from the banner has none until its
  // next event, so the step counts stand in.
  function approvalsOf(now, at) {
    const p = (now && now.progress) || {};
    const known = counts.file.total > 0 && counts.meta.total > 0 ? counts.file.total + counts.meta.total + 1 : 0;
    const total = Math.max(Number(p.approvalsTotal) || 0, plan ? plan.approvals : 0, known);
    const stepped = (at > 0 ? counts.file.total : counts.file.done)
      + (at > 1 ? counts.meta.total : at === 1 ? counts.meta.done : 0)
      + (at > 2 ? 1 : 0);
    const done = Math.min(Math.max(Number(p.approvalsDone) || 0, stepped), total);
    return { done, total };
  }

  function paintRun() {
    if (!following) return;
    const now = snap() || { status: "idle", reason: "", progress: {}, needs: null, keyMode: "" };
    // From the tap until the runner's first event, the run is going.
    const status = now.status === "idle" && inflight > 0 ? "running" : now.status;
    const reason = safeLine(now.reason, "");
    const at = status === "done" ? STEP_ORDER.length : Math.max(0, STEP_ORDER.indexOf(lastStep || now.step || "file"));
    const approvals = approvalsOf(now, at);
    if (status === "done") approvals.done = approvals.total;
    STEP_ORDER.forEach((step, index) => {
      const state = index < at ? "is-done" : index === at ? "is-now" : "is-wait";
      const el = stepRows[step];
      el.className = `mint-step ${state}`;
      if (state === "is-now") el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
      const part = counts[step];
      el.textContent = part ? hashinalStepText(step, state === "is-done" ? part.total : part.done, part.total) : hashinalStepText(step);
    });
    const percent = approvals.total > 0 ? Math.min(100, (approvals.done / approvals.total) * 100) : 0;
    fill.style.width = `${percent}%`;
    bar.setAttribute("aria-valuemax", String(approvals.total));
    bar.setAttribute("aria-valuenow", String(approvals.done));
    bar.setAttribute("aria-valuetext", `${count(approvals.done)} of ${count(approvals.total)} wallet approvals`);
    progressStatus.textContent = hashinalStatusText(status, reason, approvals);
    keepOpen.hidden = !holds();
    unconfirmed.hidden = status !== "unconfirmed";
    resumeBtn.hidden = !(status === "paused" || status === "interrupted");
    runKey.wrap.hidden = !(now.keyMode === "own" && now.needs === "key" && !resumeBtn.hidden);
    closeBtn.hidden = !["done", "paused", "lost", "interrupted"].includes(status);
    paintBusy();
  }

  // Each runner call; its events paint the card or the banner. A throw
  // shows the app's own words, or a short line.
  function go(task, fallback) {
    inflight += 1;
    paintBusy();
    if (following) paintRun();
    let pending;
    try {
      pending = Promise.resolve(task());
    } catch (err) {
      pending = Promise.reject(err);
    }
    return pending.then(
      (result) => result,
      (err) => {
        const message = reportError(tagDetails(err), fallback);
        if (err && err.field) paintDetails(err, true);
        const now = snap();
        if (following && (!now || now.status === "idle")) {
          letGo();
          if (message) showStartError(message);
        } else if (following) {
          if (message) progressStatus.textContent = message;
        } else if (message) {
          bannerError = message;
        }
        return null;
      },
    ).finally(() => {
      inflight -= 1;
      runKey.input.value = "";
      bannerKey.input.value = "";
      // A call that settled with no run left: back to the form.
      const left = snap();
      if (following && inflight === 0 && (!left || left.status === "idle")) letGo();
      if (following) paintRun();
      else refreshBanner();
      recompute();
      syncUnload();
    });
  }

  async function finishRun(made, result) {
    if (made !== runner) return;
    letGo();
    clearKeys();
    clearFile();
    nameField.input.value = "";
    description.value = "";
    creatorField.input.value = "";
    for (const entry of traits.slice()) {
      traits.splice(traits.indexOf(entry), 1);
      entry.wrap.remove();
    }
    renumberTraits();
    nameTouched = false;
    onDetailsChange();
    syncUnload();
    banner.hidden = true;
    checkCollection(chosenId());
    await showHashinalMinted(doc, result || {}, { returnTo: startBtn, clipboard, toast });
    refreshBanner();
  }

  // ── Progress card buttons ────────────────────────────────────────────
  async function sendStep(task) {
    const status = await walletStep();
    if (status !== "ok") {
      if (status !== "cancel") toast.error("Connect wallet first");
      return false;
    }
    go(task, HASHINAL_ACTION_FAIL_TEXT);
    return true;
  }

  resumeBtn.addEventListener("click", async (event) => {
    stop(event);
    if (!runner || busy()) return;
    const made = runner;
    const input = {};
    if (!runKey.wrap.hidden && textOf(runKey.input.value).trim()) input.submitKey = runKey.input.value;
    inflight += 1;
    paintBusy();
    try {
      await sendStep(() => made.resume(input));
    } finally {
      inflight -= 1;
      paintBusy();
    }
  });

  async function recheck(made, line) {
    if (!made || busy()) return;
    line.textContent = "Checking Hedera…";
    line.hidden = false;
    go(() => made.check(), HASHINAL_ACTION_FAIL_TEXT);
  }
  recheckBtn.addEventListener("click", (event) => {
    stop(event);
    recheck(runner, progressStatus);
  });

  // The only way a maybe-sent mint goes out again: this tap, then a second
  // card that says it may mint a second NFT.
  async function remint(made, returnTo) {
    if (!made || busy()) return;
    inflight += 1;
    paintBusy();
    try {
      const yes = await confirmCard(doc, {
        titleId: "mint-hashinal-remint-title",
        titleText: "Mint again?",
        body: "Your NFT may already exist. If your wallet did send the first mint, this mints a second one.",
        acceptText: "Mint again",
        returnTo,
      });
      if (!yes || made !== runner) return;
      await sendStep(() => made.forceRemint());
    } finally {
      inflight -= 1;
      paintBusy();
    }
  }
  remintBtn.addEventListener("click", (event) => {
    stop(event);
    remint(runner, remintBtn);
  });

  closeBtn.addEventListener("click", (event) => {
    stop(event);
    letGo();
    refreshBanner();
    focusNode(startBtn);
  });

  // ── 0) The banner ────────────────────────────────────────────────────
  function bannerNeeds(job, now) {
    if (now && now.needs) return now.needs;
    if (!job || job.status !== "interrupted") return null;
    if (job.keyMode === "own") return "key";
    if (!(job.topics && job.topics.file)) return "file";
    return null;
  }

  function paintBanner() {
    const job = bannerJob;
    banner.hidden = !job || following;
    for (const node of [bannerKey.wrap, bannerFileWrap, bannerResume, bannerRetry, bannerCheck, bannerRemint]) node.hidden = true;
    bannerDismiss.hidden = false;
    if (!job) return;
    let text;
    if (job.status === "lost") {
      text = HASHINAL_LOST_TEXT;
    } else if (job.status === "unconfirmed") {
      text = `Unfinished Hashinal: ${HASHINAL_UNCONFIRMED_TEXT}`;
      bannerCheck.hidden = false;
      bannerRemint.hidden = false;
    } else if (job.status === "paused" && job.step === "mint") {
      text = "Unfinished Hashinal: the mint did not go through.";
      bannerRetry.hidden = false;
    } else if (job.needs === "key") {
      const part = job.step === "meta" || (job.topics && job.topics.meta) ? "the details were" : "the file was";
      text = `Unfinished Hashinal: ${part} cut off. Paste your key to finish it.`;
      bannerKey.wrap.hidden = false;
      bannerResume.hidden = false;
    } else if (job.needs === "file") {
      text = "Unfinished Hashinal: pick the same file again.";
      bannerFileWrap.hidden = false;
      bannerFileName.textContent = refile ? `Picked: ${textOf(refile.name) || "a file"}` : "";
      bannerFileName.hidden = !refile;
      bannerResume.hidden = false;
    } else {
      text = `Unfinished Hashinal into ${job.tokenId || "your collection"}.`;
      bannerResume.hidden = false;
    }
    bannerText.textContent = text;
    // The last call's own words first, then the runner's reason.
    const reason = safeLine(job.reason, "");
    const line = bannerError || bannerPending || (reason && !text.includes(reason) ? reason : "");
    bannerStatus.textContent = line;
    bannerStatus.hidden = !line;
    paintBusy();
  }

  // The saved run for this account, if any (after the wallet step).
  async function refreshBanner() {
    if (following) {
      banner.hidden = true;
      return null;
    }
    const account = textOf(await getAccount());
    if (following) return null;
    let job = null;
    if (ACCOUNT_ID.test(account)) {
      try {
        job = loadJob(account, storage);
      } catch {
        job = null;
      }
    }
    // This tab's runner knows what storage cannot: what it needs next.
    const now = job && ACCOUNT_ID.test(account) ? runnerFor(account).snapshot() : null;
    const status = now && now.status !== "idle" ? now.status : (job ? job.status : "idle");
    if (!job || status === "idle" || status === "done") {
      bannerJob = null;
      bannerError = "";
      refile = null;
      paintBanner();
      return null;
    }
    bannerJob = {
      accountId: account,
      tokenId: job.tokenId,
      keyMode: job.keyMode,
      status,
      step: (now && now.step) || job.step,
      reason: (now && now.reason) || job.reason,
      topics: job.topics,
      needs: bannerNeeds({ ...job, status }, now),
    };
    paintBanner();
    return bannerJob;
  }

  // Wallet first, the same account, then the runner call.
  async function bannerCall(task, { wallet = true, pending = "" } = {}) {
    if (!bannerJob || following || busy()) return "busy";
    const job = bannerJob;
    inflight += 1;
    bannerError = "";
    bannerPending = pending;
    paintBanner();
    try {
      if (wallet) {
        const status = await walletStep();
        if (status !== "ok") {
          if (status !== "cancel") toast.error("Connect wallet first");
          return "wallet";
        }
      }
      const account = textOf(await getAccount());
      if (account !== job.accountId) {
        toast.error(`Connect the wallet that started this Hashinal (${job.accountId})`);
        return "account";
      }
      const made = runnerFor(account);
      await go(() => {
        bannerPending = "";
        return task(made);
      }, HASHINAL_ACTION_FAIL_TEXT);
      return "sent";
    } finally {
      inflight -= 1;
      bannerPending = "";
      if (!following) paintBanner();
      recompute();
    }
  }

  bannerResume.addEventListener("click", (event) => {
    stop(event);
    const input = {};
    if (!bannerKey.wrap.hidden && textOf(bannerKey.input.value).trim()) input.submitKey = bannerKey.input.value;
    if (!bannerFileWrap.hidden && refile) input.file = refile;
    bannerCall((made) => made.resume(input));
  });
  bannerRetry.addEventListener("click", (event) => {
    stop(event);
    bannerCall((made) => made.resume({}));
  });
  bannerCheck.addEventListener("click", (event) => {
    stop(event);
    bannerCall((made) => made.check(), { wallet: false, pending: "Checking Hedera…" });
  });
  bannerRemint.addEventListener("click", async (event) => {
    stop(event);
    if (!bannerJob || busy()) return;
    const yes = await confirmCard(doc, {
      titleId: "mint-hashinal-remint-title",
      titleText: "Mint again?",
      body: "Your NFT may already exist. If your wallet did send the first mint, this mints a second one.",
      acceptText: "Mint again",
      returnTo: bannerRemint,
    });
    if (yes) bannerCall((made) => made.forceRemint());
  });
  bannerDismiss.addEventListener("click", async (event) => {
    stop(event);
    if (!bannerJob || busy()) return;
    const job = bannerJob;
    const yes = await confirmCard(doc, {
      titleId: "mint-hashinal-dismiss-title",
      titleText: "Dismiss this unfinished Hashinal?",
      body: "Its saved progress is deleted from this device. What is already inscribed stays on Hedera.",
      acceptText: "Dismiss",
      closeText: "Keep",
      returnTo: bannerDismiss,
    });
    if (!yes || bannerJob !== job || busy()) return;
    const account = textOf(await getAccount());
    if (ACCOUNT_ID.test(account) && account === job.accountId) runnerFor(account).dismiss();
    clearKeys();
    refile = null;
    syncUnload();
    await refreshBanner();
    recompute();
  });

  bannerChoose.addEventListener("click", (event) => {
    stop(event);
    bannerPicker.click();
  });
  bannerPicker.addEventListener("change", () => {
    const file = bannerPicker.files && bannerPicker.files[0];
    bannerPicker.value = "";
    if (!file) return;
    refile = file;
    paintBanner();
    focusNode(bannerResume);
  });

  // ── When the tab opens, and when the wallet changes ──────────────────
  let shown = !panel.hidden;
  const checkShown = () => {
    const now = !panel.hidden;
    if (now && !shown) {
      if (collections == null) loadCollections();
      else refreshBanner();
    }
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
      fillSelect();
      flightSeq += 1;
      flight = null;
      paintFlight();
      if (!following && runner && runnerAccount !== account) dropRunner();
      if (!panel.hidden && !following) {
        if (ACCOUNT_ID.test(account)) loadCollections();
        else setListStatus("connect");
      }
      refreshBanner();
      recompute();
    });
  }

  fillSelect();
  setKeyMode("memory");
  setSaved(false);
  paintPaste(false);
  paintDetails();
  paintTotals();
  renumberTraits();
  recompute();

  return {
    els: {
      panel, banner, bannerText, bannerStatus, bannerKey: bannerKey.input, bannerKeyWrap: bannerKey.wrap,
      bannerFileWrap, bannerChoose, bannerPicker, bannerFileName, bannerResume, bannerRetry, bannerCheck,
      bannerRemint, bannerDismiss,
      progress, progressTitle, steps, stepRows, bar, fill, progressStatus, keepOpen, runKey: runKey.input,
      runKeyWrap: runKey.wrap, unconfirmed, recheckBtn, remintBtn, resumeBtn, closeBtn,
      form, select, listStatus, retryBtn, tokenInput: tokenField.input, supplyLine, flightWarning, newCollectionBtn,
      chooseBtn, picker, fileStatus, fileBox, tileSlot, fileName, fileMeta, overCapLine, removeFileBtn,
      savePreparedBtn, fileError,
      nameInput: nameField.input, description, descriptionCount, creatorInput: creatorField.input, traitList,
      addTraitBtn, traitNote, detailsError,
      keyModes, keyMemory, keyOwn, memoryNote, ownPanel, generateBtn, generated, publicArea, privateArea,
      copyKeyBtn, downloadKeyBtn, savedSwitch, pasteInput: paste.input, pasteWrap: paste.wrap, pasteError,
      pastePublic, removeKeyBtn,
      totalsLine, approvalsLine, heavyLine, startBtn, startHint, startError,
    },
    traits,
    addTrait,
    removeTrait,
    pickFile,
    loadCollections,
    checkCollection,
    refreshBanner,
    runStart,
    setKeyMode,
    current: () => runner,
    following: () => following,
  };
}

// The page: wire the real tab (index.html is parsed before modules run).
if (globalThis.document && typeof globalThis.document.getElementById === "function"
  && globalThis.document.getElementById("mint-panel-hashinal")) {
  bindMintHashinal();
}
