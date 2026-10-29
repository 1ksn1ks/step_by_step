// Record an HBAR donation only after the mirror node shows the transfer.
// The recipient is the payer of the original marker or polygon message.
// Amount, sender, and memo come from that transaction, never from the client.

import {
  assessTransfer,
  bareAccount,
  canonicalTxId,
  formatHbar,
  isPostBody,
  mirrorTxPath,
  normalizeConsensusTs,
  transactionRow,
} from "../donationmath.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function ensureDonationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS donations (
      tx_id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      post_ts TEXT NOT NULL,
      from_acct TEXT NOT NULL,
      to_acct TEXT NOT NULL,
      amount_tinybar TEXT NOT NULL,
      memo TEXT NOT NULL,
      consensus_ts TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS donations_post ON donations(topic_id, post_ts);
    CREATE INDEX IF NOT EXISTS donations_to ON donations(to_acct);
  `);
}

function decodeMemo(memoBase64) {
  if (memoBase64 == null || memoBase64 === "") return "";
  try {
    const bytes = Buffer.from(String(memoBase64), "base64");
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\u0000/g, "");
  } catch {
    return "";
  }
}

function mirrorMessageBody(row) {
  if (!row || row.message == null) return "";
  try {
    return Buffer.from(String(row.message), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function postFromLocal(row) {
  if (!row || !isPostBody(row.body)) return null;
  const payer = bareAccount(row.payer);
  const ts = normalizeConsensusTs(row.ts);
  if (!payer || !ts) return null;
  return { payer, ts };
}

function postFromMirror(row) {
  if (!row || !isPostBody(mirrorMessageBody(row))) return null;
  const payer = bareAccount(row.payer_account_id);
  const ts = normalizeConsensusTs(row.consensus_timestamp);
  if (!payer || !ts) return null;
  return { payer, ts };
}

function localByTimestamp(db, topicId, ts) {
  const canon = normalizeConsensusTs(ts);
  if (!canon) return null;
  const sec = canon.split(".")[0];
  const rows = db.prepare(
    "SELECT payer, body, ts FROM messages WHERE topic_id = ? AND ts LIKE ?"
  ).all(topicId, sec + ".%");
  for (const row of rows) {
    if (normalizeConsensusTs(row.ts) !== canon) continue;
    const post = postFromLocal(row);
    if (post) return post;
  }
  return null;
}

function localByCreated(db, topicId, created) {
  const ms = Date.parse(created);
  if (!Number.isFinite(ms)) return null;
  const rows = db.prepare(
    "SELECT payer, body, ts FROM messages WHERE topic_id = ? AND ts >= ? AND ts < ? ORDER BY seq ASC"
  ).all(
    topicId,
    (ms / 1000 - 0.000001).toFixed(9),
    ((ms + 1) / 1000 + 0.000001).toFixed(9)
  );
  for (const row of rows) {
    if (new Date(Number(row.ts) * 1000).toISOString() !== created) continue;
    const post = postFromLocal(row);
    if (post) return post;
  }
  return null;
}

async function mirrorGet(ctx, url) {
  const res = await ctx.fetchMirror(url);
  if (!res || !res.ok || !res.json) return null;
  return res.json;
}

async function mirrorPost(ctx, topicId, ts) {
  const json = await mirrorGet(ctx, `${ctx.mirror}/api/v1/topics/${topicId}/messages/${ts}`);
  if (!json) return null;
  if (json.consensus_timestamp) return postFromMirror(json);
  const first = json.messages && json.messages[0];
  return first ? postFromMirror(first) : null;
}

async function mirrorByCreated(ctx, topicId, created) {
  const ms = Date.parse(created);
  if (!Number.isFinite(ms)) return null;
  const start = (ms / 1000 - 0.000001).toFixed(9);
  const end = ((ms + 1) / 1000 + 0.000001).toFixed(9);
  const json = await mirrorGet(
    ctx,
    `${ctx.mirror}/api/v1/topics/${topicId}/messages?timestamp=gte:${start}&timestamp=lt:${end}&limit=5&order=asc`
  );
  const list = json && Array.isArray(json.messages) ? json.messages : [];
  for (const row of list) {
    if (new Date(Number(row.consensus_timestamp) * 1000).toISOString() !== created) continue;
    const post = postFromMirror(row);
    if (post) return post;
  }
  return null;
}

export async function resolvePost(ctx, topicId, postTimestamp) {
  const topic = bareAccount(topicId);
  const ts = normalizeConsensusTs(postTimestamp);
  if (!topic || !ts) return { error: "bad donation", status: 400 };
  const local = localByTimestamp(ctx.db, topic, ts);
  if (local) return { topicId: topic, ...local };
  const remote = await mirrorPost(ctx, topic, ts);
  if (!remote) return { error: "post not found", status: 404 };
  if (remote.ts !== ts) return { error: "post not found", status: 404 };
  return { topicId: topic, ...remote };
}

async function resolveCreated(ctx, topicId, created) {
  const topic = bareAccount(topicId);
  if (!topic || typeof created !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(created)) return null;
  return localByCreated(ctx.db, topic, created) || mirrorByCreated(ctx, topic, created);
}

async function fetchTransaction(ctx, txId) {
  const path = mirrorTxPath(txId);
  if (!path) return { error: "bad donation", status: 400 };
  const url = `${ctx.mirror}/api/v1/transactions/${path}`;
  const attempts = ctx.txAttempts || 6;
  const pause = ctx.txPauseMs == null ? 1000 : ctx.txPauseMs;
  let status = 0;
  for (let i = 0; i < attempts; i++) {
    const res = await ctx.fetchMirror(url);
    status = res && res.status ? res.status : 0;
    if (res && res.ok && res.json) {
      const tx = transactionRow(res.json, txId);
      if (tx) return { tx };
    }
    const retry = status === 0 || status === 404 || status === 429 || status >= 500;
    if (!retry) break;
    if (i + 1 < attempts) await sleep(pause);
  }
  if (status === 404 || status === 0) return { error: "transaction not found", status: 404 };
  return { error: "mirror", status: 502 };
}

function insertDonation(db, row) {
  const existing = db.prepare("SELECT tx_id FROM donations WHERE tx_id = ?").get(row.txId);
  if (existing) return false;
  try {
    db.prepare(
      `INSERT INTO donations
        (tx_id, topic_id, post_ts, from_acct, to_acct, amount_tinybar, memo, consensus_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.txId,
      row.topicId,
      row.postTs,
      row.from,
      row.to,
      row.amount.toString(),
      row.memo,
      row.consensusTs
    );
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) return false;
    throw err;
  }
  return true;
}

