// A profile is connected to one topic. Shares are messages on that topic.
// Followers of that topic are one row each, same idea as a view count.
import { sendMessage, userFollow } from './msgbackend';
import { signer, connectedAccount } from './web3';
import { profileTopics } from './loadalladata';
import { toast } from './toast';
import { noteShare } from './sharecount.js';
import { refreshFollowing } from './followsuggest.js';
import { createFollowLoader, followerCountOrNull } from './followcount.js';
import { bareAccount } from './donationmath';

const PROFILE_BIO_TOPIC = '0.0.9759201';
const FOLLOW_TOPIC = '0.0.10923187';

// Account ids and topic ids share the 0.0. shape, so they stay in two maps.
const personCounts = createFollowLoader({
  fetchCount: (followee, viewer) => userFollow(followee, viewer),
});

// Starts the person-count read before the profile popup opens.
export function prefetchPersonFollow(account) {
  if (!account) return;
  personCounts.load(account, connectedAccount || '').catch(() => {});
}

export function cachedPersonFollow(account) {
  const id = String(account || '').trim();
  if (!id) return null;
  return personCounts.cached(id, connectedAccount || '');
}

export function readPersonFollow(account) {
  const id = String(account || '').trim();
  if (!id) return Promise.resolve(null);
  return personCounts.load(id, connectedAccount || '').catch(() => null);
}

// One pair of listeners. A later account on the same element replaces the target.
export function watchFollowPrefetch(el, account) {
  if (!el || !account || el._followPrefetch === account) return;
  el._followPrefetch = account;
  if (el._followPrefetchBound) return;
  el._followPrefetchBound = true;
  const go = () => prefetchPersonFollow(el._followPrefetch);
  el.addEventListener('pointerenter', go);
  el.addEventListener('pointerdown', go);
}

export function sharePin(value) {
  if (Array.isArray(value) && value.length === 2 && !Array.isArray(value[0])) {
    const pair = value.map(Number);
    if (pair.every(Number.isFinite)) return pair;
  }
  if (typeof value === 'string' && value.includes(',')) {
    const pair = value.split(',').slice(0, 2).map((part) => Number(part.trim()));
    if (pair.every(Number.isFinite)) return pair;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const pin = sharePin(item);
      if (pin) return pin;
    }
  }
  return null;
}

function shareReady(source) {
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return null;
  }
  const home = profileTopics[connectedAccount];
  if (!home) {
    toast.error('Connect a topic in Edit profile first');
    return null;
  }
  const pin = sharePin(source && source.coords);
  if (!source || !source.topicId || !source.created || !source.timestamp || !pin) {
    toast.error('This post cannot be shared');
    return null;
  }
  return { home, pin };
}

// The pin lands on the signed-in account's topic. The count lands on the
// original post, one person once. The wallet asks for each message.
export async function confirmShare(source) {
  const ready = shareReady(source);
  if (!ready) return false;
  // The pin is a pointer. The card is rebuilt from the original post.
  const payload = {
    share: {
      topic: source.topicId,
      created: source.created,
      payer: source.payer || '',
      coords: source.coords,
      pin: ready.pin,
      number: source.number == null ? '' : String(source.number),
      kind: source.kind || 'marker',
    },
  };
  toast.info('Confirm in wallet 👛');
  try {
    await sendMessage(ready.home, JSON.stringify(payload));
  } catch (error) {
    console.error('share pin failed', error);
    return false;
  }
  try {
    await sendMessage(source.topicId, JSON.stringify({
      sharePost: { timestamp: source.timestamp, created: source.created },
    }));
  } catch (error) {
    console.error('share count failed', error);
    toast.error('Share count was not saved');
    return false;
  }
  noteShare({ payer: connectedAccount, sharePost: { timestamp: source.timestamp } }, source.topicId);
  toast.success('Shared');
  return true;
}

