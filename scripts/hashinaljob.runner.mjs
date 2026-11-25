// Hashinal checkpoint with the wallet and the token mint stood in for.
// Inscribing and the mirror recovery stay real. Fetch and storage are in memory.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { PrivateKey } from "@hashgraph/sdk";

const logs = [];
for (const name of ["log", "info", "warn", "error", "debug"]) {
  console[name] = (...args) => {
    logs.push(args.map((part) => {
      if (typeof part === "string") return part;
      try { return JSON.stringify(part); } catch { return String(part); }
    }).join(" "));
  };
}

const { buildHcs1Inscription, inscribeHcs1 } = await import("../hcs1inscribe.js");

const ACCOUNT = "0.0.1001";
const TOKEN = "0.0.4242";
const JOB_KEY = `w3g-hashinal:${ACCOUNT}`;
const NAME = "Hash";
const DESCRIPTION = "A picture";
const CREATOR = "ada";
const DER_PREFIXES = [
  "302e020100300506032b657004220420",
  "3030020100300706052b8104000a04220420",
];

const topics = new Map();
const creates = [];
const sends = [];
const mintCalls = [];
const metaLooks = [];
const txLooks = [];
const prepareCalls = [];
const jsonBodies = [];
const storages = [];
const events = [];
const errors = [];
const secrets = new Set();

let nextTopic = 800;
let cut = null;
let mintMode = "ok";
let metaFound = null;
let txLook = () => ({ status: "unknown" });
let prepareBehavior = "same";
let activePrepared = null;

function remember(key) {
  if (!key || typeof key.toString !== "function") return;
  const priv = key.toString();
  const raw = typeof key.toStringRaw === "function" ? key.toStringRaw() : "";
  if (priv) secrets.add(priv.toLowerCase());
  if (raw) secrets.add(raw.toLowerCase());
}

function resetRun() {
  topics.clear();
  creates.length = 0;
  sends.length = 0;
  mintCalls.length = 0;
  metaLooks.length = 0;
  txLooks.length = 0;
  prepareCalls.length = 0;
  jsonBodies.length = 0;
  cut = null;
  mintMode = "ok";
  metaFound = null;
  txLook = () => ({ status: "unknown" });
  prepareBehavior = "same";
  activePrepared = null;
}

globalThis.fetch = async (url) => {
  const parsed = new URL(String(url));
  const info = parsed.pathname.match(/^\/api\/v1\/topics\/(0\.0\.\d+)$/);
  if (info) {
    const topic = topics.get(info[1]);
    if (!topic) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        memo: topic.memo,
        submit_key: topic.submitKeyHex ? { _type: "ED25519", key: topic.submitKeyHex } : null,
      }),
    };
  }
  const messages = parsed.pathname.match(/^\/api\/v1\/topics\/(0\.0\.\d+)\/messages$/);
  if (!messages) return { ok: false, status: 404, json: async () => ({}) };
  const topic = topics.get(messages[1]);
  if (!topic) return { ok: false, status: 404, json: async () => ({}) };
  const from = Number(parsed.searchParams.get("from") || "0");
  const slice = topic.messages.slice(from, from + 100);
  const nextFrom = from + slice.length;
  const next = nextFrom < topic.messages.length
    ? `https://mainnet.mirrornode.hedera.com/api/v1/topics/${messages[1]}/messages?limit=100&order=asc&from=${nextFrom}`
    : null;
  return {
    ok: true,
    json: async () => ({
      messages: slice.map((text, index) => ({
        message: Buffer.from(text, "utf8").toString("base64"),
        sequence_number: from + index + 1,
      })),
      links: { next },
    }),
  };
};

