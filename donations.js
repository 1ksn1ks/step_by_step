// Donate pill, sheet, and the reads that fill them.
// The account that receives HBAR comes from the server, which reads the
// original message's payer. The post body is never that account.

import { BACKEND_URL } from './msgbackend.js';
import { connectedAccount } from './web3.js';
import { sendHbarDonation } from './hedera.js';
import { toast } from './toast.js';
import { profilePictures, usernames } from './loadalladata.js';
import {
  bareAccount,
  formatDonationAmount,
  formatHbar,
  hbarToTinybar,
  mirrorTxPath,
  normalizeConsensusTs,
  utf8ByteLength,
  MEMO_MAX_BYTES,
} from './donationmath.js';

const COIN = [
  ['circle', { cx: '12', cy: '12', r: '8' }],
  ['path', { d: 'M12 8v8' }],
  ['path', { d: 'M9.6 9.6c.4-.7 1.2-1.1 2.4-1.1 1.4 0 2.3.6 2.3 1.6S13.4 11.6 12 11.8c-1.4.2-2.4.8-2.4 1.8s.9 1.6 2.4 1.6c1.1 0 1.9-.4 2.3-1' }],
];

const pending = new Set();
let flushTimer = 0;
let sheet;
let sheetTopic = '';
let sheetTs = '';
let sheetAccount = '';
let sheetBusy = false;
let sheetSent = false;
let sheetOpenId = 0;
let sheetCloseTimer = 0;

const DEFAULT_AVATAR = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
const PRESETS = ['1', '5', '10', '25'];
const SENT_CLOSE_MS = 2000;

function coinIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [name, attrs] of COIN) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

function paintPill(pill, total) {
  const n = Number(total);
  const shown = Number.isFinite(n) && n > 0 ? formatDonationAmount(n) : '';
  const amount = pill.querySelector('.donate-amount');
  if (amount) amount.textContent = shown;
  if (pill.classList.contains('post-menu-donate')) {
    if (amount) {
      amount.textContent = shown ? `${shown} ℏ donated` : '';
      amount.hidden = shown === '';
    }
    pill.setAttribute('aria-label', shown ? `Donate HBAR, ${shown} ℏ donated` : 'Donate HBAR');
    return;
  }
  pill.classList.toggle('has-total', shown !== '');
  const label = shown ? `Donate ${shown} HBAR` : 'Donate';
  pill.setAttribute('aria-label', label);
  pill.title = label;
}

function paintPills(topicId, ts, total) {
  const key = topicId + '|' + ts;
  document.querySelectorAll('.donate-pill, .post-menu-donate').forEach((pill) => {
    const pillKey = (pill.dataset.topic || '') + '|' + (pill.dataset.ts || '');
    if (pillKey !== key) return;
    paintPill(pill, total);
    pill.dataset.donState = 'ready';
  });
}

function applyBatchRow(row, pills) {
  if (!row || !pills) return;
  for (const pill of pills) {
    if (!pill.isConnected) continue;
    if (!row.found) {
      pill.dataset.donState = '';
      pill.dataset.donRetry = String(Date.now() + 20000);
      continue;
    }
    if (row.ts) pill.dataset.ts = row.ts;
    paintPill(pill, row.total);
    pill.dataset.donState = 'ready';
  }
}

async function flushDonations() {
  flushTimer = 0;
  const pills = [...pending].filter((pill) => pill.isConnected);
  pending.clear();
  const groups = new Map();
  const items = [];
  for (const pill of pills) {
    if (Date.now() < Number(pill.dataset.donRetry || 0)) {
      pill.dataset.donState = '';
      continue;
    }
    const topicId = pill.dataset.topic || '';
    const ts = pill.dataset.ts || '';
    const created = pill.dataset.created || '';
    if (!topicId || (!ts && !created)) continue;
    const key = topicId + '|' + (ts || created);
    if (!groups.has(key)) {
      groups.set(key, []);
      items.push(ts ? { topicId, ts } : { topicId, created });
    }
    groups.get(key).push(pill);
    pill.dataset.donState = 'wait';
  }
  if (!items.length) return;
  let rows = [];
  try {
    const res = await fetch(BACKEND_URL + '/api/donations/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posts: items }),
    });
    if (!res.ok) throw new Error('batch');
    const data = await res.json();
    rows = data && Array.isArray(data.posts) ? data.posts : [];
  } catch {
    for (const pill of pills) {
      if (pill.dataset.donState === 'wait') {
        pill.dataset.donState = '';
        pill.dataset.donRetry = String(Date.now() + 20000);
      }
    }
    return;
  }
  rows.forEach((row, index) => {
    const item = items[index];
    if (!item) return;
    const key = item.topicId + '|' + (item.ts || item.created);
    applyBatchRow(row, groups.get(key));
  });
}