// The pin lives on the topic this account connected in Edit profile.
// Removing it is the first wallet confirm. The count is the second, on the original.
export async function unshareFromMyTopic(source) {
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return false;
  }
  if (!source || !source.topicId || !source.timestamp) {
    toast.error('This post cannot be shared');
    return false;
  }
  const created = source.created || '';
  // Shares are written to the topic this account connected in Edit profile.
  const pinTopic = profileTopics[connectedAccount];
  if (!pinTopic || !created) {
    toast.error('Connect a topic in Edit profile first');
    return false;
  }
  toast.info('Confirm in wallet 👛');
  try {
    await sendMessage(pinTopic, JSON.stringify({
      unshare: { topic: source.topicId, created },
    }));
  } catch (error) {
    console.error('unshare pin failed', error);
    toast.error('The pin is still on your topic');
    return false;
  }
  try {
    await sendMessage(source.topicId, JSON.stringify({
      unsharePost: {
        timestamp: source.timestamp,
        created,
      },
    }));
  } catch (error) {
    console.error('unshare count failed', error);
    toast.error('Share count was not saved');
    return true;
  }
  noteShare({ payer: connectedAccount, unsharePost: { timestamp: source.timestamp } }, source.topicId);
  toast.success('Share removed');
  return true;
}

const compactCount = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const exactCount = new Intl.NumberFormat('en');

export function formatCount(n) {
  return compactCount.format(n);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function followIcon(className, parts) {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  svg.classList.add(className);
  for (const part of parts) svg.appendChild(part);
  return svg;
}

function userBody() {
  return [
    svgEl('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
    svgEl('circle', { cx: '9', cy: '7', r: '4' }),
  ];
}

function countValue(text) {
  const span = document.createElement('span');
  span.className = 'topic-follow-num-value';
  span.textContent = text;
  return span;
}

function countChip() {
  const count = document.createElement('div');
  count.className = 'topic-follow-count';
  count.setAttribute('role', 'img');
  const icon = followIcon('topic-follow-users', [
    svgEl('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
    svgEl('circle', { cx: '9', cy: '7', r: '4' }),
    svgEl('path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }),
    svgEl('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }),
  ]);
  const num = document.createElement('span');
  num.className = 'topic-follow-num';
  const roll = document.createElement('span');
  roll.className = 'topic-follow-num-roll';
  roll.appendChild(countValue(''));
  num.appendChild(roll);
  count.append(icon, num);
  count.classList.add('is-loading');
  count.setAttribute('aria-label', 'Followers');
  return count;
}

// The chip shows the compact count. The aria-label is the exact number.
// A count that is still loading, or a failed read, is left as it is.
export function paintFollowerCount(count, n) {
  const value = followerCountOrNull(n);
  if (value == null || !count) return;
  count.classList.remove('is-loading');
  count.removeAttribute('title');
  count.setAttribute('aria-label', exactCount.format(value));
  const roll = count.querySelector('.topic-follow-num-roll');
  if (!roll) return;
  const prev = count._followers;
  count._followers = value;
  const text = formatCount(value);
  const prevText = prev == null ? '' : formatCount(prev);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prev == null || prev === value || text === prevText || reduced) {
    roll.style.transition = 'none';
    roll.style.transform = 'none';
    roll.replaceChildren(countValue(text));
    return;
  }
  const up = value > prev;
  roll.style.transition = 'none';
  if (up) {
    roll.replaceChildren(countValue(prevText), countValue(text));
    roll.style.transform = 'translateY(0)';
  } else {
    roll.replaceChildren(countValue(text), countValue(prevText));
    roll.style.transform = 'translateY(-50%)';
  }
  const token = (count._roll || 0) + 1;
  count._roll = token;
  const settle = () => {
    if (count._roll !== token) return;
    roll.style.transition = 'none';
    roll.style.transform = 'none';
    roll.replaceChildren(countValue(text));
  };
  // Commit the start position, then slide the strip inside the clipped window.
  void roll.offsetHeight;
  roll.style.transition = 'transform 200ms ease';
  roll.style.transform = up ? 'translateY(-50%)' : 'translateY(0)';
  roll.addEventListener('transitionend', function onEnd(event) {
    if (event.target !== roll || event.propertyName !== 'transform') return;
    roll.removeEventListener('transitionend', onEnd);
    settle();
  });
  setTimeout(settle, 260);
}

// The read failed every try. End the loading pill without inventing a count.
function paintFollowerUnknown(count) {
  count.classList.remove('is-loading');
  count.title = "Couldn't load";
  count.setAttribute('aria-label', "Followers couldn't load");
  const roll = count.querySelector('.topic-follow-num-roll');
  if (!roll) return;
  roll.style.transition = 'none';
  roll.style.transform = 'none';
  roll.replaceChildren(countValue('\u2013'));
}

// Round icon button. The click handler that sends the follow stays on the caller.
function followButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'topic-follow-btn';
  paintFollowButton(btn, false);
  const glyph = document.createElement('span');
  glyph.className = 'topic-follow-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.append(
    followIcon('topic-follow-plus', userBody().concat([
      svgEl('line', { x1: '19', x2: '19', y1: '8', y2: '14' }),
      svgEl('line', { x1: '22', x2: '16', y1: '11', y2: '11' }),
    ])),
    followIcon('topic-follow-check', [
      svgEl('path', { d: 'M20 6 9 17l-5-5' }),
    ]),
    followIcon('topic-follow-minus', userBody().concat([
      svgEl('line', { x1: '22', x2: '16', y1: '11', y2: '11' }),
    ])),
  );
  btn.appendChild(glyph);
  bindPressFeedback(btn);
  return btn;
}

// Press feedback shared with the popup ×. Hover colours are CSS; this is the
// hold and the pop, with one duration for both buttons.
const PRESS_HOLD_MS = 450;
const pressBound = new WeakSet();

export function bindPressFeedback(btn) {
  if (!btn || pressBound.has(btn)) return;
  pressBound.add(btn);
  let holdTimer = 0;
  const clearHold = () => {
    clearTimeout(holdTimer);
    btn.classList.remove('is-hold');
  };
  btn.addEventListener('pointerdown', () => {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => btn.classList.add('is-hold'), PRESS_HOLD_MS);
  });
  btn.addEventListener('pointerup', clearHold);
  btn.addEventListener('pointerleave', clearHold);
  btn.addEventListener('pointercancel', clearHold);
  btn.addEventListener('click', () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    btn.classList.remove('is-pop');
    void btn.offsetWidth;
    btn.classList.add('is-pop');
  });
  btn.addEventListener('animationend', () => btn.classList.remove('is-pop'));
}

