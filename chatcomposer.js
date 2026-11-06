import { perfJob } from './perf.js';

// One autogrow for the topic and E2EE composers, on the map and in the feed.
// CSS owns the one-line height and the five-line cap. This only writes the
// measured height and marks the row once the field is taller than one line,
// so the image and send buttons sit on the last line.
export function fitChatComposer(field) {
  return perfJob('fitChatComposer', () => fitChatComposerWork(field));
}

function fitChatComposerWork(field) {
  if (!field || field.getClientRects().length === 0) return;
  const row = field.closest(".chat-compose-row");
  // One style read, one layout. The old min-height round trip forced an
  // extra full relayout per keystroke and changed nothing: with the CSS
  // min-height intact, scrollHeight is already at least the one-line floor,
  // and the clamp below lands on the same value.
  const cs = getComputedStyle(field);
  const min = parseFloat(cs.minHeight);
  const floor = Number.isFinite(min) ? min : 0;
  const max = parseFloat(cs.maxHeight);
  field.style.setProperty("height", "0px", "important");
  const full = field.scrollHeight;
  const cap = Number.isFinite(max) ? max : full;
  const next = Math.max(floor, Math.min(full, cap));
  field.style.setProperty("height", Math.ceil(next) + "px", "important");
  field.style.overflowY = full - next > 4 ? "auto" : "hidden";
  if (row) row.classList.toggle("is-grown", full > floor + 4);
}
