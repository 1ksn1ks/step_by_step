// Full-screen following picker. Rows come from followsuggest's cache.
// This module does not fetch.

import { connectedAccount } from './web3.js';
import {
  ensureData,
  getFollowingItems,
  appendHighlighted,
  followingStatus,
  clearFollowingFailure,
  FOLLOWING_UPDATED,
  followingCountText,
  followingEmptyText,
} from './followsuggest.js';

const RECENT_KEY = 'picker-recent-v1';
const ROW_H = 56;
const LETTER_H = 28;
const SECTION_H = 32;
const LETTER_AFTER = 15;
const BUFFER = ROW_H * 8;
const DEFAULT_AVATAR = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';

let root = null;
let session = null;
let lastOpts = null;
let layerReady = false;
let token = 0;

let items = [];
let selected = [];
let tab = 'all';
let query = '';
let active = -1;
let multi = false;
let boxes = [];
let rowItems = [];
let searchTimer = 0;
let scrollRaf = 0;
let walletFrame = 0;
let walletObserver = null;
let scroller = null;
let canvas = null;
let pin = null;
let emptyEl = null;
let chipsEl = null;
let doneBtn = null;
let countEl = null;
let searchEl = null;

function isDesktop() {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const wide = window.matchMedia('(min-width: 1000px)').matches;
  return fine && wide;
}

function itemKey(item) {
  return (item && item.kind ? item.kind : '') + ':' + (item && item.id ? item.id : '');
}

function displayName(item) {
  if (!item) return '';
  if (item.kind === 'account') return item.username || item.id || '';
  return item.name || 'Topic';
}

function letterOf(name) {
  const ch = String(name || '').trim().charAt(0).toLocaleUpperCase();
  const base = ch.normalize ? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ch;
  if (base >= 'A' && base <= 'Z') return base.charAt(0);
  return '#';
}

function byName(a, b) {
  return displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' });
}

function itemMatches(item, needle) {
  const q = String(needle || '').toLowerCase();
  if (!q) return true;
  const fields = item.kind === 'account'
    ? [item.username, item.id, item.topic]
    : [item.name, item.id];
  return fields.some((field) => String(field || '').toLowerCase().includes(q));
}

function filterTab(list, which) {
  if (which === 'accounts') return list.filter((item) => item.kind === 'account');
  if (which === 'topics') return list.filter((item) => item.kind === 'topic');
  return list.slice();
}

function readRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function remember(item) {
  if (!item || !item.id) return;
  const key = itemKey(item);
  const next = [{
    kind: item.kind,
    id: String(item.id),
    name: item.name || '',
    username: item.username || '',
    avatar: item.avatar || '',
    topic: item.topic || '',
    hasTopic: !!item.hasTopic,
  }];
  for (const row of readRecent()) {
    if (!row || (row.kind + ':' + row.id) === key) continue;
    next.push(row);
    if (next.length >= 5) break;
  }
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, 5))); } catch { /* private mode */ }
}

function liveRecent(list) {
  const map = new Map();
  for (const item of list) map.set(itemKey(item), item);
  const out = [];
  for (const row of readRecent()) {
    if (!row) continue;
    const live = map.get(row.kind + ':' + row.id);
    if (!live || out.indexOf(live) !== -1) continue;
    out.push(live);
    if (out.length >= 5) break;
  }
  return out;
}

function applyDim(list, dimMissing) {
  if (!dimMissing) return list;
  return list.map((item) => {
    if (item.kind === 'account' && !item.hasTopic) return Object.assign({}, item, { dim: true });
    return item;
  });
}

function normalizeKinds(kinds) {
  const src = Array.isArray(kinds) && kinds.length ? kinds : ['accounts', 'topics'];
  const out = [];
  for (const kind of src) {
    if ((kind === 'accounts' || kind === 'topics') && out.indexOf(kind) === -1) out.push(kind);
  }
  return out.length ? out : ['accounts', 'topics'];
}

function topicIcon() {
  const wrap = document.createElement('div');
  wrap.className = 'follow-suggest-icon';
  wrap.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18');
  svg.appendChild(path);
  wrap.appendChild(svg);
  return wrap;
}

function isSelected(item) {
  const key = itemKey(item);
  return selected.some((row) => itemKey(row) === key);
}

