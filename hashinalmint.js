// Hashinal (HCS-5) mint in three wallet-signed steps: inscribe the file,
// inscribe HIP-412 metadata whose image points at that topic, then mint
// one NFT whose metadata is hcs://1/<meta topic>. Mainnet only. No server
// key and no server storage.
//
// Resume state stays in memory on the thrown error. submitKey is a private
// key, so this file never writes it to localStorage, sessionStorage,
// IndexedDB, or a server. A retry passes that same object back with the
// same prepared bytes and continues at the failed chunk. A non-secret
// checkpoint (topic id, memo, counts, no key) lives in hashinaljob.js.

import {
  HCS1_INSCRIBE_MAX_BYTES,
  buildHcs1Inscription,
  estimateHcs1Cost,
} from "./hcs1inscribe.js";
import { inscribePrepared, prepareInscribeFile } from "./hcs1inscribewallet.js";
import { checkMintByMetadata, checkMintTx, mintNfts } from "./tokenmint.js";

export const MINT_NFT_USD = 0.02;
const PLACEHOLDER_TOPIC = "0.0.9999999999";
const TOPIC_ID = /^0\.0\.\d+$/;

function userFacing(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

function utf8Size(text) {
  return new TextEncoder().encode(text).length;
}

function requireTopic(value, message) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!TOPIC_ID.test(text)) throw userFacing(message || "Enter a topic id like 0.0.123");
  return text;
}

function requireName(value) {
  if (typeof value !== "string") throw userFacing("Name must be 1 to 100 bytes");
  const text = value.trim();
  const size = utf8Size(text);
  if (size < 1 || size > 100) throw userFacing("Name must be 1 to 100 bytes");
  return text;
}

function optionalBytes(value, max, message) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw userFacing(message);
  const text = value.trim();
  if (utf8Size(text) > max) throw userFacing(message);
  return text;
}

function requireMime(value) {
  if (typeof value !== "string") throw userFacing("This file has no type");
  const text = value.trim();
  if (!text) throw userFacing("This file has no type");
  return text;
}

function readAttributes(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw userFacing("Traits must be a list");
  const kept = [];
  for (const item of list) {
    if (item == null || typeof item !== "object") continue;
    if (item.trait_type == null || item.trait_type === "") continue;
    if (typeof item.trait_type !== "string") throw userFacing("Trait names must be text");
    const trait = item.trait_type.trim();
    if (!trait) continue;
    if (utf8Size(trait) > 100) throw userFacing("Trait names must be 100 bytes or less");
    if (item.value == null || item.value === "") continue;
    let value = item.value;
    if (typeof value === "string") {
      value = value.trim();
      if (!value) continue;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) throw userFacing("Trait values must be text or a number");
    } else {
      throw userFacing("Trait values must be text or a number");
    }
    kept.push({ trait_type: trait, value });
  }
  if (kept.length > 50) throw userFacing("Use 50 traits or fewer");
  return kept;
}

function isImage(mime) {
  return mime.toLowerCase().startsWith("image/");
}

// HIP-412 JSON. Keys stay in this order so two builds of the same fields
// compare as equal strings. The placeholder topic used for a price estimate
// is longer than a real id, which keeps that estimate an upper bound.
export function buildHashinalMetadata({ name, description, attributes, creator, mime, fileTopicId } = {}) {
  const topic = requireTopic(fileTopicId, "Enter a topic id like 0.0.123");
  const title = requireName(name);
  const about = optionalBytes(description, 1000, "Description must be 1000 bytes or less");
  const by = optionalBytes(creator, 100, "Creator must be 100 bytes or less");
  const type = requireMime(mime);
  const traits = readAttributes(attributes);
  const image = `hcs://1/${topic}`;
  const doc = {
    format: "HIP412@2.0.0",
    name: title,
  };
  if (about) doc.description = about;
  if (by) doc.creator = by;
  doc.image = image;
  doc.type = type;
  doc.attributes = traits;
  if (!isImage(type)) doc.files = [{ uri: image, type }];
  return JSON.stringify(doc);
}

