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

// Empty string when the account is unlimited (-1) or the value is unknown.
export function associationCutWarning(max) {
  const n = typeof max === "string" && /^-?\d+$/.test(max.trim()) ? Number(max.trim()) : max;
  if (!Number.isInteger(n) || n === -1) return "";
  return ASSOCIATION_CUT_WARNING;
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
