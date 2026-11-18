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
//
// The ⚙ beside Look for Live opens the live settings (openLiveSettings):
// the same groups, the distance (how far from the held spot), how recent
// (up to 24 hours, which is all the server keeps), and a Look for Live
// button that searches with them.
import { map } from './map.js';
import { formatKm } from './arrowfilters.js';

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

// ── Distance ───────────────────────────────────────────────────────────
// How far from the held spot Look for Live reaches: any whole km from
// LIVE_RADIUS_MIN_KM to LIVE_RADIUS_MAX_KM, in any country
// (/api/local?lat&lng&radius). The server cuts a larger radius to the
// same max. Kept across visits. liveradius.js draws it on the map. A
// saved preset (10, 25, 50, 100) is already a whole km in that range, so
// it loads as itself. A non-number (the old 'country' choice) reads as
// the default.
export const LIVE_RADIUS_MIN_KM = 1;
export const LIVE_RADIUS_DEFAULT_KM = 50;
export const LIVE_RADIUS_MAX_KM = 100; // server/index.js LIVE_RADIUS_MAX_KM
const RADIUS_KEY = 'meritocracy-live-radius';
let radius = readRadius();

// A whole km inside 1–100. Above the max clamps to it (the server would);
// zero, negative and anything that is not a number are not a distance.
function cleanRadius(value) {
  const km = Number(value);
  if (!Number.isFinite(km) || km <= 0) return null;
  return Math.min(LIVE_RADIUS_MAX_KM, Math.max(LIVE_RADIUS_MIN_KM, Math.round(km)));
}

function readRadius() {
  try {
    const saved = cleanRadius(localStorage.getItem(RADIUS_KEY));
    if (saved != null) return saved;
  } catch { /* private mode: the default */ }
  return LIVE_RADIUS_DEFAULT_KM;
}

export function liveRadius() {
  return radius;
}

export function liveRadiusName(value = radius) {
  return formatKm(value);
}

// false for a value that is not a distance. Saving dispatches
// live-radius-changed, the same event a drag sends so the circle follows
// before the release.
export function setLiveRadius(value) {
  const next = cleanRadius(value);
  if (next == null) return false;
  radius = next;
  try { localStorage.setItem(RADIUS_KEY, String(next)); } catch { /* this visit only */ }
  document.dispatchEvent(new CustomEvent('live-radius-changed', { detail: next }));
  return true;
}

// ── Time ───────────────────────────────────────────────────────────────
// How recent a live post must be, in hours to a tenth (0.1 h is 6 min).
// The server drops a marker 24 hours after its last upload
// (server/index.js LIVE_TTL_MS), so a longer window would still come back
// empty. Kept across visits. localnews.js filters the markers the server
// already returned: within * 3600 * 1000, so a tenth of an hour is that
// many minutes. A saved whole hour (the old pills, or the old custom
// field) is a tenth already, so it loads as itself.
export const LIVE_HOURS_MIN = 0.1;
export const LIVE_HOURS_DEFAULT = 24;
export const LIVE_HOURS_MAX = 24; // server/index.js LIVE_TTL_MS
const HOURS_KEY = 'meritocracy-live-hours';
let hours = readHours();

// Tenths of an hour, clamped to 0.1–24. Not a number stays unset.
function hourTenths(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const tenths = Math.round(Math.round(n * 1000) / 100);
  // 1 and 240, not 0.1 * 10: a tenth is not a round binary number.
  return Math.min(LIVE_HOURS_MAX * 10, Math.max(1, tenths));
}

function cleanHours(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const tenths = hourTenths(value);
  return tenths == null ? null : tenths / 10;
}

function readHours() {
  try {
    const saved = cleanHours(localStorage.getItem(HOURS_KEY));
    if (saved != null) return saved;
  } catch { /* private mode: the default */ }
  return LIVE_HOURS_DEFAULT;
}

export function liveHours() {
  return hours;
}

// Under an hour, minutes ("6 min", "30 min"). From an hour up, hours to a
// tenth, without a trailing ".0" ("1.5 h", "24 h").
export function liveHoursName(value = hours) {
  const tenths = hourTenths(value);
  const t = tenths == null ? Math.round(hours * 10) : tenths;
  if (t < 10) return t * 6 + ' min';
  return (t % 10 === 0 ? String(t / 10) : (t / 10).toFixed(1)) + ' h';
}

// false when it is not a number. A tenth of an hour, clamped to 0.1–24.
export function setLiveHours(value) {
  const n = cleanHours(value);
  if (n == null) return false;
  hours = n;
  try { localStorage.setItem(HOURS_KEY, String(n)); } catch { /* this visit only */ }
  return true;
}

