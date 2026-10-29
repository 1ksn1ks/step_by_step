import { adjustTextareaHeight } from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { getAccountNFTs, getTopicInfo, subscribeToTopic } from './hedera';
import { sendMessage, messageSig, streamOnTopic, streamOnReconnect } from './msgbackend';
import { getTopicData } from './topicdata';
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage, encryptWithPassword, decryptWithPassword } from './sodium' 
import { connectedAccount, signer } from './web3';
import { profilePictures, usernames, click2url, profileTopics } from './loadalladata';
import { isHederaAccount } from './handleallmessages';
import { toast } from './toast'
import { HCS_CHUNK_SIZE, HCS_MESSAGE_MAX_BYTES, HCS_TOO_LONG, formatHcsUsage, utf8ByteLength, normalizeMessageNewlines } from './hcschunks.js';
import { expandEncryptedChat, scheduleEncryptedChatLayout } from './cssLogic.js';
import { payerUsernameNode } from './payerlink.js';
import { refreshFilterTimeButtons } from './drawdate.js';
import { fillChatMessage, packChatPayload, unpackChatPayload, pendingChatImage, chatImageBusy, clearPendingChatImage } from './chatimage.js';
import { watchFollowPrefetch } from './followtopic.js';
import { 
  topicChatHeaderColor,
  headerFontSizeTopicChat,
  accidTopicChatColor,
  innerContainerTopicChatColor,
  usernameTopicChatColor,
  textFontSizeTopicChat,
  textTopicChatColor,
  timestampFontSizeTopicChat,
 } from './letall';

export let allLoadedMessagesEncryptedChat = [];
export let storedMessagesEncryptedChat = [];

// ── E2EE message edits ──────────────────────────────────────────────
// HCS is immutable, so an edit is a new message that points at the
// original bubble (editEncryptedMessage.created) and carries the new text
// re-encrypted with the topic key. Only the original payer's own edits
// count; the latest edit wins. The on-chain payload is ciphertext, so a
// client without the topic key cannot read the edit either. The same ISO
// created the bubble renders from names it, so a fresh reload that
// replays history shows the edited text too.
const e2eeEditsByCreated = new Map(); // `${payer}|${createdIso}` → { text, image, at }

function e2eeCreatedIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function e2eeEditFor(payer, created) {
  const iso = e2eeCreatedIso(created);
  return payer && iso ? e2eeEditsByCreated.get(`${payer}|${iso}`) || null : null;
}

// Returns the stored edit when this one is the latest seen, else null.
// `data` is the editEncryptedMessage body; `envelope` is the edit's own
// created (consensus timestamp of the new message, or now() when applied
// locally); `PrivateKey` is the topic key used to decrypt the new text.
export async function rememberE2eeEdit(payer, data, envelope, PrivateKey) {
  if (!payer || !data || !data.created || !PrivateKey) return null;
  const created = e2eeCreatedIso(data.created);
  if (!created) return null;
  let parts;
  try {
    const decryptedRaw = await decryptMessage(data.encryptedMessage, PrivateKey);
    parts = unpackChatPayload(decryptedRaw);
  } catch {
    return null; // no key for this topic / malformed ciphertext: reject
  }
  const text = typeof parts.text === 'string' ? parts.text : '';
  // The image rides inside the sealed payload; data.image is only a
  // fallback for edits that were already sent the old way.
  const image = parts.image ? String(parts.image) : (data.image ? String(data.image) : '');
  if (!text && !image) return null;
  const at = e2eeCreatedIso(envelope) || '';
  // An edit that names a bubble from its own future is malformed noise.
  if (created && at && at <= created) return null;
  const key = `${payer}|${created}`;
  const prev = e2eeEditsByCreated.get(key);
  // A pending edit (no consensus time yet) never replaces a known one.
  if (!at && prev) return null;
  // Latest wins: an older edit arriving late never replaces a newer one.
  if (prev && prev.at && at && at < prev.at) return null;
  const entry = { text, image, at };
  e2eeEditsByCreated.set(key, entry);
  applyE2eeEditToDom(payer, created, entry);
  return entry;
}

// A live edit rewrites the text of the on-screen bubbles and adds the
// small "edited" mark next to the timestamp.
function applyE2eeEditToDom(payer, created, entry) {
  const iso = e2eeCreatedIso(created);
  if (!iso) return;
  const containers = document.querySelectorAll(
    `#messages-from-encrypted-chat [data-chat-payer="${payer}"][data-chat-created="${iso}"]`
  );
  for (const container of containers) {
    const text = container.querySelector('.chat-msg-text');
    if (text) fillChatMessage(text, entry.text, entry.image);
    addE2eeEditedMark(container.querySelector('.chat-msg-time'));
  }
}

function addE2eeEditedMark(timeEl) {
  if (!timeEl || timeEl.querySelector('.chat-edited-mark')) return;
  const mark = document.createElement('span');
  mark.className = 'chat-edited-mark';
  mark.textContent = 'edited';
  timeEl.appendChild(mark);
}

// Tag a rendered bubble so a later live edit can find it, and give own
// confirmed bubbles the discreet edit control.
function annotateE2eeBubble(wrapper, payer, createdIso, isPending) {
  if (!wrapper) return;
  if (createdIso) {
    wrapper.dataset.chatPayer = payer;
    wrapper.dataset.chatCreated = createdIso;
  }
  if (createdIso && !isPending && payer && payer === connectedAccount) {
    addE2eeEditButton(wrapper, payer, createdIso);
  }
}

function addE2eeEditButton(wrapper, payer, createdIso) {
  if (wrapper.querySelector('.chat-edit-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-edit-btn';
  btn.textContent = 'edit';
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    openE2eeChatEdit(payer, createdIso);
  });
  wrapper.appendChild(btn);
}

// ── Edit composer ───────────────────────────────────────────────────
// Same pattern as the post edit: prefill the composer with the text that
// is on screen, confirm in the wallet, and apply locally the moment it
// sends.
let e2eeChatEditTarget = null; // { payer, created, topicId, image, stamp }
let e2eeChatEditBusy = false;

function resolveE2eeEditTopicId() {
  const userInput = document.getElementById('encrypted-chat-topic-id').value.trim();
  if (!userInput) return '';
  const domainEntry = loadedDomains.find(entry => entry.domain === userInput.toLowerCase());
  return (domainEntry && domainEntry.lastMessage) ? domainEntry.lastMessage.topic : userInput;
}

