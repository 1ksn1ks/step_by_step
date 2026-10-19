// Locked popup chrome for early Hashinal holders.
// The only input that can lock a wallet is the server owner map.
// A profile message, color, or flag never counts, and saved colors are kept.

const ACCOUNT = /^0\.0\.\d+$/;

export const EARLY_POPUP_CLASS = "early-holder-popup";
export const EARLY_PROFILE_CLASS = "early-holder-card";

export const EARLY_POPUP_CHROME = Object.freeze({
  kind: "early-holder",
  background: "rgba(12, 12, 18, 0.94)",
  border: "gold-purple-magenta",
});

export const LOCKED_STYLE_KEYS = Object.freeze([
  "colorBorder",
  "colorNumber",
  "colorClose",
  "colorUsername",
  "colorAccid",
  "colorText",
  "colorTitles",
  "popupFontSize",
]);

function holderNumber(account, owners) {
  if (typeof account !== "string" || !ACCOUNT.test(account)) return 0;
  if (!owners || typeof owners !== "object") return 0;
  const value = owners instanceof Map ? owners.get(account) : owners[account];
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) return 0;
  return n;
}

export function earlyBadgeLabel(number) {
  if (!Number.isInteger(number) || number <= 0) return "";
  return "Early Hashinal #" + number;
}

export function earlyLockNote(number) {
  if (!Number.isInteger(number) || number <= 0) return "";
  return "Locked by your Early Hashinal #" + number;
}

// saved is returned as the same value either way. Nothing here deletes it.
// applied is the shared chrome while locked, and the saved style otherwise.
export function resolvePopupStyle(account, owners, saved) {
  const number = holderNumber(account, owners);
  if (number > 0) {
    return {
      locked: true,
      number,
      applied: EARLY_POPUP_CHROME,
      saved,
    };
  }
  return {
    locked: false,
    number: 0,
    applied: saved === undefined ? null : saved,
    saved,
  };
}
