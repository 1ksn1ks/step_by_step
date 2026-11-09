// Screen corners: how round a full-screen popup's frame is where it meets
// the screen's own corners (popupanim.js sets --screen-r-top/-bottom from
// this; style.css rounds the frame and steps the footer in).
//
// No browser tells a page how round its screen's corners are. iPhones come
// in a few sizes with known corners, so Auto knows them. On any other
// phone Auto keeps the frame's own corners, and Settings > Popups > Screen
// corners lets you set yours by eye: while the slider moves, a cyan line
// traces the screen's edge with that roundness. Kept on this device only
// (localStorage), not with the account: one account can be on phones with
// different corners. Android only gives the real radius to native apps.

const KEY = 'meritocracy-screen-corners';
export const SCREEN_CORNER_MAX = 72;
const GUIDE_MS = 1400;

// CSS px by the screen's size in points, as measured by the community
// (Apple does not publish them). Where two models share a size the rounder
// one is used: a frame a hair inside the curve beats one the curve cuts.
const IPHONE_CORNERS = {
  '375x812': 44, // X, XS, 11 Pro (39) · 12 mini, 13 mini (44)
  '414x896': 41.5, // XR, 11 (41.5) · XS Max, 11 Pro Max (39)
  '390x844': 47.33, // 12, 12 Pro, 13, 13 Pro, 14, 16e
  '428x926': 53.33, // 12 Pro Max, 13 Pro Max, 14 Plus
  '393x852': 55, // 14 Pro, 15, 15 Pro, 16
  '430x932': 55, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  '402x874': 62, // 16 Pro, 17, 17 Pro
  '420x912': 62, // Air
  '440x956': 62, // 16 Pro Max, 17 Pro Max
};

function iphoneCorner() {
  if (!/iPhone|iPod/.test(navigator.userAgent || '')) return 0;
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  const known = IPHONE_CORNERS[`${w}x${h}`];
  if (known) return known;
  return h >= 812 ? 55 : 0; // a newer model: about that; a Home-button iPhone: square
}

// Auto's radius on this device, 0 when none is known. 2px past an
// iPhone's nominal radius: Apple's corners are a continuous curve, a
// little tighter than a circle along the diagonal.
export function autoScreenCorner() {
  const corner = iphoneCorner();
  return corner ? corner + 2 : 0;
}

function readManual() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null || raw === '') return null;
    const px = Number(raw);
    return Number.isFinite(px) && px >= 0 ? Math.min(px, SCREEN_CORNER_MAX) : null;
  } catch {
    return null; // private mode: Auto
  }
}

let manual = readManual();

// { px, manual }: the radius to use, and whether it was set by hand (a
// hand-set one also rounds a bottom edge that reports no safe area, as
// most Android phones do).
export function screenCorner() {
  return manual != null
    ? { px: manual, manual: true }
    : { px: autoScreenCorner(), manual: false };
}

function setManual(px) {
  manual = px == null ? null : Math.max(0, Math.min(SCREEN_CORNER_MAX, Math.round(Number(px) || 0)));
  try {
    if (manual == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(manual));
  } catch { /* this visit only */ }
  // popupanim.js repaints the frame vars; then the guide reads them.
  window.dispatchEvent(new Event('screen-corners-changed'));
  paintControl();
  showGuide();
}

// The cyan line along the screen's edge, with the corners a popup now
// gets: the bottom ones at this radius, the top ones only where the page
// reaches the screen's top (--screen-r-top).
let guide = null;
let guideTimer = 0;
function showGuide() {
  if (!guide) {
    guide = document.createElement('div');
    guide.id = 'screen-corner-guide';
    guide.setAttribute('aria-hidden', 'true');
    document.body.appendChild(guide);
  }
  const root = getComputedStyle(document.documentElement);
  const bottom = root.getPropertyValue('--screen-r-bottom').trim() || '0px';
  const top = root.getPropertyValue('--screen-r-top').trim() || '0px';
  guide.style.borderRadius = `${top} ${top} ${bottom} ${bottom}`;
  guide.classList.add('is-on');
  clearTimeout(guideTimer);
  guideTimer = setTimeout(() => guide.classList.remove('is-on'), GUIDE_MS);
}

let input = null;
let pill = null;
let autoBtn = null;

function paintControl() {
  if (!input) return;
  const { px, manual: byHand } = screenCorner();
  input.value = String(Math.round(px));
  pill.textContent = byHand ? `${Math.round(px)} px` : 'Auto';
  autoBtn.hidden = !byHand;
}

function bindControl() {
  input = document.getElementById('screen-corners');
  pill = document.getElementById('screen-corners-pill');
  autoBtn = document.getElementById('screen-corners-auto');
  if (!input || !pill || !autoBtn) return;
  input.max = String(SCREEN_CORNER_MAX);
  paintControl();
  input.addEventListener('input', () => setManual(input.value));
  // A tap on the slider without moving it still shows where the line is.
  input.addEventListener('pointerdown', () => showGuide());
  autoBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    setManual(null);
  });
}

bindControl();
