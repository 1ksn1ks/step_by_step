// Swap sheet. The SaucerSwap widget script is added the first time this
// opens, not with the rest of the app. A swap is not a donation: this
// sheet never posts a payment and never calls the donations API.
// The sheet follows the visible viewport so a phone keyboard and the
// homescreen safe area do not cover the widget.

import { PROJECT_ID } from "./web3.js";
import { EARLY_POPUP_CLASS } from "./earlypopup.js";
import { toast } from "./toast.js";
import { globeSwapWallet } from "./swapwallet.js";
import {
  deepActiveElement,
  fillSwapWidget,
  mountSwapWidgetScript,
  swapNotice,
  swapReturnTarget,
  swapSuccessToast,
  swapTabbables,
  swapTabDestination,
  swapWidgetConfig,
} from "./swapoffer.js";

const WIDGET = "saucerswap-widget";

let sheet = null;
let scriptFlight = null;
let openGen = 0;
let fitted = false;
let returnFocus = null;

const refreshes = new Set();
let watchInstalled = false;

export function watchSwapProfiles(refresh) {
  if (typeof refresh !== "function") return () => {};
  refreshes.add(refresh);
  if (!watchInstalled && typeof document !== "undefined") {
    watchInstalled = true;
    const run = () => {
      for (const fn of [...refreshes]) fn();
    };
    document.addEventListener("profiles-loaded", run);
    document.addEventListener("wallet-account-changed", run);
  }
  return () => refreshes.delete(refresh);
}

function loadWidgetScript() {
  if (typeof customElements !== "undefined" && customElements.get(WIDGET)) return Promise.resolve();
  if (scriptFlight) return scriptFlight;
  const script = mountSwapWidgetScript(document);
  if (script.getAttribute("data-swap-ready") === "1") return Promise.resolve();
  scriptFlight = new Promise((resolve, reject) => {
    const finish = () => {
      script.setAttribute("data-swap-ready", "1");
      resolve();
    };
    const fail = () => {
      scriptFlight = null;
      try { script.remove(); } catch { /* the tag may already be gone */ }
      reject(new Error("widget"));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
  });
  return scriptFlight;
}

function sheetPart(selector) {
  return sheet ? sheet.querySelector(selector) : null;
}

function visibleBox() {
  const view = window.visualViewport;
  const vv = view && view.height > 0 ? view.height : 0;
  const inner = window.innerHeight || 0;
  const height = vv > 0 && inner > 0 ? Math.min(vv, inner) : (vv || inner);
  const top = view && Number.isFinite(view.offsetTop) ? view.offsetTop : 0;
  return { height, top };
}

function fitSwapSheet() {
  if (!sheet || sheet.hidden) return;
  const box = visibleBox();
  if (!(box.height > 0)) return;
  sheet.style.setProperty("--swap-top", box.top + "px");
  sheet.style.setProperty("--swap-h", box.height + "px");
}

function onFit() {
  fitSwapSheet();
}

function startFit() {
  fitSwapSheet();
  if (fitted) return;
  fitted = true;
  window.addEventListener("resize", onFit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onFit);
    window.visualViewport.addEventListener("scroll", onFit);
  }
}

function stopFit() {
  if (fitted) {
    fitted = false;
    window.removeEventListener("resize", onFit);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", onFit);
      window.visualViewport.removeEventListener("scroll", onFit);
    }
  }
  if (!sheet) return;
  sheet.style.removeProperty("--swap-top");
  sheet.style.removeProperty("--swap-h");
}

function paintChrome(host) {
  const card = sheetPart(".swap-card");
  if (!card) return;
  card.classList.toggle(EARLY_POPUP_CLASS, !!host);
  card.style.fontFamily = host ? (getComputedStyle(host).fontFamily || "") : "";
}

function focusReturn() {
  const opener = returnFocus;
  returnFocus = null;
  const target = swapReturnTarget(opener);
  if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
}

function closeSheet() {
  if (!sheet) return;
  openGen += 1;
  sheet.hidden = true;
  stopFit();
  const slot = sheetPart(".swap-widget");
  if (slot) slot.replaceChildren();
  focusReturn();
}

