// Token create, mint, and collection list with the SDK and the wallet stood
// in for. No network. Mirror bodies are stubbed fetch responses.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mirrorTxPath } from "../donationmath.js";

const USER_HEX = "AB".repeat(32);
const ECDSA_HEX = "02" + "cd".repeat(32);
const ACCOUNT = "0.0.1001";

const creates = [];
const mints = [];
const royalties = [];
const fixedFees = [];
const hbarFrom = [];
const keyCalls = [];
const fetches = [];

let txSeq = 0;
let serialCursor = 0;
let mintCount = 0;
let mintFailAt = 0;
let routes = () => {
  throw new Error("unexpected fetch");
};

function reset() {
  creates.length = 0;
  mints.length = 0;
  royalties.length = 0;
  fixedFees.length = 0;
  hbarFrom.length = 0;
  keyCalls.length = 0;
  fetches.length = 0;
  txSeq = 0;
  serialCursor = 0;
  mintCount = 0;
  mintFailAt = 0;
}

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    async json() { return body; },
  };
}

function accountBody(url) {
  const match = String(url).match(/\/api\/v1\/accounts\/(\d+\.\d+\.\d+)(?:\?|$)/);
  if (!match) return null;
  if (match[1] === ACCOUNT || match[1] === "0.0.6001") return { key: { _type: "ED25519", key: USER_HEX } };
  if (match[1] === "0.0.3333") return { key: { _type: "ECDSA_SECP256K1", key: ECDSA_HEX } };
  if (match[1] === "0.0.2") return { key: { _type: "ProtobufEncoded", key: "aabb" } };
  if (match[1] === "0.0.405") return { memo: "no key" };
  return null;
}

function installFetch() {
  globalThis.fetch = async (url, init) => {
    fetches.push({ url: String(url), signal: init && init.signal });
    const account = accountBody(url);
    if (account) return jsonResponse(account);
    return routes(String(url), init);
  };
}

class TokenCreateTransaction {
  constructor() {
    this.calls = [];
    creates.push(this);
  }
  record(name, value) {
    this.calls.push({ name, value });
    return this;
  }
  setTokenName(value) { return this.record("setTokenName", value); }
  setTokenSymbol(value) { return this.record("setTokenSymbol", value); }
  setDecimals(value) { return this.record("setDecimals", value); }
  setInitialSupply(value) { return this.record("setInitialSupply", value); }
  setTreasuryAccountId(value) { return this.record("setTreasuryAccountId", value); }
  setAdminKey(value) { return this.record("setAdminKey", value); }
  setSupplyKey(value) { return this.record("setSupplyKey", value); }
  setAutoRenewAccountId(value) { return this.record("setAutoRenewAccountId", value); }
  setTokenMemo(value) { return this.record("setTokenMemo", value); }
  setCustomFees(value) { return this.record("setCustomFees", value); }
  setTokenType(value) { return this.record("setTokenType", value); }
  setSupplyType(value) { return this.record("setSupplyType", value); }
  setMaxSupply(value) { return this.record("setMaxSupply", value); }
  setFreezeKey(value) { return this.record("setFreezeKey", value); }
  setKycKey(value) { return this.record("setKycKey", value); }
  setWipeKey(value) { return this.record("setWipeKey", value); }
  setPauseKey(value) { return this.record("setPauseKey", value); }
  setFeeScheduleKey(value) { return this.record("setFeeScheduleKey", value); }
  setMetadataKey(value) { return this.record("setMetadataKey", value); }
  setFreezeDefault(value) { return this.record("setFreezeDefault", value); }
  setNodeAccountIds(value) { return this.record("setNodeAccountIds", value); }
  setTransactionId(value) { this.transactionId = value; return this.record("setTransactionId", value); }
  freeze() { return this.record("freeze"); }
  freezeWithSigner() { return this.record("freezeWithSigner"); }
  async executeWithSigner(signerArg) {
    this.signerArg = signerArg;
    this.calls.push({ name: "executeWithSigner" });
    const transactionId = this.transactionId;
    return {
      transactionId,
      async getReceiptWithSigner() {
        return {
          status: { toString: () => "SUCCESS" },
          tokenId: { toString: () => "0.0.777" },
          serials: [],
        };
      },
    };
  }
}

