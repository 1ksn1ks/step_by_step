// Batch NFT mint with tokenmint and the wallet stood in for. No network.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const ACCOUNT = "0.0.1001";
const TOKEN = "0.0.4242";
const KEY_LIKE = /privateKey|submitKey|secret|mnemonic|seed|signature|keystore/i;

let mintHandler = async () => {
  throw new Error("mint handler not set");
};
let txHandler = async () => ({ status: "unknown" });
let metaHandler = async () => ({ status: "unknown" });

async function mintNfts(tokenId, links) {
  return mintHandler(tokenId, links);
}

async function checkMintTx(txId, tokenId) {
  return txHandler(txId, tokenId);
}

async function checkMintByMetadata(tokenId, accountId, metadata) {
  return metaHandler(tokenId, accountId, metadata);
}

mock.module("../web3.js", {
  exports: {
    connectedAccount: ACCOUNT,
    signer: null,
    dAppConnector: null,
  },
});

mock.module("../tokenmint.js", {
  exports: {
    mintNfts,
    checkMintTx,
    checkMintByMetadata,
  },
});

const {
  parseLinkList,
  readCollectionSupply,
  jobKey,
  loadJob,
  saveJob,
  listSavedJobs,
  createBatchMinter,
} = await import("../nftbatch.js");

function makeLinks(count) {
  return Array.from({ length: count }, (_, index) => `ipfs://item-${index}`);
}

