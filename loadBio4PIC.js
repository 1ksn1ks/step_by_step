import { activePolygonPopups } from './polygons';
import { activeMarkerPopups } from './marker';
import { CloseALL } from './cssLogic';
import { loadTopicBio, usernames, profilePictures, click2url, profileTopics } from './loadalladata';
import { followPersonControls } from './followtopic';
import { adjustTextareaHeight } from './adjusttextarea';
import { fillTopicIds, useTopicId } from './topicidintext';
import { payerUsernameNode } from './payerlink.js';
import { paintProfileAvatar } from './earlyhashinal.js';
import { forgetProfileTree } from './markertilt.js';
import { paintEarlyProfile } from './loadprofilepopup.js';
import { paintProfileStats } from './profilestats.js';

const DEFAULT_PIC = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
const EMPTY_BIO = 'User has not set a bio yet. You can set yours by going to OPTIONS > TOOLBAR > EDIT > BIO';

// Popups a profile or bio is covering. They stay in the map (and on the
// history stack) so Back can show them again. × / map tap removes them.
let hiddenPopupEls = [];
// Set while a cover is opening, so its own CloseALL does not drop
// the popup it is about to cover.
let suspendingDismiss = 0;
// Bumped when a close wins, so an open still awaiting the page bails
// instead of showing the column after Back already put the popup back.
let bioEpoch = 0;

function popupElement(popup) {
  if (!popup || typeof popup.getElement !== 'function') return null;
  const el = popup.getElement();
  return el && el.nodeType === 1 ? el : null;
}

function hidePopupsForBio() {
  const seen = new Set(hiddenPopupEls);
  for (const popup of [...activePolygonPopups, ...activeMarkerPopups]) {
    const el = popupElement(popup);
    if (!el || seen.has(el)) continue;
    seen.add(el);
    el.style.display = 'none';
    hiddenPopupEls.push(el);
  }
}

function restorePopupsForBio() {
  let restored = false;
  for (const el of hiddenPopupEls) {
    if (!el || !el.isConnected) continue;
    el.style.removeProperty('display');
    restored = true;
  }
  hiddenPopupEls = [];
  return restored;
}

function coverPopupsForPage(extraEl) {
  suspendingDismiss += 1;
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    suspendingDismiss = Math.max(0, suspendingDismiss - 1);
  };
  try {
    hidePopupsForBio();
    const extras = [];
    if (extraEl && extraEl.nodeType === 1) extras.push(extraEl);
    document.querySelectorAll('.maplibregl-popup').forEach((el) => {
      if (el.closest('#popup-settings-card, #popup-settings-preview, #draw-column')) return;
      extras.push(el);
    });
    const seen = new Set(hiddenPopupEls);
    for (const el of extras) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      el.style.display = 'none';
      hiddenPopupEls.push(el);
    }
  } finally {
    queueMicrotask(release);
  }
}
window.coverPopupsForPage = coverPopupsForPage;
window.restorePopupsForPage = restorePopupsForBio;

function dismissBioPopups() {
  if (suspendingDismiss || !hiddenPopupEls.length) return;
  bioEpoch += 1;
  const covered = hiddenPopupEls;
  hiddenPopupEls = [];
  const known = new Set();
  for (const popup of [...activePolygonPopups, ...activeMarkerPopups]) {
    const el = popupElement(popup);
    if (el) known.add(el);
  }
  activePolygonPopups.slice().forEach((popup) => popup.remove());
  activeMarkerPopups.slice().forEach((popup) => popup.remove());
  // Local-news uses the same card but not those lists. A map tap still
  // removes that popup; Back never gets a disconnected shell.
  for (const el of covered) {
    if (!el || !el.isConnected || known.has(el)) continue;
    const close = el.querySelector('.maplibregl-popup-close-button:not(.feed-map-back):not(.comments-back-button)');
    if (close) close.click();
  }
}
window.dismissBioPopups = dismissBioPopups;

// Same panel cleanup as the load column's × (CloseALL). That leaves
// #load-column-container shown and #loaded-topics at its content height.
// The load-column history close hides the container, and the next open
// then measures the list at height 0 — an empty glowing strip.
// The feed covers the page at z-index 8000. This panel is painted at 1002,
// so a profile Load opened from a card would sit under the feed. Lift only
// that open. A map open stays at 1002.
const BIO_OVER_FEED_Z = '8800';

function feedCoversPage() {
  const feed = document.getElementById('feed-layout');
  return !!(feed && feed.style.display !== 'none' && !feed.classList.contains('is-peek'));
}

function liftBioOverFeed(loadColumn) {
  if (!loadColumn) return;
  if (feedCoversPage()) loadColumn.style.zIndex = BIO_OVER_FEED_Z;
  else if (loadColumn.style.zIndex === BIO_OVER_FEED_Z) loadColumn.style.zIndex = '1002';
}