class TokenMintTransaction {
  constructor() {
    this.calls = [];
    this.metadata = [];
    mints.push(this);
  }
  record(name, value) {
    this.calls.push({ name, value });
    return this;
  }
  setTokenId(value) { return this.record("setTokenId", value); }
  setMetadata(value) { this.metadata = value; return this.record("setMetadata", value); }
  setAmount(value) { return this.record("setAmount", value); }
  setNodeAccountIds(value) { return this.record("setNodeAccountIds", value); }
  setTransactionId(value) { this.transactionId = value; return this.record("setTransactionId", value); }
  freeze() { return this.record("freeze"); }
  freezeWithSigner() { return this.record("freezeWithSigner"); }
  async executeWithSigner(signerArg) {
    this.signerArg = signerArg;
    this.calls.push({ name: "executeWithSigner" });
    mintCount += 1;
    if (mintFailAt && mintCount === mintFailAt) throw new Error("node rejected");
    const serials = this.metadata.map(() => {
      serialCursor += 1;
      return String(serialCursor);
    });
    const transactionId = this.transactionId;
    return {
      transactionId,
      async getReceiptWithSigner() {
        return {
          status: { toString: () => "SUCCESS" },
          tokenId: { toString: () => "0.0.777" },
          serials,
        };
      },
    };
  }
}

class CustomRoyaltyFee {
  constructor() {
    royalties.push(this);
  }
  setNumerator(value) { this.numerator = value; return this; }
  setDenominator(value) { this.denominator = value; return this; }
  setFeeCollectorAccountId(value) { this.collector = value; return this; }
  setFallbackFee(value) { this.fallback = value; return this; }
}

class CustomFixedFee {
  constructor() {
    fixedFees.push(this);
  }
  setHbarAmount(value) { this.hbar = value; return this; }
}

class Hbar {
  static from(amount, unit) {
    hbarFrom.push(amount);
    return { amount, unit, toTinybars() { return amount; } };
  }
}

function makeKey(kind, hex) {
  const raw = String(hex).toLowerCase();
  return {
    kind,
    hex,
    toStringRaw() { return raw; },
    toStringDer() { return `302a${raw}`; },
    toString() { return raw; },
  };
}

const PublicKey = {
  fromStringED25519(hex) {
    keyCalls.push(["ED25519", hex]);
    return makeKey("ED25519", hex);
  },
  fromStringECDSA(hex) {
    keyCalls.push(["ECDSA_SECP256K1", hex]);
    return makeKey("ECDSA_SECP256K1", hex);
  },
};

const AccountId = {
  fromString(id) {
    return { id: String(id), toString() { return String(id); } };
  },
};

const TransactionId = {
  generate(account) {
    txSeq += 1;
    const text = `${account}@1700000000.${String(txSeq).padStart(9, "0")}`;
    return { account, toString() { return text; } };
  },
};

const TokenType = {
  FungibleCommon: { name: "FungibleCommon" },
  NonFungibleUnique: { name: "NonFungibleUnique" },
};

const TokenSupplyType = {
  Infinite: { name: "Infinite" },
  Finite: { name: "Finite" },
};

const signer = {
  getAccountId() {
    return { toString() { return ACCOUNT; } };
  },
};

let nodeReads = 0;
const dAppConnector = {
  async getNodeAddresses() {
    nodeReads += 1;
    return ["0.0.3"];
  },
};

mock.module("@hashgraph/sdk", {
  exports: {
    TokenCreateTransaction,
    TokenMintTransaction,
    TransactionId,
    AccountId,
    PublicKey,
    CustomRoyaltyFee,
    CustomFixedFee,
    Hbar,
    TokenType,
    TokenSupplyType,
  },
});

mock.module("../web3.js", {
  exports: {
    signer,
    connectedAccount: ACCOUNT,
    dAppConnector,
  },
});

installFetch();

const {
  userPublicKey,
  createFungibleToken,
  createNftCollection,
  mintNfts,
  listMyCollections,
  validateTokenFields,
} = await import("../tokenmint.js");

