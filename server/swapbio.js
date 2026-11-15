// Swap bio is its own bio-topic message: { data: { swapBio } }.
// A message without swapBio leaves the saved note alone. An empty string
// clears it. Over 18 KB of UTF-8 is ignored: one topic message, the same
// limit as a post (the editor caps the whole message, which is stricter).

import { HCS_MESSAGE_MAX_BYTES, utf8ByteLength } from "../hcschunks.js";

export const SWAP_BIO_MAX_BYTES = HCS_MESSAGE_MAX_BYTES;

// The exact text the editor sends, so its counter and cap measure the
// same bytes the wallet signs.
export function swapBioMessage(text) {
  return JSON.stringify({ data: { swapBio: text } });
}

// null: not a swap-bio message. { error }: present but invalid.
// { text }: store this, including "" to clear.
export function swapBioAction(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (!Object.prototype.hasOwnProperty.call(data, "swapBio")) return null;
  const value = data.swapBio;
  if (typeof value !== "string") return { error: "swapBio" };
  if (utf8ByteLength(value) > SWAP_BIO_MAX_BYTES) return { error: "length" };
  return { text: value };
}

// undefined: do not write. A string, including "", is the column value.
export function nextSwapBio(current, text) {
  const stored = current == null ? null : current;
  if (stored === null && text === "") return undefined;
  if (stored === text) return undefined;
  return text;
}

// The settings row after one bio-topic message. Other columns stay put.
export function foldSwapBio(row, data) {
  const action = swapBioAction(data);
  if (!action || action.error) return { row: row || null, wrote: false };
  const next = nextSwapBio(row ? row.swap_bio : null, action.text);
  if (next === undefined) return { row: row || null, wrote: false };
  return { row: { ...(row || {}), swap_bio: next }, wrote: true };
}

export function swapBioFromRow(row) {
  return row && typeof row.swap_bio === "string" ? row.swap_bio : "";
}