function queuePill(pill) {
  if (!pill || pill.dataset.donState === 'ready' || pill.dataset.donState === 'wait') return;
  pending.add(pill);
  if (flushTimer) return;
  flushTimer = setTimeout(flushDonations, 180);
}

export function noteVisibleDonation(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('.donate-pill, .post-menu-donate').forEach(queuePill);
}

// The post menu and the old pill share one identity: topic plus the
// consensus time, or the ISO time until that time is known.
export function bindDonationTarget(el, data) {
  const topicId = bareAccount(data && data.topicId);
  const ts = normalizeConsensusTs(data && data.consensusTimestamp);
  const created = typeof (data && data.created) === 'string' ? data.created : '';
  if (!el || !topicId || (!ts && !created)) return false;
  el.dataset.topic = topicId;
  if (ts) el.dataset.ts = ts;
  else delete el.dataset.ts;
  if (created) el.dataset.created = created;
  return true;
}

export function openDonation(el) {
  return openDonate(el);
}

export function createDonatePill(data) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'donate-pill';
  if (!bindDonationTarget(button, data)) return null;
  button.appendChild(coinIcon());
  const amount = document.createElement('span');
  amount.className = 'donate-amount';
  button.appendChild(amount);
  paintPill(button, '0');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openDonate(button);
  });
  return button;
}

function memoLine(text) {
  const line = document.createElement('p');
  line.className = 'donate-memo';
  line.textContent = text == null ? '' : String(text);
  return line;
}

