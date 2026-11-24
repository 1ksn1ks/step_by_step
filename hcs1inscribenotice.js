// The cards before a Hashinal (HCS-1) inscription, and the flow around
// them. The card is swapwarning.js's: the intro classes in onboarding.js
// (style.css), the same dialog, focus trap, dismissals and motion.
//
// Unlike the swap warning there is no saved acknowledgement: the size and
// the cost change with every file, so the card shows on every call.
//
// The map Toolbar's Inscribe row calls runInscribe (inscribebutton.js).

import { HCS1_INSCRIBE_MAX_BYTES } from "./hcs1inscribe.js";
import { inscribePrepared, prepareInscribeFile } from "./hcs1inscribewallet.js";
import { hashinalUrl } from "./hashinalurl.js";
import { POST_IMAGE_EDGE, POST_STILL_TYPES } from "./postimages.js";
import { toast } from "./toast.js";

const INSCRIBER_SOURCE = "https://github.com/1ksn1ks/step_by_step/blob/main/hcs1inscribe.js";
const FEES_NOTE = "You pay only Hedera network fees. Web3Globe charges nothing.";
const AUTO_APPROVE_TIP = "Turn on auto-approval in HashPack first, or you'll confirm every transaction.";

let pending = null;
let running = null;

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

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function byteCount(info) {
  if (Number.isFinite(info.size)) return info.size;
  const bytes = info.bytes;
  if (bytes && Number.isFinite(bytes.byteLength)) return bytes.byteLength;
  if (bytes && Number.isFinite(bytes.length)) return bytes.length;
  return 0;
}

