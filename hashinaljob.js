// Hashinal mint checkpoint. This is the only file that touches storage.
//
// The saved job is a whitelist: topic ids, the memo, counts, the form, and
// the public key when the person brought their own. It never holds a
// submit key, a private key, a seed, or the file bytes. A key stays in
// memory for this tab, or the person types it again. hashinalmint.js still
// keeps its own resume in memory; this runner copies only the safe fields
// out of it.

import { PrivateKey } from "@hashgraph/sdk";
import { HCS1_INSCRIBE_MAX_BYTES } from "./hcs1inscribe.js";
import { buildHashinalMetadata, prepareHashinal, runHashinalMint } from "./hashinalmint.js";
import { checkTopicByCount, recoverInscription } from "./hashinalrecover.js";
import { checkCollectionAccess } from "./tokenmint.js";

const KEY_PREFIX = "w3g-hashinal:";
const ACCOUNT_ID = /^\d+\.\d+\.\d+$/;
const TOPIC_ID = /^0\.0\.\d+$/;
const HEX = /^[0-9a-fA-F]+$/;
const DECLINE = /reject|cancel|denied|closed/i;
const PRIVATE_DER_PREFIXES = [
  "302e020100300506032b657004220420",
  "3030020100300706052b8104000a04220420",
];
const SAVE_WARNING = "Could not save mint progress in this browser";
const MINT_FAILED_REASON = "The mint failed on Hedera. Nothing was minted.";
const LOST_KEY_REASON = "That inscription was cut off and its key is gone";
const WRONG_FILE_REASON = "This is not the file that was inscribed";
const WRONG_KEY_REASON = "That key does not match this inscription";
const CONFLICT_REASON = "The topic has an unexpected message";
const BUSY_REASON = "Finish or dismiss the unfinished Hashinal first";
const KEY_REASON = "That is not a private key we can read";
const OTHER_ACCOUNT = "This Hashinal belongs to another account";

let fallbackStorage = null;

function userFacing(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

function privateMaterial(text) {
  const lower = String(text || "").toLowerCase();
  return PRIVATE_DER_PREFIXES.some((prefix) => lower.includes(prefix));
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // A locked-down page can throw just for touching localStorage.
  }
  if (!fallbackStorage) fallbackStorage = memoryStorage();
  return fallbackStorage;
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
}

function jobStorageKey(accountId) {
  return `${KEY_PREFIX}${accountId}`;
}

function copyAttributes(list) {
  if (!Array.isArray(list)) return [];
  const kept = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.trait_type !== "string") continue;
    const value = item.value;
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      kept.push({ trait_type: item.trait_type, value });
    }
  }
  return kept;
}

function topicSlot(topic) {
  if (!topic || typeof topic !== "object") return null;
  const topicId = typeof topic.topicId === "string" ? topic.topicId : "";
  if (!TOPIC_ID.test(topicId)) return null;
  const total = Number.isInteger(topic.total) && topic.total >= 0 ? topic.total : 0;
  return {
    topicId,
    memo: typeof topic.memo === "string" ? topic.memo : "",
    total,
  };
}

function mintedSlot(minted) {
  if (!minted || typeof minted !== "object") return null;
  const serials = Array.isArray(minted.serials)
    ? minted.serials.filter((serial) => serial != null && !privateMaterial(serial)).map((serial) => String(serial))
    : [];
  const txId = typeof minted.txId === "string" && !privateMaterial(minted.txId) ? minted.txId : "";
  if (!serials.length && !txId) return null;
  return { serials, txId };
}

function storedPublicKey(job) {
  if (job.keyMode !== "own") return "";
  if (typeof job.publicKey !== "string" || !job.publicKey) return "";
  if (privateMaterial(job.publicKey)) return "";
  if (/^[0-9a-fA-F]{64}$/.test(job.publicKey)) return "";
  return job.publicKey;
}

