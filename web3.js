window.alert = function(message) {
  console.warn('Blocked alert:', message);
};

import {
  DAppConnector,
  HederaChainId,
  HederaJsonRpcMethod,
} from '@hashgraph/hedera-wallet-connect';
import { LedgerId, AccountId } from '@hashgraph/sdk';

import { loadProfileCrosshair } from './loadcrosshair';
import { loadTopicChatSettings } from './loadtopicchatset';
import { loadProfilePopup, syncEarlyStyleEditor } from './loadprofilepopup';
import { loadProfileObject } from './loadprofileobject';
import { loadButtonInputSettings } from './loadbuttoninput';
import { loadMarkerSettings } from './loadmarkersett';
import { confirmNFTFunction, ownsModelNFT, setOwnsModelNFT } from './confirmnft';
import { handleAllMessages } from './handleallmessages';
import {debounce} from './debounce'


const PROJECT_ID = "fdd65bec25e85908fecf7561fe42b41f";

const metadata = {
  name: "Meritocracy",
  description: "Tokenize Taxes",
  url: window.location.origin,
  icons: ["https://kiloscribe.com/api/inscription-cdn/0.0.4819119"],
};

export const dAppConnector = new DAppConnector(
  metadata,
  LedgerId.MAINNET,
  PROJECT_ID,
  Object.values(HederaJsonRpcMethod),
  [],
  [HederaChainId.Mainnet]
);

export let connectedAccount = null;
export let signer = null;

async function init() {
  try {
    await dAppConnector.init({ logger: 'error' });
    const newToolbarLoad = document.getElementById("toolbar-load");

    const signers = dAppConnector.signers;
    if (signers && signers.length > 0) {
      const accountId = signers[0].getAccountId().toString();
      connectedAccount = accountId;
      loadProfileCrosshair(accountId)
      loadTopicChatSettings(accountId)
      loadProfilePopup(accountId)
      loadButtonInputSettings(accountId)
      loadMarkerSettings(accountId)
      confirmNFTFunction(accountId).then(() => updateUI())

      const senderId = AccountId.fromString(connectedAccount);
      signer = dAppConnector.getSigner(senderId);


      newToolbarLoad.addEventListener("click", debounce(async () => {
        await confirmNFTFunction(accountId);
        updateUI();
    }, 500));
    } else {

      newToolbarLoad.addEventListener("click", debounce(async () => {
        await handleAllMessages();
      }, 500));
      handleAllMessages()
    }

    updateUI();
  } catch (err) {
    console.error('Init error:', err);
    updateUI();
  }
}

const connectBtn = document.getElementById('connect-wallet-btn');
const accountSpan = document.getElementById('account-id');
const disconnectBtn = document.getElementById("disconnect-wallet-btn");
const walletBtn = document.getElementById("wallet-wallet-btn")

export function updateUI() {
  if (connectedAccount) {
    accountSpan.textContent = connectedAccount;
    connectBtn.textContent = 'Connected ✓';  // Optional: hide or disable connect button
    disconnectBtn.style.display = "block";
    walletBtn.style.display = "none";
    disconnectBtn.textContent = 'Disconnect';
  } else {
    accountSpan.textContent = 'Not connected';
    connectBtn.textContent = 'Connect Wallet';
    connectBtn.disabled = false;
    disconnectBtn.style.display = "none";
    walletBtn.style.display = "block";  // or whatever your default is
  }

  const nftSettingsVisible = connectedAccount && ownsModelNFT ? "block" : "none";
  document.getElementById("change-model-settings").style.display = nftSettingsVisible;
  document.getElementById("change-crosshair-settings").style.display = nftSettingsVisible;
}

init();

// One pairing at a time. A second tap reopens the sheet that is already
// waiting, instead of awaiting another openModal. Profile loads run once.
let connectFlight = null;

function reopenWalletModal() {
  const modal = dAppConnector.walletConnectModal;
  if (!modal || typeof modal.openModal !== 'function') return;
  const host = document.querySelector('wcm-modal');
  const overlay = host && host.shadowRoot && host.shadowRoot.querySelector('.wcm-overlay');
  if (overlay && overlay.classList.contains('wcm-active')) return;
  import('@walletconnect/modal-core').then(({ OptionsCtrl }) => {
    const uri = OptionsCtrl && OptionsCtrl.state && OptionsCtrl.state.walletConnectUri;
    if (!uri || !connectFlight) return;
    modal.openModal({ uri }).catch(() => {});
  }).catch(() => {});
}

function connectWallet() {
  if (connectFlight) {
    reopenWalletModal();
    return connectFlight;
  }
  let settle;
  const flight = new Promise((resolve) => { settle = resolve; });
  connectFlight = flight;
  finishConnect(flight, settle);
  return flight;
}

async function finishConnect(flight, settle) {
  try {
    connectBtn.textContent = 'Connecting...';
    await dAppConnector.openModal();

    const signers = dAppConnector.signers;
    if (signers && signers.length > 0) {
      const accountId = signers[0].getAccountId().toString();
      connectedAccount = accountId;
      loadProfileObject(accountId)
      loadProfileCrosshair(accountId)
      loadTopicChatSettings(accountId)
      loadProfilePopup(accountId)
      loadButtonInputSettings(accountId)
      loadMarkerSettings(accountId)
      confirmNFTFunction(accountId).then(() => updateUI())

      const senderId = AccountId.fromString(connectedAccount);
      signer = dAppConnector.getSigner(senderId);

      accountSpan.textContent = connectedAccount;
      disconnectBtn.style.display = "block";
      connectBtn.style.display = "none";
      disconnectBtn.textContent = 'Disconnect';

      console.log('Signer stored globally:', signer);
    } else {
      updateUI();
    }
  } catch (err) {
    console.error('Connection error:', err);
    updateUI();
  } finally {
    if (connectFlight === flight) connectFlight = null;
    settle();
  }
}