function fileOverCap(prepared) {
  if (!prepared || prepared.overCap === true) return true;
  const size = prepared.bytes && prepared.bytes.byteLength;
  return typeof size === "number" && size > HCS1_INSCRIBE_MAX_BYTES;
}

function fileQuote(prepared) {
  const txCount = prepared.txCount;
  const usd = prepared.usd;
  if (typeof txCount !== "number" || typeof usd !== "number") {
    throw new Error("file is over 2 MB");
  }
  return { txCount, usd };
}

// Confirm-card price. No network and no wallet. The metadata side is priced
// with a placeholder topic id so the figure is an upper bound.
export async function estimateHashinalMint({ prepared, name, description, attributes, creator } = {}) {
  if (fileOverCap(prepared)) throw new Error("file is over 2 MB");
  const file = fileQuote(prepared);
  const json = buildHashinalMetadata({
    name,
    description,
    attributes,
    creator,
    mime: prepared.mime,
    fileTopicId: PLACEHOLDER_TOPIC,
  });
  const built = await buildHcs1Inscription(new TextEncoder().encode(json), "application/json");
  const meta = estimateHcs1Cost(Math.max(0, built.txCount - 1));
  const mint = { txCount: 1, usd: MINT_NFT_USD };
  return {
    file,
    meta,
    mint,
    total: {
      approvals: file.txCount + meta.txCount + mint.txCount,
      usd: file.usd + meta.usd + mint.usd,
    },
  };
}

// One prepare. The caller keeps the object and passes it back on Resume,
// so the file is not read or compressed again.
export async function prepareHashinal(file, opts) {
  return prepareInscribeFile(file, opts);
}

async function notify(onProgress, event) {
  if (typeof onProgress !== "function") return;
  await onProgress(event);
}

function chunkResume(err) {
  if (!err || typeof err !== "object") return undefined;
  if (!err.topicId && err.submitKey == null && !Array.isArray(err.sentIndexes)) return undefined;
  return {
    topicId: err.topicId,
    submitKey: err.submitKey,
    sentIndexes: Array.isArray(err.sentIndexes) ? err.sentIndexes.slice() : [],
  };
}

function dedupedIds(lists) {
  const ids = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item !== "string" || !item || ids.includes(item)) continue;
      ids.push(item);
    }
  }
  return ids;
}

function mintCheckFrom(cause, state) {
  const txIds = dedupedIds([cause && cause.txIds, cause && cause.maybeSentTxIds]);
  if (!txIds.length || !state.metaTopicId) return null;
  return {
    txIds,
    tokenId: state.tokenId,
    metadata: `hcs://1/${state.metaTopicId}`,
  };
}

function failure(step, cause, state) {
  const err = new Error(cause && cause.message ? String(cause.message) : "Hashinal mint failed");
  if (cause && cause.userFacing) err.userFacing = cause.userFacing;
  if (cause && cause.mintUnconfirmed) err.mintUnconfirmed = true;
  if (cause && cause.mintFailed) err.mintFailed = true;
  err.step = step;
  const next = {};
  if (state.fileTopicId) next.fileTopicId = state.fileTopicId;
  if (state.metaTopicId) next.metaTopicId = state.metaTopicId;
  if (state.metaPrepared) next.metaPrepared = state.metaPrepared;
  if (step === "file") {
    const partial = chunkResume(cause);
    if (partial) next.file = partial;
  }
  if (step === "meta") {
    const partial = chunkResume(cause);
    if (partial) next.meta = partial;
  }
  if (step === "mint") {
    const check = mintCheckFrom(cause, state);
    if (check) {
      err.mintMaybeSent = true;
      err.txIds = check.txIds.slice();
      next.mintCheck = check;
    } else if (state.mintCheck) {
      next.mintCheck = state.mintCheck;
    }
  }
  err.resume = next;
  return err;
}

// Clears the key fields on the resume object only. The caller's submitKey
// is a different binding and is left alone.
function dropKeys(resume) {
  if (!resume || typeof resume !== "object") return;
  if (Object.prototype.hasOwnProperty.call(resume, "submitKey")) resume.submitKey = null;
  if (resume.file && typeof resume.file === "object") resume.file.submitKey = null;
  if (resume.meta && typeof resume.meta === "object") resume.meta.submitKey = null;
}