function makeStorage() {
  const map = new Map();
  const writes = [];
  const api = {
    fail: false,
    writes,
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    setItem(key, value) {
      if (api.fail) {
        const err = new Error("Setting the value exceeded the quota.");
        err.name = "QuotaExceededError";
        err.code = 22;
        throw err;
      }
      const text = String(value);
      map.set(String(key), text);
      writes.push(text);
    },
    removeItem(key) {
      map.delete(String(key));
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
  return api;
}

function okResult(tokenId, links, txId) {
  return {
    tokenId,
    txId,
    serials: links.map((_, index) => String(index + 1)),
    txIds: [txId],
    privateKey: "super-secret-key",
    submitKey: "submit-secret",
    mnemonic: "seed phrase",
  };
}

function maybeError(txId, message = "wallet timed out") {
  const err = new Error(message);
  err.maybeSentTxIds = [txId];
  return err;
}

function savedCursors(storage) {
  return storage.writes.map((text) => JSON.parse(text));
}

function create(overrides = {}) {
  const storage = overrides.storage || makeStorage();
  const tokenId = overrides.tokenId || TOKEN;
  const accountId = overrides.accountId === undefined ? ACCOUNT : overrides.accountId;
  const links = overrides.links || makeLinks(25);
  const minter = createBatchMinter({
    tokenId,
    links,
    accountId,
    storage,
    mint: (id, list) => mintHandler(id, list),
    checkTx: (txId, id) => txHandler(txId, id),
    checkMeta: (id, account, metadata) => metaHandler(id, account, metadata),
    readSupply: overrides.readSupply || (async () => ({
      maxSupply: "100000",
      totalSupply: "0",
      remaining: "100000",
      type: "NON_FUNGIBLE_UNIQUE",
      treasury: ACCOUNT,
    })),
    now: overrides.now || (() => 1700000000000),
  });
  return { minter, storage, tokenId, accountId, links };
}

async function waitFor(fn) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out");
}

test("parseLinkList reads text, csv, and json", () => {
  const text = parseLinkList("\nipfs://a\n  https://example.com/b  \nhcs://1/0.0.9\n", { kind: "text" });
  assert.deepEqual(text.links, ["ipfs://a", "https://example.com/b", "hcs://1/0.0.9"]);
  assert.deepEqual(text.bad, []);
  assert.equal(text.total, 3);

  const csv = parseLinkList([
    "metadata,name",
    "\"ipfs://abc\",one",
    "\"https://example.com/a\"",
  ].join("\n"), { kind: "csv" });
  assert.deepEqual(csv.links, ["ipfs://abc", "https://example.com/a"]);
  assert.equal(csv.bad.length, 0);
  assert.equal(csv.total, 2);

  const json = parseLinkList(JSON.stringify([
    "ipfs://a",
    { metadata: "https://b.example/x" },
    { uri: "hcs://1/0.0.9" },
    { url: "ipfs://c" },
  ]), { kind: "json" });
  assert.deepEqual(json.links, ["ipfs://a", "https://b.example/x", "hcs://1/0.0.9", "ipfs://c"]);
  assert.equal(json.bad.length, 0);
});

test("parseLinkList flags a bad prefix, a 101-byte link, and a kept duplicate", () => {
  const ok = `ipfs://${"a".repeat(93)}`;
  const over = `ipfs://${"a".repeat(94)}`;
  assert.equal(new TextEncoder().encode(ok).length, 100);
  assert.equal(new TextEncoder().encode(over).length, 101);
  const parsed = parseLinkList([
    "ipfs://same",
    "",
    "http://nope",
    "ipfs://same",
    over,
    ok,
  ].join("\n"), { kind: "text" });
  assert.deepEqual(parsed.links, ["ipfs://same", "ipfs://same", ok]);
  assert.equal(parsed.bad.length, 2);
  assert.equal(parsed.bad[0].line, 3);
  assert.equal(parsed.bad[0].reason, "Must start with ipfs://, https://, or hcs://1/");
  assert.equal(parsed.bad[1].line, 5);
  assert.equal(parsed.bad[1].reason, "Over 100 bytes");
  assert.deepEqual(parsed.duplicates, [{ line: 4, value: "ipfs://same", firstLine: 1 }]);
  assert.equal(parsed.total, 5);
});

test("parseLinkList rejects a non-list and a non-string", () => {
  const broken = parseLinkList("{", { kind: "json" });
  assert.equal(broken.links.length, 0);
  assert.equal(broken.bad.length, 1);
  assert.equal(broken.bad[0].reason, "Not a JSON list");
  assert.equal(broken.bad[0].line, 1);

  const object = parseLinkList("{\"a\":1}", { kind: "json" });
  assert.equal(object.bad[0].reason, "Not a JSON list");

  const mixed = parseLinkList(JSON.stringify([1, "ipfs://ok"]), { kind: "json" });
  assert.deepEqual(mixed.links, ["ipfs://ok"]);
  assert.equal(mixed.bad[0].line, 1);
  assert.equal(mixed.bad[0].reason, "Not a string");
  assert.equal(mixed.bad[0].value, 1);
});

test("parseLinkList handles 100000 lines quickly", () => {
  const parts = new Array(100000);
  for (let index = 0; index < 100000; index++) parts[index] = `ipfs://b/${index}`;
  parts.push(parts[0]);
  const text = parts.join("\n");
  const started = performance.now();
  const parsed = parseLinkList(text, { kind: "text" });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `parse took ${elapsed}ms`);
  assert.equal(parsed.links.length, 100001);
  assert.equal(parsed.duplicates.length, 1);
  assert.equal(parsed.duplicates[0].firstLine, 1);
  assert.equal(parsed.duplicates[0].line, 100001);
  assert.equal(parsed.bad.length, 0);
});

