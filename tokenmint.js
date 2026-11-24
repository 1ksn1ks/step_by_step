// Mainnet token create and NFT mint. The connected wallet signs every
// transaction. There is no server key and nothing is stored here.
//
// Imports stay limited to the Hedera SDK, donationmath (no imports of its
// own), and a lazy web3.js so this file can load in tests.

import {
  AccountId,
  CustomFixedFee,
  CustomRoyaltyFee,
  Hbar,
  PublicKey,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  TransactionId,
} from "@hashgraph/sdk";
import { hbarToTinybar, mirrorTxPath } from "./donationmath.js";

const MIRROR_NODE = "https://mainnet.mirrornode.hedera.com";
const ACCOUNT_ID = /^\d+\.\d+\.\d+$/;
const INT64_MAX = 9223372036854775807n;
const MINT_CHUNK = 10;
const LIST_PAGE_LIMIT = 5;
const LIST_TOKEN_LIMIT = 50;
const DETAIL_CONCURRENCY = 4;
const METADATA_PREFIXES = ["ipfs://", "https://", "hcs://1/"];

// One successful account-key read per account, for this page load.
const keyCache = new Map();

function userFacing(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

function utf8Size(text) {
  return new TextEncoder().encode(text).length;
}

// Wallet connector ids are @hiero-ledger/sdk objects. They fail instanceof
// inside @hashgraph/sdk, and fromString then crashes on the object. Same
// workaround as hedera.js lines 34-69: keep every id a string, set
// TransactionId.generate(account), and call freeze(). Do not freeze with
// the signer: that installs the connector's id, and TokenCreateTransaction
// copies that payer into auto-renew when none was set first.
function sdkId(value) {
  if (typeof value === "string") return value;
  if (value != null && typeof value.toString === "function") {
    const text = value.toString();
    if (typeof text === "string" && text !== "[object Object]") return text;
  }
  return value;
}

function connectedAccountId(signer) {
  const accountId = sdkId(signer && typeof signer.getAccountId === "function" ? signer.getAccountId() : "");
  if (typeof accountId !== "string" || accountId === "") {
    throw new Error("Connect wallet first");
  }
  return accountId;
}

function nodeAccountId(nodeAddresses) {
  let node = "0.0.3";
  if (nodeAddresses && nodeAddresses.length > 0) {
    node = nodeAddresses[Math.floor(Math.random() * nodeAddresses.length)];
  }
  return AccountId.fromString(sdkId(node));
}

function freezeForConnectedAccount(transaction, signer, nodeAddresses) {
  transaction.setNodeAccountIds([nodeAccountId(nodeAddresses)]);
  transaction.setTransactionId(TransactionId.generate(connectedAccountId(signer)));
  transaction.freeze();
  return transaction;
}

async function wallet() {
  const { signer, dAppConnector } = await import("./web3.js");
  if (!signer || !dAppConnector || typeof dAppConnector.getNodeAddresses !== "function") {
    throw new Error("Connect wallet first");
  }
  const accountId = connectedAccountId(signer);
  if (!ACCOUNT_ID.test(accountId)) throw new Error("Connect wallet first");
  return { signer, dAppConnector, accountId };
}

function requireAccount(value, message) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!ACCOUNT_ID.test(text)) throw userFacing(message || "Enter an account id like 0.0.123");
  return text;
}

function requireLabel(value, label) {
  if (typeof value !== "string") throw userFacing(`${label} is required`);
  const text = value.trim();
  const size = utf8Size(text);
  if (size < 1 || size > 100) throw userFacing(`${label} must be 1 to 100 bytes`);
  return text;
}

function optionalMemo(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw userFacing("Memo must be 100 bytes or less");
  const text = value.trim();
  if (utf8Size(text) > 100) throw userFacing("Memo must be 100 bytes or less");
  return text;
}

function requireDecimals(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 18) {
    throw userFacing("Decimals must be a whole number from 0 to 18");
  }
  return value;
}

