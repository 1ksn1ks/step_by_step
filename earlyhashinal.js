// Gold-purple ring for accounts that hold one of the first 1000 Hashinals.
// The fetch starts after the globe has drawn and never blocks a paint.
import { map } from "./map.js";

const REFRESH_MS = 15 * 60 * 1000;
const TIP = "Early Hashinal holder #";

let owners = new Map();
let armed = false;

export function earlyHashinalNumber(account) {
  if (typeof account !== "string" || !account) return 0;
  const n = owners.get(account);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function tipFor(n) {
  return TIP + n;
}

function syncProfileRing(img) {
  const n = earlyHashinalNumber(img.dataset.earlyAccount || "");
  const parent = img.parentElement;
  const wrapped = !!(parent && parent.classList.contains("early-hashinal"));
  if (!n) {
    if (wrapped) parent.replaceWith(img);
    return;
  }
  const tip = tipFor(n);
  let shell = wrapped ? parent : null;
  if (!shell) {
    if (!img.parentNode) return;
    shell = document.createElement("span");
    shell.className = "early-hashinal";
    shell.tabIndex = 0;
    img.replaceWith(shell);
    shell.appendChild(img);
  }
  shell.dataset.tip = tip;
  shell.title = tip;
  shell.setAttribute("aria-label", tip);
  let glow = shell.querySelector(":scope > .early-hashinal-glow");
  if (!glow) {
    glow = document.createElement("span");
    glow.className = "early-hashinal-glow";
    glow.setAttribute("aria-hidden", "true");
    shell.insertBefore(glow, shell.firstChild);
  }
}

export function paintProfileAvatar(img, account) {
  if (!img) return;
  img.dataset.earlyAccount = typeof account === "string" ? account : "";
  if (img.parentNode) syncProfileRing(img);
}

function repaintProfiles() {
  const nodes = document.querySelectorAll("img[data-early-account]");
  for (const img of nodes) {
    if (img.isConnected) syncProfileRing(img);
  }
}

document.addEventListener("early-hashinals", repaintProfiles);

function applyOwners(body) {
  const raw = body && body.owners;
  if (!raw || typeof raw !== "object") return;
  const next = new Map();
  for (const [id, value] of Object.entries(raw)) {
    const n = typeof value === "number" ? value : Number(value);
    if (/^0\.0\.\d+$/.test(id) && Number.isInteger(n) && n > 0) next.set(id, n);
  }
  owners = next;
  document.dispatchEvent(new Event("early-hashinals"));
}

function pull() {
  fetch("/api/early-hashinals", { headers: { accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      if (body) applyOwners(body);
    })
    .catch(() => {});
}

function arm() {
  if (armed) return;
  armed = true;
  pull();
  setInterval(pull, REFRESH_MS);
}

if (map.loaded()) arm();
else map.on("load", arm);