// Whitelist copy. Unknown fields, keys, and file bytes are dropped.
function storedJob(job) {
  const form = job.form && typeof job.form === "object" ? job.form : {};
  const file = job.file && typeof job.file === "object" ? job.file : {};
  const topics = job.topics && typeof job.topics === "object" ? job.topics : {};
  const mint = job.mint && typeof job.mint === "object" ? job.mint : {};
  const txIds = [];
  for (const id of Array.isArray(mint.txIds) ? mint.txIds : []) {
    if (typeof id !== "string" || !id || privateMaterial(id) || txIds.includes(id)) continue;
    txIds.push(id);
  }
  const stored = {
    v: 1,
    accountId: typeof job.accountId === "string" ? job.accountId : "",
    tokenId: typeof job.tokenId === "string" ? job.tokenId : "",
    keyMode: job.keyMode === "own" ? "own" : "memory",
    form: {
      name: typeof form.name === "string" ? form.name : "",
      description: typeof form.description === "string" ? form.description : "",
      creator: typeof form.creator === "string" ? form.creator : "",
      attributes: copyAttributes(form.attributes),
    },
    file: {
      name: typeof file.name === "string" ? file.name : "",
      mime: typeof file.mime === "string" ? file.mime : "",
      size: typeof file.size === "number" && Number.isFinite(file.size) ? file.size : 0,
    },
    topics: {
      file: topicSlot(topics.file),
      meta: topicSlot(topics.meta),
    },
    mint: {
      inflight: mint.inflight === true,
      txIds,
      minted: mintedSlot(mint.minted),
    },
    step: typeof job.step === "string" ? job.step : "",
    status: typeof job.status === "string" ? job.status : "idle",
    reason: typeof job.reason === "string" ? job.reason : "",
    createdAt: typeof job.createdAt === "number" && Number.isFinite(job.createdAt) ? job.createdAt : 0,
  };
  const publicKey = storedPublicKey(stored.keyMode === "own" ? job : { keyMode: "memory" });
  if (publicKey) stored.publicKey = publicKey;
  return stored;
}

function normalizeLoaded(job) {
  // A closed tab leaves status "running". A mint that had opened the
  // wallet may have been broadcast, so it comes back unconfirmed.
  if (job.status === "running") {
    if (job.mint && job.mint.inflight) {
      job.status = "unconfirmed";
      if (!job.reason) job.reason = "Not confirmed on Hedera yet";
    } else {
      job.status = "interrupted";
    }
  }
  return job;
}

function readStored(store, key) {
  let raw;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || typeof parsed.accountId !== "string") return null;
    return normalizeLoaded(storedJob(parsed));
  } catch {
    return null;
  }
}

export function loadHashinalJob(accountId, storage) {
  const id = typeof accountId === "string" ? accountId.trim() : "";
  const job = readStored(resolveStorage(storage), jobStorageKey(id));
  if (!job) return null;
  if (job.accountId !== id) throw userFacing(OTHER_ACCOUNT);
  return job;
}

function saveJob(job, storage) {
  if (!job || typeof job.accountId !== "string") return false;
  try {
    resolveStorage(storage).setItem(jobStorageKey(job.accountId), JSON.stringify(storedJob(job)));
    return true;
  } catch {
    job.persistError = true;
    return false;
  }
}

export function discardHashinalJob(accountId, storage) {
  const id = typeof accountId === "string" ? accountId.trim() : "";
  try {
    resolveStorage(storage).removeItem(jobStorageKey(id));
  } catch {
    // Dropping a finished job must not trap the caller.
  }
}

/**
 * DER hex from Create keys (ED25519 or ECDSA), or a bare 64-hex ED25519 key.
 * The error never echoes the text.
 */
export function parseSubmitKey(text) {
  if (typeof text !== "string") throw userFacing(KEY_REASON);
  const raw = text.trim();
  if (!raw || !HEX.test(raw)) throw userFacing(KEY_REASON);
  try {
    const key = raw.length === 64 ? PrivateKey.fromStringED25519(raw) : PrivateKey.fromString(raw);
    if (!key || !key.publicKey || typeof key.publicKey.toString !== "function") throw userFacing(KEY_REASON);
    const der = typeof key.toString === "function" ? key.toString() : "";
    const type = String(der).toLowerCase().startsWith("3030020100300706052b8104000a") ? "ECDSA" : "ED25519";
    return { key, publicKey: key.publicKey.toString(), type };
  } catch (err) {
    if (err && err.userFacing) throw err;
    throw userFacing(KEY_REASON);
  }
}