// The display stamp the bubble renders from its created ISO — the same
// expression the timestamp span uses.
function e2eeChatStamp(createdIso) {
  return new Date(createdIso).toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// crypto_box_seal is fixed length (48 bytes overhead + message) and
// to_base64 is unpadded (2 bytes → 3 chars, 1 byte → 2 chars), so the
// outgoing JSON size is known before encrypting — the counter runs
// without a crypto round-trip.
const E2EE_SEAL_BYTES = 48;
function b64Len(bytes) {
  const mod = bytes % 3;
  return Math.floor(bytes / 3) * 4 + (mod === 1 ? 2 : mod === 2 ? 3 : 0);
}
function e2eeChatEditOutgoing(newText) {
  const target = e2eeChatEditTarget;
  // The image rides inside the sealed payload, the same as a normal send —
  // so it counts toward the outgoing size here too.
  const sealedBytes = E2EE_SEAL_BYTES + utf8ByteLength(packChatPayload(newText, target.image || ''));
  const data = {
    created: target.created,
    timestamp: target.stamp,
    encryptedMessage: { ciphertext: 'x'.repeat(b64Len(sealedBytes)) }
  };
  return JSON.stringify({ editEncryptedMessage: data });
}

function paintE2eeChatEditBytes() {
  const counter = document.getElementById('e2ee-chat-edit-bytes');
  const save = document.getElementById('e2ee-chat-edit-save');
  const text = document.getElementById('e2ee-chat-edit-text');
  if (!counter || !text || !e2eeChatEditTarget) return;
  const usage = formatHcsUsage(utf8ByteLength(e2eeChatEditOutgoing(text.value)));
  counter.textContent = usage.text;
  counter.classList.toggle('hcs-warn', usage.warn);
  counter.classList.toggle('hcs-over', usage.over);
  if (save) save.classList.toggle('hcs-send-blocked', usage.over);
}

const e2eeChatComposeControls = ['user-write-message-encrypted-chat', 'char-counter-encrypted-chat', 'encrypted-chat-image-btn', 'post-msg-encrypted-chat'];
function setE2eeChatEditing(on) {
  const box = document.getElementById('e2ee-chat-editbox');
  if (!box) return;
  for (const id of e2eeChatComposeControls) {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? 'none' : '';
  }
  box.style.display = on ? 'block' : 'none';
}

function openE2eeChatEdit(payer, created) {
  const createdIso = e2eeCreatedIso(created);
  if (!createdIso || payer !== connectedAccount) return;
  const topicId = resolveE2eeEditTopicId();
  if (!topicId) {
    toast.error('Please enter a Topic ID or domain.');
    return;
  }
  const container = document.querySelector(
    `#messages-from-encrypted-chat [data-chat-payer="${payer}"][data-chat-created="${createdIso}"]`
  );
  const currentText = container
    ? (container.querySelector('.chat-msg-body')?.textContent || '')
    : '';
  const imgEl = container && container.querySelector('.chat-msg-image');
  e2eeChatEditTarget = {
    payer,
    created: createdIso,
    topicId,
    // data-full-src is the original image URL. The bubble shows that same URL.
    image: imgEl ? (imgEl.dataset.fullSrc || imgEl.getAttribute('src') || '') : '',
    stamp: e2eeChatStamp(createdIso),
  };
  const text = document.getElementById('e2ee-chat-edit-text');
  if (text) text.value = currentText;
  setE2eeChatEditing(true);
  paintE2eeChatEditBytes();
  if (text) text.focus();
}

function closeE2eeChatEdit() {
  setE2eeChatEditing(false);
  e2eeChatEditTarget = null;
}

// ── Admin-pinned public key, cached per topic ────────────────────────
// Both the normal send and saveE2eeChatEdit resolve the topic's public
// key by scanning history for the admin's {publicKey} message. The key
// rarely changes, so cache it per topicId: one lookup, then reuse.
//
// The hazard is a rotation from another device: encrypting to a stale
// but still valid key never fails, so a failed encrypt (below) is not
// enough. Entries therefore expire after a few minutes, and every admin
// {publicKey} message that arrives in loaded or streamed history drops
// the entry when it is newer than the one the cache was built from. A
// fresh local pin drops it too.
const E2EE_KEY_TTL_MS = 5 * 60 * 1000;
export const e2eePublicKeysByTopic = new Map(); // topicId → { key, at, created }

export function setCachedE2eeKey(topicId, key, created) {
  e2eePublicKeysByTopic.set(topicId, { key, at: Date.now(), created: created || null });
}

// The entry, or null when absent or expired — an expired entry is
// dropped so the next send re-looks-up the current pin.
export function cachedE2eeKey(topicId) {
  const entry = e2eePublicKeysByTopic.get(topicId);
  if (!entry) return null;
  if (Date.now() - entry.at >= E2EE_KEY_TTL_MS) {
    e2eePublicKeysByTopic.delete(topicId);
    return null;
  }
  return entry;
}

function e2eeKeyStamp(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? -1 : t;
}

// Newest-first scan for the admin's {publicKey} message. Returns
// { key, result, keyCreated }: key is null until the admin pins one;
// result is the fetched topic data, for callers that also want to
// refresh with it; keyCreated stamps the pin message so a newer pin
// arriving later is recognisable.
export async function lookupE2eePublicKey(topicId) {
  const topicInfo = await getTopicInfo(topicId);
  const topicAdmin = (topicInfo.memo || "").split(',').map(part => part.trim()).filter(part => part.startsWith('0.0.'));
  const result = await getTopicData(topicId);
  const messages = result.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
    if (parsedMessage.publicKey && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
      return { key: parsePublicKey(parsedMessage.publicKey), result, keyCreated: (message && message.created) || parsedMessage.created || null };
    }
  }
  return { key: null, result };
}

async function saveE2eeChatEdit() {
  if (e2eeChatEditBusy || !e2eeChatEditTarget) return;
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return;
  }
  const save = document.getElementById('e2ee-chat-edit-save');
  if (save && save.classList.contains('hcs-send-blocked')) {
    toast.error(HCS_TOO_LONG);
    return;
  }
  const target = e2eeChatEditTarget;
  // Same key discovery as a normal E2EE send: the admin-pinned public key,
  // cached per topic with a short lifetime (e2eePublicKeysByTopic above).
  const cached = cachedE2eeKey(target.topicId);
  let PublicKey = cached ? cached.key : null;
  if (!PublicKey) {
    try {
      const lookedUp = await lookupE2eePublicKey(target.topicId);
      PublicKey = lookedUp.key;
      if (PublicKey) setCachedE2eeKey(target.topicId, PublicKey, lookedUp.keyCreated);
    } catch (error) {
      console.error('e2ee edit key lookup failed', error);
      toast.error('No public key found for this topic.');
      return;
    }
    if (!PublicKey) {
      toast.error('No public key found for this topic. The admin must pin one first.');
      return;
    }
  }
  const text = document.getElementById('e2ee-chat-edit-text');
  e2eeChatEditBusy = true;
  try {
    // Encrypt before build: plaintext never enters the HCS JSON. The image
    // rides inside the sealed payload, the same as a normal send.
    const payload = packChatPayload(text ? text.value : '', target.image || '');
    let encryptedMessage;
    try {
      encryptedMessage = await encryptMessage(payload, PublicKey);
    } catch (error) {
      // A bad cached key would fail every encrypt — drop it and look the
      // pin up once more.
      e2eePublicKeysByTopic.delete(target.topicId);
      const lookedUp = await lookupE2eePublicKey(target.topicId);
      PublicKey = lookedUp.key;
      if (!PublicKey) {
        toast.error('No public key found for this topic. The admin must pin one first.');
        return;
      }
      setCachedE2eeKey(target.topicId, PublicKey, lookedUp.keyCreated);
      encryptedMessage = await encryptMessage(payload, PublicKey);
    }
    const data = {
      created: target.created,
      timestamp: target.stamp,
      encryptedMessage
    };
    const outgoing = JSON.stringify({ editEncryptedMessage: data });
    if (utf8ByteLength(outgoing) > HCS_MESSAGE_MAX_BYTES) {
      toast.error(HCS_TOO_LONG);
      return;
    }
    toast.info('Confirm in wallet 👛');
    await sendMessage(target.topicId, outgoing);
    // Apply locally right away; the topic stream confirms the same edit.
    await rememberE2eeEdit(target.payer, data, new Date().toISOString(), window.currentEncryptedPrivateKey);
    closeE2eeChatEdit();
    toast.success('Saved');
  } catch (error) {
    console.error('e2ee chat edit failed', error);
    toast.error('Edit was not saved');
  } finally {
    e2eeChatEditBusy = false;
  }
}

const e2eeChatEditSave = document.getElementById('e2ee-chat-edit-save');
if (e2eeChatEditSave) e2eeChatEditSave.addEventListener('click', saveE2eeChatEdit);
const e2eeChatEditCancel = document.getElementById('e2ee-chat-edit-cancel');
if (e2eeChatEditCancel) e2eeChatEditCancel.addEventListener('click', closeE2eeChatEdit);
const e2eeChatEditText = document.getElementById('e2ee-chat-edit-text');
if (e2eeChatEditText) e2eeChatEditText.addEventListener('input', paintE2eeChatEditBytes);

