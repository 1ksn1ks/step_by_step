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
import { loadProfileSettings } from './loadprofilesettings';
import { loadTopicChatSettings } from './loadtopicchatset';
import { loadProfilePopup } from './loadprofilepopup';
import { loadProfileObject } from './loadprofileobject';
import { loadButtonInputSettings } from './loadbuttoninput';
import { loadMainButtonSettings } from './loadmainbutton';
import { loadMarkerSettings } from './loadmarkersett';
import { confirmNFTFunction } from './confirmnft';
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

    const signers = dAppConnector.signers;
    if (signers && signers.length > 0) {
      const accountId = signers[0].getAccountId().toString();
      connectedAccount = accountId;
      loadProfileCrosshair(accountId)
      loadProfileSettings(accountId)
      loadTopicChatSettings(accountId)
      loadProfilePopup(accountId)
      loadProfileObject(accountId)
      loadButtonInputSettings(accountId)
      loadMainButtonSettings(accountId)
      loadMarkerSettings(accountId)
      confirmNFTFunction(accountId)

      const senderId = AccountId.fromString(connectedAccount);
      signer = dAppConnector.getSigner(senderId);
      console.log('Signer obtained:', signer);
      console.log('Signer account:', signer.getAccountId()?.toString());

      const newToolbarLoad = document.getElementById("toolbar-load");
      newToolbarLoad.addEventListener("click", debounce(async () => {
        await confirmNFTFunction(accountId);
    }, 500));
    } else {
      const newToolbarLoad = document.getElementById("toolbar-load");
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

function updateUI() {
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
}

init();

async function connectWallet() {
  try {
    connectBtn.textContent = 'Connecting...';
    await dAppConnector.openModal();

    const signers = dAppConnector.signers;
    if (signers && signers.length > 0) {
      const accountId = signers[0].getAccountId().toString();
      connectedAccount = accountId;
      loadProfileCrosshair(accountId)
      loadProfileSettings(accountId)
      loadTopicChatSettings(accountId)
      loadProfilePopup(accountId)
      loadProfileObject(accountId)
      loadButtonInputSettings(accountId)
      loadMainButtonSettings(accountId)
      loadMarkerSettings(accountId)
      confirmNFTFunction(accountId)

      const senderId = AccountId.fromString(connectedAccount);
      signer = dAppConnector.getSigner(senderId);

      accountSpan.textContent = connectedAccount;
      disconnectBtn.style.display = "block";
      connectBtn.style.display = "none";
      disconnectBtn.textContent = 'Disconnect';
      document.getElementById("connect-new-wallet-btn").style.display = "none";

      console.log('Signer stored globally:', signer);
    } else {
      updateUI();
    }
  } catch (err) {
    console.error('Connection error:', err);
    updateUI();
  }
}

async function disconnectWallet() {
  try {
    const signClient = dAppConnector;
    await signClient.disconnectAll();

    connectedAccount = null;
    walletBtn.style.display = "block";
    disconnectBtn.style.display = "none";
    accountSpan.textContent = 'None';
    connectBtn.textContent = 'Connect';
  } catch (err) {
    console.error('Disconnect error:', err);
    connectedAccount = null;
    updateUI();
  }
}


connectBtn.addEventListener('click', connectWallet);
disconnectBtn.addEventListener('click', disconnectWallet);

walletBtn.addEventListener("click", () => {
  document.getElementById("connect-new-wallet-btn").style.display = "block";
  document.getElementById("connect-wallet-btn").style.display = "block";
  disconnectBtn.style.display = "none";
  walletBtn.style.display = "none";
});

document.getElementById("connect-new-wallet-btn").addEventListener("click", () => {
  window.open("https://wallet.hashpack.app", "_blank");
});

