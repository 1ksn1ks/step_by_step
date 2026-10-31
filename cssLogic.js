
import {
  everythinginsideoptionsbuttons,
  firstlayercolumns, 
  everythinginsideyourfov, 
  everythinginsidetoolbar,
  everyoverlay
} from './ui.js'
import { adjustTextareaHeight } from './adjusttextarea.js';
import { currentUfoModelInGLTF, globalLoadedTopicIdsWithNames} from './letall.js';
import { activePolygonPopups } from './polygons.js';
import { activeMarkerPopups } from './marker.js';
import { scene } from './threejs.js'
import { renderLoadedTopics } from './handleallmessages.js';
import { toast } from './toast.js';
import { formatHcsUsage, HCS_TOO_LONG } from './hcschunks.js';
import { composerWireBytes } from './chatimage.js';
import { fitChatComposer } from './chatcomposer.js';
import { closeDrawAnchor } from './drawhere.js';
import { closePressAnchor } from './poiinfo.js';

const toolbarColumns = document.querySelectorAll('.toolbar-column');

toolbarColumns.forEach(column => {
  column.addEventListener('touchstart', () => {
    column.classList.add('active'); // Add active class on touch
  });

  column.addEventListener('touchend', () => {
    column.classList.remove('active'); // Remove active class on touch end
  });
});

// Slow slider drags on phones are long-presses — kill the browser's
// copy/paste context menu inside the settings panels (the map's
// long-press uses touch events and is not affected)
document.querySelectorAll(".mb-panel").forEach((panel) => {
  panel.addEventListener("contextmenu", (e) => e.preventDefault());
});

// LOAD column paste button (inside the Domain/Topic ID field, always
// visible): replaces whatever is in the input with the clipboard text.
// readText needs a secure context, so a blocked read just shows a toast.
const loadInput = document.getElementById("input-field");
const pasteBtn = document.getElementById("paste-topic-btn");
if (pasteBtn) {
  pasteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const text = await navigator.clipboard.readText();
      if (loadInput) loadInput.value = text.trim();
    } catch (err) {
      console.error("Paste failed:", err);
      toast.error("Clipboard blocked - paste manually");
    }
  });
}

export function OpenToggleToolbar() {
    document.getElementById("main-toggle-btn").style.display = "none";
    document.getElementById("toggle-toolbar-btn-btn").style.display = "block";
    document.getElementById("topic-chat-btn").style.display = "block";
    document.getElementById("toggle-encrypted-chat-btn").style.display = "block";
  }
  
 export function OpenToggleYourFov() {
    document.getElementById("main-toggle-btn").style.display = "none";
    document.getElementById("toggle-your-fov-btn-btn").style.display = "block";
    document.getElementById("topic-chat-btn").style.display = "block";
    document.getElementById("toggle-encrypted-chat-btn").style.display = "block";
  }
  
export function withE2eeWebNotice(then) {
  const overlay = document.getElementById("e2ee-web-notice-overlay");
  const run = typeof then === "function" ? then : () => {};
  if (!overlay) {
    run();
    return;
  }
  overlay.style.display = "block";
  const finish = () => {
    overlay.style.display = "none";
    cont?.removeEventListener("click", finish);
    dismiss?.removeEventListener("click", finish);
    run();
  };
  const cont = overlay.querySelector("[data-e2ee-web-continue]");
  const dismiss = overlay.querySelector("[data-e2ee-web-dismiss]");
  cont?.addEventListener("click", finish);
  dismiss?.addEventListener("click", finish);
}

function syncE2eeClear(field, clearBtn) {
  const hasText = field.value.length > 0;
  if (clearBtn) clearBtn.hidden = !hasText;
  const wrap = field.closest(".secret-entry-field");
  if (wrap) wrap.classList.toggle("has-text", hasText);
}

function wireE2eeUnlockField() {
  const field = document.getElementById("encrypted-chat-private-key");
  const clearBtn = document.getElementById("encrypted-chat-private-key-clear");
  const revealBtn = document.getElementById("encrypted-chat-private-key-reveal");
  if (!field) return;
  syncE2eeClear(field, clearBtn);
  if (!field.dataset.clearWired) {
    field.dataset.clearWired = "1";
    field.addEventListener("input", () => syncE2eeClear(field, clearBtn));
  }
  if (clearBtn && !clearBtn.dataset.wired) {
    clearBtn.dataset.wired = "1";
    clearBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      field.value = "";
      syncE2eeClear(field, clearBtn);
      field.focus();
    });
  }
  if (revealBtn && !revealBtn.dataset.wired) {
    revealBtn.dataset.wired = "1";
    revealBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const show = !field.classList.contains("is-revealed");
      field.classList.toggle("is-revealed", show);
      revealBtn.setAttribute("aria-pressed", show ? "true" : "false");
      revealBtn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      revealBtn.title = show ? "Hide" : "Show";
    });
  }
}

export let popIsOpen = false;
export function changePopupState(a){
  popIsOpen = a
}

// Closes every transient map overlay at once: the left-tap draw pin (📍/🔷),
// the long-press / right-click press pin (🗺/📡) and all open marker +
// polygon popups. Opening one of these should never leave another behind.
export function closeTransientMapUI() {
  closeDrawAnchor();
  closePressAnchor();
  activePolygonPopups.forEach((popup) => popup.remove());
  activeMarkerPopups.forEach((popup) => popup.remove());
}

// Panels wired as history layers (watchDisplayLayer in the block below) —
// CloseALL reports them synchronously, so a layer that opens in the same
// gesture (e.g. a marker popup after a marker tap) sees the close first.
const HISTORY_PANELS = [
  "toolbar", "Edit_Profile-column", "load-column", "create-column",
  "draw-column", "utility-column", "memo-column", "domain-column",
  "stack-topic-ids", "initial-xyz-column", "visibility-controls",
  "rotation-controls", "model-column", "crosshair-column",
  "marker-options-column",
  "topic-chat-column",
];
const HISTORY_MEMO_SUBS = [
  "update-bio-from-memo", "memo-from-memo", "fee-from-memo", "topic-name-from-memo",
];