// Whole token units as a bigint. Floats, exponent strings, and anything
// above int64 max are rejected. The result is later passed to the SDK as a
// decimal string so the value is never a lossy Number.
function requireWhole(value, { allowZero, label }) {
  let amount;
  if (typeof value === "bigint") {
    amount = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw userFacing(`${label} must be a whole number`);
    amount = BigInt(value);
  } else if (typeof value === "string") {
    const text = value.trim();
    if (!/^(0|[1-9]\d*)$/.test(text)) throw userFacing(`${label} must be a whole number`);
    amount = BigInt(text);
  } else {
    throw userFacing(`${label} must be a whole number`);
  }
  if (amount < 0n || (!allowZero && amount === 0n)) {
    throw userFacing(allowZero ? `${label} must be a whole number` : `${label} must be a whole number above 0`);
  }
  if (amount > INT64_MAX) throw userFacing(`${label} is above the network maximum`);
  return amount;
}

// percent 5.25 is 525 / 10000. At most two decimal places, and at most 50.
function royaltyBasisPoints(percent) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    throw userFacing("Royalty percent must be greater than 0 and at most 50");
  }
  const text = String(percent);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
    throw userFacing("Royalty percent can have at most 2 decimal places");
  }
  const [whole, frac = ""] = text.split(".");
  const points = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isInteger(points) || points <= 0 || points > 5000) {
    throw userFacing("Royalty percent must be greater than 0 and at most 50");
  }
  return points;
}

/**
 * Shared field checks for create and the tests.
 * initialSupply and maxSupply are whole counts of the smallest unit.
 * The caller has already applied decimals. maxSupply null means no cap.
 */
export function validateTokenFields(fields = {}) {
  const name = requireLabel(fields.name, "Name");
  const symbol = requireLabel(fields.symbol, "Symbol");
  const memo = optionalMemo(fields.memo);
  const decimals = requireDecimals(fields.decimals);
  const initialSupply = requireWhole(fields.initialSupply, { allowZero: true, label: "Initial supply" });
  let maxSupply = null;
  if (fields.maxSupply != null) {
    maxSupply = requireWhole(fields.maxSupply, { allowZero: false, label: "Max supply" });
    if (maxSupply < initialSupply) throw userFacing("Max supply must be at least the initial supply");
  }
  if (fields.percent != null) royaltyBasisPoints(fields.percent);
  if (fields.accountId != null) requireAccount(fields.accountId);
  if (fields.collector != null) requireAccount(fields.collector);
  return { name, symbol, memo, decimals, initialSupply, maxSupply };
}

function readRoyalty(royalty) {
  if (royalty == null) return null;
  if (typeof royalty !== "object") throw userFacing("Royalty percent must be greater than 0 and at most 50");
  const points = royaltyBasisPoints(royalty.percent);
  let collector = "";
  if (royalty.collector != null && royalty.collector !== "") {
    collector = requireAccount(royalty.collector, "Enter a collector account id like 0.0.123");
  }
  let fallback = "";
  if (royalty.fallbackHbar != null && royalty.fallbackHbar !== "") {
    fallback = String(royalty.fallbackHbar).trim();
    // hbarToTinybar checks the 8-decimal shape and the donation range.
    if (hbarToTinybar(fallback) == null) {
      throw userFacing("Enter a fallback from 0.1 to 1000000 HBAR, with at most 8 decimals");
    }
  }
  return { points, collector, fallback };
}

async function mirrorRead(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    throw new Error("offline");
  }
  if (!response || !response.ok) throw new Error("offline");
  try {
    const data = await response.json();
    if (!data || typeof data !== "object") throw new Error("offline");
    return data;
  } catch (err) {
    if (err && err.message === "offline") throw err;
    throw new Error("offline");
  }
}

// Live mainnet account bodies use key._type and key.key. 0.0.10965618 is
// ED25519 with a raw hex key. 0.0.2 is ProtobufEncoded (a threshold key).
// ECDSA_SECP256K1 uses the same two fields.
function keyFromMirror(key) {
  if (!key || typeof key !== "object" || Array.isArray(key.keys)) return null;
  if (key._type !== "ED25519" && key._type !== "ECDSA_SECP256K1") return null;
  if (typeof key.key !== "string" || !/^[0-9a-fA-F]+$/.test(key.key)) return null;
  return key._type === "ED25519"
    ? PublicKey.fromStringED25519(key.key)
    : PublicKey.fromStringECDSA(key.key);
}

