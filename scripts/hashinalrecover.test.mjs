// Mirror reads for a half-written HCS-1 topic. No wallet and no storage.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { PrivateKey } from "@hashgraph/sdk";
import { buildHcs1Inscription } from "../hcs1inscribe.js";
import { checkTopicByCount, readTopic, recoverInscription } from "../hashinalrecover.js";

const READ_ERROR = "Could not read the topic on Hedera";

function encode(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

function infoBody(memo, key = "ab") {
  return { memo, submit_key: { _type: "ED25519", key } };
}

function messageRow(text, sequence) {
  return { message: encode(text), sequence_number: sequence };
}

async function assertReadFails(fn) {
  await assert.rejects(fn, (err) => {
    assert.equal(err.message, READ_ERROR);
    assert.equal(err.userFacing, true);
    return true;
  });
}

test("readTopic pages a hundred at a time and ignores a next link off the mirror", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => JSON.stringify({ o: index, c: `c${index}` }));
  rows.push(JSON.stringify({ o: 0, c: "later copy" }));
  const fetched = [];
  const fetchImpl = async (url, init) => {
    fetched.push(String(url));
    assert.ok(init && init.signal instanceof AbortSignal);
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith("/messages")) return jsonResponse(infoBody("memo-1", "AB"));
    const from = Number(parsed.searchParams.get("from") || "0");
    const slice = rows.slice(from, from + 100);
    const nextFrom = from + slice.length;
    const next = nextFrom < rows.length
      ? `/api/v1/topics/0.0.5/messages?limit=100&order=asc&from=${nextFrom}`
      : "https://evil.example/api/v1/topics/0.0.5/messages?from=999";
    return jsonResponse({
      messages: slice.map((text, index) => messageRow(text, from + index + 1)),
      links: { next },
    });
  };
  const topic = await readTopic("0.0.5", { fetchImpl });
  assert.equal(topic.memo, "memo-1");
  assert.equal(topic.submitKeyHex, "ab");
  assert.equal(topic.submitKeyType, "ED25519");
  assert.equal(topic.count, 120);
  assert.equal(topic.messages.get(0), rows[0]);
  assert.equal(topic.messages.get(119), rows[119]);
  assert.equal(fetched.filter((url) => url.includes("/messages")).length, 2);
  assert.equal(fetched.some((url) => url.includes("evil.example")), false);
  assert.ok(fetched.every((url) => url.startsWith("https://mainnet.mirrornode.hedera.com/")));
});

test("a same-host link outside /api/v1 is not followed, and paging stops at 130", async () => {
  const fetched = [];
  let pages = 0;
  const fetchImpl = async (url) => {
    fetched.push(String(url));
    if (!String(url).includes("/messages")) return jsonResponse(infoBody("m"));
    pages += 1;
    const next = pages === 1
      ? "https://mainnet.mirrornode.hedera.com/admin/topics/0.0.6/messages"
      : `https://mainnet.mirrornode.hedera.com/api/v1/topics/0.0.6/messages?limit=100&order=asc&page=${pages + 1}`;
    return jsonResponse({
      messages: [messageRow(JSON.stringify({ o: pages - 1, c: "a" }), pages)],
      links: { next },
    });
  };
  const stopped = await readTopic("0.0.6", { fetchImpl });
  assert.equal(stopped.count, 1);
  assert.equal(fetched.some((url) => url.includes("/admin/")), false);

  pages = 0;
  fetched.length = 0;
  const capped = await readTopic("0.0.6", {
    fetchImpl: async (url) => {
      fetched.push(String(url));
      if (!String(url).includes("/messages")) return jsonResponse(infoBody("m"));
      pages += 1;
      return jsonResponse({
        messages: [messageRow(JSON.stringify({ o: pages - 1, c: "a" }), pages)],
        links: { next: `https://mainnet.mirrornode.hedera.com/api/v1/topics/0.0.6/messages?page=${pages + 1}` },
      });
    },
  });
  assert.equal(pages, 130);
  assert.equal(capped.count, 130);
  assert.equal(fetched.filter((url) => url.includes("/messages")).length, 130);
});

test("a mirror failure is one readable error", async () => {
  await assertReadFails(() => readTopic("nope", {
    fetchImpl: async () => { throw new Error("must not fetch"); },
  }));
  await assertReadFails(() => readTopic("0.0.1", {
    fetchImpl: async () => { throw new Error("offline"); },
  }));
  await assertReadFails(() => readTopic("0.0.1", {
    fetchImpl: async () => jsonResponse({}, false),
  }));
  await assertReadFails(() => readTopic("0.0.1", {
    fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }),
  }));
  const source = fs.readFileSync(new URL("../hashinalrecover.js", import.meta.url), "utf8");
  assert.match(source, /AbortSignal\.timeout\(4000\)/);
  assert.equal(/web3|localStorage|sessionStorage|indexedDB|hedera\.js/.test(source), false);
  assert.match(source, /from "\.\/hcs1inscribe\.js"/);
});

