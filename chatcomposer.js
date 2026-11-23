import { perfJob } from './perf.js';
import { claimExpanded, collapseExpandedFields, releaseExpanded } from './fieldexpand.js';

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
  // Dropped (setComposerDropped): one line, whatever the draft's length.
  const dropped = !!(compose && compose.classList.contains("is-dropped"));
  const next = dropped ? floor : Math.max(floor, Math.min(full, cap));
  const height = Math.ceil(next) + "px";
  if (field.style.getPropertyValue("height") !== height || field.style.getPropertyPriority("height") !== "important") {
    field.style.setProperty("height", height, "important");
  }
  const overflow = !dropped && full - next > 4 ? "auto" : "hidden";
  if (field.style.overflowY !== overflow) field.style.overflowY = overflow;
  const tall = full > floor + 4;
  if (row) row.classList.toggle("is-grown", tall && !dropped);
  // A draft taller than one line can be dropped down: shows the chevron.
  if (compose) compose.classList.toggle("is-tall", tall);
  if (dropped && field.scrollTop) field.scrollTop = 0;
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
  if (!draft && compose.classList.contains("is-dropped")) {
    compose.classList.remove("is-dropped");
    paintDropButton(compose);
  }
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
// Composers that were dropped when fullscreen opened. Closing fullscreen
// drops them again. A plain set: a data attribute would be a DOM write.
const droppedBeforeFull = new WeakSet();
let layerDefined = false;
// Each composer's entry in the one-box-at-a-time rule (fieldexpand.js):
// expanding any other 18 KB box closes this one, and the other way round.
const expandEntries = new WeakMap();

function expandEntry(compose) {
  let entry = expandEntries.get(compose);
  if (!entry) {
    // Another box taking the full screen closes this one at once.
    entry = { collapse: () => setComposerExpanded(compose, false, { instant: true }) };
    expandEntries.set(compose, entry);
  }
  return entry;
}

// Closing plays the opening backwards (style.css .is-collapsing), then the
// composer is put back as it always was, and fades in at its row
// (.is-settling). One composer at a time. CSS decides: with no animation
// (reduced motion) it closes at once. animationend can go missing (a page
// hidden under it), so a timeout of the animation's length ends it too.
let collapsing = null;
let settling = null;

function animationMs(el, name) {
  const cs = getComputedStyle(el);
  if (!String(cs.animationName || "").split(",").map((s) => s.trim()).includes(name)) return 0;
  const seconds = (value) => {
    const v = String(value || "").trim();
    return v.endsWith("ms") ? parseFloat(v) / 1000 : parseFloat(v);
  };
  const ms = (seconds(cs.animationDuration) + Math.max(0, seconds(cs.animationDelay))) * 1000;
  return Number.isFinite(ms) ? ms : 0;
}

function playOnce(el, cls, name, done) {
  el.classList.add(cls);
  const ms = animationMs(el, name);
  if (!(ms > 0)) {
    el.classList.remove(cls);
    return null;
  }
  const job = { el, cls, timer: 0, onEnd: null, done };
  job.onEnd = (event) => {
    if (event.target === el && event.animationName === name) finishPlay(job, true);
  };
  el.addEventListener("animationend", job.onEnd);
  // The same length, and a frame more, so the last frame shows first.
  job.timer = setTimeout(() => finishPlay(job, true), ms + 50);
  return job;
}

function finishPlay(job, run) {
  if (!job || job.over) return;
  job.over = true;
  clearTimeout(job.timer);
  job.el.removeEventListener("animationend", job.onEnd);
  job.el.classList.remove(job.cls);
  if (run && job.done) job.done();
}

function stopSettling() {
  const job = settling;
  settling = null;
  finishPlay(job, false);
}

// The composer on its way out: put back now (run), or kept open (not).
function endCollapse(run) {
  const job = collapsing;
  if (!job) return;
  collapsing = null;
  job.done = null;
  finishPlay(job, false);
  if (run) applyExpanded(job.compose, false, { fromHistory: job.fromHistory });
}

function startCollapse(compose, fromHistory) {
  const job = playOnce(compose, "is-collapsing", "composerExpandOut", null);
  if (!job) return false;
  job.compose = compose;
  job.fromHistory = fromHistory;
  job.done = () => {
    if (collapsing !== job) return;
    collapsing = null;
    applyExpanded(compose, false, { fromHistory: job.fromHistory });
    stopSettling();
    settling = playOnce(compose, "is-settling", "composerSettleIn", () => { settling = null; });
  };
  collapsing = job;
  return true;
}

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

// instant: no closing animation (a page closing under it, another box
// taking the full screen).
export function setComposerExpanded(compose, on, { fromHistory = false, instant = false } = {}) {
  if (!compose) return;
  if (collapsing && collapsing.compose === compose) {
    if (on) {
      // Tapped again on the way out: it stays open. Back already took its
      // history entry, so it gets one again.
      const gone = collapsing.fromHistory;
      endCollapse(false);
      if (gone && !fromHistory) {
        defineComposerLayer();
        if (window.layerOpened) window.layerOpened("composerfull");
      }
      return;
    }
    if (fromHistory) collapsing.fromHistory = true;
    // A second close on the way out waits for it, unless it must be now.
    if (instant) endCollapse(true);
    return;
  }
  // Another composer still on its way out is put back first.
  if (collapsing) endCollapse(true);
  if (!on && !instant && compose.classList.contains("is-expanded") && compose.getClientRects().length) {
    if (startCollapse(compose, fromHistory)) return;
  }
  applyExpanded(compose, on, { fromHistory });
}

