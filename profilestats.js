// Follower count, how many accounts and topics this profile follows, and
// HBAR received, under the name on a profile. No followers list and no
// donations list are mounted, so the counts stay static.

import { BACKEND_URL, fetchFollowing } from './msgbackend.js';
import { bareAccount, formatDonationAmount } from './donationmath.js';
import { formatCount, formatHbarCount } from './countformat.js';
import { followerCountOrNull } from './followcount.js';
import { cachedPersonFollow, readPersonFollow } from './followtopic.js';
import { earlyHashinalNumber } from './earlyhashinal.js';

// A count's name for a screen reader, as postcounts.js labels one: the
// exact number and its word ("0 followers", "1 follower", "1234 followers").
function countLabel(n, word) {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}

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
  const parts = [num, label];
  if (kind === 'received') {
    const hbar = document.createElement('span');
    hbar.className = 'profile-stat-hbar';
    hbar.textContent = '\u210F';
    parts.splice(1, 0, hbar);
  }
  root.append(...parts);
  return { root, num, parts };
}

function markZero(stat, zero) {
  stat.root.classList.toggle('is-zero', !!zero);
}

// The whole stat is one image with the exact count as its name, so a
// screen reader says "1234 followers" once, not the short number and then
// the visible word. Its parts are hidden from it meanwhile.
function setExact(stat, text) {
  stat.root.setAttribute('role', 'img');
  stat.root.setAttribute('aria-label', text);
  stat.root.title = text;
  for (const part of stat.parts) part.setAttribute('aria-hidden', 'true');
}

// Not a count (Following's en dash): no name of its own, and the parts
// read as they show.
function clearExact(stat) {
  stat.root.removeAttribute('role');
  stat.root.removeAttribute('aria-label');
  stat.root.removeAttribute('title');
  for (const part of stat.parts) part.removeAttribute('aria-hidden');
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
  setExact(followers, countLabel(0, 'follower'));
  following.num.textContent = '\u2013';
  clearExact(following);
  received.num.textContent = formatHbarCount(0);
  setExact(received, `Received ${formatDonationAmount(0)} HBAR`);
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
    setExact(followers, countLabel(shown, 'follower'));
    markZero(followers, shown === 0);
  }

  function applyReceived(raw) {
    if (!current()) return;
    const amount = Number(raw);
    received.num.textContent = formatHbarCount(raw);
    setExact(received, `Received ${formatDonationAmount(raw)} HBAR`);
    markZero(received, !(amount > 0));
  }

  function applyFollowing(n) {
    if (!current()) return;
    // No reply (null, or the request failed): not a count of zero.
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      following.num.textContent = '\u2013';
      clearExact(following);
      markZero(following, true);
      return;
    }
    const shown = n > 0 ? n : 0;
    following.num.textContent = formatCount(shown);
    // "following" takes no plural s.
    setExact(following, `${shown} following`);
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
