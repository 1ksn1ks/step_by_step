// Following autocomplete for the Load, Topic Chat, and E2EE inputs.
// One list on document.body. The chat panels are position:fixed and
// overflow:hidden, so a list inside them would be clipped.

import { connectedAccount } from './web3.js';
import { usernames, profilePictures, profileTopics } from './loadalladata.js';
import { fetchFollowing } from './msgbackend.js';
import { safeHttpUrl } from './payerlink.js';
import { openPicker } from './picker.js';

const DEFAULT_AVATAR = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
const CACHE_MS = 5 * 60 * 1000;
const LIST_ID = 'follow-suggest';
const QUICK = 5;

const PANELS = {
  'input-field': 'load-column',
  'topic-chat-topic-id': 'topic-chat-container',
  'encrypted-chat-topic-id': 'encrypted-chat-container',
};

const specs = [];
const armed = new WeakSet();

let cacheAccount = '';
let cacheAt = 0;
let cacheData = null;
let inflight = null;
let failedAccount = '';
let failedAt = 0;

let list = null;
let openInput = null;
let openSpec = null;
let rows = [];
let activeIndex = -1;
let showToken = 0;
let blurTimer = 0;
let hideTimer = 0;
let picking = false;
let drag = null;
let booted = false;

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function ensureData(allowRetry) {
  const account = connectedAccount;
  if (!account) return Promise.resolve(null);
  if (cacheData && cacheAccount === account && (Date.now() - cacheAt) < CACHE_MS) {
    return Promise.resolve(cacheData);
  }
  if (inflight && inflight.account === account) return inflight.promise;
  if (!allowRetry && failedAccount === account && (Date.now() - failedAt) < CACHE_MS) {
    return Promise.resolve(null);
  }
  let run;
  run = fetchFollowing(account).then((data) => {
    const current = inflight && inflight.promise === run;
    if (current) inflight = null;
    if (!current || connectedAccount !== account) return null;
    if (!data) {
      cacheData = null;
      cacheAt = 0;
      cacheAccount = '';
      failedAccount = account;
      failedAt = Date.now();
      return null;
    }
    failedAccount = '';
    failedAt = 0;
    cacheAccount = account;
    cacheData = data;
    cacheAt = Date.now();
    return data;
  }).catch(() => {
    if (inflight && inflight.promise === run) inflight = null;
    failedAccount = account;
    failedAt = Date.now();
    return null;
  });
  inflight = { account, promise: run };
  return run;
}

export function refreshFollowing() {
  cacheAccount = '';
  cacheAt = 0;
  cacheData = null;
  inflight = null;
  failedAccount = '';
  failedAt = 0;
  if (!openInput || !connectedAccount) return;
  const token = showToken;
  const spec = openSpec;
  ensureData(true).then(() => {
    if (token !== showToken || openInput !== spec.input) return;
    render();
  });
}

function matches(query, ...fields) {
  if (!query) return true;
  const needle = String(query).toLowerCase();
  return fields.some((field) => String(field || '').toLowerCase().includes(needle));
}

function accountTopic(account, id) {
  if (profileTopics[id]) return String(profileTopics[id]);
  if (account && account.topic) return String(account.topic);
  return '';
}

function buildItems(data, spec, query) {
  const kinds = spec.kinds || [];
  const items = [];
  const wantTopics = kinds.indexOf('topics') !== -1;
  const wantAccounts = kinds.indexOf('accounts') !== -1;
  if (wantTopics) {
    for (const topic of data.topics || []) {
      if (!topic || !topic.id) continue;
      const id = String(topic.id);
      const name = String(topic.name || '');
      if (!matches(query, name, id)) continue;
      items.push({ kind: 'topic', id, name });
    }
  }
  if (wantAccounts) {
    const accounts = [];
    for (const account of data.accounts || []) {
      if (!account || !account.id) continue;
      const id = String(account.id);
      const clientName = usernames[id] && usernames[id].username;
      const username = String(clientName || account.username || '');
      const topic = accountTopic(account, id);
      if (!matches(query, username, id, topic)) continue;
      const clientPic = profilePictures[id] && profilePictures[id].url;
      const avatar = safeHttpUrl(clientPic) || safeHttpUrl(account.avatar) || DEFAULT_AVATAR;
      const hasTopic = !!topic;
      accounts.push({
        kind: 'account',
        id,
        username,
        avatar,
        topic,
        hasTopic,
        dim: !!spec.dimMissing && !hasTopic,
      });
    }
    if (spec.dimMissing) {
      accounts.sort((a, b) => (a.hasTopic === b.hasTopic ? 0 : a.hasTopic ? -1 : 1));
    }
    for (const account of accounts) items.push(account);
  }
  return items;
}