// Resting × cross-fades into a circled ×. Same stacked glyphs as Follow.
function closeGlyph() {
  const glyph = document.createElement('span');
  glyph.className = 'topic-follow-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  const circled = followIcon('topic-follow-check', [
    svgEl('circle', { cx: '12', cy: '12', r: '10' }),
    svgEl('path', { d: 'm15 9-6 6' }),
    svgEl('path', { d: 'm9 9 6 6' }),
  ]);
  circled.setAttribute('stroke-width', '2.5');
  glyph.append(
    followIcon('topic-follow-plus', [
      svgEl('path', { d: 'M18 6 6 18' }),
      svgEl('path', { d: 'm6 6 12 12' }),
    ]),
    circled,
  );
  return glyph;
}

function mountCloseGlyph(btn) {
  if (!btn || btn.classList.contains('comments-back-button') || btn.classList.contains('feed-map-back')) return;
  if (btn.querySelector('.topic-follow-glyph')) return;
  btn.textContent = '';
  btn.appendChild(closeGlyph());
}

function bindPopupClose(node) {
  if (!node || node.nodeType !== 1) return;
  const paint = (btn) => {
    if (!btn || btn.classList.contains('comments-back-button')) return;
    mountCloseGlyph(btn);
    bindPressFeedback(btn);
  };
  if (node.classList.contains('maplibregl-popup-close-button')) paint(node);
  if (!node.querySelectorAll) return;
  node.querySelectorAll('.maplibregl-popup-close-button:not(.comments-back-button)').forEach(paint);
}