async function inscribePrepared(prepared, opts = {}) {
  const kind = prepared && prepared.mime === "application/json" ? "meta" : "file";
  if (kind === "meta" && prepared && prepared.bytes) {
    jsonBodies.push(new TextDecoder().decode(prepared.bytes));
  }
  return inscribeHcs1({
    bytes: prepared.bytes,
    mime: prepared.mime,
    submitKey: opts.submitKey,
    onTopic: opts.onTopic,
    onProgress: opts.onProgress,
    resume: opts.resume,
    createTopic: async ({ memo, submitKey }) => {
      remember(submitKey);
      const id = `0.0.${nextTopic}`;
      nextTopic += 1;
      const submitKeyHex = submitKey && submitKey.publicKey && typeof submitKey.publicKey.toStringRaw === "function"
        ? String(submitKey.publicKey.toStringRaw()).trim().toLowerCase()
        : "";
      topics.set(id, { memo, submitKeyHex, messages: [] });
      creates.push({ id, memo, kind });
      return id;
    },
    submitMessage: async ({ topicId, message, submitKey }) => {
      remember(submitKey);
      const topic = topics.get(topicId);
      if (cut && cut.kind === kind && topic.messages.length >= cut.after) {
        if (typeof cut.onCut === "function") cut.onCut();
        throw new Error("submit failed");
      }
      topic.messages.push(message);
      sends.push({ topicId, message, kind });
    },
  });
}

async function prepareInscribeFile() {
  throw new Error("prepareInscribeFile is not used");
}

mock.module("../hcs1inscribewallet.js", {
  exports: { prepareInscribeFile, inscribePrepared },
});

mock.module("../web3.js", {
  exports: {
    signer: {
      getAccountId() {
        return { toString() { return ACCOUNT; } };
      },
    },
  },
});

async function mintNfts(tokenId, metadata) {
  mintCalls.push({ tokenId, metadata: metadata.slice(), mode: mintMode });
  if (mintMode === "stop") throw new Error("submit failed");
  if (mintMode === "failed") {
    const err = new Error("receipt status failed");
    err.mintFailed = true;
    throw err;
  }
  if (mintMode === "unconfirmed") {
    const err = new Error("The mint is not on the mirror yet. It was not minted again.");
    err.userFacing = true;
    err.mintUnconfirmed = true;
    err.txIds = ["0.0.1001@1700000000.000000008"];
    throw err;
  }
  if (mintMode === "decline") {
    const err = new Error("user rejected the request");
    err.userFacing = true;
    throw err;
  }
  return { tokenId, txId: "0.0.1001@1700000000.000000009", serials: ["7"] };
}

async function checkMintTx(txId, tokenId) {
  txLooks.push({ txId, tokenId });
  return txLook(txId, tokenId);
}

async function checkMintByMetadata(tokenId, account, metadata) {
  metaLooks.push({ tokenId, account, metadata });
  if (metaFound) return { status: "minted", serials: metaFound.slice() };
  return { status: "unknown" };
}

async function checkCollectionAccess() {
  return { ok: true, remaining: "5" };
}

mock.module("../tokenmint.js", {
  exports: { mintNfts, checkMintTx, checkMintByMetadata, checkCollectionAccess },
});

const { buildHashinalMetadata } = await import("../hashinalmint.js");
const {
  createHashinalRunner,
  discardHashinalJob,
  generateOwnKey,
  loadHashinalJob,
  parseSubmitKey,
  preflightCollection,
} = await import("../hashinaljob.js");

function makeStorage() {
  const map = new Map();
  const saved = [];
  const storage = {
    saved,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      const text = String(value);
      map.set(String(key), text);
      saved.push(text);
    },
    removeItem(key) {
      map.delete(key);
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
    clone() {
      const copy = makeStorage();
      for (const [key, value] of map) copy.setItem(key, value);
      return copy;
    },
  };
  storages.push(storage);
  return storage;
}

async function prepareFile(file, opts = {}) {
  prepareCalls.push({ asIs: opts.asIs === true, file });
  if (prepareBehavior === "wrong") {
    return { bytes: crypto.randomBytes(48), mime: "image/png", name: "other.png", overCap: false };
  }
  if (prepareBehavior === "recompress" && opts.asIs !== true) {
    return { ...activePrepared, bytes: crypto.randomBytes(activePrepared.bytes.length) };
  }
  return activePrepared;
}