/**
 * Same key pair Toolbar > Create > Create keys makes. The default generator
 * is loaded only when this runs, because hedera.js pulls in the wallet.
 */
export async function generateOwnKey({ generate } = {}) {
  const gen = typeof generate === "function" ? generate : async () => {
    const mod = await import("./hedera.js");
    return mod.generatePrivateAndPublicKey();
  };
  const made = await gen();
  const parsed = parseSubmitKey(made && made.privateKey);
  return { privateKey: parsed.key.toString(), publicKey: parsed.publicKey };
}

export async function preflightCollection(tokenId, accountId, { check } = {}) {
  const fn = check || checkCollectionAccess;
  let result;
  try {
    result = await fn(tokenId, accountId);
  } catch {
    return { ok: false, reason: "Could not read the collection", remaining: null };
  }
  if (!result || result.ok !== true) {
    const reason = result && typeof result.reason === "string" && result.reason
      ? result.reason
      : "Could not read the collection";
    return { ok: false, reason, remaining: null };
  }
  return {
    ok: true,
    reason: "",
    remaining: result.remaining == null ? null : String(result.remaining),
  };
}

function overCap(prepared) {
  if (!prepared || prepared.overCap === true) return true;
  const size = prepared.bytes && prepared.bytes.byteLength;
  return typeof size === "number" && size > HCS1_INSCRIBE_MAX_BYTES;
}

function fileSize(prepared) {
  const size = prepared && prepared.bytes && prepared.bytes.byteLength;
  return typeof size === "number" && Number.isFinite(size) ? size : 0;
}

function errorText(err) {
  return err && err.message ? String(err.message) : "";
}

function isDecline(err) {
  return DECLINE.test(errorText(err));
}

function safeText(err) {
  const message = errorText(err);
  if (!message || privateMaterial(message) || /[0-9a-fA-F]{64,}/.test(message)) return "Hashinal mint failed";
  return message;
}

function txIdsOf(err) {
  const lists = [
    err && err.txIds,
    err && err.maybeSentTxIds,
    err && err.resume && err.resume.mintCheck && err.resume.mintCheck.txIds,
  ];
  const ids = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const id of list) {
      if (typeof id !== "string" || !id || privateMaterial(id) || ids.includes(id)) continue;
      ids.push(id);
    }
  }
  return ids;
}

function hasTopic(job) {
  return !!(job && job.topics && ((job.topics.file && job.topics.file.topicId) || (job.topics.meta && job.topics.meta.topicId)));
}

function mintReady(job) {
  return !!(job && job.topics && job.topics.file && job.topics.file.topicId && job.topics.meta && job.topics.meta.topicId);
}

function isMintFailed(job) {
  return !!(job && job.status === "paused" && job.step === "mint" && job.reason === MINT_FAILED_REASON);
}

/**
 * One Hashinal at a time for this account. start and resume do nothing
 * while a run is already going. The key, when this tab has one, is held
 * on the runner and wiped after done.
 */