function topicFrom(result) {
  const topicId = result && typeof result.topicId === "string" ? result.topicId : "";
  if (!TOPIC_ID.test(topicId)) throw new Error("createTopic did not return a topic id");
  return topicId;
}

function hashscanTx(txId) {
  const text = String(txId || "").trim();
  const match = text.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/);
  if (!match) return "";
  return `https://hashscan.io/mainnet/transaction/${match[1]}-${match[2]}-${match[3].padStart(9, "0")}`;
}

function storedMint(minted, tokenId) {
  const serials = minted && Array.isArray(minted.serials)
    ? minted.serials.filter((serial) => serial != null).map((serial) => String(serial))
    : [];
  return {
    tokenId: (minted && minted.tokenId) || tokenId,
    serials,
    txId: minted && minted.txId ? String(minted.txId) : "",
    hashscanUrl: minted && minted.hashscanUrl ? String(minted.hashscanUrl) : hashscanTx(minted && minted.txId),
    tokenUrl: minted && minted.tokenUrl
      ? String(minted.tokenUrl)
      : `https://hashscan.io/mainnet/token/${tokenId}`,
  };
}

function unconfirmed(message) {
  const err = userFacing(message);
  err.mintUnconfirmed = true;
  return err;
}

async function connectedAccount() {
  const web3 = await import("./web3.js");
  const signer = web3 && web3.signer;
  if (!signer || typeof signer.getAccountId !== "function") throw new Error("Connect wallet first");
  const account = signer.getAccountId();
  const text = typeof account === "string"
    ? account
    : (account && typeof account.toString === "function" ? account.toString() : "");
  if (!/^(\d+\.\d+\.\d+)$/.test(typeof text === "string" ? text.trim() : "")) {
    throw new Error("Connect wallet first");
  }
  return text.trim();
}

async function lookupMint(check) {
  const txIds = Array.isArray(check.txIds) ? check.txIds : [];
  let failed = false;
  for (const txId of txIds) {
    let looked = { status: "unknown" };
    try {
      looked = await checkMintTx(txId, check.tokenId);
    } catch {
      looked = { status: "unknown" };
    }
    if (looked && looked.status === "minted" && Array.isArray(looked.serials) && looked.serials.length) {
      return storedMint({ serials: looked.serials, txId, tokenId: check.tokenId }, check.tokenId);
    }
    if (looked && looked.status === "failed") failed = true;
  }
  if (failed) {
    const err = unconfirmed("The mint transaction failed. It was not minted again.");
    // Hedera said this transaction failed, so a later mint is a new one.
    err.mintFailed = true;
    throw err;
  }
  let account = "";
  try {
    account = await connectedAccount();
  } catch {
    account = "";
  }
  if (account && check.metadata) {
    let looked = { status: "unknown" };
    try {
      looked = await checkMintByMetadata(check.tokenId, account, check.metadata);
    } catch {
      looked = { status: "unknown" };
    }
    if (looked && looked.status === "minted" && Array.isArray(looked.serials) && looked.serials.length) {
      return storedMint({ serials: looked.serials, tokenId: check.tokenId }, check.tokenId);
    }
  }
  throw unconfirmed("The mint is not on the mirror yet. It was not minted again.");
}

function topicForward(onTopic, step) {
  if (typeof onTopic !== "function") return undefined;
  return (info) => onTopic({
    step,
    topicId: info && info.topicId,
    memo: info && info.memo,
    total: info && info.total,
  });
}

/**
 * File, then metadata, then one NFT. Pass err.resume back as resume to
 * continue from the failed chunk.
 *
 * A mint that may already have been broadcast sets mintMaybeSent and
 * resume.mintCheck. The next call reads the mirror and does not mint
 * again. confirmRemint may be true only after the user agrees to a second
 * mint: that drops mintCheck and calls mintNfts once. resume.minted skips
 * the mint and returns the serial that was already stored.
 *
 * submitKey, when passed, signs both inscriptions. It is not stored here.
 * onTopic reports each topic after it exists and before its first chunk.
 */