function buildEntries(emptyOverride) {
  if (emptyOverride) return { entries: [], rows: [], empty: emptyOverride };
  const tabItems = filterTab(items, tab);
  const matched = tabItems.filter((item) => itemMatches(item, query));
  const recent = liveRecent(items).filter((item) => {
    if (tab === 'accounts' && item.kind !== 'account') return false;
    if (tab === 'topics' && item.kind !== 'topic') return false;
    return itemMatches(item, query);
  });
  const entries = [];
  const rows = [];
  if (recent.length) {
    entries.push({ type: 'section', label: 'Recent' });
    for (const item of recent) {
      entries.push({ type: 'row', item, rowIndex: rows.length });
      rows.push(item);
    }
  }
  const following = matched.slice().sort(byName);
  if (following.length) {
    entries.push({ type: 'section', label: 'Following' });
    const showLetters = following.length > LETTER_AFTER;
    let letter = '';
    for (const item of following) {
      if (showLetters) {
        const next = letterOf(displayName(item));
        if (next !== letter) {
          letter = next;
          entries.push({ type: 'letter', letter });
        }
      }
      entries.push({ type: 'row', item, rowIndex: rows.length });
      rows.push(item);
    }
  }
  return { entries, rows, empty: followingEmptyText('ready', items.length, rows.length) };
}

function sectionHeight() {
  if (!root) return SECTION_H;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:var(--fu);';
  root.appendChild(probe);
  const fu = probe.getBoundingClientRect().height;
  probe.remove();
  if (!fu) return SECTION_H;
  return Math.max(SECTION_H, Math.ceil(fu * 1.6 + fu * 1.35 * 1.2));
}

function layout(entries) {
  let y = 0;
  const next = [];
  const sectionH = sectionHeight();
  for (const entry of entries) {
    const h = entry.type === 'row' ? ROW_H : entry.type === 'letter' ? LETTER_H : sectionH;
    next.push({ entry, y, h });
    y += h;
  }
  return { boxes: next, total: y };
}

function pinText(scrollTop) {
  let text = '';
  let top = 0;
  let height = 0;
  for (const box of boxes) {
    if (box.y > scrollTop + 1) break;
    if (box.entry.type === 'section' || box.entry.type === 'letter') {
      text = box.entry.type === 'letter' ? box.entry.letter : box.entry.label;
      top = box.y;
      height = box.h;
    }
  }
  if (!text || top + height > scrollTop + 1) return '';
  return text;
}

function firstBoxAt(y) {
  let lo = 0;
  let hi = boxes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (boxes[mid].y + boxes[mid].h < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function paintWindow(force) {
  if (!scroller || !canvas) return;
  paintPin();
  const scrollTop = scroller.scrollTop;
  const view = scroller.clientHeight || 0;
  const fromY = Math.max(0, scrollTop - BUFFER);
  const toY = scrollTop + view + BUFFER;
  let from = firstBoxAt(fromY);
  let to = from;
  while (to < boxes.length && boxes[to].y < toY) to += 1;
  if (!force && canvas.dataset.from === String(from) && canvas.dataset.to === String(to) && canvas.dataset.active === String(active) && canvas.dataset.picked === String(selected.length)) {
    return;
  }
  canvas.dataset.from = String(from);
  canvas.dataset.to = String(to);
  canvas.dataset.active = String(active);
  canvas.dataset.picked = String(selected.length);
  const frag = document.createDocumentFragment();
  for (let i = from; i < to; i++) {
    const box = boxes[i];
    frag.appendChild(entryNode(box));
  }
  canvas.replaceChildren(frag);
}

function paintPin() {
  if (!pin || !scroller) return;
  const text = boxes.length ? pinText(scroller.scrollTop) : '';
  if (!text) {
    pin.hidden = true;
    pin.textContent = '';
    return;
  }
  pin.hidden = false;
  pin.textContent = text;
}

function entryNode(box) {
  const entry = box.entry;
  if (entry.type === 'section' || entry.type === 'letter') {
    const el = document.createElement('div');
    el.className = 'picker-abs ' + (entry.type === 'letter' ? 'picker-letter' : 'picker-section');
    el.style.top = box.y + 'px';
    el.style.height = box.h + 'px';
    el.textContent = entry.type === 'letter' ? entry.letter : entry.label;
    return el;
  }
  const item = entry.item;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'picker-abs follow-suggest-row picker-row'
    + (item.dim ? ' is-dim' : '')
    + (entry.rowIndex === active ? ' is-active' : '')
    + (isSelected(item) ? ' is-picked' : '');
  row.style.top = box.y + 'px';
  row.style.height = box.h + 'px';
  row.setAttribute('role', 'option');
  row.id = 'picker-opt-' + entry.rowIndex;
  row.dataset.kind = item.kind || '';
  row.dataset.id = item.id || '';
  row.setAttribute('aria-selected', entry.rowIndex === active ? 'true' : 'false');
  const text = document.createElement('div');
  text.className = 'follow-suggest-text';
  const primary = document.createElement('div');
  primary.className = 'follow-suggest-primary';
  const secondary = document.createElement('div');
  secondary.className = 'follow-suggest-id';
  if (item.kind === 'account') {
    const img = document.createElement('img');
    img.className = 'follow-suggest-avatar';
    img.alt = '';
    img.src = item.avatar || DEFAULT_AVATAR;
    img.addEventListener('error', () => {
      if (img.src !== DEFAULT_AVATAR) img.src = DEFAULT_AVATAR;
    });
    appendHighlighted(primary, item.username || item.id, query);
    appendHighlighted(secondary, item.id, query);
    if (item.dim) {
      const hint = document.createElement('span');
      hint.className = 'follow-suggest-hint';
      hint.textContent = ' · no chat topic';
      secondary.appendChild(hint);
    }
    text.append(primary, secondary);
    row.append(img, text);
  } else {
    appendHighlighted(primary, item.name || 'Topic', query);
    appendHighlighted(secondary, item.id, query);
    text.append(primary, secondary);
    row.append(topicIcon(), text);
  }
  row.addEventListener('click', (event) => {
    event.stopPropagation();
    active = entry.rowIndex;
    choose(item);
  });
  return row;
}

function paintChips() {
  if (!chipsEl || !doneBtn) return;
  chipsEl.replaceChildren();
  const show = multi && selected.length > 0;
  chipsEl.hidden = !show;
  for (const item of selected) {
    const chip = document.createElement('span');
    chip.className = 'picker-chip';
    const label = document.createElement('span');
    label.className = 'picker-chip-label';
    label.textContent = displayName(item);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'picker-chip-x';
    remove.setAttribute('aria-label', 'Remove ' + displayName(item));
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      dropSelected(item);
    });
    chip.append(label, remove);
    chipsEl.appendChild(chip);
  }
  doneBtn.hidden = !multi;
  doneBtn.textContent = 'Done (' + selected.length + ')';
}

