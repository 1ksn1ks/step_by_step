// Short counts, the way X writes them. One decimal is cut off, not rounded,
// so 1,999 is "1.9k" and 999,999 is "999.9k", never "1000k". A trailing
// ".0" is dropped. The exact number stays with the caller, on a label.

import { formatDonationAmount } from "./donationmath.js";

const UNITS = [
  { size: 1_000_000_000, suffix: "B" },
  { size: 1_000_000, suffix: "M" },
  { size: 1_000, suffix: "k" },
];

// whole and step are non-negative integers. BigInt divides them exactly,
// so a value just under the next unit cannot round up into "1000k".
function cutOneDecimal(whole, size) {
  const tenths = Number(BigInt(whole) / BigInt(size / 10));
  const body = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return frac === 0 ? String(body) : body + "." + frac;
}

export function formatCount(n) {
  const value = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(value) || value < 0) return "0";
  const whole = Math.floor(value);
  if (whole < 1000) return String(whole);
  for (const unit of UNITS) {
    if (whole >= unit.size) return cutOneDecimal(whole, unit.size) + unit.suffix;
  }
  return String(whole);
}

// HBAR on screen. Under 1,000 keeps the two decimals used everywhere else.
// From 1,000 it is the same short count, taken from the whole HBAR.
export function formatHbarCount(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 1000) return formatDonationAmount(value);
  return formatCount(value);
}
