// Swap lives on the bio topic, beside topic_bio and the connected topic.
// A message without `swap` leaves the saved swap alone. An invalid swap is
// ignored. feeBps is an integer 0–500 (0–5% to the account). A missing fee
// is 0. A profile with no swap message stays off.

const TOKEN_ID = /^\d+\.\d+\.\d+$/;
const FEE_MAX = 500;

export function normalizeSwap(swap) {
  if (!swap || typeof swap !== "object" || Array.isArray(swap)) {
    return { enabled: false, tokenId: "", feeBps: 0 };
  }
  const tokenId = typeof swap.tokenId === "string" ? swap.tokenId : "";
  const fee = Number.isInteger(swap.feeBps) ? swap.feeBps : 0;
  return {
    enabled: swap.enabled === true,
    tokenId,
    feeBps: fee >= 0 && fee <= FEE_MAX ? fee : 0,
  };
}

export function sameSwapProfile(a, b) {
  const left = normalizeSwap(a);
  const right = normalizeSwap(b);
  return left.enabled === right.enabled && left.tokenId === right.tokenId && left.feeBps === right.feeBps;
}

function feeBpsOf(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^\d+$/.test(text)) return null;
    return Number(text);
  }
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return null;
}

// null: this message is not a swap message. { error }: present but invalid.
// Otherwise the three fields to store together.
export function swapProfileAction(data) {
  if (!data || typeof data !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(data, "swap")) return null;
  const swap = data.swap;
  if (!swap || typeof swap !== "object" || Array.isArray(swap)) return { error: "swap" };

  const enabled = swap.enabled === true;
  let tokenId = "";
  if (swap.tokenId != null && swap.tokenId !== "") {
    if (typeof swap.tokenId !== "string") return { error: "token" };
    tokenId = swap.tokenId.trim();
    if (!TOKEN_ID.test(tokenId)) return { error: "token" };
  }
  if (enabled && !tokenId) return { error: "token" };

  const feeBps = feeBpsOf(swap.feeBps);
  if (feeBps == null || feeBps < 0 || feeBps > FEE_MAX) return { error: "fee" };

  return { enabled, tokenId, feeBps };
}
