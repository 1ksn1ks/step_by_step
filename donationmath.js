// Pure donation checks. The browser and the server both use this file.
// Amounts stay in tinybars (1 HBAR = 100_000_000 tinybars) so a float
// never decides what was paid.

export const MIN_TINYBAR = 10_000_000n;
export const MEMO_MAX_BYTES = 100;
// A single donation above this is refused before a wallet prompt.
export const MAX_TINYBAR = 100_000_000n * 1_000_000n;

export function bareAccount(value) {
  const text = String(value == null ? "" : value).trim();
  const id = text.split("-")[0];
  return /^\d+\.\d+\.\d+$/.test(id) ? id : "";
}

// Mirror consensus timestamps are seconds.nanoseconds. Nanos are padded
// to 9 so "1.2" and "1.000000200" name the same message.
export function normalizeConsensusTs(value) {
  const text = String(value == null ? "" : value).trim();
  const match = text.match(/^(\d{1,16})\.(\d{1,9})$/);
  if (!match) return "";
  return match[1] + "." + match[2].padStart(9, "0");
}

export function consensusOf(message) {
  if (!message) return "";
  return normalizeConsensusTs(message.consensus_timestamp);
}

// Wallet ids look like 0.0.1@seconds.nanos. The mirror path uses dashes.
export function canonicalTxId(value) {
  const text = String(value == null ? "" : value).trim();
  let match = text.match(/^(\d+\.\d+\.\d+)@(\d{1,16})\.(\d{1,9})$/);
  if (match) return `${match[1]}@${match[2]}.${match[3].padStart(9, "0")}`;
  match = text.match(/^(\d+\.\d+\.\d+)-(\d{1,16})-(\d{1,9})$/);
  if (match) return `${match[1]}@${match[2]}.${match[3].padStart(9, "0")}`;
  return "";
}

export function mirrorTxPath(value) {
  const id = canonicalTxId(value);
  if (!id) return "";
  const match = id.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d{9})$/);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function hbarToTinybar(value) {
  const text = String(value == null ? "" : value).trim();
  if (!/^\d{1,7}(\.\d{1,8})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  let tiny;
  try {
    tiny = BigInt(whole) * 100_000_000n + BigInt(frac.padEnd(8, "0"));
  } catch {
    return null;
  }
  if (tiny < MIN_TINYBAR || tiny > MAX_TINYBAR) return null;
  return tiny;
}

export function formatHbar(tiny) {
  let n;
  try {
    n = BigInt(tiny);
  } catch {
    return "0";
  }
  if (n < 0n) n = 0n;
  const whole = n / 100_000_000n;
  const frac = (n % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

export function utf8ByteLength(text) {
  return new TextEncoder().encode(String(text == null ? "" : text)).length;
}

// A donation names a marker or polygon message. A like, comment, or share
// is not a post, and a payer field inside the body is never the recipient.
export function isPostBody(body) {
  let data = body;
  if (typeof body === "string") {
    try {
      data = JSON.parse(body);
    } catch {
      return false;
    }
  }
  if (!data || typeof data !== "object") return false;
  const marker = data.marker && data.marker.data && typeof data.marker.data === "object";
  const polygon = data.polygon && data.polygon.data && typeof data.polygon.data === "object";
  return !!(marker || polygon);
}

export function transactionRow(json, txId) {
  const want = canonicalTxId(txId);
  const list = json && Array.isArray(json.transactions) ? json.transactions : [];
  return list.find((row) => canonicalTxId(row && row.transaction_id) === want) || null;
}

// Author credit only. Node and network fees are other positive rows and
// do not count. The sender is the account on the transaction id.
export function assessTransfer(tx, author) {
  if (!tx || typeof tx !== "object") return { error: "failed", status: 400 };
  if (String(tx.result || "").toUpperCase() !== "SUCCESS") return { error: "failed", status: 400 };
  const name = String(tx.name || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (name !== "CRYPTOTRANSFER") return { error: "not a transfer", status: 400 };
  const from = bareAccount(String(tx.transaction_id || "").split(/[@-]/)[0]);
  const to = bareAccount(author);
  if (!from || !to) return { error: "failed", status: 400 };
  if (from === to) return { error: "own post", status: 400 };
  let credit = 0n;
  const rows = Array.isArray(tx.transfers) ? tx.transfers : [];
  for (const row of rows) {
    if (!row || bareAccount(row.account) !== to) continue;
    let amount;
    try {
      amount = BigInt(row.amount);
    } catch {
      continue;
    }
    if (amount > 0n) credit += amount;
  }
  if (credit <= 0n) return { error: "wrong recipient", status: 400 };
  if (credit < MIN_TINYBAR) return { error: "below minimum", status: 400 };
  return {
    from,
    to,
    amount: credit,
    consensusTs: normalizeConsensusTs(tx.consensus_timestamp) || String(tx.consensus_timestamp || "").slice(0, 40),
  };
}

export function makeLimiter(max, windowMs) {
  const hits = new Map();
  return function allow(key, now = Date.now()) {
    if (hits.size > 4000) {
      for (const [bucketKey, bucket] of hits) {
        if (now >= bucket.reset) hits.delete(bucketKey);
      }
    }
    let bucket = hits.get(key);
    if (!bucket || now >= bucket.reset) {
      bucket = { reset: now + windowMs, count: 0 };
      hits.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.reset - now) / 1000)) };
    }
    return { ok: true, retryAfter: 0 };
  };
}