function makeRunner(storage, options = {}) {
  const opts = {
    accountId: options.accountId || ACCOUNT,
    storage,
    prepareFile,
    now: () => 1700000000000,
  };
  if (options.preflight) opts.preflight = options.preflight;
  const runner = createHashinalRunner(opts);
  for (const name of ["status", "progress", "topic", "done", "warning"]) {
    runner.on(name, (payload) => events.push(payload));
  }
  return runner;
}

async function filePrepared(size) {
  const bytes = crypto.randomBytes(size);
  const built = await buildHcs1Inscription(bytes, "image/png");
  return {
    bytes,
    mime: "image/png",
    name: "pic.png",
    overCap: false,
    txCount: built.txCount,
    usd: built.usd,
    built,
  };
}

function longAttributes() {
  const attributes = [];
  for (let index = 0; index < 40; index += 1) {
    let value = "";
    while (value.length < 180) value += `${crypto.randomBytes(16).toString("hex")}g`;
    attributes.push({ trait_type: `trait${index}`, value: value.slice(0, 180) });
  }
  return attributes;
}

function startInput(extra = {}) {
  return {
    tokenId: TOKEN,
    name: NAME,
    description: DESCRIPTION,
    creator: CREATOR,
    attributes: extra.attributes || [{ trait_type: "color", value: "blue" }],
    keyMode: extra.keyMode || "memory",
    prepared: extra.prepared,
    submitKey: extra.keyMode === "own" ? extra.submitKey : undefined,
  };
}

async function runUntilCut(input, kind) {
  const storage = makeStorage();
  let frozen = null;
  cut = {
    kind,
    after: 3,
    onCut() { frozen = storage.clone(); },
  };
  activePrepared = input.prepared;
  const runner = makeRunner(storage);
  const result = await runner.start(input);
  cut = null;
  assert.ok(frozen, "the inscription was not cut off");
  return { storage, frozen, runner, result };
}

function mirrorCopy() {
  const copy = new Map();
  for (const [id, topic] of topics) {
    copy.set(id, { memo: topic.memo, submitKeyHex: topic.submitKeyHex, messages: topic.messages.slice() });
  }
  return copy;
}

function restoreMirror(copy) {
  topics.clear();
  for (const [id, topic] of copy) {
    topics.set(id, { memo: topic.memo, submitKeyHex: topic.submitKeyHex, messages: topic.messages.slice() });
  }
}

function fileSends(topicId) {
  return sends.filter((row) => row.topicId === topicId);
}

async function expectThrow(fn) {
  try {
    await fn();
  } catch (err) {
    errors.push(err && err.message ? err.message : "");
    return err;
  }
  throw new Error("expected a throw");
}

function walk(value, path, problems) {
  if (value && typeof value === "object" && typeof value.toStringRaw === "function") {
    problems.push(`key object ${path}`);
    return;
  }
  if (typeof value === "string") {
    const field = path.slice(path.lastIndexOf(".") + 1);
    if (field !== "memo" && field !== "publicKey" && /[0-9a-fA-F]{64,}/.test(value)) {
      problems.push(`hex ${path}`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, problems));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "submitKey" || key === "privateKey" || key === "seed" || key === "key") {
      problems.push(`field ${path}.${key}`);
    }
    walk(child, `${path}.${key}`, problems);
  }
}

function assertClean(parts) {
  const problems = [];
  for (const part of parts) {
    const text = typeof part === "string" ? part : JSON.stringify(part);
    if (!text) continue;
    const lower = text.toLowerCase();
    if (/"((submitKey)|(privateKey)|(seed)|(key))"/.test(text)) problems.push("property name");
    for (const prefix of DER_PREFIXES) {
      if (lower.includes(prefix)) problems.push("der prefix");
    }
    for (const secret of secrets) {
      if (secret && lower.includes(secret)) problems.push("secret text");
    }
    if (text.startsWith("{") || text.startsWith("[")) {
      try { walk(JSON.parse(text), "$", problems); } catch { /* not json */ }
    }
    if (part && typeof part === "object") walk(part, "$", problems);
  }
  assert.deepEqual(problems, []);
}

const picked = { name: "pic.png", type: "image/png" };