function watchPopupCloses() {
  const start = () => {
    bindPopupClose(document.body);
    new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(bindPopupClose);
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}

watchPopupCloses();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The button already shows `next`. Keep reading until the mirror message
// has been stored, then replace the guess with the stored count.
async function settleFollow(gen, currentGen, read, paint, next) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await delay(1500);
    if (gen !== currentGen()) return;
    const data = await read();
    if (gen !== currentGen()) return;
    if (data && !!data.following === !!next) {
      paint(data);
      return;
    }
  }
}

function paintFollowButton(btn, following) {
  btn.classList.toggle('is-following', !!following);
  const label = following ? 'Unfollow' : 'Follow';
  btn.setAttribute('aria-pressed', following ? 'true' : 'false');
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

// Popups keep the first card. setDOMContent runs again on every open.
function refreshFollowControls(root) {
  if (!root || root.nodeType !== 1) return;
  const boxes = root.classList.contains('topic-follow')
    ? [root]
    : root.querySelectorAll('.topic-follow');
  for (const box of boxes) {
    if (typeof box._refreshFollow === 'function') box._refreshFollow();
  }
}

if (!document.__meritFollowPopup) {
  document.__meritFollowPopup = true;
  document.addEventListener('follow-popup-open', (event) => {
    refreshFollowControls(event.detail);
  });
}

// #account-id is the existing connect and disconnect signal.
function watchWalletAccount() {
  if (document.__meritFollowAccount) return;
  const account = document.getElementById('account-id');
  if (!account) return;
  document.__meritFollowAccount = true;
  let last = account.textContent;
  new MutationObserver(() => {
    const text = account.textContent;
    if (text === last) return;
    last = text;
    document.querySelectorAll('.topic-follow').forEach((box) => {
      if (typeof box._refreshFollow === 'function') box._refreshFollow({ accountChange: true });
    });
  }).observe(account, { childList: true, characterData: true, subtree: true });
}

// read uses the live wallet. isMine is checked again on every paint.
// The button stays disabled only while the wallet prompt is open.
function mountFollowControl(box, btn, count, read, isMine, send, options) {
  const known = options && options.known;
  const remember = options && options.remember;
  const buttonOnly = !!(options && options.buttonOnly);
  let following = false;
  let inFlight = false;
  let settling = false;
  let generation = 0;
  let refreshGen = 0;

  const inPreview = () => !!box.closest('#popup-settings-preview');

  function syncOwn() {
    const mine = !!isMine();
    btn.hidden = mine;
    if (buttonOnly) box.hidden = mine;
  }

  function publishCount(followers) {
    if (!buttonOnly) return;
    const value = followerCountOrNull(followers);
    if (value == null) return;
    box._followers = value;
    box.dispatchEvent(new CustomEvent('profile-follow-count', {
      bubbles: true,
      detail: { account: box.dataset.followee || '', followers: value },
    }));
  }

  function paint(data) {
    if (!data || followerCountOrNull(data.followers) == null) return;
    if (count) paintFollowerCount(count, data.followers);
    following = !!data.following;
    syncOwn();
    btn.disabled = inFlight;
    paintFollowButton(btn, following);
    publishCount(data.followers);
  }

  function paintKnown() {
    if (typeof known !== 'function') return;
    const hit = known();
    if (hit) paint(hit);
  }

  function refresh(refreshOptions) {
    const accountChange = !!(refreshOptions && refreshOptions.accountChange);
    // The settings sample stays at its fixed 0 and never asks the server.
    if (inPreview()) return;
    syncOwn();
    if (inFlight) return;
    if (settling && !accountChange) return;
    if (settling && accountChange) {
      generation += 1;
      settling = false;
    }
    btn.disabled = false;
    paintKnown();
    const token = ++refreshGen;
    const stale = () => token !== refreshGen || inFlight || settling;
    (async () => {
      // A failed read retries twice, then the chip stops loading and shows
      // a neutral dash. A miss is never painted as 0.
      for (const wait of [0, 1500, 3000]) {
        if (wait) await delay(wait);
        if (stale() || inPreview()) return;
        let data = null;
        try { data = await read(); } catch { data = null; }
        if (stale()) return;
        if (data && followerCountOrNull(data.followers) != null) {
          paint(data);
          return;
        }
      }
      if (count && count.classList.contains('is-loading')) paintFollowerUnknown(count);
    })();
  }

  box._refreshFollow = refresh;
  watchWalletAccount();
  syncOwn();
  paintKnown();
  // The popup open in this same turn reads once. A profile card has no popup event.
  queueMicrotask(() => {
    if (refreshGen === 0) refresh();
  });

  btn.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (inFlight || btn.disabled) return;
    if (isMine()) {
      syncOwn();
      return;
    }
    if (!signer || !connectedAccount) {
      toast.error('Connect wallet first');
      return;
    }
    const next = !following;
    const gen = ++generation;
    refreshGen += 1;
    inFlight = true;
    btn.disabled = true;
    try {
      toast.info('Confirm in wallet 👛');
      await send(next);
    } catch (error) {
      console.error('follow failed', error);
      return;
    } finally {
      inFlight = false;
      btn.disabled = false;
    }
    if (gen !== generation) return;
    const prev = count && typeof count._followers === 'number' ? count._followers : box._followers;
    if (typeof prev === 'number') {
      const nextCount = Math.max(0, prev + (next ? 1 : -1));
      const guess = { followers: nextCount, following: next };
      if (typeof remember === 'function') remember(guess);
      paint(guess);
    } else {
      following = next;
      syncOwn();
      paintFollowButton(btn, following);
    }
    refreshFollowing();
    settling = true;
    try {
      await settleFollow(gen, () => generation, read, paint, next);
    } finally {
      if (gen === generation) settling = false;
    }
  });
}

