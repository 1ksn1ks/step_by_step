import {
  TopicMessageSubmitTransaction,
  TopicId,
  PrivateKey,
  TopicCreateTransaction,
  TopicUpdateTransaction,
  AccountId,
  TransactionId,
  CustomFixedFee} from '@hashgraph/sdk';
import { signer, dAppConnector } from './web3';
import { toast } from './toast.js';
import {
  HCS_MAX_CHUNKS,
  HCS_MESSAGE_MAX_BYTES,
  HCS_TOO_LONG,
  createChunkAssembler,
  ingestMirrorRows,
  openWatermark,
} from './hcschunks.js';
import { freezeOneHcsChunk } from './hcssplit.js';

// A multi-chunk failure stays up until the next send, so the "sent X of N"
// line can be read after HashPack closes. A retry builds a new chunk-1 id.
let heldChunkError = null;

function clearHeldChunkError() {
  if (!heldChunkError) return;
  heldChunkError.done();
  heldChunkError = null;
}

// The wallet connector's ids are @hiero-ledger/sdk objects. They fail
// instanceof inside @hashgraph/sdk, and fromString then crashes on the
// object. Keep every id a string, and freeze with this package's
// TransactionId. freezeWithSigner would install the connector's id first,
// and TopicCreateTransaction.freezeWith copies that payer into auto-renew.
function sdkId(value) {
  if (typeof value === 'string') return value;
  if (value != null && typeof value.toString === 'function') {
    const text = value.toString();
    if (typeof text === 'string' && text !== '[object Object]') return text;
  }
  return value;
}

function connectedAccountId() {
  const accountId = sdkId(signer.getAccountId());
  if (typeof accountId !== 'string' || accountId === '') {
    throw new Error('Connect wallet first');
  }
  return accountId;
}

function nodeAccountId(nodeAddresses) {
  let node = '0.0.3';
  if (nodeAddresses && nodeAddresses.length > 0) {
    node = nodeAddresses[Math.floor(Math.random() * nodeAddresses.length)];
  }
  return AccountId.fromString(sdkId(node));
}

function freezeForConnectedAccount(transaction, nodeAddresses) {
  transaction.setNodeAccountIds([nodeAccountId(nodeAddresses)]);
  transaction.setTransactionId(TransactionId.generate(connectedAccountId()));
  transaction.freeze();
  return transaction;
}

function formatMirrorMessage(item) {
  return {
    ...item.parsed,
    payer: item.payer,
    created: new Date(Number(item.consensus_timestamp) * 1000),
    consensus_timestamp: item.consensus_timestamp,
    sequence_number: item.sequence_number,
  };
}

export async function sendMessage(topicId, message) {
  clearHeldChunkError();
  const transaction = new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(sdkId(topicId)))
    .setMessage(message)
    .setMaxChunks(HCS_MAX_CHUNKS);

  const size = transaction.getMessage() ? transaction.getMessage().length : 0;
  if (size > HCS_MESSAGE_MAX_BYTES) {
    toast.error(HCS_TOO_LONG);
    throw new Error(HCS_TOO_LONG);
  }

  // One chunk stays on the wallet's single sign-and-execute path. The body
  // is at most 1024 bytes, so the mirror row has no chunk_info.
  if (transaction.getRequiredChunks() <= 1) {
    try {
      const txResponse = await transaction.executeWithSigner(signer);
      const receipt = await txResponse.getReceiptWithSigner(signer);
      console.log(receipt);
      return receipt;
    } catch (err) {
      throw err;
    }
  }

  // Each wallet approval gets its own valid-start. Chunk 1's transaction id
  // is still chunk_info.initial_transaction_id on every part. A retry of this
  // function generates a new chunk-1 id and sends the whole message again.
  const total = transaction.getRequiredChunks();
  const nodeAddresses = await dAppConnector.getNodeAddresses();
  const node = nodeAccountId(nodeAddresses);
  const account = connectedAccountId();
  const messageBytes = transaction.getMessage();
  toast.info(`This message needs ${total} wallet approvals.`);

  let initialTransactionId = null;
  let sent = 0;
  let receipt = null;
  for (let number = 1; number <= total; number++) {
    const transactionId = TransactionId.generate(account);
    if (number === 1) initialTransactionId = transactionId;
    const part = freezeOneHcsChunk({
      topicId: sdkId(topicId),
      message: messageBytes,
      nodeAccountId: node,
      transactionId,
      initialTransactionId,
      number,
      total,
      maxChunks: HCS_MAX_CHUNKS,
    });
    const notice = toast.hold(`Sending part ${number} of ${total}`);
    try {
      const txResponse = await part.executeWithSigner(signer);
      receipt = await txResponse.getReceiptWithSigner(signer);
      sent += 1;
    } catch (err) {
      heldChunkError = toast.error(
        `Sent ${sent} of ${total} parts, so this message won't appear. Send it again to retry.`,
        { hold: true, stay: true },
      );
      throw err;
    } finally {
      notice.done();
    }
  }
  console.log(receipt);
  return receipt;
}

