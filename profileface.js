// Display name and picture for an account. The feed banner and the Swap
// sheet share this so neither one imports the other.

import { DEFAULT_AVATAR } from "./hashinalurl.js";
import { profilePictures, usernames } from "./loadalladata.js";

export const DEFAULT_PIC = DEFAULT_AVATAR;

function textOf(msg) {
  if (Array.isArray(msg)) return msg[0] == null ? "" : String(msg[0]);
  return msg == null ? "" : String(msg);
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

export function profilePicUrl(payer) {
  const raw = profilePictures[payer] && profilePictures[payer].url;
  return httpUrl(raw) || DEFAULT_PIC;
}

// "" when the account has no stored display name.
export function profileUsername(payer) {
  return textOf(usernames[payer] && usernames[payer].username).trim();
}

export function profileDisplayName(payer) {
  return profileUsername(payer) || "Anonymous";
}
