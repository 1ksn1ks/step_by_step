// One frozen HCS chunk per wallet approval.
//
// HashPack's signTransaction reads a single transaction body and stamps that
// signature onto every transaction in the list. Chunk bodies differ, so that
// signature does not match chunks 2..N. Each chunk is its own one-body
// transaction.
//
// TopicMessageSubmitTransaction.freezeWith takes the transaction id that is
// set when it starts, stores that protobuf as chunkInfo.initialTransactionID,
// and pushes that same id for chunk 1. Later chunks keep that valid-start and
// only add one nanosecond, so they share the 120s window. freezeOneHcsChunk
// does not call that method. It freezes one body with Transaction.freezeWith
// after setting _chunkInfo, so this chunk can have a new valid-start while
// initialTransactionID stays chunk 1's id.

import { Transaction, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { proto } from "@hiero-ledger/proto";

// Loading the class registers consensusSubmitMessage with Transaction.fromBytes.
void TopicMessageSubmitTransaction;

export function freezeOneHcsChunk({
  topicId,
  message,
  nodeAccountId,
  transactionId,
  initialTransactionId,
  number,
  total,
  maxChunks = 20,
  chunkSize = 1024,
}) {
  const tx = new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .setMaxChunks(maxChunks)
    .setChunkSize(chunkSize);
  tx.setNodeAccountIds([nodeAccountId]);
  tx.setTransactionId(transactionId);
  tx._chunkInfo = {
    initialTransactionID: initialTransactionId._toProtobuf(),
    total,
    number,
  };
  Transaction.prototype.freezeWith.call(tx, null);
  return tx;
}

export function splitFrozenChunks(transaction) {
  const decoded = proto.TransactionList.decode(transaction.toBytes());
  const list = decoded.transactionList || [];
  if (list.length <= 1) return [transaction];
  return list.map((item) => {
    const one = proto.TransactionList.encode({ transactionList: [item] }).finish();
    return Transaction.fromBytes(one);
  });
}