async function disconnectWallet() {
  try {
    const signClient = dAppConnector;
    await signClient.disconnectAll();

    connectedAccount = null;
    setOwnsModelNFT(false);
    walletBtn.style.display = "block";
    disconnectBtn.style.display = "none";
    accountSpan.textContent = 'None';
    connectBtn.textContent = 'Connect';
    updateUI();
    syncEarlyStyleEditor();
  } catch (err) {
    console.error('Disconnect error:', err);
    connectedAccount = null;
    updateUI();
    syncEarlyStyleEditor();
  }
}


connectBtn.addEventListener('click', connectWallet);

// Confirm before disconnect. The disconnect function above stays as it is;
// only the red button in this dialog calls it.
const DISCONNECT_LAYER = 'disconnectask';
const ask = document.createElement('div');
ask.id = 'disconnect-ask';
ask.hidden = true;
const askDim = document.createElement('button');
askDim.type = 'button';
askDim.className = 'disconnect-ask-dim';
askDim.setAttribute('aria-label', 'Cancel');
const askCard = document.createElement('div');
askCard.className = 'disconnect-ask-card';
askCard.setAttribute('role', 'dialog');
askCard.setAttribute('aria-modal', 'true');
askCard.setAttribute('aria-labelledby', 'disconnect-ask-title');
const askTitle = document.createElement('h2');
askTitle.id = 'disconnect-ask-title';
askTitle.className = 'disconnect-ask-title';
askTitle.textContent = 'Disconnect wallet?';
const askAccount = document.createElement('p');
askAccount.className = 'disconnect-ask-account';
const askRow = document.createElement('div');
askRow.className = 'disconnect-ask-row';
const askCancel = document.createElement('button');
askCancel.type = 'button';
askCancel.className = 'disconnect-ask-cancel';
askCancel.textContent = 'Cancel';
const askYes = document.createElement('button');
askYes.type = 'button';
askYes.className = 'disconnect-ask-yes';
askYes.textContent = 'Disconnect';
askRow.append(askCancel, askYes);
askCard.append(askTitle, askAccount, askRow);
ask.append(askDim, askCard);
document.body.appendChild(ask);

function accountForAsk() {
  if (typeof connectedAccount === 'string' && connectedAccount.trim()) return connectedAccount.trim();
  const text = accountSpan && accountSpan.textContent ? accountSpan.textContent.trim() : '';
  return /^\d+\.\d+\.\d+$/.test(text) ? text : '';
}

function paintAskYes() {
  const color = disconnectBtn.style.backgroundColor;
  if (color) {
    askYes.style.backgroundColor = color;
    askYes.style.color = '#fff';
    return;
  }
  askYes.style.removeProperty('background-color');
  askYes.style.removeProperty('color');
}

function hideAsk() {
  ask.hidden = true;
  disconnectBtn.focus({ preventScroll: true });
}

function closeAsk() {
  if (ask.hidden) return;
  hideAsk();
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen(DISCONNECT_LAYER)) {
    window.layerClosedByUI(DISCONNECT_LAYER);
  }
}

function ensureAskLayer() {
  if (ask.hidden || !window.layerOpened) return;
  if (window.layerIsOpen && window.layerIsOpen(DISCONNECT_LAYER)) return;
  window.layerOpened(DISCONNECT_LAYER);
}

function showAsk(push) {
  const id = accountForAsk();
  if (!id) return;
  askAccount.textContent = id;
  paintAskYes();
  ask.hidden = false;
  askCancel.focus({ preventScroll: true });
  if (!push) return;
  ensureAskLayer();
  // A history back already queued by another panel can consume the entry
  // we just pushed. Put it back once that back has run.
  setTimeout(ensureAskLayer, 0);
}

function openAsk() {
  if (!ask.hidden) return;
  showAsk(true);
}

function onAskKey(event) {
  if (ask.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeAsk();
    return;
  }
  // The dimmer is also a button. Tab stays on Cancel and Disconnect.
  if (event.key !== 'Tab') return;
  event.preventDefault();
  event.stopPropagation();
  if (event.shiftKey) {
    (document.activeElement === askYes ? askCancel : askYes).focus({ preventScroll: true });
    return;
  }
  (document.activeElement === askCancel ? askYes : askCancel).focus({ preventScroll: true });
}

askDim.addEventListener('click', (event) => {
  event.stopPropagation();
  closeAsk();
});
askCancel.addEventListener('click', (event) => {
  event.stopPropagation();
  closeAsk();
});
askYes.addEventListener('click', (event) => {
  event.stopPropagation();
  closeAsk();
  disconnectWallet();
});
askCard.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('keydown', onAskKey, true);
disconnectBtn.addEventListener('click', openAsk);

if (window.defineLayer) {
  window.defineLayer(DISCONNECT_LAYER, {
    open: () => {
      if (!ask.hidden) return;
      showAsk(false);
    },
    close: () => {
      if (!ask.hidden) hideAsk();
    },
  });
}

walletBtn.addEventListener("click", () => {
  document.getElementById("connect-wallet-btn").style.display = "block";
  disconnectBtn.style.display = "none";
  walletBtn.style.display = "none";
});