test("readCollectionSupply returns remaining, null for infinite, and rejects a fungible token", async () => {
  const seen = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    const id = String(url).split("/").pop();
    if (id === "missing") return { ok: false, status: 404, async json() { return {}; } };
    if (id === "0.0.8") {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            type: "FUNGIBLE_COMMON",
            supply_type: "FINITE",
            max_supply: "100",
            total_supply: "1",
            treasury_account_id: ACCOUNT,
          };
        },
      };
    }
    if (id === "0.0.9") {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            type: "NON_FUNGIBLE_UNIQUE",
            supply_type: "INFINITE",
            max_supply: "0",
            total_supply: "5",
            treasury_account_id: ACCOUNT,
          };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          type: "NON_FUNGIBLE_UNIQUE",
          supply_type: "FINITE",
          max_supply: "9007199254740993",
          total_supply: "1",
          treasury_account_id: ACCOUNT,
        };
      },
    };
  };
  try {
    const finite = await readCollectionSupply("0.0.7");
    assert.equal(finite.maxSupply, "9007199254740993");
    assert.equal(finite.totalSupply, "1");
    assert.equal(finite.remaining, "9007199254740992");
    assert.equal(finite.type, "NON_FUNGIBLE_UNIQUE");
    assert.equal(finite.treasury, ACCOUNT);
    assert.equal(seen[0].url, "https://mainnet.mirrornode.hedera.com/api/v1/tokens/0.0.7");
    assert.ok(seen[0].init.signal);

    const infinite = await readCollectionSupply("0.0.9");
    assert.equal(infinite.remaining, null);
    assert.equal(infinite.totalSupply, "5");
    assert.equal(infinite.maxSupply, "0");

    await assert.rejects(readCollectionSupply("0.0.8"), /This token is not an NFT collection/);
    await assert.rejects(readCollectionSupply("missing"), /Could not read the collection/);
  } finally {
    globalThis.fetch = previous;
  }
});

test("25 links mint as 10, 10, and 5, then the saved job is deleted", async () => {
  const calls = [];
  mintHandler = async (tokenId, links) => {
    calls.push(links.slice());
    return okResult(tokenId, links, `0.0.1001@${calls.length}.0`);
  };
  const progress = [];
  const batches = [];
  const done = [];
  const { minter, storage } = create();
  minter.on("progress", (event) => progress.push(event));
  minter.on("batch", (event) => batches.push(event));
  minter.on("done", (event) => done.push(event));
  await minter.start();
  assert.deepEqual(calls.map((chunk) => chunk.length), [10, 10, 5]);
  assert.equal(progress.length, 3);
  assert.deepEqual(progress.map((event) => event.minted), [10, 20, 25]);
  assert.deepEqual(progress.map((event) => event.cursor), [10, 20, 25]);
  assert.deepEqual(progress.map((event) => event.txDone), [1, 2, 3]);
  assert.equal(progress[0].total, 25);
  assert.equal(progress[0].txCount, 3);
  assert.deepEqual(batches.map((event) => [event.from, event.to]), [[0, 10], [10, 20], [20, 25]]);
  assert.equal(done.length, 1);
  assert.equal(done[0].serials.length, 25);
  assert.equal(done[0].txIds.length, 3);
  assert.equal(minter.state().status, "done");
  const cursors = savedCursors(storage).filter((job) => job.inflight == null).map((job) => job.cursor);
  assert.ok(cursors.includes(10));
  assert.ok(cursors.includes(20));
  assert.ok(cursors.includes(25));
  assert.equal(storage.getItem(jobKey(ACCOUNT, TOKEN)), null);
  for (const text of storage.writes) assert.equal(KEY_LIKE.test(text), false);
  assert.equal(KEY_LIKE.test(JSON.stringify(minter.state())), false);
});

test("pause finishes the in-flight batch and resume continues from the cursor", async () => {
  const calls = [];
  const { minter, storage } = create();
  mintHandler = async (tokenId, links) => {
    calls.push(links.slice());
    if (calls.length === 1) minter.pause();
    return okResult(tokenId, links, `0.0.1001@${calls.length}.0`);
  };
  await minter.start();
  assert.equal(calls.length, 1);
  assert.equal(minter.state().status, "paused");
  assert.equal(minter.state().cursor, 10);
  const paused = loadJob(ACCOUNT, TOKEN, storage);
  assert.equal(paused.status, "paused");
  assert.equal(paused.cursor, 10);
  await minter.resume();
  assert.deepEqual(calls.map((chunk) => chunk.length), [10, 10, 5]);
  assert.equal(minter.state().status, "done");
  assert.equal(calls[1][0], "ipfs://item-10");
});