export async function runHashinalMint({
  prepared,
  tokenId,
  name,
  description,
  attributes,
  creator,
  onProgress,
  onTopic,
  submitKey,
  resume,
  confirmRemint = false,
} = {}) {
  const id = requireTopic(tokenId, "Enter a token id like 0.0.123");
  const mime = prepared && typeof prepared.mime === "string" ? prepared.mime : "";
  // Reject a bad name or trait before any inscription is paid for.
  buildHashinalMetadata({
    name,
    description,
    attributes,
    creator,
    mime,
    fileTopicId: "0.0.1",
  });

  const state = {
    tokenId: id,
    fileTopicId: resume && resume.fileTopicId ? requireTopic(resume.fileTopicId, "Enter a topic id like 0.0.123") : "",
    metaTopicId: resume && resume.metaTopicId ? requireTopic(resume.metaTopicId, "Enter a topic id like 0.0.123") : "",
    metaPrepared: resume && resume.metaPrepared ? resume.metaPrepared : null,
    mintCheck: resume && resume.mintCheck ? resume.mintCheck : null,
  };
  if (confirmRemint && state.mintCheck) {
    state.mintCheck = null;
    if (resume) resume.mintCheck = null;
  }

  if (!state.fileTopicId) {
    if (fileOverCap(prepared)) throw new Error("file is over 2 MB");
    try {
      const result = await inscribePrepared(prepared, {
        onProgress: (progress) => notify(onProgress, {
          step: "file",
          sent: progress && progress.sent,
          total: progress && progress.total,
          topicId: progress && progress.topicId,
        }),
        onTopic: topicForward(onTopic, "file"),
        submitKey,
        resume: resume && resume.file ? resume.file : undefined,
      });
      state.fileTopicId = topicFrom(result);
    } catch (err) {
      throw failure("file", err, state);
    }
  }

  if (!state.metaTopicId) {
    if (!state.metaPrepared) {
      const json = buildHashinalMetadata({
        name,
        description,
        attributes,
        creator,
        mime: requireMime(mime),
        fileTopicId: state.fileTopicId,
      });
      state.metaPrepared = {
        bytes: new TextEncoder().encode(json),
        mime: "application/json",
        name: "metadata.json",
        overCap: false,
      };
    }
    try {
      const result = await inscribePrepared(state.metaPrepared, {
        onProgress: (progress) => notify(onProgress, {
          step: "meta",
          sent: progress && progress.sent,
          total: progress && progress.total,
          topicId: progress && progress.topicId,
        }),
        onTopic: topicForward(onTopic, "meta"),
        submitKey,
        resume: resume && resume.meta ? resume.meta : undefined,
      });
      state.metaTopicId = topicFrom(result);
    } catch (err) {
      throw failure("meta", err, state);
    }
  }

  const remembered = resume && resume.minted ? storedMint(resume.minted, id) : null;
  let minted = remembered && remembered.serials.length ? remembered : null;
  if (!minted && state.mintCheck) {
    try {
      minted = await lookupMint(state.mintCheck);
      await notify(onProgress, { step: "mint", sent: 1, total: 1 });
    } catch (err) {
      throw failure("mint", err, state);
    }
  }
  if (!minted) {
    try {
      await notify(onProgress, { step: "mint", sent: 0, total: 1 });
      minted = storedMint(await mintNfts(id, [`hcs://1/${state.metaTopicId}`]), id);
      await notify(onProgress, { step: "mint", sent: 1, total: 1 });
    } catch (err) {
      throw failure("mint", err, state);
    }
  }

  dropKeys(resume);
  dropKeys(resume && resume.file);
  dropKeys(resume && resume.meta);

  const serial = minted.serials && minted.serials[0] != null ? String(minted.serials[0]) : "";
  if (!serial) throw new Error("Mint receipt has no serials");
  if (resume && typeof resume === "object") resume.minted = minted;
  return {
    tokenId: minted.tokenId || id,
    serial,
    fileTopicId: state.fileTopicId,
    metaTopicId: state.metaTopicId,
    fileHrl: `hcs://1/${state.fileTopicId}`,
    metaHrl: `hcs://1/${state.metaTopicId}`,
    txId: minted.txId,
    hashscanUrl: minted.hashscanUrl,
    tokenUrl: minted.tokenUrl,
  };
}