export async function updateTopic({topicId:topicId , memo:memo, adminKey:adminKey, customFees:customFees}) {
  const transaction = new TopicUpdateTransaction()
    .setTopicId(sdkId(topicId))
    .setTopicMemo(memo || '');

  const nodeAddresses = await dAppConnector.getNodeAddresses();

  if (adminKey) {
    const adminPrivateKey = PrivateKey.fromStringED25519(adminKey);
    const adminPublicKey = adminPrivateKey.publicKey;

    transaction
      .setAdminKey(adminPublicKey)
      .setFeeScheduleKey(adminPublicKey);

    if (customFees) {
      const hederaCustomFees = customFees.map(fee => {
        const customFee = new CustomFixedFee().setAmount(fee.amount);
        const collector = sdkId(fee.collectorAccountId);
        const token = sdkId(fee.denominatingTokenId);
        if (collector) customFee.setFeeCollectorAccountId(collector);
        if (token) customFee.setDenominatingTokenId(token);
        return customFee;
      });
      transaction.setCustomFees(hederaCustomFees);
    }

    // Update freeze does not copy the payer. Setting auto-renew here would
    // change who pays renewal on every memo or fee update.
    freezeForConnectedAccount(transaction, nodeAddresses);
    await transaction.sign(adminPrivateKey);
  }

  await transaction.executeWithSigner(signer);
}

export async function createTopic({memo:memo, adminkey:adminKey} = {}) {
  const transaction = new TopicCreateTransaction().setTopicMemo(memo);
  transaction.setAutoRenewAccountId(connectedAccountId());

  const nodeAddresses = await dAppConnector.getNodeAddresses();
  let adminPrivateKey;

  if (adminKey) {
    adminPrivateKey = PrivateKey.fromStringED25519(adminKey);
    const adminPublicKey = adminPrivateKey.publicKey;

    transaction
      .setAdminKey(adminPublicKey)
      .setFeeScheduleKey(adminPublicKey);
  }

  freezeForConnectedAccount(transaction, nodeAddresses);

  if (adminPrivateKey) {
    await transaction.sign(adminPrivateKey);
  }

  const txResponse = await transaction.executeWithSigner(signer);
  const receipt = await txResponse.getReceiptWithSigner(signer);

  return receipt.topicId.toString();
}


async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (err) {
      if (i === retries) throw err;
      console.warn(`Retry ${i + 1}/${retries} for ${url} failed: ${err.message}`);
      await new Promise(res => setTimeout(res, delay * Math.pow(2, i))); // exponential backoff
    }
  }
}