export function CloseALL() {
    // The bio only hides the popup it came from. A real close (×, map
    // tap, another panel) drops that popup; Back restores it first, so
    // this list is empty and the popup stays.
    if (window.dismissBioPopups) window.dismissBioPopups();
    // An in-progress edit sits above the chat in history. Drop it first
    // so Android back / this close does not leave that entry behind.
    if (typeof window.closeTopicChatEdit === 'function') window.closeTopicChatEdit();
    if (typeof window.closeE2eeChatEdit === 'function') window.closeE2eeChatEdit();
    // Back/Forward: the chat panels close through here (their × button
    // and every map tap), so record which are open before hiding them.
    const historyLayers = [];
    const topicChatEl = document.getElementById("topic-chat-container");
    if (topicChatEl && topicChatEl.style.display === "flex") historyLayers.push("topicchat");
    const e2eeChatEl = document.getElementById("encrypted-chat-container");
    if (e2eeChatEl && e2eeChatEl.style.display === "flex") historyLayers.push("e2eechat");
    // Memo sub-panels first: they sit on top of memo-column, and their
    // display is not touched by the hide loops below (hidden parent only).
    for (const subId of HISTORY_MEMO_SUBS) {
      const el = document.getElementById(subId);
      if (el && el.style.display !== "none") {
        historyLayers.push(subId);
        el.style.display = "none";
      }
    }
    for (const panelId of HISTORY_PANELS) {
      const el = document.getElementById(panelId);
      if (el && el.style.display !== "none") historyLayers.push(panelId);
    }
    everythinginsideoptionsbuttons.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    everythinginsideyourfov.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    everythinginsidetoolbar.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    firstlayercolumns.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    everyoverlay.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    for (const name of historyLayers) layerClosedByUI(name);
    document.getElementById("main-toggle-btn").style.display = "block";
    document.getElementById("topic-chat-btn").style.display = "block";
    document.getElementById("toggle-encrypted-chat-btn").style.display = "block";
    document.getElementById("toggle-toolbar-btn-btn").style.display = "none";
    document.getElementById("toggle-your-fov-btn-btn").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "flex";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "flex";
    setE2eeMessagesVisible(true);
    if (popIsOpen === false) {
      if (currentUfoModelInGLTF) {
              scene.add(currentUfoModelInGLTF);
              crosshair.style.display = "block";
            }
    }
  }
  
  // Backdrop press closes only that overlay — letting it bubble to the
  // document handlers would also run CloseALL / close the draw pin
  wireE2eeUnlockField();
  document.querySelectorAll('.info-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target !== overlay) return;
      e.stopPropagation();
      overlay.style.display = 'none';
    });
  });

  document.addEventListener('click', function(event) {
    CloseALL();
  });
  
 export function removeUfoModel() {
    if (currentUfoModelInGLTF) {
      scene.remove(currentUfoModelInGLTF);
      crosshair.style.display = "none";
    }
  }
  
  document.getElementById("main-toggle-btn").addEventListener("click", function(event) {
    event.stopPropagation();
    CloseALL();
    closeTransientMapUI();
    document.getElementById("main-toggle-btn").style.display = "none";
    document.getElementById("topic-chat-btn").style.display = "none";
    document.getElementById("toggle-encrypted-chat-btn").style.display = "none";

    everythinginsideoptionsbuttons.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "flex";
    });
  });

  // The ? button in the top-right corner of each panel opens that
  // panel's help overlay (overlays never auto-open anymore)
  const PANEL_HELP = [
    ["visibility-controls", "visibility-help-overlay"],
    ["model-column", "change-model-help-overlay"],
    ["crosshair-column", "crosshair-settings-help-overlay"],
    ["marker-options-column", "marker-size-help-overlay"],
    ["topic-chat-column", "chat-style-help-overlay"],
    ["Edit_Profile-column", "edit-profile-help-overlay"],
    ["load-column", "load-options-help-overlay"],
    ["create-column", "create-topic-help-overlay"],
    ["draw-column", "map-draw-help-overlay"],
    ["utility-column", "model-sharing-rules-help-overlay"],
    ["memo-column", "edit-topic-rules-help-overlay"],
    ["domain-column", "domain-help-overlay"],
    ["stack-topic-ids", "stack-topic-ids-help-overlay"],
    ["topic-chat-container", "topic-chat-help-overlay"],
    ["encrypted-chat-container", "e2ee-chat-help-overlay"],
  ];
  PANEL_HELP.forEach(([panelId, overlayId]) => {
    document.getElementById("help-" + panelId).addEventListener("click", (event) => {
      event.stopPropagation();
      document.getElementById(overlayId).style.display = "block";
    });
  });

  // Back/Forward: a help overlay is a layer of its own. Every open and
  // close path (the ? button, its × / Got it, the backdrop, CloseALL)
  // is a display change, so a style observer is the single funnel.
  if (window.defineLayer) {
    const restoreMapDrawer = () => {
      if (window.restoreDrawerFromMap) window.restoreDrawerFromMap();
    };
    window.defineLayer("topicchat", {
      open: () => document.getElementById("topic-chat-btn").click(),
      close: () => {
        const panel = document.getElementById("topic-chat-container");
        if (panel && panel.dataset.navLeaving === "1") {
          restoreMapDrawer();
          return;
        }
        CloseALL();
        restoreMapDrawer();
      },
    });
    window.defineLayer("e2eechat", {
      open: () => document.getElementById("toggle-encrypted-chat-btn").click(),
      close: () => {
        const panel = document.getElementById("encrypted-chat-container");
        if (panel && panel.dataset.navLeaving === "1") {
          restoreMapDrawer();
          return;
        }
        CloseALL();
        restoreMapDrawer();
      },
    });
    PANEL_HELP.forEach(([, overlayId]) => {
      const overlay = document.getElementById(overlayId);
      if (!overlay) return;
      const name = "overlay:" + overlayId;
      window.defineLayer(name, {
        open: () => { overlay.style.display = "block"; },
        close: () => { overlay.style.display = "none"; },
      });
      let wasOpen = overlay.style.display === "block";
      new MutationObserver(() => {
        const isNowOpen = overlay.style.display === "block";
        if (isNowOpen === wasOpen) return;
        wasOpen = isNowOpen;
        if (isNowOpen) window.layerOpened(name);
        else window.layerClosedByUI(name);
      }).observe(overlay, { attributes: true, attributeFilter: ["style"] });
    });

    // The toolbar menu, its sub-columns and the filter/visibility panels
    // are layers too. Every close path (the auto × button, a map tap,
    // opening another panel) ends in display:none, so one display watcher
    // per panel is the single close funnel; Back closes one level at a
    // time and Forward reopens by clicking the panel's own button (a
    // hidden button still receives a programmatic click).
    const panelLayer = (id, triggerId) => {
      window.watchDisplayLayer(id, document.getElementById(id), {
        open: () => document.getElementById(triggerId).click(),
        close: () => CloseALL(),
      });
    };
    // Sub-columns: Back hides the column and reopens its parent panel
    // (clicking the parent's own open button) instead of CloseALL, so one
    // Back step lands back on the toolbar / rotation controls.
    const subColumn = (id, triggerId, parent, parentTriggerId, extraIds = []) => {
      window.watchDisplayLayer(id, document.getElementById(id), {
        open: () => document.getElementById(triggerId).click(),
        close: () => {
          hideElements(id, ...extraIds);
          // The startup Load panel has no toolbar entry under it. Back
          // returns to the parent only when that parent is still the
          // layer underneath (opened from the toolbar or settings).
          if (window.layerIsOpen(parent)) {
            document.getElementById(parentTriggerId).click();
          }
        },
      }, parent);
    };
    // OPTIONS opens SETTINGS / VISIBILITY / TOOLBAR together. One button's
    // display is the layer: Back runs CloseALL, Forward clicks OPTIONS.
    // A map tap, tapping OPTIONS's spot, or picking one of those buttons
    // also runs CloseALL, so the entry is dropped with the other layers.
    window.watchDisplayLayer("options-menu", document.getElementById("toggle-toolbar-btn"), {
      open: () => document.getElementById("main-toggle-btn").click(),
      close: () => {
        CloseALL();
        if (window.restoreDrawerFromMap) window.restoreDrawerFromMap();
      },
    });
    panelLayer("toolbar", "toggle-toolbar-btn");
    subColumn("Edit_Profile-column", "Edit_Profile", "toolbar", "toggle-toolbar-btn", ["Edit_Profile-column-container"]);
    subColumn("load-column", "Load_Everything", "toolbar", "toggle-toolbar-btn", ["load-column-container"]);
    subColumn("create-column", "Create_New_Topic", "toolbar", "toggle-toolbar-btn", ["create-column-container"]);
    subColumn("draw-column", "Draw_Marker_Polygon", "toolbar", "toggle-toolbar-btn", ["draw-column-container"]);
    subColumn("utility-column", "NFT-utility", "toolbar", "toggle-toolbar-btn", ["utility-column-container"]);
    subColumn("memo-column", "Change_Memo", "toolbar", "toggle-toolbar-btn", ["memo-column-container"]);
    subColumn("domain-column", "Domain", "toolbar", "toggle-toolbar-btn", ["domain-column-container"]);
    subColumn("stack-topic-ids", "Stack_topic_IDs", "toolbar", "toggle-toolbar-btn", ["stack-topic-ids-container"]);
    subColumn("initial-xyz-column", "Set_Initial_XYZ", "toolbar", "toggle-toolbar-btn", ["initial-xyz-column-container"]);
    panelLayer("visibility-controls", "toggle-visibility-controls-btn");
    panelLayer("rotation-controls", "toggle-your-fov-btn");
    subColumn("model-column", "change-model-settings", "rotation-controls", "toggle-your-fov-btn",
      ["model-column-container", "model-column-save", "model-column-container-save"]);
    subColumn("crosshair-column", "change-crosshair-settings", "rotation-controls", "toggle-your-fov-btn",
      ["crosshair-column-container", "crosshair-column-save", "crosshair-column-container-save"]);
    subColumn("marker-options-column", "change-marker-options", "rotation-controls", "toggle-your-fov-btn",
      ["marker-options-column-container", "marker-column-save", "marker-column-container-save"]);
    subColumn("topic-chat-column", "change-topic-chat-options", "rotation-controls", "toggle-your-fov-btn",
      ["topic-chat-column-container", "topic-chat-save", "topic-chat-container-save"]);
    // Memo sub-panels: the ✅/⛔ buttons are plain toggles — the watcher
    // records the open, and closing through the ⛔ button drops the entry.
    const memoSub = (id, triggerId) => {
      window.watchDisplayLayer(id, document.getElementById(id), {
        open: () => document.getElementById(triggerId).click(),
        close: () => hideElements(id),
      }, "memo-column");
    };
    memoSub("update-bio-from-memo", "show-update-bio-from-memo");
    memoSub("memo-from-memo", "show-memo-from-memo");
    memoSub("fee-from-memo", "show-fee-from-memo");
    memoSub("topic-name-from-memo", "show-topic-name-from-memo");
  }

  // × close button: top-right corner — the opposite side of the ? help button
  // — of the toolbar itself, every toolbar container, the visibility panel,
  // the settings panel (rotation-controls) and each of its sub-panels. Same
  // behaviour as the chat close buttons: stopPropagation + CloseALL (back to
  // the map).
  const PANELS_WITH_CLOSE = [
    "toolbar",
    ...everythinginsidetoolbar,
    "visibility-controls",
    "rotation-controls",
    "model-column",
    "crosshair-column",
    "marker-options-column",
    "topic-chat-column",
    "popup-settings-card",
  ];
  PANELS_WITH_CLOSE.forEach(panelId => {
    const panel = document.getElementById(panelId);
    if (!panel || panel.querySelector(".panel-close-btn")) return;
    const btn = document.createElement("button");
    btn.className = "panel-close-btn";
    btn.id = "close-" + panelId + "-btn";
    btn.textContent = "×";
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      CloseALL();
    });
    panel.appendChild(btn);
  });

  // let toggleControlsPressCount = 0;
  
  // document.getElementById("toggle-controls-btn").addEventListener("click", (event) => {
  //   event.stopPropagation();
  //   CloseALL();
  //   const speedSlider = document.getElementById("speed-slider");
  //   const maplibreglCtrlGroup = document.querySelector(".maplibregl-ctrl.maplibregl-ctrl-group");
  //   toggleControlsPressCount++;
  //   if (toggleControlsPressCount === 1) {
  //     speedSlider.style.display = "block";
  //     if (maplibreglCtrlGroup) maplibreglCtrlGroup.style.display = "block";
  //   } else if (toggleControlsPressCount > 3) {
  //     speedSlider.style.display = "none";
  //     if (maplibreglCtrlGroup) maplibreglCtrlGroup.style.display = "none";
  //     toggleControlsPressCount = 0;
  //   }
  //   const zoomControls = document.getElementById("zoom-controls");
  //   const leftDpad = document.getElementById("left-dpad");
  //   const rightDpad = document.getElementById("right-dpad");
  //   const isVisible = getComputedStyle(zoomControls).display !== "none";
  //   if (isVisible) {
  //     zoomControls.setAttribute("style", "display: none !important");
  //     leftDpad.setAttribute("style", "display: none !important");
  //     rightDpad.setAttribute("style", "display: none !important");
  //   } else {
  //     zoomControls.setAttribute("style", "display: flex !important; z-index: 2000 !important; opacity: 1 !important; visibility: visible !important;");
  //     leftDpad.setAttribute("style", "display: grid !important; z-index: 2000 !important; opacity: 1 !important; visibility: visible !important;");
  //     rightDpad.setAttribute("style", "display: grid !important; z-index: 2000 !important; opacity: 1 !important; visibility: visible !important;");
  //   }
  // });
  
  document.getElementById("toggle-visibility-controls-btn").addEventListener("click", function(event) {
    event.stopPropagation();
    CloseALL();
    document.getElementById("visibility-controls").style.display = "block";

    removeUfoModel();
  });
  
  document.getElementById("toggle-your-fov-btn").addEventListener("click", function(event) {
    event.stopPropagation();
    CloseALL();
    document.getElementById("rotation-controls").style.display = "block";
  });
  
  document.getElementById("toggle-your-fov-btn-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    closeTransientMapUI();
    document.getElementById("rotation-controls").style.display = "block";
  });
  
  document.getElementById("change-model-settings").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("model-column").style.display = "block";
    document.getElementById("model-column-container").style.display = "block";
    document.getElementById("model-column-save").style.display = "block";
    document.getElementById("model-column-container-save").style.display = "block";

    OpenToggleYourFov();
  });
  
  document.getElementById("change-crosshair-settings").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("crosshair-column").style.display = "block";
    document.getElementById("crosshair-column-container").style.display = "block";
    document.getElementById("crosshair-column-save").style.display = "block";
    document.getElementById("crosshair-column-container-save").style.display = "block";

    OpenToggleYourFov();
  });

  document.getElementById("change-marker-options").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("marker-options-column").style.display = "block";
    document.getElementById("marker-options-column-container").style.display = "block";
    document.getElementById("marker-column-save").style.display = "block";
    document.getElementById("marker-column-container-save").style.display = "block";

    OpenToggleYourFov();
    removeUfoModel();
  });
  
  document.getElementById("change-topic-chat-options").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("topic-chat-column").style.display = "block";
    document.getElementById("topic-chat-column-container").style.display = "block";
    document.getElementById("topic-chat-save").style.display = "block";
    document.getElementById("topic-chat-container-save").style.display = "block";
    
    OpenToggleYourFov();
    removeUfoModel();
  });
  
  document.getElementById("toggle-toolbar-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("toolbar").style.display = "block";
    removeUfoModel();
  });
  
  document.getElementById("Edit_Profile").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("Edit_Profile-column").style.display = "block";
    document.getElementById("Edit_Profile-column-container").style.display = "block";

    OpenToggleToolbar();
    removeUfoModel();
  });
  
  document.getElementById("Load_Everything").addEventListener("click", (event) => {
    event.stopPropagation();
    // Load is only the full-screen page opened from the drawer.
    if (typeof window.openLoadPage === "function") window.openLoadPage();
  });
  
  document.getElementById("Create_New_Topic").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("create-column").style.display = "block";
    document.getElementById("create-column-container").style.display = "block";

    OpenToggleToolbar();
    removeUfoModel();
  });


  
  document.getElementById("Draw_Marker_Polygon").addEventListener("click", (event) => {
    event.stopPropagation();
    // Map and feed clear other map panels first. The drawer Draw row must
    // not: CloseALL would hide the Toolbar page this sheet slides over.
    const fromMap = event.currentTarget.dataset.fromMap === "1";
    const source = event.currentTarget.dataset.drawSource || (fromMap ? "map" : "drawer");
    delete event.currentTarget.dataset.fromMap;
    delete event.currentTarget.dataset.drawSource;
    if (source !== "drawer") CloseALL();
    // A map tap already picked marker or polygon, so the switch row is redundant.
    // The toolbar Draw button and the feed + leave it up.
    const switcher = document.getElementById("draw-shape-switch");
    if (switcher) switcher.style.display = fromMap ? "none" : "flex";
    const box = document.getElementById("draw-column-container");
    if (box) box.style.display = "block";
    if (typeof window.openDrawPage === "function") window.openDrawPage(source);
    removeUfoModel();
  });
  
  
  document.getElementById("NFT-utility").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("utility-column").style.display = "block";
    document.getElementById("utility-column-container").style.display = "block";

    OpenToggleToolbar();
    removeUfoModel();
  });
  
  document.getElementById("Change_Memo").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("memo-column").style.display = "block";
    document.getElementById("memo-column-container").style.display = "block";

    // Start with only the four sub-buttons; each opens its own panel
    showElements("show-update-bio-from-memo", "show-memo-from-memo", "show-fee-from-memo", "show-topic-name-from-memo");
    hideElements(
      "hide-update-bio-from-memo", "update-bio-from-memo",
      "hide-memo-from-memo", "memo-from-memo",
      "hide-fee-from-memo", "fee-from-memo",
      "hide-topic-name-from-memo", "topic-name-from-memo"
    );

    OpenToggleToolbar();
    removeUfoModel();
  });

  document.getElementById("Domain").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("domain-column").style.display = "block";
    document.getElementById("domain-column-container").style.display = "block";

    OpenToggleToolbar();
    removeUfoModel();
  });

  document.getElementById("Stack_topic_IDs").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("stack-topic-ids").style.display = "block";
    document.getElementById("stack-topic-ids-container").style.display = "block";

    OpenToggleToolbar();
    removeUfoModel();
  });

  document.getElementById("Set_Initial_XYZ").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("initial-xyz-column").style.display = "block";
    document.getElementById("initial-xyz-column-container").style.display = "block";

    OpenToggleToolbar();
    removeUfoModel();
  });
  
  // Chat panels: the message list is the only part that resizes. Whenever
  // anything inside the panel is shown/hidden (options, filters, auto-growing
  // inputs), the list is set to exactly the remaining space, so the message
  // input stays pinned to the bottom of the fixed-size panel.
  // The short open state skips this. After Load the panel is the original
  // full-screen chat, and the list takes the leftover space.
  function fitChatMessages(messagesId) {
    const messages = document.getElementById(messagesId);
    if (!messages) return;
    const container = messages.closest(".topic-chat-container");
    if (!container || getComputedStyle(container).display === "none") return;
    if (container.classList.contains("topic-chat-compact")) return;
    // The feed shell is a flex column. A pixel height here pins the list
    // and lets the options form eat the thread.
    if (container.classList.contains("is-feed-shell")) {
      if (messages.style.height) messages.style.height = "";
      return;
    }
    const wrap = messages.parentElement;      // .chat-messages-wrap
    const inner = wrap.parentElement;         // .chat-topic-chat-container
    const span = (el) => {
      const s = getComputedStyle(el);
      return el.offsetHeight + (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0);
    };
    let used = 0;
    for (const child of inner.children) {
      if (child === wrap) continue;
      if (getComputedStyle(child).display === "none") continue;
      used += span(child);
    }
    for (const child of wrap.children) {
      if (child === messages) continue;
      const cs = getComputedStyle(child);
      // ⬆⬇ float over the list (absolute) — they take no space
      if (cs.display === "none" || cs.position === "absolute") continue;
      used += span(child);
    }
    messages.style.height = Math.max(0, inner.clientHeight - used) + "px";
  }

  // After Load, both chats use the original full-screen panel. The lock
  // covers the style writes so the observer below does not layout again
  // in the same turn.
  const chatLayoutLock = new Set();
  const chatLayoutQueued = new Set();

  function layoutChatPanel(containerId, messagesId) {
    if (chatLayoutLock.has(containerId)) return;
    const container = document.getElementById(containerId);
    const messages = document.getElementById(messagesId);
    if (!container || !messages) return;
    if (getComputedStyle(container).display === "none") return;
    if (container.classList.contains("topic-chat-compact")) return;

    chatLayoutLock.add(containerId);
    try {
      container.classList.remove("topic-chat-fit", "topic-chat-capped");
      container.style.height = "";
      container.style.maxHeight = "";
      messages.style.overflowY = "";
      fitChatMessages(messagesId);
      const composeField = document.getElementById(containerId === "encrypted-chat-container"
        ? "user-write-message-encrypted-chat"
        : "user-write-message");
      fitChatComposer(composeField);
    } finally {
      requestAnimationFrame(() => { chatLayoutLock.delete(containerId); });
    }
  }

  function scheduleChatPanel(containerId, messagesId) {
    if (chatLayoutQueued.has(containerId) || chatLayoutLock.has(containerId)) return;
    chatLayoutQueued.add(containerId);
    requestAnimationFrame(() => {
      chatLayoutQueued.delete(containerId);
      layoutChatPanel(containerId, messagesId);
    });
  }

  // Leave the short open state and use the original full-screen chat.
  function expandChatPanel(containerId, messagesId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.classList.remove("topic-chat-compact");
    layoutChatPanel(containerId, messagesId);
  }

  export function scheduleTopicChatLayout() {
    scheduleChatPanel("topic-chat-container", "messages-from-topic-chat");
  }
  export function expandTopicChat() {
    expandChatPanel("topic-chat-container", "messages-from-topic-chat");
  }
  export function scheduleEncryptedChatLayout() {
    scheduleChatPanel("encrypted-chat-container", "messages-from-encrypted-chat");
  }
  export function expandEncryptedChat() {
    expandChatPanel("encrypted-chat-container", "messages-from-encrypted-chat");
  }

  [["topic-chat-container", "messages-from-topic-chat"],
   ["encrypted-chat-container", "messages-from-encrypted-chat"]].forEach(([containerId, messagesId]) => {
    const container = document.getElementById(containerId);
    const inner = container.querySelector(".chat-topic-chat-container");
    const refit = () => scheduleChatPanel(containerId, messagesId);
    // Every show/hide inside the panel changes a style attribute -> refit
    new MutationObserver(refit).observe(inner, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    window.addEventListener("resize", refit);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", refit);
  });

  // Enter inserts a newline. Send stays on the button.
  // Topic chat bytes are the JSON object that is submitted, so a newline
  // costs 2 bytes. E2EE bytes are the plaintext that is encrypted: 1 byte
  // per newline, or 2 once an image wraps the text in JSON.
  // Phone: a swipe on the composer must not scroll the chat list, the
  // panel, or the page. Direction is the latest move, not where the
  // finger landed. A field taller than its box still scrolls itself,
  // and stops at the ends. A short field ignores the swipe. A text
  // selection is left to the browser.
  function composerRoom(el) {
    return el.scrollHeight - el.clientHeight;
  }
  // Border-box height set to scrollHeight still leaves the border
  // (about 2px) as room. That is not a scrollable message.
  function composerScrollable(el) {
    return composerRoom(el) > 4;
  }
  function syncComposerOverflow(el) {
    el.style.overflowY = composerScrollable(el) ? "auto" : "hidden";
  }
  function containComposerTouch(el) {
    let prevY = 0;
    let prevX = 0;
    syncComposerOverflow(el);
    el.addEventListener("input", () => syncComposerOverflow(el));
    el.addEventListener("touchstart", (event) => {
      const t = event.touches[0];
      if (!t) return;
      syncComposerOverflow(el);
      prevY = t.clientY;
      prevX = t.clientX;
    }, { passive: true });
    el.addEventListener("touchmove", (event) => {
      if (event.touches.length !== 1) return;
      const t = event.touches[0];
      const dy = t.clientY - prevY;
      const dx = t.clientX - prevX;
      prevY = t.clientY;
      prevX = t.clientX;
      if (!event.cancelable) return;
      if (el.selectionStart !== el.selectionEnd) return;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4) return;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (!composerScrollable(el) || (atTop && dy > 0) || (atBottom && dy < 0)) {
        event.preventDefault();
      }
    }, { passive: false });
  }

  [
    ["user-write-message", "char-counter", "topic", "post-msg"],
    ["user-write-message-encrypted-chat", "char-counter-encrypted-chat", "e2ee", "post-msg-encrypted-chat"],
  ].forEach(([id, counterId, kind, sendId]) => {
    const ta = document.getElementById(id);
    const counter = document.getElementById(counterId);
    const send = document.getElementById(sendId);
    containComposerTouch(ta);
    const paintBytes = () => {
      if (!counter) return;
      // Edit mode paints the sealed edit size itself. A normal send count
      // would ignore the original image and the edit envelope.
      if (ta.closest(".chat-compose")?.classList.contains("is-editing")) return;
      const usage = formatHcsUsage(composerWireBytes(kind, ta.value));
      counter.hidden = false;
      counter.textContent = usage.text;
      counter.classList.toggle("hcs-warn", usage.warn);
      counter.classList.toggle("hcs-over", usage.over);
      // A disabled control never receives the click, so the too-long toast
      // could not show. The class blocks the send and keeps the click.
      if (send) send.classList.toggle("hcs-send-blocked", usage.over);
    };
    ta.addEventListener("input", () => {
      fitChatComposer(ta);
      paintBytes();
    });
    document.addEventListener("chat-image-changed", paintBytes);
    paintBytes();
    fitChatComposer(ta);
    if (!send || send.dataset.hcsWatch) return;
    send.dataset.hcsWatch = "1";
    send.addEventListener("click", (event) => {
      if (!send.classList.contains("hcs-send-blocked")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toast.error(HCS_TOO_LONG);
    }, true);
  });

  document.getElementById("topic-chat-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    closeTransientMapUI();
    hideAllShowButtonsFromTopicChat()
    const topicChatPanel = document.getElementById("topic-chat-container");
    topicChatPanel.classList.add("topic-chat-compact");
    topicChatPanel.classList.remove("topic-chat-fit", "topic-chat-capped");
    topicChatPanel.style.height = "";
    topicChatPanel.style.maxHeight = "";
    topicChatPanel.style.display = "flex";
    layerOpened("topicchat");
    document.getElementById("options-from-topic-chat").style.display = "none";
    document.getElementById("show-options-from-topic-chat").style.display = "block";
    document.getElementById("show-options-from-topic-chat-btn").style.display = "none";
    const topicChatList = document.getElementById("messages-from-topic-chat");
    topicChatList.style.height = "";
    topicChatList.style.overflowY = "";

    removeUfoModel();
  });

  // Full-screen topic / E2EE chat: × button returns to the map
  const closeTopicChatBtn = document.getElementById("close-topic-chat-btn");
  if (closeTopicChatBtn) {
    closeTopicChatBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      CloseALL();
    });
  }
  const closeEncryptedChatBtn = document.getElementById("close-encrypted-chat-btn");
  if (closeEncryptedChatBtn) {
    closeEncryptedChatBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      CloseALL();
    });
  }

  document.getElementById("show-options-from-topic-chat").addEventListener("click", (event) => {
    document.getElementById("options-from-topic-chat").style.display = "block";
    document.getElementById("show-options-from-topic-chat").style.display = "none";
    document.getElementById("show-options-from-topic-chat-btn").style.display = "block";
    showAllShowButtonsFromTopicChatOptions()
  });
  
  document.getElementById("show-options-from-topic-chat-btn").addEventListener("click", (event) => {
    document.getElementById("options-from-topic-chat").style.display = "none";
    document.getElementById("show-options-from-topic-chat-btn").style.display = "none";
    document.getElementById("show-options-from-topic-chat").style.display = "block";
    hideAllShowButtonsFromTopicChat()
  });
  







  const allShowButtonsFromTopicChat = [
    document.getElementById("time-from-topic-chat"),
    document.getElementById("time-from-topic-chat-filter"),
    document.getElementById("load-msgs-from-ids-from-topic-chat"),
    document.getElementById("load-blocks-from-ids-from-topic-chat"),
    document.getElementById("load-load-from-users-label-from-topic-chat"),
    document.getElementById("load-load-from-users-from-topic-chat"),
    document.getElementById("load-block-from-users-label-from-topic-chat"),
    document.getElementById("load-block-from-users-from-topic-chat"),
    document.getElementById("hide-time-from-topic-chat"),
    document.getElementById("hide-from-from-topic-chat"),
    document.getElementById("hide-block-from-topic-chat"),
  ];
  
  function hideAllShowButtonsFromTopicChat() {
    allShowButtonsFromTopicChat.forEach(element => {
    element.style.display = "none";
  });
  }
  
  const allShowButtonsFromTopicChatOptions = [
    document.getElementById("show-time-from-topic-chat"),
    document.getElementById("show-from-from-topic-chat"),
    document.getElementById("show-block-from-topic-chat"),
  ];
  
  function showAllShowButtonsFromTopicChatOptions() {
    allShowButtonsFromTopicChatOptions.forEach(element => {
    element.style.display = "block";
  });
  }
  
  document.getElementById("show-time-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("time-from-topic-chat").style.display = "block";
    document.getElementById("time-from-topic-chat-filter").style.display = "flex";
    document.getElementById("hide-time-from-topic-chat").style.display = "block";
    document.getElementById("show-time-from-topic-chat").style.display = "none";
  });
  
  document.getElementById("hide-time-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("hide-time-from-topic-chat").style.display = "none";
    document.getElementById("show-time-from-topic-chat").style.display = "block";
  });
  
  document.getElementById("show-from-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("load-msgs-from-ids-from-topic-chat").style.display = "block";
    document.getElementById("load-load-from-users-label-from-topic-chat").style.display = "block";
    document.getElementById("load-load-from-users-from-topic-chat").style.display = "flex";
    document.getElementById("hide-from-from-topic-chat").style.display = "block";
    document.getElementById("show-from-from-topic-chat").style.display = "none";
  });
  
  document.getElementById("hide-from-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("hide-from-from-topic-chat").style.display = "none";
    document.getElementById("show-from-from-topic-chat").style.display = "block";
  });
  
  document.getElementById("show-block-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("load-block-from-users-from-topic-chat").style.display = "flex";
    document.getElementById("load-blocks-from-ids-from-topic-chat").style.display = "block";
    document.getElementById("load-block-from-users-label-from-topic-chat").style.display = "block";
    document.getElementById("hide-block-from-topic-chat").style.display = "block";
    document.getElementById("show-block-from-topic-chat").style.display = "none";
  });
  
  document.getElementById("hide-block-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("hide-block-from-topic-chat").style.display = "none";
    document.getElementById("show-block-from-topic-chat").style.display = "block";
  });
  








  
  const allShowButtonsFromEncryptedChat = [
    document.getElementById("time-from-encrypted-chat"),
    document.getElementById("time-from-encrypted-chat-filter"),
    document.getElementById("load-msgs-from-ids-from-encrypted-chat"),
    document.getElementById("load-blocks-from-ids-from-encrypted-chat"),
    document.getElementById("load-load-from-users-label-from-encrypted-chat"),
    document.getElementById("load-load-from-users-from-encrypted-chat"),
    document.getElementById("load-block-from-users-label-from-encrypted-chat"),
    document.getElementById("load-block-from-users-from-encrypted-chat"),
    document.getElementById("pin-public-key-from-encrypted-chat"),
    document.getElementById("hide-pin-public-key-from-encrypted-chat"),
    document.getElementById("hide-block-from-encrypted-chat"),
    document.getElementById("hide-from-from-encrypted-chat"),
    document.getElementById("hide-time-from-encrypted-chat"),
    document.getElementById("hide-block-change-password-encrypted-chat"),
    document.getElementById("hide-time-set-password-encrypted-chat"),
    document.getElementById("encrypted-chat-change-password-key"),
    document.getElementById("encrypted-chat-change-password-key-label"),
    document.getElementById("encrypted-chat-new-password-key"),
    document.getElementById("encrypted-chat-new-password-key-label"),
    document.getElementById("change-password-encrypted-chat"),
    document.getElementById("set-password-encrypted-chat"),
    document.getElementById("encrypted-chat-public-key"),
  ];
  
  function hideAllShowButtonsFromEncryptedChat() {
    allShowButtonsFromEncryptedChat.forEach(element => {
    element.style.display = "none";
  });
  }
  
  const allShowButtonsFromEncryptedChatOptions = [
    document.getElementById("show-time-from-encrypted-chat"),
    document.getElementById("show-from-from-encrypted-chat"),
    document.getElementById("show-block-from-encrypted-chat"),
    document.getElementById("show-pin-public-key-from-encrypted-chat"),
    document.getElementById("show-block-change-password-encrypted-chat"),
    document.getElementById("show-time-set-password-encrypted-chat"),
  ];
  
  function showAllShowButtonsFromEncryptedChatOptions() {
    allShowButtonsFromEncryptedChatOptions.forEach(element => {
    element.style.display = "block";
  });
  }
  
  document.getElementById("show-time-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    // a Pin/Change/Set password mode may have hidden these — Block/Time/From
    // are the "load messages" context, so the normal inputs come back
    document.getElementById("encrypted-chat-private-key-container").style.display = "flex";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "flex";
    setE2eeMessagesVisible(true);
    document.getElementById("time-from-encrypted-chat").style.display = "block";
    document.getElementById("time-from-encrypted-chat-filter").style.display = "flex";
    document.getElementById("hide-time-from-encrypted-chat").style.display = "block";
    document.getElementById("show-time-from-encrypted-chat").style.display = "none";
  });
  
  document.getElementById("hide-time-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("hide-time-from-encrypted-chat").style.display = "none";
    document.getElementById("show-time-from-encrypted-chat").style.display = "block";
  });
  
  document.getElementById("show-from-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    // a Pin/Change/Set password mode may have hidden these — Block/Time/From
    // are the "load messages" context, so the normal inputs come back
    document.getElementById("encrypted-chat-private-key-container").style.display = "flex";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "flex";
    setE2eeMessagesVisible(true);
    document.getElementById("load-msgs-from-ids-from-encrypted-chat").style.display = "block";
    document.getElementById("load-load-from-users-label-from-encrypted-chat").style.display = "block";
    document.getElementById("load-load-from-users-from-encrypted-chat").style.display = "flex";
    document.getElementById("hide-from-from-encrypted-chat").style.display = "block";
    document.getElementById("show-from-from-encrypted-chat").style.display = "none";
  });
  
  document.getElementById("hide-from-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("hide-from-from-encrypted-chat").style.display = "none";
    document.getElementById("show-from-from-encrypted-chat").style.display = "block";
  });
  
  document.getElementById("show-block-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    // a Pin/Change/Set password mode may have hidden these — Block/Time/From
    // are the "load messages" context, so the normal inputs come back
    document.getElementById("encrypted-chat-private-key-container").style.display = "flex";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "flex";
    setE2eeMessagesVisible(true);
    document.getElementById("load-block-from-users-from-encrypted-chat").style.display = "flex";
    document.getElementById("load-blocks-from-ids-from-encrypted-chat").style.display = "block";
    document.getElementById("load-block-from-users-label-from-encrypted-chat").style.display = "block";
    document.getElementById("hide-block-from-encrypted-chat").style.display = "block";
    document.getElementById("show-block-from-encrypted-chat").style.display = "none";
  });
  
  document.getElementById("hide-block-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("hide-block-from-encrypted-chat").style.display = "none";
    document.getElementById("show-block-from-encrypted-chat").style.display = "block";
  });
  
  document.getElementById("show-pin-public-key-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("pin-public-key-from-encrypted-chat").style.display = "block";
    document.getElementById("encrypted-chat-public-key").style.display = "block";

    document.getElementById("hide-pin-public-key-from-encrypted-chat").style.display = "block";
    document.getElementById("show-pin-public-key-from-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "none";
    document.getElementById("encrypted-chat-chat-container").style.display = "none";
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "none";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "none";
    setE2eeMessagesVisible(false);
  });
  
  document.getElementById("hide-pin-public-key-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("hide-pin-public-key-from-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-public-key").style.display = "none";

    document.getElementById("show-pin-public-key-from-encrypted-chat").style.display = "block";
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("encrypted-chat-private-key-container").style.display = "flex";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
    setE2eeMessagesVisible(true);
  });

  // Search row and the message list stay out of the way for Pin, Change
  // password, and Set password. Clearing the inline display lets the
  // normal chat CSS show them again.
  function setE2eeMessagesVisible(visible) {
    const search = document.getElementById('e2ee-chat-msg-search');
    const controls = search && search.closest('.loaded-topics-controls');
    const messages = document.getElementById('messages-from-encrypted-chat');
    const wrap = messages && messages.closest('.chat-messages-wrap');
    const display = visible ? '' : 'none';
    if (controls) controls.style.display = display;
    if (wrap) wrap.style.display = display;
  }

  function labelPasswordFields(keyId, keyText, passId, passText) {
    const key = document.getElementById(keyId);
    const pass = document.getElementById(passId);
    key.placeholder = keyText;
    pass.placeholder = passText;
    document.querySelector('#' + keyId + '-label label').textContent = keyText;
    document.querySelector('#' + passId + '-label label').textContent = passText;
    document.getElementById(keyId + '-label').style.display = 'block';
    document.getElementById(passId + '-label').style.display = 'block';
  }

  document.getElementById("show-block-change-password-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("change-password-encrypted-chat").style.display = "block";
    labelPasswordFields('encrypted-chat-change-password-key', 'Old password', 'encrypted-chat-new-password-key', 'New password');
    document.getElementById("encrypted-chat-change-password-key").style.display = "block";
    document.getElementById("encrypted-chat-new-password-key").style.display = "block";
    document.getElementById("hide-block-change-password-encrypted-chat").style.display = "block";
    document.getElementById("show-block-change-password-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "none";
    document.getElementById("encrypted-chat-chat-container").style.display = "none";
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "none";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-public-key").style.display = "none";
    setE2eeMessagesVisible(false);

  });
  
  document.getElementById("hide-block-change-password-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "flex";
    // the public-key field belongs to Pin mode only
    document.getElementById("encrypted-chat-public-key").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "flex";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
    setE2eeMessagesVisible(true);
  });

  document.getElementById("show-time-set-password-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("set-password-encrypted-chat").style.display = "block";
    labelPasswordFields('encrypted-chat-change-password-key', 'Private key', 'encrypted-chat-new-password-key', 'Password');
    document.getElementById("encrypted-chat-change-password-key").style.display = "block";
    document.getElementById("encrypted-chat-new-password-key").style.display = "block";
    document.getElementById("hide-time-set-password-encrypted-chat").style.display = "block";
    document.getElementById("show-time-set-password-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "none";
    document.getElementById("encrypted-chat-chat-container").style.display = "none";
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "none";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-public-key").style.display = "none";
    setE2eeMessagesVisible(false);
  });
  
  document.getElementById("hide-time-set-password-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "flex";
    // the public-key field belongs to Pin mode only
    document.getElementById("encrypted-chat-public-key").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "flex";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
    setE2eeMessagesVisible(true);
  });
  
  document.getElementById("toggle-toolbar-btn-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("toolbar").style.display = "block";
    removeUfoModel();
  });
  
  document.getElementById("toggle-encrypted-chat-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    const fromDrawer = event.currentTarget.dataset.fromDrawer === "1";
    delete event.currentTarget.dataset.fromDrawer;
    const openChat = () => {
      CloseALL();
      closeDrawAnchor();
      activePolygonPopups.forEach((popup) => popup.remove());
      activeMarkerPopups.forEach((popup) => popup.remove());
      hideAllShowButtonsFromEncryptedChat()
      const encryptedChatPanel = document.getElementById("encrypted-chat-container");
      encryptedChatPanel.classList.add("topic-chat-compact");
      encryptedChatPanel.classList.remove("topic-chat-fit", "topic-chat-capped");
      encryptedChatPanel.style.height = "";
      encryptedChatPanel.style.maxHeight = "";
      encryptedChatPanel.style.display = "flex";
      layerOpened("e2eechat");
      document.getElementById("options-from-encrypted-chat").style.display = "none";
      document.getElementById("show-options-from-encrypted-chat").style.display = "block";
      document.getElementById("show-options-from-encrypted-chat-btn").style.display = "none";
      const encryptedChatList = document.getElementById("messages-from-encrypted-chat");
      encryptedChatList.style.height = "";
      encryptedChatList.style.overflowY = "";
      setE2eeMessagesVisible(true);

      removeUfoModel();
    };
    if (fromDrawer) {
      openChat();
      withE2eeWebNotice(() => {});
      return;
    }
    withE2eeWebNotice(openChat);
  });
  
  document.getElementById("show-options-from-encrypted-chat").addEventListener("click", (event) => {
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("options-from-encrypted-chat").style.display = "block";
    document.getElementById("show-options-from-encrypted-chat").style.display = "none";
    document.getElementById("show-options-from-encrypted-chat-btn").style.display = "block";
  });
  
  document.getElementById("show-options-from-encrypted-chat-btn").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    document.getElementById("options-from-encrypted-chat").style.display = "none";
    document.getElementById("show-options-from-encrypted-chat-btn").style.display = "none";
    document.getElementById("show-options-from-encrypted-chat").style.display = "block";
    document.getElementById("go-to-top-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("go-to-bottom-msgs-encrypted-chat").style.display = "flex";
    document.getElementById("encrypted-chat-private-key-container").style.display = "flex";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
    setE2eeMessagesVisible(true);
  
  });
  







  function closePopupColumn3options() {
    document.getElementById("popup-column-3-border").style.display = "none";
    document.getElementById("popup-column-3-number").style.display = "none";
    document.getElementById("popup-column-3-close").style.display = "none";
    document.getElementById("popup-column-3-accid").style.display = "none";
    document.getElementById("popup-column-3-username").style.display = "none";
    document.getElementById("popup-column-3-titles").style.display = "none";
    document.getElementById("popup-column-3-text").style.display = "none";
    document.getElementById("popup-column-3-font").style.display = "none";
    removeUfoModel();
  };
  
  document.getElementById("popup-column-2-border").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-border").style.display = "block";
  });
  
  document.getElementById("popup-column-2-number").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-number").style.display = "block";
  });
  
  document.getElementById("popup-column-2-close").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-close").style.display = "block";
  });
  
  document.getElementById("popup-column-2-accid").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-accid").style.display = "block";
  });
  
  document.getElementById("popup-column-2-username").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-username").style.display = "block";
  });
  
  document.getElementById("popup-column-2-titles").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-titles").style.display = "block";
  });
  
  document.getElementById("popup-column-2-text").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-text").style.display = "block";
  });
  
  document.getElementById("popup-column-2-font").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-font").style.display = "block";
  });
  
  
  




  
  
  const allOptionsFromNFTUtility = [
    document.getElementById("hide-topic-rules-from-nft-utility"),
    document.getElementById("hide-model-sharing-from-nft-utility"),
    document.getElementById("hide-model-size-scale-factor-from-nft-utility"),
    document.getElementById("hide-topic-chat-from-nft-utility"),
    document.getElementById("hide-markers-from-nft-utility"),
    document.getElementById("hide-polygons-from-nft-utility"),
    document.getElementById("topic-rules-from-nft-utility"),
    document.getElementById("model-sharing-from-nft-utility-label"),
    document.getElementById("model-sharing-from-nft-utility"),
    document.getElementById("model-sharing-from-nft-utility-button-group"),
    document.getElementById("model-size-scale-factor-from-nft-utility"),
    document.getElementById("topic-chat-from-nft-utility"),
    document.getElementById("markers-from-nft-utility"),
    document.getElementById("polygons-from-nft-utility"),
  ];
  
  function hideAllInnerOptionsFromNFTUtility() {
    allOptionsFromNFTUtility.forEach(element => {
    element.style.display = "none";
  });
  }
  
  const allShowButtonsFromNFTUtility = [
    document.getElementById("show-topic-rules-from-nft-utility"),
    document.getElementById("show-model-sharing-from-nft-utility"),
    document.getElementById("show-model-size-scale-factor-from-nft-utility"),
    document.getElementById("show-topic-chat-from-nft-utility"),
    document.getElementById("show-markers-from-nft-utility"),
    document.getElementById("show-polygons-from-nft-utility"),
  ];
  
  function showAllInnerOptionsFromNFTUtility() {
    allShowButtonsFromNFTUtility.forEach(element => {
    element.style.display = "block";
  });
  }
  
  document.getElementById("show-topic-rules-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("topic-rules-from-nft-utility").style.display = "block";
    document.getElementById("hide-topic-rules-from-nft-utility").style.display = "block";
    document.getElementById("show-topic-rules-from-nft-utility").style.display = "none";
  });
  
  document.getElementById("hide-topic-rules-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });
  
  document.getElementById("show-model-sharing-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("model-sharing-from-nft-utility").style.display = "block";
    document.getElementById("hide-model-sharing-from-nft-utility").style.display = "block";
    document.getElementById("show-model-sharing-from-nft-utility").style.display = "none";
    document.getElementById("model-sharing-from-nft-utility-button-group").style.display = "block";
    document.getElementById("model-sharing-from-nft-utility-label").style.display = "block";
  });
  
  document.getElementById("hide-model-sharing-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });
  
  document.getElementById("show-model-size-scale-factor-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("model-sharing-from-nft-utility-label").style.display = "block";
    document.getElementById("model-size-scale-factor-from-nft-utility").style.display = "block";
    document.getElementById("hide-model-size-scale-factor-from-nft-utility").style.display = "block";
    document.getElementById("show-model-size-scale-factor-from-nft-utility").style.display = "none";
    document.getElementById("model-sharing-from-nft-utility").style.display = "block";
  });
  
  document.getElementById("hide-model-size-scale-factor-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });
  
  document.getElementById("show-topic-chat-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("topic-chat-from-nft-utility").style.display = "block";
    document.getElementById("hide-topic-chat-from-nft-utility").style.display = "block";
    document.getElementById("show-topic-chat-from-nft-utility").style.display = "none";
  });
  
  document.getElementById("hide-topic-chat-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });

  document.getElementById("show-markers-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("markers-from-nft-utility").style.display = "block";
    document.getElementById("hide-markers-from-nft-utility").style.display = "block";
    document.getElementById("show-markers-from-nft-utility").style.display = "none";
  });

  document.getElementById("hide-markers-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });

  document.getElementById("show-polygons-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("polygons-from-nft-utility").style.display = "block";
    document.getElementById("hide-polygons-from-nft-utility").style.display = "block";
    document.getElementById("show-polygons-from-nft-utility").style.display = "none";
  });

  document.getElementById("hide-polygons-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });
  
  
// ==================== HELPER FUNCTIONS (reuse from before) ====================

function showElements(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "block";
  });
}