export async function userPublicKey(accountId) {
  const id = requireAccount(accountId);
  const cached = keyCache.get(id);
  if (cached) return cached;
  let data;
  try {
    data = await mirrorRead(`${MIRROR_NODE}/api/v1/accounts/${id}`);
  } catch {
    throw new Error("Could not read your account key");
  }
  let publicKey = null;
  try {
    publicKey = keyFromMirror(data.key);
  } catch {
    throw new Error("Could not read your account key");
  }
  if (!publicKey) {
    throw userFacing("This account uses a multi-key (threshold or key list) setup. Minting here needs a single-key account.");
  }
  keyCache.set(id, publicKey);
  return publicKey;
}

function resultLinks(tokenId, txId) {
  return {
    tokenId,
    txId,
    hashscanUrl: `https://hashscan.io/mainnet/transaction/${mirrorTxPath(txId)}`,
    tokenUrl: `https://hashscan.io/mainnet/token/${tokenId}`,
  };
}

function readTxId(txResponse) {
  const txId = txResponse && txResponse.transactionId && typeof txResponse.transactionId.toString === "function"
    ? txResponse.transactionId.toString()
    : "";
  if (!txId || !mirrorTxPath(txId)) throw new Error("missing transaction id");
  return txId;
}

function requireSuccess(receipt) {
  const status = receipt && receipt.status && typeof receipt.status.toString === "function"
    ? receipt.status.toString()
    : "";
  if (status !== "SUCCESS") throw new Error(status || "The network rejected the transaction");
}

function tokenIdFrom(receipt) {
  const tokenId = receipt && receipt.tokenId && typeof receipt.tokenId.toString === "function"
    ? receipt.tokenId.toString()
    : "";
  if (!ACCOUNT_ID.test(tokenId)) throw new Error("missing token id");
  return tokenId;
}

async function submitCreate(tx, signer, dAppConnector) {
  const nodeAddresses = await dAppConnector.getNodeAddresses();
  freezeForConnectedAccount(tx, signer, nodeAddresses);
  const txResponse = await tx.executeWithSigner(signer);
  const receipt = await txResponse.getReceiptWithSigner(signer);
  requireSuccess(receipt);
  return { tokenId: tokenIdFrom(receipt), txId: readTxId(txResponse) };
}

function applyCommon(tx, parsed, accountId, publicKey, adminKey) {
  tx.setTokenName(parsed.name);
  tx.setTokenSymbol(parsed.symbol);
  if (parsed.memo) tx.setTokenMemo(parsed.memo);
  // Plain strings, before freeze. freezeWith would copy a connector id
  // into auto-renew and AccountId.fromString would throw.
  tx.setTreasuryAccountId(accountId);
  tx.setAutoRenewAccountId(accountId);
  tx.setSupplyKey(publicKey);
  if (adminKey !== false) tx.setAdminKey(publicKey);
}

/**
 * Fungible token. initialSupply and maxSupply are smallest-unit counts.
 * The caller has already applied decimals. maxSupply null is an infinite supply.
 */
export async function createFungibleToken({
  name,
  symbol,
  decimals,
  initialSupply,
  maxSupply,
  memo,
  adminKey = true,
} = {}) {
  const parsed = validateTokenFields({ name, symbol, decimals, initialSupply, maxSupply, memo });
  const { signer, dAppConnector, accountId } = await wallet();
  const publicKey = await userPublicKey(accountId);
  const tx = new TokenCreateTransaction();
  applyCommon(tx, parsed, accountId, publicKey, adminKey);
  tx.setTokenType(TokenType.FungibleCommon);
  tx.setDecimals(parsed.decimals);
  tx.setInitialSupply(parsed.initialSupply.toString());
  if (parsed.maxSupply == null) {
    tx.setSupplyType(TokenSupplyType.Infinite);
  } else {
    tx.setSupplyType(TokenSupplyType.Finite);
    tx.setMaxSupply(parsed.maxSupply.toString());
  }
  const created = await submitCreate(tx, signer, dAppConnector);
  return resultLinks(created.tokenId, created.txId);
}