function dropSelected(item) {
  const key = itemKey(item);
  selected = selected.filter((row) => itemKey(row) !== key);
  paintChips();
  paintWindow(true);
}

function toggleSelected(item) {
  if (isSelected(item)) dropSelected(item);
  else {
    selected = selected.concat([item]);
    paintChips();
    paintWindow(true);
  }
}

function choose(item) {
  if (!item) return;
  if (multi) {
    toggleSelected(item);
    return;
  }
  remember(item);
  finish(item, false);
}

function revealActive() {
  if (!scroller || active < 0) return;
  let box = null;
  for (const candidate of boxes) {
    if (candidate.entry.type === 'row' && candidate.entry.rowIndex === active) {
      box = candidate;
      break;
    }
  }
  if (!box) return;
  const top = scroller.scrollTop;
  const view = scroller.clientHeight || 0;
  if (box.y < top) scroller.scrollTop = box.y;
  else if (box.y + box.h > top + view) scroller.scrollTop = Math.max(0, box.y + box.h - view);
}

function moveActive(delta) {
  if (!rowItems.length) return;
  if (active < 0) active = delta > 0 ? 0 : rowItems.length - 1;
  else active = (active + delta + rowItems.length) % rowItems.length;
  revealActive();
  paintWindow(true);
  if (searchEl) {
    const id = 'picker-opt-' + active;
    searchEl.setAttribute('aria-activedescendant', id);
  }
}

function rebuild(resetScroll) {
  if (!session || !countEl) return;
  const status = followingStatus();
  const tabItems = filterTab(items, tab);
  countEl.textContent = followingCountText(status, tabItems.length);
  const override = status === 'ready' ? '' : followingEmptyText(status, items.length, 0);
  const built = buildEntries(override);
  rowItems = built.rows;
  const laid = layout(built.entries);
  boxes = laid.boxes;
  if (active >= rowItems.length) active = -1;
  if (canvas) {
    canvas.style.height = laid.total + 'px';
    canvas.dataset.from = '';
    canvas.dataset.to = '';
  }
  if (emptyEl) {
    emptyEl.hidden = !built.empty;
    emptyEl.textContent = built.empty;
  }
  if (scroller && resetScroll) scroller.scrollTop = 0;
  paintWindow(true);
  paintChips();
}

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = searchEl ? searchEl.value : '';
    active = -1;
    if (searchEl) searchEl.removeAttribute('aria-activedescendant');
    rebuild(true);
  }, 100);
}

function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    paintWindow(false);
  });
}

function onResize() {
  rebuild(false);
}