function showElementsFlex(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "flex";
  });
}

function hideElements(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}

  document.getElementById("show-new-topic-from-create").addEventListener("click", (event) => {
    document.getElementById("new-topic-from-create").style.display = "block";
    document.getElementById("hide-new-topic-from-create").style.display = "block";
    document.getElementById("show-new-topic-from-create").style.display = "none";
  });
  
  document.getElementById("hide-new-topic-from-create").addEventListener("click", (event) => {
    document.getElementById("new-topic-from-create").style.display = "none";
    document.getElementById("hide-new-topic-from-create").style.display = "none";
    document.getElementById("show-new-topic-from-create").style.display = "block";
  });
  
  document.getElementById("show-new-keys-from-create").addEventListener("click", (event) => {
    document.getElementById("new-keys-from-create").style.display = "block";
    document.getElementById("hide-new-keys-from-create").style.display = "block";
    document.getElementById("show-new-keys-from-create").style.display = "none";
  });
  
  document.getElementById("hide-new-keys-from-create").addEventListener("click", (event) => {
    document.getElementById("new-keys-from-create").style.display = "none";
    document.getElementById("hide-new-keys-from-create").style.display = "none";
    document.getElementById("show-new-keys-from-create").style.display = "block";
  });

  // The DRAW column title reflects the open form: MARKER / POLYGON / DRAW
  function updateDrawTitle() {
    const t = document.getElementById("draw-column-title");
    if (!t) return;
    if (document.getElementById("marker-column-container").style.display === "block") t.textContent = "📍 MARKER";
    else if (document.getElementById("polygon-column-container").style.display === "block") t.textContent = "🔷 POLYGON";
    else t.textContent = "✏️ DRAW";
  }

  document.getElementById("show-draw-marker").addEventListener("click", (event) => {
    document.getElementById("polygon-column-container").style.display = "none";
    document.getElementById("marker-column-container").style.display = "block";
    document.getElementById("hide-draw-marker").style.display = "block";
    document.getElementById("show-draw-marker").style.display = "none";
    document.getElementById("hide-draw-polygon").style.display = "none";
    document.getElementById("show-draw-polygon").style.display = "block";
    updateDrawTitle();
  });

  document.getElementById("hide-draw-marker").addEventListener("click", (event) => {
    document.getElementById("marker-column-container").style.display = "none";
    document.getElementById("hide-draw-marker").style.display = "none";
    document.getElementById("show-draw-marker").style.display = "block";
    updateDrawTitle();
  });

  document.getElementById("show-draw-polygon").addEventListener("click", (event) => {
    document.getElementById("marker-column-container").style.display = "none";
    document.getElementById("polygon-column-container").style.display = "block";
    document.getElementById("hide-draw-polygon").style.display = "block";
    document.getElementById("show-draw-polygon").style.display = "none";
    document.getElementById("hide-draw-marker").style.display = "none";
    document.getElementById("show-draw-marker").style.display = "block";
    updateDrawTitle();
  });

  document.getElementById("hide-draw-polygon").addEventListener("click", (event) => {
    document.getElementById("polygon-column-container").style.display = "none";
    document.getElementById("hide-draw-polygon").style.display = "none";
    document.getElementById("show-draw-polygon").style.display = "block";
    updateDrawTitle();
  });
  

