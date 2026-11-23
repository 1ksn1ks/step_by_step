// Follower count, how many accounts and topics this profile follows, and
// HBAR received, under the name on a profile. No followers list and no
// donations list are mounted, so the counts stay static.

import { BACKEND_URL, fetchFollowing } from './msgbackend.js';
import { bareAccount, formatDonationAmount } from './donationmath.js';
import { formatCount, formatHbarCount } from './countformat.js';
import { followerCountOrNull } from './followcount.js';
import { cachedPersonFollow, readPersonFollow } from './followtopic.js';
import { earlyHashinalNumber } from './earlyhashinal.js';

const exact = new Intl.NumberFormat('en');

function statLabel(kind) {
  if (kind === 'received') return 'Received';
  if (kind === 'following') return 'Following';
  return 'Followers';
}

function makeStat(kind) {
  const root = document.createElement('div');
  root.className = 'profile-stat' + (kind === 'received' ? ' profile-stat-received' : '');
  const num = document.createElement('span');
  num.className = 'profile-stat-num';
  const label = document.createElement('span');
  label.className = 'profile-stat-label';
  label.textContent = statLabel(kind);
  if (kind === 'received') {
    const hbar = document.createElement('span');
    hbar.className = 'profile-stat-hbar';
    hbar.textContent = '\u210F';
    root.append(num, hbar, label);
  } else {
    root.append(num, label);
  }
  return { root, num };
}

function markZero(stat, zero) {
  stat.root.classList.toggle('is-zero', !!zero);
}

function setExact(num, text) {
  num.title = text;
  num.setAttribute('aria-label', text);
}

function clearExact(num) {
  num.removeAttribute('title');
  num.removeAttribute('aria-label');
}

export function paintProfileStats(el, account) {
  if (!el) return;
  if (typeof el._dropProfileStats === 'function') el._dropProfileStats();
  const id = bareAccount(account);
  const token = String(Date.now()) + ':' + Math.random();
  el.className = 'profile-stats';
  el.dataset.style = 'glass';
  el.dataset.statsFor = id;
  el.dataset.statsToken = token;
  el.replaceChildren();

  const followers = makeStat('followers');
  const following = makeStat('following');
  const received = makeStat('received');
  el.append(followers.root, following.root, received.root);
  followers.num.textContent = formatCount(0);
  setExact(followers.num, exact.format(0));
  following.num.textContent = '\u2013';
  received.num.textContent = formatHbarCount(0);
  setExact(received.num, formatDonationAmount(0));
  markZero(followers, true);
  markZero(following, true);
  markZero(received, true);

  const current = () => el.dataset.statsToken === token && el.dataset.statsFor === id;

  function paintStyle() {
    el.dataset.style = id && earlyHashinalNumber(id) > 0 ? 'hashinals' : 'glass';
  }

  function applyFollowers(n) {
    if (!current()) return;
    const value = followerCountOrNull(n);
    const shown = value == null ? 0 : value;
    followers.num.textContent = formatCount(shown);
    setExact(followers.num, exact.format(shown));
    markZero(followers, shown === 0);
  }

  function applyReceived(raw) {
    if (!current()) return;
    const amount = Number(raw);
    received.num.textContent = formatHbarCount(raw);
    setExact(received.num, formatDonationAmount(raw));
    markZero(received, !(amount > 0));
  }

  function applyFollowing(n) {
    if (!current()) return;
    // No reply (null, or the request failed): not a count of zero.
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      following.num.textContent = '\u2013';
      clearExact(following.num);
      markZero(following, true);
      return;
    }
    const shown = n > 0 ? n : 0;
    following.num.textContent = formatCount(shown);
    setExact(following.num, exact.format(shown));
    markZero(following, shown === 0);
  }

  function drop() {
    document.removeEventListener('early-hashinals', onEarly);
    document.removeEventListener('profile-follow-count', onCount);
    el._dropProfileStats = null;
  }

  function onEarly() {
    if (!el.isConnected) {
      drop();
      return;
    }
    paintStyle();
  }

  function onCount(event) {
    if (!el.isConnected) {
      drop();
      return;
    }
    const detail = event.detail || {};
    if (bareAccount(detail.account) !== id) return;
    applyFollowers(detail.followers);
  }

  paintStyle();
  document.addEventListener('early-hashinals', onEarly);
  document.addEventListener('profile-follow-count', onCount);
  el._dropProfileStats = drop;

  if (!id) return;
  const known = cachedPersonFollow(id);
  if (known) applyFollowers(known.followers);
  readPersonFollow(id).then((data) => {
    if (data) applyFollowers(data.followers);
  }).catch(() => {});
  fetch(BACKEND_URL + '/api/donations/account/' + encodeURIComponent(id))
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!el.isConnected) {
        drop();
        return;
      }
      const raw = data && typeof data.received === 'string' ? data.received : '0';
      applyReceived(raw);
    })
    .catch(() => {
      if (el.isConnected) applyReceived('0');
      else drop();
    });
  fetchFollowing(id).then((data) => {
    if (!el.isConnected) {
      drop();
      return;
    }
    if (!data) {
      applyFollowing(null);
      return;
    }
    const accounts = Array.isArray(data.accounts) ? data.accounts.length : 0;
    const topics = Array.isArray(data.topics) ? data.topics.length : 0;
    applyFollowing(accounts + topics);
  }).catch(() => {
    if (el.isConnected) applyFollowing(null);
    else drop();
  });
}
