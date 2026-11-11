// Whether a post may show Swap, and the lines the sheet needs.
// A profile can say Swap is on without this app's pool check, so the button
// stays hidden until GET /api/swap/token/:tokenId says pool is true.
// A swap is not a donation. Nothing here posts to the donations API.

import { normalizeSwap } from "./server/swapprofile.js";
import { bareAccount } from "./donationmath.js";

export const SWAP_WIDGET_SRC = "https://widget.saucerswap.finance/widget.js";
export const SWAP_TOKEN_CLIENT_CACHE_MS = 5 * 60 * 1000;

const TOKEN_ID = /^\d+\.\d+\.\d+$/;
const tokenCache = new Map();
const tokenFlights = new Map();

export const ASSOCIATION_CUT_WARNING = "The cut is paid in the token. Your account needs automatic token association set to unlimited to receive it.";

export function profileSwapOf(swaps, author) {
  if (!swaps) return null;
  const id = bareAccount(author);
  if (id && Object.prototype.hasOwnProperty.call(swaps, id)) return swaps[id];
  if (author && Object.prototype.hasOwnProperty.call(swaps, author)) return swaps[author];
  return null;
}

// null when the profile is off, missing, or the token id is not 0.0.x.
export function swapOfferFromProfile(swap) {
  if (!swap || typeof swap !== "object") return null;
  const normal = normalizeSwap(swap);
  if (!normal.enabled) return null;
  const tokenId = typeof normal.tokenId === "string" ? normal.tokenId.trim() : "";
  if (!TOKEN_ID.test(tokenId)) return null;
  return { tokenId, feeBps: normal.feeBps };
}

export function swapButtonShows({ author, viewer, offer, token }) {
  if (!offer) return false;
  const them = bareAccount(author);
  const me = bareAccount(viewer);
  if (!them) return false;
  if (me && me === them) return false;
  if (!token || token.pool !== true) return false;
  if (token.tokenId && token.tokenId !== offer.tokenId) return false;
  return true;
}

export function swapNotice({ symbol, tokenId, dueDiligenceComplete }) {
  const id = bareAccount(tokenId) || String(tokenId == null ? "" : tokenId).trim();
  const name = typeof symbol === "string" ? symbol.trim() : "";
  const who = name || "this token";
  let line = `You're buying ${who} (${id}), not donating. Tokens can lose value.`;
  if (dueDiligenceComplete === false) line += " Not reviewed by SaucerSwap.";
  return line;
}

// Fee attributes are omitted at 0. The widget would otherwise charge a cut.
export function swapWidgetConfig({ projectId, tokenId, feeBps, account }) {
  const config = {
    network: "mainnet",
    projectId: typeof projectId === "string" ? projectId : "",
    inputToken: "0.0.0",
    outputToken: bareAccount(tokenId),
    theme: "dark",
  };
  const fee = Number.isInteger(feeBps) ? feeBps : 0;
  const recipient = bareAccount(account);
  if (fee > 0 && recipient) {
    config.integratorFeeBps = fee;
    config.integratorFeeRecipient = recipient;
  }
  return config;
}

export function fillSwapWidget(el, config) {
  const set = (name, value) => {
    if (value == null || value === "") el.removeAttribute(name);
    else el.setAttribute(name, String(value));
  };
  set("network", config.network || "mainnet");
  set("project-id", config.projectId);
  set("input-token", config.inputToken || "0.0.0");
  set("output-token", config.outputToken);
  set("theme", config.theme || "dark");
  set("integrator-fee-bps", config.integratorFeeBps);
  set("integrator-fee-recipient", config.integratorFeeRecipient);
}

// Empty when the account can already receive the token: it is associated,
// auto-association is unlimited, or at least one automatic slot is free.
// Unknown mirror values stay empty so a failed read does not warn.
export function associationCutWarning({ max, associated, count } = {}) {
  if (associated !== false) return "";
  const slots = wholeNumber(max);
  if (slots == null || slots === -1) return "";
  if (slots <= 0) return ASSOCIATION_CUT_WARNING;
  const used = wholeNumber(count);
  if (used == null) return "";
  if (slots > used) return "";
  return ASSOCIATION_CUT_WARNING;
}

function wholeNumber(value) {
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return Number.isInteger(value) ? value : null;
}

// Mirror paths for the fee-collector check. token.id is the token being saved.
export function associationMirrorPaths(account, tokenId) {
  const id = bareAccount(account);
  const token = bareAccount(tokenId);
  if (!id || !token) return null;
  const accountPath = `/api/v1/accounts/${encodeURIComponent(id)}`;
  return {
    account: accountPath,
    token: `${accountPath}/tokens?token.id=${encodeURIComponent(token)}&limit=1`,
    list: `${accountPath}/tokens?limit=100`,
  };
}

const ROUTER_EVM = "0x0df73542cc68bdc01b361d231c60f726b0e0bc05";
const ROUTER_ID = "0.0.10495847";
const LONG_ZERO = /^0x0{24}[0-9a-f]{16}$/i;

// Hedera id for a widget address. "" when it is some other 0x contract.
export function widgetEntityId(value) {
  const raw = String(value == null ? "" : value).trim().replace(/^hedera:(mainnet|testnet):/i, "");
  if (/^\d+\.\d+\.\d+$/.test(raw)) return raw;
  if (raw.toLowerCase() === ROUTER_EVM) return ROUTER_ID;
  if (LONG_ZERO.test(raw)) return "0.0." + BigInt(raw).toString(10);
  return "";
}