// ==================== UPDATE TOPIC (MEMO COLUMN) EVENT LISTENERS ====================
// Pressing a ✅ opens only that panel and re-shows the other ✅ buttons

document.getElementById("show-update-bio-from-memo").addEventListener("click", () => {
  showElements("update-bio-from-memo", "hide-update-bio-from-memo");
  hideElements("show-update-bio-from-memo");

  hideElements("memo-from-memo", "hide-memo-from-memo");
  showElements("show-memo-from-memo");

  hideElements("fee-from-memo", "hide-fee-from-memo");
  showElements("show-fee-from-memo");

  hideElements("topic-name-from-memo", "hide-topic-name-from-memo");
  showElements("show-topic-name-from-memo");
});

document.getElementById("hide-update-bio-from-memo").addEventListener("click", () => {
  hideElements("update-bio-from-memo", "hide-update-bio-from-memo");
  showElements("show-update-bio-from-memo");

  hideElements("memo-from-memo", "hide-memo-from-memo");
  showElements("show-memo-from-memo");

  hideElements("fee-from-memo", "hide-fee-from-memo");
  showElements("show-fee-from-memo");

  hideElements("topic-name-from-memo", "hide-topic-name-from-memo");
  showElements("show-topic-name-from-memo");
});

document.getElementById("show-memo-from-memo").addEventListener("click", () => {
  showElements("memo-from-memo", "hide-memo-from-memo");
  hideElements("show-memo-from-memo");

  hideElements("update-bio-from-memo", "hide-update-bio-from-memo");
  showElements("show-update-bio-from-memo");

  hideElements("fee-from-memo", "hide-fee-from-memo");
  showElements("show-fee-from-memo");

  hideElements("topic-name-from-memo", "hide-topic-name-from-memo");
  showElements("show-topic-name-from-memo");
});

