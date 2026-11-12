// Swap sheet. The SaucerSwap widget script is added the first time this
// opens, not with the rest of the app. A swap is not a donation: this
// sheet never posts a payment and never calls the donations API.
// The sheet follows the visible viewport so a phone keyboard and the
// homescreen safe area do not cover the widget.

import { PROJECT_ID } from "./web3.js";
import { EARLY_POPUP_CLASS } from "./earlypopup.js";
import { toast } from "./toast.js";
import { globeSwapWallet } from "./swapwallet.js";
import { bareAccount } from "./donationmath.js";
import { profileSwapBios } from "./loadalladata.js";
import {
  createSwapSheetMotion,
  deepActiveElement,
  fillSwapWidget,
  mountSwapWidgetScript,
  swapReturnTarget,
  swapSheetText,
  swapSuccessToast,
  swapTabbables,
  swapKeptLinks,
  swapTabDestination,
  swapWidgetConfig,
} from "./swapoffer.js";

const WIDGET = "saucerswap-widget";

let sheet = null;
let scriptFlight = null;
let motion = null;
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

export function loadWidgetScript() {
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

function edgePx(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

// The widget's own box stays its natural size. zoom scales that box into
// spare room in the sheet. Reset to 1 before measuring so a later fit does
// not multiply the previous scale. Never shrink a portrait phone.
function fitWidgetZoom() {
  const slot = sheetPart(".swap-widget");
  const card = sheetPart(".swap-card");
  const widget = slot && slot.querySelector(WIDGET);
  if (!slot || !card || !widget) return;
  widget.style.zoom = "1";
  // Drop the reserved floor so this read is the widget's own height, not
  // the space it was given last time. The floor is put back in rem.
  const previous = slot.style.minHeight;
  slot.style.minHeight = "0";
  const naturalW = widget.offsetWidth;
  const naturalH = widget.offsetHeight;
  if (!(naturalW > 0) || !(naturalH > 0)) {
    if (previous && previous !== "0") slot.style.minHeight = previous;
    else slot.style.removeProperty("min-height");
    return;
  }
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (rootPx > 0) slot.style.minHeight = (naturalH / rootPx) + "rem";
  else if (previous && previous !== "0") slot.style.minHeight = previous;
  else slot.style.removeProperty("min-height");
  const cs = getComputedStyle(sheet);
  const room = sheet.clientHeight - edgePx(cs.paddingTop) - edgePx(cs.paddingBottom);
  const extra = Math.max(0, room - card.offsetHeight);
  const freeW = slot.clientWidth;
  const freeH = slot.clientHeight + extra;
  let zoom = Math.min(freeW / naturalW, freeH / naturalH);
  if (!Number.isFinite(zoom) || zoom < 1) zoom = 1;
  if (zoom > 1.6) zoom = 1.6;
  widget.style.zoom = String(zoom);
}

function fitSwapSheet() {
  if (!sheet || sheet.hidden) return;
  const box = visibleBox();
  if (!(box.height > 0)) return;
  sheet.style.setProperty("--swap-top", box.top + "px");
  sheet.style.setProperty("--swap-h", box.height + "px");
  fitWidgetZoom();
}

function onFit() {
  fitSwapSheet();
}

function startFit() {
  fitSwapSheet();
  if (fitted) return;
  fitted = true;
  window.addEventListener("resize", onFit);
  window.addEventListener("orientationchange", onFit);
  document.addEventListener("wallet-account-changed", onFit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onFit);
    window.visualViewport.addEventListener("scroll", onFit);
  }
}

function stopFit() {
  if (fitted) {
    fitted = false;
    window.removeEventListener("resize", onFit);
    window.removeEventListener("orientationchange", onFit);
    document.removeEventListener("wallet-account-changed", onFit);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", onFit);
      window.visualViewport.removeEventListener("scroll", onFit);
    }
  }
  const widget = sheetPart(".swap-widget " + WIDGET);
  if (widget) widget.style.zoom = "1";
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

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function finishClose() {
  if (!sheet) return;
  sheet.hidden = true;
  sheet.classList.remove("is-closing");
  stopFit();
  const slot = sheetPart(".swap-widget");
  if (slot) slot.replaceChildren();
  focusReturn();
}

function sheetMotion() {
  if (motion) return motion;
  motion = createSwapSheetMotion({
    reduced() {
      return reducedMotion() || !sheetPart(".swap-card");
    },
    target() {
      return sheetPart(".swap-card");
    },
    listen(fn) {
      const card = sheetPart(".swap-card");
      if (card) card.addEventListener("animationend", fn);
    },
    unlisten(fn) {
      const card = sheetPart(".swap-card");
      if (card) card.removeEventListener("animationend", fn);
    },
    cleanup: finishClose,
  });
  return motion;
}

function closeSheet() {
  if (!sheet || sheet.hidden) return;
  const card = sheetPart(".swap-card");
  if (card && !reducedMotion()) sheet.classList.add("is-closing");
  sheetMotion().close();
}

function swapLoadingNote() {
  const note = document.createElement("p");
  note.className = "swap-widget-placeholder";
  note.textContent = "Loading swap…";
  return note;
}

function trapSentinel(which) {
  const el = document.createElement("span");
  el.className = "swap-trap";
  el.tabIndex = 0;
  el.dataset.swapTrap = which;
  el.setAttribute("aria-hidden", "true");
  return el;
}

const SWAP_LINK_LABELS = [
  ["website", "Website"],
  ["x", "X"],
  ["telegram", "Telegram"],
  ["discord", "Discord"],
];

// The widget hard-codes white letters on .ss-primary-btn. The fill stays
// the theme accent. This style is appended after the widget's own sheet
// so the same selectors win.
const SWAP_BUTTON_INK = [
  ".ss-primary-btn",
  ".ss-primary-btn:disabled",
  ".ss-primary-btn.ss-primary-btn-loading",
  ".ss-primary-btn.ss-primary-btn-loading:disabled",
].join(",") + "{color:#000}";

function paintSwapButtonInk(widget) {
  const root = widget && widget.shadowRoot;
  if (!root || root.querySelector("style[data-swap-ink]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-swap-ink", "");
  style.textContent = SWAP_BUTTON_INK;
  root.appendChild(style);
}

function paintSwapLinks(row, links) {
  if (!row) return;
  row.replaceChildren();
  const kept = swapKeptLinks(links);
  const entries = SWAP_LINK_LABELS.filter(([key]) => kept[key]);
  if (!entries.length) {
    row.hidden = true;
    return;
  }
  for (const [key, label] of entries) {
    const link = document.createElement("a");
    link.className = "swap-link";
    link.href = kept[key];
    link.target = "_blank";
    link.rel = "noopener noreferrer nofollow";
    link.textContent = label;
    row.append(link);
  }
  row.hidden = false;
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

  const bio = document.createElement("p");
  bio.className = "swap-bio";
  bio.hidden = true;

  const note = document.createElement("p");
  note.className = "swap-note";

  const links = document.createElement("div");
  links.className = "swap-links";
  links.hidden = true;

  const error = document.createElement("p");
  error.className = "swap-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const slot = document.createElement("div");
  slot.className = "swap-widget";
  slot.append(swapLoadingNote());

  card.append(head, bio, note, links, error, slot);
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
  const gen = sheetMotion().open();
  const root = ensureSheet();
  root.classList.remove("is-closing");
  const offer = details || {};
  returnFocus = offer.opener || null;
  const config = swapWidgetConfig({
    projectId: PROJECT_ID,
    tokenId: offer.tokenId,
    feeBps: offer.feeBps,
    account: offer.account,
  });
  const author = bareAccount(offer.account);
  const lines = swapSheetText({
    bio: author && typeof profileSwapBios[author] === "string" ? profileSwapBios[author] : "",
    symbol: offer.symbol,
    tokenId: offer.tokenId,
    dueDiligenceComplete: offer.dueDiligenceComplete,
    feeBps: offer.feeBps,
  });
  const bio = root.querySelector(".swap-bio");
  if (bio) {
    bio.textContent = lines.bio;
    bio.hidden = !lines.bio;
  }
  const note = root.querySelector(".swap-note");
  if (note) note.textContent = lines.safety;
  paintSwapLinks(root.querySelector(".swap-links"), bareAccount(offer.tokenId) ? offer.links : null);
  const error = root.querySelector(".swap-error");
  if (error) {
    error.textContent = "";
    error.hidden = true;
  }
  const slot = root.querySelector(".swap-widget");
  if (slot) slot.replaceChildren(swapLoadingNote());
  paintChrome(offer.host);
  root.hidden = false;
  startFit();
  const closeBtn = root.querySelector(".swap-x");
  if (closeBtn) closeBtn.focus({ preventScroll: true });
  try {
    await loadWidgetScript();
    if (gen !== sheetMotion().generation() || root.hidden || !slot) return;
    const el = document.createElement(WIDGET);
    fillSwapWidget(el, config);
    let wallet = null;
    try { wallet = globeSwapWallet(config.outputToken); } catch { wallet = null; }
    if (wallet) el.externalWallet = wallet;
    el.addEventListener("walletconnect-request", (event) => {
      if (wallet && wallet.isConnected) event.preventDefault();
    });
    el.addEventListener("swap-success", (event) => {
      if (gen !== sheetMotion().generation()) return;
      const notice = swapSuccessToast(event && event.detail);
      if (notice.href) toast.success(notice.text, { action: txLink(notice), ms: 6000 });
      else toast.success(notice.text);
      closeSheet();
    });
    slot.replaceChildren(el);
    paintSwapButtonInk(el);
    fitSwapSheet();
    requestAnimationFrame(() => fitSwapSheet());
  } catch {
    if (gen !== sheetMotion().generation() || root.hidden) return;
    if (slot) slot.replaceChildren();
    if (error) {
      error.textContent = "Could not open Swap. Try again.";
      error.hidden = false;
    }
    toast.error("Could not open Swap. Try again.");
  }
}
