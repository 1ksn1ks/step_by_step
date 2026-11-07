// livegroups.js — whose live posts the map shows, and the dropdown that
// picks it.
//
// One choice at a time, kept across visits: Everyone; Following (the
// accounts this wallet follows, the feed's Following); NFT holders (Early
// Hashinal holders, the feed's filter of that name); Mine. localnews.js
// filters the live markers by it.
//
// The dropdown opens from "📡 Look for Live" on the map's hold / right-click
// pin (poiinfo.js): hold it on a phone, right-click it on a PC. It also
// opens from the group pill on the live bar (localnews.js). A row picks the
// group; Escape, a tap anywhere else, moving the map and Back close it.
// Light on purpose: poiinfo.js loads it with the map, localnews.js later.
import { map } from './map.js';

export const LIVE_GROUPS = [
  ['all', 'Everyone', 'Every live post here'],
  ['following', 'Following', 'Accounts you follow'],
  ['holders', 'NFT holders', 'Early Hashinal holders'],
  ['mine', 'Mine', 'Your own posts'],
];
const KEY = 'meritocracy-live-group';
let current = readGroup();

function readGroup() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LIVE_GROUPS.some(([key]) => key === saved)) return saved;
  } catch { /* private mode: Everyone */ }
  return 'all';
}

export function liveGroup() {
  return current;
}

export function liveGroupName(key = current) {
  const group = LIVE_GROUPS.find(([k]) => k === key);
  return group ? group[1] : LIVE_GROUPS[0][1];
}

// false for a key that is not a group.
export function setLiveGroup(key) {
  if (!LIVE_GROUPS.some(([k]) => k === key)) return false;
  current = key;
  try { localStorage.setItem(KEY, key); } catch { /* this visit only */ }
  return true;
}

// ── The dropdown ───────────────────────────────────────────────────────
let menu = null;
const rows = new Map(); // key -> row button
let openFor = null; // { anchor, onPick }
let layerDefined = false;

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function ensureLayer() {
  if (layerDefined || !window.defineLayer) return;
  layerDefined = true;
  // Forward cannot bring it back (its button may be gone): Back closes it.
  window.defineLayer('livegroups', {
    open: () => {},
    close: () => closeLiveGroupMenu({ fromHistory: true }),
  });
}

function buildMenu() {
  menu = document.createElement('div');
  menu.className = 'live-group-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Whose live posts');

  const head = document.createElement('div');
  head.className = 'live-group-menu-head';
  const dot = document.createElement('span');
  dot.className = 'live-filter-dot';
  dot.setAttribute('aria-hidden', 'true');
  head.append(dot, document.createTextNode('Live posts from'));
  menu.appendChild(head);

  for (const [key, name, hint] of LIVE_GROUPS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'live-group-menu-row';
    row.setAttribute('role', 'menuitemradio');
    row.dataset.group = key;
    const text = document.createElement('span');
    text.className = 'live-group-menu-text';
    const nameEl = document.createElement('span');
    nameEl.className = 'live-group-menu-name';
    nameEl.textContent = name;
    const hintEl = document.createElement('span');
    hintEl.className = 'live-group-menu-hint';
    hintEl.textContent = hint;
    text.append(nameEl, hintEl);
    const check = document.createElement('span');
    check.className = 'live-group-menu-check';
    check.innerHTML = CHECK;
    row.append(text, check);
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      pick(key);
    });
    rows.set(key, row);
    menu.appendChild(row);
  }

  // The document click closes panels and the map pin; the menu keeps itself.
  menu.addEventListener('click', (event) => event.stopPropagation());
  menu.addEventListener('pointerdown', (event) => event.stopPropagation());
  menu.addEventListener('contextmenu', (event) => event.preventDefault());
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = [...rows.values()];
    const at = list.indexOf(document.activeElement);
    event.preventDefault();
    const next = at < 0 ? 0 : (at + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
    list[next].focus();
  });
  document.body.appendChild(menu);

  // Escape closes the list only, not the pin or panel it drops from,
  // wherever the focus is (a phone does not move it into the list).
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !openFor) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = openFor.anchor;
    const hadFocus = menu.contains(document.activeElement);
    closeLiveGroupMenu();
    if (hadFocus && anchor && anchor.isConnected) anchor.focus({ preventScroll: true });
  }, true);
  // A tap anywhere else, the map moving, or the window resizing closes it.
  document.addEventListener('pointerdown', (event) => {
    if (!openFor || menu.contains(event.target)) return;
    if (openFor.anchor && openFor.anchor.contains(event.target)) return;
    closeLiveGroupMenu();
  }, true);
  map.on('movestart', () => {
    if (openFor) closeLiveGroupMenu();
  });
  window.addEventListener('resize', () => {
    if (openFor) closeLiveGroupMenu();
  });
}