document.getElementById("hide-memo-from-memo").addEventListener("click", () => {
  hideElements("memo-from-memo", "hide-memo-from-memo");
  showElements("show-memo-from-memo");

  hideElements("update-bio-from-memo", "hide-update-bio-from-memo");
  showElements("show-update-bio-from-memo");

  hideElements("fee-from-memo", "hide-fee-from-memo");
  showElements("show-fee-from-memo");

  hideElements("topic-name-from-memo", "hide-topic-name-from-memo");
  showElements("show-topic-name-from-memo");
});

document.getElementById("show-fee-from-memo").addEventListener("click", () => {
  showElements("fee-from-memo", "hide-fee-from-memo");
  hideElements("show-fee-from-memo");

  hideElements("update-bio-from-memo", "hide-update-bio-from-memo");
  showElements("show-update-bio-from-memo");

  hideElements("memo-from-memo", "hide-memo-from-memo");
  showElements("show-memo-from-memo");

  hideElements("topic-name-from-memo", "hide-topic-name-from-memo");
  showElements("show-topic-name-from-memo");
});

document.getElementById("hide-fee-from-memo").addEventListener("click", () => {
  hideElements("fee-from-memo", "hide-fee-from-memo");
  showElements("show-fee-from-memo");

  hideElements("update-bio-from-memo", "hide-update-bio-from-memo");
  showElements("show-update-bio-from-memo");

  hideElements("memo-from-memo", "hide-memo-from-memo");
  showElements("show-memo-from-memo");

  hideElements("topic-name-from-memo", "hide-topic-name-from-memo");
  showElements("show-topic-name-from-memo");
});

