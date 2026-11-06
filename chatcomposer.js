import { perfJob } from './perf.js';

// One autogrow for the topic and E2EE composers, on the map and in the feed.
// CSS owns the one-line height and the five-line cap. This only writes the
// measured height and marks the row once the field is taller than one line,
// so the image and send buttons sit on the last line.
//
// A hidden twin measures the text, so the field's own style attribute
// changes only when its height does (a new line), never on every key. A
// style write inside the chat page made Chrome's :has() invalidation
// restyle all of body and #feed-layout: with the feed's cards underneath,
// about 2,800 elements per key, so typing lagged on a phone in the feed
// and not on the map (no cards there).
export function fitChatComposer(field) {
  return perfJob('fitChatComposer', () => fitChatComposerWork(field));
}

// What decides where the text wraps and how tall it is.
const TWIN_PROPS = [
  'box-sizing', 'width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant',
  'font-feature-settings', 'font-variation-settings', 'line-height', 'letter-spacing', 'word-spacing',
  'text-transform', 'text-indent', 'text-rendering', 'white-space', 'word-break', 'overflow-wrap',
  'tab-size', 'direction', 'writing-mode',
];

const twins = new WeakMap();

function twinFor(field) {
  let entry = twins.get(field);
  if (entry && entry.twin.isConnected) return entry;
  const twin = document.createElement('textarea');
  twin.setAttribute('aria-hidden', 'true');
  twin.tabIndex = -1;
  twin.readOnly = true;
  // Fixed and off screen, so its own layout never moves anything else.
  twin.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;'
    + 'height:0;min-height:0;max-height:none;overflow:hidden;resize:none;margin:0;';
  document.body.appendChild(twin);
  entry = { twin, base: twin.style.cssText, sig: '' };
  twins.set(field, entry);
  return entry;
}

function fitChatComposerWork(field) {
  if (!field || field.getClientRects().length === 0) return;
  const row = field.closest(".chat-compose-row");
  const compose = field.closest(".chat-compose");
  syncComposerDraft(field);
  // Fullscreen: CSS fills the editor, so no measured height is written.
  if (compose && compose.classList.contains("is-expanded")) {
    if (field.style.getPropertyValue("height")) field.style.removeProperty("height");
    if (field.style.overflowY !== "auto") field.style.overflowY = "auto";
    return;
  }
  const cs = getComputedStyle(field);
  const min = parseFloat(cs.minHeight);
  const floor = Number.isFinite(min) ? min : 0;
  const max = parseFloat(cs.maxHeight);
  const entry = twinFor(field);
  const { twin } = entry;
  // Copy the wrap-deciding styles only when they change (a resize, a font
  // load), so the twin's style attribute stays still while typing too.
  const decls = TWIN_PROPS.map((prop) => `${prop}:${cs.getPropertyValue(prop)}`).join(';');
  if (decls !== entry.sig) {
    entry.sig = decls;
    twin.style.cssText = entry.base + decls + ';';
  }
  // A value is not an attribute: setting it restyles nothing.
  if (twin.value !== field.value) twin.value = field.value;
  // Same box as the field at height 0: content plus padding.
  const full = twin.scrollHeight;
  const cap = Number.isFinite(max) ? max : full;
  const next = Math.max(floor, Math.min(full, cap));
  const height = Math.ceil(next) + "px";
  if (field.style.getPropertyValue("height") !== height || field.style.getPropertyPriority("height") !== "important") {
    field.style.setProperty("height", height, "important");
  }
  const overflow = full - next > 4 ? "auto" : "hidden";
  if (field.style.overflowY !== overflow) field.style.overflowY = overflow;
  if (row) row.classList.toggle("is-grown", full > floor + 4);
}

// has-draft on .chat-compose: there is text, an image, or an edit under
// way. It shows the byte counter line and the fullscreen button (style.css).
// Toggled only when that changes, so typing writes no class.
export function syncComposerDraft(field) {
  const compose = field && field.closest(".chat-compose");
  if (!compose) return;
  const draft = field.value !== ""
    || compose.classList.contains("is-editing")
    || !!compose.querySelector(":scope > .chat-attach-preview:not([hidden])");
  compose.classList.toggle("has-draft", draft);
}