/**
 * NFT collection. Supply is finite. Royalty is off unless royalty is set.
 * The fee-schedule key stays unset, so a royalty cannot be changed later.
 */
export async function createNftCollection({
  name,
  symbol,
  maxSupply,
  memo,
  adminKey = true,
  royalty = null,
} = {}) {
  const parsed = validateTokenFields({
    name,
    symbol,
    memo,
    decimals: 0,
    initialSupply: "0",
    maxSupply,
  });
  if (parsed.maxSupply == null) throw userFacing("Enter a max supply");
  const royaltySpec = readRoyalty(royalty);
  const { signer, dAppConnector, accountId } = await wallet();
  const publicKey = await userPublicKey(accountId);
  const tx = new TokenCreateTransaction();
  applyCommon(tx, parsed, accountId, publicKey, adminKey);
  tx.setTokenType(TokenType.NonFungibleUnique);
  tx.setDecimals(0);
  tx.setInitialSupply("0");
  tx.setSupplyType(TokenSupplyType.Finite);
  tx.setMaxSupply(parsed.maxSupply.toString());
  if (royaltySpec) {
    const fee = new CustomRoyaltyFee()
      .setNumerator(royaltySpec.points)
      .setDenominator(10000)
      .setFeeCollectorAccountId(royaltySpec.collector || accountId);
    if (royaltySpec.fallback) {
      fee.setFallbackFee(new CustomFixedFee().setHbarAmount(Hbar.from(royaltySpec.fallback)));
    }
    tx.setCustomFees([fee]);
  }
  const created = await submitCreate(tx, signer, dAppConnector);
  return resultLinks(created.tokenId, created.txId);
}

function validateMetadata(list) {
  if (!Array.isArray(list) || list.length === 0) throw userFacing("Add at least one link");
  const items = [];
  for (const entry of list) {
    if (typeof entry !== "string") throw userFacing("Each link must start with ipfs://, https://, or hcs://1/");
    const text = entry.trim();
    if (!METADATA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
      throw userFacing("Each link must start with ipfs://, https://, or hcs://1/");
    }
    if (utf8Size(text) > 100) throw userFacing("Each link must be 100 bytes or less");
    items.push(text);
  }
  return items;
}

function serialList(receipt) {
  const serials = receipt && receipt.serials;
  if (!Array.isArray(serials) || serials.length === 0) throw new Error("Mint receipt has no serials");
  return serials.map((serial) => {
    const text = serial && typeof serial.toString === "function" ? serial.toString() : String(serial);
    if (!/^(0|[1-9]\d*)$/.test(text)) throw new Error("Mint receipt has no serials");
    return text;
  });
}

function partialMintError(tokenId, mintedSerials, sentCount, txIds, cause) {
  const err = new Error(`Minting stopped. ${mintedSerials.length} NFTs were minted.`);
  err.userFacing = true;
  err.tokenId = tokenId;
  err.mintedSerials = mintedSerials.slice();
  err.sentCount = sentCount;
  err.txIds = txIds.slice();
  if (cause) err.cause = cause;
  return err;
}

export async function mintNfts(tokenId, metadataList) {
  const id = requireAccount(tokenId, "Enter a token id like 0.0.123");
  const metadata = validateMetadata(metadataList);
  const { signer, dAppConnector, accountId } = await wallet();
  await userPublicKey(accountId);
  const mintedSerials = [];
  const txIds = [];
  let sentCount = 0;
  for (let index = 0; index < metadata.length; index += MINT_CHUNK) {
    const chunk = metadata.slice(index, index + MINT_CHUNK);
    const tx = new TokenMintTransaction()
      .setTokenId(id)
      .setMetadata(chunk.map((text) => new TextEncoder().encode(text)));
    try {
      const nodeAddresses = await dAppConnector.getNodeAddresses();
      freezeForConnectedAccount(tx, signer, nodeAddresses);
      const txResponse = await tx.executeWithSigner(signer);
      const txId = readTxId(txResponse);
      txIds.push(txId);
      sentCount += chunk.length;
      const receipt = await txResponse.getReceiptWithSigner(signer);
      requireSuccess(receipt);
      mintedSerials.push(...serialList(receipt));
    } catch (err) {
      if (txIds.length > 0) throw partialMintError(id, mintedSerials, sentCount, txIds, err);
      throw err;
    }
  }
  const txId = txIds[txIds.length - 1];
  return {
    ...resultLinks(id, txId),
    serials: mintedSerials,
    txIds,
  };
}