document.getElementById("show-topic-name-from-memo").addEventListener("click", () => {
  showElements("topic-name-from-memo", "hide-topic-name-from-memo");
  hideElements("show-topic-name-from-memo");

  hideElements("update-bio-from-memo", "hide-update-bio-from-memo");
  showElements("show-update-bio-from-memo");

  hideElements("memo-from-memo", "hide-memo-from-memo");
  showElements("show-memo-from-memo");

  hideElements("fee-from-memo", "hide-fee-from-memo");
  showElements("show-fee-from-memo");
});

document.getElementById("hide-topic-name-from-memo").addEventListener("click", () => {
  hideElements("topic-name-from-memo", "hide-topic-name-from-memo");
  showElements("show-topic-name-from-memo");

  hideElements("update-bio-from-memo", "hide-update-bio-from-memo");
  showElements("show-update-bio-from-memo");

  hideElements("memo-from-memo", "hide-memo-from-memo");
  showElements("show-memo-from-memo");

  hideElements("fee-from-memo", "hide-fee-from-memo");
  showElements("show-fee-from-memo");
});

  
  
  
  
  
  
  
  const insideEditProfileEverything = [
    document.getElementById("edit-profile-picture"),
    document.getElementById("edit-profile-username"),
    document.getElementById("edit-profile-click2link"),
    document.getElementById("edit-profile-bio"),
    document.getElementById("edit-profile-topic"),
    document.getElementById("edit-profile-public-key"),
  ];

  const insideEditProfileShowOptions = [
    document.getElementById("show-profile-picture-from-edit-profile"),
    document.getElementById("show-username-from-edit-profile"),
    document.getElementById("show-click2link-from-edit-profile"),
    document.getElementById("show-bio-from-edit-profile"),
    document.getElementById("show-topic-from-edit-profile"),
    document.getElementById("show-public-key-from-edit-profile"),
  ];


  const insideEditProfileHideOptions = [
    document.getElementById("hide-profile-picture-from-edit-profile"),
    document.getElementById("hide-username-from-edit-profile"),
    document.getElementById("hide-click2link-from-edit-profile"),
    document.getElementById("hide-bio-from-edit-profile"),
    document.getElementById("hide-topic-from-edit-profile"),
    document.getElementById("hide-public-key-from-edit-profile"),
  ];
  
  
  function editProfileShowOptions() {
    insideEditProfileShowOptions.forEach(element => {
    element.style.display = "block";
  });
  }
  
  
  function editProfileEverything() {
    insideEditProfileEverything.forEach(element => {
    element.style.display = "none";
  });
  }
  
  function editProfileHideOptions() {
    insideEditProfileHideOptions.forEach(element => {
    element.style.display = "none";
  });
  }
  
  document.getElementById("show-profile-picture-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-profile-picture-from-edit-profile").style.display = "block";
    document.getElementById("show-profile-picture-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-picture").style.display = "block";
  });
  
  document.getElementById("hide-profile-picture-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-profile-picture-from-edit-profile").style.display = "none";
    document.getElementById("show-profile-picture-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-picture").style.display = "none";
  });
  
  document.getElementById("show-username-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-username-from-edit-profile").style.display = "block";
    document.getElementById("show-username-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-username").style.display = "block";
  });
  
  
  document.getElementById("hide-username-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-username-from-edit-profile").style.display = "none";
    document.getElementById("show-username-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-username").style.display = "none";
  });
  
  document.getElementById("show-click2link-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-click2link-from-edit-profile").style.display = "block";
    document.getElementById("show-click2link-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-click2link").style.display = "block";
  });
  
  document.getElementById("hide-click2link-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-click2link-from-edit-profile").style.display = "none";
    document.getElementById("show-click2link-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-click2link").style.display = "none";
  });
  
  document.getElementById("show-bio-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-bio-from-edit-profile").style.display = "block";
    document.getElementById("show-bio-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-bio").style.display = "block";
  });

  document.getElementById("hide-bio-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-bio-from-edit-profile").style.display = "none";
    document.getElementById("show-bio-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-bio").style.display = "none";
  });

  document.getElementById("show-topic-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-topic-from-edit-profile").style.display = "block";
    document.getElementById("show-topic-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-topic").style.display = "block";
  });

  document.getElementById("hide-topic-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-topic-from-edit-profile").style.display = "none";
    document.getElementById("show-topic-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-topic").style.display = "none";
  });

  document.getElementById("show-public-key-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-public-key-from-edit-profile").style.display = "block";
    document.getElementById("show-public-key-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-public-key").style.display = "block";
  });

  document.getElementById("hide-public-key-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("hide-public-key-from-edit-profile").style.display = "none";
    document.getElementById("show-public-key-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-public-key").style.display = "none";
  });
  
  const allLoadColumns = [
    document.getElementById("time-from-users-load-column"),
    document.getElementById("time-from-users-load-column-filter"),
    document.getElementById("load-msgs-from-ids-load-column"),
    document.getElementById("load-blocks-from-ids-load-column"),
    document.getElementById("load-load-from-users"),
    document.getElementById("load-block-from-users"),
    document.getElementById("load-load-from-users-label"),
    document.getElementById("load-block-from-users-label"),
    document.getElementById("hide-load-from-users"),
    document.getElementById("hide-block-from-users"),
    document.getElementById("hide-time-from-users-load-column"),
    document.getElementById("hide-change-password-load"),
    document.getElementById("hide-set-password-load"),
    document.getElementById("hide-unlock-load"),
    document.getElementById("unlockkey-load"),
    document.getElementById("encrypt-key-load"),
    document.getElementById("encrypt-key-load-label"),
    document.getElementById("change-key-load"),
    document.getElementById("change-key-load-label"),
    document.getElementById("change-password-load"),
    document.getElementById("set-password-load"),
    document.getElementById("unlock-load-few"),
    document.getElementById("unlock-load-all"),
    document.getElementById("hide-pin-key-load"),
    document.getElementById("pin-publickkey-load"),
    document.getElementById("publickkey-load"),
  ];

  function loadColumnsEverything() {
    allLoadColumns.forEach(element => {
    element.style.display = "none";
  });
  }
  
  const loadColumnsShowOptions = [
    document.getElementById("show-load-from-users"),
    document.getElementById("show-block-from-users"),
    document.getElementById("show-time-from-users-load-column"),
    document.getElementById("show-change-password-load"),
    document.getElementById("show-set-password-load"),
    document.getElementById("show-unlock-load"),
    document.getElementById("show-pin-key-load"),
  ];
  
  
  function loadColumnsShowOptionsload() {
    loadColumnsShowOptions.forEach(element => {
    element.style.display = "block";
  });
  }

  function loadColumnsHideOptionsload() {
    loadColumnsShowOptions.forEach(element => {
    element.style.display = "none";
  });
  }

  // Feed shell setup. The map Load button still runs CloseALL itself.
  export function prepareLoadColumnForFeed() {
    loadColumnsEverything();
    loadColumnsHideOptionsload();
    document.getElementById("show-options-from-load").style.display = "block";
    document.getElementById("hide-options-from-load").style.display = "none";
    document.getElementById("options-from-load").style.display = "none";
    document.getElementById("load-column-container").style.display = "block";
    const loaded = document.getElementById("loaded-topics");
    renderLoadedTopics();
    adjustTextareaHeight(loaded);
  }
  
  document.getElementById("show-time-from-users-load-column").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("time-from-users-load-column").style.display = "block";
    document.getElementById("time-from-users-load-column-filter").style.display = "flex";
    document.getElementById("hide-time-from-users-load-column").style.display = "block";
    document.getElementById("show-time-from-users-load-column").style.display = "none";
  });
  document.getElementById("hide-time-from-users-load-column").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });
  
  document.getElementById("show-load-from-users").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("load-msgs-from-ids-load-column").style.display = "block";
    document.getElementById("load-load-from-users").style.display = "flex";
    document.getElementById("load-load-from-users-label").style.display = "block";
    document.getElementById("show-load-from-users").style.display = "none";
    document.getElementById("hide-load-from-users").style.display = "block";
  });
  document.getElementById("hide-load-from-users").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });
  
  document.getElementById("show-block-from-users").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("load-blocks-from-ids-load-column").style.display = "block";
    document.getElementById("load-block-from-users").style.display = "flex";
    document.getElementById("load-block-from-users-label").style.display = "block";
    document.getElementById("show-block-from-users").style.display = "none";
    document.getElementById("hide-block-from-users").style.display = "block";
  });
  document.getElementById("hide-block-from-users").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });

  document.getElementById("show-change-password-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("hide-change-password-load").style.display = "block";
    document.getElementById("show-change-password-load").style.display = "none";
    labelPasswordFields('encrypt-key-load', 'Old password', 'change-key-load', 'New password');
    document.getElementById("encrypt-key-load").style.display = "block";
    document.getElementById("change-key-load").style.display = "block";
    document.getElementById("change-password-load").style.display = "block";
  });
  document.getElementById("hide-change-password-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });
  
  document.getElementById("show-set-password-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("hide-set-password-load").style.display = "block";
    document.getElementById("show-set-password-load").style.display = "none";
    labelPasswordFields('encrypt-key-load', 'Private key', 'change-key-load', 'Password');
    document.getElementById("encrypt-key-load").style.display = "block";
    document.getElementById("change-key-load").style.display = "block";
    document.getElementById("set-password-load").style.display = "block";
  });
  document.getElementById("hide-set-password-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });

  document.getElementById("show-unlock-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("hide-unlock-load").style.display = "block";
    document.getElementById("show-unlock-load").style.display = "none";
    document.getElementById("unlockkey-load").style.display = "block";
    document.getElementById("unlock-load-all").style.display = "block";
    document.getElementById("unlock-load-few").style.display = "block";

  });
  document.getElementById("hide-unlock-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });

  document.getElementById("show-options-from-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("options-from-load").style.display = "block";
    document.getElementById("hide-options-from-load").style.display = "block";
    document.getElementById("show-options-from-load").style.display = "none";
    const column = document.getElementById("load-column");
    if (column && column.classList.contains("is-feed-shell") && window.layerOpened) {
      window.layerOpened("loadoptions");
    }
  });
  document.getElementById("hide-options-from-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsHideOptionsload();
    document.getElementById("options-from-load").style.display = "none";
    document.getElementById("show-options-from-load").style.display = "block";
    document.getElementById("hide-options-from-load").style.display = "none";
    if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen("loadoptions")) {
      window.layerClosedByUI("loadoptions");
    }
  });

  document.getElementById("show-pin-key-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("hide-pin-key-load").style.display = "block";
    document.getElementById("show-pin-key-load").style.display = "none";
    document.getElementById("pin-publickkey-load").style.display = "block";
    document.getElementById("publickkey-load").style.display = "block";
  });
  document.getElementById("hide-pin-key-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });
  



  
  const everythinginsidemodelcolumn = [
    document.getElementById("model-column-model-url"),
    document.getElementById("model-column-model-rotation"),
    document.getElementById("model-column-model-position"),
    document.getElementById("model-column-model-scale-factor"),
    document.getElementById("hide-model-column-model-url"),
    document.getElementById("hide-model-column-model-rotation"),
    document.getElementById("hide-model-column-model-position"),
    document.getElementById("hide-model-column-model-scale-factor"),
  ];
  
  const showoptionsinsidemodelcolumn = [
    document.getElementById("show-model-column-model-url"),
    document.getElementById("show-model-column-model-rotation"),
    document.getElementById("show-model-column-model-position"),
    document.getElementById("show-model-column-model-scale-factor"),
  ];
  
  
  function modelColumnShowOptions() {
    showoptionsinsidemodelcolumn.forEach(element => {
    element.style.display = "block";
  });
  }
  
  function modelColumnEverything() {
    everythinginsidemodelcolumn.forEach(element => {
    element.style.display = "none";
  });
  }
  
  document.getElementById("show-model-column-model-url").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-url").style.display = "block";
    document.getElementById("hide-model-column-model-url").style.display = "block";
    document.getElementById("show-model-column-model-url").style.display = "none";
  });
  
  document.getElementById("hide-model-column-model-url").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-url").style.display = "none";
    document.getElementById("hide-model-column-model-url").style.display = "none";
    document.getElementById("show-model-column-model-url").style.display = "block";
  });
  
  document.getElementById("show-model-column-model-rotation").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-rotation").style.display = "block";
    document.getElementById("hide-model-column-model-rotation").style.display = "block";
    document.getElementById("show-model-column-model-rotation").style.display = "none";
  });
  
  document.getElementById("hide-model-column-model-rotation").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-rotation").style.display = "none";
    document.getElementById("hide-model-column-model-rotation").style.display = "none";
    document.getElementById("show-model-column-model-rotation").style.display = "block";
  });
  
  document.getElementById("show-model-column-model-position").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-position").style.display = "block";
    document.getElementById("hide-model-column-model-position").style.display = "block";
    document.getElementById("show-model-column-model-position").style.display = "none";
  });
  
  document.getElementById("hide-model-column-model-position").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-position").style.display = "none";
    document.getElementById("hide-model-column-model-position").style.display = "none";
    document.getElementById("show-model-column-model-position").style.display = "block";
  });
  
  document.getElementById("show-model-column-model-scale-factor").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-scale-factor").style.display = "block";
    document.getElementById("hide-model-column-model-scale-factor").style.display = "block";
    document.getElementById("show-model-column-model-scale-factor").style.display = "none";
  });
  
  document.getElementById("hide-model-column-model-scale-factor").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-scale-factor").style.display = "none";
    document.getElementById("hide-model-column-model-scale-factor").style.display = "none";
    document.getElementById("show-model-column-model-scale-factor").style.display = "block";
  });
  
  