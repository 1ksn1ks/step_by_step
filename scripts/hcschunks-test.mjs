// HCS chunk join. No network and no DOM.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  AccountId,
  PrivateKey,
  TopicMessageSubmitTransaction,
  TransactionId,
} from "@hashgraph/sdk";
import { proto } from "@hiero-ledger/proto";
import {
  CHUNK_TTL_MS,
  HCS_CHUNK_SIZE,
  HCS_MAX_CHUNKS,
  HCS_MESSAGE_MAX_BYTES,
  createChunkAssembler,
  ingestMirrorRows,
  openWatermark,
} from "../hcschunks.js";
import { splitFrozenChunks } from "../hcssplit.js";
import {
  decryptMessage,
  encryptMessage,
  parsePrivateKey,
  parsePublicKey,
} from "../sodium.js";

const TOPIC = "0.0.9609912";

function mirrorChunks(text, { startSeq = 10, tx = "0.0.9779355-1700000000-000000001", nonce = 0, payer = "0.0.9779355" } = {}) {
  const bytes = Buffer.from(text, "utf8");
  const total = Math.max(1, Math.ceil(bytes.length / HCS_CHUNK_SIZE));
  const rows = [];
  for (let i = 0; i < total; i++) {
    const slice = bytes.subarray(i * HCS_CHUNK_SIZE, (i + 1) * HCS_CHUNK_SIZE);
    rows.push({
      chunk_info: {
        initial_transaction_id: tx,
        nonce,
        number: i + 1,
        total,
        scheduled: false,
      },
      consensus_timestamp: `${1700000000 + i}.00000000${i + 1}`,
      message: Buffer.from(slice).toString("base64"),
      payer_account_id: payer,
      sequence_number: startSeq + i,
      topic_id: TOPIC,
    });
  }
  return rows;
}

function joinedText(row) {
  return Buffer.from(row.message, "base64").toString("utf8");
}

function testOutOfOrderJoin() {
  const text = JSON.stringify({
    userMessage: "A".repeat(1020) + "😀😀" + "B".repeat(800),
  });
  assert.ok(Buffer.byteLength(text) > HCS_CHUNK_SIZE);
  const rows = mirrorChunks(text);
  assert.ok(rows.length >= 2);
  const assembler = createChunkAssembler();
  const ready = [];
  for (const row of rows.slice().reverse()) {
    const next = assembler.push(TOPIC, row);
    if (next) ready.push(next);
  }
  assert.equal(ready.length, 1);
  assert.equal(joinedText(ready[0]), text);
  assert.equal(ready[0].sequence_number, rows[0].sequence_number);
  assert.equal(ready[0].consensus_timestamp, rows[0].consensus_timestamp);
  assert.equal(ready[0].payer_account_id, rows[0].payer_account_id);
  assert.equal(ready[0].chunk_info, undefined);
}

function testMissingChunkShowsNothing() {
  const text = JSON.stringify({ userMessage: "C".repeat(2500) });
  const rows = mirrorChunks(text, { startSeq: 40 });
  assert.ok(rows.length >= 3);
  const assembler = createChunkAssembler();
  const ready = ingestMirrorRows(assembler, TOPIC, [rows[0], rows[2]]);
  assert.deepEqual(ready, []);
  assert.ok(assembler.pendingSequences(TOPIC).length >= 1);
  const plain = {
    message: Buffer.from(JSON.stringify({ userMessage: "later" }), "utf8").toString("base64"),
    sequence_number: 80,
    consensus_timestamp: "1700000090.000000001",
    payer_account_id: "0.0.3",
  };
  const shown = ingestMirrorRows(assembler, TOPIC, [plain]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].parsed.userMessage, "later");
  assert.equal(openWatermark(0, [rows[0], rows[2], plain], assembler.pendingSequences(TOPIC)), 39);
}