test("stop keeps the saved job and discard deletes it", async () => {
  const calls = [];
  const { minter, storage } = create();
  mintHandler = async (tokenId, links) => {
    calls.push(links.slice());
    if (calls.length === 1) minter.stop();
    return okResult(tokenId, links, `0.0.1001@${calls.length}.0`);
  };
  await minter.start();
  assert.equal(minter.state().status, "stopped");
  assert.equal(minter.state().cursor, 10);
  assert.ok(storage.getItem(jobKey(ACCOUNT, TOKEN)));
  const stopped = loadJob(ACCOUNT, TOKEN, storage);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.links.length, 25);
  minter.discard();
  assert.equal(storage.getItem(jobKey(ACCOUNT, TOKEN)), null);
  assert.equal(calls.length, 1);
});

test("a maybe-sent batch that checkMintTx finds is not sent again", async () => {
  const calls = [];
  const metaCalls = [];
  let attempt = 0;
  mintHandler = async (tokenId, links) => {
    attempt += 1;
    calls.push(links.slice());
    if (attempt === 1) throw maybeError("0.0.1001@1.0");
    return okResult(tokenId, links, `0.0.1001@${attempt}.0`);
  };
  txHandler = async () => ({ status: "minted", serials: makeLinks(10).map((_, index) => String(index + 1)) });
  metaHandler = async (...args) => {
    metaCalls.push(args);
    return { status: "unknown" };
  };
  const { minter } = create({ links: makeLinks(20) });
  await minter.start();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], makeLinks(20).slice(0, 10));
  assert.equal(calls[1][0], "ipfs://item-10");
  assert.equal(metaCalls.length, 0);
  assert.equal(minter.state().status, "done");
  assert.equal(minter.state().cursor, 20);
});

test("unknown receipt then metadata found continues without a resend", async () => {
  const calls = [];
  const metaCalls = [];
  let attempt = 0;
  mintHandler = async (tokenId, links) => {
    attempt += 1;
    calls.push(links.slice());
    if (attempt === 1) throw maybeError("0.0.1001@2.0");
    return okResult(tokenId, links, `0.0.1001@${attempt}.0`);
  };
  txHandler = async () => ({ status: "unknown" });
  metaHandler = async (tokenId, accountId, metadata) => {
    metaCalls.push(metadata);
    return { status: "minted", serials: [String(metaCalls.length)] };
  };
  const { minter } = create({ links: makeLinks(20) });
  await minter.start();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "ipfs://item-0");
  assert.equal(calls[1][0], "ipfs://item-10");
  assert.equal(metaCalls.length, 10);
  assert.equal(minter.state().status, "done");
});

test("an unconfirmed batch is not resent until recheck finds it and resume continues", async () => {
  const calls = [];
  mintHandler = async (tokenId, links) => {
    calls.push(links.slice());
    if (calls.length === 1) throw maybeError("0.0.1001@3.0");
    return okResult(tokenId, links, `0.0.1001@${calls.length}.0`);
  };
  txHandler = async () => ({ status: "unknown" });
  metaHandler = async () => ({ status: "unknown" });
  const { minter } = create({ links: makeLinks(20) });
  await minter.start();
  assert.equal(minter.state().status, "unconfirmed");
  assert.equal(minter.state().reason, "Not confirmed on Hedera yet");
  assert.equal(minter.state().cursor, 0);
  assert.equal(minter.state().maybeSent.length, 1);
  await minter.resume();
  await minter.start();
  assert.equal(calls.length, 1);

  txHandler = async () => ({ status: "minted", serials: ["7"] });
  await minter.recheck();
  assert.equal(minter.state().status, "paused");
  assert.equal(minter.state().cursor, 10);
  assert.equal(minter.state().maybeSent.length, 0);
  assert.equal(calls.length, 1);

  await minter.resume();
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], "ipfs://item-10");
  assert.equal(minter.state().status, "done");
});

