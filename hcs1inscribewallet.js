// Wallet adapters for hcs1inscribe.js. The inscriber stays free of this
// app: it never imports a signer. These functions do.
//
// createHcs1Topic: a topic with the ephemeral submit key and no admin key.
// submitHcs1Message: one JSON message, one transaction body, one approval.
// Not wired to a button. startInscribe prepares a file and inscribes it.
// A resume uses inscribePrepared on the bytes already prepared.

import { TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { compressPostImage } from "./imagecompress.js";
import { POST_IMAGE_EDGE, POST_STILL_TYPES } from "./postimages.js";
import {
  HCS1_INSCRIBE_MAX_BYTES,
  buildHcs1Inscription,
  inscribeHcs1,
} from "./hcs1inscribe.js";

async function walletSigner() {
  const { signer } = await import("./web3.js");
  if (!signer) throw new Error("Connect wallet first");
  return signer;
}

// Topic with the submit key only. The connected account pays.
export async function createHcs1Topic({ memo, submitKey }) {
  const signer = await walletSigner();
  const transaction = new TopicCreateTransaction()
    .setTopicMemo(memo)
    .setSubmitKey(submitKey.publicKey);
  const frozen = await transaction.freezeWithSigner(signer);
  await frozen.sign(submitKey);
  const txResponse = await frozen.executeWithSigner(signer);
  const receipt = await txResponse.getReceiptWithSigner(signer);
  return receipt.topicId.toString();
}

// One body. A message over one chunk is refused instead of split: HashPack
// would stamp the first signature onto every body in the list.
export async function submitHcs1Message({ topicId, submitKey, message }) {
  const signer = await walletSigner();
  const transaction = new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message);
  if (transaction.getRequiredChunks() > 1) throw new Error("hcs-1 message must be one transaction");
  const frozen = await transaction.freezeWithSigner(signer);
  await frozen.sign(submitKey);
  const txResponse = await frozen.executeWithSigner(signer);
  await txResponse.getReceiptWithSigner(signer);
}

// Still pictures go through compressPostImage first (longest side
// POST_IMAGE_EDGE, never upscaled). GIF, video and 3D models are unchanged.
// asIs keeps the picked bytes, for a prepared copy the person saved: a
// still that is compressed again would hash to a different topic.
// overCap is the raw size after that step. The cost is filled in only when
// the file fits.
export async function prepareInscribeFile(file, { asIs } = {}) {
  const type = String((file && file.type) || "").toLowerCase();
  let source = file;
  if (!asIs && POST_STILL_TYPES.includes(type)) {
    source = await compressPostImage(file, { maxEdge: POST_IMAGE_EDGE });
  }
  const bytes = new Uint8Array(await source.arrayBuffer());
  const mime = String(source.type || type);
  const name = String(source.name || (file && file.name) || "");
  const overCap = bytes.length > HCS1_INSCRIBE_MAX_BYTES;
  if (overCap) return { bytes, mime, name, overCap };
  const built = await buildHcs1Inscription(bytes, mime);
  return {
    bytes,
    mime,
    name,
    overCap,
    txCount: built.txCount,
    usd: built.usd,
  };
}

// Inscribe bytes already prepared. Does not read or compress the file again,
// so a resume sends the same bytes the first attempt hashed into the topic.
export async function inscribePrepared(prepared, { onProgress, resume, submitKey, onTopic } = {}) {
  if (!prepared || prepared.overCap) throw new Error("file is over 2 MB");
  return inscribeHcs1({
    bytes: prepared.bytes,
    mime: prepared.mime,
    createTopic: createHcs1Topic,
    submitMessage: submitHcs1Message,
    onProgress,
    resume,
    submitKey,
    onTopic,
  });
}

// Prepare the file, then inscribe those bytes.
export async function startInscribe(file, opts = {}) {
  return inscribePrepared(await prepareInscribeFile(file), opts);
}