function applyExpanded(compose, on, { fromHistory = false } = {}) {
  const field = compose.querySelector("textarea");
  const was = compose.classList.contains("is-expanded");
  if (was === on) return;
  if (on) stopSettling();
  // One box out at a time, this composer, the other one, or any 18 KB box.
  if (on) claimExpanded(expandEntry(compose));
  else releaseExpanded(expandEntry(compose));
  if (on) {
    // Fullscreen shows the whole draft. Remember a drop for the way back.
    if (compose.classList.contains("is-dropped")) {
      droppedBeforeFull.add(compose);
      compose.classList.remove("is-dropped");
      paintDropButton(compose);
    } else {
      droppedBeforeFull.delete(compose);
    }
  }
  const redrop = !on && droppedBeforeFull.has(compose);
  if (!on) droppedBeforeFull.delete(compose);
  compose.classList.toggle("is-expanded", on);
  expandedCompose = on ? compose : null;
  if (on) lastExpanded = compose;
  if (redrop) {
    compose.classList.add("is-dropped");
    paintDropButton(compose);
  }
  paintExpandButton(compose);
  if (field) {
    fitChatComposer(field);
    // Back to dropped, unless the draft now fits on one line anyway.
    if (redrop && !compose.classList.contains("is-tall")) {
      compose.classList.remove("is-dropped");
      paintDropButton(compose);
      fitChatComposer(field);
    }
    if (compose.classList.contains("is-dropped")) {
      // Dropped means put away: no focus, so the focus hook keeps it down.
      if (document.activeElement === field) field.blur();
    } else if (field.isConnected && compose.getClientRects().length) {
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

// Drop down: a draft taller than one line folds to one line, so the chat
// shows above it, and the keyboard goes away. The text stays. It comes
// back up with the chevron, a swipe up, a tap in the field, or typing.
const DROP_ICON = '<path d="m6 9 6 6 6-6"/>';
const RAISE_ICON = '<path d="m18 15-6-6-6 6"/>';

function paintDropButton(compose) {
  const btn = compose && compose.querySelector(".chat-compose-drop");
  if (!btn) return;
  const on = compose.classList.contains("is-dropped");
  const label = on ? "Show the whole message" : "Drop the message down";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (on ? RAISE_ICON : DROP_ICON) + "</svg>";
}

export function setComposerDropped(compose, on) {
  if (!compose) return;
  if (compose.classList.contains("is-dropped") === on) return;
  if (on && compose.classList.contains("is-expanded")) return;
  compose.classList.toggle("is-dropped", on);
  paintDropButton(compose);
  const field = compose.querySelector("textarea");
  if (!field) return;
  fitChatComposer(field);
  if (on && document.activeElement === field) field.blur();
}

// A swipe down on the composer drops it, a swipe up brings it back. Inside
// the field it waits until the text is scrolled to its top (or cannot
// scroll), so scrolling a long draft still works, and a selection drag is
// left alone.
const SWIPE_PX = 28;

function bindDropSwipe(compose, field) {
  let start = null;
  compose.addEventListener("touchstart", (event) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    if (!touch || compose.classList.contains("is-expanded")) {
      start = null;
      return;
    }
    const inField = event.target === field;
    // A dropped field shows one line and does not scroll.
    const still = !inField || compose.classList.contains("is-dropped");
    start = {
      x: touch.clientX,
      y: touch.clientY,
      inField,
      atTop: still || field.scrollTop <= 0,
      atBottom: still || field.scrollTop + field.clientHeight >= field.scrollHeight - 1,
    };
  }, { passive: true });
  compose.addEventListener("touchmove", (event) => {
    if (!start || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > Math.abs(dy)) return;
    if (start.inField && field.selectionStart !== field.selectionEnd) return;
    const dropped = compose.classList.contains("is-dropped");
    if (dy > SWIPE_PX && !dropped && start.atTop && compose.classList.contains("is-tall")) {
      start = null;
      setComposerDropped(compose, true);
    } else if (dy < -SWIPE_PX && dropped && start.atBottom) {
      start = null;
      setComposerDropped(compose, false);
    }
  }, { passive: true });
  compose.addEventListener("touchend", () => { start = null; }, { passive: true });
  compose.addEventListener("touchcancel", () => { start = null; }, { passive: true });
}

// The chat page (or the Draw page, the same #feed-chat) closed under it:
// drop the fullscreen with no animation, a composer's or any 18 KB box's.
// Now, not after an animation: the composer's history entry sits on the
// chat's and must go first, and the page moves the composer away next.
export function collapseComposers() {
  if (expandedCompose) setComposerExpanded(expandedCompose, false, { instant: true });
  collapseExpandedFields();
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
  const drop = document.createElement("button");
  drop.type = "button";
  drop.className = "chat-compose-drop";
  caption.appendChild(drop);
  paintDropButton(compose);
  drop.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setComposerDropped(compose, !compose.classList.contains("is-dropped"));
  });
  // Typing, or coming back to the field, brings the whole draft back.
  field.addEventListener("input", () => setComposerDropped(compose, false));
  field.addEventListener("focus", () => setComposerDropped(compose, false));
  bindDropSwipe(compose, field);
  // Keep the field focused, so the phone keyboard stays up.
  btn.addEventListener("pointerdown", (event) => event.preventDefault());
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    // On its way out it counts as closed: a tap keeps it open.
    const open = compose.classList.contains("is-expanded") && !compose.classList.contains("is-collapsing");
    setComposerExpanded(compose, !open);
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
