// Globe's WalletConnect session, shaped as the SaucerSwap widget's
// externalWallet. The widget's own client is a second SignClient and cannot
// see this session, so a connected account signs through the DAppSigner
// Globe already holds. That signer sends hedera_signAndExecuteTransaction,
// the same method the widget uses for its own WalletConnect session.
// With no signer, the caller leaves externalWallet unset and the widget
// opens its own wallet modal.

import {
  AccountAllowanceApproveTransaction,
  AccountId,
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  TokenAssociateTransaction,
  TokenId,
  TransactionId,
} from "@hiero-ledger/sdk";
import { connectedAccount, signer } from "./web3.js";
import { bareAccount } from "./donationmath.js";
import { widgetCallData, widgetEntityId } from "./swapoffer.js";

function live() {
  const id = bareAccount(connectedAccount);
  if (!id || !signer) return null;
  return { id, signer };
}

function contractIdOf(to) {
  const id = widgetEntityId(to);
  if (id) return ContractId.fromString(id);
  const raw = String(to == null ? "" : to).trim().replace(/^hedera:(mainnet|testnet):/i, "");
  if (/^0x[0-9a-f]{40}$/i.test(raw)) return ContractId.fromEvmAddress(0, 0, raw);
  return null;
}

function feeFor(request) {
  if (request && request.maxTransactionFee instanceof Hbar) return request.maxTransactionFee;
  if (request && typeof request.maxTransactionFee === "number") return new Hbar(request.maxTransactionFee);
  const gas = request && request.gasLimit ? request.gasLimit : 1200000;
  return new Hbar(Math.min(10, Math.max(5, Math.ceil(gas / 1000000 * 1.5) + 1)));
}

function freezeFor(tx, accountId) {
  tx.setTransactionId(TransactionId.generate(AccountId.fromString(accountId)));
  tx.setNodeAccountIds([AccountId.fromString("0.0.3")]);
  tx.freeze();
  return tx;
}

async function submit(tx, onStatusChange) {
  const session = live();
  if (!session) throw new Error("Connect wallet first");
  if (onStatusChange) onStatusChange("signing");
  freezeFor(tx, session.id);
  const response = await session.signer.call(tx);
  const transactionId = response && response.transactionId ? response.transactionId.toString() : "";
  if (!transactionId) throw new Error("Wallet did not return a transaction ID");
  if (onStatusChange) onStatusChange("confirming");
  return { transactionId };
}

async function executeContract(request) {
  const call = request || {};
  const contract = contractIdOf(call.to);
  const data = widgetCallData(call.data);
  if (!contract || !data) throw new Error("Swap transaction could not be built");
  const tx = new ContractExecuteTransaction()
    .setContractId(contract)
    .setGas(call.gasLimit || 1200000)
    .setFunctionParameters(data)
    .setMaxTransactionFee(feeFor(call));
  if (typeof call.valueTinybar === "bigint" && call.valueTinybar > 0n) {
    tx.setPayableAmount(Hbar.fromTinybars(call.valueTinybar.toString()));
  }
  return submit(tx, call.onStatusChange);
}

async function associate(tokenId, onStatusChange) {
  const session = live();
  if (!session) throw new Error("Connect wallet first");
  const id = widgetEntityId(tokenId);
  if (!id) throw new Error("Wallet does not support token association");
  const tx = new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(session.id))
    .setTokenIds([TokenId.fromString(id)])
    .setMaxTransactionFee(new Hbar(5));
  return submit(tx, onStatusChange);
}

async function approve(tokenId, spenderId, amount, onStatusChange) {
  const session = live();
  if (!session) throw new Error("Connect wallet first");
  if (typeof amount !== "bigint" || amount <= 0n) throw new Error("Allowance amount must be greater than zero");
  const token = widgetEntityId(tokenId);
  const spender = widgetEntityId(spenderId);
  if (!token || !spender) throw new Error("Wallet does not support token approval");
  const tx = new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(TokenId.fromString(token), AccountId.fromString(session.id), AccountId.fromString(spender), amount)
    .setMaxTransactionFee(new Hbar(5));
  return submit(tx, onStatusChange);
}

// null when Globe has no signer. The sheet then keeps the widget modal.
export function globeSwapWallet() {
  const session = live();
  if (!session) return null;
  return {
    id: "globe",
    name: "Connected wallet",
    isEvm: false,
    get isConnected() {
      return bareAccount(connectedAccount) === session.id && !!signer;
    },
    get accountId() {
      return bareAccount(connectedAccount) || session.id;
    },
    network: "mainnet",
    connect() {
      const accountId = bareAccount(connectedAccount);
      if (!accountId || !signer) return Promise.reject(new Error("Connect wallet first"));
      return Promise.resolve({ accountId, network: "mainnet" });
    },
    // The widget's disconnect must not drop Globe's session.
    disconnect() {
      return Promise.resolve();
    },
    executeTransaction(request) {
      return executeContract(request);
    },
    associateToken(tokenId, onStatusChange) {
      return associate(tokenId, onStatusChange);
    },
    approveToken(tokenId, spenderId, amount, onStatusChange) {
      return approve(tokenId, spenderId, amount, onStatusChange);
    },
  };
}
