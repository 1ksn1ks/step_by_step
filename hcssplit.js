// Split one frozen TopicMessageSubmitTransaction into one transaction per
// HCS chunk.
//
// HashPack's signTransaction reads a single transaction body and stamps that
// signature onto every transaction in the list. Chunk bodies differ, so that
// signature does not match chunks 2..N. Sign-and-execute also returns one
// response for the whole list. Each chunk is therefore its own one-body
// transaction. freezeWith already wrote chunk_info into each body; splitting
// the frozen bytes keeps that link. Do not rebuild the message per chunk.

import { Transaction, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { proto } from "@hiero-ledger/proto";

// Loading the class registers consensusSubmitMessage with Transaction.fromBytes.
void TopicMessageSubmitTransaction;

export function splitFrozenChunks(transaction) {
  const decoded = proto.TransactionList.decode(transaction.toBytes());
  const list = decoded.transactionList || [];
  if (list.length <= 1) return [transaction];
  return list.map((item) => {
    const one = proto.TransactionList.encode({ transactionList: [item] }).finish();
    return Transaction.fromBytes(one);
  });
}
