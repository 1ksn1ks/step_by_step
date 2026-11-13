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
import { DEFAULT_PIC, profileDisplayName, profilePicUrl, profileUsername } from "./profileface.js";
import { mountPicture } from "./loopmedia.js";
import { paintProfileAvatar } from "./earlyhashinal.js";
import { swapHttpsLink, swapWebsiteLabel, swapXLabel } from "./server/swaptoken.js";
import {
  createSwapSheetMotion,
  deepActiveElement,
  fillSwapWidget,
  mountSwapWidgetScript,
  createSwapStats,
  paintSwapStats,
  swapCardWidth,
  swapColumnZoom,
  swapKeptLinks,
  swapPhoneColumnZoom,
  swapReturnTarget,
  swapSheetText,
  swapSuccessToast,
  swapTabbables,
  swapTabDestination,
  swapWidgetConfig,
  swapWidgetResizeNeedsFit,
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
let widgetNaturalH = 0;

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
      const live = sheetPart(".swap-widget");
      const current = live && live.querySelector(WIDGET);
      const column = sheetPart(".swap-column");
      if (!current || !column) return;
      const zoom = parseFloat(column.style.zoom);
      const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const slack = (rootPx > 0 ? rootPx : 16) * 0.1;
      if (!swapWidgetResizeNeedsFit(widgetNaturalH, current.offsetHeight, scale, slack)) return;
      scheduleFit();
    });
  }
  widgetObserver.observe(widget);
}