function testDuplicates() {
  const text = JSON.stringify({ userMessage: "D".repeat(1500) });
  const rows = mirrorChunks(text, { startSeq: 5, tx: "0.0.9779355-1700000001-000000002" });
  const assembler = createChunkAssembler();
  assert.equal(assembler.push(TOPIC, rows[0]), null);
  assert.equal(assembler.push(TOPIC, rows[0]), null);
  const ready = assembler.push(TOPIC, rows[1]);
  assert.equal(joinedText(ready), text);
  assert.equal(Buffer.from(ready.message, "base64").length, Buffer.byteLength(text));
  assert.equal(assembler.push(TOPIC, rows[0]), null);
  assert.equal(assembler.push(TOPIC, rows[1]), null);
  assert.deepEqual(ingestMirrorRows(assembler, TOPIC, rows), []);
}

function testPlainMessageUnchanged() {
  const row = {
    message: Buffer.from(JSON.stringify({ userMessage: "hi" }), "utf8").toString("base64"),
    sequence_number: 3,
    consensus_timestamp: "1700000003.000000001",
    payer_account_id: "0.0.8",
  };
  const assembler = createChunkAssembler();
  assert.equal(assembler.push(TOPIC, row), row);
  const got = ingestMirrorRows(assembler, TOPIC, [row]);
  assert.equal(got.length, 1);
  assert.equal(got[0].parsed.userMessage, "hi");
  assert.equal(got[0].sequence_number, 3);
  assert.equal(got[0].payer, "0.0.8");
}

function testDropIncompleteAfterTenMinutes() {
  const text = JSON.stringify({ userMessage: "E".repeat(1500) });
  const rows = mirrorChunks(text, { startSeq: 90, tx: "0.0.9779355-1700000002-000000003" });
  const assembler = createChunkAssembler();
  assert.equal(assembler.push(TOPIC, rows[0], 1_000), null);
  assert.equal(assembler.push(TOPIC, rows[1], 1_000 + CHUNK_TTL_MS), null);
  assert.deepEqual(assembler.pendingSequences(TOPIC), [rows[1].sequence_number]);
  const fresh = createChunkAssembler();
  const ready = ingestMirrorRows(fresh, TOPIC, rows.slice().reverse(), 5_000);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].parsed.userMessage, JSON.parse(text).userMessage);
}

function testTopicsDoNotShareChunks() {
  const text = JSON.stringify({ userMessage: "F".repeat(1200) });
  const rows = mirrorChunks(text);
  const assembler = createChunkAssembler();
  assert.equal(assembler.push("0.0.1", rows[0]), null);
  assert.equal(assembler.push("0.0.2", rows[1]), null);
  assert.deepEqual(assembler.pendingSequences("0.0.1"), [rows[0].sequence_number]);
  assert.deepEqual(assembler.pendingSequences("0.0.2"), [rows[1].sequence_number]);
}

async function testE2eeOverOneKilobyte() {
  const key = PrivateKey.generateED25519();
  const pub = parsePublicKey(key.publicKey.toString());
  const priv = parsePrivateKey(key.toString());
  const plain = "secret " + "g".repeat(1100);
  const encrypted = await encryptMessage(plain, pub);
  const payload = JSON.stringify({ encryptedMessage: encrypted });
  assert.ok(Buffer.byteLength(payload) > HCS_CHUNK_SIZE);
  assert.ok(Buffer.byteLength(payload) <= HCS_MESSAGE_MAX_BYTES);
  const rows = mirrorChunks(payload, { tx: "0.0.9779355-1700000004-000000004" });
  const assembler = createChunkAssembler();
  const order = [rows[1], rows[0], rows[1]].filter(Boolean);
  if (rows[2]) order.splice(1, 0, rows[2]);
  const ready = ingestMirrorRows(assembler, TOPIC, order);
  assert.equal(ready.length, 1);
  const opened = await decryptMessage(ready[0].parsed.encryptedMessage, priv);
  assert.equal(opened, plain);
}

