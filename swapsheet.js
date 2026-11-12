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
import { swapHttpsLink } from "./server/swaptoken.js";
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

// One fit per frame. A second request before that frame runs is skipped.
let fitFrame = 0;
let widgetObserver = null;

function scheduleFit() {
  if (fitFrame) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    fitSwapSheet();
  });
}

function onViewportScroll() {
  if (!sheet || sheet.hidden) return;
  const box = visibleBox();
  sheet.style.setProperty("--swap-top", box.top + "px");
}

function watchWidgetSize() {
  if (typeof ResizeObserver !== "function") return;
  const slot = sheetPart(".swap-widget");
  const widget = slot && slot.querySelector(WIDGET);
  if (!widget) return;
  if (widgetObserver) widgetObserver.disconnect();
  else {
    widgetObserver = new ResizeObserver(() => {
      scheduleFit();
    });
  }
  widgetObserver.observe(widget);
}

// The centred column stays its natural size. zoom scales the header, token
// card, bio, note and widget together into spare room in the sheet. Reset
// to 1 before measuring so a later fit does not multiply the previous
// scale. Never shrink a portrait phone.
function fitColumnZoom() {
  const column = sheetPart(".swap-column");
  const slot = sheetPart(".swap-widget");
  const card = sheetPart(".swap-card");
  const widget = slot && slot.querySelector(WIDGET);
  if (!column || !slot || !card || !widget) return;
  column.style.zoom = "1";
  card.style.removeProperty("width");
  // Drop the reserved floor so this read is the widget's own height, not
  // the space it was given last time. The floor is put back in rem.
  const previous = slot.style.minHeight;
  slot.style.minHeight = "0";
  const columnW = column.offsetWidth;
  const columnH = column.offsetHeight;
  const naturalH = widget.offsetHeight;
  if (!(columnW > 0) || !(columnH > 0) || !(naturalH > 0)) {
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
  const cardCs = getComputedStyle(card);
  const freeW = card.clientWidth - edgePx(cardCs.paddingLeft) - edgePx(cardCs.paddingRight);
  const freeH = column.clientHeight + extra;
  let zoom = Math.min(freeW / columnW, freeH / columnH);
  if (!Number.isFinite(zoom) || zoom < 1) zoom = 1;
  if (zoom > 2.4) zoom = 2.4;
  column.style.zoom = String(zoom);
  // Measured at the card's available width. Then hug the zoomed column so
  // the side padding matches the top and bottom, with no empty strip.
  const fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (fine && rootPx > 0) {
    const pad = getComputedStyle(card);
    const side = edgePx(pad.paddingLeft) + edgePx(pad.paddingRight)
      + edgePx(pad.borderLeftWidth) + edgePx(pad.borderRightWidth);
    const rendered = column.offsetWidth;
    if (rendered > 0) card.style.width = ((rendered + side) / rootPx) + "rem";
  }
}

function fitSwapSheet() {
  if (!sheet || sheet.hidden) return;
  const box = visibleBox();
  if (!(box.height > 0)) return;
  sheet.style.setProperty("--swap-top", box.top + "px");
  sheet.style.setProperty("--swap-h", box.height + "px");
  fitColumnZoom();
}

function startFit() {
  scheduleFit();
  watchWidgetSize();
  if (fitted) return;
  fitted = true;
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("orientationchange", scheduleFit);
  document.addEventListener("wallet-account-changed", scheduleFit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleFit);
    window.visualViewport.addEventListener("scroll", onViewportScroll);
  }
}

function stopFit() {
  if (widgetObserver) {
    widgetObserver.disconnect();
    widgetObserver = null;
  }
  if (fitFrame) {
    cancelAnimationFrame(fitFrame);
    fitFrame = 0;
  }
  if (fitted) {
    fitted = false;
    window.removeEventListener("resize", scheduleFit);
    window.removeEventListener("orientationchange", scheduleFit);
    document.removeEventListener("wallet-account-changed", scheduleFit);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", scheduleFit);
      window.visualViewport.removeEventListener("scroll", onViewportScroll);
    }
  }
  const column = sheetPart(".swap-column");
  if (column) column.style.zoom = "1";
  const card = sheetPart(".swap-card");
  if (card) card.style.removeProperty("width");
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
  note.setAttribute("role", "status");
  note.setAttribute("aria-live", "polite");
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

function swapSvg(name, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const key of Object.keys(attrs)) el.setAttribute(key, attrs[key]);
  return el;
}

function swapIcon(children) {
  const svg = swapSvg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "swap-ico" });
  for (const child of children) svg.append(child);
  return svg;
}

function stroke(name, attrs) {
  return swapSvg(name, Object.assign({ fill: "none", stroke: "currentColor", "stroke-width": "1.8" }, attrs));
}

function globeIcon() {
  return swapIcon([
    stroke("circle", { cx: "12", cy: "12", r: "9" }),
    stroke("path", { d: "M3 12h18", "stroke-linecap": "round" }),
    stroke("path", { d: "M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9s1.2-6.4 3.6-9z" }),
  ]);
}

function xIcon() {
  return swapIcon([
    swapSvg("path", { fill: "currentColor", d: "M14.7 3h2.6l-5.7 6.5L18.5 21h-2.7l-4.2-5.5L6.6 21H4l6.1-7L4.2 3h2.8l3.8 5L14.7 3zm-1 16.2h1.4L7.5 4.7H6L13.7 19.2z" }),
  ]);
}