// The centred column stays its natural size. zoom scales the header, token
// card, bio, note and widget together. Reset to 1 before measuring so a
// later fit does not multiply the previous scale. A phone may zoom below 1
// when that is what fits the screen width.
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
  const naturalW = column.offsetWidth;
  const naturalH = column.offsetHeight;
  const widgetH = widget.offsetHeight;
  if (!(naturalW > 0) || !(naturalH > 0) || !(widgetH > 0)) {
    if (previous && previous !== "0") slot.style.minHeight = previous;
    else slot.style.removeProperty("min-height");
    return;
  }
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (rootPx > 0) slot.style.minHeight = (widgetH / rootPx) + "rem";
  else if (previous && previous !== "0") slot.style.minHeight = previous;
  else slot.style.removeProperty("min-height");
  widgetNaturalH = widgetH;
  const view = visibleBox();
  const viewW = window.innerWidth || 0;
  const viewH = view.height;
  const pad = getComputedStyle(card);
  const padX = edgePx(pad.paddingLeft) + edgePx(pad.paddingRight);
  const padY = edgePx(pad.paddingTop) + edgePx(pad.paddingBottom);
  const sheetCs = getComputedStyle(sheet);
  const sheetY = edgePx(sheetCs.paddingTop) + edgePx(sheetCs.paddingBottom);
  const freeH = viewH - sheetY - padY;
  const fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  let zoom;
  if (fine) {
    const maxCard = Math.min(viewW * 0.86, viewH * 0.56);
    const freeW = maxCard - padX;
    zoom = swapColumnZoom(naturalW, naturalH, freeW, freeH);
  } else {
    // Each side is max(--swap-side-gap, --corner-clear). freeW uses that
    // same resolved padding. The border sits outside it.
    const gap = edgePx(pad.paddingLeft);
    const borderX = edgePx(pad.borderLeftWidth) + edgePx(pad.borderRightWidth);
    const freeW = viewW - 2 * gap - borderX;
    zoom = swapPhoneColumnZoom(naturalW, naturalH, freeW, freeH);
  }
  column.style.zoom = String(zoom);
  // offsetWidth stayed the unzoomed size, so the desktop card adds the scale.
  if (fine && rootPx > 0) {
    const side = padX + edgePx(pad.borderLeftWidth) + edgePx(pad.borderRightWidth);
    card.style.width = (swapCardWidth(naturalW, zoom, side) / rootPx) + "rem";
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
  widgetNaturalH = 0;
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
    swapSvg("path", { fill: "currentColor", d: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" }),
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

export function paintSwapToken(card, offer) {
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

export function paintSwapLinks(row, links) {
  if (!row) return;
  row.replaceChildren();
  const kept = swapKeptLinks(links);
  const entries = SWAP_LINK_LABELS.map(([key, kind]) => {
    const href = kept[key];
    const text = key === "x" ? swapXLabel(href) : swapWebsiteLabel(href);
    return text ? [key, kind, text] : null;
  }).filter(Boolean);
  if (!entries.length) {
    row.hidden = true;
    return;
  }
  for (const [key, kind, text] of entries) {
    const link = document.createElement("a");
    link.className = "swap-link";
    link.href = kept[key];
    link.target = "_blank";
    link.rel = "noopener noreferrer nofollow";
    link.setAttribute("aria-label", kind + ": " + text);
    const mark = SWAP_LINK_ICONS[key];
    if (mark) link.append(mark());
    const name = document.createElement("span");
    name.className = "swap-link-label";
    name.textContent = text;
    link.append(name);
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

// "Swap <symbol>" when the offer names one, otherwise "Swap". The visible
// title row is gone, so this is the dialog's accessible name.
function swapDialogLabel(offer) {
  const symbol = offer && typeof offer.symbol === "string" ? offer.symbol.trim() : "";
  return symbol ? "Swap " + symbol : "Swap";
}

// Buy's corner when the token card is open. With no creator token the card
// is hidden, and the same button is the first child of the column.
function placeSwapClose(column, token, cancel) {
  if (!cancel || !column) return;
  if (token && !token.hidden) {
    const links = token.querySelector(".swap-links");
    if (links) links.before(cancel);
    else token.append(cancel);
    return;
  }
  column.insertBefore(cancel, column.firstChild);
}

// The same token card the sheet shows: round icon, bold symbol, monospace
// id with copy, and the website / X row. Callers paint it with
// paintSwapToken and paintSwapLinks.
export function createSwapTokenCard() {
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
  return token;
}

// The author's face, name, and account id, then their Swap bio. Same row
// as the feed banner, without its back arrow. The bio is the note under it.
function createSwapBio() {
  const banner = document.createElement("div");
  banner.className = "swap-bio";
  banner.hidden = true;
  banner.setAttribute("role", "group");

  const open = document.createElement("button");
  open.type = "button";
  open.className = "swap-bio-open";
  open.hidden = true;

  const pic = document.createElement("img");
  pic.className = "feed-profile-banner-pic";
  pic.alt = "";
  const copy = document.createElement("span");
  copy.className = "feed-profile-banner-copy";
  const name = document.createElement("span");
  name.className = "feed-profile-banner-name";
  const handle = document.createElement("span");
  handle.className = "feed-profile-banner-handle";
  copy.append(name, handle);
  open.append(pic, copy);
  open.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const account = open.dataset.account || "";
    returnFocus = null;
    closeSheet();
    const jump = window.openProfileFromPopup || window.openFeedProfile;
    if (account && typeof jump === "function") jump(account);
  });

  const body = document.createElement("p");
  body.className = "feed-profile-banner-bio";
  banner.append(open, body);
  return banner;
}

function paintSwapBio(banner, author, text) {
  if (!banner) return;
  const body = banner.querySelector(".feed-profile-banner-bio");
  const open = banner.querySelector(".swap-bio-open");
  const nameEl = banner.querySelector(".feed-profile-banner-name");
  const handleEl = banner.querySelector(".feed-profile-banner-handle");
  if (!text) {
    banner.hidden = true;
    banner.classList.remove("no-username");
    banner.removeAttribute("aria-label");
    if (body) body.textContent = "";
    if (open) {
      open.hidden = true;
      delete open.dataset.account;
    }
    return;
  }
  const stored = profileUsername(author);
  const name = stored ? profileDisplayName(author) : "";
  const who = name || author || "";
  banner.hidden = false;
  banner.classList.toggle("no-username", !name);
  banner.setAttribute("aria-label", "Bio from " + who);
  if (nameEl) {
    nameEl.textContent = name;
    nameEl.hidden = !name;
  }
  if (handleEl) handleEl.textContent = author || "";
  if (body) body.textContent = text;
  if (open) {
    open.hidden = false;
    open.dataset.account = author || "";
  }
  const pic = banner.querySelector(".feed-profile-banner-pic");
  const mounted = mountPicture(pic, profilePicUrl(author), {
    className: "feed-profile-banner-pic",
    fallback: DEFAULT_PIC,
    alt: "",
  });
  paintProfileAvatar(mounted, author);
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
  card.setAttribute("aria-label", "Swap");

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "swap-x";
  cancel.setAttribute("aria-label", "Close Swap");
  cancel.textContent = "×";

  const token = createSwapTokenCard();
  const stats = createSwapStats();

  const bio = createSwapBio();

  const error = document.createElement("p");
  error.className = "swap-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const slot = document.createElement("div");
  slot.className = "swap-widget";
  slot.append(swapLoadingNote());

  const column = document.createElement("div");
  column.className = "swap-column";
  column.append(token, stats, bio, error, slot);
  placeSwapClose(column, token, cancel);
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
    feeBps: offer.feeBps,
  });
  paintSwapBio(root.querySelector(".swap-bio"), author, lines.bio);
  let noteRow = root.querySelector(".swap-note");
  if (!lines.safety) {
    if (noteRow) noteRow.remove();
  } else {
    if (!noteRow) {
      noteRow = document.createElement("p");
      noteRow.className = "swap-note";
      const note = document.createElement("span");
      note.className = "swap-note-text";
      noteRow.append(infoIcon(), note);
      const errorSlot = root.querySelector(".swap-error");
      if (errorSlot) errorSlot.before(noteRow);
    }
    const note = noteRow.querySelector(".swap-note-text");
    if (note) note.textContent = lines.safety;
  }
  paintSwapToken(root.querySelector(".swap-token"), offer);
  const dialog = root.querySelector(".swap-card");
  if (dialog) {
    dialog.removeAttribute("aria-labelledby");
    dialog.setAttribute("aria-label", swapDialogLabel(offer));
  }
  placeSwapClose(root.querySelector(".swap-column"), root.querySelector(".swap-token"), root.querySelector(".swap-x"));
  paintSwapStats(root.querySelector(".swap-stats"), offer);
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