function testMirrorFallbackJoin() {
  const text = JSON.stringify({ userMessage: "mirror " + "h".repeat(1800) });
  const rows = mirrorChunks(text, { startSeq: 20, tx: "0.0.9779355-1700000005-000000005" });
  const before = {
    message: Buffer.from(JSON.stringify({ userMessage: "before" }), "utf8").toString("base64"),
    sequence_number: 19,
    consensus_timestamp: "1699999999.000000001",
    payer_account_id: "0.0.4",
  };
  const assembler = createChunkAssembler();
  const partial = ingestMirrorRows(assembler, TOPIC, [before, rows[0]]);
  assert.equal(partial.length, 1);
  assert.equal(partial[0].parsed.userMessage, "before");
  assert.equal(
    openWatermark(0, [before, rows[0]], assembler.pendingSequences(TOPIC)),
    19,
  );
  const rest = rows.slice(1);
  const done = ingestMirrorRows(assembler, TOPIC, rest);
  assert.equal(done.length, 1);
  assert.equal(done[0].parsed.userMessage, JSON.parse(text).userMessage);
  assert.equal(done[0].sequence_number, rows[0].sequence_number);
  assert.equal(done[0].payer, rows[0].payer_account_id);
  assert.deepEqual(assembler.pendingSequences(TOPIC), []);
  const all = [before, ...rows];
  assert.equal(openWatermark(0, all, assembler.pendingSequences(TOPIC)), all[all.length - 1].sequence_number);
}

function chunkBodies(transaction) {
  const list = proto.TransactionList.decode(transaction.toBytes()).transactionList || [];
  return list.map((item) => {
    const signed = proto.SignedTransaction.decode(item.signedTransactionBytes);
    const body = proto.TransactionBody.decode(signed.bodyBytes);
    return body.consensusSubmitMessage;
  });
}

function testSdkChunksStayLinked() {
  const text = "m".repeat(1022) + "😀" + "n".repeat(1400);
  assert.ok(Buffer.byteLength(text) > HCS_CHUNK_SIZE);
  assert.ok(Buffer.byteLength(text) <= HCS_MESSAGE_MAX_BYTES);
  const tx = new TopicMessageSubmitTransaction()
    .setTopicId(TOPIC)
    .setMessage(text)
    .setMaxChunks(HCS_MAX_CHUNKS);
  assert.equal(tx.getMaxChunks(), HCS_MAX_CHUNKS);
  const chunks = tx.getRequiredChunks();
  assert.ok(chunks >= 2 && chunks <= HCS_MAX_CHUNKS);
  tx.setNodeAccountIds([new AccountId(3)]);
  tx.setTransactionId(TransactionId.generate("0.0.9779355"));
  tx.freeze();
  const parts = splitFrozenChunks(tx);
  assert.equal(parts.length, chunks);
  const bodies = parts.map((part) => {
    const submit = chunkBodies(part);
    assert.equal(submit.length, 1);
    return submit[0];
  });
  bodies.sort((a, b) => Number(a.chunkInfo.number) - Number(b.chunkInfo.number));
  assert.equal(Number(bodies[0].chunkInfo.number), 1);
  assert.equal(Number(bodies[0].chunkInfo.total), chunks);
  const initial = JSON.stringify(bodies[0].chunkInfo.initialTransactionID);
  for (const body of bodies) {
    assert.equal(Number(body.chunkInfo.total), chunks);
    assert.equal(JSON.stringify(body.chunkInfo.initialTransactionID), initial);
  }
  const joined = Buffer.concat(bodies.map((body) => Buffer.from(body.message)));
  assert.equal(joined.toString("utf8"), text);
}

export async function runHcsChunkTests() {
  testOutOfOrderJoin();
  testMissingChunkShowsNothing();
  testDuplicates();
  testPlainMessageUnchanged();
  testDropIncompleteAfterTenMinutes();
  testTopicsDoNotShareChunks();
  await testE2eeOverOneKilobyte();
  testMirrorFallbackJoin();
  testSdkChunksStayLinked();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runHcsChunkTests();
  console.log("hcs chunk tests passed");
}
