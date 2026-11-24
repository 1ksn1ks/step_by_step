// Hashinal mint with the wallet inscriber and token mint stood in for.
// No network. The HCS-1 builder stays real when the bytes are priced, and
// a recording wrapper keeps the JSON those calls received.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const storageHits = [];

function storageStub(label) {
  return {
    getItem(key) {
      storageHits.push([label, "getItem", key]);
      return null;
    },
    setItem(key, value) {
      storageHits.push([label, "setItem", key, String(value)]);
    },
    removeItem(key) {
      storageHits.push([label, "removeItem", key]);
    },
    clear() {
      storageHits.push([label, "clear"]);
    },
    key() {
      storageHits.push([label, "key"]);
      return null;
    },
    get length() {
      storageHits.push([label, "length"]);
      return 0;
    },
  };
}

globalThis.localStorage = storageStub("local");
globalThis.sessionStorage = storageStub("session");
globalThis.indexedDB = {
  open() {
    storageHits.push(["idb", "open"]);
    throw new Error("indexedDB.open");
  },
};

const prepares = [];
const inscribes = [];
const mints = [];
const builds = [];
const order = [];

let nextCreate = 0;
let seenCalls = 0;
let failOnCall = 0;
let mintMode = "ok";

function reset() {
  prepares.length = 0;
  inscribes.length = 0;
  mints.length = 0;
  builds.length = 0;
  order.length = 0;
  storageHits.length = 0;
  nextCreate = 0;
  seenCalls = 0;
  failOnCall = 0;
  mintMode = "ok";
}

function assertNoStorage() {
  assert.deepEqual(storageHits, []);
}

async function prepareInscribeFile(file) {
  prepares.push(file);
  return {
    bytes: new Uint8Array([1, 2, 3]),
    mime: file && file.type ? file.type : "image/png",
    name: "pic.png",
    overCap: false,
    txCount: 4,
    usd: 0.0124,
  };
}

async function inscribePrepared(prepared, opts = {}) {
  const resume = opts && opts.resume;
  let topicId;
  let created = false;
  if (resume && resume.topicId) {
    topicId = resume.topicId;
  } else {
    created = true;
    topicId = nextCreate === 0 ? "0.0.501" : nextCreate === 1 ? "0.0.502" : `0.0.${503 + (nextCreate - 2)}`;
    nextCreate += 1;
  }
  seenCalls += 1;
  inscribes.push({
    prepared,
    topicId,
    created,
    resumeTopicId: resume && resume.topicId,
    resumeKey: resume && resume.submitKey,
  });
  order.push(prepared && prepared.mime === "application/json" ? "meta" : "file");
  if (seenCalls === failOnCall) {
    failOnCall = 0;
    const err = new Error("submit failed");
    err.topicId = topicId;
    err.submitKey = { secret: `key-${topicId}` };
    err.sentIndexes = [0];
    throw err;
  }
  if (typeof opts.onProgress === "function") {
    await opts.onProgress({ sent: 1, total: 2, topicId });
  }
  if (resume && typeof resume === "object") resume.submitKey = null;
  return { topicId, hrl: `hcs://1/${topicId}`, sha256: "abc", total: 2 };
}

async function mintNfts(tokenId, metadataList) {
  mints.push({ tokenId, metadataList: metadataList.slice() });
  order.push("mint");
  if (mintMode === "fail") {
    mintMode = "ok";
    const err = new Error("mint rejected");
    err.userFacing = true;
    throw err;
  }
  if (mintMode === "fail-tx") {
    mintMode = "ok";
    const err = new Error("receipt missing");
    err.txIds = ["0.0.1001@9.1"];
    throw err;
  }
  return {
    tokenId,
    tokenUrl: `https://hashscan.io/mainnet/token/${tokenId}`,
    txId: "0.0.1001@1.0",
    hashscanUrl: "https://hashscan.io/mainnet/transaction/0.0.1001@1.0",
    serials: ["1"],
    txIds: ["0.0.1001@1.0"],
  };
}

const HCS1_INSCRIBE_MAX_BYTES = 2 * 1024 * 1024;

function estimateHcs1Cost(messageCount) {
  const count = Number(messageCount) || 0;
  return { txCount: count + 1, usd: 0.01 + count * 0.0008 };
}

async function buildHcs1Inscription(bytes, mime, limits) {
  const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  builds.push({ bytes: copy, mime });
  const real = await import("../hcs1inscribe.js?hashinal-real");
  return real.buildHcs1Inscription(copy, mime, limits);
}

mock.module("../hcs1inscribe.js", {
  exports: {
    HCS1_INSCRIBE_MAX_BYTES,
    estimateHcs1Cost,
    buildHcs1Inscription,
  },
});

