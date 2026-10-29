// Donate pill, sheet, and the reads that fill them.
// The account that receives HBAR comes from the server, which reads the
// original message's payer. The post body is never that account.

import { BACKEND_URL } from './msgbackend.js';
import { connectedAccount } from './web3.js';
import { sendHbarDonation } from './hedera.js';
import { toast } from './toast.js';
import {
  bareAccount,
  formatHbar,
  hbarToTinybar,
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
  const shown = total && total !== '0' ? total : '';
  const amount = pill.querySelector('.donate-amount');
  if (amount) amount.textContent = shown;
  pill.classList.toggle('has-total', shown !== '');
  const label = shown ? `Donate ${shown} HBAR` : 'Donate';
  pill.setAttribute('aria-label', label);
  pill.title = label;
}

function paintPills(topicId, ts, total) {
  const key = topicId + '|' + ts;
  document.querySelectorAll('.donate-pill').forEach((pill) => {
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
  root.querySelectorAll('.donate-pill').forEach(queuePill);
}

export function createDonatePill(data) {
  const topicId = bareAccount(data && data.topicId);
  const ts = normalizeConsensusTs(data && data.consensusTimestamp);
  const created = typeof (data && data.created) === 'string' ? data.created : '';
  if (!topicId || (!ts && !created)) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'donate-pill';
  button.dataset.topic = topicId;
  if (ts) button.dataset.ts = ts;
  if (created) button.dataset.created = created;
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

function ensureSheet() {
  if (sheet) return sheet;
  const root = document.createElement('div');
  root.id = 'donate-sheet';
  root.hidden = true;
  const card = document.createElement('form');
  card.className = 'donate-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Donate HBAR');
  const title = document.createElement('h2');
  title.className = 'donate-title';
  title.textContent = 'Donate HBAR';
  const amountLabel = document.createElement('label');
  amountLabel.className = 'donate-label';
  amountLabel.textContent = 'Amount';
  const amount = document.createElement('input');
  amount.id = 'donate-amount';
  amount.className = 'donate-input';
  amount.inputMode = 'decimal';
  amount.autocomplete = 'off';
  amount.spellcheck = false;
  amount.placeholder = '0.1';
  amountLabel.appendChild(amount);
  const memoLabel = document.createElement('label');
  memoLabel.className = 'donate-label';
  memoLabel.textContent = 'Memo';
  const memo = document.createElement('input');
  memo.id = 'donate-memo';
  memo.className = 'donate-input';
  memo.autocomplete = 'off';
  memo.spellcheck = false;
  memo.placeholder = 'Optional';
  memoLabel.appendChild(memo);
  const bytes = document.createElement('p');
  bytes.className = 'donate-bytes';
  bytes.textContent = '0/100';
  const echo = memoLine('');
  const actions = document.createElement('div');
  actions.className = 'donate-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'donate-cancel';
  cancel.textContent = 'Cancel';
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'donate-send';
  send.textContent = 'Donate';
  actions.append(cancel, send);
  card.append(title, amountLabel, memoLabel, bytes, echo, actions);
  root.appendChild(card);
  memo.addEventListener('input', () => {
    const text = memo.value;
    echo.textContent = text;
    bytes.textContent = `${utf8ByteLength(text)}/${MEMO_MAX_BYTES}`;
  });
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
  document.body.appendChild(root);
  sheet = root;
  return root;
}

function closeSheet() {
  if (!sheet || sheetBusy) return;
  sheet.hidden = true;
  sheetTopic = '';
  sheetTs = '';
  sheetAccount = '';
  sheetSent = false;
}

function showSheet(topicId, ts, account) {
  const root = ensureSheet();
  sheetTopic = topicId;
  sheetTs = ts;
  sheetAccount = account;
  const amount = root.querySelector('#donate-amount');
  const memo = root.querySelector('#donate-memo');
  const echo = root.querySelector('.donate-memo');
  const bytes = root.querySelector('.donate-bytes');
  const send = root.querySelector('.donate-send');
  const title = root.querySelector('.donate-title');
  sheetSent = false;
  if (title) title.textContent = 'Donate HBAR';
  if (amount) amount.value = '';
  if (memo) memo.value = '';
  if (echo) echo.textContent = '';
  if (bytes) bytes.textContent = `0/${MEMO_MAX_BYTES}`;
  if (send) send.textContent = 'Donate';
  root.hidden = false;
  if (amount) amount.focus();
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
  if (error === 'below minimum') return 'Enter at least 0.1 HBAR';
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
  const echo = sheet.querySelector('.donate-memo');
  const title = sheet.querySelector('.donate-title');
  const tiny = hbarToTinybar(amountInput ? amountInput.value : '');
  if (tiny == null) {
    toast.info('Enter at least 0.1 HBAR');
    return;
  }
  const memo = memoInput ? memoInput.value : '';
  if (utf8ByteLength(memo) > MEMO_MAX_BYTES) {
    toast.info('Memo is too long');
    return;
  }
  sheetBusy = true;
  if (send) send.textContent = 'Sending…';
  const topicId = sheetTopic;
  const ts = sheetTs;
  const account = sheetAccount;
  try {
    const txId = await sendHbarDonation({ toAccountId: account, tinybar: tiny.toString(), memo });
    if (send) send.textContent = 'Checking…';
    const res = await fetch(BACKEND_URL + '/api/donations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txId, topicId, postTimestamp: ts }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      toast.error(donationError(data && data.error));
      return;
    }
    paintPills(topicId, ts, data.total);
    if (title) title.textContent = 'Sent';
    if (echo) echo.textContent = data.memo ? String(data.memo) : 'Sent';
    sheetSent = true;
    if (send) send.textContent = 'Close';
    toast.success('Donation sent');
  } catch {
    toast.error("Couldn't send the donation");
  } finally {
    sheetBusy = false;
    if (send && sheet && !sheet.hidden && !sheetSent) send.textContent = 'Donate';
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
      el.textContent = `Received ${received} HBAR`;
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
