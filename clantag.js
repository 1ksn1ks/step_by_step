// Clan tag on a profile bubble. A chip shows only when that author's profile
// Swap (bio topic 0.0.9759201) is on and names a real token. The token body
// comes from the shared /api/swap/token lookup, once per token, then every
// bubble by that author reuses it. The bubble is painted first; the chip is
// added when the lookup returns.

import { bareAccount } from "./donationmath.js";
import { EARLY_POPUP_CLASS } from "./earlypopup.js";
import { profileSwapOf, swapOfferFromProfile, fetchSwapToken, createSwapStats, paintSwapStats } from "./swapoffer.js";
import { swapHttpsLink } from "./server/swaptoken.js";

const lookups = new Map();
// Watcher function to its bubble, so a sweep can drop detached bubbles
// without calling sync() and holding the DOM until the next profile load.
const watchers = new Map();
let watching = false;
let sweepTimer = null;
let openClan = null;
let seq = 0;
let clanSwapOpen = null;

// swapsheet pulls the wallet in at load. A static import here would cycle
// through the profile builder, so the Buy button loads it on the first tap.
function openClanSwapSheet(details) {
  const flight = clanSwapOpen || import("./swapsheet.js").then((mod) => {
    clanSwapOpen = mod.openSwapSheet;
    return clanSwapOpen;
  });
  return Promise.resolve(flight).then((open) => open(details));
}

const WATCH_SWEEP_MS = 30000;

function stopWatcherSweep() {
  if (sweepTimer == null) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}

// One pass over bubbles that have left the page. The timer runs only while
// at least one bubble is still watched.
export function sweepClanWatchers() {
  for (const [tick, bubble] of watchers) {
    if (bubble && bubble.isConnected) continue;
    watchers.delete(tick);
  }
  if (watchers.size === 0) stopWatcherSweep();
}

export function clanWatcherCount() {
  return watchers.size;
}

function startWatcherSweep() {
  if (sweepTimer != null || watchers.size === 0) return;
  sweepTimer = setInterval(sweepClanWatchers, WATCH_SWEEP_MS);
  if (sweepTimer && typeof sweepTimer.unref === "function") sweepTimer.unref();
}

// profiles-loaded, and the detached-bubble sweep, share this pass.
export function refreshClanWatchers() {
  sweepClanWatchers();
  for (const tick of [...watchers.keys()]) tick();
}

export function clanOfferOf(swaps, author) {
  return swapOfferFromProfile(profileSwapOf(swaps, author));
}

// null when there is nothing to show. A missing icon still returns the symbol.
export function clanChipModel(token) {
  if (!token || typeof token !== "object") return null;
  const symbol = typeof token.symbol === "string" ? token.symbol.trim() : "";
  if (!symbol) return null;
  return { symbol, icon: swapHttpsLink(token.icon) };
}

export function clanTagLabel(symbol) {
  return "Clan tag: " + symbol + ", show token";
}

// One flight per token. The default cache is the module map, so every bubble
// shares it. A token body stays cached. Null or a throw is dropped, so the
// next profiles-loaded event or bubble can retry. fetchSwapToken still keeps
// a hit for the rest of the app.
export function clanTokenLookup(tokenId, fetchToken = fetchSwapToken, cache = lookups) {
  const id = bareAccount(tokenId);
  if (!id) return Promise.resolve(null);
  const hit = cache.get(id);
  if (hit) return hit;
  const run = Promise.resolve()
    .then(() => fetchToken(id))
    .then((body) => {
      const token = body && typeof body === "object" ? body : null;
      if (!token && cache.get(id) === run) cache.delete(id);
      return token;
    })
    .catch(() => {
      if (cache.get(id) === run) cache.delete(id);
      return null;
    });
  cache.set(id, run);
  return run;
}

function prefersReduced() {
  return !!(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function watchProfiles(fn, bubble) {
  if (typeof document !== "undefined" && !watching) {
    watching = true;
    document.addEventListener("profiles-loaded", () => {
      refreshClanWatchers();
    });
  }
  watchers.set(fn, bubble);
  startWatcherSweep();
  return () => {
    watchers.delete(fn);
    if (watchers.size === 0) stopWatcherSweep();
  };
}

function closeClan(state, immediate) {
  if (!state) return;
  state.open = false;
  state.button.setAttribute("aria-expanded", "false");
  if (openClan === state) openClan = null;
  const node = state.card;
  if (!node || !node.isConnected) return;
  if (immediate || prefersReduced()) {
    node.remove();
    return;
  }
  node.classList.remove("is-open");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (!state.open) node.remove();
  };
  node.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 400);
}