test("checkTopicByCount reports complete, partial, and a different memo", async () => {
  const bytes = crypto.randomBytes(8 * 1024);
  const built = await buildHcs1Inscription(bytes, "image/png");
  assert.ok(built.messages.length > 2);
  const serve = (memo, messages) => async (url) => {
    if (!String(url).includes("/messages")) return jsonResponse(infoBody(memo, "cd"));
    return jsonResponse({
      messages: messages.map((text, index) => messageRow(text, index + 1)),
      links: { next: null },
    });
  };
  const complete = await checkTopicByCount({
    topicId: "0.0.8",
    memo: built.memo,
    total: built.messages.length,
  }, { fetchImpl: serve(built.memo, built.messages) });
  assert.equal(complete.status, "complete");
  assert.equal(complete.total, built.messages.length);
  assert.deepEqual(complete.sentIndexes, built.messages.map((_, index) => index));

  const partial = await checkTopicByCount({
    topicId: "0.0.8",
    memo: built.memo,
    total: built.messages.length,
  }, { fetchImpl: serve(built.memo, [built.messages[0], built.messages[2]]) });
  assert.deepEqual(partial, {
    status: "partial",
    sentIndexes: [0, 2],
    total: built.messages.length,
  });

  const wrong = await checkTopicByCount({
    topicId: "0.0.8",
    memo: built.memo,
    total: built.messages.length,
  }, { fetchImpl: serve("other:zstd:base64", built.messages) });
  assert.deepEqual(wrong, { status: "wrong-topic" });
});

test("recoverInscription tells a partial topic from the wrong file, key, or chunk", async () => {
  const bytes = crypto.randomBytes(8 * 1024);
  const mime = "image/png";
  const built = await buildHcs1Inscription(bytes, mime);
  assert.ok(built.messages.length > 3);
  const own = await PrivateKey.generateED25519Async();
  const other = await PrivateKey.generateED25519Async();
  const raw = own.publicKey.toStringRaw().toUpperCase();
  const prepared = { bytes, mime };

  function serve(messages, key = raw, memo = built.memo) {
    return async (url) => {
      if (!String(url).includes("/messages")) return jsonResponse(infoBody(memo, key));
      return jsonResponse({
        messages: messages.map((text, index) => messageRow(text, index + 1)),
        links: { next: null },
      });
    };
  }

  const present = [built.messages[0], built.messages[1], built.messages[2]];
  const partial = await recoverInscription(
    { topicId: "0.0.9", prepared, submitKey: own },
    { fetchImpl: serve(present) },
  );
  assert.deepEqual(partial, {
    status: "partial",
    sentIndexes: [0, 1, 2],
    total: built.messages.length,
    topicId: "0.0.9",
  });

  const duplicated = built.messages.slice();
  duplicated.push(JSON.stringify({ o: 0, c: "not the first copy" }));
  const once = await recoverInscription(
    { topicId: "0.0.9", prepared, submitKey: own },
    { fetchImpl: serve(duplicated) },
  );
  assert.equal(once.status, "complete");
  assert.equal(once.sentIndexes.length, built.messages.length);
  assert.deepEqual(once.sentIndexes, built.messages.map((_, index) => index));

  const wrongFile = await recoverInscription(
    { topicId: "0.0.9", prepared: { bytes: crypto.randomBytes(80), mime }, submitKey: own },
    { fetchImpl: serve(built.messages) },
  );
  assert.deepEqual(wrongFile, { status: "wrong-file" });

  const wrongKey = await recoverInscription(
    { topicId: "0.0.9", prepared, submitKey: other },
    { fetchImpl: serve(built.messages) },
  );
  assert.deepEqual(wrongKey, { status: "wrong-key" });

  const missingKey = await recoverInscription(
    { topicId: "0.0.9", prepared, submitKey: own },
    { fetchImpl: serve(built.messages, "") },
  );
  assert.deepEqual(missingKey, { status: "wrong-key" });

  const changed = built.messages.slice();
  const parsed = JSON.parse(changed[1]);
  parsed.c = `${parsed.c.slice(0, -1)}${parsed.c.endsWith("A") ? "B" : "A"}`;
  changed[1] = JSON.stringify(parsed);
  const conflict = await recoverInscription(
    { topicId: "0.0.9", prepared, submitKey: own },
    { fetchImpl: serve(changed) },
  );
  assert.deepEqual(conflict, { status: "conflict", index: 1 });
});