function httpPicture(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function recipientAvatar(account) {
  const raw = profilePictures[account] && profilePictures[account].url;
  return httpPicture(raw) || DEFAULT_AVATAR;
}

function recipientLabel(account) {
  const name = usernames[account] && usernames[account].username;
  const text = typeof name === 'string' ? name.trim() : '';
  return text || account;
}

function sheetPart(selector) {
  return sheet ? sheet.querySelector(selector) : null;
}

function showError(text) {
  const error = sheetPart('.donate-error');
  if (!error) return;
  error.textContent = text || '';
  error.hidden = !text;
}

function lockFields(locked) {
  if (!sheet) return;
  sheet.querySelectorAll('#donate-amount, #donate-memo, .donate-chip').forEach((el) => {
    el.disabled = locked;
  });
}

function paintSend() {
  if (!sheet || sheetBusy || sheetSent) return;
  const amount = sheetPart('#donate-amount');
  const memo = sheetPart('#donate-memo');
  const send = sheetPart('.donate-send');
  const bytes = sheetPart('.donate-bytes');
  const raw = amount ? amount.value.trim() : '';
  const tiny = hbarToTinybar(raw);
  const count = utf8ByteLength(memo ? memo.value : '');
  const over = count > MEMO_MAX_BYTES;
  if (bytes) {
    bytes.textContent = `${count}/${MEMO_MAX_BYTES} bytes`;
    bytes.classList.toggle('is-over', over);
  }
  sheet.querySelectorAll('.donate-chip').forEach((chip) => {
    chip.setAttribute('aria-pressed', raw === chip.dataset.hbar ? 'true' : 'false');
  });
  let message = '';
  if (over) message = 'Memo is too long';
  else if (raw !== '' && tiny == null) message = `Enter at least ${formatDonationAmount('0.1')} HBAR`;
  showError(message);
  const ok = tiny != null && !over;
  if (send) {
    send.disabled = !ok;
    send.textContent = ok ? `Donate ${formatDonationAmount(formatHbar(tiny))} HBAR` : 'Donate';
  }
  lockFields(false);
}

function scheduleClose() {
  const openId = sheetOpenId;
  if (sheetCloseTimer) clearTimeout(sheetCloseTimer);
  sheetCloseTimer = setTimeout(() => {
    sheetCloseTimer = 0;
    if (openId !== sheetOpenId || !sheet || sheet.hidden || sheetBusy) return;
    closeSheet();
  }, SENT_CLOSE_MS);
}

function showSent(tiny, txId) {
  const form = sheetPart('.donate-form');
  const done = sheetPart('.donate-done');
  const sent = sheetPart('.donate-sent');
  const link = sheetPart('.donate-hash');
  const label = formatDonationAmount(formatHbar(tiny));
  if (sent) sent.textContent = `Sent ${label} HBAR`;
  const path = mirrorTxPath(txId);
  if (link) {
    if (path) {
      link.href = `https://hashscan.io/mainnet/transaction/${path}`;
      link.hidden = false;
    } else {
      link.hidden = true;
      link.removeAttribute('href');
    }
  }
  if (form) form.hidden = true;
  if (done) done.hidden = false;
  sheetSent = true;
  scheduleClose();
}

function ensureSheet() {
  if (sheet) return sheet;
  const root = document.createElement('div');
  root.id = 'donate-sheet';
  root.hidden = true;
  const card = document.createElement('form');
  card.className = 'donate-card';
  card.noValidate = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'donate-title');

  const head = document.createElement('div');
  head.className = 'donate-head';
  const avatar = document.createElement('img');
  avatar.className = 'donate-avatar';
  avatar.alt = '';
  avatar.addEventListener('error', () => {
    if (!avatar.src.endsWith('/0.0.4819119')) avatar.src = DEFAULT_AVATAR;
  });
  const who = document.createElement('div');
  who.className = 'donate-who';
  const title = document.createElement('h2');
  title.id = 'donate-title';
  title.className = 'donate-title';
  title.textContent = 'Donate';
  const accountLine = document.createElement('p');
  accountLine.className = 'donate-account';
  accountLine.hidden = true;
  who.append(title, accountLine);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'donate-x';
  cancel.setAttribute('aria-label', 'Cancel');
  cancel.textContent = '×';
  head.append(avatar, who, cancel);

  const form = document.createElement('div');
  form.className = 'donate-form';
  const chips = document.createElement('div');
  chips.className = 'donate-chips';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'HBAR amount');
  const amount = document.createElement('input');
  amount.id = 'donate-amount';
  amount.className = 'donate-input';
  amount.inputMode = 'decimal';
  amount.autocomplete = 'off';
  amount.spellcheck = false;
  amount.placeholder = 'Custom';
  amount.setAttribute('aria-label', 'Custom amount');
  const memoField = document.createElement('div');
  memoField.className = 'donate-memo-field';
  const memo = document.createElement('input');
  memo.id = 'donate-memo';
  memo.className = 'donate-input';
  memo.autocomplete = 'off';
  memo.spellcheck = false;
  memo.placeholder = 'Memo';
  memo.setAttribute('aria-label', 'Memo');
  const bytes = document.createElement('span');
  bytes.className = 'donate-bytes';
  bytes.textContent = `0/${MEMO_MAX_BYTES} bytes`;
  memoField.append(memo, bytes);
  const error = document.createElement('p');
  error.className = 'donate-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'donate-send';
  send.textContent = 'Donate';
  send.disabled = true;
  form.append(chips, amount, memoField, error, send);

  const done = document.createElement('div');
  done.className = 'donate-done';
  done.hidden = true;
  const sent = document.createElement('p');
  sent.className = 'donate-sent';
  const link = document.createElement('a');
  link.className = 'donate-hash';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'View on HashScan';
  done.append(sent, link);

  for (const preset of PRESETS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'donate-chip';
    chip.dataset.hbar = preset;
    chip.textContent = preset;
    chip.setAttribute('aria-label', `${preset} HBAR`);
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      if (sheetBusy || sheetSent) return;
      amount.value = preset;
      paintSend();
      amount.focus({ preventScroll: true });
    });
    chips.appendChild(chip);
  }

  card.append(head, form, done);
  root.appendChild(card);
  amount.addEventListener('input', paintSend);
  memo.addEventListener('input', paintSend);
  cancel.addEventListener('click', (event) => {
    event.preventDefault();
    closeSheet();
  });
  card.addEventListener('submit', (event) => {
    event.preventDefault();
    submitDonation();
  });
  root.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target === root) closeSheet();
  });
  card.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !sheet || sheet.hidden) return;
    if (sheetBusy) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    closeSheet();
  }, true);
  document.body.appendChild(root);
  sheet = root;
  return root;
}

function closeSheet() {
  if (!sheet || sheetBusy) return;
  if (sheetCloseTimer) {
    clearTimeout(sheetCloseTimer);
    sheetCloseTimer = 0;
  }
  sheet.hidden = true;
  sheetTopic = '';
  sheetTs = '';
  sheetAccount = '';
  sheetSent = false;
}