mock.module("../hcs1inscribewallet.js", {
  exports: {
    prepareInscribeFile,
    inscribePrepared,
  },
});

mock.module("../tokenmint.js", {
  exports: {
    mintNfts,
  },
});

const {
  MINT_NFT_USD,
  buildHashinalMetadata,
  estimateHashinalMint,
  prepareHashinal,
  runHashinalMint,
} = await import("../hashinalmint.js");

function basePrepared(mime = "image/png") {
  return {
    bytes: new Uint8Array([9, 9, 9]),
    mime,
    name: "pic.bin",
    overCap: false,
    txCount: 4,
    usd: 0.0124,
  };
}

function args(prepared, extra = {}) {
  return {
    prepared,
    tokenId: "0.0.4242",
    name: "Pixel",
    description: "A small picture",
    creator: "ada",
    attributes: [
      { trait_type: "Color", value: "blue" },
      { trait_type: " ", value: "dropped" },
      { trait_type: "Skip", value: "" },
      { trait_type: "Count", value: 2 },
    ],
    ...extra,
  };
}

function metaText(call) {
  return new TextDecoder().decode(call.prepared.bytes);
}

test("a mint inscribes the file, then the metadata, then one NFT", async () => {
  reset();
  const prepared = basePrepared();
  const progress = [];
  const result = await runHashinalMint({
    ...args(prepared),
    onProgress(event) {
      progress.push(event);
    },
  });
  assert.deepEqual(order, ["file", "meta", "mint"]);
  assert.equal(prepares.length, 0);
  assert.equal(inscribes[0].prepared, prepared);
  assert.equal(inscribes[0].topicId, "0.0.501");
  assert.equal(inscribes[1].topicId, "0.0.502");
  assert.equal(inscribes[1].prepared.mime, "application/json");
  assert.equal(inscribes[1].prepared.name, "metadata.json");
  assert.equal(inscribes[1].prepared.overCap, false);
  const doc = JSON.parse(metaText(inscribes[1]));
  assert.equal(metaText(inscribes[1]), JSON.stringify({
    format: "HIP412@2.0.0",
    name: "Pixel",
    description: "A small picture",
    creator: "ada",
    image: "hcs://1/0.0.501",
    type: "image/png",
    attributes: [
      { trait_type: "Color", value: "blue" },
      { trait_type: "Count", value: 2 },
    ],
  }));
  assert.equal(Object.hasOwn(doc, "files"), false);
  assert.deepEqual(mints[0], {
    tokenId: "0.0.4242",
    metadataList: ["hcs://1/0.0.502"],
  });
  assert.deepEqual(progress.map((event) => event.step), ["file", "meta", "mint", "mint"]);
  assert.deepEqual(progress[2], { step: "mint", sent: 0, total: 1 });
  assert.deepEqual(progress[3], { step: "mint", sent: 1, total: 1 });
  assert.equal(result.serial, "1");
  assert.equal(result.tokenId, "0.0.4242");
  assert.equal(result.fileTopicId, "0.0.501");
  assert.equal(result.metaTopicId, "0.0.502");
  assert.equal(result.fileHrl, "hcs://1/0.0.501");
  assert.equal(result.metaHrl, "hcs://1/0.0.502");
  assert.equal(result.txId, "0.0.1001@1.0");
  assert.equal(result.hashscanUrl, "https://hashscan.io/mainnet/transaction/0.0.1001@1.0");
  assert.equal(result.tokenUrl, "https://hashscan.io/mainnet/token/0.0.4242");
  assertNoStorage();
});

test("a non-image file adds a files entry that points at the same topic", async () => {
  reset();
  const prepared = basePrepared("video/mp4");
  await runHashinalMint(args(prepared, { name: "Clip", description: "", creator: "" }));
  const doc = JSON.parse(metaText(inscribes[1]));
  assert.equal(doc.type, "video/mp4");
  assert.equal(doc.image, "hcs://1/0.0.501");
  assert.deepEqual(doc.files, [{ uri: "hcs://1/0.0.501", type: "video/mp4" }]);
  assert.equal(Object.hasOwn(doc, "description"), false);
  assert.equal(Object.hasOwn(doc, "creator"), false);
  const direct = JSON.parse(buildHashinalMetadata({
    name: "Clip",
    mime: "video/mp4",
    fileTopicId: "0.0.501",
  }));
  assert.deepEqual(direct.files, doc.files);
});