test("a failed receipt clears the maybe-sent batch and resume sends it once", async () => {
  const calls = [];
  let attempt = 0;
  mintHandler = async (tokenId, links) => {
    attempt += 1;
    calls.push(links.slice());
    if (attempt === 1) throw maybeError("0.0.1001@4.0");
    return okResult(tokenId, links, "0.0.1001@4.1");
  };
  txHandler = async () => ({ status: "failed", result: "INVALID_SIGNATURE" });
  const list = makeLinks(10);
  const { minter } = create({ links: list });
  await minter.start();
  assert.equal(minter.state().status, "paused");
  assert.equal(minter.state().reason, "Last batch failed on Hedera, nothing was minted");
  assert.equal(minter.state().cursor, 0);
  assert.equal(minter.state().maybeSent.length, 0);
  await minter.resume();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], list);
  assert.deepEqual(calls[1], list);
  assert.equal(minter.state().status, "done");
});

test("a wallet rejection pauses with the cursor unchanged", async () => {
  const calls = [];
  mintHandler = async () => {
    calls.push("rejected");
    throw new Error("User rejected the request");
  };
  const { minter, storage } = create({ links: makeLinks(10) });
  await minter.start();
  assert.equal(minter.state().status, "paused");
  assert.equal(minter.state().reason, "Wallet declined");
  assert.equal(minter.state().cursor, 0);
  assert.equal(minter.state().minted.length, 0);
  assert.equal(minter.state().maybeSent.length, 0);
  assert.equal(calls.length, 1);
  assert.ok(storage.getItem(jobKey(ACCOUNT, TOKEN)));
});

test("a page closed mid-flight loads the in-flight job as unconfirmed", async () => {
  const storage = makeStorage();
  const list = makeLinks(25);
  saveJob({
    v: 1,
    accountId: ACCOUNT,
    tokenId: TOKEN,
    links: list,
    cursor: 10,
    minted: [{ txId: "0.0.1001@5.0", serials: ["1"], from: 0, to: 10 }],
    maybeSent: [],
    inflight: { from: 10, to: 20 },
    status: "running",
    createdAt: 1,
    updatedAt: 2,
    privateKey: "do-not-store",
  }, storage);
  const calls = [];
  mintHandler = async () => {
    calls.push("nope");
    throw new Error("should not mint");
  };
  const { minter } = create({ storage, links: [] });
  assert.equal(minter.state().status, "unconfirmed");
  assert.equal(minter.state().cursor, 10);
  assert.deepEqual(minter.state().links, list);
  assert.equal(minter.state().inflight.from, 10);
  await minter.resume();
  await minter.start();
  assert.equal(calls.length, 0);
  const raw = storage.getItem(jobKey(ACCOUNT, TOKEN));
  assert.equal(raw.includes("do-not-store"), false);
  assert.equal(raw.includes("privateKey"), false);

  const quiet = makeStorage();
  saveJob({
    v: 1,
    accountId: ACCOUNT,
    tokenId: TOKEN,
    links: list,
    cursor: 10,
    minted: [],
    maybeSent: [],
    inflight: null,
    status: "running",
    createdAt: 1,
    updatedAt: 2,
  }, quiet);
  const resumed = create({ storage: quiet, links: [] });
  assert.equal(resumed.minter.state().status, "paused");
  assert.equal(resumed.minter.state().cursor, 10);
});

test("a storage quota error warns and the mint still finishes", async () => {
  const calls = [];
  mintHandler = async (tokenId, links) => {
    calls.push(links.slice());
    return okResult(tokenId, links, "0.0.1001@6.0");
  };
  const storage = makeStorage();
  storage.fail = true;
  const warnings = [];
  const { minter } = create({ storage, links: makeLinks(10) });
  minter.on("warning", (event) => warnings.push(event));
  await minter.start();
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, "Could not save mint progress in this browser");
  assert.equal(minter.state().status, "done");
  assert.equal(minter.state().persistError, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 10);
});

