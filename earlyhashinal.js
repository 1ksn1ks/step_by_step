// Gold-purple ring for accounts that hold one of the first 1000 Hashinals.
// The fetch starts after the globe has drawn and never blocks a paint.
import { map } from "./map.js";
import { forgetTilt, watchProfilePicture } from "./markertilt.js";

const REFRESH_MS = 15 * 60 * 1000;

let owners = new Map();
let ownersReady = false;
let armed = false;
const ownerListeners = new Set();

export function earlyHashinalNumber(account) {
  if (typeof account !== "string" || !account) return 0;
  const n = owners.get(account);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// True after the first owners response, including an empty or failed pull.
// Until then every number is 0 because the map has not been filled.
export function earlyHashinalReady() {
  return ownersReady;
}

export function onOwnersChange(fn) {
  if (typeof fn !== "function") return () => {};
  ownerListeners.add(fn);
  return () => ownerListeners.delete(fn);
}

function settleOwners() {
  ownersReady = true;
  for (const fn of ownerListeners) {
    try { fn(); } catch { /* a listener cannot block the next paint */ }
  }
}

function ensureSpin(shell) {
  let spin = shell.querySelector(":scope > .early-hashinal-spin");
  if (!spin) {
    spin = document.createElement("span");
    spin.className = "early-hashinal-spin";
    spin.setAttribute("aria-hidden", "true");
    shell.insertBefore(spin, shell.firstChild);
  }
  return spin;
}

function syncPopupBubbleRing(bubble, early) {
  bubble.classList.toggle("early", early);
  let spin = bubble.querySelector(":scope > .popup-early-spin");
  if (!early) {
    if (spin) spin.remove();
    return;
  }
  if (spin) return;
  spin = document.createElement("span");
  spin.className = "popup-early-spin";
  spin.setAttribute("aria-hidden", "true");
  bubble.prepend(spin);
}

function gifStillNode(img) {
  const prev = img && img.previousElementSibling;
  if (prev && prev.classList && prev.classList.contains("media-still")) return prev;
  return null;
}

function unwrapRing(parent, img) {
  const still = gifStillNode(img);
  forgetTilt(parent);
  parent.replaceWith(img);
  if (still && img.parentNode) img.parentNode.insertBefore(still, img);
}

function syncProfileRing(img) {
  const n = earlyHashinalNumber(img.dataset.earlyAccount || "");
  const parent = img.parentElement;
  const wrapped = !!(parent && parent.classList.contains("early-hashinal"));
  const bubble = img.closest(".popup-profile-bubble");
  // The profile pill wears the ring. Marker and list avatars keep theirs.
  // The picture leans on its own. A wrapped avatar ring leans with it.
  if (bubble) {
    if (wrapped) unwrapRing(parent, img);
    syncPopupBubbleRing(bubble, n > 0);
    watchProfilePicture(img);
    return;
  }
  if (!n) {
    if (wrapped) unwrapRing(parent, img);
    watchProfilePicture(img);
    return;
  }
  let shell = wrapped ? parent : null;
  if (!shell) {
    if (!img.parentNode) return;
    const still = gifStillNode(img);
    forgetTilt(img);
    shell = document.createElement("span");
    shell.className = "early-hashinal";
    img.replaceWith(shell);
    if (still) shell.appendChild(still);
    shell.appendChild(img);
  }
  delete shell.dataset.tip;
  shell.removeAttribute("title");
  shell.removeAttribute("aria-label");
  shell.removeAttribute("tabindex");
  ensureSpin(shell);
  let glow = shell.querySelector(":scope > .early-hashinal-glow");
  if (!glow) {
    glow = document.createElement("span");
    glow.className = "early-hashinal-glow";
    glow.setAttribute("aria-hidden", "true");
    shell.insertBefore(glow, shell.firstChild);
  }
  watchProfilePicture(img);
}

export function paintProfileAvatar(img, account) {
  if (!img) return;
  img.dataset.earlyAccount = typeof account === "string" ? account : "";
  if (img.parentNode) syncProfileRing(img);
}

function repaintProfiles() {
  const nodes = document.querySelectorAll("img[data-early-account], video.loop-face[data-early-account]");
  for (const img of nodes) {
    if (img.isConnected) syncProfileRing(img);
  }
}

document.addEventListener("early-hashinals", repaintProfiles);

function applyOwners(body) {
  const raw = body && body.owners;
  if (!raw || typeof raw !== "object") {
    settleOwners();
    return;
  }
  const next = new Map();
  for (const [id, value] of Object.entries(raw)) {
    const n = typeof value === "number" ? value : Number(value);
    if (/^0\.0\.\d+$/.test(id) && Number.isInteger(n) && n > 0) next.set(id, n);
  }
  owners = next;
  document.dispatchEvent(new Event("early-hashinals"));
  settleOwners();
}

function pull() {
  fetch("/api/early-hashinals", { headers: { accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      if (body) applyOwners(body);
      else settleOwners();
    })
    .catch(() => settleOwners());
}

function arm() {
  if (armed) return;
  armed = true;
  pull();
  setInterval(pull, REFRESH_MS);
}

if (map.loaded()) arm();
else map.on("load", arm);

// Endless rings pause once they leave the viewport. A hidden document and
// the feed overlay (html.feed-app) also set html.eh-hidden: intersection
// still reports the covered map as on screen. Donate is not watched: its
// entrance and the ring share one animation, and pausing the card would
// freeze the sheet below the screen.
const EARLY_MOTION_HOST = [
  ".early-hashinal",
  ".maplibregl-popup.early-holder-popup",
  ".popup-profile-bubble.early",
  ".post-menu-pop[data-style='hashinals']",
  ".marker-title-tip.early",
  ".early-holder-card .profile-live-bubble",
  ".feed-card.early-holder-popup",
  "#feed-profile .feed-profile-identity.early-holder-card",
  "#feed-profile.early-holder-card .feed-profile-row:has(> a.feed-profile-value)",
].join(",");

const earlyMotionSeen = new WeakSet();
const earlyMotionIn = new WeakMap();
const earlyMotionList = new Set();
let earlyMotionIo = null;
let earlyMotionBooted = false;
let earlyDocHidden = false;

function likelyHostNode(el) {
  const id = el.id;
  if (id === "feed-profile" || id === "profile-live-preview") return true;
  const raw = el.className;
  const cls = typeof raw === "string" ? raw : "";
  if (cls) {
    if (cls.indexOf("early") !== -1) return true;
    if (cls.indexOf("feed-card") !== -1) return true;
    if (cls.indexOf("feed-profile") !== -1) return true;
    if (cls.indexOf("popup-profile") !== -1) return true;
    if (cls.indexOf("post-menu") !== -1) return true;
    if (cls.indexOf("marker-title") !== -1) return true;
    if (cls.indexOf("marker-face") !== -1) return true;
    if (cls.indexOf("profile-live") !== -1) return true;
    if (cls.indexOf("maplibregl-popup") !== -1) return true;
  }
  return !!(el.getAttribute && el.getAttribute("data-style") === "hashinals");
}

// Cheap walk. matches(EARLY_MOTION_HOST) is the expensive check, and it
// includes :has(). Skip a target that is not the host or inside one.
function insideLikelyHost(el) {
  let node = el;
  while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
    if (likelyHostNode(node)) return true;
    node = node.parentElement;
  }
  return false;
}

function applyEarlyOff(el) {
  if (!el || !el.classList) return;
  const off = document.hidden || earlyMotionIn.get(el) === false;
  if (el.classList.contains("eh-off") !== off) el.classList.toggle("eh-off", off);
}

function syncEarlyHidden() {
  const root = document.documentElement;
  if (!root) return;
  const hidden = !!document.hidden;
  root.classList.toggle("eh-hidden", hidden || root.classList.contains("feed-app"));
  if (hidden === earlyDocHidden) return;
  earlyDocHidden = hidden;
  for (const el of earlyMotionList) applyEarlyOff(el);
}

function watchEarlyMotion(el) {
  if (!el || el.nodeType !== 1 || !el.isConnected || !earlyMotionIo) return;
  if (earlyMotionSeen.has(el)) return;
  if (!insideLikelyHost(el)) return;
  if (!el.matches(EARLY_MOTION_HOST)) return;
  earlyMotionSeen.add(el);
  earlyMotionList.add(el);
  earlyMotionIo.observe(el);
  if (document.hidden) applyEarlyOff(el);
}

function releaseEarlyMotion(el) {
  if (!el || !earlyMotionSeen.has(el)) return;
  earlyMotionSeen.delete(el);
  earlyMotionList.delete(el);
  earlyMotionIn.delete(el);
  earlyMotionIo.unobserve(el);
  el.classList.remove("eh-off");
}

function forgetEarlyMotion(node) {
  if (!node || node.nodeType !== 1) return;
  releaseEarlyMotion(node);
  if (!node.querySelectorAll) return;
  const inner = node.querySelectorAll(EARLY_MOTION_HOST);
  for (let i = 0; i < inner.length; i += 1) releaseEarlyMotion(inner[i]);
}

function syncEarlyMotionClass(el, oldValue) {
  if (!el || el.nodeType !== 1) return;
  if (el.matches(EARLY_MOTION_HOST)) watchEarlyMotion(el);
  else releaseEarlyMotion(el);
  const now = !!(el.classList && el.classList.contains("early-holder-card"));
  const was = typeof oldValue === "string" && oldValue.split(/\s+/).indexOf("early-holder-card") !== -1;
  if (!now && !was) return;
  if (!el.querySelectorAll) return;
  const kids = el.querySelectorAll(".profile-live-bubble, .feed-profile-identity, .feed-profile-row");
  for (let i = 0; i < kids.length; i += 1) {
    const child = kids[i];
    if (child.matches(EARLY_MOTION_HOST)) watchEarlyMotion(child);
    else releaseEarlyMotion(child);
  }
}

function bootEarlyMotion() {
  if (earlyMotionBooted || typeof document === "undefined" || !document.documentElement) return;
  earlyMotionBooted = true;
  const root = document.documentElement;
  const trackHosts = typeof IntersectionObserver === "function";
  document.addEventListener("visibilitychange", syncEarlyHidden);
  if (trackHosts) {
    earlyMotionIo = new IntersectionObserver((entries) => {
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const el = entry.target;
        if (!earlyMotionSeen.has(el)) continue;
        earlyMotionIn.set(el, !!entry.isIntersecting);
        applyEarlyOff(el);
      }
    });
  }
  const mo = new MutationObserver((records) => {
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (rec.type === "childList") {
        if (!trackHosts) continue;
        const removed = rec.removedNodes;
        for (let r = 0; r < removed.length; r += 1) forgetEarlyMotion(removed[r]);
        const added = rec.addedNodes;
        for (let a = 0; a < added.length; a += 1) {
          const node = added[a];
          if (!node || node.nodeType !== 1 || !insideLikelyHost(node)) continue;
          watchEarlyMotion(node);
          if (!node.querySelectorAll) continue;
          const inner = node.querySelectorAll(EARLY_MOTION_HOST);
          for (let n = 0; n < inner.length; n += 1) watchEarlyMotion(inner[n]);
        }
      } else if (rec.type === "attributes") {
        if (rec.target === root) {
          if (rec.attributeName === "class") syncEarlyHidden();
          continue;
        }
        if (!trackHosts) continue;
        if (!insideLikelyHost(rec.target) && !earlyMotionSeen.has(rec.target)) continue;
        syncEarlyMotionClass(rec.target, rec.attributeName === "class" ? rec.oldValue : "");
      }
    }
  });
  mo.observe(root, {
    childList: trackHosts,
    subtree: trackHosts,
    attributes: true,
    attributeFilter: trackHosts ? ["class", "data-style"] : ["class"],
    attributeOldValue: trackHosts,
  });
  if (trackHosts) {
    const found = document.querySelectorAll(EARLY_MOTION_HOST);
    for (let i = 0; i < found.length; i += 1) watchEarlyMotion(found[i]);
  }
  syncEarlyHidden();
}

bootEarlyMotion();