export function getFollowingItems(kinds) {
  const data = cacheData && cacheAccount === connectedAccount ? cacheData : null;
  if (!data) return [];
  const list = Array.isArray(kinds) ? kinds : ['accounts', 'topics'];
  return buildItems(data, { kinds: list, dimMissing: false }, '');
}

export function appendHighlighted(parent, text, query) {
  const value = String(text || '');
  const needle = String(query || '').toLowerCase();
  if (!needle) {
    parent.appendChild(document.createTextNode(value));
    return;
  }
  const lower = value.toLowerCase();
  let from = 0;
  let at = lower.indexOf(needle);
  if (at < 0) {
    parent.appendChild(document.createTextNode(value));
    return;
  }
  while (at >= 0) {
    if (at > from) parent.appendChild(document.createTextNode(value.slice(from, at)));
    const mark = document.createElement('span');
    mark.className = 'follow-suggest-mark';
    mark.textContent = value.slice(at, at + needle.length);
    parent.appendChild(mark);
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < value.length) parent.appendChild(document.createTextNode(value.slice(from)));
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

function rowElement(item, query, index) {
  const row = document.createElement('div');
  row.className = 'follow-suggest-row' + (item.dim ? ' is-dim' : '');
  row.setAttribute('role', 'option');
  row.id = 'follow-suggest-opt-' + index;
  row.setAttribute('aria-selected', 'false');
  row.dataset.index = String(index);

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
    img.src = item.avatar;
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
  return row;
}

function ensureList() {
  if (list) return list;
  list = document.createElement('div');
  list.className = 'follow-suggest';
  list.id = LIST_ID;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Following');
  list.hidden = true;
  document.body.appendChild(list);
  list.addEventListener('pointerdown', onListPointerDown);
  list.addEventListener('pointermove', onListPointerMove);
  list.addEventListener('pointerup', onListPointerUp);
  list.addEventListener('pointercancel', () => { drag = null; });
  list.addEventListener('click', (event) => event.stopPropagation());
  return list;
}

function seeAllElement(count) {
  const row = document.createElement('div');
  row.className = 'follow-suggest-row follow-suggest-all';
  row.setAttribute('role', 'option');
  row.id = 'follow-suggest-see-all';
  row.dataset.seeAll = '1';
  row.setAttribute('aria-selected', 'false');
  const text = document.createElement('div');
  text.className = 'follow-suggest-text';
  const primary = document.createElement('div');
  primary.className = 'follow-suggest-primary';
  primary.textContent = 'See all (' + count + ')';
  text.appendChild(primary);
  row.appendChild(text);
  return row;
}

function onListPointerDown(event) {
  const row = event.target && event.target.closest && event.target.closest('.follow-suggest-row');
  if (!row || !openInput) return;
  event.preventDefault();
  event.stopPropagation();
  drag = {
    index: Number(row.dataset.index),
    seeAll: row.dataset.seeAll === '1',
    y: event.clientY,
    moved: false,
    id: event.pointerId,
  };
  if (list.setPointerCapture) {
    try { list.setPointerCapture(event.pointerId); } catch { /* already released */ }
  }
}

function onListPointerMove(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.abs(dy) <= 8) return;
  drag.moved = true;
  list.scrollTop -= dy;
  drag.y = event.clientY;
}

function onListPointerUp(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const index = drag.index;
  const seeAll = drag.seeAll;
  const moved = drag.moved;
  drag = null;
  event.stopPropagation();
  if (moved) return;
  if (seeAll) {
    openSpecPicker(openSpec, openInput ? openInput.value : '');
    return;
  }
  pick(index);
}

