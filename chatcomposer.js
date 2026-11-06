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