function onKey(event) {
  if (!root || !session) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(null, false);
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopImmediatePropagation();
    moveActive(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Enter') {
    const target = event.target;
    if (target && target.classList && (target.classList.contains('picker-done') || target.classList.contains('picker-chip-x') || target.classList.contains('picker-back'))) {
      return;
    }
    if (active < 0 || !rowItems[active]) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    choose(rowItems[active]);
  }
}

function stopWalletWatch() {
  if (walletFrame) cancelAnimationFrame(walletFrame);
  walletFrame = 0;
  if (walletObserver) walletObserver.disconnect();
  walletObserver = null;
}

function onFollowingUpdated() {
  if (!session || session.settled || !lastOpts) return;
  items = applyDim(getFollowingItems(lastOpts.kinds), lastOpts.dimMissing);
  rebuild(false);
}

function loadFollowing(my, resetScroll) {
  const pending = ensureData(true);
  if (session && !session.settled && session.token === my && lastOpts) {
    items = applyDim(getFollowingItems(lastOpts.kinds), lastOpts.dimMissing);
    rebuild(!!resetScroll);
  }
  return pending.then(() => {
    if (!session || session.settled || session.token !== my || !lastOpts) return;
    items = applyDim(getFollowingItems(lastOpts.kinds), lastOpts.dimMissing);
    rebuild(!!resetScroll);
  });
}

// #account-id is the connect signal followtopic already watches. Poll the
// live account too, because the session can restore before that node exists.
function watchWallet(my) {
  stopWalletWatch();
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const arm = () => {
    if (walletFrame) cancelAnimationFrame(walletFrame);
    walletFrame = 0;
    if (!session || session.settled || session.token !== my) {
      stopWalletWatch();
      return;
    }
    if (connectedAccount) {
      stopWalletWatch();
      loadFollowing(my, true);
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - started >= 10000) {
      stopWalletWatch();
      return;
    }
    walletFrame = requestAnimationFrame(arm);
  };
  const accountEl = document.getElementById('account-id');
  if (accountEl && typeof MutationObserver === 'function') {
    walletObserver = new MutationObserver(arm);
    walletObserver.observe(accountEl, { childList: true, characterData: true, subtree: true });
  }
  walletFrame = requestAnimationFrame(arm);
}

function teardown() {
  clearTimeout(searchTimer);
  searchTimer = 0;
  stopWalletWatch();
  document.removeEventListener(FOLLOWING_UPDATED, onFollowingUpdated);
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  scrollRaf = 0;
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  scroller = null;
  canvas = null;
  pin = null;
  emptyEl = null;
  chipsEl = null;
  doneBtn = null;
  countEl = null;
  searchEl = null;
  session = null;
  items = [];
  selected = [];
  boxes = [];
  rowItems = [];
  active = -1;
  query = '';
}

function finish(value, viaHistory) {
  const current = session;
  if (!current || current.settled) return;
  current.settled = true;
  const resolve = current.resolve;
  const onPick = current.onPick;
  teardown();
  if (!viaHistory && typeof window.layerClosedByUI === 'function') {
    window.layerClosedByUI('followpicker');
  }
  if (value != null && typeof onPick === 'function') {
    try { onPick(value); } catch { /* the promise still resolves */ }
  }
  resolve(value);
}

function ensureLayer() {
  if (layerReady || typeof window.defineLayer !== 'function') return;
  layerReady = true;
  window.defineLayer('followpicker', {
    open() {
      if (root || !lastOpts) return;
      openPicker(lastOpts);
    },
    close() {
      finish(null, true);
    },
  });
}

function backArrow() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('overflow', 'visible');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['m12 19-7-7 7-7', 'M19 12H5']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function tabButtons(kinds) {
  const defs = [];
  if (kinds.length > 1) defs.push({ id: 'all', label: 'All' });
  if (kinds.indexOf('accounts') !== -1) defs.push({ id: 'accounts', label: 'Accounts' });
  if (kinds.indexOf('topics') !== -1) defs.push({ id: 'topics', label: 'Topics' });
  return defs;
}