test("a file failure resumes the same prepared bytes and does not open another topic", async () => {
  reset();
  const prepared = basePrepared();
  failOnCall = 1;
  const thrown = await runHashinalMint(args(prepared)).then(() => {
    throw new Error("expected the file step to fail");
  }, (err) => err);
  assert.equal(thrown.step, "file");
  assert.equal(thrown.message, "submit failed");
  assert.equal(thrown.resume.fileTopicId, undefined);
  assert.equal(thrown.resume.file.topicId, "0.0.501");
  assert.deepEqual(thrown.resume.file.sentIndexes, [0]);
  assert.ok(thrown.resume.file.submitKey);
  assert.equal(inscribes.length, 1);
  assert.equal(inscribes[0].created, true);
  const key = thrown.resume.file.submitKey;
  const result = await runHashinalMint({ ...args(prepared), resume: thrown.resume });
  assert.equal(inscribes[1].prepared, prepared);
  assert.equal(inscribes[1].created, false);
  assert.equal(inscribes[1].resumeTopicId, "0.0.501");
  assert.equal(inscribes[1].resumeKey, key);
  assert.equal(inscribes.filter((call) => call.created).length, 2);
  assert.equal(result.fileTopicId, "0.0.501");
  assert.equal(result.metaTopicId, "0.0.502");
  assert.equal(thrown.resume.file.submitKey, null);
  assertNoStorage();
});

test("a metadata failure resumes the same metadata bytes and skips the file", async () => {
  reset();
  const prepared = basePrepared();
  failOnCall = 2;
  const thrown = await runHashinalMint(args(prepared)).then(() => {
    throw new Error("expected the metadata step to fail");
  }, (err) => err);
  assert.equal(thrown.step, "meta");
  assert.equal(thrown.resume.fileTopicId, "0.0.501");
  assert.equal(thrown.resume.metaTopicId, undefined);
  assert.equal(thrown.resume.meta.topicId, "0.0.502");
  const metaPrepared = thrown.resume.metaPrepared;
  assert.equal(metaPrepared.mime, "application/json");
  const bytes = metaPrepared.bytes;
  const result = await runHashinalMint({ ...args(prepared), resume: thrown.resume });
  assert.equal(inscribes.length, 3);
  assert.equal(inscribes.filter((call) => call.prepared === prepared).length, 1);
  assert.equal(inscribes[2].prepared, metaPrepared);
  assert.equal(inscribes[2].prepared.bytes, bytes);
  assert.equal(inscribes[2].created, false);
  assert.equal(inscribes[2].resumeTopicId, "0.0.502");
  assert.equal(inscribes.filter((call) => call.created).length, 2);
  assert.equal(result.fileTopicId, "0.0.501");
  assert.equal(result.metaTopicId, "0.0.502");
  assert.equal(thrown.resume.meta.submitKey, null);
  assertNoStorage();
});

test("a mint failure resumes without inscribing again", async () => {
  reset();
  const prepared = basePrepared();
  mintMode = "fail";
  const thrown = await runHashinalMint(args(prepared)).then(() => {
    throw new Error("expected the mint to fail");
  }, (err) => err);
  assert.equal(thrown.step, "mint");
  assert.equal(thrown.userFacing, true);
  assert.equal(thrown.message, "mint rejected");
  assert.equal(thrown.mintMaybeSent, undefined);
  assert.equal(thrown.resume.minted, undefined);
  assert.equal(thrown.resume.fileTopicId, "0.0.501");
  assert.equal(thrown.resume.metaTopicId, "0.0.502");
  const inscribed = inscribes.length;
  const result = await runHashinalMint({ ...args(prepared), resume: thrown.resume });
  assert.equal(inscribes.length, inscribed);
  assert.equal(mints.length, 2);
  assert.deepEqual(mints[1].metadataList, ["hcs://1/0.0.502"]);
  assert.equal(result.serial, "1");
  assertNoStorage();
});

test("a mint that already sent a transaction is marked and is not minted twice in that attempt", async () => {
  reset();
  const prepared = basePrepared();
  mintMode = "fail-tx";
  const thrown = await runHashinalMint(args(prepared)).then(() => {
    throw new Error("expected the mint to fail");
  }, (err) => err);
  assert.equal(thrown.step, "mint");
  assert.equal(thrown.mintMaybeSent, true);
  assert.deepEqual(thrown.txIds, ["0.0.1001@9.1"]);
  assert.notEqual(thrown.resume.minted, true);
  assert.equal(mints.length, 1);
  const inscribed = inscribes.length;
  const result = await runHashinalMint({ ...args(prepared), resume: thrown.resume });
  assert.equal(inscribes.length, inscribed);
  assert.equal(mints.length, 2);
  assert.equal(result.serial, "1");
  assertNoStorage();
});