// Helper function to check valid URL
function isValidUrl(string) {
  try { new URL(string); return true; } catch (_) { return false; }
}

// Helper function to create empty state message
function createEmptyStateMessage(container, message) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  
  const emptyDiv = document.createElement('div');
  emptyDiv.style.cssText = 'display: flex; justify-content: left; align-items: left; height: 100%;';
  emptyDiv.className = 'chat-state';
  
  const emptySpan = document.createElement('span');
  emptySpan.style.marginLeft = '0.45vh';
  emptySpan.textContent = message;
  
  emptyDiv.appendChild(emptySpan);
  container.appendChild(emptyDiv);
  expandEncryptedChat();
}

// Helper function to create loading spinner
function createLoadingSpinner(container, topicId) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  
  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'display: flex; justify-content: left; align-items: left; height: 100%;';
  loadingDiv.className = 'chat-state';
  
  const spinner = document.createElement('div');
  spinner.id = 'topicspinnerchat';
  loadingDiv.appendChild(spinner);
  
  const loadingSpan = document.createElement('span');
  loadingSpan.style.marginLeft = '0.45vh';
  loadingSpan.textContent = `Loading messages from ${topicId}`;
  loadingDiv.appendChild(loadingSpan);
  
  container.appendChild(loadingDiv);
}

document.getElementById("load-msgs-from-encrypted-chat").addEventListener("click", async () => {
  await loadMessagesFromEncryptedChat();
});

// Grouping state for encrypted chat
let previousPayerEncryptedChat = null;
let currentGroupContainerEncrypted = null;
let currentMessagesGroupDivEncrypted = null;