// Paint nothing until a lookup returns a symbol. Authors without Swap never
// get a row, a chip, or a card. The watcher stays while the bubble is
// connected. A later tick removes or replaces the chip when that Swap token
// changes or is turned off.
export function mountClanTag({ bubble, payerLink, payer, swaps, viewer, openSwap, createCard, paintToken, paintLinks }) {
  if (!bubble || !payerLink || typeof createCard !== "function") return;
  const swapsOf = typeof swaps === "function" ? swaps : () => swaps;
  let armed = false;
  let forget = () => {};
  let paintedId = "";
  let pendingId = "";
  let flight = 0;
  let row = null;
  let chip = null;

  function clearChip() {
    if (chip) {
      closeClan(chip, true);
      chip = null;
    }
    const held = row;
    row = null;
    paintedId = "";
    if (!held) return;
    const h2 = held.parentElement;
    const names = held.querySelector(".payer-names");
    const username = names && names.querySelector(".username");
    if (h2) {
      if (username) h2.append(username);
      h2.append(payerLink);
    }
    held.remove();
  }

  function sync() {
    if (armed && !bubble.isConnected) {
      forget();
      return;
    }
    const offer = clanOfferOf(swapsOf(), payer);
    const nextId = offer ? offer.tokenId : "";
    if (!nextId && !paintedId && !chip) return;
    if (nextId && (nextId === paintedId || nextId === pendingId)) return;
    const generation = ++flight;
    pendingId = nextId;
    if (chip || row) clearChip();
    if (!offer) {
      pendingId = "";
      return;
    }
    clanTokenLookup(offer.tokenId).then((token) => {
      if (generation !== flight || !bubble.isConnected) return;
      const model = clanChipModel(token);
      if (pendingId === nextId && !model) pendingId = "";
      if (!model) return;
      const current = clanOfferOf(swapsOf(), payer);
      if (!current || current.tokenId !== nextId) {
        if (pendingId === nextId) pendingId = "";
        return;
      }
      placeChip(model, token, nextId);
      if (pendingId === nextId) pendingId = "";
    });
  }

  function placeChip(model, token, tokenId) {
    const id = "clan-token-" + (++seq);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clan-tag";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", id);
    button.setAttribute("aria-label", clanTagLabel(model.symbol));
    if (model.icon) {
      const img = document.createElement("img");
      img.className = "clan-tag-icon";
      img.alt = "";
      img.src = model.icon;
      img.addEventListener("error", () => {
        img.hidden = true;
        img.removeAttribute("src");
      });
      button.append(img);
    }
    const symbol = document.createElement("span");
    symbol.className = "clan-tag-symbol";
    symbol.textContent = model.symbol;
    button.append(symbol);

    const h2 = payerLink.parentElement;
    if (!h2) return;
    const names = document.createElement("span");
    names.className = "payer-names";
    const username = h2.querySelector(".username");
    if (username) names.append(username);
    names.append(payerLink);
    row = document.createElement("span");
    row.className = "payer-row";
    row.append(names, button);
    h2.append(row);

    const state = { button, card: null, open: false };
    chip = state;
    paintedId = tokenId;
    const openSheet = typeof openSwap === "function" ? openSwap : openClanSwapSheet;
    function buildCard() {
      const wrap = document.createElement("div");
      wrap.className = "clan-token";
      wrap.id = id;
      const clip = document.createElement("div");
      clip.className = "clan-token-clip";
      const inner = createCard();
      paintToken(inner, token);
      paintLinks(inner.querySelector(".swap-links"), token && token.links);
      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "clan-buy";
      buy.textContent = "Buy";
      buy.setAttribute("aria-label", "Buy " + model.symbol);
      const links = inner.querySelector(".swap-links");
      if (links && typeof links.before === "function") links.before(buy);
      else inner.append(buy);
      let opening = false;
      buy.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (opening) return;
        opening = true;
        buy.setAttribute("aria-busy", "true");
        const current = clanOfferOf(swapsOf(), payer);
        const me = bareAccount(typeof viewer === "function" ? viewer() : viewer);
        const them = bareAccount(payer);
        const own = !!(me && them && me === them);
        const details = {
          account: bareAccount(payer),
          tokenId: (current && current.tokenId) || bareAccount(token && token.tokenId) || "",
          feeBps: current && !own ? current.feeBps : 0,
          symbol: typeof token.symbol === "string" ? token.symbol : "",
          dueDiligenceComplete: !!(token && token.dueDiligenceComplete === true),
          icon: token && token.icon ? token.icon : "",
          links: token && token.links ? token.links : null,
          stats: token && token.stats ? token.stats : null,
          host: typeof bubble.closest === "function" ? bubble.closest("." + EARLY_POPUP_CLASS) : null,
          opener: buy,
        };
        let pending;
        try {
          pending = openSheet(details);
        } catch (err) {
          pending = Promise.reject(err);
        }
        Promise.resolve(pending).finally(() => {
          opening = false;
          buy.removeAttribute("aria-busy");
        });
      });
      buy.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      const stats = createSwapStats();
      paintSwapStats(stats, token);
      clip.append(inner, stats);
      wrap.append(clip);
      wrap.addEventListener("click", (event) => event.stopPropagation());
      wrap.addEventListener("pointerdown", (event) => event.stopPropagation());
      return wrap;
    }
    function openCard() {
      if (openClan && openClan !== state) closeClan(openClan, false);
      if (!state.card) state.card = buildCard();
      if (!bubble.parentElement) return;
      bubble.after(state.card);
      state.open = true;
      button.setAttribute("aria-expanded", "true");
      openClan = state;
      if (prefersReduced()) {
        state.card.classList.add("is-open");
        return;
      }
      state.card.classList.remove("is-open");
      requestAnimationFrame(() => {
        if (state.open && state.card) state.card.classList.add("is-open");
      });
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.open) closeClan(state, false);
      else openCard();
    });
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
  }

  forget = watchProfiles(sync, bubble);
  sync();
  queueMicrotask(() => {
    armed = true;
  });
}