// What the caption under Look for Live says: the group when it is not
// Everyone, always the distance, and the time when it is not 24 hours
// ("Following · 50 km", "100 km · 6 min", "50 km · 1.5 h").
export function liveChoiceCaption() {
  const parts = [];
  if (current !== 'all') parts.push(liveGroupName(current));
  parts.push(liveRadiusName(radius));
  if (hours !== LIVE_HOURS_DEFAULT) parts.push(liveHoursName(hours));
  return parts.join(' · ');
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

// ── Live settings (the ⚙ beside Look for Live) ─────────────────────────
// Posts from (the groups above), then one slider for Distance and one for
// Time, then Look for Live. A group is kept as soon as it is picked. A
// slider's value is kept when it is released; while Distance is dragged
// the map circle follows (live-radius-changed) without saving. onChange
// lets the pin repaint its caption. Escape, a tap anywhere else, moving
// the map and Back close it.
let settings = null;
let settingsFor = null; // { anchor, onLook, onChange }
let settingsLayer = false;
const settingsRows = new Map(); // group key -> row
let radiusUi = null; // { input, show }
let hoursUi = null;

export const LIVE_GEAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';

function ensureSettingsLayer() {
  if (settingsLayer || !window.defineLayer) return;
  settingsLayer = true;
  window.defineLayer('livesettings', {
    open: () => {},
    close: () => closeLiveSettings({ fromHistory: true }),
  });
}

function settingsSection(title, hint) {
  const section = document.createElement('div');
  section.className = 'live-settings-section';
  const head = document.createElement('div');
  head.className = 'live-settings-title';
  head.textContent = title;
  section.appendChild(head);
  if (hint) {
    const note = document.createElement('div');
    note.className = 'live-settings-hint';
    note.textContent = hint;
    section.appendChild(note);
  }
  return section;
}

function buildSettings() {
  settings = document.createElement('div');
  settings.className = 'live-settings';
  settings.hidden = true;
  settings.setAttribute('role', 'dialog');
  settings.setAttribute('aria-label', 'Live settings');

  const head = document.createElement('div');
  head.className = 'live-group-menu-head live-settings-head';
  const dot = document.createElement('span');
  dot.className = 'live-filter-dot';
  dot.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span');
  title.className = 'live-settings-name';
  title.textContent = 'Live settings';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'live-settings-close';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeLiveSettings();
  });
  head.append(dot, title, close);

  // Posts from: the dropdown's rows, as radio buttons.
  const groups = settingsSection('Posts from');
  const groupList = document.createElement('div');
  groupList.className = 'live-settings-groups';
  groupList.setAttribute('role', 'radiogroup');
  groupList.setAttribute('aria-label', 'Posts from');
  for (const [key, name, hint] of LIVE_GROUPS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'live-group-menu-row';
    row.setAttribute('role', 'radio');
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
      setLiveGroup(key);
      paintSettings();
      settingsChanged();
    });
    settingsRows.set(key, row);
    groupList.appendChild(row);
  }
  groups.appendChild(groupList);

  // Distance: one slider, 1 km to 100 km. Dragging moves the circle on the
  // map; releasing keeps the km and repaints the caption.
  const distance = settingsSection('Distance', 'How far from the pin. The circle on the map shows it.');
  radiusUi = addSlider(distance, {
    label: 'Distance',
    min: LIVE_RADIUS_MIN_KM,
    max: LIVE_RADIUS_MAX_KM,
    step: 1,
    text: (n) => liveRadiusName(cleanRadius(n) ?? radius),
    onInput: (n) => {
      const km = cleanRadius(n);
      if (km == null) return;
      document.dispatchEvent(new CustomEvent('live-radius-changed', { detail: km }));
    },
    onCommit: (n) => {
      if (!setLiveRadius(n)) return;
      settingsChanged();
    },
  });

  // Time: one slider, 0.1 h (6 min) to 24 h, in tenths. The server only
  // keeps 24, so the slider cannot ask for more.
  const time = settingsSection('Time', 'How recent. The server keeps the last 24 hours.');
  hoursUi = addSlider(time, {
    label: 'Time',
    min: LIVE_HOURS_MIN,
    max: LIVE_HOURS_MAX,
    step: 0.1,
    text: (n) => liveHoursName(n),
    onInput: () => {},
    onCommit: (n) => {
      if (!setLiveHours(n)) return;
      settingsChanged();
    },
  });

  const look = document.createElement('button');
  look.type = 'button';
  look.className = 'live-settings-look';
  look.textContent = '📡 Look for Live';
  look.addEventListener('click', (event) => {
    event.stopPropagation();
    const onLook = settingsFor && settingsFor.onLook;
    closeLiveSettings();
    if (typeof onLook === 'function') onLook(current);
  });

  settings.append(head, groups, distance, time, look);
  // The document click closes panels and the map pin; this keeps itself.
  settings.addEventListener('click', (event) => event.stopPropagation());
  settings.addEventListener('pointerdown', (event) => event.stopPropagation());
  settings.addEventListener('contextmenu', (event) => event.preventDefault());
  document.body.appendChild(settings);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !settingsFor) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = settingsFor.anchor;
    const hadFocus = settings.contains(document.activeElement);
    closeLiveSettings();
    if (hadFocus && anchor && anchor.isConnected) anchor.focus({ preventScroll: true });
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (!settingsFor || settings.contains(event.target)) return;
    if (settingsFor.anchor && settingsFor.anchor.contains(event.target)) return;
    closeLiveSettings();
  }, true);
  map.on('movestart', () => {
    if (settingsFor) closeLiveSettings();
  });
  const follow = () => {
    if (settingsFor && settingsFor.anchor && settingsFor.anchor.isConnected) placeSettings(settingsFor.anchor);
  };
  window.addEventListener('resize', follow);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', follow);
}

