// One autogrow for the topic and E2EE composers, on the map and in the feed.
// CSS owns the one-line height and the five-line cap. This only writes the
// measured height and marks the row once the field is taller than one line,
// so the image and send buttons sit on the last line.
export function fitChatComposer(field) {
  if (!field || field.getClientRects().length === 0) return;
  const row = field.closest(".chat-compose-row");
  const min = parseFloat(getComputedStyle(field).minHeight);
  const floor = Number.isFinite(min) ? min : 0;
  field.style.setProperty("min-height", "0px", "important");
  field.style.setProperty("height", "0px", "important");
  const full = field.scrollHeight;
  field.style.removeProperty("min-height");
  const max = parseFloat(getComputedStyle(field).maxHeight);
  const cap = Number.isFinite(max) ? max : full;
  const next = Math.max(floor, Math.min(full, cap));
  field.style.setProperty("height", Math.ceil(next) + "px", "important");
  field.style.overflowY = full - next > 4 ? "auto" : "hidden";
  if (row) row.classList.toggle("is-grown", full > floor + 4);
}
