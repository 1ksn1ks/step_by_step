// Clan tag on a profile bubble. A chip shows only when that author's profile
// Swap (bio topic 0.0.9759201) is on and names a real token. The token body
// comes from the shared /api/swap/token lookup, once per token, then every
// bubble by that author reuses it. The bubble is painted first; the chip is
// added when the lookup returns.

import { bareAccount } from "./donationmath.js";
import { profileSwapOf, swapOfferFromProfile, fetchSwapToken } from "./swapoffer.js";
import { swapHttpsLink } from "./server/swaptoken.js";

const lookups = new Map();
const watchers = new Set();
let watching = false;
let openClan = null;
let seq = 0;

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

// One flight per token, including a failed lookup. The default cache is the
// module map, so every bubble shares it. fetchSwapToken still keeps a hit
// for the rest of the app.
export function clanTokenLookup(tokenId, fetchToken = fetchSwapToken, cache = lookups) {
  const id = bareAccount(tokenId);
  if (!id) return Promise.resolve(null);
  const hit = cache.get(id);
  if (hit) return hit;
  const run = Promise.resolve()
    .then(() => fetchToken(id))
    .then((body) => (body && typeof body === "object" ? body : null))
    .catch(() => null);
  cache.set(id, run);
  return run;
}

function prefersReduced() {
  return !!(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function watchProfiles(fn) {
  if (typeof document !== "undefined" && !watching) {
    watching = true;
    document.addEventListener("profiles-loaded", () => {
      for (const tick of [...watchers]) tick();
    });
  }
  watchers.add(fn);
  return () => watchers.delete(fn);
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
// get a row, a chip, or a card.
export function mountClanTag({ bubble, payerLink, payer, swaps, createCard, paintToken, paintLinks }) {
  if (!bubble || !payerLink || typeof createCard !== "function") return;
  const swapsOf = typeof swaps === "function" ? swaps : () => swaps;
  let started = false;
  let armed = false;
  let forget = () => {};

  function sync() {
    if (started) return;
    if (armed && !bubble.isConnected) {
      forget();
      return;
    }
    const offer = clanOfferOf(swapsOf(), payer);
    if (!offer) return;
    started = true;
    forget();
    clanTokenLookup(offer.tokenId).then((token) => {
      if (!bubble.isConnected) return;
      const model = clanChipModel(token);
      if (!model) return;
      placeChip(model, token);
    });
  }

  function placeChip(model, token) {
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

    const row = document.createElement("span");
    row.className = "payer-row";
    payerLink.replaceWith(row);
    row.append(payerLink, button);

    const state = { button, card: null, open: false };
    function buildCard() {
      const wrap = document.createElement("div");
      wrap.className = "clan-token";
      wrap.id = id;
      const clip = document.createElement("div");
      clip.className = "clan-token-clip";
      const inner = createCard();
      paintToken(inner, token);
      paintLinks(inner.querySelector(".swap-links"), token && token.links);
      clip.append(inner);
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

  forget = watchProfiles(sync);
  sync();
  queueMicrotask(() => {
    armed = true;
  });
}