export function createHashinalRunner({
  accountId,
  storage,
  run = runHashinalMint,
  recover = recoverInscription,
  readTopicCheck = checkTopicByCount,
  prepareFile = prepareHashinal,
  now = Date.now,
  preflight = preflightCollection,
} = {}) {
  const id = typeof accountId === "string" ? accountId.trim() : "";
  const listeners = {
    status: new Set(),
    progress: new Set(),
    topic: new Set(),
    done: new Set(),
    warning: new Set(),
  };
  let job = null;
  let running = false;
  let warned = false;
  let needs = null;
  let result = null;
  let heldKey = null;
  let memoryResume = null;
  let preparedMem = null;
  let fileDone = false;
  let metaDone = false;
  let fileTx = 0;
  let progress = { step: "", sent: 0, total: 0, approvalsDone: 0, approvalsTotal: 0 };

  function emit(name, payload) {
    const set = listeners[name];
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch {
        // A listener must not stop the mint.
      }
    }
  }

  function emitStatus() {
    emit("status", {
      status: job ? job.status : "idle",
      reason: job && job.reason ? job.reason : "",
    });
  }

  function persist() {
    if (!job) return;
    const ok = saveJob(job, storage);
    if (!ok && !warned) {
      warned = true;
      emit("warning", { message: SAVE_WARNING });
    }
  }

  function keyFromMemory() {
    if (heldKey) return heldKey;
    const fileKey = memoryResume && memoryResume.file && memoryResume.file.submitKey;
    if (fileKey) return fileKey;
    const metaKey = memoryResume && memoryResume.meta && memoryResume.meta.submitKey;
    if (metaKey) return metaKey;
    return null;
  }

  function dropHeld() {
    heldKey = null;
    if (memoryResume && typeof memoryResume === "object") {
      if (memoryResume.file && typeof memoryResume.file === "object") memoryResume.file.submitKey = null;
      if (memoryResume.meta && typeof memoryResume.meta === "object") memoryResume.meta.submitKey = null;
      memoryResume.submitKey = null;
    }
    memoryResume = null;
    preparedMem = null;
  }

  function topicCopy(topic) {
    const slot = topicSlot(topic);
    return slot ? { topicId: slot.topicId, memo: slot.memo, total: slot.total } : null;
  }

  function snapshot() {
    if (!job) {
      try {
        job = loadHashinalJob(id, storage);
      } catch {
        job = null;
      }
    }
    return {
      status: job ? job.status : "idle",
      reason: job && job.reason ? job.reason : "",
      step: job && job.step ? job.step : "",
      progress: {
        step: progress.step,
        sent: progress.sent,
        total: progress.total,
        approvalsDone: progress.approvalsDone,
        approvalsTotal: progress.approvalsTotal,
      },
      needs,
      keyMode: job && job.keyMode ? job.keyMode : "",
      publicKey: job && job.keyMode === "own" && typeof job.publicKey === "string" ? job.publicKey : "",
      topics: {
        file: job && job.topics ? topicCopy(job.topics.file) : null,
        meta: job && job.topics ? topicCopy(job.topics.meta) : null,
      },
      result: result ? { ...result } : null,
    };
  }

  function noteProgress(event) {
    const step = event && typeof event.step === "string" ? event.step : "";
    const sent = Number.isInteger(event && event.sent) ? event.sent : 0;
    const total = Number.isInteger(event && event.total) ? event.total : 0;
    if (step === "file" && total > 0 && sent >= total) fileDone = true;
    if (step === "meta" && total > 0 && sent >= total) metaDone = true;
    const filePart = fileTx || (job && job.topics && job.topics.file ? job.topics.file.total + 1 : 0);
    const metaPart = job && job.topics && job.topics.meta ? job.topics.meta.total + 1 : 0;
    const approvalsTotal = filePart + metaPart + 1;
    let approvalsDone = 0;
    if (fileDone) approvalsDone += filePart;
    else if (step === "file") approvalsDone += Math.min(sent + (job && job.topics && job.topics.file ? 1 : 0), filePart);
    if (metaDone) approvalsDone += metaPart;
    else if (step === "meta") approvalsDone += Math.min(sent + 1, metaPart || sent + 1);
    if (step === "mint" && sent > 0) approvalsDone += 1;
    progress = { step, sent, total, approvalsDone, approvalsTotal };
  }

  async function onProgress(event) {
    noteProgress(event);
    if (!job) return;
    if (event && event.step === "file" && fileDone) job.step = "meta";
    if (event && event.step === "meta" && metaDone) job.step = "mint";
    if (event && event.step === "mint" && event.sent === 0) {
      job.step = "mint";
      job.mint.inflight = true;
      job.status = "running";
    }
    if ((event && event.step === "file" && fileDone)
      || (event && event.step === "meta" && metaDone)
      || (event && event.step === "mint" && event.sent === 0)) {
      persist();
    }
    emit("progress", { ...progress });
  }

  async function onTopic(info) {
    if (!job) return;
    const step = info && info.step === "meta" ? "meta" : "file";
    const topicId = info && typeof info.topicId === "string" ? info.topicId : "";
    const memo = info && typeof info.memo === "string" ? info.memo : "";
    const total = Number.isInteger(info && info.total) ? info.total : 0;
    if (!TOPIC_ID.test(topicId)) return;
    job.topics[step] = { topicId, memo, total };
    job.step = step;
    if (step === "file") fileDone = false;
    if (step === "meta") metaDone = false;
    persist();
    emit("topic", { step, topicId, memo, total });
  }

  function stubPrepared() {
    return {
      bytes: new Uint8Array(),
      mime: job && job.file && job.file.mime ? job.file.mime : "",
      name: job && job.file && job.file.name ? job.file.name : "",
      overCap: false,
    };
  }

  function finish(outcome) {
    const serial = outcome && outcome.serial != null ? String(outcome.serial) : "";
    result = {
      tokenId: (outcome && outcome.tokenId) || job.tokenId,
      serial,
      fileTopicId: (outcome && outcome.fileTopicId) || "",
      metaTopicId: (outcome && outcome.metaTopicId) || "",
      fileHrl: (outcome && outcome.fileHrl) || "",
      metaHrl: (outcome && outcome.metaHrl) || "",
      txId: (outcome && outcome.txId) || "",
      hashscanUrl: (outcome && outcome.hashscanUrl) || "",
      tokenUrl: (outcome && outcome.tokenUrl) || "",
    };
    job.mint.minted = { serials: serial ? [serial] : [], txId: result.txId };
    job.mint.txIds = result.txId ? [result.txId] : [];
    job.mint.inflight = false;
    job.status = "done";
    job.step = "mint";
    job.reason = "";
    fileDone = true;
    metaDone = true;
    needs = null;
    persist();
    discardHashinalJob(id, storage);
    dropHeld();
    emit("status", { status: "done" });
    emit("done", { ...result });
    return snapshot();
  }

  function unfinishedInMemory() {
    return !!(job && job.status && job.status !== "done" && job.status !== "idle");
  }

  function fail(err) {
    if (err && err.resume) memoryResume = err.resume;
    const text = errorText(err);
    const early = text === "file is over 2 MB" || (err && err.userFacing && !isDecline(err));
    if (early && !hasTopic(job) && !(err && (err.mintUnconfirmed || err.mintFailed || err.mintMaybeSent))) {
      discardHashinalJob(id, storage);
      const keep = err;
      job = null;
      dropHeld();
      needs = null;
      throw keep;
    }
    if (err && err.mintFailed) {
      job.status = "paused";
      job.step = "mint";
      job.reason = MINT_FAILED_REASON;
      job.mint.inflight = false;
      job.mint.txIds = [];
      needs = null;
      persist();
      emitStatus();
      return snapshot();
    }
    const ids = txIdsOf(err);
    if (err && (err.mintUnconfirmed || err.mintMaybeSent || ids.length > 0) && mintReady(job)) {
      job.status = "unconfirmed";
      job.step = "mint";
      job.reason = err.mintUnconfirmed ? safeText(err) : (job.reason || "Not confirmed on Hedera yet");
      if (privateMaterial(job.reason) || /[0-9a-fA-F]{64,}/.test(job.reason || "")) {
        job.reason = "Not confirmed on Hedera yet";
      }
      job.mint.inflight = true;
      if (ids.length) job.mint.txIds = ids;
      needs = null;
      persist();
      emitStatus();
      return snapshot();
    }
    if (isDecline(err)) {
      job.status = "paused";
      job.reason = "Wallet declined";
      if (!ids.length) job.mint.inflight = false;
      needs = null;
      persist();
      emitStatus();
      return snapshot();
    }
    job.status = "paused";
    job.reason = safeText(err);
    needs = null;
    persist();
    emitStatus();
    return snapshot();
  }

  async function execute(plan) {
    running = true;
    job.status = "running";
    needs = null;
    persist();
    emitStatus();
    try {
      const outcome = await run({
        prepared: plan.prepared,
        tokenId: job.tokenId,
        name: job.form.name,
        description: job.form.description,
        creator: job.form.creator,
        attributes: job.form.attributes,
        onProgress,
        onTopic,
        submitKey: plan.submitKey,
        resume: plan.resume,
        confirmRemint: plan.confirmRemint === true,
      });
      return finish(outcome);
    } catch (err) {
      return fail(err);
    } finally {
      running = false;
    }
  }

  function stopWith(status, reason, need) {
    return { stop: true, status, reason: reason || "", needs: need || null };
  }

  async function planFile(topic, key, file) {
    if (!key) {
      const checked = await readTopicCheck({ topicId: topic.topicId, memo: topic.memo, total: topic.total });
      if (!checked || checked.status === "wrong-topic") return stopWith("lost", CONFLICT_REASON, null);
      if (checked.status === "complete") {
        fileDone = true;
        return { resumePart: { fileTopicId: topic.topicId } };
      }
      if (job.keyMode === "memory") {
        job.topics.file = null;
        return stopWith("lost", LOST_KEY_REASON, null);
      }
      return stopWith("interrupted", "", "key");
    }
    if (!file && !preparedMem) {
      const checked = await readTopicCheck({ topicId: topic.topicId, memo: topic.memo, total: topic.total });
      if (checked && checked.status === "complete") {
        fileDone = true;
        return { resumePart: { fileTopicId: topic.topicId } };
      }
      if (checked && checked.status === "wrong-topic") return stopWith("interrupted", WRONG_FILE_REASON, "file");
      return stopWith("interrupted", "", "file");
    }
    let prepared = preparedMem;
    if (file) prepared = await prepareFile(file);
    let recovered = await recover({ topicId: topic.topicId, prepared, submitKey: key });
    if (recovered && recovered.status === "wrong-file" && file) {
      prepared = await prepareFile(file, { asIs: true });
      recovered = await recover({ topicId: topic.topicId, prepared, submitKey: key });
    }
    if (!recovered || recovered.status === "wrong-file") return stopWith("interrupted", WRONG_FILE_REASON, "file");
    if (recovered.status === "wrong-key") {
      heldKey = null;
      return stopWith("interrupted", WRONG_KEY_REASON, "key");
    }
    if (recovered.status === "conflict") return stopWith("lost", CONFLICT_REASON, null);
    if (recovered.status === "complete") {
      fileDone = true;
      return { resumePart: { fileTopicId: topic.topicId }, prepared };
    }
    return {
      prepared,
      resumePart: {
        file: {
          topicId: topic.topicId,
          submitKey: key,
          sentIndexes: Array.isArray(recovered.sentIndexes) ? recovered.sentIndexes.slice() : [],
        },
      },
    };
  }

  async function planMeta(topic, key, fileTopicId) {
    if (!key) {
      const checked = await readTopicCheck({ topicId: topic.topicId, memo: topic.memo, total: topic.total });
      if (!checked || checked.status === "wrong-topic") return stopWith("lost", CONFLICT_REASON, null);
      if (checked.status === "complete") {
        metaDone = true;
        return { resumePart: { metaTopicId: topic.topicId } };
      }
      if (job.keyMode === "memory") {
        job.topics.meta = null;
        return { resumePart: {} };
      }
      return stopWith("interrupted", "", "key");
    }
    const json = buildHashinalMetadata({
      name: job.form.name,
      description: job.form.description,
      creator: job.form.creator,
      attributes: job.form.attributes,
      mime: job.file.mime,
      fileTopicId,
    });
    const prepared = {
      bytes: new TextEncoder().encode(json),
      mime: "application/json",
      name: "metadata.json",
      overCap: false,
    };
    const recovered = await recover({ topicId: topic.topicId, prepared, submitKey: key });
    if (!recovered || recovered.status === "wrong-key") {
      heldKey = null;
      return stopWith("interrupted", WRONG_KEY_REASON, "key");
    }
    if (recovered.status === "wrong-file" || recovered.status === "conflict") {
      return stopWith("lost", CONFLICT_REASON, null);
    }
    if (recovered.status === "complete") {
      metaDone = true;
      return { resumePart: { metaTopicId: topic.topicId } };
    }
    return {
      resumePart: {
        meta: {
          topicId: topic.topicId,
          submitKey: key,
          sentIndexes: Array.isArray(recovered.sentIndexes) ? recovered.sentIndexes.slice() : [],
        },
      },
    };
  }

  async function planClosed(key, file) {
    const resume = {};
    let prepared = null;
    const fileTopic = job.topics && job.topics.file;
    const metaTopic = job.topics && job.topics.meta;
    if (!fileTopic && !metaTopic) {
      if (job.keyMode === "own" && !key) return stopWith("interrupted", "", "key");
      if (!preparedMem && !file) return stopWith("interrupted", "", "file");
      const bytes = file ? await prepareFile(file) : preparedMem;
      return { prepared: bytes, resume, confirmRemint: false };
    }
    if (fileTopic) {
      const filePlan = await planFile(fileTopic, key, file);
      if (filePlan.stop) return filePlan;
      if (filePlan.resumePart) Object.assign(resume, filePlan.resumePart);
      if (filePlan.prepared) prepared = filePlan.prepared;
    }
    if (metaTopic) {
      const fileTopicId = resume.fileTopicId || (fileTopic && fileTopic.topicId) || "";
      const metaPlan = await planMeta(metaTopic, key, fileTopicId);
      if (metaPlan.stop) return metaPlan;
      if (metaPlan.resumePart) Object.assign(resume, metaPlan.resumePart);
    }
    if (job.mint && job.mint.minted) resume.minted = job.mint.minted;
    return {
      prepared: prepared || preparedMem || stubPrepared(),
      resume,
      confirmRemint: false,
    };
  }

  function takeKey(submitKey) {
    if (typeof submitKey === "string") {
      if (!submitKey.trim()) return keyFromMemory();
      const parsed = parseSubmitKey(submitKey);
      heldKey = parsed.key;
      if (job && job.keyMode === "own") job.publicKey = parsed.publicKey;
      return parsed.key;
    }
    if (submitKey && typeof submitKey === "object" && submitKey.publicKey && typeof submitKey.publicKey.toString === "function") {
      heldKey = submitKey;
      return submitKey;
    }
    return keyFromMemory();
  }

  function mintCheckResume() {
    return {
      fileTopicId: job.topics.file.topicId,
      metaTopicId: job.topics.meta.topicId,
      mintCheck: {
        txIds: job.mint && Array.isArray(job.mint.txIds) ? job.mint.txIds.slice() : [],
        tokenId: job.tokenId,
        metadata: `hcs://1/${job.topics.meta.topicId}`,
      },
      minted: job.mint && job.mint.minted ? job.mint.minted : undefined,
    };
  }

  async function start(input = {}) {
    if (running) return snapshot();
    if (job && job.status === "done") {
      job = null;
      result = null;
    }
    if (unfinishedInMemory()) throw userFacing(BUSY_REASON);
    const existing = loadHashinalJob(id, storage);
    if (existing) throw userFacing(BUSY_REASON);
    const keyMode = input.keyMode === "own" ? "own" : "memory";
    let key = null;
    if (keyMode === "own") {
      if (!input.submitKey || typeof input.submitKey !== "object" || !input.submitKey.publicKey) {
        throw userFacing(KEY_REASON);
      }
      key = input.submitKey;
    }
    const prepared = input.prepared;
    if (overCap(prepared)) throw new Error("file is over 2 MB");
    const flight = await preflight(input.tokenId, id);
    if (!flight || flight.ok !== true) {
      const reason = flight && typeof flight.reason === "string" && flight.reason
        ? flight.reason
        : "Could not read the collection";
      throw userFacing(reason);
    }
    const form = {
      name: typeof input.name === "string" ? input.name : "",
      description: typeof input.description === "string" ? input.description : "",
      creator: typeof input.creator === "string" ? input.creator : "",
      attributes: copyAttributes(input.attributes),
    };
    job = {
      v: 1,
      accountId: id,
      tokenId: typeof input.tokenId === "string" ? input.tokenId.trim() : "",
      keyMode,
      form,
      file: {
        name: prepared && typeof prepared.name === "string" ? prepared.name : "",
        mime: prepared && typeof prepared.mime === "string" ? prepared.mime : "",
        size: fileSize(prepared),
      },
      topics: { file: null, meta: null },
      mint: { inflight: false, txIds: [], minted: null },
      publicKey: keyMode === "own" && key.publicKey ? key.publicKey.toString() : "",
      step: "file",
      status: "running",
      reason: "",
      createdAt: now(),
    };
    heldKey = key;
    memoryResume = null;
    preparedMem = prepared;
    result = null;
    needs = null;
    fileDone = false;
    metaDone = false;
    fileTx = Number(prepared && prepared.txCount) || 0;
    warned = false;
    return execute({
      prepared,
      submitKey: keyMode === "own" ? key : undefined,
      confirmRemint: false,
    });
  }

  async function resume(input = {}) {
    if (running) return snapshot();
    if (!job) {
      try {
        job = loadHashinalJob(id, storage);
      } catch (err) {
        throw err;
      }
    }
    if (!job) throw userFacing("No Hashinal to resume");
    if (job.accountId !== id) throw userFacing(OTHER_ACCOUNT);
    if (job.status === "lost" || job.status === "done") return snapshot();
    const body = input && typeof input === "object" ? input : {};
    const key = takeKey(body.submitKey);
    if (isMintFailed(job) && mintReady(job)) {
      return execute({
        prepared: preparedMem || stubPrepared(),
        submitKey: job.keyMode === "own" ? key : undefined,
        confirmRemint: true,
        resume: {
          fileTopicId: job.topics.file.topicId,
          metaTopicId: job.topics.meta.topicId,
        },
      });
    }
    if ((job.status === "unconfirmed" || (job.mint && job.mint.inflight)) && mintReady(job)) {
      return execute({
        prepared: preparedMem || stubPrepared(),
        submitKey: job.keyMode === "own" ? key : undefined,
        confirmRemint: false,
        resume: mintCheckResume(),
      });
    }
    if (memoryResume && preparedMem) {
      return execute({
        prepared: preparedMem,
        submitKey: job.keyMode === "own" ? key : undefined,
        confirmRemint: false,
        resume: memoryResume,
      });
    }
    const plan = await planClosed(key, body.file);
    if (plan.stop) {
      needs = plan.needs;
      job.status = plan.status;
      job.reason = plan.reason;
      persist();
      emitStatus();
      return snapshot();
    }
    if (plan.prepared) preparedMem = plan.prepared;
    return execute({
      prepared: plan.prepared,
      submitKey: job.keyMode === "own" ? key : undefined,
      confirmRemint: false,
      resume: plan.resume,
    });
  }

  async function check() {
    if (running) return snapshot();
    if (!job) {
      try {
        job = loadHashinalJob(id, storage);
      } catch (err) {
        throw err;
      }
    }
    if (!job || job.status !== "unconfirmed" || !mintReady(job)) return snapshot();
    return execute({
      prepared: preparedMem || stubPrepared(),
      submitKey: undefined,
      confirmRemint: false,
      resume: mintCheckResume(),
    });
  }

  /**
   * Mint again after the person confirms a second time. This is the only
   * call that passes confirmRemint for a mint Hedera has not already
   * reported as failed. Call it only after that second confirm.
   */
  async function forceRemint() {
    if (running) return snapshot();
    if (!job) {
      try {
        job = loadHashinalJob(id, storage);
      } catch (err) {
        throw err;
      }
    }
    if (!job || job.status !== "unconfirmed" || !mintReady(job)) return snapshot();
    return execute({
      prepared: preparedMem || stubPrepared(),
      submitKey: job.keyMode === "own" ? keyFromMemory() : undefined,
      confirmRemint: true,
      resume: {
        fileTopicId: job.topics.file.topicId,
        metaTopicId: job.topics.meta.topicId,
      },
    });
  }

  function dismiss() {
    if (running) return snapshot();
    discardHashinalJob(id, storage);
    job = null;
    result = null;
    needs = null;
    fileDone = false;
    metaDone = false;
    progress = { step: "", sent: 0, total: 0, approvalsDone: 0, approvalsTotal: 0 };
    dropHeld();
    emit("status", { status: "idle", reason: "" });
    return snapshot();
  }

  function on(event, fn) {
    if (!listeners[event] || typeof fn !== "function") return () => {};
    listeners[event].add(fn);
    return () => listeners[event].delete(fn);
  }

  function holdsKey() {
    if (!keyFromMemory() || !job) return false;
    if (job.status === "done" || job.status === "lost" || job.status === "idle") return false;
    if (job.topics && job.topics.file && !fileDone && job.step !== "meta" && job.step !== "mint") return true;
    if (job.topics && job.topics.meta && !metaDone && job.step !== "mint") return true;
    return false;
  }

  return { start, resume, check, forceRemint, dismiss, on, holdsKey, snapshot };
}
