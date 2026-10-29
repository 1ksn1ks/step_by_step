import { loadTopicBio, usernames, profilePictures, click2url, profileTopics } from './loadalladata';
import { followPersonControls } from './followtopic';
import { activePolygonPopups } from './polygons';
import { activeMarkerPopups } from './marker';
import { CloseALL, OpenToggleToolbar } from './cssLogic';
import { adjustTextareaHeight } from './adjusttextarea';
import { fillTopicIds, useTopicId } from './topicidintext';
import { payerUsernameNode } from './payerlink.js';
import { paintProfileAvatar } from './earlyhashinal.js';
import { forgetProfileTree } from './markertilt.js';
import { paintEarlyProfile } from './loadprofilepopup.js';
import { paintReceived } from './donations.js';

const DEFAULT_PIC = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
const EMPTY_BIO = 'User has not set a bio yet. You can set yours by going to OPTIONS > TOOLBAR > EDIT > BIO';

// Popups the open bio is covering. They stay in the map (and on the
// history stack) so Back can show them again. × / map tap removes them.
let hiddenPopupEls = [];
// Set while loadBio4PIC is opening, so its own CloseALL does not drop
// the popup it is about to cover.
let suspendingDismiss = 0;
// Bumped when a close wins, so an open still awaiting the bio bails
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
  for (const el of hiddenPopupEls) {
    if (el && el.isConnected) el.style.removeProperty('display');
  }
  hiddenPopupEls = [];
}

function dismissBioPopups() {
  if (suspendingDismiss || !hiddenPopupEls.length) return;
  bioEpoch += 1;
  hiddenPopupEls = [];
  activePolygonPopups.slice().forEach((popup) => popup.remove());
  activeMarkerPopups.slice().forEach((popup) => popup.remove());
}
window.dismissBioPopups = dismissBioPopups;

// Same panel cleanup as the load column's × (CloseALL). That leaves
// #load-column-container shown and #loaded-topics at its content height.
// The load-column history close hides the container, and the next open
// then measures the list at height 0 — an empty glowing strip.
// The feed covers the page at z-index 8000. This panel is painted at 1002,
// so a bio opened from a card would sit under the feed. Lift only that
// open. A map bio stays at 1002.
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
  if (loadColumn) delete loadColumn.dataset.historyLayer;
  dropBioOverFeed(loadColumn);
  CloseALL();
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

// Tap a PFP → show that user's bio in the Load box, same card as Edit Profile.
export async function loadBio4PIC(payer) {
  // Still inside the tap, before any await. A phone drops a history entry
  // pushed after the gesture, and Back then leaves the site.
  const epoch = ++bioEpoch;
  if (window.layerOpened) window.layerOpened('userbio', { payer: String(payer || '') });
  suspendingDismiss += 1;
  try {
      const accountTopicBio = await loadTopicBio();
      if (epoch !== bioEpoch) return {};
      const bio = textOf(accountTopicBio[payer] && accountTopicBio[payer].topic_bio);

      // A document click closes every panel. When the bio is already cached,
      // this function continues before that click finishes and the panel would
      // be closed by the same tap. Wait until the tap is over, then open.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (epoch !== bioEpoch) return {};

      // Cover the popup; don't remove it. Its history entry stays under
      // this one, so Back closes the bio and the popup is still there.
      CloseALL();
      if (epoch !== bioEpoch) return {};
      hidePopupsForBio();
      const loadColumn = document.getElementById("load-column");
      const container = document.getElementById("load-column-container");
      if (container) container.style.display = "block";
      loadColumn.dataset.historyLayer = "userbio";
      if (loadColumn.style.display === "none") loadColumn.dataset.historyHold = "1";
      liftBioOverFeed(loadColumn);
      loadColumn.style.display = "block";
      OpenToggleToolbar();
      const inputarea = document.getElementById("input-field");
      inputarea.value = '';
      const loaded_text_area = document.getElementById("loaded-topics");
      const label = document.getElementById("loaded-topics-label");
      if (label) label.style.display = "none";
      const controls = loaded_text_area.querySelector(".loaded-topics-controls");
      if (controls) controls.style.display = "none";
      const list = document.getElementById("loaded-topics-list");
      if (list) list.style.display = "none";
      const previous = document.getElementById("loaded-bio-card");
      if (previous) {
        forgetProfileTree(previous);
        previous.remove();
      }

      const card = document.createElement('div');
      card.id = 'loaded-bio-card';
      card.className = 'profile-live-preview';

      const bubble = document.createElement('div');
      bubble.className = 'profile-live-bubble';

      const img = document.createElement('img');
      img.className = 'profile-live-pic';
      img.alt = 'Profile photo';
      const rawPic = profilePictures[payer] && profilePictures[payer].url;
      img.src = validUrl(rawPic) ? rawPic : DEFAULT_PIC;
      img.addEventListener('error', () => {
        if (img.src !== DEFAULT_PIC) img.src = DEFAULT_PIC;
      });

      const names = document.createElement('div');
      names.className = 'profile-live-names';
      const account = document.createElement('a');
      account.className = 'profile-live-account';
      account.href = `https://explore.hashpack.app/${encodeURIComponent(payer)}`;
      account.target = '_blank';
      account.rel = 'noopener noreferrer';
      account.textContent = payer;
      account.style.color = colorOf('color-picker-popup-accid', '#ffffff');
      account.style.textDecoration = 'none';
      account.addEventListener('click', (event) => event.stopPropagation());
      names.appendChild(account);

      const name = textOf(usernames[payer] && usernames[payer].username).trim();
      const link = textOf(click2url[payer] && click2url[payer].click2url).trim();
      const nameColor = colorOf('color-picker-popup-username', '#ffffff');
      if (name) {
        const nameSlot = document.createElement('div');
        const nameEl = payerUsernameNode(name, link, { className: 'profile-live-name' });
        nameEl.style.color = nameColor;
        nameSlot.appendChild(nameEl);
        names.appendChild(nameSlot);
      }

      bubble.appendChild(img);
      paintProfileAvatar(img, payer);
      bubble.appendChild(names);
      bubble.appendChild(followPersonControls(payer));

      const bioEl = document.createElement('div');
      bioEl.className = 'profile-live-bio';
      const hasBio = bio.trim().length > 0;
      if (hasBio) fillTopicIds(bioEl, bio, 'profile-live-topic');
      else bioEl.textContent = EMPTY_BIO;
      bioEl.classList.toggle('is-empty', !hasBio);

      card.appendChild(bubble);
      const received = document.createElement('div');
      received.className = 'profile-received';
      card.appendChild(received);
      paintReceived(received, payer);
      card.appendChild(bioEl);
      paintEarlyProfile(card, payer);
      const home = profileTopics[payer];
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
      loaded_text_area.appendChild(card);
      adjustTextareaHeight(loaded_text_area);

      return { bio };

  } catch (error) {
      console.log(`Error in loadBio4PIC for payer ${payer}:`, error);
      const loadColumn = document.getElementById("load-column");
      const shown = loadColumn && loadColumn.style.display !== "none" && document.getElementById("loaded-bio-card");
      if (!shown && epoch === bioEpoch && window.layerIsOpen && window.layerIsOpen("userbio")) {
        if (loadColumn) delete loadColumn.dataset.historyLayer;
        dropBioOverFeed(loadColumn);
        restorePopupsForBio();
        window.layerClosedByUI("userbio");
      }
      return {};
  } finally {
      suspendingDismiss = Math.max(0, suspendingDismiss - 1);
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