export function widgetCallData(data) {
  const hex = String(data == null ? "" : data).trim().replace(/^0x/i, "");
  if (!hex) return new Uint8Array();
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Toast copy for swap-success. No href when the event has no transaction id.
export function swapSuccessToast(detail) {
  const raw = detail && typeof detail.transactionId === "string" ? detail.transactionId.trim() : "";
  if (!raw) return { text: "Swap sent", id: "", href: "" };
  return {
    text: "Swap sent",
    id: raw,
    href: "https://hashscan.io/mainnet/transaction/" + encodeURIComponent(raw),
  };
}

function hiddenUp(el) {
  let node = el;
  while (node) {
    if (node.hidden) return true;
    node = node.parentElement || null;
  }
  return false;
}

// The control to focus when the sheet closes. A Swap item inside a closed
// menu focuses that menu's button. A hidden donate button focuses nothing.
export function swapReturnTarget(opener) {
  if (!opener || opener.isConnected === false) return null;
  if (!opener.disabled && !hiddenUp(opener)) return opener;
  const menu = typeof opener.closest === "function" ? opener.closest(".post-menu") : null;
  const trigger = menu && typeof menu.querySelector === "function" ? menu.querySelector(".post-menu-btn") : null;
  if (trigger && trigger.isConnected !== false && !trigger.disabled && !hiddenUp(trigger)) return trigger;
  return null;
}

function isTabStop(el) {
  if (!el || el.disabled || el.hidden) return false;
  if (el.classList && el.classList.contains("swap-trap")) return false;
  const tab = el.tabIndex;
  return typeof tab === "number" && tab >= 0;
}

export function swapTabbables(root) {
  const out = [];
  const seen = new Set();
  const walk = (scope) => {
    if (!scope || typeof scope.querySelectorAll !== "function") return;
    for (const el of scope.querySelectorAll("*")) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (isTabStop(el)) out.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  return out;
}

// Where Tab should move when it would leave the dialog. null lets the
// browser move, which is how focus enters a closed shadow root.
export function swapTabWrap(items, active, shift) {
  if (!items || !items.length || !active) return null;
  const index = items.indexOf(active);
  if (index < 0) return null;
  if (shift) return index === 0 ? items[items.length - 1] : null;
  return index === items.length - 1 ? items[0] : null;
}

// A closed shadow root still sits in the browser's tab order. Don't steal
// that Tab from the light-DOM edge; the sentinels catch focus when it leaves.
export function swapTabDestination(items, active, shift, closedShadow) {
  if (closedShadow && items && items.length) {
    if (!shift && active === items[items.length - 1]) return null;
    if (shift && active === items[0]) return null;
  }
  return swapTabWrap(items, active, shift);
}

export function deepActiveElement(doc) {
  const root = doc || (typeof document !== "undefined" ? document : null);
  if (!root) return null;
  let el = root.activeElement || null;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

export function mountSwapWidgetScript(doc) {
  const found = doc.querySelector && doc.querySelector(`script[src="${SWAP_WIDGET_SRC}"]`);
  if (found) return found;
  const script = doc.createElement("script");
  script.type = "module";
  script.src = SWAP_WIDGET_SRC;
  script.async = true;
  doc.head.appendChild(script);
  return script;
}

function tokenBody(id, data) {
  return {
    tokenId: data && typeof data.tokenId === "string" && data.tokenId ? data.tokenId : id,
    symbol: data && typeof data.symbol === "string" ? data.symbol : "",
    name: data && typeof data.name === "string" ? data.name : "",
    decimals: data ? data.decimals : 0,
    pool: !!(data && data.pool === true),
    dueDiligenceComplete: !!(data && data.dueDiligenceComplete === true),
  };
}

// A failed lookup is not cached. pool false is a real answer and is cached.
export async function fetchSwapToken(tokenId, options = {}) {
  const id = bareAccount(tokenId);
  if (!id) return null;
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const cache = options.cache === undefined ? tokenCache : options.cache;
  const flights = options.flights === undefined ? tokenFlights : options.flights;
  const ttl = options.cacheMs == null ? SWAP_TOKEN_CLIENT_CACHE_MS : options.cacheMs;
  const backend = options.backend == null ? "" : options.backend;
  if (cache) {
    const hit = cache.get(id);
    if (hit && now() - hit.at < ttl) return hit.body;
  }
  if (flights && flights.get(id)) return flights.get(id);
  const run = (async () => {
    let res;
    try {
      res = await fetchImpl(`${backend}/api/swap/token/${encodeURIComponent(id)}`);
    } catch {
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== "object") return null;
    const body = tokenBody(id, data);
    if (cache) cache.set(id, { at: now(), body });
    return body;
  })();
  if (flights) flights.set(id, run);
  try {
    return await run;
  } finally {
    if (flights) flights.delete(id);
  }
}

export async function resolveSwapButton({ author, viewer, swap, ...rest }) {
  const offer = swapOfferFromProfile(swap);
  const them = bareAccount(author);
  const me = bareAccount(viewer);
  if (!offer || !them || (me && me === them)) {
    return { show: false, offer: null, token: null };
  }
  const token = await fetchSwapToken(offer.tokenId, rest);
  return {
    show: swapButtonShows({ author, viewer, offer, token }),
    offer,
    token,
  };
}