test.describe("hashinal job checkpoint", { concurrency: 1 }, () => {
  test("parseSubmitKey and generateOwnKey round-trip without echoing the text", async () => {
    resetRun();
    const own = await PrivateKey.generateED25519Async();
    remember(own);
    const parsed = parseSubmitKey(own.toString());
    assert.equal(parsed.type, "ED25519");
    assert.equal(parsed.publicKey, own.publicKey.toString());
    assert.equal(parsed.key.toStringRaw(), own.toStringRaw());
    const bare = parseSubmitKey(`  ${own.toStringRaw()}  `);
    assert.equal(bare.type, "ED25519");
    assert.equal(bare.publicKey, own.publicKey.toString());
    const made = await generateOwnKey({
      generate: async () => ({ privateKey: own.toString(), publicKey: "ignored" }),
    });
    assert.equal(made.privateKey, own.toString());
    assert.equal(made.publicKey, own.publicKey.toString());
    for (const input of ["nope", "zz", own]) {
      const err = await expectThrow(() => parseSubmitKey(input));
      assert.equal(err.message, "That is not a private key we can read");
      assert.equal(err.userFacing, true);
    }
  });

  test("the checkpoint module is the only storage writer and loads hedera lazily", () => {
    const source = fs.readFileSync(new URL("../hashinaljob.js", import.meta.url), "utf8");
    const recover = fs.readFileSync(new URL("../hashinalrecover.js", import.meta.url), "utf8");
    assert.equal(/^import\s.*from\s+"\.\/hedera\.js"/m.test(source), false);
    assert.match(source, /import\("\.\/hedera\.js"\)/);
    assert.equal(/web3|localStorage|sessionStorage|indexedDB|hedera\.js/.test(recover), false);
    assert.deepEqual(Object.keys({
      createHashinalRunner,
      discardHashinalJob,
      generateOwnKey,
      loadHashinalJob,
      parseSubmitKey,
      preflightCollection,
    }).sort(), [
      "createHashinalRunner",
      "discardHashinalJob",
      "generateOwnKey",
      "loadHashinalJob",
      "parseSubmitKey",
      "preflightCollection",
    ]);
  });

  test("a running job loads as interrupted, and an in-flight mint loads as unconfirmed", () => {
    resetRun();
    const storage = makeStorage();
    const body = {
      v: 1,
      accountId: ACCOUNT,
      tokenId: TOKEN,
      keyMode: "memory",
      form: { name: NAME, description: "", creator: "", attributes: [] },
      file: { name: "pic.png", mime: "image/png", size: 4 },
      topics: { file: { topicId: "0.0.9", memo: "abc:zstd:base64", total: 2 }, meta: null },
      mint: { inflight: false, txIds: [], minted: null },
      step: "file",
      status: "running",
      reason: "",
      createdAt: 1,
      submitKey: "drop-me",
      privateKey: "drop-me",
      bytes: [1, 2, 3],
    };
    storage.skipScan = true;
    storage.setItem(JOB_KEY, JSON.stringify(body));
    const loaded = loadHashinalJob(ACCOUNT, storage);
    assert.equal(loaded.status, "interrupted");
    assert.equal(Object.hasOwn(loaded, "submitKey"), false);
    assert.equal(Object.hasOwn(loaded, "privateKey"), false);
    assert.equal(Object.hasOwn(loaded, "bytes"), false);
    body.mint.inflight = true;
    body.status = "running";
    storage.setItem(JOB_KEY, JSON.stringify(body));
    assert.equal(loadHashinalJob(ACCOUNT, storage).status, "unconfirmed");
  });

  test("an own key resumes a cut-off file from the mirror and sends only the missing chunks", async () => {
    resetRun();
    const own = await PrivateKey.generateED25519Async();
    remember(own);
    const secret = own.toString();
    const prepared = await filePrepared(8 * 1024);
    assert.ok(prepared.built.messages.length > 3);
    const { frozen, runner: first } = await runUntilCut(startInput({
      prepared, keyMode: "own", submitKey: own,
    }), "file");
    const fileId = creates.find((row) => row.kind === "file").id;
    const mirror = mirrorCopy();
    assert.deepEqual(topics.get(fileId).messages, prepared.built.messages.slice(0, 3));
    assert.equal(loadHashinalJob(ACCOUNT, frozen).status, "interrupted");
    assert.equal(first.holdsKey(), true);
    const fresh = makeRunner(frozen.clone());
    assert.equal(fresh.holdsKey(), false);

    const needsKey = await fresh.resume();
    assert.equal(needsKey.status, "interrupted");
    assert.equal(needsKey.needs, "key");
    assert.equal(sends.length, 3);

    const withKey = makeRunner(frozen.clone());
    const needsFile = await withKey.resume({ submitKey: secret });
    assert.equal(needsFile.needs, "file");
    assert.equal(withKey.holdsKey(), true);
    assert.equal(sends.length, 3);

    const wrongKey = await PrivateKey.generateED25519Async();
    remember(wrongKey);
    const rejected = await makeRunner(frozen.clone()).resume({ submitKey: wrongKey.toString(), file: picked });
    assert.equal(rejected.status, "interrupted");
    assert.equal(rejected.needs, "key");
    assert.equal(rejected.reason, "That key does not match this inscription");
    assert.equal(sends.length, 3);
    assert.equal(creates.filter((row) => row.kind === "file").length, 1);

    prepareBehavior = "wrong";
    prepareCalls.length = 0;
    const wrongFile = await makeRunner(frozen.clone()).resume({ submitKey: secret, file: picked });
    assert.equal(wrongFile.needs, "file");
    assert.equal(wrongFile.reason, "This is not the file that was inscribed");
    assert.deepEqual(prepareCalls.map((call) => call.asIs), [false, true]);
    assert.equal(sends.length, 3);
    prepareBehavior = "same";

    const topic = topics.get(fileId);
    const kept = topic.messages[1];
    const parsed = JSON.parse(kept);
    parsed.c = `${parsed.c.slice(0, -1)}${parsed.c.endsWith("Q") ? "Z" : "Q"}`;
    topic.messages[1] = JSON.stringify(parsed);
    const conflict = await makeRunner(frozen.clone()).resume({ submitKey: secret, file: picked });
    assert.equal(conflict.status, "lost");
    assert.equal(conflict.reason, "The topic has an unexpected message");
    assert.equal(sends.length, 3);
    topic.messages[1] = kept;
    restoreMirror(mirror);

    prepareBehavior = "recompress";
    prepareCalls.length = 0;
    const before = sends.length;
    const resumedRunner = makeRunner(frozen.clone());
    const resumed = await resumedRunner.resume({ submitKey: secret, file: picked });
    assert.deepEqual(prepareCalls.map((call) => call.asIs), [false, true]);
    assert.equal(resumed.status, "done");
    assert.equal(resumedRunner.holdsKey(), false);
    const added = sends.slice(before).filter((row) => row.topicId === fileId).map((row) => row.message);
    assert.deepEqual(added, prepared.built.messages.slice(3));
    assert.equal(creates.filter((row) => row.kind === "file").length, 1);
    assert.equal(own.toString(), secret);
    assert.equal(makeRunner(frozen.clone()).holdsKey(), false);

    const err = await expectThrow(() => first.start(startInput({ prepared, keyMode: "own", submitKey: own })));
    assert.equal(err.message, "Finish or dismiss the unfinished Hashinal first");
    assert.equal(err.userFacing, true);
  });

  test("an own key resumes a cut-off metadata topic without resending the file", async () => {
    resetRun();
    const own = await PrivateKey.generateED25519Async();
    remember(own);
    const attributes = longAttributes();
    const prepared = await filePrepared(256);
    const { frozen } = await runUntilCut(startInput({
      prepared, attributes, keyMode: "own", submitKey: own,
    }), "meta");
    const fileId = creates.find((row) => row.kind === "file").id;
    const metaId = creates.find((row) => row.kind === "meta").id;
    const json = buildHashinalMetadata({
      name: NAME,
      description: DESCRIPTION,
      creator: CREATOR,
      attributes,
      mime: "image/png",
      fileTopicId: fileId,
    });
    const built = await buildHcs1Inscription(new TextEncoder().encode(json), "application/json");
    assert.ok(built.messages.length > 3);
    assert.deepEqual(topics.get(metaId).messages, built.messages.slice(0, 3));
    const createCount = creates.length;
    const fileCount = fileSends(fileId).length;
    const done = await makeRunner(frozen.clone()).resume({ submitKey: own.toString() });
    assert.equal(done.status, "done");
    assert.equal(creates.length, createCount);
    assert.equal(fileSends(fileId).length, fileCount);
    assert.deepEqual(fileSends(metaId).map((row) => row.message), built.messages);
    assert.equal(own.toString(), own.toString());
  });

  test("a memory-mode file that was cut off is lost and nothing is sent", async () => {
    resetRun();
    const prepared = await filePrepared(8 * 1024);
    const { frozen } = await runUntilCut(startInput({ prepared, keyMode: "memory" }), "file");
    assert.equal(loadHashinalJob(ACCOUNT, frozen).status, "interrupted");
    const storage = frozen.clone();
    const runner = makeRunner(storage);
    const beforeSends = sends.length;
    const beforeCreates = creates.length;
    const lost = await runner.resume();
    assert.equal(lost.status, "lost");
    assert.equal(lost.reason, "That inscription was cut off and its key is gone");
    assert.equal(lost.topics.file, null);
    assert.equal(runner.holdsKey(), false);
    assert.equal(sends.length, beforeSends);
    assert.equal(creates.length, beforeCreates);
    const saved = JSON.parse(storage.getItem(JOB_KEY));
    assert.equal(saved.topics.file, null);
    assert.equal(saved.status, "lost");
    const idle = runner.dismiss();
    assert.equal(idle.status, "idle");
    assert.equal(storage.getItem(JOB_KEY), null);
  });

  test("a finished memory-mode file is reused when its metadata topic was cut off", async () => {
    resetRun();
    const prepared = await filePrepared(256);
    const attributes = longAttributes();
    const { frozen } = await runUntilCut(startInput({ prepared, attributes, keyMode: "memory" }), "meta");
    const fileId = creates.find((row) => row.kind === "file").id;
    const metaId = creates.find((row) => row.kind === "meta").id;
    const fileCount = fileSends(fileId).length;
    const oldMeta = fileSends(metaId).length;
    const done = await makeRunner(frozen.clone()).resume();
    assert.equal(done.status, "done");
    assert.equal(creates.filter((row) => row.kind === "file").length, 1);
    assert.equal(creates.filter((row) => row.kind === "meta").length, 2);
    assert.notEqual(creates.filter((row) => row.kind === "meta")[1].id, metaId);
    assert.equal(fileSends(fileId).length, fileCount);
    assert.equal(fileSends(metaId).length, oldMeta);
    assert.ok(jsonBodies.at(-1).includes(`hcs://1/${fileId}`));
  });

  test("a closed tab after the in-flight mint checks the mirror and forceRemint mints once", async () => {
    resetRun();
    mintMode = "stop";
    const storage = makeStorage();
    let frozen = null;
    const runner = makeRunner(storage);
    runner.on("progress", (event) => {
      if (event.step === "mint" && event.sent === 0 && !frozen) frozen = storage.clone();
    });
    const prepared = await filePrepared(256);
    activePrepared = prepared;
    const live = await runner.start(startInput({ prepared, keyMode: "memory" }));
    assert.ok(frozen);
    assert.equal(live.status, "paused");
    const raw = JSON.parse(frozen.getItem(JOB_KEY));
    assert.equal(raw.status, "running");
    assert.equal(raw.mint.inflight, true);
    assert.equal(loadHashinalJob(ACCOUNT, frozen).status, "unconfirmed");
    const metaId = raw.topics.meta.topicId;
    const before = mintCalls.length;

    metaFound = ["9"];
    const found = await makeRunner(frozen.clone()).check();
    assert.equal(found.status, "done");
    assert.equal(found.result.serial, "9");
    assert.equal(mintCalls.length, before);
    assert.equal(metaLooks.at(-1).metadata, `hcs://1/${metaId}`);
    assert.equal(metaLooks.at(-1).account, ACCOUNT);

    metaFound = null;
    const missed = await makeRunner(frozen.clone()).check();
    assert.equal(missed.status, "unconfirmed");
    assert.equal(mintCalls.length, before);

    mintMode = "ok";
    const forcedRunner = makeRunner(frozen.clone());
    const forced = await forcedRunner.forceRemint();
    assert.equal(forced.status, "done");
    assert.equal(mintCalls.length, before + 1);
    assert.deepEqual(mintCalls.at(-1).metadata, [`hcs://1/${metaId}`]);
    await forcedRunner.forceRemint();
    assert.equal(mintCalls.length, before + 1);
  });

  test("a failed mint is tried once more, and any other mint error is not resent", async () => {
    resetRun();
    const prepared = await filePrepared(256);
    activePrepared = prepared;
    mintMode = "failed";
    const failedRunner = makeRunner(makeStorage());
    const failed = await failedRunner.start(startInput({ prepared, keyMode: "memory" }));
    assert.equal(failed.status, "paused");
    assert.equal(failed.step, "mint");
    assert.equal(failed.reason, "The mint failed on Hedera. Nothing was minted.");
    mintMode = "ok";
    txLook = () => ({ status: "failed" });
    const minted = await failedRunner.resume();
    assert.equal(minted.status, "done");
    assert.equal(mintCalls.filter((call) => call.mode === "ok").length, 1);
    assert.equal(mintCalls.filter((call) => call.mode === "failed").length, 1);

    resetRun();
    activePrepared = prepared;
    mintMode = "unconfirmed";
    const heldRunner = makeRunner(makeStorage());
    const held = await heldRunner.start(startInput({ prepared, keyMode: "memory" }));
    assert.equal(held.status, "unconfirmed");
    const before = mintCalls.length;
    mintMode = "ok";
    const again = await heldRunner.resume();
    assert.equal(again.status, "unconfirmed");
    assert.equal(mintCalls.length, before);
    const checked = await heldRunner.check();
    assert.equal(checked.status, "unconfirmed");
    assert.equal(mintCalls.length, before);
  });

  test("a wallet rejection pauses and keeps the topics", async () => {
    resetRun();
    const prepared = await filePrepared(256);
    activePrepared = prepared;
    mintMode = "decline";
    const runner = makeRunner(makeStorage());
    const paused = await runner.start(startInput({ prepared, keyMode: "memory" }));
    assert.equal(paused.status, "paused");
    assert.equal(paused.reason, "Wallet declined");
    assert.ok(paused.topics.file && paused.topics.meta);
    mintMode = "ok";
    const before = mintCalls.length;
    const done = await runner.resume();
    assert.equal(done.status, "done");
    assert.equal(mintCalls.length, before + 1);
  });

  test("a saved job, the wrong account, a failed preflight, and the 2 MB cap send nothing", async () => {
    resetRun();
    const storage = makeStorage();
    storage.setItem(JOB_KEY, JSON.stringify({
      v: 1,
      accountId: ACCOUNT,
      tokenId: TOKEN,
      keyMode: "memory",
      form: { name: NAME, description: "", creator: "", attributes: [] },
      file: { name: "pic.png", mime: "image/png", size: 4 },
      topics: { file: null, meta: null },
      mint: { inflight: false, txIds: [], minted: null },
      step: "file",
      status: "paused",
      reason: "",
      createdAt: 1,
    }));
    const prepared = await filePrepared(64);
    const blocked = await expectThrow(() => makeRunner(storage).start(startInput({ prepared })));
    assert.equal(blocked.message, "Finish or dismiss the unfinished Hashinal first");
    assert.equal(blocked.userFacing, true);
    assert.equal(creates.length, 0);

    const other = makeStorage();
    other.setItem("w3g-hashinal:0.0.1002", JSON.stringify({
      v: 1,
      accountId: ACCOUNT,
      tokenId: TOKEN,
      keyMode: "own",
      form: { name: NAME, description: "", creator: "", attributes: [] },
      file: { name: "pic.png", mime: "image/png", size: 4 },
      topics: { file: null, meta: null },
      mint: { inflight: false, txIds: [], minted: null },
      step: "file",
      status: "paused",
      reason: "",
      createdAt: 1,
    }));
    const mismatch = await expectThrow(() => makeRunner(other, { accountId: "0.0.1002" }).resume());
    assert.equal(mismatch.message, "This Hashinal belongs to another account");
    assert.equal(creates.length, 0);

    let preflighted = false;
    const refused = await expectThrow(() => makeRunner(makeStorage(), {
      preflight: async () => {
        preflighted = true;
        return { ok: false, reason: "This collection is full" };
      },
    }).start(startInput({ prepared })));
    assert.equal(refused.message, "This collection is full");
    assert.equal(refused.userFacing, true);
    assert.equal(preflighted, true);
    assert.equal(creates.length, 0);

    preflighted = false;
    const cap = await expectThrow(() => makeRunner(makeStorage(), {
      preflight: async () => {
        preflighted = true;
        return { ok: true, remaining: "1" };
      },
    }).start(startInput({
      prepared: {
        bytes: { byteLength: 2 * 1024 * 1024 + 1 },
        mime: "image/png",
        name: "big.png",
        overCap: false,
      },
    })));
    assert.equal(cap.message, "file is over 2 MB");
    assert.equal(cap.userFacing, undefined);
    assert.equal(preflighted, false);
    assert.equal(creates.length, 0);

    const missing = await expectThrow(() => makeRunner(makeStorage()).start(startInput({
      prepared, keyMode: "own",
    })));
    assert.equal(missing.message, "That is not a private key we can read");
    assert.equal(creates.length, 0);
  });

  test("a quota error warns once and the mint still finishes", async () => {
    resetRun();
    const storage = makeStorage();
    storage.setItem = () => { throw new Error("quota"); };
    const prepared = await filePrepared(256);
    activePrepared = prepared;
    const runner = makeRunner(storage);
    const warnings = [];
    runner.on("warning", (event) => warnings.push(event));
    const done = await runner.start(startInput({ prepared, keyMode: "memory" }));
    assert.equal(done.status, "done");
    assert.deepEqual(warnings, [{ message: "Could not save mint progress in this browser" }]);
    assert.ok(creates.length >= 2);
  });

  test("a saved job never contains a key, in memory mode or with an own key", async () => {
    resetRun();
    const logAt = logs.length;
    const eventAt = events.length;
    const prepared = await filePrepared(256);
    activePrepared = prepared;
    const memoryStorage = makeStorage();
    const memoryRunner = makeRunner(memoryStorage);
    const memoryDone = await memoryRunner.start(startInput({ prepared, keyMode: "memory" }));
    assert.equal(memoryDone.status, "done");
    assert.equal(memoryRunner.holdsKey(), false);
    for (const text of memoryStorage.saved) {
      assert.equal(Object.hasOwn(JSON.parse(text), "publicKey"), false);
      assert.equal(JSON.parse(text).keyMode, "memory");
    }

    const own = await PrivateKey.generateED25519Async();
    remember(own);
    const ownStorage = makeStorage();
    activePrepared = prepared;
    const ownRunner = makeRunner(ownStorage);
    const ownDone = await ownRunner.start(startInput({
      prepared, keyMode: "own", submitKey: own,
    }));
    assert.equal(ownDone.status, "done");
    assert.equal(ownRunner.holdsKey(), false);
    assert.equal(own.toString(), own.toString());
    assert.ok(ownStorage.saved.some((text) => JSON.parse(text).publicKey === own.publicKey.toString()));
    assert.equal(ownStorage.getItem(JOB_KEY), null);

    const parts = [...logs.slice(logAt), ...events.slice(eventAt)];
    for (const storage of [memoryStorage, ownStorage]) parts.push(...storage.saved);
    assertClean(parts);
    assert.equal(own.toString().length > 0, true);
    assert.equal(parts.some((part) => String(part).includes(own.toString())), false);
  });

  test("no save, event, error, or console line holds a private key", () => {
    const parts = [...logs, ...errors, ...events];
    for (const storage of storages) {
      if (storage.skipScan) continue;
      parts.push(...storage.saved);
    }
    assertClean(parts);
  });
});