// 1 MB is 1024 KB, so the 2 MB cap reads "2 MB". up rounds up, so a file
// just over the cap never reads as 2 MB.
function sizeText(bytes, up) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return plural(value, "byte", "bytes");
  const kb = value / 1024;
  if (kb < 1024) return `${up ? Math.ceil(kb) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  const tenths = (up ? Math.ceil(mb * 10) : Math.round(mb * 10)) / 10;
  return `${tenths.toFixed(1).replace(/\.0$/, "")} MB`;
}

function resizedNote(info) {
  return info.resized ? `, resized to ${POST_IMAGE_EDGE} px` : "";
}

function fileText(info, up) {
  const name = String(info.name || "").trim() || "Untitled";
  return `${name}, ${sizeText(byteCount(info), up)}${resizedNote(info)}`;
}

// $0.0108, $0.018, $1.77.
function usdText(usd) {
  const digits = usd < 1 ? 4 : 2;
  return "$" + usd.toFixed(digits).replace(/(\.\d\d\d*?)0+$/, "$1");
}

function hbarText(hbar) {
  const digits = hbar < 1 ? 4 : hbar < 100 ? 2 : 0;
  return hbar.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") + " HBAR";
}

// HBAR only when a USD price per HBAR is passed in. The app has none of its
// own yet, so this is USD only today.
export function inscribeCostText(usd, hbarUsd) {
  const amount = Number(usd);
  if (!Number.isFinite(amount) || amount < 0) return "Unknown";
  const rate = Number(hbarUsd);
  if (Number.isFinite(rate) && rate > 0) return `≈ ${hbarText(amount / rate)} (${usdText(amount)})`;
  return `≈ ${usdText(amount)}`;
}

export function inscribeTxText(txCount) {
  const total = Math.max(1, Math.floor(Number(txCount) || 0));
  const chunks = total - 1;
  return `1 topic + ${plural(chunks, "chunk", "chunks")} = ${plural(total, "transaction", "transactions")}; `
    + "each is its own transaction your wallet pays";
}

function paragraph(doc, text) {
  const para = doc.createElement("p");
  para.className = "onboard-body";
  para.textContent = text;
  return para;
}

function rowList(doc, rows) {
  const list = doc.createElement("div");
  list.className = "onboard-rows";
  for (const [label, value] of rows) {
    const row = doc.createElement("div");
    row.className = "onboard-row";
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

// Same open and close as the intro overlay. Reduced motion skips both.
// focusables is the Tab ring, in order. first takes focus on open.
function mountCard(doc, { titleId, titleText, parts, focusables, notNow, accept, first, returnTo }) {
  const back = canFocus(returnTo) ? returnTo : (canFocus(doc.activeElement) ? doc.activeElement : null);
  const overlay = doc.createElement("div");
  overlay.className = "onboard-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", titleId);

  const scrim = doc.createElement("div");
  scrim.className = "onboard-scrim";

  const card = doc.createElement("div");
  card.className = "onboard-card inscribe-notice";

  const title = doc.createElement("h3");
  title.className = "onboard-title";
  title.id = titleId;
  title.textContent = titleText;

  const nav = doc.createElement("div");
  nav.className = "onboard-nav";
  nav.append(...[notNow, accept].filter(Boolean));
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
    doc.removeEventListener("keydown", onKey, true);
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
      if (typeof event.stopPropagation === "function") event.stopPropagation();
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
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    focusNode(next);
  }

  const stop = (event) => {
    if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  };
  scrim.addEventListener("click", (event) => {
    stop(event);
    finish(false);
  });
  notNow.addEventListener("click", (event) => {
    stop(event);
    finish(false);
  });
  if (accept) {
    accept.addEventListener("click", (event) => {
      stop(event);
      finish(true);
    });
  }
  doc.addEventListener("keydown", onKey, true);

  doc.body.appendChild(overlay);
  if (!reducedMotion()) {
    play(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-out" });
    play(card, [
      { opacity: 0, transform: "translate(-50%, -50%) scale(0.9)" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
    ], { duration: 300, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  }
  focusNode(first);
  return promise;
}

function pageDocument() {
  const doc = globalThis.document;
  if (!doc || typeof doc.createElement !== "function" || !doc.body) return null;
  return doc;
}

// info: what prepareInscribeFile returned (name, mime, bytes or size,
// txCount, usd), plus resized, hbarUsd and returnTo when known.
// true when the person taps Inscribe. Shown on every call. A second call
// while a card is up is false and leaves that card alone: its answer is
// about another file.
export function confirmInscribe(info) {
  if (pending) return Promise.resolve(false);
  const doc = pageDocument();
  if (!doc) return Promise.resolve(false);
  const data = info && typeof info === "object" ? info : {};
  const notNow = navButton(doc, "onboard-prev", "Not now");
  const accept = navButton(doc, "onboard-next", "Inscribe");
  pending = mountCard(doc, {
    titleId: "inscribe-notice-title",
    titleText: "Before you inscribe",
    parts: [
      rowList(doc, [
        ["File", fileText(data, false)],
        ["Type", String(data.mime || "").trim() || "Unknown"],
        ["Transactions", inscribeTxText(data.txCount)],
        ["Estimated cost", inscribeCostText(data.usd, data.hbarUsd)],
      ]),
      paragraph(doc, FEES_NOTE),
      paragraph(doc, AUTO_APPROVE_TIP),
    ],
    focusables: [notNow, accept],
    notNow,
    accept,
    first: accept,
    returnTo: data.returnTo,
  });
  return pending;
}

// The file is over the cap after resizing. Resolves false when closed.
export function showInscribeOverCap(info) {
  if (pending) return Promise.resolve(false);
  const doc = pageDocument();
  if (!doc) return Promise.resolve(false);
  const data = info && typeof info === "object" ? info : {};
  const link = doc.createElement("a");
  link.href = INSCRIBER_SOURCE;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Inscribe the full file yourself";
  const linkLine = doc.createElement("p");
  linkLine.className = "onboard-body";
  linkLine.appendChild(link);
  const notNow = navButton(doc, "onboard-prev", "Not now");
  pending = mountCard(doc, {
    titleId: "inscribe-overcap-title",
    titleText: "File too big",
    parts: [
      rowList(doc, [
        ["File", fileText(data, true)],
        ["Limit", sizeText(HCS1_INSCRIBE_MAX_BYTES, false)],
      ]),
      linkLine,
    ],
    focusables: [link, notNow],
    notNow,
    accept: null,
    first: notNow,
    returnTo: data.returnTo,
  });
  return pending;
}

// Width and height come from the file's header once the <img> loads; it is
// never decoded or drawn. 0 when the browser cannot tell.
function longestSide(file) {
  const view = globalThis.window || globalThis;
  const Img = view.Image;
  const urls = view.URL || globalThis.URL;
  if (typeof Img !== "function" || !urls || typeof urls.createObjectURL !== "function") return Promise.resolve(0);
  return new Promise((resolve) => {
    let url = "";
    try {
      url = urls.createObjectURL(file);
    } catch {
      resolve(0);
      return;
    }
    const img = new Img();
    const end = (value) => {
      try { urls.revokeObjectURL(url); } catch { /* already gone */ }
      resolve(value);
    };
    img.onload = () => end(Math.max(img.naturalWidth || 0, img.naturalHeight || 0));
    img.onerror = () => end(0);
    img.src = url;
  });
}

// prepareInscribeFile shrinks still pictures to POST_IMAGE_EDGE. Only the
// card's wording reads this.
async function wasDownscaled(file) {
  const type = String((file && file.type) || "").toLowerCase();
  if (!POST_STILL_TYPES.includes(type)) return false;
  try {
    return (await longestSide(file)) > POST_IMAGE_EDGE;
  } catch {
    return false;
  }
}

function hcsLink(result) {
  const link = document.createElement("a");
  link.className = "swap-tx-link";
  link.href = hashinalUrl(result.topicId);
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = result.hrl;
  return link;
}

function sentCount(resume) {
  return resume && Array.isArray(resume.sentIndexes) ? resume.sentIndexes.length : 0;
}

// One inscription of the bytes prepareInscribeFile already made. A failure
// leaves a toast that runs this again with those same bytes and the error's
// resume data: only the missing chunks are sent. The file is not prepared again.
async function inscribeWith(prepared, total, resume) {
  let chunks = Math.max(1, total);
  let held = toast.hold(`Inscribing ${Math.min(sentCount(resume) + 1, chunks)} of ${chunks}`);
  const release = () => {
    if (!held) return;
    held.done();
    held = null;
  };
  try {
    const result = await inscribePrepared(prepared, {
      resume: resume || undefined,
      onProgress: ({ sent, total: count }) => {
        if (Number.isFinite(count) && count > 0) chunks = count;
        release();
        if (sent < chunks) held = toast.hold(`Inscribing ${sent + 1} of ${chunks}`);
      },
    });
    release();
    toast.success("Inscribed", { action: hcsLink(result), ms: 12000 });
    return result;
  } catch (err) {
    release();
    const next = err && err.topicId
      ? { topicId: err.topicId, submitKey: err.submitKey, sentIndexes: err.sentIndexes || [] }
      : null;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "toast-connect";
    action.textContent = "Resume";
    const notice = toast.error(`Stopped at ${sentCount(next)} of ${chunks}. Tap to resume`, {
      hold: true,
      stay: true,
      action,
    });
    // The whole pill is the tap target. The button's click bubbles to it.
    const pill = action.parentElement || action;
    let tapped = false;
    pill.addEventListener("click", () => {
      if (tapped || running) return;
      tapped = true;
      notice.done();
      running = inscribeWith(prepared, chunks, next).finally(() => {
        running = null;
      });
    });
    return null;
  }
}

async function runFlow(file, options) {
  let prepared;
  try {
    prepared = await prepareInscribeFile(file);
  } catch (err) {
    toast.error(err && err.userFacing ? err.message : "Could not read this file.");
    return null;
  }
  const info = {
    ...prepared,
    resized: await wasDownscaled(file),
    hbarUsd: options.hbarUsd,
    returnTo: options.returnTo,
  };
  if (prepared.overCap) {
    await showInscribeOverCap(info);
    return null;
  }
  if (!(await confirmInscribe(info))) return null;
  return inscribeWith(prepared, (prepared.txCount || 1) - 1, null);
}

// The whole inscribe: prepare, the over-cap card or the confirm card, then
// the wallet. Resolves the inscription ({ topicId, hrl, ... }) or null.
// A second call while one is running waits on the first.
// options: returnTo (focus after the card), hbarUsd (USD per HBAR).
export function runInscribe(file, options = {}) {
  if (running) return running;
  running = runFlow(file, options || {}).finally(() => {
    running = null;
  });
  return running;
}