export async function appendEncryptedChatMessage(
  message,
  messagesContainer,
  topicAdmin,
  loadedNFTsForTopicChat,
  PrivateKey,
  topicId
) {
  try {
    let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
    const payer = parsedMessage.payer || 'Unknown';

    // An admin pin is a directive, not a bubble — and a rotation signal:
    // a pin newer than the one behind the cached key makes that key
    // stale, and encrypting to a stale key never fails, so drop it here.
    if (topicId && parsedMessage.publicKey) {
      const pinPayer = (message && message.payer) || parsedMessage.payer;
      if (topicAdmin.length === 0 || topicAdmin.includes(pinPayer)) {
        const entry = e2eePublicKeysByTopic.get(topicId);
        const created = (message && message.created) || parsedMessage.created || null;
        if (entry && (!entry.created || e2eeKeyStamp(created) > e2eeKeyStamp(entry.created))) {
          e2eePublicKeysByTopic.delete(topicId);
        }
      }
      return;
    }

    // An edit is a directive, not a bubble: remember it (and rewrite the
    // open bubble) but never render a second bubble for it.
    if (parsedMessage.editEncryptedMessage) {
      await rememberE2eeEdit(
        payer,
        parsedMessage.editEncryptedMessage,
        (message && message.created) || parsedMessage.created,
        PrivateKey
      );
      return;
    }

    // NFT check
    let payerHasNFT = loadedNFTsForTopicChat.length === 0;
    if (!payerHasNFT) {
      for (const item of loadedNFTsForTopicChat) {
        const has = await getAccountNFTs(payer, item);
        if (has.length > 0) {
          payerHasNFT = true;
          break;
        }
      }
    }

    if (!payerHasNFT || !parsedMessage.encryptedMessage) return;

    // Decrypt the message
    const decryptedRaw = await decryptMessage(parsedMessage.encryptedMessage, PrivateKey);
    const parts = unpackChatPayload(decryptedRaw);
    if (!parts.text && !parts.image) return;

    const fullMessage = {
      decryptedMessage: parts.text,
      image: parts.image,
      created: parsedMessage.created,
      payer
    };
    storedMessagesEncryptedChat.push(fullMessage);

    const payerImage = profilePictures[payer]?.url || 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
    const validPayerImage = isValidUrl(payerImage) ? payerImage : 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';

    const timestamp = new Date(parsedMessage.created).toLocaleString('en-US', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const payerInfo = message.payer || 'Anonymous';
    const username = message.payer && usernames[message.payer]?.username
      ? ` ${usernames[message.payer].username}` : '';
    const click2link = message.payer && click2url[message.payer]?.click2url
      ? ` ${click2url[message.payer].click2url}` : '';

    // ========== GROUPING ==========
    if (payer !== previousPayerEncryptedChat) {
      currentGroupContainerEncrypted = document.createElement('div');
      currentGroupContainerEncrypted.className = 'toolbar-group-messages';
      currentGroupContainerEncrypted.style.cssText = `
        position: relative;
        padding-left: 2.5em;
        min-height: 2.5em;
        border-color: ${innerContainerTopicChatColor};
      `;

      const img = document.createElement('img');
      img.src = validPayerImage;
      img.alt = 'Profile photo';
      img.dataset.payer = payer;
      img.style.cssText = `
        position: absolute;
        left: 0.25em;
        top: 0.5em;
        width: 2em;
        height: 2em;
        border-radius: 1em;
        cursor: pointer;
      `;
      img.addEventListener('click', () => loadBio4PIC(payer));
      watchFollowPrefetch(img, payer);
      currentGroupContainerEncrypted.appendChild(img);

      const contentWrapper = document.createElement('div');
      contentWrapper.style.cssText = 'display: flex; flex-direction: column;';

      const headerContainer = document.createElement('div');
      headerContainer.style.cssText = 'display: flex; align-items: center;';

      const headerDiv = document.createElement('div');
      headerDiv.className = 'toolbar-group-messages-header';
      headerDiv.style.cssText = `
        display: flex;
        align-items: center;
        border-color: ${topicChatHeaderColor};
        font-size: ${headerFontSizeTopicChat}vh;
      `;

      const accLink = document.createElement('a');
      accLink.href = `https://explore.hashpack.app/${encodeURIComponent(payerInfo)}`;
      accLink.target = '_blank';
      accLink.rel = 'noopener noreferrer';
      accLink.style.cssText = `
        color: ${accidTopicChatColor};
        text-decoration: none;
        font-size: ${headerFontSizeTopicChat}vh;
      `;
      accLink.textContent = payerInfo;
      headerDiv.appendChild(accLink);

      headerDiv.appendChild(document.createTextNode('\u00A0'));

      const trimmedUsername = username.trim();
      if (trimmedUsername) {
        headerDiv.appendChild(payerUsernameNode(trimmedUsername, click2link, {
          cssText: `color: ${usernameTopicChatColor}; font-size: ${headerFontSizeTopicChat}vh;`
        }));
      }

      headerContainer.appendChild(headerDiv);
      contentWrapper.appendChild(headerContainer);

      currentMessagesGroupDivEncrypted = document.createElement('div');
      contentWrapper.appendChild(currentMessagesGroupDivEncrypted);

      currentGroupContainerEncrypted.appendChild(contentWrapper);
      messagesContainer.appendChild(currentGroupContainerEncrypted);
      messagesContainer.appendChild(document.createElement('br'));

      previousPayerEncryptedChat = payer;
    }

    // ========== ADD MESSAGE ==========
    const msgWrapper = document.createElement('div');
    msgWrapper.style.cssText = `
      display: flex;
      flex-direction: column;
      justify-content: center;
      margin-top: 0.2em;
    `;

    // An edit names this bubble by created and carries the latest text; it
    // never changes the media, so the image stays the original's.
    const editHit = e2eeEditFor(payer, parsedMessage.created);
    const displayText = editHit ? editHit.text : parts.text;
    const displayImage = editHit ? editHit.image : parts.image;

    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = `color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;`;
    contentDiv.className = 'chat-msg-text';
    fillChatMessage(contentDiv, displayText, displayImage);

    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = `font-size: ${timestampFontSizeTopicChat}vh; color: gray;`;
    timeSpan.className = 'chat-msg-time';
    timeSpan.textContent = message.pending ? `⏳ ${timestamp}` : timestamp;
    if (editHit) addE2eeEditedMark(timeSpan);
    if (message.pending) msgWrapper.dataset.sig = messageSig(message);

    msgWrapper.appendChild(contentDiv);
    msgWrapper.appendChild(timeSpan);
    annotateE2eeBubble(msgWrapper, payer, e2eeCreatedIso(parsedMessage.created), !!message.pending);
    currentMessagesGroupDivEncrypted.appendChild(msgWrapper);

    // messagesContainer.scrollTop = messagesContainer.scrollHeight;
    adjustTextareaHeight(messagesContainer);
    applyEncryptedChatMsgFilterSort();

  } catch (err) {
    console.error("Error rendering encrypted message:", err);
  }
}

// Pending-bubble housekeeping (driven by the live stream events).
// Returns the bubble so the caller can re-tag it with its consensus time.
function clearPendingMarker(container, sig) {
  for (const el of container.querySelectorAll('[data-sig]')) {
    if (el.dataset.sig !== sig) continue;
    delete el.dataset.sig;
    const t = el.querySelector('.chat-msg-time');
    if (t) t.textContent = t.textContent.replace('⏳ ', '');
    return el;
  }
  return null;
}
function removePendingBubble(container, sig) {
  for (const el of container.querySelectorAll('[data-sig]')) {
    if (el.dataset.sig === sig) {
      el.remove();
      scheduleEncryptedChatLayout();
      break;
    }
  }
}

// Live search + sort for the e2ee chat message groups
// (payer id = "topic id", username = "topic name")
let encryptedChatMsgSortDir = null; // null = chronological, 'az'/'za' = by username

function encryptedChatGroupUsername(group) {
  const payer = group.querySelector('img')?.dataset.payer || '';
  return (usernames[payer]?.username || '').trim() || payer;
}

function applyEncryptedChatMsgFilterSort() {
  const container = document.getElementById('messages-from-encrypted-chat');
  if (!container) return;
  const searchEl = document.getElementById('e2ee-chat-msg-search');
  const query = (searchEl ? searchEl.value : '').trim().toLowerCase();

  const oldEmpty = container.querySelector('.chat-msg-empty');
  if (oldEmpty) oldEmpty.remove();
  const groups = Array.from(container.children).filter(el => el.classList.contains('toolbar-group-messages'));

  let visible = groups;
  if (query) {
    visible = groups.filter(g => {
      const payer = g.querySelector('img')?.dataset.payer || '';
      const username = (usernames[payer]?.username || '').toLowerCase();
      return payer.toLowerCase().includes(query) || username.includes(query);
    });
  }
  groups.forEach(g => g.style.display = 'none');
  visible.forEach(g => g.style.display = '');

  if (encryptedChatMsgSortDir) {
    visible = [...visible].sort((a, b) =>
      encryptedChatMsgSortDir === 'az'
        ? encryptedChatGroupUsername(a).localeCompare(encryptedChatGroupUsername(b), undefined, { sensitivity: 'base', numeric: true })
        : encryptedChatGroupUsername(b).localeCompare(encryptedChatGroupUsername(a), undefined, { sensitivity: 'base', numeric: true }));
    visible.forEach(g => container.appendChild(g));
  }

  if (query && visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-msg-empty';
    empty.style.cssText = 'color: gray; padding: 1vh 0; text-align: center;';
    empty.textContent = 'No matching messages';
    container.appendChild(empty);
  }
  adjustTextareaHeight(container);
  scheduleEncryptedChatLayout();
}

const encryptedChatMsgSearch = document.getElementById('e2ee-chat-msg-search');
const encryptedChatMsgSortAz = document.getElementById('e2ee-chat-msg-sort-az');
const encryptedChatMsgSortZa = document.getElementById('e2ee-chat-msg-sort-za');

function updateEncryptedChatMsgSortButtons() {
  encryptedChatMsgSortAz.classList.toggle('active', encryptedChatMsgSortDir === 'az');
  encryptedChatMsgSortZa.classList.toggle('active', encryptedChatMsgSortDir === 'za');
}

if (encryptedChatMsgSearch) {
  encryptedChatMsgSearch.addEventListener('input', applyEncryptedChatMsgFilterSort);
}
if (encryptedChatMsgSortAz) {
  encryptedChatMsgSortAz.addEventListener('click', (e) => {
    e.stopPropagation();
    encryptedChatMsgSortDir = encryptedChatMsgSortDir === 'az' ? null : 'az';
    updateEncryptedChatMsgSortButtons();
    applyEncryptedChatMsgFilterSort();
  });
}
if (encryptedChatMsgSortZa) {
  encryptedChatMsgSortZa.addEventListener('click', (e) => {
    e.stopPropagation();
    encryptedChatMsgSortDir = encryptedChatMsgSortDir === 'za' ? null : 'za';
    updateEncryptedChatMsgSortButtons();
    applyEncryptedChatMsgFilterSort();
  });
}

// The E2EE input takes a domain, a topic id, or a PAYER id: a payer with a
// topic connected to their profile is messaged on that topic (their public
// key is pinned there via Edit profile). Usernames are deliberately not
// accepted — anyone can squat a name on a fresh account.
async function resolveE2eeTopic(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return { error: 'Please enter a Topic ID, domain, or payer ID.' };
  const domainEntry = loadedDomains.find(entry => entry.domain === value);
  if (domainEntry && domainEntry.lastMessage) {
    return { topicId: domainEntry.lastMessage.topic, via: domainEntry.domain };
  }
  const bare = value.split('-')[0];
  if (bare in profileTopics) {
    return { topicId: profileTopics[bare], via: bare };
  }
  if (/^(0\.0\.\d+)(?:-[a-z0-9]+)?$/.test(value) && (await isHederaAccount(bare))) {
    return { error: `${bare} has no public topic connected — connect one in Edit profile first.` };
  }
  return { topicId: value, via: null };
}

async function loadMessagesFromEncryptedChat() {
  try {
    const resolved = await resolveE2eeTopic(document.getElementById("encrypted-chat-topic-id").value);

    const messagesContainer = document.getElementById("messages-from-encrypted-chat");
    if (!messagesContainer) return;
    if (resolved.error) {
      createEmptyStateMessage(messagesContainer, resolved.error);
      adjustTextareaHeight(messagesContainer);
      return;
    }
    let topicId = resolved.topicId;

    // Reset grouping state
    previousPayerEncryptedChat = null;
    currentGroupContainerEncrypted = null;
    currentMessagesGroupDivEncrypted = null;
    storedMessagesEncryptedChat = [];

    createLoadingSpinner(
      messagesContainer,
      resolved.via && resolved.via !== resolved.topicId
        ? `${resolved.topicId} (via ${resolved.via})`
        : topicId
    );
    adjustTextareaHeight(messagesContainer);
    expandEncryptedChat();

    // Get topic admins
    const topicAdmin = [];
    try {
      const topicInfo = await getTopicInfo(topicId);
      const memo = topicInfo.memo || "";
      memo.split(',').forEach(part => {
        if (part.trim().startsWith("0.0.")) {
          topicAdmin.push(part.trim());
        }
      });
    } catch (error) {
      createEmptyStateMessage(messagesContainer, 'Invalid Topic ID');
      adjustTextareaHeight(messagesContainer);
      return;
    }

    // History from the data layer (backend preferred, phones off the
    // mirror). Live updates: the shared SSE stream when the backend has
    // the topic (subscribed below, once the private key is ready),
    // otherwise the original mirror path.
    const viaData = await getTopicData(topicId);
    let rawResult;
    if (viaData.viaBackend) {
      rawResult = { messages: viaData.messages };
    } else {
      rawResult = await subscribeToTopic(topicId, async (newMsg) => {
        // Live message → decrypt + render
        if (window.currentEncryptedPrivateKey) {
          await appendEncryptedChatMessage(
            newMsg,
            messagesContainer,
            topicAdmin,
            window.currentLoadedNFTsEncrypted || [],
            window.currentEncryptedPrivateKey,
            topicId
          );
        }
      });
    }

    const messages = rawResult.messages || [];

    // ========== DECRYPT PRIVATE KEY ==========
    const pass = document.getElementById("encrypted-chat-private-key");
    const w = pass.value;
    let decryptedPrivateKey = w;

    try {
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;

        if (parsedMessage.encryptedPrivateKey && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const encryptedPrivateKey = parsedMessage.encryptedPrivateKey;
          const nonce = parsedMessage.nonce;
          const salt = parsedMessage.salt;

          decryptedPrivateKey = await decryptWithPassword(encryptedPrivateKey, nonce, salt, w);
          break;
        }
      }
    } catch (error) {
      createEmptyStateMessage(messagesContainer, 'wrong password');
      adjustTextareaHeight(messagesContainer);
      return;
    }

    const PrivateKey = parsePrivateKey(decryptedPrivateKey);

    // Store for live messages
    window.currentEncryptedPrivateKey = PrivateKey;

    // ========== COLLECT NFTs ==========
    const loadedNFTsForTopicChat = [];
    for (const msg of messages) {
      try {
        let parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
        const payer = parsed.payer || '';
        if (topicAdmin.length === 0 || topicAdmin.includes(payer)) {
          if (parsed.addTopicChatNFT) {
            parsed.addTopicChatNFT.split(',').map(n => n.trim()).forEach(nft => {
              if (nft.startsWith("0.0.") && !loadedNFTsForTopicChat.includes(nft)) {
                loadedNFTsForTopicChat.push(nft);
              }
            });
          }
          if (parsed.removeTopicChatNFT) {
            const nft = parsed.removeTopicChatNFT.trim();
            if (nft.startsWith("0.0.")) {
              const idx = loadedNFTsForTopicChat.indexOf(nft);
              if (idx !== -1) loadedNFTsForTopicChat.splice(idx, 1);
            }
          }
        }
      } catch {}
    }

    window.currentLoadedNFTsEncrypted = loadedNFTsForTopicChat;

    // Clear container
    while (messagesContainer.firstChild) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }

    // Render history
    for (const message of messages) {
      await appendEncryptedChatMessage(
        message,
        messagesContainer,
        topicAdmin,
        loadedNFTsForTopicChat,
        PrivateKey,
        topicId
      );
    }

    // Live updates via the shared SSE stream — started after the private
    // key is ready so live messages can be decrypted as they arrive
    if (viaData.viaBackend) {
      const seen = new Set(messages.map(messageSig));
      const pendingSigs = new Set(messages.filter((m) => m.pending).map(messageSig));
      let liveReady = false;
      const renderLive = (m) =>
        appendEncryptedChatMessage(
          m,
          messagesContainer,
          topicAdmin,
          window.currentLoadedNFTsEncrypted || [],
          PrivateKey,
          topicId
        );
      const handleStream = (evt) => {
        const m = evt.message;
        const sig = messageSig(m);
        if (evt.type === "pending") {
          if (seen.has(sig)) return;
          seen.add(sig);
          pendingSigs.add(sig);
          renderLive(m);
        } else if (evt.type === "message") {
          if (seen.has(sig)) {
            if (pendingSigs.has(sig)) {
              pendingSigs.delete(sig);
              // Pending → confirmed: re-tag with the consensus time and
              // give own bubbles the edit control.
              annotateE2eeBubble(clearPendingMarker(messagesContainer, sig), m.payer, e2eeCreatedIso(m.created), false);
            }
            return;
          }
          seen.add(sig);
          renderLive(m);
        } else if (evt.type === "confirmed") {
          if (pendingSigs.has(sig)) {
            pendingSigs.delete(sig);
            annotateE2eeBubble(clearPendingMarker(messagesContainer, sig), m.payer, e2eeCreatedIso(m.created), false);
          }
        } else if (evt.type === "expired") {
          if (pendingSigs.has(sig)) {
            pendingSigs.delete(sig);
            removePendingBubble(messagesContainer, sig);
          }
        }
      };
      const offTopic = streamOnTopic(topicId, handleStream);
      const offReconnect = streamOnReconnect(async () => {
        if (!liveReady) {
          liveReady = true;
          return;
        }
        const fresh = await getTopicData(topicId, { force: true });
        for (const m of fresh.messages) {
          const sig = messageSig(m);
          if (seen.has(sig)) continue;
          seen.add(sig);
          if (m.pending) pendingSigs.add(sig);
          renderLive(m);
        }
      });
      if (messagesContainer.__offLive) messagesContainer.__offLive();
      const offLive = () => {
        offTopic();
        offReconnect();
      };
      messagesContainer.__offLive = offLive;
    }

    if (messagesContainer.children.length === 0) {
      createEmptyStateMessage(messagesContainer, 'No messages found');
    } else {
      adjustTextareaHeight(messagesContainer);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      toast.loaded("Encrypted messages loaded");
    }
    expandEncryptedChat();

  } catch (error) {
    console.error("Error loading encrypted chat messages:", error);
  }
}