// Same button for a person. Hidden on your own profile. The message names
// only the followee. The wallet account is the follower.
// buttonOnly skips the count chip. Profiles paint that count in the stats row.
export function followPersonControls(followeeAccount, options) {
  const box = document.createElement('div');
  box.className = 'topic-follow';
  if (!followeeAccount) return box;
  const buttonOnly = !!(options && options.buttonOnly);
  const count = buttonOnly ? null : countChip();
  const btn = followButton();
  if (count) box.append(btn, count);
  else box.append(btn);
  box.dataset.followee = String(followeeAccount);
  mountFollowControl(
    box,
    btn,
    count,
    () => personCounts.load(followeeAccount, connectedAccount || ''),
    () => {
      const me = bareAccount(connectedAccount);
      const them = bareAccount(followeeAccount);
      return !!(me && them && me === them);
    },
    (next) => sendMessage(FOLLOW_TOPIC, JSON.stringify(next ? { follow: followeeAccount } : { unfollow: followeeAccount })),
    {
      known: () => personCounts.cached(followeeAccount, connectedAccount || ''),
      remember: (data) => personCounts.remember(followeeAccount, connectedAccount || '', data),
      buttonOnly,
    },
  );
  return box;
}

export async function connectProfileTopic(topicId) {
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return false;
  }
  const topic = String(topicId || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(topic)) {
    toast.error('Enter a topic id');
    return false;
  }
  toast.info('Confirm in wallet 👛');
  await sendMessage(PROFILE_BIO_TOPIC, JSON.stringify({ data: { profileTopic: topic } }));
  const { showOwnProfile } = await import('./loadalladata');
  showOwnProfile(connectedAccount, { topic });
  toast.success('Topic connected');
  return true;
}

export async function removeProfileTopic() {
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return false;
  }
  if (!profileTopics[connectedAccount]) {
    toast.error('No topic connected');
    return false;
  }
  toast.info('Confirm in wallet 👛');
  await sendMessage(PROFILE_BIO_TOPIC, JSON.stringify({ data: { clearProfileTopic: '1' } }));
  const { showOwnProfile } = await import('./loadalladata');
  showOwnProfile(connectedAccount, { topic: '' });
  toast.success('Topic removed');
  return true;
}
