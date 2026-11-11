// Swap bio is its own bio-topic message: { data: { swapBio } }.
// A message without swapBio leaves the saved note alone. An empty string
// clears it. Longer than 280 characters is ignored.

export const SWAP_BIO_MAX = 280;

// null: not a swap-bio message. { error }: present but invalid.
// { text }: store this, including "" to clear.
export function swapBioAction(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (!Object.prototype.hasOwnProperty.call(data, "swapBio")) return null;
  const value = data.swapBio;
  if (typeof value !== "string") return { error: "swapBio" };
  if (value.length > SWAP_BIO_MAX) return { error: "length" };
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
