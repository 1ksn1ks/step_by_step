// HCS chunk join. No network and no DOM.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  AccountId,
  PrivateKey,
  Timestamp,
  TopicMessageSubmitTransaction,
  TransactionId,
} from "@hashgraph/sdk";
import { proto } from "@hiero-ledger/proto";
import {
  CHUNK_TTL_MS,
  DONE_KEY_LIMIT,
  HCS_CHUNK_SIZE,
  HCS_MAX_CHUNKS,
  HCS_MESSAGE_MAX_BYTES,
  createChunkAssembler,
  ingestMirrorRows,
  openWatermark,
} from "../hcschunks.js";
import { freezeOneHcsChunk, splitFrozenChunks } from "../hcssplit.js";
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

function decodeBodies(transaction) {
  const list = proto.TransactionList.decode(transaction.toBytes()).transactionList || [];
  return list.map((item) => {
    const signed = proto.SignedTransaction.decode(item.signedTransactionBytes);
    return proto.TransactionBody.decode(signed.bodyBytes);
  });
}

function chunkBodies(transaction) {
  return decodeBodies(transaction).map((body) => body.consensusSubmitMessage);
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
  const frozen = decodeBodies(tx);
  assert.equal(frozen.length, chunks);
  frozen.sort((a, b) => Number(a.consensusSubmitMessage.chunkInfo.number) - Number(b.consensusSubmitMessage.chunkInfo.number));
  const firstId = JSON.stringify(frozen[0].transactionID);
  const sharedSeconds = frozen[0].transactionID.transactionValidStart.seconds.toString();
  assert.equal(firstId, JSON.stringify(frozen[0].consensusSubmitMessage.chunkInfo.initialTransactionID));
  for (const body of frozen) {
    assert.equal(body.transactionID.transactionValidStart.seconds.toString(), sharedSeconds);
    assert.equal(JSON.stringify(body.consensusSubmitMessage.chunkInfo.initialTransactionID), firstId);
  }
  const nanosOf = (value) => value != null && typeof value.toNumber === "function"
    ? value.toNumber()
    : Number(value);
  assert.equal(
    nanosOf(frozen[1].transactionID.transactionValidStart.nanos),
    nanosOf(frozen[0].transactionID.transactionValidStart.nanos) + 1,
  );
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

function oneChunk(text, tx, payer, seq) {
  return {
    chunk_info: {
      initial_transaction_id: tx,
      number: 1,
      total: 1,
      scheduled: false,
    },
    message: Buffer.from(text).toString("base64"),
    payer_account_id: payer,
    sequence_number: seq,
    consensus_timestamp: "1.000000001",
    topic_id: TOPIC,
  };
}

function testPayerMustMatchInitialAccount() {
  const text = JSON.stringify({ userMessage: "P".repeat(1500) });
  const rows = mirrorChunks(text, {
    tx: "0.0.9779355-1700000006-000000006",
    payer: "0.0.9779355",
  });
  const assembler = createChunkAssembler();
  const spoof = { ...rows[0], payer_account_id: "0.0.1" };
  assert.equal(assembler.push(TOPIC, spoof), null);
  assert.equal(assembler.push(TOPIC, rows[1]), null);
  const ready = assembler.push(TOPIC, rows[0]);
  assert.equal(joinedText(ready), text);
  assert.equal(ready.payer_account_id, "0.0.9779355");

  const objectRows = rows.map((row, index) => ({
    ...row,
    sequence_number: 400 + index,
    payer_account_id: "0.0.5",
    chunk_info: {
      ...row.chunk_info,
      initial_transaction_id: {
        account_id: "0.0.5",
        transaction_valid_start: "1700000007.000000001",
      },
    },
  }));
  const objects = createChunkAssembler();
  assert.equal(objects.push(TOPIC, { ...objectRows[0], payer_account_id: "0.0.9" }), null);
  assert.equal(objects.push(TOPIC, objectRows[1]), null);
  const joined = objects.push(TOPIC, objectRows[0]);
  assert.equal(joinedText(joined), text);
  assert.equal(joined.payer_account_id, "0.0.5");

  const atForm = createChunkAssembler();
  const atRows = mirrorChunks(text, {
    tx: "0.0.8@1700000008.000000001",
    payer: "0.0.8",
    startSeq: 500,
  });
  assert.equal(atForm.push(TOPIC, { ...atRows[0], payer_account_id: "0.0.1" }), null);
  assert.equal(atForm.push(TOPIC, atRows[0]), null);
  assert.equal(joinedText(atForm.push(TOPIC, atRows[1])), text);
}

function testDoneSetIsBounded() {
  const assembler = createChunkAssembler();
  const base = 1_000_000;
  for (let i = 0; i < DONE_KEY_LIMIT + 1; i += 1) {
    const ready = assembler.push(
      TOPIC,
      oneChunk("x", `0.0.5-${1700000000 + i}-1`, "0.0.5", i + 1),
      base + i,
    );
    assert.ok(ready);
  }
  const oldest = oneChunk("x", "0.0.5-1700000000-1", "0.0.5", 1);
  assert.ok(assembler.push(TOPIC, oldest, base + DONE_KEY_LIMIT + 1));
  const newest = oneChunk("x", `0.0.5-${1700000000 + DONE_KEY_LIMIT}-1`, "0.0.5", DONE_KEY_LIMIT + 1);
  assert.equal(assembler.push(TOPIC, newest, base + DONE_KEY_LIMIT + 2), null);

  const ttl = createChunkAssembler();
  const row = oneChunk("y", "0.0.5-1800000000-1", "0.0.5", 9);
  assert.ok(ttl.push(TOPIC, row, 10));
  assert.equal(ttl.push(TOPIC, row, 10 + CHUNK_TTL_MS - 1), null);
  assert.ok(ttl.push(TOPIC, row, 10 + CHUNK_TTL_MS));
}

function testFreshValidStartPerChunk() {
  const text = "m".repeat(1022) + "😀" + "n".repeat(1400);
  const bytes = Buffer.byteLength(text);
  assert.ok(bytes > HCS_CHUNK_SIZE);
  const chunks = Math.ceil(bytes / HCS_CHUNK_SIZE);
  const account = "0.0.9779355";
  const ids = [];
  for (let number = 1; number <= chunks; number += 1) {
    ids.push(TransactionId.withValidStart(
      AccountId.fromString(account),
      new Timestamp(1_700_000_000 + (number - 1) * 300, 10),
    ));
  }
  const node = new AccountId(3);
  const parts = ids.map((transactionId, index) => freezeOneHcsChunk({
    topicId: TOPIC,
    message: text,
    nodeAccountId: node,
    transactionId,
    initialTransactionId: ids[0],
    number: index + 1,
    total: chunks,
    maxChunks: HCS_MAX_CHUNKS,
    chunkSize: HCS_CHUNK_SIZE,
  }));
  const bodies = parts.map((part) => {
    const decoded = decodeBodies(part);
    assert.equal(decoded.length, 1);
    return decoded[0];
  });
  const initial = JSON.stringify(bodies[0].transactionID);
  assert.equal(initial, JSON.stringify(bodies[0].consensusSubmitMessage.chunkInfo.initialTransactionID));
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const submit = body.consensusSubmitMessage;
    assert.equal(JSON.stringify(submit.chunkInfo.initialTransactionID), initial);
    assert.equal(Number(submit.chunkInfo.number), index + 1);
    assert.equal(Number(submit.chunkInfo.total), chunks);
    assert.equal(
      body.transactionID.transactionValidStart.seconds.toString(),
      String(1_700_000_000 + index * 300),
    );
    if (index > 0) {
      assert.notEqual(JSON.stringify(body.transactionID), initial);
    }
  }
  const joined = Buffer.concat(bodies.map((body) => Buffer.from(body.consensusSubmitMessage.message)));
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
  testPayerMustMatchInitialAccount();
  testDoneSetIsBounded();
  testFreshValidStartPerChunk();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runHcsChunkTests();
  console.log("hcs chunk tests passed");
}