function trapSentinel(which) {
  const el = document.createElement("span");
  el.className = "swap-trap";
  el.tabIndex = 0;
  el.dataset.swapTrap = which;
  el.setAttribute("aria-hidden", "true");
  return el;
}

function txLink(notice) {
  const link = document.createElement("a");
  link.className = "swap-tx-link";
  link.href = notice.href;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = notice.id;
  return link;
}

function ensureSheet() {
  if (sheet) return sheet;
  const root = document.createElement("div");
  root.id = "swap-sheet";
  root.hidden = true;

  const card = document.createElement("div");
  card.className = "swap-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "swap-title");

  const head = document.createElement("div");
  head.className = "swap-head";
  const title = document.createElement("h2");
  title.id = "swap-title";
  title.className = "swap-title";
  title.textContent = "Swap";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "swap-x";
  cancel.setAttribute("aria-label", "Close");
  cancel.textContent = "×";
  head.append(title, cancel);

  const note = document.createElement("p");
  note.className = "swap-note";

  const error = document.createElement("p");
  error.className = "swap-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const slot = document.createElement("div");
  slot.className = "swap-widget";

  card.append(head, note, error, slot);
  root.append(trapSentinel("start"), card, trapSentinel("end"));

  cancel.addEventListener("click", (event) => {
    event.preventDefault();
    closeSheet();
  });
  root.addEventListener("focusin", (event) => {
    const which = event.target && event.target.dataset ? event.target.dataset.swapTrap : "";
    if (which !== "start" && which !== "end") return;
    const items = swapTabbables(card);
    const next = which === "start" ? items[items.length - 1] : items[0];
    if (next && next !== event.target) next.focus({ preventScroll: true });
  });
  root.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === root) closeSheet();
  });
  card.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("keydown", (event) => {
    if (!sheet || sheet.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeSheet();
      return;
    }
    if (event.key !== "Tab") return;
    const items = swapTabbables(card);
    const widget = card.querySelector("saucerswap-widget");
    const closedShadow = !!(widget && !widget.shadowRoot);
    const next = swapTabDestination(items, deepActiveElement(document), event.shiftKey, closedShadow);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    next.focus({ preventScroll: true });
  }, true);

  document.body.appendChild(root);
  sheet = root;
  return root;
}

export async function openSwapSheet(details) {
  const gen = ++openGen;
  const root = ensureSheet();
  const offer = details || {};
  returnFocus = offer.opener || null;
  const config = swapWidgetConfig({
    projectId: PROJECT_ID,
    tokenId: offer.tokenId,
    feeBps: offer.feeBps,
    account: offer.account,
  });
  const note = root.querySelector(".swap-note");
  if (note) {
    note.textContent = swapNotice({
      symbol: offer.symbol,
      tokenId: offer.tokenId,
      dueDiligenceComplete: offer.dueDiligenceComplete,
    });
  }
  const error = root.querySelector(".swap-error");
  if (error) {
    error.textContent = "";
    error.hidden = true;
  }
  const slot = root.querySelector(".swap-widget");
  if (slot) slot.replaceChildren();
  paintChrome(offer.host);
  root.hidden = false;
  startFit();
  const closeBtn = root.querySelector(".swap-x");
  if (closeBtn) closeBtn.focus({ preventScroll: true });
  try {
    await loadWidgetScript();
    if (gen !== openGen || root.hidden || !slot) return;
    const el = document.createElement(WIDGET);
    fillSwapWidget(el, config);
    let wallet = null;
    try { wallet = globeSwapWallet(); } catch { wallet = null; }
    if (wallet) el.externalWallet = wallet;
    el.addEventListener("walletconnect-request", (event) => {
      if (wallet && wallet.isConnected) event.preventDefault();
    });
    el.addEventListener("swap-success", (event) => {
      if (gen !== openGen) return;
      const notice = swapSuccessToast(event && event.detail);
      if (notice.href) toast.success(notice.text, { action: txLink(notice), ms: 6000 });
      else toast.success(notice.text);
      closeSheet();
    });
    slot.replaceChildren(el);
  } catch {
    if (gen !== openGen || root.hidden) return;
    if (error) {
      error.textContent = "Could not open Swap. Try again.";
      error.hidden = false;
    }
    toast.error("Could not open Swap. Try again.");
  }
}