document.getElementById('go-to-top-msgs-encrypted-chat').addEventListener('click', function() {
  const container = document.getElementById('messages-from-encrypted-chat');
  container.stopSmoothScroll?.();
  container.scrollTop = 0;
});

// Show the arrows while scrolling (⬆ when not at the very top, ⬇ when not
// at the very bottom); fade out 2s after scrolling stops
const e2eeMessages = document.getElementById('messages-from-encrypted-chat');
const e2eeGoToTop = document.getElementById('go-to-top-msgs-encrypted-chat');
const e2eeGoToBottom = document.getElementById('go-to-bottom-msgs-encrypted-chat');
let e2eeArrowsTimer = null;
function updateE2eeArrows() {
  const atTop = e2eeMessages.scrollTop <= 0;
  const atBottom = e2eeMessages.scrollHeight - e2eeMessages.scrollTop - e2eeMessages.clientHeight <= 0;
  e2eeGoToTop.classList.toggle('go-to-top-visible', !atTop);
  e2eeGoToBottom.classList.toggle('go-to-bottom-visible', !atBottom);
  clearTimeout(e2eeArrowsTimer);
  e2eeArrowsTimer = setTimeout(() => {
    e2eeGoToTop.classList.remove('go-to-top-visible');
    e2eeGoToBottom.classList.remove('go-to-bottom-visible');
  }, 2000);
}
e2eeMessages.addEventListener('scroll', updateE2eeArrows, { passive: true });

document.getElementById('go-to-bottom-msgs-encrypted-chat').addEventListener('click', function() {
  const container = document.getElementById('messages-from-encrypted-chat');
  container.stopSmoothScroll?.();
  container.scrollTop = container.scrollHeight;
});

