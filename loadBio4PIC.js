import { handleAllMessages } from './handleallmessages.js';
import { activePolygonPopups } from './polygons';
import { activeMarkerPopups } from './marker';
import { CloseALL } from './cssLogic';

// Popups the open bio is covering. They stay in the map (and on the
// history stack) so Back can show them again. × / map tap removes them.
let hiddenPopupEls = [];
// Set while loadBio4PIC is opening, so its own CloseALL does not drop
// the popup it is about to cover.
let suspendingDismiss = 0;
// Bumped when a close wins, so an open still awaiting the page bails
// instead of showing the column after Back already put the popup back.
let bioEpoch = 0;
// How many profile loads are inside handleAllMessages. Only the outer one
// hides window.loadBio4PIC, so a second tap cannot restore it to null.
let loadDepth = 0;

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

      // The account-id branch of Load calls back into this function.
      // Drop the hook for this call so the toolbar Load runs once.
      loadDepth += 1;
      const hideHook = loadDepth === 1;
      const previous = window.loadBio4PIC;
      if (hideHook) window.loadBio4PIC = null;
      try {
        await handleAllMessages();
      } finally {
        loadDepth -= 1;
        if (hideHook) window.loadBio4PIC = previous;
      }
      return { bio: '' };

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