function mount(opts) {
  root = document.createElement('div');
  root.className = 'picker-sheet';
  root.id = 'follow-picker';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.addEventListener('click', (event) => event.stopPropagation());
  root.addEventListener('pointerdown', (event) => event.stopPropagation());

  const head = document.createElement('div');
  head.className = 'picker-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'picker-back';
  back.setAttribute('aria-label', 'Back');
  back.appendChild(backArrow());
  back.addEventListener('click', (event) => {
    event.stopPropagation();
    finish(null, false);
  });
  const heading = document.createElement('div');
  heading.className = 'picker-heading';
  const title = document.createElement('div');
  title.className = 'picker-title';
  title.id = 'follow-picker-title';
  title.textContent = opts.title || 'Following';
  countEl = document.createElement('div');
  countEl.className = 'picker-count';
  countEl.textContent = followingCountText('loading', 0);
  heading.append(title);
  head.append(back, heading);
  root.setAttribute('aria-labelledby', 'follow-picker-title');

  searchEl = document.createElement('input');
  searchEl.type = 'search';
  searchEl.className = 'picker-search';
  searchEl.placeholder = 'Search';
  searchEl.setAttribute('aria-label', 'Search following');
  searchEl.setAttribute('autocomplete', 'off');
  searchEl.setAttribute('autocapitalize', 'off');
  searchEl.spellcheck = false;
  searchEl.value = opts.query || '';
  query = searchEl.value;
  searchEl.addEventListener('input', onSearchInput);

  chipsEl = document.createElement('div');
  chipsEl.className = 'picker-chips';
  chipsEl.hidden = true;

  const tabs = document.createElement('div');
  tabs.className = 'picker-tabs';
  tabs.setAttribute('role', 'tablist');
  const defs = tabButtons(opts.kinds);
  if (defs.length < 2) tabs.hidden = defs.length === 0;
  for (const def of defs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-tab' + (def.id === tab ? ' is-on' : '');
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', def.id === tab ? 'true' : 'false');
    button.textContent = def.label;
    button.dataset.tab = def.id;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      tab = def.id;
      active = -1;
      const all = tabs.querySelectorAll('.picker-tab');
      for (const node of all) {
        const on = node.dataset.tab === tab;
        node.classList.toggle('is-on', on);
        node.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      rebuild(true);
    });
    tabs.appendChild(button);
  }
  if (defs.length === 1) tabs.hidden = false;

  pin = document.createElement('div');
  pin.className = 'picker-pin';
  pin.hidden = true;

  scroller = document.createElement('div');
  scroller.className = 'picker-scroll';
  scroller.setAttribute('role', 'listbox');
  scroller.setAttribute('aria-label', 'Following');
  canvas = document.createElement('div');
  canvas.className = 'picker-canvas';
  emptyEl = document.createElement('div');
  emptyEl.className = 'picker-empty';
  emptyEl.hidden = false;
  emptyEl.textContent = followingEmptyText('loading', 0, 0);
  emptyEl.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!session || session.settled || followingStatus() !== 'offline') return;
    const my = session.token;
    clearFollowingFailure();
    loadFollowing(my, false);
  });
  scroller.append(canvas, emptyEl);
  scroller.addEventListener('scroll', onScroll, { passive: true });

  doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'picker-done';
  doneBtn.hidden = !multi;
  doneBtn.textContent = 'Done (0)';
  doneBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const picked = selected.slice();
    for (const item of picked) remember(item);
    finish(picked, false);
  });

  root.append(head, countEl, searchEl, chipsEl, tabs, pin, scroller, doneBtn);
  document.body.appendChild(root);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener(FOLLOWING_UPDATED, onFollowingUpdated);
  window.addEventListener('resize', onResize);
}

export function openPicker({ title, kinds = ['accounts', 'topics'], multi: many = false, onPick, query: initialQuery, dimMissing } = {}) {
  ensureLayer();
  if (session) finish(null, false);
  const my = ++token;
  const opts = {
    title: title || 'Following',
    kinds: normalizeKinds(kinds),
    multi: !!many,
    dimMissing: !!dimMissing,
    query: initialQuery == null ? '' : String(initialQuery),
    onPick: typeof onPick === 'function' ? onPick : null,
  };
  lastOpts = {
    title: opts.title,
    kinds: opts.kinds.slice(),
    multi: opts.multi,
    dimMissing: opts.dimMissing,
    query: opts.query,
    onPick: opts.onPick,
  };
  return new Promise((resolve) => {
    session = { resolve, onPick: opts.onPick, settled: false, token: my };
    items = [];
    selected = [];
    active = -1;
    multi = opts.multi;
    tab = opts.kinds.length > 1 ? 'all' : opts.kinds[0];
    query = opts.query;
    mount(opts);
    if (typeof window.layerOpened === 'function') window.layerOpened('followpicker');
    const walletAtOpen = connectedAccount;
    loadFollowing(my, true).then(() => {
      if (!session || session.settled || session.token !== my) return;
      if (isDesktop() && searchEl) searchEl.focus({ preventScroll: true });
    });
    if (!walletAtOpen) watchWallet(my);
  });
}
