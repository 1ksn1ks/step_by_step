// Runs the batch-mint checks in their own process. That process mocks the
// token mint and the wallet, which Node only allows behind a flag.
//
// The cases below run here instead, with the real tokenmint.js
// checkMintByMetadata and a stand-in mirror (fetch): a chunk with no
// transaction to read is proven only by its own NFTs, one per line, made
// since the job began.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("nft batch mint resumes from local progress without minting a chunk twice", () => {
  const runner = fileURLToPath(new URL("./nftbatch.runner.mjs", import.meta.url));
  const root = fileURLToPath(new URL("..", import.meta.url));
  const child = spawnSync(process.execPath, [
    "--experimental-test-module-mocks",
    "--test",
    runner,
  ], { encoding: "utf8", cwd: root });
  assert.equal(child.status, 0, `${child.stdout || ""}\n${child.stderr || ""}`);
});

// ── A chunk proven by metadata ─────────────────────────────────────────

const ACCOUNT = "0.0.1001";
const TOKEN = "0.0.4242";
// The job's createdAt (now()), and mirror times around it.
const NOW_MS = 1700000000000;
const BEFORE = "1699999999.999999999";
const AT = "1700000000.000000000";
const AFTER = "1700000001.000000000";

// The wallet's NFTs of TOKEN as the mirror lists them (newest first).
let held = [];
const fetched = [];
globalThis.fetch = async (url) => {
  const text = String(url);
  fetched.push(text);
  if (!text.startsWith(`https://mainnet.mirrornode.hedera.com/api/v1/tokens/${TOKEN}/nfts?`)) {
    return { ok: false, status: 404, json: async () => ({}) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      nfts: held.map((nft) => {
        const row = {
          token_id: TOKEN,
          account_id: ACCOUNT,
          serial_number: nft.serial,
          metadata: Buffer.from(nft.link, "utf8").toString("base64"),
        };
        if (nft.created !== undefined) row.created_timestamp = nft.created;
        return row;
      }),
      links: { next: null },
    }),
  };
};

const { createBatchMinter, jobKey, saveJob } = await import("../nftbatch.js");
const { checkMintByMetadata } = await import("../tokenmint.js");

function memory() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  };
}

// The wallet sent it but the receipt did not come back, and the mirror has
// no transaction for that id yet: only the metadata check is left.
function maybeSent() {
  const err = new Error("wallet timed out");
  err.maybeSentTxIds = ["0.0.1001@1700000000.000000001"];
  return err;
}

function minter(links, mint, storage = memory()) {
  const made = createBatchMinter({
    tokenId: TOKEN,
    links,
    accountId: ACCOUNT,
    storage,
    mint,
    checkTx: async () => ({ status: "unknown" }),
    readSupply: async () => ({ maxSupply: "100000", totalSupply: "0", remaining: "100000", type: "NON_FUNGIBLE_UNIQUE", treasury: ACCOUNT }),
    now: () => NOW_MS,
  });
  return { made, storage };
}

const nft = (serial, link, created = AFTER) => ({ serial, link, created });
const serialsOf = (state) => state.minted.map((row) => row.serials);

test("a duplicate link in one chunk does not borrow the serial an earlier line took", async () => {
  // Two lines say ipfs://a, but only one NFT with it exists.
  held = [nft(6, "ipfs://b"), nft(5, "ipfs://a")];
  const { made } = minter(["ipfs://a", "ipfs://a", "ipfs://b"], async () => { throw maybeSent(); });
  const state = await made.start();
  assert.equal(state.status, "unconfirmed");
  assert.equal(state.cursor, 0);
  assert.deepEqual(state.minted, []);
  assert.equal(state.maybeSent.length, 1);

  // Two NFTs with it: each line takes its own, newest first.
  held = [nft(7, "ipfs://a"), nft(6, "ipfs://b"), nft(5, "ipfs://a")];
  const again = minter(["ipfs://a", "ipfs://a", "ipfs://b"], async () => { throw maybeSent(); });
  const done = await again.made.start();
  assert.equal(done.status, "done");
  assert.deepEqual(serialsOf(done), [["7", "5", "6"]]);
});

test("a link minted before the job began does not count for it", async () => {
  // This list was minted once before: the wallet already holds that NFT.
  held = [nft(3, "ipfs://old", BEFORE)];
  fetched.length = 0;
  const { made } = minter(["ipfs://old"], async () => { throw maybeSent(); });
  const state = await made.start();
  assert.ok(fetched.some((url) => url.includes(`/api/v1/tokens/${TOKEN}/nfts?account.id=${ACCOUNT}&order=desc&limit=100`)));
  assert.equal(state.status, "unconfirmed");
  assert.equal(state.cursor, 0);
  assert.deepEqual(state.minted, []);

  // Made at the job's own start or later, it does.
  held = [nft(3, "ipfs://old", AT)];
  const at = minter(["ipfs://old"], async () => { throw maybeSent(); });
  const done = await at.made.start();
  assert.equal(done.status, "done");
  assert.deepEqual(serialsOf(done), [["3"]]);
});