function dropBioOverFeed(loadColumn) {
  if (!loadColumn || loadColumn.style.zIndex !== BIO_OVER_FEED_Z) return;
  loadColumn.style.zIndex = '1002';
}

function closeBioPanel() {
  bioEpoch += 1;
  restorePopupsForBio();
  const loadColumn = document.getElementById('load-column');
  const shell = document.getElementById('feed-chat');
  const leaving = (loadColumn && loadColumn.dataset.navLeaving === '1')
    || (shell && shell.dataset.navLeaving === '1');
  if (loadColumn) delete loadColumn.dataset.historyLayer;
  dropBioOverFeed(loadColumn);
  if (leaving) {
    if (window.restoreDrawerFromMap) window.restoreDrawerFromMap();
    return;
  }
  if (typeof window.hideLoadShellForBio === 'function') window.hideLoadShellForBio();
  dropBioOverFeed(loadColumn);
  // A chat page left under this profile load would take a second Back.
  if (window.layerIsOpen && window.layerIsOpen('feedchat') && window.layerClosedByUI) {
    window.layerClosedByUI('feedchat');
  }
  CloseALL();
  // Opened from the map drawer. Back leaves the drawer on top; show it
  // again with My profile still highlighted.
  if (window.restoreDrawerFromMap) window.restoreDrawerFromMap();
}

// The Load page's own Back button. Browser Back runs closeBioPanel through
// the history layer, so this also drops that entry.
function closeUserBioFromButton() {
  if (!window.layerIsTop || !window.layerIsTop('userbio')) return;
  closeBioPanel();
  if (window.layerIsOpen && window.layerIsOpen('userbio') && window.layerClosedByUI) {
    window.layerClosedByUI('userbio');
  }
  // The panel close above runs while this layer is still the top, so the
  // drawer restore bails. The drawer is top only after that pop.
  if (window.restoreDrawerFromMap) window.restoreDrawerFromMap();
}
window.closeUserBio = closeUserBioFromButton;

function waitForLoadPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function textOf(value) {
  if (Array.isArray(value)) return String(value[0] || '');
  return typeof value === 'string' ? value : '';
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function colorOf(id, fallback) {
  const el = document.getElementById(id);
  return el && el.value ? el.value : fallback;
}

function paintBio(bioEl, bio) {
  const text = String(bio || '');
  const hasBio = text.trim().length > 0;
  if (hasBio) fillTopicIds(bioEl, text, 'profile-live-topic');
  else bioEl.textContent = EMPTY_BIO;
  bioEl.classList.toggle('is-empty', !hasBio);
}

// Picture, name, followers, received, bio, and the connected topic.
// This replaces the topic rows in the list only. Map markers stay.
function showAccount(id) {
  const list = document.getElementById('loaded-topics-list');
  const loaded = document.getElementById('loaded-topics');
  if (!list) return '';
  const previous = document.getElementById('loaded-bio-card');
  if (previous) {
    const oldStats = previous.querySelector('.profile-stats');
    if (oldStats && typeof oldStats._dropProfileStats === 'function') oldStats._dropProfileStats();
    forgetProfileTree(previous);
    previous.remove();
  }

  const card = document.createElement('div');
  card.id = 'loaded-bio-card';
  card.className = 'profile-live-preview';
  card.dataset.account = id;

  const bubble = document.createElement('div');
  bubble.className = 'profile-live-bubble';

  const img = document.createElement('img');
  img.className = 'profile-live-pic';
  img.alt = 'Profile photo';
  const rawPic = profilePictures[id] && profilePictures[id].url;
  img.src = validUrl(rawPic) ? rawPic : DEFAULT_PIC;
  img.addEventListener('error', () => {
    if (img.src !== DEFAULT_PIC) img.src = DEFAULT_PIC;
  });

  const names = document.createElement('div');
  names.className = 'profile-live-names';
  const account = document.createElement('a');
  account.className = 'profile-live-account';
  account.href = `https://explore.hashpack.app/${encodeURIComponent(id)}`;
  account.target = '_blank';
  account.rel = 'noopener noreferrer';
  account.textContent = id;
  account.style.color = colorOf('color-picker-popup-accid', '#ffffff');
  account.style.textDecoration = 'none';
  account.addEventListener('click', (event) => event.stopPropagation());
  names.appendChild(account);

  const name = textOf(usernames[id] && usernames[id].username).trim();
  const link = textOf(click2url[id] && click2url[id].click2url).trim();
  if (name) {
    const nameSlot = document.createElement('div');
    const nameEl = payerUsernameNode(name, link, { className: 'profile-live-name' });
    nameEl.style.color = colorOf('color-picker-popup-username', '#ffffff');
    nameSlot.appendChild(nameEl);
    names.appendChild(nameSlot);
  }
  const stats = document.createElement('div');
  names.appendChild(stats);

  bubble.appendChild(img);
  paintProfileAvatar(img, id);
  bubble.appendChild(names);
  bubble.appendChild(followPersonControls(id, { buttonOnly: true }));

  const bioEl = document.createElement('div');
  bioEl.className = 'profile-live-bio is-empty';
  bioEl.textContent = EMPTY_BIO;

  card.appendChild(bubble);
  paintProfileStats(stats, id);
  card.appendChild(bioEl);
  paintEarlyProfile(card, id);
  const home = profileTopics[id];
  if (home) {
    const topicLine = document.createElement('div');
    topicLine.className = 'profile-live-topic profile-connected-topic';
    topicLine.textContent = home;
    topicLine.addEventListener('click', (event) => {
      event.stopPropagation();
      useTopicId(home);
    });
    card.appendChild(topicLine);
  }
  list.replaceChildren(card);
  if (loaded) adjustTextareaHeight(loaded);
  return bioEl;
}

// Tap a profile → the restyled Load page, with that account id loaded.
export async function loadBio4PIC(payer) {
  // Still inside the tap, before any await. A phone drops a history entry
  // pushed after the gesture, and Back then leaves the site.
  const id = String(payer || '').trim();
  const epoch = ++bioEpoch;
  const already = typeof window.loadPageOwnedByChat === 'function' && window.loadPageOwnedByChat();
  if (!already && window.layerOpened) window.layerOpened('userbio', { payer: id });
  suspendingDismiss += 1;
  let suspendHeld = true;
  const releaseSuspend = () => {
    if (!suspendHeld) return;
    suspendHeld = false;
    suspendingDismiss = Math.max(0, suspendingDismiss - 1);
  };
  try {
      // A document click closes every panel. This function can continue
      // before that click finishes, and the same tap would close the page.
      // Wait until the tap is over, then open.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (epoch !== bioEpoch) return {};

      if (!already) {
        // Cover the popup; don't remove it. Its history entry stays under
        // this one, so Back closes Load and the popup is still there.
        CloseALL();
        if (epoch !== bioEpoch) return {};
        if (window.layerOpened && (!window.layerIsOpen || !window.layerIsOpen('userbio'))) {
          window.layerOpened('userbio', { payer: id });
        }
        hidePopupsForBio();
        const loadColumn = document.getElementById('load-column');
        if (loadColumn) loadColumn.dataset.historyLayer = 'userbio';
        const opened = typeof window.openLoadPage === 'function' && window.openLoadPage(true);
        if (loadColumn) liftBioOverFeed(loadColumn);
        if (!opened) {
          restorePopupsForBio();
          if (loadColumn) delete loadColumn.dataset.historyLayer;
          dropBioOverFeed(loadColumn);
          if (epoch === bioEpoch && window.layerIsOpen && window.layerIsOpen('userbio') && window.layerClosedByUI) {
            window.layerClosedByUI('userbio');
          }
          return {};
        }
      }

      releaseSuspend();
      // The shell paints the topic list on the next frame. Load after that
      // so the result is not replaced by that paint.
      await waitForLoadPaint();
      if (epoch !== bioEpoch) return {};

      const input = document.getElementById('input-field');
      if (input) input.value = id;
      if (!id) return { bio: '' };

      const bioEl = showAccount(id);
      if (epoch !== bioEpoch) return {};
      let bios = null;
      try { bios = await loadTopicBio(); } catch { bios = null; }
      if (epoch !== bioEpoch || !bioEl || !bioEl.isConnected) return {};
      const bio = textOf(bios && bios[id] && bios[id].topic_bio);
      paintBio(bioEl, bio);
      const loaded = document.getElementById('loaded-topics');
      if (loaded) adjustTextareaHeight(loaded);
      return { bio };

  } catch (error) {
      console.log(`Error in loadBio4PIC for payer ${payer}:`, error);
      const loadColumn = document.getElementById('load-column');
      const shell = document.getElementById('feed-chat');
      const shown = !!(shell && !shell.hidden && loadColumn && loadColumn.style.display !== 'none');
      if (!shown && epoch === bioEpoch && window.layerIsOpen && window.layerIsOpen('userbio')) {
        restorePopupsForBio();
        if (loadColumn) delete loadColumn.dataset.historyLayer;
        dropBioOverFeed(loadColumn);
        if (window.layerClosedByUI) window.layerClosedByUI('userbio');
      }
      return {};
  } finally {
      releaseSuspend();
  }
}

window.loadBio4PIC = loadBio4PIC;

if (window.defineLayer) {
  window.defineLayer("userbio", {
    parent: "markerpopup",
    open: (state) => {
      if (state && state.payer) loadBio4PIC(state.payer);
    },
    close: () => closeBioPanel(),
  });
}