// supply_key on a token info body is { _type, key } with a raw hex key.
// Some responses put that same hex in a bare string. Compare lowercase,
// and also accept the DER text from the public key.
function mirrorKeyHex(supplyKey) {
  const raw = typeof supplyKey === "string"
    ? supplyKey
    : (supplyKey && typeof supplyKey.key === "string" ? supplyKey.key : "");
  return String(raw).trim().toLowerCase().replace(/^0x/, "");
}

function sameSupplyKey(publicKey, supplyKey) {
  if (!publicKey || typeof publicKey.toStringRaw !== "function") return false;
  const raw = String(publicKey.toStringRaw()).trim().toLowerCase().replace(/^0x/, "");
  const hex = mirrorKeyHex(supplyKey);
  if (!raw || !/^[0-9a-f]+$/.test(hex)) return false;
  if (hex === raw) return true;
  if (typeof publicKey.toStringDer === "function") {
    const der = String(publicKey.toStringDer()).trim().toLowerCase().replace(/^0x/, "");
    if (der && hex === der) return true;
  }
  return false;
}

function decimalField(value) {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return value;
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function nextListUrl(next) {
  if (typeof next !== "string" || next === "") return "";
  if (next.startsWith("/")) return MIRROR_NODE + next;
  if (next.startsWith(`${MIRROR_NODE}/`)) return next;
  throw new Error("Could not read your collections");
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = [];
  const count = Math.min(limit, items.length);
  for (let worker = 0; worker < count; worker++) {
    workers.push((async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

function collectionFrom(detail, id, accountId, publicKey) {
  if (!detail || typeof detail !== "object") return null;
  if (detail.token_id != null && detail.token_id !== id) return null;
  if (detail.treasury_account_id !== accountId) return null;
  if (!sameSupplyKey(publicKey, detail.supply_key)) return null;
  const totalSupply = decimalField(detail.total_supply);
  const maxSupply = decimalField(detail.max_supply);
  if (totalSupply == null || maxSupply == null) return null;
  return {
    tokenId: id,
    name: typeof detail.name === "string" ? detail.name : "",
    symbol: typeof detail.symbol === "string" ? detail.symbol : "",
    totalSupply,
    maxSupply,
  };
}

export async function listMyCollections(accountId) {
  const id = requireAccount(accountId);
  const ids = [];
  let url = `${MIRROR_NODE}/api/v1/tokens?account.id=${encodeURIComponent(id)}&type=NON_FUNGIBLE_UNIQUE&limit=100`;
  for (let page = 0; page < LIST_PAGE_LIMIT && ids.length < LIST_TOKEN_LIMIT; page++) {
    let data;
    try {
      data = await mirrorRead(url);
    } catch {
      throw new Error("Could not read your collections");
    }
    const tokens = data && Array.isArray(data.tokens) ? data.tokens : null;
    if (!tokens) throw new Error("Could not read your collections");
    for (const row of tokens) {
      if (ids.length >= LIST_TOKEN_LIMIT) break;
      const tokenId = row && typeof row.token_id === "string" ? row.token_id : "";
      if (ACCOUNT_ID.test(tokenId)) ids.push(tokenId);
    }
    if (ids.length >= LIST_TOKEN_LIMIT) break;
    const next = data.links && data.links.next;
    if (!next) break;
    url = nextListUrl(next);
  }
  if (!ids.length) return [];
  const publicKey = await userPublicKey(id);
  const details = await mapPool(ids, DETAIL_CONCURRENCY, async (tokenId) => {
    try {
      return await mirrorRead(`${MIRROR_NODE}/api/v1/tokens/${encodeURIComponent(tokenId)}`);
    } catch {
      return null;
    }
  });
  const collections = [];
  for (let index = 0; index < ids.length; index++) {
    const row = collectionFrom(details[index], ids[index], id, publicKey);
    if (row) collections.push(row);
  }
  return collections;
}