test("forceRemintUnconfirmed re-sends the unconfirmed range once", async () => {
  const calls = [];
  mintHandler = async (tokenId, links) => {
    calls.push(links.slice());
    if (calls.length === 1) throw maybeError("0.0.1001@7.0");
    return okResult(tokenId, links, "0.0.1001@7.1");
  };
  txHandler = async () => ({ status: "unknown" });
  metaHandler = async () => ({ status: "unknown" });
  const { minter } = create({ links: makeLinks(15) });
  await minter.start();
  assert.equal(minter.state().status, "unconfirmed");
  assert.equal(calls.length, 1);

  await minter.forceRemintUnconfirmed();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(calls[1].length, 10);
  assert.equal(minter.state().cursor, 10);
  assert.equal(minter.state().status, "paused");
  assert.equal(minter.state().links.length, 15);
});

test("a full supply does not trim the list, and max supply stops the run", async () => {
  const calls = [];
  const warnings = [];
  mintHandler = async (tokenId, links) => {
    calls.push(links.length);
    return okResult(tokenId, links, `0.0.1001@8.${calls.length}`);
  };
  const over = create({
    links: makeLinks(12),
    readSupply: async () => ({
      maxSupply: "9",
      totalSupply: "0",
      remaining: "9",
      type: "NON_FUNGIBLE_UNIQUE",
      treasury: ACCOUNT,
    }),
  });
  over.minter.on("warning", (event) => warnings.push(event));
  await over.minter.start();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /3/);
  assert.match(warnings[0].message, /over the remaining supply/);
  assert.deepEqual(calls, [10, 2]);
  assert.equal(over.minter.state().status, "done");

  calls.length = 0;
  mintHandler = async () => {
    calls.push("supply");
    throw maybeError("0.0.1001@9.0", "wallet timed out");
  };
  txHandler = async () => ({ status: "failed", result: "MAX_SUPPLY_REACHED" });
  const capped = create({ links: makeLinks(20) });
  await capped.minter.start();
  assert.equal(capped.minter.state().status, "stopped");
  assert.equal(capped.minter.state().reason, "max supply reached");
  assert.deepEqual(calls, ["supply"]);
});

test("start while a run is in flight does not mint a second time", async () => {
  const calls = [];
  let release = null;
  mintHandler = (tokenId, links) => {
    calls.push(links.slice());
    return new Promise((resolve) => {
      release = () => resolve(okResult(tokenId, links, "0.0.1001@10.0"));
    });
  };
  const { minter } = create({ links: makeLinks(10) });
  const first = minter.start();
  const second = minter.start();
  assert.equal(first, second);
  await waitFor(() => typeof release === "function");
  release();
  await first;
  assert.equal(calls.length, 1);
  assert.equal(minter.state().status, "done");
});

test("the connected account is read from the wallet when none was passed", async () => {
  mintHandler = async (tokenId, links) => okResult(tokenId, links, "0.0.1001@11.0");
  const storage = makeStorage();
  const { minter } = create({ accountId: "", storage, links: makeLinks(1) });
  await minter.start();
  assert.equal(minter.state().accountId, ACCOUNT);
  assert.equal(minter.state().status, "done");
});

test("listSavedJobs returns the jobs for one account", () => {
  const storage = makeStorage();
  saveJob({
    v: 1,
    accountId: ACCOUNT,
    tokenId: "0.0.1",
    links: ["ipfs://a"],
    cursor: 0,
    minted: [],
    maybeSent: [],
    status: "paused",
    createdAt: 1,
    updatedAt: 1,
  }, storage);
  saveJob({
    v: 1,
    accountId: ACCOUNT,
    tokenId: "0.0.2",
    links: ["ipfs://b"],
    cursor: 0,
    minted: [],
    maybeSent: [],
    status: "paused",
    createdAt: 1,
    updatedAt: 1,
  }, storage);
  saveJob({
    v: 1,
    accountId: "0.0.9",
    tokenId: "0.0.3",
    links: ["ipfs://c"],
    cursor: 0,
    minted: [],
    maybeSent: [],
    status: "paused",
    createdAt: 1,
    updatedAt: 1,
  }, storage);
  const jobs = listSavedJobs(ACCOUNT, storage);
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map((job) => job.tokenId).sort(), ["0.0.1", "0.0.2"]);
});