function telegramIcon() {
  return swapIcon([
    swapSvg("path", { fill: "currentColor", d: "M20.7 4.3 3.4 11c-1.2.5-1.2 1.1-.2 1.4l4.4 1.4 1.7 5.2c.2.6.1.8.7.8.4 0 .6-.2.8-.4l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.4-1.5zM9.2 14.2l8.8-5.5c.4-.3.8-.1.5.2l-7.1 6.4-.3 3.1-1.9-4.2z" }),
  ]);
}

function discordIcon() {
  return swapIcon([
    swapSvg("path", { fill: "currentColor", d: "M17.6 5.4A15 15 0 0 0 14.2 4l-.3.6a13.8 13.8 0 0 0-4 0L9.6 4a15 15 0 0 0-3.4 1.4C4 8.5 3.4 11.6 3.7 14.6A15.4 15.4 0 0 0 8.2 17l.6-1a9.8 9.8 0 0 1-1.5-.7l.4-.3c2.9 1.3 6 1.3 8.8 0l.3.3c-.5.3-1 .5-1.5.7l.6 1a15.4 15.4 0 0 0 4.5-2.4c.4-3.3-.6-6.4-2.8-9.2zM9.2 13.2c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5 1.3.7 1.3 1.5-.6 1.5-1.3 1.5zm5.6 0c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5 1.3.7 1.3 1.5-.6 1.5-1.3 1.5z" }),
  ]);
}

function infoIcon() {
  return swapIcon([
    stroke("circle", { cx: "12", cy: "12", r: "9" }),
    stroke("path", { d: "M12 11v6", "stroke-linecap": "round" }),
    swapSvg("circle", { cx: "12", cy: "8", r: "1.1", fill: "currentColor" }),
  ]);
}

function copyIcon() {
  return swapIcon([
    stroke("rect", { x: "8", y: "8", width: "12", height: "12", rx: "2" }),
    stroke("path", { d: "M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1", "stroke-linecap": "round" }),
  ]);
}

const SWAP_LINK_ICONS = {
  website: globeIcon,
  x: xIcon,
  telegram: telegramIcon,
  discord: discordIcon,
};

function copySwapId(text) {
  const write = navigator.clipboard && navigator.clipboard.writeText;
  if (write) return write.call(navigator.clipboard, text).catch(() => copySwapIdFallback(text));
  return copySwapIdFallback(text);
}

function copySwapIdFallback(text) {
  return new Promise((resolve, reject) => {
    const before = document.activeElement;
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(field);
    field.focus({ preventScroll: true });
    field.select();
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("copy"));
    } catch (err) {
      reject(err);
    } finally {
      field.remove();
      if (before && before.focus && before !== document.body) before.focus({ preventScroll: true });
    }
  });
}

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

function paintSwapToken(card, offer) {
  if (!card) return;
  const id = bareAccount(offer && offer.tokenId);
  const icon = card.querySelector(".swap-token-icon");
  const copy = card.querySelector(".swap-copy");
  if (!id) {
    card.hidden = true;
    if (copy) copy.hidden = true;
    if (icon) {
      icon.hidden = true;
      icon.removeAttribute("src");
    }
    return;
  }
  card.hidden = false;
  if (copy) copy.hidden = false;
  const symbol = card.querySelector(".swap-token-symbol");
  if (symbol) symbol.textContent = typeof offer.symbol === "string" ? offer.symbol.trim() : "";
  const idText = card.querySelector(".swap-token-id-text");
  if (idText) idText.textContent = id;
  const src = swapHttpsLink(offer.icon);
  if (icon) {
    if (src) {
      icon.hidden = false;
      icon.src = src;
    } else {
      icon.hidden = true;
      icon.removeAttribute("src");
    }
  }
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
    const mark = SWAP_LINK_ICONS[key];
    if (mark) link.prepend(mark());
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

  const token = document.createElement("div");
  token.className = "swap-token";
  token.hidden = true;
  const icon = document.createElement("img");
  icon.className = "swap-token-icon";
  icon.alt = "";
  icon.hidden = true;
  icon.addEventListener("error", () => {
    icon.hidden = true;
    icon.removeAttribute("src");
  });
  const meta = document.createElement("div");
  meta.className = "swap-token-meta";
  const symbol = document.createElement("p");
  symbol.className = "swap-token-symbol";
  const idRow = document.createElement("div");
  idRow.className = "swap-token-id";
  const idText = document.createElement("span");
  idText.className = "swap-token-id-text";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "swap-copy";
  copy.setAttribute("aria-label", "Copy token ID");
  copy.append(copyIcon());
  copy.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const value = idText.textContent;
    if (!value) return;
    try {
      await copySwapId(value);
      toast.success("Copied token id");
    } catch {
      toast.error("Could not copy");
    }
  });
  idRow.append(idText, copy);
  meta.append(symbol, idRow);
  const links = document.createElement("div");
  links.className = "swap-links";
  links.hidden = true;
  token.append(icon, meta, links);

  const bio = document.createElement("p");
  bio.className = "swap-bio";
  bio.hidden = true;

  const noteRow = document.createElement("p");
  noteRow.className = "swap-note";
  const note = document.createElement("span");
  note.className = "swap-note-text";
  noteRow.append(infoIcon(), note);

  const error = document.createElement("p");
  error.className = "swap-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const slot = document.createElement("div");
  slot.className = "swap-widget";
  slot.append(swapLoadingNote());

  const column = document.createElement("div");
  column.className = "swap-column";
  column.append(head, token, bio, noteRow, error, slot);
  card.append(column);
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
  const note = root.querySelector(".swap-note-text");
  if (note) note.textContent = lines.safety;
  paintSwapToken(root.querySelector(".swap-token"), offer);
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
    watchWidgetSize();
    scheduleFit();
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