const BANNED_KEYS = [
  "setFreezeKey",
  "setKycKey",
  "setWipeKey",
  "setPauseKey",
  "setFeeScheduleKey",
  "setMetadataKey",
  "setFreezeDefault",
];

function callValue(tx, name) {
  const found = tx.calls.find((call) => call.name === name);
  assert.ok(found, name);
  return found.value;
}

function assertSubmitted(tx) {
  const freezeAt = tx.calls.findIndex((call) => call.name === "freeze");
  assert.ok(freezeAt > 0);
  const nodesAt = tx.calls.findIndex((call) => call.name === "setNodeAccountIds");
  const txAt = tx.calls.findIndex((call) => call.name === "setTransactionId");
  assert.ok(nodesAt >= 0 && nodesAt < freezeAt);
  assert.ok(txAt >= 0 && txAt < freezeAt);
  assert.equal(String(callValue(tx, "setNodeAccountIds")[0]), "0.0.3");
  assert.equal(callValue(tx, "setTransactionId").account, ACCOUNT);
  assert.equal(tx.calls.some((call) => call.name === "freezeWithSigner"), false);
  assert.ok(tx.calls.findIndex((call) => call.name === "executeWithSigner") > freezeAt);
  assert.equal(tx.signerArg, signer);
}

function assertWalletFreeze(tx) {
  assertSubmitted(tx);
  const freezeAt = tx.calls.findIndex((call) => call.name === "freeze");
  for (const name of ["setTreasuryAccountId", "setAutoRenewAccountId"]) {
    const at = tx.calls.findIndex((call) => call.name === name);
    assert.ok(at >= 0 && at < freezeAt, name);
    assert.equal(typeof tx.calls[at].value, "string");
    assert.equal(tx.calls[at].value, ACCOUNT);
  }
  for (const name of BANNED_KEYS) {
    assert.equal(tx.calls.some((call) => call.name === name), false, name);
  }
}

function assertLinks(result) {
  assert.equal(result.hashscanUrl, `https://hashscan.io/mainnet/transaction/${mirrorTxPath(result.txId)}`);
  assert.equal(result.tokenUrl, `https://hashscan.io/mainnet/token/${result.tokenId}`);
  assert.match(result.hashscanUrl, /^https:\/\/hashscan\.io\/mainnet\/transaction\/0\.0\.1001-1700000000-\d{9}$/);
}

function links23() {
  const items = [];
  for (let i = 0; i < 10; i++) items.push(i === 0 ? "  ipfs://cid-0  " : `ipfs://cid-${i}`);
  for (let i = 0; i < 10; i++) items.push(`https://example.com/${i}`);
  for (let i = 0; i < 3; i++) items.push(`hcs://1/0.0.9/${i}`);
  return items;
}