function showSheet(topicId, ts, account) {
  if (sheetBusy) return;
  const root = ensureSheet();
  if (sheetCloseTimer) {
    clearTimeout(sheetCloseTimer);
    sheetCloseTimer = 0;
  }
  sheetOpenId += 1;
  sheetTopic = topicId;
  sheetTs = ts;
  sheetAccount = account;
  sheetSent = false;
  const amount = root.querySelector('#donate-amount');
  const memo = root.querySelector('#donate-memo');
  const form = root.querySelector('.donate-form');
  const done = root.querySelector('.donate-done');
  const title = root.querySelector('.donate-title');
  const accountLine = root.querySelector('.donate-account');
  const avatar = root.querySelector('.donate-avatar');
  const name = recipientLabel(account);
  if (amount) amount.value = '';
  if (memo) memo.value = '';
  if (form) form.hidden = false;
  if (done) done.hidden = true;
  if (title) title.textContent = `Donate to ${name}`;
  if (accountLine) {
    const showId = name !== account;
    accountLine.textContent = showId ? account : '';
    accountLine.hidden = !showId;
  }
  if (avatar) avatar.src = recipientAvatar(account);
  lockFields(false);
  paintSend();
  root.hidden = false;
  if (amount) amount.focus({ preventScroll: true });
}

async function resolveTimestamp(pill) {
  if (pill.dataset.ts) return pill.dataset.ts;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = 0;
  }
  pending.add(pill);
  await flushDonations();
  return pill.dataset.ts || '';
}

async function openDonate(pill) {
  const topicId = pill.dataset.topic || '';
  const ts = await resolveTimestamp(pill);
  if (!topicId || !ts) {
    toast.error("Couldn't find that post");
    return;
  }
  if (!bareAccount(connectedAccount)) {
    toast.info('Connect wallet first');
    return;
  }
  let account = '';
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/donations/recipient/${encodeURIComponent(topicId)}/${encodeURIComponent(ts)}`
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.account) {
      toast.error("Couldn't find that post");
      return;
    }
    account = bareAccount(data.account);
  } catch {
    toast.error("Couldn't find that post");
    return;
  }
  if (!account) {
    toast.error("Couldn't find that post");
    return;
  }
  if (account === bareAccount(connectedAccount)) {
    toast.info("You can't donate to your own post");
    return;
  }
  showSheet(topicId, ts, account);
}

function donationError(error) {
  if (error === 'already recorded') return 'That donation is already counted';
  if (error === 'wrong recipient' || error === 'not a transfer' || error === 'failed') {
    return 'That payment did not go to the author';
  }
  if (error === 'own post') return "You can't donate to your own post";
  if (error === 'below minimum') return `Enter at least ${formatDonationAmount('0.1')} HBAR`;
  if (error === 'transaction not found') return "That payment isn't on the network yet";
  if (error === 'post not found' || error === 'not a post') return "Couldn't find that post";
  return "Couldn't record the donation";
}

async function submitDonation() {
  if (sheetSent) {
    closeSheet();
    return;
  }
  if (sheetBusy || !sheet || !sheetAccount) return;
  const amountInput = sheet.querySelector('#donate-amount');
  const memoInput = sheet.querySelector('#donate-memo');
  const send = sheet.querySelector('.donate-send');
  const tiny = hbarToTinybar(amountInput ? amountInput.value : '');
  const memo = memoInput ? memoInput.value : '';
  if (tiny == null || utf8ByteLength(memo) > MEMO_MAX_BYTES) {
    paintSend();
    return;
  }
  sheetBusy = true;
  showError('');
  lockFields(true);
  if (send) {
    send.disabled = true;
    send.textContent = 'Sending…';
  }
  const topicId = sheetTopic;
  const ts = sheetTs;
  const account = sheetAccount;
  let failure = '';
  try {
    const txId = await sendHbarDonation({ toAccountId: account, tinybar: tiny.toString(), memo });
    if (send && sheet && !sheet.hidden) send.textContent = 'Checking…';
    const res = await fetch(BACKEND_URL + '/api/donations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txId, topicId, postTimestamp: ts }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      failure = donationError(data && data.error);
      return;
    }
    paintPills(topicId, ts, data.total);
    showSent(tiny, txId);
  } catch {
    failure = "Couldn't send the donation";
  } finally {
    sheetBusy = false;
    if (!sheetSent) {
      paintSend();
      if (failure) showError(failure);
    }
  }
}

export function paintReceived(el, account) {
  if (!el) return;
  el.textContent = '';
  const id = bareAccount(account);
  if (!id) return;
  el.dataset.receivedFor = id;
  fetch(BACKEND_URL + '/api/donations/account/' + encodeURIComponent(id))
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !el.isConnected || el.dataset.receivedFor !== id) return;
      const received = typeof data.received === 'string' ? data.received : formatHbar(0);
      el.textContent = `Received ${formatDonationAmount(received)} HBAR`;
    })
    .catch(() => {});
}

// The sheet shows a memo with textContent. Tests call this to mount that
// line without going through a wallet.
export function mountMemoLine(parent, text) {
  const line = memoLine(text);
  parent.appendChild(line);
  return line;
}

if (typeof document !== 'undefined' && document.body) ensureSheet();