// Fullscreen composer, as Telegram has it. The byte counter moves to a
// small line above the row (.chat-compose-caption), so the field keeps the
// row's width, and a button in the field's top right corner opens the
// editor over the chat (everything under the chat header). The same
// button, Back, Escape, or Send closes it. Back is a history layer
// ('composerfull') on the chat page.
const EXPAND_ICON = '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>';
const COLLAPSE_ICON = '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/>';
let expandedCompose = null;
let lastExpanded = null;
let layerDefined = false;

function paintExpandButton(compose) {
  const btn = compose && compose.querySelector(".chat-compose-expand");
  if (!btn) return;
  const on = compose.classList.contains("is-expanded");
  const label = on ? "Exit full screen" : "Full screen";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (on ? COLLAPSE_ICON : EXPAND_ICON) + "</svg>";
}

function defineComposerLayer() {
  if (layerDefined || typeof window.defineLayer !== "function") return;
  layerDefined = true;
  window.defineLayer("composerfull", {
    parent: "feedchat",
    open() {
      const compose = lastExpanded;
      if (compose && compose.isConnected && compose.getClientRects().length) {
        setComposerExpanded(compose, true, { fromHistory: true });
      }
    },
    close() {
      if (expandedCompose) setComposerExpanded(expandedCompose, false, { fromHistory: true });
    },
  });
}

export function setComposerExpanded(compose, on, { fromHistory = false } = {}) {
  if (!compose) return;
  const field = compose.querySelector("textarea");
  const was = compose.classList.contains("is-expanded");
  if (was === on) return;
  if (on && expandedCompose && expandedCompose !== compose) setComposerExpanded(expandedCompose, false);
  compose.classList.toggle("is-expanded", on);
  expandedCompose = on ? compose : null;
  if (on) lastExpanded = compose;
  paintExpandButton(compose);
  if (field) {
    fitChatComposer(field);
    if (field.isConnected && compose.getClientRects().length) {
      try { field.focus({ preventScroll: true }); } catch { field.focus(); }
      // Opening keeps the caret's line in view in the taller box.
      if (on && field.selectionStart >= field.value.length) field.scrollTop = field.scrollHeight;
    }
  }
  if (fromHistory) return;
  defineComposerLayer();
  if (on) {
    if (window.layerOpened) window.layerOpened("composerfull");
  } else if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen("composerfull")) {
    window.layerClosedByUI("composerfull");
  }
}

// The chat page closed under it: drop the fullscreen with no animation.
export function collapseComposers() {
  if (expandedCompose) setComposerExpanded(expandedCompose, false);
}

export function mountComposerExpand(field, counter, send) {
  const compose = field && field.closest(".chat-compose");
  const row = field && field.closest(".chat-compose-row");
  if (!compose || !row || compose.dataset.expandMounted === "1") return;
  compose.dataset.expandMounted = "1";
  const caption = document.createElement("div");
  caption.className = "chat-compose-caption";
  if (counter) caption.appendChild(counter);
  compose.insertBefore(caption, row);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chat-compose-expand";
  field.after(btn);
  paintExpandButton(compose);
  // Keep the field focused, so the phone keyboard stays up.
  btn.addEventListener("pointerdown", (event) => event.preventDefault());
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setComposerExpanded(compose, !compose.classList.contains("is-expanded"));
  });
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !compose.classList.contains("is-expanded")) return;
    event.preventDefault();
    event.stopPropagation();
    setComposerExpanded(compose, false);
  });
  // Send (or Save in an edit) closes it; a send the byte limit blocks does not.
  if (send) {
    send.addEventListener("click", () => {
      if (!compose.classList.contains("is-expanded")) return;
      if (send.classList.contains("hcs-send-blocked")) return;
      setComposerExpanded(compose, false);
    });
  }
  syncComposerDraft(field);
}