test("a serial the job already counted is not counted again for a later chunk", async () => {
  // Line 10 repeats line 0. Chunk one minted it as serial 1; chunk two's
  // receipt is lost and the only ipfs://item-0 NFT is that same serial 1.
  const links = [...Array.from({ length: 10 }, (_, i) => `ipfs://item-${i}`), "ipfs://item-0"];
  let calls = 0;
  const mint = async (tokenId, list) => {
    calls += 1;
    if (calls === 1) return { txId: "0.0.1001@1700000000.000000002", serials: list.map((_, i) => String(i + 1)) };
    throw maybeSent();
  };
  held = Array.from({ length: 10 }, (_, i) => nft(10 - i, `ipfs://item-${9 - i}`));
  const { made } = minter(links, mint);
  const state = await made.start();
  assert.equal(calls, 2);
  assert.equal(state.status, "unconfirmed");
  assert.equal(state.cursor, 10);
  assert.equal(state.minted.length, 1);
  assert.equal(state.maybeSent.length, 1);

  // A second ipfs://item-0 NFT (serial 11) does prove chunk two.
  calls = 0;
  held = [nft(11, "ipfs://item-0"), ...held];
  const again = minter(links, mint);
  const done = await again.made.start();
  assert.equal(done.status, "done");
  assert.deepEqual(serialsOf(done), [["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], ["11"]]);
});

test("a job saved in the same shape still loads, and Check again uses its createdAt", async () => {
  const storage = memory();
  saveJob({
    v: 1,
    accountId: ACCOUNT,
    tokenId: TOKEN,
    links: ["ipfs://x"],
    cursor: 0,
    minted: [],
    maybeSent: [],
    inflight: { from: 0, to: 1 },
    status: "running",
    createdAt: NOW_MS,
    updatedAt: NOW_MS,
  }, storage);
  // The stored shape is as it was.
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(jobKey(ACCOUNT, TOKEN)))), [
    "v", "accountId", "tokenId", "links", "cursor", "minted", "maybeSent", "inflight", "status", "createdAt", "updatedAt",
  ]);
  const never = async () => { throw new Error("must not mint"); };
  const { made } = minter([], never, storage);
  assert.equal(made.state().status, "unconfirmed");
  held = [nft(4, "ipfs://x", BEFORE)];
  assert.equal((await made.recheck()).status, "unconfirmed");
  held = [nft(4, "ipfs://x", AFTER)];
  const done = await made.recheck();
  assert.equal(done.status, "done");
  assert.deepEqual(serialsOf(done), [["4"]]);
});

test("checkMintByMetadata: since keeps NFTs made at or after it; without it every match counts", async () => {
  held = [nft(9, "ipfs://y", AFTER), nft(8, "ipfs://y", BEFORE), { serial: 7, link: "ipfs://y" }];
  // The Hashinal check passes no since: all three.
  assert.deepEqual(await checkMintByMetadata(TOKEN, ACCOUNT, "ipfs://y"), { status: "minted", serials: ["9", "8", "7"] });
  // Made before since, or with no time to read: left out.
  assert.deepEqual(await checkMintByMetadata(TOKEN, ACCOUNT, "ipfs://y", { since: NOW_MS }), { status: "minted", serials: ["9"] });
  held = [nft(8, "ipfs://y", BEFORE)];
  assert.deepEqual(await checkMintByMetadata(TOKEN, ACCOUNT, "ipfs://y", { since: NOW_MS }), { status: "unknown" });
  // Exactly at since counts; a short fraction is read as nanoseconds.
  held = [nft(8, "ipfs://y", AT), nft(6, "ipfs://y", "1700000000.5")];
  assert.deepEqual(await checkMintByMetadata(TOKEN, ACCOUNT, "ipfs://y", { since: NOW_MS }), { status: "minted", serials: ["8", "6"] });
  assert.deepEqual(await checkMintByMetadata(TOKEN, ACCOUNT, "ipfs://y", { since: NOW_MS + 501 }), { status: "unknown" });
  // A since that is not a time matches nothing.
  for (const since of ["abc", Number.NaN, -1, 1.5]) {
    assert.deepEqual(await checkMintByMetadata(TOKEN, ACCOUNT, "ipfs://y", { since }), { status: "unknown" }, String(since));
  }
});