document.getElementById("post-msg-encrypted-chat").addEventListener("click", async () => {
  try {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    const resolved = await resolveE2eeTopic(document.getElementById("encrypted-chat-topic-id").value);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    let topicId = resolved.topicId;

    const messagesContainer = document.getElementById("messages-from-encrypted-chat");
    // Admin-pinned public key, cached per topic with a short lifetime
    // (shared with the edit path) — only a miss or an expired entry
    // fetches and scans.
    const cached = cachedE2eeKey(topicId);
    let PublicKey = cached ? cached.key : null;
    if (!PublicKey) {
      try {
        const lookedUp = await lookupE2eePublicKey(topicId);
        PublicKey = lookedUp.key;
        // Data layer: session cache → backend (instant, phones off the
        // mirror) → mirror fallback. (The admin password flow further down
        // keeps the mirror: it scans full history for the admin's key
        // message.)
        allLoadedMessagesEncryptedChat = [lookedUp.result];
        if (PublicKey) setCachedE2eeKey(topicId, PublicKey, lookedUp.keyCreated);
      } catch (error) {
        createEmptyStateMessage(messagesContainer, 'No public key found');
        adjustTextareaHeight(messagesContainer);
        console.error("Error getting public key:", error);
        return;
      }
      adjustTextareaHeight(messagesContainer);
    }

    if (!PublicKey) {
      toast.error("No public key found for this topic. The admin must pin one first.");
      return;
    }

    const message = normalizeMessageNewlines(document.getElementById("user-write-message-encrypted-chat").value);
    if (chatImageBusy("e2ee")) {
      toast.error("Wait for the image to finish uploading");
      return;
    }
    const image = pendingChatImage("e2ee");
    if (!message && !image) {
      toast.error("Please enter a message.");
      return;
    }
    const payload = packChatPayload(message, image);
    let encryptedMessage;
    try {
      encryptedMessage = await encryptMessage(payload, PublicKey);
    } catch (error) {
      // A bad cached key would fail every encrypt — drop it and look the
      // pin up once more.
      e2eePublicKeysByTopic.delete(topicId);
      const lookedUp = await lookupE2eePublicKey(topicId);
      PublicKey = lookedUp.key;
      if (!PublicKey) {
        toast.error("No public key found for this topic. The admin must pin one first.");
        return;
      }
      setCachedE2eeKey(topicId, PublicKey, lookedUp.keyCreated);
      encryptedMessage = await encryptMessage(payload, PublicKey);
    }

    const meesageobject = {
      encryptedMessage: encryptedMessage
    };
    
    const newMeesage = JSON.stringify(meesageobject);
    console.log('New Meesage:', newMeesage);
    if (utf8ByteLength(newMeesage) > HCS_MESSAGE_MAX_BYTES) {
      toast.error(HCS_TOO_LONG);
      return;
    }
    if (utf8ByteLength(newMeesage) <= HCS_CHUNK_SIZE) toast.info("Confirm in wallet 👛");
    const reciept = await sendMessage(topicId, newMeesage);
    if (image) clearPendingChatImage("e2ee");
    console.log('Reciept:', reciept);
  } catch (error) {
    console.error('Error:', error.message);
  }
});

document.getElementById("stack-encrypted-chat-public-key-button").addEventListener("click", async () => {
  try {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    const resolved = await resolveE2eeTopic(document.getElementById("encrypted-chat-topic-id").value);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    const topicId = resolved.topicId;
    let publicKey = document.getElementById("encrypted-chat-public-key").value;
    if (!publicKey) {
      toast.error("Please enter a public key.");
      return;
    }

    const messageobject = {
      publicKey: publicKey
    };
    const message = JSON.stringify(messageobject);
    toast.info("Confirm in wallet 👛");
    const receipt = await sendMessage(topicId, message);
    // A fresh pin is a key rotation: the cached key (if any) is stale now.
    e2eePublicKeysByTopic.delete(topicId);
    console.log('Receipt:', receipt);
  } catch (error) {
    console.error('Error:', error.message);
  }
});

