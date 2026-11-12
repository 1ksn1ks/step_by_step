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
import {
  SWAP_MAINNET_NODES,
  prepareSwapContract,
  swapAllowanceLong,
  swapApprovalToken,
  swapCappedFeeHbar,
  swapCappedFeeTinybars,
  swapGasLimit,
  swapSpenderId,
  widgetEntityId,
} from "./swapoffer.js";

function live() {
  const id = bareAccount(connectedAccount);
  if (!id || !signer) return null;
  return { id, signer };
}

function feeFromGas(request) {
  const gas = swapGasLimit(request && request.gasLimit);
  return new Hbar(Math.min(10, Math.max(5, Math.ceil(gas / 1000000 * 1.5) + 1)));
}

function feeFor(request) {
  const supplied = request && request.maxTransactionFee;
  if (supplied instanceof Hbar) {
    let tiny = null;
    try { tiny = BigInt(supplied.toTinybars().toString()); } catch { tiny = null; }
    const capped = swapCappedFeeTinybars(tiny);
    if (capped == null) return feeFromGas(request);
    if (capped !== tiny) return Hbar.fromTinybars(capped.toString());
    return supplied;
  }
  if (typeof supplied === "number") {
    const capped = swapCappedFeeHbar(supplied);
    if (capped != null) return new Hbar(capped);
  }
  return feeFromGas(request);
}

function freezeFor(tx, accountId) {
  tx.setTransactionId(TransactionId.generate(AccountId.fromString(accountId)));
  // The signer sends this frozen list on. It does not fill in nodes itself.
  tx.setNodeAccountIds(SWAP_MAINNET_NODES.map((id) => AccountId.fromString(id)));
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
  const prepared = prepareSwapContract(call);
  const tx = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(prepared.contractId))
    .setGas(prepared.gasLimit)
    .setFunctionParameters(prepared.data)
    .setMaxTransactionFee(feeFor(call));
  if (prepared.payableTinybars != null) {
    tx.setPayableAmount(Hbar.fromTinybars(prepared.payableTinybars.toString()));
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

async function approve(configuredToken, tokenId, spenderId, amount, onStatusChange) {
  const session = live();
  if (!session) throw new Error("Connect wallet first");
  const allowance = swapAllowanceLong(amount);
  const spender = swapSpenderId(spenderId);
  const token = swapApprovalToken(configuredToken, tokenId);
  const tx = new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(TokenId.fromString(token), AccountId.fromString(session.id), AccountId.fromString(spender), allowance)
    .setMaxTransactionFee(new Hbar(5));
  return submit(tx, onStatusChange);
}

// null when Globe has no signer. The sheet then keeps the widget modal.
// outputToken is the creator's configured swap token. When it is set,
// approvals for any other token are refused. When it is empty, the default
// widget may approve the token it asks for. The spender is still only a
// SaucerSwap router.
export function globeSwapWallet(outputToken) {
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
      return approve(outputToken, tokenId, spenderId, amount, onStatusChange);
    },
  };
}