export async function getMessages(
  topicId,
  { afterSeq = 0 } = {},
) {

  const baseUrl = `https://mainnet.mirrornode.hedera.com`;
  const after = Number(afterSeq) || 0;

  // Walk forward from the oldest message, or from the sequence already
  // saved. The mirror's default order is newest-first, which would pin the
  // watermark on the newest page and never go back for the rest if a
  // download stopped. order=asc lets the next open continue from lastSequence.
  let url = after > 0
    ? `${baseUrl}/api/v1/topics/${topicId}/messages?limit=100&order=asc&sequencenumber=gt:${after}`
    : `${baseUrl}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;

  const allMessages = [];
  const rawRows = [];
  const assembler = createChunkAssembler();
  let lastSequence = after;

  const takePage = (messages) => {
    rawRows.push(...messages);
    for (const item of ingestMirrorRows(assembler, topicId, messages)) {
      allMessages.push(formatMirrorMessage(item));
    }
    // This walk does not keep the chunk buffer after it returns. Hold the
    // watermark before an unfinished group so the next read still has every
    // chunk. A group that finishes inside this walk is safe to pass.
    lastSequence = openWatermark(after, rawRows, assembler.pendingSequences(String(topicId)));
  };

  try {
    while (url) {
      const response = await fetchWithRetry(url);
      const data = await response.json();

      const messages = data.messages || [];
      let nextLink = data.links?.next || null;
      takePage(messages);

      if (nextLink) {
        url = `${baseUrl}${nextLink}`;
      } else {
        url = null;
      }
    }

    allMessages.sort((a, b) => a.sequence_number - b.sequence_number);

    return {
      messages: allMessages,
      error: '',
      lastSequence,
    };
  } catch (error) {
    console.error('Error fetching topic messages:', error);
    allMessages.sort((a, b) => a.sequence_number - b.sequence_number);
    return {
      messages: allMessages,
      error: error.message || error.toString(),
      lastSequence,
    };
  }
}

export async function subscribeToTopic(
  topicId,
  onMessageReceived = null,
  onError = null,
  pollIntervalMs = 3000
) {
  let lastSequence = 0;
  let stopped = false;
  let timeoutId = null;
  const seenSequences = new Set();
  const historyMessages = [];
  // Lives for this subscription, including across polls, so a chunk that
  // arrives on the next tick still completes the message.
  const assembler = createChunkAssembler();

  const baseUrl = `https://mainnet.mirrornode.hedera.com`;

  const processMessages = (messages, isHistory = false) => {
    let maxSeq = lastSequence;
    for (const msg of messages || []) {
      const seq = Number(msg.sequence_number);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
    for (const item of ingestMirrorRows(assembler, topicId, messages)) {
      if (seenSequences.has(item.sequence_number)) continue;
      seenSequences.add(item.sequence_number);
      const formatted = formatMirrorMessage(item);
      if (isHistory) {
        historyMessages.push(formatted);
      } else if (typeof onMessageReceived === "function") {
        onMessageReceived(formatted);
      }
    }
    // The assembler keeps unfinished chunks. Later chunks have a higher
    // sequence, so the next poll can start after this page.
    if (maxSeq > lastSequence) lastSequence = maxSeq;
  };

  // Load history
  const loadHistory = async () => {
    let url = `${baseUrl}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;

    while (url && !stopped) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      processMessages(data.messages, true);

      const nextLink = data.links?.next;
      url = nextLink ? `${baseUrl}${nextLink}` : null;
    }

    historyMessages.sort((a, b) => a.sequence_number - b.sequence_number);
  };

  // Live polling
  const poll = async () => {
    if (stopped) return;

    try {
      let url = `${baseUrl}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
      if (lastSequence > 0) {
        url += `&sequencenumber=gt:${lastSequence}`;
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      processMessages(data.messages, false);
    } catch (error) {
      if (typeof onError === "function") onError(error);
    } finally {
      if (!stopped) {
        timeoutId = setTimeout(poll, pollIntervalMs);
      }
    }
  };

  // Start
  try {
    await loadHistory();
  } catch (error) {
    if (typeof onError === "function") onError(error);
  }

  if (!stopped) {
    poll();
  }

  return {
    messages: historyMessages,   // ← This was missing in your current version
    close() {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
      console.log("Stopped topic subscription");
    },
  };
}

export async function generatePrivateAndPublicKey() {
  const privateKey = await PrivateKey.generateED25519Async();
  const publicKey = privateKey.publicKey;
  return {
    privateKey: privateKey.toString(),
    publicKey: publicKey.toString()
  };
}

export async function getTopicInfo(topicId)
 {
      try {

      if (!topicId) {
        throw new Error('Topic ID is required');
      }
  
      const baseUrl = `https://mainnet.mirrornode.hedera.com`;
  
      const url = `${baseUrl}/api/v1/topics/${topicId}`;
  
      const response = await fetchWithRetry(url);
      if (!response.ok) {
        throw new Error(
          `Failed to make request to mirror node for topic info: ${response.status}`
        );
      }
  
      const data = await response.json();
      return data;
    } catch (error) {
        console.error('Error fetching topic messages:', error);

    }
  }

export async function getAccountNFTs(accountId, tokenId) 
{
    try {
      const tokenQuery = tokenId ? `&token.id=${tokenId}` : '';
      const url = `https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/nfts?limit=200${tokenQuery}`;

      const request = await fetchWithRetry(url);
      if (!request.ok) {
        throw new Error(`Failed to fetch NFTs for account: ${request.status}`);
      }

      const response = await request.json();
      let nextLink = response.links?.next || null;
      let nfts = response.nfts || [];

      while (nextLink) {
        try {
          const nextRequest = await fetchWithRetry(
            `https://mainnet.mirrornode.hedera.com${nextLink}`
          );

          if (!nextRequest.ok) {
            throw new Error(
              `Failed to fetch next page of NFTs: ${nextRequest.status}`
            );
          }

          const nextResponse = (await nextRequest.json());
          nfts = [...nfts, ...(nextResponse?.nfts || [])];

          nextLink =
            nextResponse?.links?.next && nextLink !== nextResponse?.links?.next
              ? nextResponse.links.next
              : null;
        } catch (e) {
          break;
        }
      }

      return nfts.map((nft) => {
        try {
          nft.token_uri = Buffer.from(nft.metadata, 'base64').toString('ascii');
        } catch (e) {
        }
        return nft;
      });
    } catch (e) {
      return [];
    }
  }