async function filterEncryptedChatMessages(fromDateValue, toDateValue, fromTimeValue, toTimeValue, loadUsersArray, blockUsersArray) {
  let loadedUsersEncryptedChat = loadUsersArray || [];
  let blockUsersEncryptedChat = blockUsersArray || [];

  let fromDate;
  let toDate;

  // Handle date and time parsing (native date/time input values: YYYY-MM-DD / HH:MM)
  if (fromTimeValue && toTimeValue && fromDateValue && toDateValue) {
    const [fY, fM, fD] = fromDateValue.split("-").map(Number);
    const [fH, fMin] = fromTimeValue.split(":").map(Number);
    const [tY, tM, tD] = toDateValue.split("-").map(Number);
    const [tH, tMin] = toTimeValue.split(":").map(Number);
    fromDate = new Date(fY, fM - 1, fD, fH, fMin);
    toDate = new Date(tY, tM - 1, tD, tH, tMin, 59, 999); // include the whole "to" minute
  } else if (fromDateValue && toDateValue) {
    const [fY, fM, fD] = fromDateValue.split("-").map(Number);
    const [tY, tM, tD] = toDateValue.split("-").map(Number);
    fromDate = new Date(fY, fM - 1, fD);
    toDate = new Date(tY, tM - 1, tD, 23, 59, 59, 999); // include the whole "to" day
  } else {
    fromDate = new Date(0);
    toDate = new Date();
  }

  // Filter messages
  const filteredMessagesEncryptedChat = storedMessagesEncryptedChat.filter(parsedMessage => {
    const messageDate = new Date(parsedMessage.created);

    const conditions = [];

    if (fromDate && toDate) {
      conditions.push(messageDate >= fromDate && messageDate <= toDate);
    }

    if (loadedUsersEncryptedChat.length > 0) {
      conditions.push(loadedUsersEncryptedChat.includes(parsedMessage.payer));
    }

    if (blockUsersEncryptedChat.length > 0) {
      conditions.push(!blockUsersEncryptedChat.includes(parsedMessage.payer));
    }

    if (conditions.length === 0) return true;

    return conditions.every(condition => condition);
  });

  // ────────────────────────────────────────────────────────────────
  // SAFE DOM RENDERING
  // ────────────────────────────────────────────────────────────────

  const messagesContainer = document.getElementById('messages-from-encrypted-chat');
  if (!messagesContainer) return;

  while (messagesContainer.firstChild) {
    messagesContainer.removeChild(messagesContainer.firstChild);
  }

  const fragment = document.createDocumentFragment();

  let previousPayer = null;
  let currentGroupDiv = null;
  let currentMessagesGroupDiv = null;
  let isFirstGroup = true;

  filteredMessagesEncryptedChat.forEach(parsedMessage => {
    const decryptedMessage = parsedMessage.decryptedMessage;
    const payer = parsedMessage.payer || 'Unknown';

    const payerImage = profilePictures[payer]?.url || 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
    const validPayerImage = isValidUrl(payerImage) ? payerImage : 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';

    const timestamp = new Date(parsedMessage.created).toLocaleString('en-US', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const payerInfo = parsedMessage.payer ? parsedMessage.payer : 'Anonymous';
    const username = parsedMessage.payer && usernames[parsedMessage.payer]?.username
      ? ` ${usernames[parsedMessage.payer].username}` : '';
    const click2link = parsedMessage.payer && click2url[parsedMessage.payer]?.click2url
      ? ` ${click2url[parsedMessage.payer].click2url}` : '';

    // New payer → start new group
    if (payer !== previousPayer) {
      // Add <br> before new group (except first)
      if (!isFirstGroup) {
        const br = document.createElement('br');
        fragment.appendChild(br);
      }
      isFirstGroup = false;

      currentGroupDiv = document.createElement('div');
      currentGroupDiv.className = 'toolbar-group-messages';
      currentGroupDiv.style.cssText = `
        position: relative;
        padding-left: 2.5em;
        min-height: 2.5em;
        border-color: ${innerContainerTopicChatColor};
      `;

      // Profile image
      const img = document.createElement('img');
      img.src = validPayerImage;
      img.alt = 'Profile photo';
      img.dataset.payer = payer;
      img.style.cssText = `
        position: absolute;
        left: 0.25em;
        top: 0.5em;
        width: 2em;
        height: 2em;
        border-radius: 1em;
        cursor: pointer;
      `;
      img.addEventListener('click', () => loadBio4PIC(payer));
      watchFollowPrefetch(img, payer);
      currentGroupDiv.appendChild(img);

      // Content wrapper
      const contentWrapper = document.createElement('div');
      contentWrapper.style.cssText = 'display: flex; flex-direction: column;';

      // Header container
      const headerContainer = document.createElement('div');
      headerContainer.style.cssText = 'display: flex; align-items: center;';

      // Header row
      const headerDiv = document.createElement('div');
      headerDiv.className = 'toolbar-group-messages-header';
      headerDiv.style.cssText = `
        display: flex;
        align-items: center;
        border-color: ${topicChatHeaderColor};
        font-size: ${headerFontSizeTopicChat}vh;
      `;

      const accLink = document.createElement('a');
      accLink.href = `https://explore.hashpack.app/${encodeURIComponent(payerInfo)}`;
      accLink.target = '_blank';
      accLink.rel = 'noopener noreferrer';
      accLink.style.cssText = `
        color: ${accidTopicChatColor};
        text-decoration: none;
        font-size: ${headerFontSizeTopicChat}vh;
      `;
      accLink.textContent = payerInfo;
      headerDiv.appendChild(accLink);

      // Add space
      headerDiv.appendChild(document.createTextNode('\u00A0'));

      const trimmedUsername = username.trim();
      if (trimmedUsername) {
        headerDiv.appendChild(payerUsernameNode(trimmedUsername, click2link, {
          cssText: `color: ${usernameTopicChatColor}; font-size: ${headerFontSizeTopicChat}vh;`
        }));
      }

      headerContainer.appendChild(headerDiv);
      contentWrapper.appendChild(headerContainer);

      // Messages group div
      currentMessagesGroupDiv = document.createElement('div');
      contentWrapper.appendChild(currentMessagesGroupDiv);

      currentGroupDiv.appendChild(contentWrapper);
      fragment.appendChild(currentGroupDiv);
    }

    // Message content
    const msgWrapper = document.createElement('div');
    msgWrapper.style.cssText = `
      display: flex;
      flex-direction: column;
      justify-content: center;
      margin-top: 0.2em;
    `;

    // An edit names this row by created and carries the latest text; the
    // media stays the original's.
    const editHit = e2eeEditFor(payer, parsedMessage.created);

    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = `color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;`;
    contentDiv.className = 'chat-msg-text';
    fillChatMessage(contentDiv, editHit ? editHit.text : decryptedMessage, editHit ? editHit.image : parsedMessage.image);

    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = `font-size: ${timestampFontSizeTopicChat}vh; color: gray;`;
    timeSpan.className = 'chat-msg-time';
    timeSpan.textContent = message.pending ? `⏳ ${timestamp}` : timestamp;
    if (editHit) addE2eeEditedMark(timeSpan);
    if (message.pending) msgWrapper.dataset.sig = messageSig(message);

    msgWrapper.appendChild(contentDiv);
    msgWrapper.appendChild(timeSpan);
    annotateE2eeBubble(msgWrapper, payer, e2eeCreatedIso(parsedMessage.created), false);
    currentMessagesGroupDiv.appendChild(msgWrapper);

    previousPayer = payer;
  });

  messagesContainer.appendChild(fragment);

  if (messagesContainer.children.length === 0) {
    createEmptyStateMessage(messagesContainer, 'No messages found');
  } else {
    adjustTextareaHeight(messagesContainer);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  applyEncryptedChatMsgFilterSort();
}
  
async function handleFilterMessagesEncryptedChat() {
  console.log("handleFilterMessagesEncryptedChat");
  // Get values from all input fields
  const fromDateValue = document.getElementById("from-mmddyyyy-encrypted-chat").value;
  const toDateValue = document.getElementById("to-mmddyyyy-encrypted-chat").value;
  const fromTimeValue = document.getElementById("from-hhmmss-encrypted-chat").value;
  const toTimeValue = document.getElementById("to-hhmmss-encrypted-chat").value;
  const topicChatFromUsers = document.getElementById("load-msgs-from-ids-encrypted-chat").value;
  const topicChatBlockUsers = document.getElementById("load-blocks-from-ids-encrypted-chat")?.value || '';

  // Process loadUsersArray
  let loadUsersArrayEncryptedChat = [];
  if (topicChatFromUsers) {
    loadUsersArrayEncryptedChat = topicChatFromUsers.split(',').map(user => user.trim()).filter(user => user !== '');
  }

  // Process blockUsersArray
  let blockUsersArrayEncryptedChat = [];
  if (topicChatBlockUsers) {
    blockUsersArrayEncryptedChat = topicChatBlockUsers.split(',').map(user => user.trim()).filter(user => user !== '');
  }

  await filterEncryptedChatMessages(
    fromDateValue || undefined,
    toDateValue || undefined,
    fromTimeValue || undefined,
    toTimeValue || undefined,
    loadUsersArrayEncryptedChat.length > 0 ? loadUsersArrayEncryptedChat : undefined,
    blockUsersArrayEncryptedChat.length > 0 ? blockUsersArrayEncryptedChat : undefined
  );
}

document.getElementById("topic-msgs-filter-encrypted-chat").addEventListener("click", handleFilterMessagesEncryptedChat);
document.getElementById("load-msgs-from-ids-button-encrypted-chat").addEventListener("click", handleFilterMessagesEncryptedChat);
document.getElementById("load-block-from-users-button-encrypted-chat").addEventListener("click", handleFilterMessagesEncryptedChat);

document.getElementById("save-time-from-encrypted-chat").addEventListener("click", async () => {
  try {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    const resolved = await resolveE2eeTopic(document.getElementById("encrypted-chat-topic-id").value);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    const topicId = resolved.topicId;
    const fromMmddyyyy = document.getElementById("from-mmddyyyy-encrypted-chat").value;
    const toMmddyyyy = document.getElementById("to-mmddyyyy-encrypted-chat").value;
    const fromHhmmss = document.getElementById("from-hhmmss-encrypted-chat").value;
    const toHhmmss = document.getElementById("to-hhmmss-encrypted-chat").value;

    const meesageobject = {
      saveTimeFromEncryptedChat: {
        fromMmddyyyy: fromMmddyyyy,
        toMmddyyyy: toMmddyyyy,
        fromHhmmss: fromHhmmss,
        toHhmmss: toHhmmss
      }
    };
    const meesage = JSON.stringify(meesageobject);
    toast.info("Confirm in wallet 👛");
    sendMessage(topicId, meesage);
  } catch (error) {
    console.error("Error saving time from encrypted chat:", error);
  }
});

document.getElementById("load-time-from-encrypted-chat").addEventListener("click", async () => {
  try {
    const messages = allLoadedMessagesEncryptedChat[0];
    const userMessages = messages.messages.filter(message => message.payer === connectedAccount);
    let lastValidMessage = null;
    for (let i = userMessages.length - 1; i >= 0; i--) {
      if (userMessages[i] && userMessages[i].saveTimeFromEncryptedChat) {
        lastValidMessage = userMessages[i];
        break;
      }
    }
    if (lastValidMessage) {
      document.getElementById("from-mmddyyyy-encrypted-chat").value = lastValidMessage.saveTimeFromEncryptedChat.fromMmddyyyy || '';
      document.getElementById("to-mmddyyyy-encrypted-chat").value = lastValidMessage.saveTimeFromEncryptedChat.toMmddyyyy || '';
      document.getElementById("from-hhmmss-encrypted-chat").value = lastValidMessage.saveTimeFromEncryptedChat.fromHhmmss || '000000';
      document.getElementById("to-hhmmss-encrypted-chat").value = lastValidMessage.saveTimeFromEncryptedChat.toHhmmss || '000000';
      refreshFilterTimeButtons();
    } else {
      console.log("No valid user message found with saveTimeFromEncryptedChat");
    }
  } catch (error) {
    console.error("Error loading time from encrypted chat:", error);
  }
});

document.getElementById("load-save-filters-from-users-encrypted-chat").addEventListener("click", async () => {
  try {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    const resolved = await resolveE2eeTopic(document.getElementById("encrypted-chat-topic-id").value);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    const topicId = resolved.topicId;
    const encryptedChatFromUsers = document.getElementById("load-msgs-from-ids-encrypted-chat").value;
    if (!encryptedChatFromUsers) {
      toast.error("Please enter the account IDs to load.");
      return;
    }
    console.log("encryptedChatFromUsers", encryptedChatFromUsers);
    const meesageobject = {
      encryptedChatFromUsers: encryptedChatFromUsers
    };
    const meesage = JSON.stringify(meesageobject);
    toast.info("Confirm in wallet 👛");
    sendMessage(topicId, meesage);
  } catch (error) {
    console.error("Error loading filters from users:", error);
  }
});

document.getElementById("load-load-filters-from-users-encrypted-chat").addEventListener("click", async () => {
  try {
    const messages = allLoadedMessagesEncryptedChat[0];
    const userMessages = messages.messages.filter(message => message.payer === connectedAccount);
    let lastValidMessage = null;
    for (let i = userMessages.length - 1; i >= 0; i--) {
      if (userMessages[i] && userMessages[i].encryptedChatFromUsers) {
        lastValidMessage = userMessages[i];
        break;
      }
    }
    if (lastValidMessage) {
      document.getElementById("load-msgs-from-ids-encrypted-chat").value = lastValidMessage.encryptedChatFromUsers;
    } else {
      console.log("No valid user message found with encryptedChatFromUsers");
    }
    console.log("messagesObject", messages);
  } catch (error) {
    console.error("Error loading filters from users:", error);
  }
});

document.getElementById("load-save-blocks-from-users-encrypted-chat").addEventListener("click", async () => {
  try {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    const resolved = await resolveE2eeTopic(document.getElementById("encrypted-chat-topic-id").value);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    const topicId = resolved.topicId;
    const encryptedChatBlocks = document.getElementById("load-blocks-from-ids-encrypted-chat").value;
    if (!encryptedChatBlocks) {
      toast.error("Please enter the account IDs to block.");
      return;
    }
    console.log("encryptedChatBlocks", encryptedChatBlocks);
    const meesageobject = {
      encryptedChatBlocks: encryptedChatBlocks
    };
    const meesage = JSON.stringify(meesageobject);
    toast.info("Confirm in wallet 👛");
    sendMessage(topicId, meesage);
  } catch (error) {
    console.error("Error loading filters from users:", error);
  }
});

document.getElementById("load-load-blocks-from-users-encrypted-chat").addEventListener("click", async () => {
  try {
    const messages = allLoadedMessagesEncryptedChat[0];
    const userMessages = messages.messages.filter(message => message.payer === connectedAccount);
    let lastValidMessage = null;
    for (let i = userMessages.length - 1; i >= 0; i--) {
      if (userMessages[i] && userMessages[i].encryptedChatBlocks) {
        lastValidMessage = userMessages[i];
        break;
      }
    }
    if (lastValidMessage) {
      document.getElementById("load-blocks-from-ids-encrypted-chat").value = lastValidMessage.encryptedChatBlocks;
    } else {
      console.log("No valid user message found with encryptedChatBlocks");
    }
    console.log("messagesObject", messages);
  } catch (error) {
    console.error("Error loading filters from users:", error);
  }
});

document.getElementById("stack-encrypted-chat-set-password-button").addEventListener("click", async () => {
  try {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    const userInput = document.getElementById("encrypted-chat-topic-id").value;

    const privateKey = document.getElementById("encrypted-chat-change-password-key").value;
    const newPassword = document.getElementById("encrypted-chat-new-password-key").value;

    if (!privateKey) throw new Error("Private key is required");
    if (!newPassword) throw new Error("Password is required");

    const resolved = await resolveE2eeTopic(userInput);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    const topicId = resolved.topicId;

    const result = await encryptWithPassword(privateKey, newPassword);

    const messageobject = {
      type: "set_encrypted_key",
      encryptedPrivateKey: result.encrypted,
      nonce: result.nonce,
      salt: result.salt
    };

    const message = JSON.stringify(messageobject);
    console.log("message", message);

    toast.info("Confirm in wallet 👛");
    await sendMessage(topicId, message);

    console.log("✅ Encrypted private key sent successfully!");

    // Clear fields for security
    document.getElementById("encrypted-chat-change-password-key").value = "";
    document.getElementById("encrypted-chat-new-password-key").value = "";

  } catch (error) {
    console.error("Error:", error.message);
    toast.error("Failed to encrypt: " + error.message);
  }
});



document.getElementById("stack-encrypted-chat-change-password-button").addEventListener("click", async () => {
  try {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    const userInput = document.getElementById("encrypted-chat-topic-id").value;

    const oldPass = document.getElementById("encrypted-chat-change-password-key").value;
    const newPassword = document.getElementById("encrypted-chat-new-password-key").value;

    let encryptedPrivateKey;
    let decryptedPrivateKey;

    if (!oldPass) throw new Error("oldPass key is required");
    if (!newPassword) throw new Error("Password is required");

    const resolved = await resolveE2eeTopic(userInput);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    const topicId = resolved.topicId;

    const messagesContainer = document.getElementById("messages-from-encrypted-chat");

    const topicAdmin = [];
    try {
      const topicInfo = await getTopicInfo(topicId);
      const memo = topicInfo.memo || "";
      const parts = memo.split(',');
      parts.forEach(part => {
        if (part.trim().startsWith("0.0.")) {
          topicAdmin.push(part.trim());
        }
      });
    } catch (error) {
      createEmptyStateMessage(messagesContainer, 'Invalid Topic ID');
      adjustTextareaHeight(messagesContainer);
      console.error("Error getting topic info:", error);
      return;
    }

    // Admin flow scans the saved history plus any messages after it.
    const allmesages = await getTopicData(topicId);
    allLoadedMessagesEncryptedChat = [allmesages];
    
    const messages = allmesages.messages;

    try {
      for (let index = messages.length - 1; index >= 0; index--) {

        const message = messages[index];
        let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
        if (parsedMessage.encryptedPrivateKey && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {

          encryptedPrivateKey = parsedMessage.encryptedPrivateKey;

          const nonce = parsedMessage.nonce;
          const salt = parsedMessage.salt;
          const password = oldPass;

          decryptedPrivateKey = await decryptWithPassword(encryptedPrivateKey, nonce, salt, password);

          break;

        }
  
     }
    } catch (error) {
      createEmptyStateMessage(messagesContainer, 'wrong password');
      adjustTextareaHeight(messagesContainer);
      console.error("Error getting public key:", error);
      return;
    }

    if (!decryptedPrivateKey) {
      toast.error("No saved private key found for this topic, or the password is wrong.");
      return;
    }

    const result = await encryptWithPassword(decryptedPrivateKey, newPassword);

    const messageobject = {
      type: "set_encrypted_key",
      encryptedPrivateKey: result.encrypted,
      nonce: result.nonce,
      salt: result.salt
    };

    const message = JSON.stringify(messageobject);
    console.log("message", message);

    toast.info("Confirm in wallet 👛");
    await sendMessage(topicId, message);

    console.log("✅ Encrypted private key sent successfully!");

    // Clear fields for security
    document.getElementById("encrypted-chat-change-password-key").value = "";
    document.getElementById("encrypted-chat-new-password-key").value = "";

  } catch (error) {
    console.error("Error:", error.message);
    toast.error("Failed to encrypt: " + error.message);
  }
});