function syncAria() {
  const open = !!(openInput && list && !list.hidden);
  for (const spec of specs) {
    const input = spec.input;
    const mine = open && input === openInput;
    input.setAttribute('aria-expanded', mine ? 'true' : 'false');
    if (mine && activeIndex >= 0) {
      const desc = activeIndex >= quickCount() ? 'follow-suggest-see-all' : 'follow-suggest-opt-' + activeIndex;
      input.setAttribute('aria-activedescendant', desc);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
}

function hideList() {
  rows = [];
  activeIndex = -1;
  clearTimeout(hideTimer);
  if (list) {
    list.classList.remove('is-open');
    list.hidden = true;
    list.replaceChildren();
  }
  syncAria();
}

function close() {
  showToken += 1;
  clearTimeout(blurTimer);
  openInput = null;
  openSpec = null;
  drag = null;
  rows = [];
  activeIndex = -1;
  if (!list || list.hidden) {
    hideList();
    return;
  }
  list.classList.remove('is-open');
  syncAria();
  const finish = () => {
    if (openInput) return;
    list.hidden = true;
    list.replaceChildren();
  };
  clearTimeout(hideTimer);
  if (reducedMotion()) finish();
  else hideTimer = setTimeout(finish, 120);
}

function viewportBox() {
  const vv = window.visualViewport;
  return {
    height: vv ? vv.height : window.innerHeight,
    offsetTop: vv ? vv.offsetTop : 0,
    offsetLeft: vv ? vv.offsetLeft : 0,
  };
}

function place() {
  if (!openInput || !list || list.hidden) return;
  const rect = openInput.getBoundingClientRect();
  const box = viewportBox();
  const gap = box.height * 0.005;
  const width = rect.width;
  list.style.left = (rect.left - box.offsetLeft) + 'px';
  list.style.width = width + 'px';
  list.style.right = 'auto';
  const listHeight = list.offsetHeight || 0;
  const below = box.height - (rect.bottom - box.offsetTop) - gap;
  const above = (rect.top - box.offsetTop) - gap;
  if (listHeight > below && above > below) {
    const top = Math.max(gap, rect.top - box.offsetTop - gap - listHeight);
    list.style.top = top + 'px';
  } else {
    list.style.top = (rect.bottom - box.offsetTop + gap) + 'px';
  }
}

function paintActive() {
  if (!list) return;
  const nodes = list.querySelectorAll('.follow-suggest-row');
  for (let i = 0; i < nodes.length; i++) {
    const on = i === activeIndex;
    nodes[i].classList.toggle('is-active', on);
    nodes[i].setAttribute('aria-selected', on ? 'true' : 'false');
    if (on && nodes[i].scrollIntoView) nodes[i].scrollIntoView({ block: 'nearest' });
  }
  syncAria();
}

function quickCount() {
  return Math.min(QUICK, rows.length);
}

function slotCount() {
  return rows.length ? quickCount() + 1 : 0;
}

function paintRows(query) {
  ensureList();
  clearTimeout(hideTimer);
  list.replaceChildren();
  const shown = quickCount();
  for (let i = 0; i < shown; i++) list.appendChild(rowElement(rows[i], query, i));
  list.appendChild(seeAllElement(rows.length));
  list.hidden = false;
  if (reducedMotion()) list.classList.add('is-open');
  else {
    list.classList.remove('is-open');
    void list.offsetWidth;
    list.classList.add('is-open');
  }
}

function render() {
  if (!openInput || !openSpec) return;
  const data = cacheData && cacheAccount === connectedAccount ? cacheData : null;
  if (!connectedAccount || !data) {
    hideList();
    return;
  }
  rows = buildItems(data, openSpec, openInput.value || '');
  activeIndex = -1;
  if (!rows.length) {
    hideList();
    return;
  }
  paintRows(openInput.value || '');
  place();
  syncAria();
}

function openFor(spec, allowRetry) {
  if (!spec || !spec.input) return;
  clearTimeout(blurTimer);
  const token = ++showToken;
  openInput = spec.input;
  openSpec = spec;
  if (!connectedAccount) {
    openInput = null;
    openSpec = null;
    hideList();
    return;
  }
  ensureData(!!allowRetry).then((data) => {
    if (token !== showToken || openInput !== spec.input) return;
    if (!data) {
      hideList();
      return;
    }
    render();
  });
}

function writePick(spec, item) {
  const input = spec.input;
  picking = true;
  input.value = spec.fill === 'topic' && item.topic ? item.topic : item.id;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  picking = false;
}

function pick(index) {
  const item = rows[index];
  const input = openInput;
  const submit = openSpec && openSpec.submit;
  if (!item || !input || !submit) return;
  writePick(openSpec, item);
  close();
  submit();
}

function openSpecPicker(spec, query) {
  if (!spec) return;
  const kinds = spec.kinds.slice();
  const dimMissing = spec.dimMissing;
  const q = query == null ? '' : String(query);
  close();
  openPicker({
    title: 'Following',
    kinds,
    dimMissing,
    query: q,
  }).then((item) => {
    if (!item || !spec.input || !spec.input.isConnected) return;
    writePick(spec, item);
    if (openInput === spec.input) close();
    spec.submit();
  });
}

function move(delta) {
  const count = slotCount();
  if (!count) return;
  if (activeIndex < 0) activeIndex = delta > 0 ? 0 : count - 1;
  else activeIndex = (activeIndex + delta + count) % count;
  paintActive();
}

function onKeyDown(event) {
  const spec = specs.find((item) => item.input === event.currentTarget);
  if (!spec) return;
  const visible = openInput === spec.input && list && !list.hidden && rows.length > 0;
  if (event.key === 'ArrowDown' && visible) {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp' && visible) {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter' && visible && activeIndex >= 0) {
    event.preventDefault();
    if (activeIndex >= quickCount()) openSpecPicker(spec, spec.input.value || '');
    else pick(activeIndex);
  } else if (event.key === 'Escape' && openInput === spec.input) {
    event.preventDefault();
    close();
  } else if (event.key === 'Tab' && openInput === spec.input) {
    close();
  }
}

function onDocPointer(event) {
  if (!openInput) return;
  if (openInput.contains && openInput.contains(event.target)) return;
  if (list && list.contains(event.target)) return;
  close();
}

function panelHidden(panel) {
  if (!panel) return false;
  if (panel.hidden) return true;
  if (panel.style && panel.style.display === 'none') return true;
  if (typeof getComputedStyle === 'function') {
    try {
      if (getComputedStyle(panel).display === 'none') return true;
    } catch { /* detached */ }
  }
  return false;
}

function watchPanels() {
  if (typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => {
    if (openSpec && panelHidden(openSpec.panel)) close();
  });
  for (const spec of specs) {
    if (spec.panel) observer.observe(spec.panel, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }
}

function submitLoad() {
  const button = document.getElementById('toolbar-load');
  if (button) button.click();
}

function submitTopic() {
  const button = document.getElementById('load-msgs-from');
  if (button) button.click();
}

function submitE2ee() {
  const key = document.getElementById('encrypted-chat-private-key');
  if (key && key.value) {
    const button = document.getElementById('load-msgs-from-encrypted-chat');
    if (button) button.click();
    return;
  }
  if (key) key.focus();
}

function arm(input) {
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', LIST_ID);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.spellcheck = false;
}

export function attachFollowSuggest(input, { kinds, submit, fill, dimMissing } = {}) {
  if (!input || armed.has(input)) return;
  armed.add(input);
  const spec = {
    input,
    kinds: Array.isArray(kinds) ? kinds.slice() : [],
    fill: fill === 'topic' ? 'topic' : 'account',
    dimMissing: !!dimMissing,
    submit: typeof submit === 'function' ? submit : function () {},
    panel: document.getElementById(PANELS[input.id] || '') || null,
  };
  specs.push(spec);
  ensureList();
  arm(input);
  input.addEventListener('focus', () => openFor(spec, true));
  input.addEventListener('click', () => openFor(spec, true));
  input.addEventListener('input', () => {
    if (picking) return;
    if (document.activeElement === input) openFor(spec, false);
  });
  input.addEventListener('blur', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (openInput === input) close();
    }, 120);
  });
  input.addEventListener('keydown', onKeyDown);
}