test("tokenmint stays free of the UI and loads the wallet lazily", () => {
  const source = fs.readFileSync(new URL("../tokenmint.js", import.meta.url), "utf8");
  assert.match(source, /import\("\.\/web3\.js"\)/);
  assert.match(source, /hedera\.js lines 34-69/);
  assert.doesNotMatch(source, /from\s+["']\.\/web3\.js["']/);
  assert.doesNotMatch(source, /from\s+["']\.\/(hedera|processallmessages|feedlayout|toast)/);
  assert.equal(source.includes("freezeWithSigner"), false);
});

test("fungible create with no cap sets treasury and auto-renew before freeze", async () => {
  reset();
  nodeReads = 0;
  const result = await createFungibleToken({
    name: "  Coin  ",
    symbol: "  ABC  ",
    decimals: 8,
    initialSupply: "1000",
    maxSupply: null,
    memo: "hello",
  });
  assert.equal(creates.length, 1);
  const tx = creates[0];
  assertWalletFreeze(tx);
  assert.equal(callValue(tx, "setTokenName"), "Coin");
  assert.equal(callValue(tx, "setTokenSymbol"), "ABC");
  assert.equal(callValue(tx, "setTokenMemo"), "hello");
  assert.equal(callValue(tx, "setTokenType"), TokenType.FungibleCommon);
  assert.equal(callValue(tx, "setDecimals"), 8);
  assert.equal(callValue(tx, "setInitialSupply"), "1000");
  assert.equal(typeof callValue(tx, "setInitialSupply"), "string");
  assert.equal(callValue(tx, "setSupplyType"), TokenSupplyType.Infinite);
  assert.equal(tx.calls.some((call) => call.name === "setMaxSupply"), false);
  const supply = callValue(tx, "setSupplyKey");
  const admin = callValue(tx, "setAdminKey");
  assert.equal(supply, admin);
  assert.equal(supply.toStringRaw(), USER_HEX.toLowerCase());
  assert.equal(result.tokenId, "0.0.777");
  assert.equal(result.serials, undefined);
  assertLinks(result);
  assert.equal(nodeReads, 1);
  assert.ok(fetches[0].signal);
});

test("finite fungible supply accepts a safe integer and a bigint without using Number", async () => {
  reset();
  const result = await createFungibleToken({
    name: "Finite",
    symbol: "FIN",
    decimals: 0,
    initialSupply: 100,
    maxSupply: 100n,
  });
  const tx = creates[0];
  assertWalletFreeze(tx);
  assert.equal(callValue(tx, "setSupplyType"), TokenSupplyType.Finite);
  assert.equal(callValue(tx, "setInitialSupply"), "100");
  assert.equal(callValue(tx, "setMaxSupply"), "100");
  assert.equal(typeof callValue(tx, "setInitialSupply"), "string");
  assert.equal(typeof callValue(tx, "setMaxSupply"), "string");
  assertLinks(result);
});

test("int64 max supply is accepted as a string and one past it never builds a transaction", async () => {
  reset();
  const huge = "9223372036854775807";
  await createFungibleToken({
    name: "Max",
    symbol: "MAX",
    decimals: 0,
    initialSupply: huge,
    maxSupply: null,
  });
  assert.equal(callValue(creates[0], "setInitialSupply"), huge);
  reset();
  await assert.rejects(
    () => createFungibleToken({
      name: "Over",
      symbol: "OVER",
      decimals: 0,
      initialSupply: "9223372036854775808",
      maxSupply: null,
    }),
    (err) => {
      assert.equal(err.userFacing, true);
      assert.match(err.message, /maximum/);
      return true;
    },
  );
  assert.equal(creates.length, 0);
});

test("admin key is omitted only when adminKey is false, and the supply key stays", async () => {
  reset();
  await createFungibleToken({
    name: "NoAdmin",
    symbol: "NA",
    decimals: 2,
    initialSupply: "0",
    maxSupply: null,
    adminKey: false,
  });
  const tx = creates[0];
  assert.equal(tx.calls.some((call) => call.name === "setAdminKey"), false);
  assert.equal(callValue(tx, "setSupplyKey").toStringRaw(), USER_HEX.toLowerCase());
  assertWalletFreeze(tx);
});

test("an NFT collection without a royalty leaves custom fees unset", async () => {
  reset();
  const result = await createNftCollection({
    name: "Cards",
    symbol: "CARD",
    maxSupply: "500",
  });
  const tx = creates[0];
  assertWalletFreeze(tx);
  assert.equal(callValue(tx, "setTokenType"), TokenType.NonFungibleUnique);
  assert.equal(callValue(tx, "setDecimals"), 0);
  assert.equal(callValue(tx, "setInitialSupply"), "0");
  assert.equal(callValue(tx, "setSupplyType"), TokenSupplyType.Finite);
  assert.equal(callValue(tx, "setMaxSupply"), "500");
  assert.equal(tx.calls.some((call) => call.name === "setCustomFees"), false);
  assert.equal(royalties.length, 0);
  assertLinks(result);
});

test("a royalty of 5.25 percent is 525/10000 and the collector defaults to the account", async () => {
  reset();
  await createNftCollection({
    name: "Royalty",
    symbol: "ROY",
    maxSupply: "10",
    royalty: { percent: 5.25, fallbackHbar: "1.5" },
  });
  const tx = creates[0];
  assertWalletFreeze(tx);
  assert.equal(royalties.length, 1);
  assert.equal(royalties[0].numerator, 525);
  assert.equal(royalties[0].denominator, 10000);
  assert.equal(royalties[0].collector, ACCOUNT);
  assert.equal(typeof royalties[0].collector, "string");
  assert.equal(fixedFees.length, 1);
  assert.equal(royalties[0].fallback, fixedFees[0]);
  assert.deepEqual(hbarFrom, ["1.5"]);
  assert.equal(fixedFees[0].hbar.amount, "1.5");
  assert.deepEqual(callValue(tx, "setCustomFees"), [royalties[0]]);
  assert.equal(tx.calls.some((call) => call.name === "setFeeScheduleKey"), false);
});

test("a royalty of 50.01 percent is rejected before a transaction", async () => {
  reset();
  await assert.rejects(
    () => createNftCollection({
      name: "TooHigh",
      symbol: "HI",
      maxSupply: "10",
      royalty: { percent: 50.01 },
    }),
    (err) => {
      assert.equal(err.userFacing, true);
      assert.match(err.message, /50/);
      return true;
    },
  );
  assert.equal(creates.length, 0);
  assert.equal(royalties.length, 0);
});

test("minting 23 links sends 10, then 10, then 3, and gathers the serials", async () => {
  reset();
  nodeReads = 0;
  const items = links23();
  const result = await mintNfts("0.0.900", items);
  assert.equal(mints.length, 3);
  assert.deepEqual(mints.map((tx) => tx.metadata.length), [10, 10, 3]);
  assert.equal(nodeReads, 3);
  const ids = mints.map((tx) => tx.transactionId.toString());
  assert.equal(new Set(ids).size, 3);
  for (const tx of mints) {
    assertSubmitted(tx);
    assert.equal(callValue(tx, "setTokenId"), "0.0.900");
    assert.equal(tx.calls.some((call) => call.name === "setAmount"), false);
    assert.ok(tx.metadata.every((item) => item instanceof Uint8Array));
  }
  assert.equal(new TextDecoder().decode(mints[0].metadata[0]), "ipfs://cid-0");
  assert.equal(new TextDecoder().decode(mints[1].metadata[0]), "https://example.com/0");
  assert.equal(new TextDecoder().decode(mints[2].metadata[0]), "hcs://1/0.0.9/0");
  assert.deepEqual(result.serials, Array.from({ length: 23 }, (_, i) => String(i + 1)));
  assert.equal(result.txId, ids[2]);
  assert.deepEqual(result.txIds, ids);
  assert.equal(result.tokenId, "0.0.900");
  assertLinks(result);
});

test("a 101-byte link is rejected before any mint is sent", async () => {
  reset();
  nodeReads = 0;
  const tooLong = "ipfs://" + "a".repeat(94);
  assert.equal(new TextEncoder().encode(tooLong).length, 101);
  const before = fetches.length;
  await assert.rejects(
    () => mintNfts("0.0.900", ["ipfs://ok", tooLong]),
    (err) => {
      assert.equal(err.userFacing, true);
      assert.match(err.message, /100 bytes/);
      return true;
    },
  );
  assert.equal(mints.length, 0);
  assert.equal(nodeReads, 0);
  assert.equal(fetches.length, before);
});

test("a failure on the second mint chunk reports the serials from the first", async () => {
  reset();
  mintFailAt = 2;
  await assert.rejects(
    () => mintNfts("0.0.900", links23()),
    (err) => {
      assert.equal(err.tokenId, "0.0.900");
      assert.deepEqual(err.mintedSerials, Array.from({ length: 10 }, (_, i) => String(i + 1)));
      assert.equal(err.sentCount, 10);
      assert.equal(err.txIds.length, 1);
      assert.equal(err.userFacing, true);
      return true;
    },
  );
  assert.equal(mints.length, 2);
  assert.deepEqual(mints.map((tx) => tx.metadata.length), [10, 10]);
});

test("userPublicKey accepts ED25519 and ECDSA and rejects a protobuf key", async () => {
  reset();
  const ed = await userPublicKey("0.0.6001");
  assert.deepEqual(keyCalls.at(-1), ["ED25519", USER_HEX]);
  assert.equal(ed.toStringRaw(), USER_HEX.toLowerCase());
  const fetched = fetches.length;
  const again = await userPublicKey("0.0.6001");
  assert.equal(again, ed);
  assert.equal(fetches.length, fetched);

  const ecdsa = await userPublicKey("0.0.3333");
  assert.deepEqual(keyCalls.at(-1), ["ECDSA_SECP256K1", ECDSA_HEX]);
  assert.equal(ecdsa.kind, "ECDSA_SECP256K1");

  await assert.rejects(
    () => userPublicKey("0.0.2"),
    (err) => {
      assert.equal(err.userFacing, true);
      assert.equal(
        err.message,
        "This account uses a multi-key (threshold or key list) setup. Minting here needs a single-key account.",
      );
      return true;
    },
  );
  await assert.rejects(
    () => userPublicKey("0.0.405"),
    /multi-key/,
  );
  routes = () => jsonResponse({}, false);
  await assert.rejects(
    () => userPublicKey("0.0.404"),
    (err) => {
      assert.equal(err.message, "Could not read your account key");
      assert.equal(err.userFacing, undefined);
      return true;
    },
  );
});

test("listMyCollections keeps the treasury supply key, both key shapes, and the next page", async () => {
  reset();
  const raw = USER_HEX.toLowerCase();
  const pages = {
    1: {
      tokens: [
        { token_id: "0.0.501" },
        { token_id: "0.0.502" },
      ],
      links: { next: "/api/v1/tokens?account.id=0.0.1001&type=NON_FUNGIBLE_UNIQUE&limit=100&page=2" },
    },
    2: {
      tokens: [
        { token_id: "0.0.503" },
        { token_id: "0.0.504" },
        { token_id: "0.0.505" },
      ],
      links: { next: null },
    },
  };
  const details = {
    "0.0.501": {
      token_id: "0.0.501",
      name: "Kept",
      symbol: "KPT",
      treasury_account_id: ACCOUNT,
      supply_key: { _type: "ED25519", key: USER_HEX },
      total_supply: "4",
      max_supply: "9",
    },
    "0.0.502": {
      token_id: "0.0.502",
      name: "Other",
      symbol: "OTH",
      treasury_account_id: "0.0.8",
      supply_key: { _type: "ED25519", key: raw },
      total_supply: "1",
      max_supply: "1",
    },
    "0.0.503": {
      token_id: "0.0.503",
      name: "WrongKey",
      symbol: "WK",
      treasury_account_id: ACCOUNT,
      supply_key: { _type: "ED25519", key: "ff".repeat(32) },
      total_supply: "1",
      max_supply: "1",
    },
    "0.0.505": {
      token_id: "0.0.505",
      name: "Bare",
      symbol: "BARE",
      treasury_account_id: ACCOUNT,
      supply_key: raw,
      total_supply: "2",
      max_supply: "8",
    },
  };
  routes = async (url) => {
    if (url.includes("page=2")) return jsonResponse(pages[2]);
    if (url.includes("type=NON_FUNGIBLE_UNIQUE")) return jsonResponse(pages[1]);
    const id = url.match(/\/api\/v1\/tokens\/(0\.0\.\d+)/);
    if (id && id[1] === "0.0.504") return jsonResponse({}, false);
    if (id && details[id[1]]) return jsonResponse(details[id[1]]);
    throw new Error("unexpected " + url);
  };
  const rows = await listMyCollections(ACCOUNT);
  assert.deepEqual(rows, [
    { tokenId: "0.0.501", name: "Kept", symbol: "KPT", totalSupply: "4", maxSupply: "9" },
    { tokenId: "0.0.505", name: "Bare", symbol: "BARE", totalSupply: "2", maxSupply: "8" },
  ]);
  assert.ok(fetches.some((item) => item.url.includes("page=2")));
});

test("listMyCollections follows at most 5 pages, caps details at 50, and fetches 4 at a time", async () => {
  reset();
  let listPages = 0;
  let inflight = 0;
  let maxInflight = 0;
  let details = 0;
  routes = async (url) => {
    if (url.includes("type=NON_FUNGIBLE_UNIQUE") || url.includes("page=")) {
      listPages += 1;
      if (url.includes("cap=50")) {
        const tokens = Array.from({ length: 51 }, (_, i) => ({ token_id: `0.0.${3000 + i}` }));
        return jsonResponse({ tokens, links: { next: "/api/v1/tokens?page=99" } });
      }
      const next = listPages < 6 ? `/api/v1/tokens?page=${listPages + 1}` : null;
      return jsonResponse({
        tokens: [{ token_id: `0.0.${7000 + listPages}` }],
        links: { next },
      });
    }
    details += 1;
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((resolve) => setTimeout(resolve, 15));
    inflight -= 1;
    const id = url.match(/\/tokens\/(0\.0\.\d+)/)[1];
    return jsonResponse({
      token_id: id,
      name: id,
      symbol: "S",
      treasury_account_id: ACCOUNT,
      supply_key: { key: USER_HEX },
      total_supply: "1",
      max_supply: "1",
    });
  };
  const five = await listMyCollections(ACCOUNT);
  assert.equal(five.length, 5);
  assert.equal(listPages, 5);
  assert.equal(fetches.some((item) => item.url.includes("page=6")), false);
  assert.ok(maxInflight > 1);
  assert.ok(maxInflight <= 4);

  listPages = 0;
  details = 0;
  maxInflight = 0;
  routes = async (url) => {
    if (url.includes("type=NON_FUNGIBLE_UNIQUE")) {
      const tokens = Array.from({ length: 51 }, (_, i) => ({ token_id: `0.0.${3000 + i}` }));
      return jsonResponse({ tokens, links: { next: "/api/v1/tokens?page=99" } });
    }
    details += 1;
    const id = url.match(/\/tokens\/(0\.0\.\d+)/)[1];
    return jsonResponse({
      token_id: id,
      name: "N",
      symbol: "S",
      treasury_account_id: ACCOUNT,
      supply_key: USER_HEX.toLowerCase(),
      total_supply: "1",
      max_supply: "2",
    });
  };
  const capped = await listMyCollections(ACCOUNT);
  assert.equal(capped.length, 50);
  assert.equal(details, 50);
  assert.equal(fetches.some((item) => item.url.includes("page=99")), false);
});

test("the first collection fetch fails closed", async () => {
  reset();
  routes = async () => jsonResponse({}, false);
  await assert.rejects(
    () => listMyCollections("0.0.1002"),
    (err) => {
      assert.equal(err.message, "Could not read your collections");
      return true;
    },
  );
});

test("names are measured in bytes, and decimals above 18 are rejected", () => {
  reset();
  const emoji = "😀".repeat(25);
  assert.equal(new TextEncoder().encode(emoji).length, 100);
  const parsed = validateTokenFields({
    name: emoji,
    symbol: "S",
    decimals: 18,
    initialSupply: "0",
    maxSupply: null,
    memo: "m".repeat(100),
  });
  assert.equal(parsed.name, emoji);
  assert.equal(parsed.decimals, 18);
  assert.throws(
    () => validateTokenFields({
      name: emoji + "😀",
      symbol: "S",
      decimals: 0,
      initialSupply: "0",
      maxSupply: null,
    }),
    (err) => {
      assert.equal(err.userFacing, true);
      assert.match(err.message, /100 bytes/);
      return true;
    },
  );
  assert.throws(
    () => validateTokenFields({
      name: "Name",
      symbol: "S",
      decimals: 19,
      initialSupply: "0",
      maxSupply: null,
    }),
    (err) => {
      assert.equal(err.userFacing, true);
      assert.match(err.message, /Decimals/);
      return true;
    },
  );
  assert.throws(
    () => validateTokenFields({
      name: "Name",
      symbol: "S",
      decimals: 0,
      initialSupply: "1.5",
      maxSupply: null,
    }),
    /whole number/,
  );
  assert.throws(
    () => validateTokenFields({
      name: "Name",
      symbol: "S",
      decimals: 0,
      initialSupply: "1e2",
      maxSupply: null,
    }),
    /whole number/,
  );
  assert.throws(
    () => validateTokenFields({
      name: "Name",
      symbol: "S",
      decimals: 0,
      initialSupply: "10",
      maxSupply: "9",
    }),
    /at least the initial supply/,
  );
  assert.throws(
    () => validateTokenFields({
      name: "Name",
      symbol: "S",
      decimals: 0,
      initialSupply: "0",
      maxSupply: null,
      percent: 50.01,
    }),
    /50/,
  );
});
