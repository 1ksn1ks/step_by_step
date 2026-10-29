import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assessTransfer, formatHbar, hbarToTinybar, makeLimiter, mirrorTxPath, transactionRow } from "../donationmath.js";
import {
  donationAccountTotals,
  donationBatch,
  donationPostTotals,
  ensureDonationTable,
  recordDonation,
} from "../server/donations.js";

const TOPIC = "0.0.500";
const AUTHOR = "0.0.200";
const SENDER = "0.0.100";
const POST_TS = "1700000000.000000001";
const TX = "0.0.100@1700000001.000000009";
const HTML_MEMO = '<img src=x onerror=alert(1)>';

function tempDb() {
  const file = path.join(os.tmpdir(), `don-${process.pid}-${Math.random().toString(16).slice(2)}.db`);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE messages (
    topic_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts TEXT NOT NULL,
    payer TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (topic_id, seq)
  )`);
  ensureDonationTable(db);
  return {
    db,
    close() {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

function seedPost(db, payer = AUTHOR) {
  db.prepare(
    "INSERT INTO messages (topic_id, seq, ts, payer, body) VALUES (?, 1, ?, ?, ?)"
  ).run(
    TOPIC,
    POST_TS,
    payer,
    JSON.stringify({
      marker: { data: { title: "Hi" } },
      payer: "0.0.999",
    })
  );
}

function transfer({
  id = TX,
  result = "SUCCESS",
  name = "CRYPTOTRANSFER",
  from = SENDER,
  to = AUTHOR,
  amount = 10_000_000,
  memo = HTML_MEMO,
} = {}) {
  return {
    transaction_id: id,
    result,
    name,
    consensus_timestamp: "1700000001.000000009",
    memo_base64: Buffer.from(memo, "utf8").toString("base64"),
    transfers: [
      { account: from, amount: -(amount + 100000) },
      { account: to, amount },
      { account: "0.0.98", amount: 50000 },
      { account: "0.0.3", amount: 50000 },
    ],
  };
}

function mockMirror(byPath) {
  return async (url) => {
    const id = url.split("/api/v1/transactions/")[1];
    if (!id || !byPath[id]) return { ok: false, status: 404, json: null };
    return { ok: true, status: 200, json: { transactions: [byPath[id]] } };
  };
}

function ctx(db, byPath) {
  return {
    db,
    mirror: "https://mirror.test",
    fetchMirror: mockMirror(byPath),
    txAttempts: 2,
    txPauseMs: 5,
  };
}

test("amount floor is 0.1 HBAR and the limiter trips", () => {
  assert.equal(hbarToTinybar("0.09"), null);
  assert.equal(hbarToTinybar("0.1"), 10_000_000n);
  assert.equal(formatHbar(10_000_000n), "0.1");
  assert.equal(formatHbar(150_000_000n), "1.5");
  const allow = makeLimiter(2, 60_000);
  assert.equal(allow("a", 1000).ok, true);
  assert.equal(allow("a", 1000).ok, true);
  assert.equal(allow("a", 1000).ok, false);
});

test("a transfer is rejected for the wrong recipient, a failure, or yourself", () => {
  assert.equal(assessTransfer(transfer({ to: "0.0.300" }), AUTHOR).error, "wrong recipient");
  assert.equal(assessTransfer(transfer({ result: "INVALID" }), AUTHOR).error, "failed");
  assert.equal(assessTransfer(transfer({ name: "CONSENSUSCREATETOPIC" }), AUTHOR).error, "not a transfer");
  assert.equal(
    assessTransfer(transfer({ id: `${AUTHOR}@1700000001.000000009`, from: AUTHOR, to: AUTHOR }), AUTHOR).error,
    "own post"
  );
});

test("a confirmed transfer records once and an HTML memo stays text", async () => {
  const handle = tempDb();
  try {
    seedPost(handle.db);
    const pathId = "0.0.100-1700000001-000000009";
    const base = ctx(handle.db, { [pathId]: transfer() });
    const first = await recordDonation(base, {
      txId: TX,
      topicId: TOPIC,
      postTimestamp: POST_TS,
      amount: "5",
      memo: "client memo",
      to: "0.0.1",
    });
    assert.equal(first.ok, true);
    assert.equal(first.total, "0.1");
    assert.equal(first.count, 1);
    assert.equal(first.memo, HTML_MEMO);
    const stored = handle.db.prepare("SELECT memo, from_acct, to_acct, amount_tinybar FROM donations").get();
    assert.equal(stored.memo, HTML_MEMO);
    assert.equal(stored.memo.includes("&lt;"), false);
    assert.equal(stored.from_acct, SENDER);
    assert.equal(stored.to_acct, AUTHOR);
    assert.equal(stored.amount_tinybar, "10000000");
    const again = await recordDonation(base, { txId: TX, topicId: TOPIC, postTimestamp: POST_TS });
    assert.equal(again.status, 409);
    assert.equal(donationPostTotals(handle.db, TOPIC, POST_TS).count, 1);
    assert.equal(donationAccountTotals(handle.db, AUTHOR).received, "0.1");
    const fake = await recordDonation(base, {
      txId: "0.0.100@1700000099.000000001",
      topicId: TOPIC,
      postTimestamp: POST_TS,
    });
    assert.equal(fake.status, 404);
    const wrong = await recordDonation(
      ctx(handle.db, { "0.0.100-1700000002.000000001": null, "0.0.100-1700000002-000000001": transfer({ id: "0.0.100@1700000002.000000001", to: "0.0.300" }) }),
      { txId: "0.0.100@1700000002.000000001", topicId: TOPIC, postTimestamp: POST_TS }
    );
    assert.equal(wrong.error, "wrong recipient");
    assert.equal(donationPostTotals(handle.db, TOPIC, POST_TS).count, 1);
  } finally {
    handle.close();
  }
});

test("the author is the message payer, not a payer field in the body", async () => {
  const handle = tempDb();
  try {
    const body = Buffer.from(
      JSON.stringify({ marker: { data: { title: "Hi" } }, payer: "0.0.999" }),
      "utf8"
    ).toString("base64");
    const seen = [];
    const base = {
      db: handle.db,
      mirror: "https://mirror.test",
      txAttempts: 2,
      txPauseMs: 5,
      fetchMirror: async (url) => {
        seen.push(url);
        if (url.includes("/messages/")) {
          return {
            ok: true,
            status: 200,
            json: {
              consensus_timestamp: POST_TS,
              payer_account_id: AUTHOR,
              message: body,
            },
          };
        }
        return {
          ok: true,
          status: 200,
          json: { transactions: [transfer()] },
        };
      },
    };
    const saved = await recordDonation(base, { txId: TX, topicId: TOPIC, postTimestamp: POST_TS });
    assert.equal(saved.ok, true);
    assert.equal(saved.memo, HTML_MEMO);
    assert.equal(handle.db.prepare("SELECT to_acct FROM donations").get().to_acct, AUTHOR);
    assert.equal(seen.some((url) => url.includes("/messages/")), true);
  } finally {
    handle.close();
  }
});

test("visible post totals resolve from the original timestamp", async () => {
  const handle = tempDb();
  try {
    seedPost(handle.db);
    const created = new Date(Number(POST_TS) * 1000).toISOString();
    const posts = await donationBatch(
      { db: handle.db, mirror: "https://mirror.test", fetchMirror: async () => ({ ok: false, status: 404, json: null }) },
      [{ topicId: TOPIC, created }]
    );
    assert.equal(posts.length, 1);
    assert.equal(posts[0].found, true);
    assert.equal(posts[0].ts, POST_TS);
    assert.equal(posts[0].total, "0");
  } finally {
    handle.close();
  }
});

function creditTo(row, account) {
  let sum = 0n;
  for (const part of row.transfers || []) {
    const id = String(part.account || "").split("-")[0];
    if (id !== account) continue;
    const amount = BigInt(part.amount);
    if (amount > 0n) sum += amount;
  }
  return sum;
}

function payerOf(row) {
  return String(row.transaction_id || "").split(/[@-]/)[0];
}

test("a real testnet donation records once", async () => {
  const base = "https://testnet.mirrornode.hedera.com";
  async function pull(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("testnet mirror HTTP " + res.status);
    return res.json();
  }
  let page = base + "/api/v1/transactions?transactiontype=cryptotransfer&result=success&limit=25&order=desc";
  let chosen = null;
  let other = null;
  for (let n = 0; n < 4 && (!chosen || !other); n++) {
    const json = await pull(page);
    for (const row of json.transactions || []) {
      const pathId = mirrorTxPath(row.transaction_id);
      if (!pathId) continue;
      const detail = await pull(`${base}/api/v1/transactions/${pathId}`);
      const full = transactionRow(detail, row.transaction_id);
      if (!full || !Array.isArray(full.transfers)) continue;
      const hit = full.transfers.find((part) => {
        const num = Number(String(part.account || "").split(".")[2]);
        return num > 1000 && BigInt(part.amount) >= 10_000_000n;
      });
      if (!hit) continue;
      const account = String(hit.account).split("-")[0];
      if (payerOf(full) === account) continue;
      if (!chosen) chosen = { row: full, account };
      else if (!other && creditTo(full, chosen.account) === 0n) other = full;
    }
    if (!json.links || !json.links.next) break;
    page = base + json.links.next;
  }
  assert.ok(chosen, "no testnet transfer of at least 0.1 HBAR");
  assert.ok(other, "no second testnet transfer to use as a wrong recipient");
  const handle = tempDb();
  try {
    handle.db.prepare(
      "INSERT INTO messages (topic_id, seq, ts, payer, body) VALUES (?, 1, ?, ?, ?)"
    ).run(
      TOPIC,
      POST_TS,
      chosen.account,
      JSON.stringify({ marker: { data: { title: "testnet" } } })
    );
    const live = {
      db: handle.db,
      mirror: base,
      txAttempts: 3,
      txPauseMs: 400,
      fetchMirror: async (url) => {
        const res = await fetch(url);
        let json = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        return { ok: res.ok, status: res.status, json };
      },
    };
    const txId = chosen.row.transaction_id;
    const first = await recordDonation(live, { txId, topicId: TOPIC, postTimestamp: POST_TS });
    assert.equal(first.ok, true, first.error || "record failed");
    assert.equal(first.total, formatHbar(creditTo(chosen.row, chosen.account)));
    assert.equal(first.count, 1);
    const replay = await recordDonation(live, { txId, topicId: TOPIC, postTimestamp: POST_TS });
    assert.equal(replay.status, 409);
    assert.equal(donationPostTotals(handle.db, TOPIC, POST_TS).count, 1);
    const fake = await recordDonation(live, {
      txId: "0.0.100@1.000000001",
      topicId: TOPIC,
      postTimestamp: POST_TS,
    });
    assert.equal(fake.status, 404);
    if (other) {
      const wrong = await recordDonation(live, {
        txId: other.transaction_id,
        topicId: TOPIC,
        postTimestamp: POST_TS,
      });
      assert.equal(wrong.error, "wrong recipient");
      assert.equal(donationPostTotals(handle.db, TOPIC, POST_TS).count, 1);
    }
    const memo = handle.db.prepare("SELECT memo FROM donations").get().memo;
    assert.equal(typeof memo, "string");
  } finally {
    handle.close();
  }
});
