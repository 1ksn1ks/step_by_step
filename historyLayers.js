// historyLayers.js — browser Back/Forward as a stack of overlay layers.
//
// Every openable overlay registers once (defineLayer) and reports itself
// when it opens (layerOpened) and when its own ×/‹/Escape/map-tap closes
// it (layerClosedByUI). Opening pushes a history entry (state only — the
// URL path and query are never touched, so deep links and the
// coordinates search keep working). Back consumes the topmost entry and
// closes that layer; Forward reopens it when the layer knows how (its
// registered open runs with the saved data), otherwise does nothing.
// Closing via the overlay's own controls moves history back for that
// entry, so the history never piles up.
//
// Per-layer wiring (one defineLayer call in the file that owns the
// overlay's open/close functions):
//   defineLayer('name', { open: (state) => openIt(state), close: () => closeIt() });
//   // in the existing open path, once the UI is really open:
//   layerOpened('name', { id: ... });        // minimal JSON-safe data
//   // in every existing close path (×/‹, Escape, map tap), after the UI
//   // is really closed:
//   layerClosedByUI('name');                 // idempotent: no-op if the
//                                            // layer has no history entry

(function () {
  const registry = new Map(); // name -> { open, close }
  const open = []; // names of open layers, top last

  // The session history as this module sees it. entries[position] is the
  // id of the entry at that position (0 = the page's own base entry).
  // history.length is useless for direction — it never changes on
  // back/forward — so every entry this module pushes carries a unique id
  // and the position is tracked from the module's own push/back calls.
  let position = 0;
  const entries = [null];
  let seq = 0;
  const idToLayer = new Map();
  const idToState = new Map();
  let skipNextPop = false;

  // A top-layer UI close schedules its history.back() one task late
  // (pendingBack=1). If a new layer opens in the same gesture — the
  // normal case, since every panel opener first runs CloseALL — the
  // pending back is cancelled and the still-current entry (the closed
  // layer's) is rewritten as the new layer's instead: pushState in the
  // same task as a pending history.back() is clobbered by the browser.
  let pendingBack = 0;
  let pendingTimer = 0;
  function deferBack() {
    if (pendingBack) {
      // A second top close in the same batch: the first back must not be
      // lost — commit it now and defer this one.
      clearTimeout(pendingTimer);
      pendingBack = 0;
      pendingTimer = 0;
      skipNextPop = true;
      history.back();
    }
    skipNextPop = true;
    pendingBack = 1;
    pendingTimer = setTimeout(() => {
      pendingBack = 0;
      pendingTimer = 0;
      history.back();
    }, 0);
  }

  // The pending back has not committed, so the browser's current entry is
  // still the just-closed layer's. Rewrite it in place as this layer's
  // entry — final history is identical to "back, then push", without the
  // same-task pushState clobber.
  function replaceTop(name, data) {
    clearTimeout(pendingTimer);
    pendingBack = 0;
    pendingTimer = 0;
    skipNextPop = false; // the cancelled back will never pop
    const id = ++seq;
    const state = { layer: name, id, ...(data || {}) };
    const oldId = entries[position + 1];
    if (oldId != null) {
      idToLayer.delete(oldId);
      idToState.delete(oldId);
    }
    entries.length = position + 1;
    entries.push(id);
    idToLayer.set(id, name);
    idToState.set(id, state);
    try { history.replaceState(state, ''); } catch (e) { /* keep going */ }
    open.push(name);
    position += 1;
  }

  window.defineLayer = function (name, handlers) {
    registry.set(name, handlers);
  };

  function pushEntry(name, data) {
    const id = ++seq;
    const state = { layer: name, id, ...(data || {}) };
    entries.length = position + 1; // pushState drops forward entries
    entries.push(id);
    idToLayer.set(id, name);
    idToState.set(id, state);
    try {
      history.pushState(state, '');
    } catch (e) {
      // pushState can only fail on quota/serialization — the layer
      // itself still works, Back just leaves the site like before.
      entries.length = position + 1;
      return;
    }
    open.push(name);
    position += 1;
  }

  // Opened (or re-shown). When this layer already owns the top entry —
  // a replacement, e.g. clicking marker B while marker A's popup is
  // still closing — refresh the saved data on that entry instead of
  // pushing a second one.
  window.layerOpened = function (name, data) {
    if (open[open.length - 1] === name) {
      const id = entries[position];
      if (id != null) {
        const state = { layer: name, id, ...(data || {}) };
        idToState.set(id, state);
        try { history.replaceState(state, ''); } catch (e) { /* keep going */ }
      }
      return;
    }
    if (pendingBack) {
      // Same gesture as the UI close above us — rewrite its entry.
      replaceTop(name, data);
      return;
    }
    pushEntry(name, data);
  };

  // Closed by the layer's own controls (×/‹, Escape, map tap). When it
  // is the top layer, history moves back so the entry does not pile up.
  // A layer that is not on top (a newer layer opened in the same
  // gesture, e.g. the draw pin replacing a popup on a map tap) only
  // drops its stack entry; its history entry is consumed later by Back
  // as a no-op, or reopens on Forward.
  window.layerClosedByUI = function (name) {
    const i = open.lastIndexOf(name);
    if (i < 0) return; // no history entry to consume
    open.splice(i, 1);
    if (i !== open.length) return; // was not the top layer
    position -= 1;
    deferBack(); // our own history.back() must not double-close
  };

  // Display watcher: for panels whose every open/close path lands on the
  // element's own inline `display` (the app's CloseALL funnel, the auto ×
  // buttons, map taps and toggle buttons all end in display:none). The
  // style observer is then the single close funnel — no close path needs
  // its own hook. `handlers` optionally registers the defineLayer entry
  // (usually "click this panel's own open button" for Forward).
  window.watchDisplayLayer = function (name, element, handlers) {
    if (!element) return;
    if (handlers) registry.set(name, handlers);
    let open = element.style.display !== "none";
    new MutationObserver(() => {
      const now = element.style.display !== "none";
      if (now === open) return;
      open = now;
      if (now) window.layerOpened(name);
      else window.layerClosedByUI(name);
    }).observe(element, { attributes: true, attributeFilter: ["style"] });
  };

  // A reload lands on a layer entry whose UI is gone. Drop the stale
  // state so the position model (base entry = position 0) stays true.
  if (history.state && history.state.layer) {
    try { history.replaceState(null, ''); } catch (e) { /* old browsers */ }
  }

  window.addEventListener('popstate', () => {
    if (skipNextPop) {
      skipNextPop = false;
      return;
    }
    const state = history.state || {};
    // Entries this module created resolve to their position; anything
    // else (the base entry, a pre-reload stale entry) resolves to 0.
    const target = state.id != null ? entries.indexOf(state.id) : 0;
    if (target === position) return;
    if (target > position) {
      // Moved forward: reopen the layers the entries stand for.
      for (let i = position + 1; i <= target; i++) {
        const name = idToLayer.get(entries[i]);
        if (name && !open.includes(name)) {
          open.push(name);
          const reg = registry.get(name);
          if (reg && typeof reg.open === 'function') reg.open(idToState.get(entries[i]) || state);
        }
      }
      position = target;
    } else {
      // Moved back: the consumed entries belonged to the topmost layers.
      while (open.length && position > target) {
        position -= 1;
        const name = open.pop();
        const reg = registry.get(name);
        if (reg && typeof reg.close === 'function') reg.close();
      }
      position = target;
    }
  });

  // Map popups: one shared layer ('markerpopup') for topic markers,
  // polygons and live markers. popupanim.js calls these from the
  // patched Popup prototype, so every popup in the app is covered.
  let currentPopup = null;
  window.layerPopupOpened = function (popup, data) {
    currentPopup = popup;
    layerOpened('markerpopup', data || {});
  };
  window.layerPopupClosed = function (popup) {
    if (popup._hlClosed) return;
    // Deferred one frame: replacing a popup (clicking marker B while A
    // is open) closes A and opens B in the same gesture, and A's close
    // must not consume B's entry. A real close (×, map tap) survives
    // the frame, because nothing replaces it.
    requestAnimationFrame(() => {
      if (popup._hlClosed || popup !== currentPopup) return;
      popup._hlClosed = true;
      currentPopup = null;
      layerClosedByUI('markerpopup');
    });
  };
})();