function bindPickButton(button, input) {
  if (!button || !input) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const spec = specs.find((item) => item.input === input);
    if (spec) openSpecPicker(spec, '');
  });
}

function boot() {
  if (booted) return;
  booted = true;
  const load = document.getElementById('input-field');
  const topic = document.getElementById('topic-chat-topic-id');
  const e2ee = document.getElementById('encrypted-chat-topic-id');
  if (load) attachFollowSuggest(load, { kinds: ['accounts'], fill: 'topic', submit: submitLoad });
  if (topic) attachFollowSuggest(topic, { kinds: ['accounts'], fill: 'topic', submit: submitTopic });
  if (e2ee) attachFollowSuggest(e2ee, { kinds: ['accounts'], dimMissing: true, submit: submitE2ee });
  bindPickButton(document.getElementById('input-field-follow'), load);
  bindPickButton(document.getElementById('topic-chat-follow'), topic);
  bindPickButton(document.getElementById('encrypted-chat-follow'), e2ee);
  document.addEventListener('pointerdown', onDocPointer, true);
  document.addEventListener('profiles-loaded', () => {
    if (openInput && list && !list.hidden) render();
  });
  window.addEventListener('scroll', () => {
    if (openInput && list && !list.hidden) place();
  }, true);
  window.addEventListener('resize', () => {
    if (openInput && list && !list.hidden) place();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (openInput && list && !list.hidden) place();
    });
    window.visualViewport.addEventListener('scroll', () => {
      if (openInput && list && !list.hidden) place();
    });
  }
  watchPanels();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