function paintRows() {
  for (const [key, row] of rows) {
    const on = key === current;
    row.classList.toggle('is-on', on);
    row.setAttribute('aria-checked', on ? 'true' : 'false');
  }
}

// Under the button, or above it when there is more room there.
function place(anchor) {
  const vw = window.innerWidth;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const r = anchor.getBoundingClientRect();
  const gap = 8;
  const edge = 12;
  const width = Math.min(280, vw - edge * 2);
  const cx = r.left + r.width / 2;
  const left = Math.min(Math.max(cx - width / 2, edge), vw - width - edge);
  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;
  const height = menu.offsetHeight;
  const below = vh - r.bottom - gap - edge;
  const above = r.top - gap - edge;
  const down = below >= height || below >= above;
  if (down) {
    menu.style.top = `${Math.max(edge, r.bottom + gap)}px`;
    menu.style.bottom = 'auto';
  } else {
    menu.style.top = 'auto';
    menu.style.bottom = `${Math.max(edge, window.innerHeight - r.top + gap)}px`;
  }
  menu.classList.toggle('is-above', !down);
}

function pick(key) {
  const onPick = openFor && openFor.onPick;
  closeLiveGroupMenu();
  if (typeof onPick === 'function') onPick(key);
}

export function isLiveGroupMenuOpen() {
  return !!openFor;
}

// anchor: the element it drops from. onPick(key) runs after it closes.
export function openLiveGroupMenu(anchor, onPick) {
  if (!anchor) return;
  if (!menu) buildMenu();
  ensureLayer();
  const wasOpen = !!openFor;
  openFor = { anchor, onPick };
  paintRows();
  menu.hidden = false;
  place(anchor);
  // Keyboard and mouse users land on the current choice; a phone does not
  // need the focus ring.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    rows.get(current).focus({ preventScroll: true });
  }
  if (!wasOpen && window.layerOpened) window.layerOpened('livegroups');
}

// within: close only when the menu drops from inside that element (the
// map pin closing takes its own menu, not the live bar's).
export function closeLiveGroupMenu({ fromHistory = false, within = null } = {}) {
  if (!openFor) return;
  if (within && !(openFor.anchor && within.contains(openFor.anchor))) return;
  openFor = null;
  if (menu) menu.hidden = true;
  if (!fromHistory && window.layerClosedByUI) window.layerClosedByUI('livegroups');
}

// Hold (touch / pen) or right-click on el runs open(). The click a hold
// ends with is swallowed so the button does not also do its tap: until the
// finger lifts, then briefly (the click lands just after pointerup).
// Time-limited, so a later click without a press (keyboard, screen reader)
// is never eaten. Same rule as the marker bubbles (marker.js).
const HOLD_MS = 480;
const SWALLOW_MS = 600;
export function bindHoldMenu(el, open) {
  let timer = 0;
  let sx = 0;
  let sy = 0;
  let swallowUntil = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
  };
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    cancel();
    if (swallowUntil !== Infinity) swallowUntil = performance.now() + SWALLOW_MS;
    open();
  });
  el.addEventListener('pointerdown', (event) => {
    swallowUntil = 0;
    if (event.pointerType === 'mouse') return;
    sx = event.clientX;
    sy = event.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = 0;
      swallowUntil = Infinity;
      open();
    }, HOLD_MS);
  });
  el.addEventListener('pointermove', (event) => {
    if (timer && Math.hypot(event.clientX - sx, event.clientY - sy) > 8) cancel();
  });
  const lift = () => {
    cancel();
    if (swallowUntil === Infinity) swallowUntil = performance.now() + SWALLOW_MS;
  };
  el.addEventListener('pointerup', lift);
  el.addEventListener('pointercancel', lift);
  // Capture on the button itself runs before its own click handler.
  el.addEventListener('click', (event) => {
    if (performance.now() < swallowUntil) {
      swallowUntil = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    swallowUntil = 0;
  }, true);
}
