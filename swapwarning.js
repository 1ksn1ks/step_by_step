// One-time Swap warning. The card uses the intro classes in onboarding.js
// (style.css). A missing or throwing localStorage shows it on every tap.

const ACK_KEY = "swap-warning-v1";

const PARAS = [
  "Hedera Globe doesn't endorse, review or recommend any token, creator or trade.",
  "Swaps run on SaucerSwap through your own wallet. We never hold your funds.",
  "You're responsible for checking that what you do here is legal where you live.",
];

let pending = null;

function jar() {
  try {
    const store = globalThis.localStorage;
    if (!store || typeof store.getItem !== "function" || typeof store.setItem !== "function") return null;
    return store;
  } catch {
    return null;
  }
}

function alreadyAcked() {
  const store = jar();
  if (!store) return false;
  try {
    const value = store.getItem(ACK_KEY);
    return value != null && value !== "";
  } catch {
    return false;
  }
}

function writeAck() {
  const store = jar();
  if (!store) return false;
  try {
    store.setItem(ACK_KEY, String(Date.now()));
    return store.getItem(ACK_KEY) != null;
  } catch {
    return false;
  }
}

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

// Same open and close as the intro overlay. Reduced motion skips both.
function mountWarning(doc, returnTo) {
  const back = canFocus(returnTo) ? returnTo : (canFocus(doc.activeElement) ? doc.activeElement : null);
  const overlay = doc.createElement("div");
  overlay.className = "onboard-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "swap-warning-title");

  const scrim = doc.createElement("div");
  scrim.className = "onboard-scrim";

  const card = doc.createElement("div");
  card.className = "onboard-card";

  const title = doc.createElement("h3");
  title.className = "onboard-title";
  title.id = "swap-warning-title";
  title.textContent = "Before you swap";

  const bodies = PARAS.map((text) => {
    const para = doc.createElement("p");
    para.className = "onboard-body";
    para.textContent = text;
    return para;
  });

  const notNow = doc.createElement("button");
  notNow.type = "button";
  notNow.className = "onboard-prev";
  notNow.textContent = "Not now";

  const accept = doc.createElement("button");
  accept.type = "button";
  accept.className = "onboard-next";
  accept.textContent = "I understand";

  const nav = doc.createElement("div");
  nav.className = "onboard-nav";
  nav.append(notNow, accept);
  card.append(title, ...bodies, nav);
  overlay.append(scrim, card);

  let settled = false;
  let resolveAck = () => {};
  const promise = new Promise((resolve) => {
    resolveAck = resolve;
  });

  const finish = (accepted) => {
    if (settled) return;
    settled = true;
    doc.removeEventListener("keydown", onKey, true);
    if (accepted) writeAck();
    const remove = () => {
      if (typeof overlay.remove === "function") overlay.remove();
      if (pending === promise) pending = null;
      focusNode(back);
      resolveAck(!!accepted);
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
    const items = [notNow, accept];
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
  accept.addEventListener("click", (event) => {
    stop(event);
    finish(true);
  });
  doc.addEventListener("keydown", onKey, true);

  doc.body.appendChild(overlay);
  if (!reducedMotion()) {
    play(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-out" });
    play(card, [
      { opacity: 0, transform: "translate(-50%, -50%) scale(0.9)" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
    ], { duration: 300, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  }
  focusNode(accept);
  return promise;
}

// true when the sheet may open. false when the person dismisses the warning.
// A second call while the window is up waits on the same promise.
export function ensureSwapAck(returnTo) {
  if (alreadyAcked()) return Promise.resolve(true);
  if (pending) return pending;
  const doc = globalThis.document;
  if (!doc || typeof doc.createElement !== "function" || !doc.body) return Promise.resolve(false);
  pending = mountWarning(doc, returnTo);
  return pending;
}