test("a bad token id or an empty name throws before any inscription", async () => {
  for (const tokenId of ["1.0.5", "0.0.x", ""]) {
    reset();
    const err = await runHashinalMint(args(basePrepared(), { tokenId })).then(() => {
      throw new Error(`expected ${tokenId} to fail`);
    }, (caught) => caught);
    assert.equal(err.userFacing, true);
    assert.match(err.message, /token id/);
    assert.equal(inscribes.length, 0);
    assert.equal(mints.length, 0);
    assert.equal(builds.length, 0);
  }
  reset();
  const err = await runHashinalMint(args(basePrepared(), { name: "   " })).then(() => {
    throw new Error("expected an empty name to fail");
  }, (caught) => caught);
  assert.equal(err.userFacing, true);
  assert.match(err.message, /Name/);
  assert.equal(inscribes.length, 0);
  assert.equal(mints.length, 0);
  assertNoStorage();
});

test("estimate sums the file, the metadata, and one mint", async () => {
  reset();
  const prepared = { ...basePrepared(), txCount: 5, usd: 0.0132 };
  const quote = await estimateHashinalMint({
    prepared,
    name: "Pixel",
    description: "A small picture",
    creator: "ada",
    attributes: [{ trait_type: "Color", value: "blue" }],
  });
  assert.equal(MINT_NFT_USD, 0.02);
  assert.equal(builds.length, 1);
  assert.equal(builds[0].mime, "application/json");
  const doc = JSON.parse(new TextDecoder().decode(builds[0].bytes));
  assert.equal(doc.image, "hcs://1/0.0.9999999999");
  assert.equal(doc.format, "HIP412@2.0.0");
  assert.equal(doc.type, "image/png");
  assert.equal(quote.file.txCount, 5);
  assert.equal(quote.file.usd, 0.0132);
  assert.deepEqual(quote.mint, { txCount: 1, usd: MINT_NFT_USD });
  assert.equal(quote.meta.txCount, 2);
  assert.equal(quote.meta.usd, 0.01 + 0.0008);
  assert.equal(quote.total.approvals, 5 + quote.meta.txCount + 1);
  assert.equal(quote.total.usd, 0.0132 + quote.meta.usd + quote.mint.usd);
  assert.equal(inscribes.length, 0);
  assert.equal(mints.length, 0);
});

test("an over-cap file throws before an inscription or a price build", async () => {
  reset();
  const prepared = { overCap: true, bytes: new Uint8Array([1]), mime: "image/png", name: "big.png" };
  const estimateErr = await estimateHashinalMint({ prepared, name: "Pixel" }).then(() => {
    throw new Error("expected the estimate to fail");
  }, (err) => err);
  assert.equal(estimateErr.message, "file is over 2 MB");
  assert.equal(builds.length, 0);
  const runErr = await runHashinalMint(args(prepared)).then(() => {
    throw new Error("expected the mint to fail");
  }, (err) => err);
  assert.equal(runErr.message, "file is over 2 MB");
  assert.equal(inscribes.length, 0);
  assert.equal(mints.length, 0);
  assert.equal(builds.length, 0);
});

test("prepareHashinal reads the file once", async () => {
  reset();
  const file = { name: "a.png", type: "image/png" };
  const prepared = await prepareHashinal(file);
  assert.equal(prepares.length, 1);
  assert.equal(prepares[0], file);
  assert.equal(prepared.mime, "image/png");
  assert.equal(prepared.overCap, false);
  await runHashinalMint(args(prepared));
  assert.equal(prepares.length, 1);
});

test("submit keys are cleared after success and storage is never touched", async () => {
  reset();
  const resume = {
    fileTopicId: "0.0.501",
    metaTopicId: "0.0.502",
    file: { topicId: "0.0.501", submitKey: { secret: "file" }, sentIndexes: [0] },
    meta: { topicId: "0.0.502", submitKey: { secret: "meta" }, sentIndexes: [0, 1] },
  };
  const result = await runHashinalMint({ ...args(basePrepared()), resume });
  assert.equal(inscribes.length, 0);
  assert.equal(mints.length, 1);
  assert.equal(resume.file.submitKey, null);
  assert.equal(resume.meta.submitKey, null);
  assert.equal(result.serial, "1");
  assert.equal(result.fileHrl, "hcs://1/0.0.501");
  assert.equal(result.metaHrl, "hcs://1/0.0.502");
  assertNoStorage();
});

test("the module keeps the submit key in memory and imports only the three steps", () => {
  const source = fs.readFileSync(new URL("../hashinalmint.js", import.meta.url), "utf8");
  assert.equal(/\b(localStorage|sessionStorage|indexedDB)\s*[.\[]/.test(source), false);
  assert.equal(/processallmessages|feedlayout|toast\.js|hcs1inscribenotice|from "\.\/web3\.js"|from "\.\/hedera\.js"/.test(source), false);
  assert.match(source, /from "\.\/hcs1inscribewallet\.js"/);
  assert.match(source, /from "\.\/hcs1inscribe\.js"/);
  assert.match(source, /from "\.\/tokenmint\.js"/);
  assert.equal((source.match(/^import\s/gm) || []).length, 3);
});