export function donationPostTotals(db, topicId, ts) {
  const topic = bareAccount(topicId);
  const canon = normalizeConsensusTs(ts);
  if (!topic || !canon) return { total: "0", count: 0 };
  const rows = db.prepare(
    "SELECT amount_tinybar FROM donations WHERE topic_id = ? AND post_ts = ?"
  ).all(topic, canon);
  let sum = 0n;
  for (const row of rows) sum += BigInt(row.amount_tinybar);
  return { total: formatHbar(sum), count: rows.length };
}

export function donationAccountTotals(db, account) {
  const id = bareAccount(account);
  if (!id) return { received: "0", count: 0 };
  const rows = db.prepare(
    "SELECT amount_tinybar FROM donations WHERE to_acct = ?"
  ).all(id);
  let sum = 0n;
  for (const row of rows) sum += BigInt(row.amount_tinybar);
  return { received: formatHbar(sum), count: rows.length };
}

export async function recordDonation(ctx, input) {
  const txId = canonicalTxId(input && input.txId);
  const topicId = input && input.topicId;
  const postTimestamp = input && input.postTimestamp;
  if (!txId) return { error: "bad donation", status: 400 };
  const post = await resolvePost(ctx, topicId, postTimestamp);
  if (post.error) return post;
  const fetched = await fetchTransaction(ctx, txId);
  if (fetched.error) return fetched;
  const assessed = assessTransfer(fetched.tx, post.payer);
  if (assessed.error) return assessed;
  const memo = decodeMemo(fetched.tx.memo_base64);
  const inserted = insertDonation(ctx.db, {
    txId,
    topicId: post.topicId,
    postTs: post.ts,
    from: assessed.from,
    to: assessed.to,
    amount: assessed.amount,
    memo,
    consensusTs: assessed.consensusTs,
  });
  if (!inserted) return { error: "already recorded", status: 409 };
  const totals = donationPostTotals(ctx.db, post.topicId, post.ts);
  return { ok: true, ...totals, memo };
}

export async function resolveRecipient(ctx, topicId, postTimestamp) {
  const post = await resolvePost(ctx, topicId, postTimestamp);
  if (post.error) return post;
  return { account: post.payer };
}

export async function donationBatch(ctx, posts) {
  const list = Array.isArray(posts) ? posts.slice(0, 40) : [];
  const out = [];
  for (const item of list) {
    const topicId = item && item.topicId;
    if (!bareAccount(topicId)) continue;
    let ts = normalizeConsensusTs(item && item.ts);
    if (!ts && item && item.created) {
      const found = await resolveCreated(ctx, topicId, item.created);
      if (found) ts = found.ts;
    }
    if (!ts) {
      out.push({ topicId: bareAccount(topicId), ts: "", total: "0", count: 0, found: false });
      continue;
    }
    const totals = donationPostTotals(ctx.db, topicId, ts);
    out.push({ topicId: bareAccount(topicId), ts, ...totals, found: true });
  }
  return out;
}