// A labelled slider. input moves the readout (and whatever onInput does);
// change, which a range fires when the pointer is released and when an
// arrow key steps, keeps the value. Arrow keys step by `step` on their own.
function addSlider(section, { label, min, max, step, text, onInput, onCommit }) {
  const valueEl = document.createElement('span');
  valueEl.className = 'live-settings-value';
  section.querySelector('.live-settings-title').appendChild(valueEl);
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'live-settings-slider';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.setAttribute('aria-label', label);
  const show = (n) => {
    const shown = text(n);
    valueEl.textContent = shown;
    input.setAttribute('aria-valuetext', shown);
  };
  input.addEventListener('input', (event) => {
    event.stopPropagation();
    const n = Number(input.value);
    show(n);
    onInput(n);
  });
  input.addEventListener('change', (event) => {
    event.stopPropagation();
    const n = Number(input.value);
    show(n);
    onCommit(n);
  });
  section.appendChild(input);
  return { input, show };
}

function settingsChanged() {
  const onChange = settingsFor && settingsFor.onChange;
  if (typeof onChange === 'function') onChange();
}

function paintSlider(ui, value) {
  if (!ui || document.activeElement === ui.input) return;
  ui.input.value = String(value);
  ui.show(value);
}

function paintSettings() {
  for (const [key, row] of settingsRows) {
    const on = key === current;
    row.classList.toggle('is-on', on);
    row.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  paintSlider(radiusUi, radius);
  paintSlider(hoursUi, hours);
}

// Under the ⚙, or above it when there is more room there; inside the
// visible area.
function placeSettings(anchor) {
  const view = window.visualViewport;
  const vw = window.innerWidth;
  const vh = view ? view.height : window.innerHeight;
  const top0 = view ? view.offsetTop : 0;
  const r = anchor.getBoundingClientRect();
  const gap = 8;
  const edge = 12;
  const width = Math.min(340, vw - edge * 2);
  const cx = r.left + r.width / 2;
  const left = Math.min(Math.max(cx - width / 2, edge), vw - width - edge);
  settings.style.width = width + 'px';
  settings.style.left = left + 'px';
  settings.style.maxHeight = Math.max(200, vh - edge * 2) + 'px';
  const height = Math.min(settings.scrollHeight, vh - edge * 2);
  const below = top0 + vh - r.bottom - gap - edge;
  const above = r.top - top0 - gap - edge;
  let top = (below >= height || below >= above) ? r.bottom + gap : r.top - gap - height;
  top = Math.min(Math.max(top, top0 + edge), top0 + vh - edge - height);
  settings.style.top = top + 'px';
}

export function isLiveSettingsOpen() {
  return !!settingsFor;
}

// anchor: the ⚙. onLook(groupKey) runs Look for Live after it closes;
// onChange() runs after each choice.
export function openLiveSettings(anchor, { onLook, onChange } = {}) {
  if (!anchor) return;
  if (!settings) buildSettings();
  ensureSettingsLayer();
  closeLiveGroupMenu();
  const wasOpen = !!settingsFor;
  if (settingsFor && settingsFor.anchor !== anchor) settingsFor.anchor.setAttribute('aria-expanded', 'false');
  settingsFor = { anchor, onLook, onChange };
  anchor.setAttribute('aria-expanded', 'true');
  paintSettings();
  settings.hidden = false;
  placeSettings(anchor);
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    settingsRows.get(current).focus({ preventScroll: true });
  }
  if (!wasOpen && window.layerOpened) window.layerOpened('livesettings');
}

// within: close only when it was opened from inside that element.
export function closeLiveSettings({ fromHistory = false, within = null } = {}) {
  if (!settingsFor) return;
  if (within && !(settingsFor.anchor && within.contains(settingsFor.anchor))) return;
  if (settingsFor.anchor) settingsFor.anchor.setAttribute('aria-expanded', 'false');
  settingsFor = null;
  if (settings) settings.hidden = true;
  // A drag that never released showed a circle the saved km does not match.
  document.dispatchEvent(new CustomEvent('live-radius-changed', { detail: radius }));
  if (settings && settings.contains(document.activeElement)) document.activeElement.blur();
  if (!fromHistory && window.layerClosedByUI) window.layerClosedByUI('livesettings');
}
