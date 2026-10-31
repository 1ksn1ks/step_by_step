import {adjustTextareaHeight} from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { getAccountNFTs, getTopicInfo, subscribeToTopic } from './hedera';
import { sendMessage, messageSig, streamOnTopic, streamOnReconnect } from './msgbackend';
import { getTopicData } from './topicdata';
import { toast } from "./toast";
import { profilePictures, usernames, click2url } from './loadalladata';
import { 
  topicChatHeaderColor,
  headerFontSizeTopicChat,
  accidTopicChatColor,
  innerContainerTopicChatColor,
  usernameTopicChatColor,
  textFontSizeTopicChat,
  textTopicChatColor,
  timestampFontSizeTopicChat
 } from './letall';

 import { connectedAccount, signer } from './web3';
import { expandTopicChat, scheduleTopicChatLayout } from './cssLogic.js';
import { fitChatComposer } from './chatcomposer.js';
import { payerUsernameNode } from './payerlink.js';
import { refreshFilterTimeButtons } from './drawdate.js';
import { fillChatMessage } from './chatimage.js';
import { watchFollowPrefetch } from './followtopic.js';
import { formatHcsUsage, utf8ByteLength, HCS_MESSAGE_MAX_BYTES, HCS_TOO_LONG, normalizeMessageNewlines } from './hcschunks.js';


export let allLoadedMessagesTopicChat = [];
export let storedMessages = [];

// ── Chat message edits ──────────────────────────────────────────────
// HCS messages are immutable, so an edit is a new message that points at
// the original bubble (editUserMessage.created) and carries the new text
// plus the original image. Only the original payer's own edits count; the
// latest edit wins. The same ISO created the bubble renders from names it,
// so a fresh reload that replays history shows the edited text too.
const chatEditsByCreated = new Map(); // `${payer}|${createdIso}` → { userMessage, image, at }

function chatCreatedIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function chatEditFor(payer, created) {
  const iso = chatCreatedIso(created);
  return payer && iso ? chatEditsByCreated.get(`${payer}|${iso}`) || null : null;
}

// Returns the stored edit when this one is the latest seen, else null.
// `data` is the editUserMessage body; `envelope` is the edit's own created
// (consensus timestamp of the new message, or now() when applied locally).
export function rememberChatEdit(payer, data, envelope) {
  if (!payer || !data || !data.created) return null;
  const created = chatCreatedIso(data.created);
  if (!created) return null;
  let userMessage = data.userMessage;
  if (Array.isArray(userMessage)) userMessage = userMessage[0];
  userMessage = typeof userMessage === 'string' ? userMessage : userMessage == null ? '' : String(userMessage);
  const image = data.image ? String(data.image) : '';
  if (!userMessage && !image) return null;
  const at = chatCreatedIso(envelope) || '';
  // An edit that names a bubble from its own future is malformed noise.
  if (created && at && at <= created) return null;
  const key = `${payer}|${created}`;
  const prev = chatEditsByCreated.get(key);
  // A pending edit (no consensus time yet) never replaces a known one.
  if (!at && prev) return null;
  // Latest wins: an older edit arriving late never replaces a newer one.
  if (prev && prev.at && at && at < prev.at) return null;
  const entry = { userMessage, image, at };
  chatEditsByCreated.set(key, entry);
  applyChatEditToDom(payer, created, entry);
  return entry;
}

// A live edit rewrites the text and image of the on-screen bubble and adds
// the small "edited" mark next to its timestamp.
function applyChatEditToDom(payer, created, entry) {
  const iso = chatCreatedIso(created);
  if (!iso) return;
  const containers = document.querySelectorAll(
    `#messages-from-topic-chat [data-chat-payer="${payer}"][data-chat-created="${iso}"]`
  );
  for (const container of containers) {
    const text = container.querySelector('.chat-msg-text');
    if (text) fillChatMessage(text, entry.userMessage, entry.image);
    addChatEditedMark(container.querySelector('.chat-msg-time'));
  }
}

function addChatEditedMark(timeEl) {
  if (!timeEl || timeEl.querySelector('.chat-edited-mark')) return;
  const mark = document.createElement('span');
  mark.className = 'chat-edited-mark';
  mark.textContent = 'edited';
  timeEl.appendChild(mark);
}

// Tag a rendered bubble so a later live edit can find it, and give own
// confirmed bubbles the discreet edit control.
function annotateBubble(wrapper, payer, createdIso, isPending) {
  if (!wrapper) return;
  if (createdIso) {
    wrapper.dataset.chatPayer = payer;
    wrapper.dataset.chatCreated = createdIso;
  }
  if (createdIso && !isPending && payer && payer === connectedAccount) {
    addChatEditButton(wrapper, payer, createdIso);
  }
}

function addChatEditButton(wrapper, payer, createdIso) {
  if (wrapper.querySelector('.chat-edit-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-edit-btn';
  btn.textContent = 'edit';
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    openTopicChatEdit(payer, createdIso);
  });
  wrapper.appendChild(btn);
}

// ── Edit composer ───────────────────────────────────────────────────
// Edit mode reuses the normal composer. The in-progress draft is stashed
// and restored on cancel or save. Confirm in the wallet, then apply locally.
let topicChatEditTarget = null; // { payer, created, topicId, image, original }
let topicChatEditBusy = false;
let topicChatComposeDraft = '';

function resolveTopicChatId() {
  const userInput = document.getElementById('topic-chat-topic-id').value.toLowerCase();
  const domainEntry = loadedDomains.find(entry => entry.domain === userInput);
  if (domainEntry && domainEntry.lastMessage) return domainEntry.lastMessage.topic;
  return userInput;
}

// An edit never changes the media: it carries the original image so the
// edited state is self-contained.
function topicChatEditPayload(newText) {
  const target = topicChatEditTarget;
  const data = { created: target.created };
  data.userMessage = normalizeMessageNewlines(newText || '');
  if (target.image) data.image = target.image;
  return { editUserMessage: data };
}

function topicChatCompose() {
  return document.getElementById('user-write-message')?.closest('.chat-compose') || null;
}

function fitTopicComposer(field) {
  fitChatComposer(field);
}

function clearTopicChatEditMark() {
  document.querySelectorAll('#messages-from-topic-chat .chat-msg-editing').forEach((el) => {
    el.classList.remove('chat-msg-editing');
  });
}

function topicEditQuote(text, image) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (line) return line;
  return image ? 'Photo' : '';
}

function paintTopicChatEditBytes() {
  const counter = document.getElementById('char-counter');
  const save = document.getElementById('post-msg');
  const text = document.getElementById('user-write-message');
  if (!counter || !text || !topicChatEditTarget) return;
  const usage = formatHcsUsage(utf8ByteLength(JSON.stringify(topicChatEditPayload(text.value))));
  counter.hidden = false;
  counter.textContent = usage.text;
  counter.classList.toggle('hcs-warn', usage.warn);
  counter.classList.toggle('hcs-over', usage.over);
  if (!save) return;
  // Over the limit stays clickable so the existing toast can fire.
  // Unchanged or empty is a dead control.
  save.classList.toggle('hcs-send-blocked', usage.over);
  const unchanged = text.value === topicChatEditTarget.original;
  save.disabled = unchanged || text.value.trim() === '';
}

function setTopicChatEditing(on) {
  const compose = topicChatCompose();
  const bar = document.getElementById('topic-chat-editbar');
  const quote = document.getElementById('topic-chat-edit-quote');
  const send = document.getElementById('post-msg');
  if (compose) compose.classList.toggle('is-editing', on);
  if (bar) bar.hidden = !on;
  if (!on) {
    clearTopicChatEditMark();
    if (send) {
      send.disabled = false;
      send.setAttribute('aria-label', 'Send');
    }
    if (quote) quote.textContent = '';
    return;
  }
  if (send) send.setAttribute('aria-label', 'Save edit');
  // Android back pops this entry and cancels the edit. The chat stays.
  if (window.layerOpened && (!window.layerIsOpen || !window.layerIsOpen('topicchatedit'))) {
    window.layerOpened('topicchatedit');
  }
}

function openTopicChatEdit(payer, created) {
  const createdIso = chatCreatedIso(created);
  if (!createdIso || payer !== connectedAccount) return;
  const topicId = resolveTopicChatId();
  if (!topicId) {
    toast.error('Please enter a Topic ID or domain.');
    return;
  }
  const container = document.querySelector(
    `#messages-from-topic-chat [data-chat-payer="${CSS.escape(payer)}"][data-chat-created="${CSS.escape(createdIso)}"]`
  );
  const currentText = container
    ? (container.querySelector('.chat-msg-body')?.textContent || '')
    : '';
  const imgEl = container && container.querySelector('.chat-msg-image');
  const field = document.getElementById('user-write-message');
  // A second edit replaces the first and keeps the stashed draft.
  if (!topicChatEditTarget && field) topicChatComposeDraft = field.value;
  topicChatEditTarget = {
    payer,
    created: createdIso,
    topicId,
    // data-full-src is the original image URL. The bubble shows that same URL.
    image: imgEl ? (imgEl.dataset.fullSrc || imgEl.getAttribute('src') || '') : '',
    original: currentText,
  };
  const quote = document.getElementById('topic-chat-edit-quote');
  if (quote) quote.textContent = topicEditQuote(currentText, topicChatEditTarget.image);
  clearTopicChatEditMark();
  if (container) {
    container.classList.add('chat-msg-editing');
    requestAnimationFrame(() => {
      container.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  }
  setTopicChatEditing(true);
  if (!field) {
    paintTopicChatEditBytes();
    return;
  }
  field.value = currentText;
  fitTopicComposer(field);
  const end = field.value.length;
  field.focus();
  try { field.setSelectionRange(end, end); } catch (_) { /* older browsers */ }
  field.scrollTop = field.scrollHeight;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function closeTopicChatEdit() {
  const field = document.getElementById('user-write-message');
  const was = !!topicChatEditTarget;
  const layerUp = !!(window.layerIsOpen && window.layerIsOpen('topicchatedit'));
  if (!was && !layerUp) return;
  const draft = topicChatComposeDraft;
  topicChatEditTarget = null;
  topicChatComposeDraft = '';
  setTopicChatEditing(false);
  // Popstate already dropped the entry before it calls close. A cancel,
  // Escape, or a panel close still has to consume it.
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('topicchatedit')) {
    window.layerClosedByUI('topicchatedit');
  }
  if (!was || !field) return;
  field.value = draft;
  fitTopicComposer(field);
  // is-editing is already off, so the normal byte painter runs again.
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

async function saveTopicChatEdit() {
  if (topicChatEditBusy || !topicChatEditTarget) return;
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return;
  }
  const save = document.getElementById('post-msg');
  if (save && save.classList.contains('hcs-send-blocked')) {
    toast.error(HCS_TOO_LONG);
    return;
  }
  const text = document.getElementById('user-write-message');
  const raw = text ? text.value : '';
  if (!raw.trim() || raw === topicChatEditTarget.original) return;
  const target = topicChatEditTarget;
  const payload = topicChatEditPayload(raw);
  const outgoing = JSON.stringify(payload);
  if (utf8ByteLength(outgoing) > HCS_MESSAGE_MAX_BYTES) {
    toast.error(HCS_TOO_LONG);
    return;
  }
  topicChatEditBusy = true;
  try {
    toast.info('Confirm in wallet 👛');
    await sendMessage(target.topicId, outgoing);
    // Apply locally right away; the topic stream confirms the same edit.
    rememberChatEdit(target.payer, payload.editUserMessage, new Date().toISOString());
    closeTopicChatEdit();
    toast.success('Saved');
  } catch (error) {
    console.error('topic chat edit failed', error);
    toast.error('Edit was not saved');
  } finally {
    topicChatEditBusy = false;
  }
}

const topicChatEditCancel = document.getElementById('topic-chat-edit-cancel');
if (topicChatEditCancel) {
  topicChatEditCancel.addEventListener('click', (event) => {
    event.stopPropagation();
    closeTopicChatEdit();
  });
}
const topicChatField = document.getElementById('user-write-message');
if (topicChatField) {
  topicChatField.addEventListener('input', () => {
    if (!topicChatEditTarget) return;
    fitTopicComposer(topicChatField);
    paintTopicChatEditBytes();
  });
}
const topicChatSend = document.getElementById('post-msg');
if (topicChatSend) {
  // Capture runs after the byte-limit watcher and before a new send.
  topicChatSend.addEventListener('click', (event) => {
    if (!topicChatEditTarget) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    saveTopicChatEdit();
  }, true);
}
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !topicChatEditTarget) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  closeTopicChatEdit();
}, true);

if (window.defineLayer) {
  window.defineLayer('topicchatedit', {
    open() {},
    close() { closeTopicChatEdit(); },
  });
}
window.closeTopicChatEdit = closeTopicChatEdit;

document.getElementById('go-to-top-msgs').addEventListener('click', function() {
    const container = document.getElementById('messages-from-topic-chat');
    container.stopSmoothScroll?.();
    container.scrollTop = 0;
  });

  // Show the arrows while scrolling (⬆ when not at the very top, ⬇ when not
  // at the very bottom); fade out 2s after scrolling stops
  const topicChatMessages = document.getElementById('messages-from-topic-chat');
  const topicChatGoToTop = document.getElementById('go-to-top-msgs');
  const topicChatGoToBottom = document.getElementById('go-to-bottom-msgs');
  let topicChatArrowsTimer = null;
  function updateTopicChatArrows() {
    const atTop = topicChatMessages.scrollTop <= 0;
    const atBottom = topicChatMessages.scrollHeight - topicChatMessages.scrollTop - topicChatMessages.clientHeight <= 0;
    topicChatGoToTop.classList.toggle('go-to-top-visible', !atTop);
    topicChatGoToBottom.classList.toggle('go-to-bottom-visible', !atBottom);
    clearTimeout(topicChatArrowsTimer);
    topicChatArrowsTimer = setTimeout(() => {
      topicChatGoToTop.classList.remove('go-to-top-visible');
      topicChatGoToBottom.classList.remove('go-to-bottom-visible');
    }, 2000);
  }
  topicChatMessages.addEventListener('scroll', updateTopicChatArrows, { passive: true });

document.getElementById('go-to-bottom-msgs').addEventListener('click', function() {
    const container = document.getElementById('messages-from-topic-chat');
    container.stopSmoothScroll?.();
    container.scrollTop = container.scrollHeight;
  });

  function isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

const purifyConfig = {
  ALLOWED_URI_REGEXP: /^https:\/\/explore\.hashpack\.app\//i
};

// Keep these outside so they persist between calls
let previousPayerTopicChat = null;
let currentGroupContainer = null;
let currentMessagesGroupDiv = null;

async function appendTopicChatMessage(message, messagesContainer, topicAdmin, loadedNFTsForTopicChat) {
  try {
    let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
    const payer = parsedMessage.payer || 'Unknown';

    // An edit is a directive, not a bubble: remember it (and rewrite the
    // open bubble) but never render a second bubble for it.
    if (parsedMessage.editUserMessage) {
      rememberChatEdit(payer, parsedMessage.editUserMessage, (message && message.created) || parsedMessage.created);
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

    if (!payerHasNFT) return;

    const userMessage = parsedMessage.userMessage;
    const hasText = userMessage != null && String(userMessage) !== '';
    if (!hasText && !parsedMessage.image) return;
    storedMessages.push(parsedMessage);

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

    // ========== GROUPING LOGIC (same as original) ==========
    if (payer !== previousPayerTopicChat) {
      // Create new group
      currentGroupContainer = document.createElement('div');
      currentGroupContainer.className = 'toolbar-group-messages';
      if (payer && payer === connectedAccount) currentGroupContainer.classList.add('chat-group-own');
      currentGroupContainer.style.cssText = `position: relative; padding-left: 2.5em; min-height: 2.5em; border-color: ${innerContainerTopicChatColor};`;

      // Profile image
      const img = document.createElement('img');
      img.src = validPayerImage;
      img.alt = 'Profile photo';
      img.style.cssText = 'position: absolute; left: 0.25em; top: 0.5em; width: 2em; height: 2em; border-radius: 1em; cursor: pointer;';
      img.dataset.payer = payer;
      img.className = 'profile-img-click';
      img.addEventListener('click', () => loadBio4PIC(payer));
      watchFollowPrefetch(img, payer);
      currentGroupContainer.appendChild(img);

      // Content wrapper
      const contentWrapper = document.createElement('div');
      contentWrapper.style.cssText = 'display: flex; flex-direction: column;';

      // Header
      const headerContainer = document.createElement('div');
      headerContainer.style.cssText = 'display: flex; align-items: center;';

      const header = document.createElement('div');
      header.className = 'toolbar-group-messages-header';
      header.style.cssText = `display: flex; align-items: center; border-color: ${topicChatHeaderColor}; font-size: ${headerFontSizeTopicChat}vh;`;

      const payerLink = document.createElement('a');
      payerLink.href = `https://explore.hashpack.app/${payerInfo}`;
      payerLink.target = '_blank';
      payerLink.style.cssText = `color: ${accidTopicChatColor}; text-decoration: none; font-size: ${headerFontSizeTopicChat}vh;`;
      payerLink.textContent = payerInfo;
      header.appendChild(payerLink);

      header.appendChild(document.createTextNode('\u00A0'));

      if (username.trim()) {
        header.appendChild(payerUsernameNode(username.trim(), click2link, {
          cssText: `color: ${usernameTopicChatColor}; font-size: ${headerFontSizeTopicChat}vh;`
        }));
      }

      headerContainer.appendChild(header);
      contentWrapper.appendChild(headerContainer);
      currentGroupContainer.appendChild(contentWrapper);

      // Messages container inside group
      currentMessagesGroupDiv = document.createElement('div');
      contentWrapper.appendChild(currentMessagesGroupDiv);

      messagesContainer.appendChild(currentGroupContainer);
      messagesContainer.appendChild(document.createElement('br'));

      previousPayerTopicChat = payer;
    }

    // ========== ADD MESSAGE TO CURRENT GROUP ==========
    const messageWrapper = document.createElement('div');
    messageWrapper.style.cssText = `display: flex; flex-direction: column; justify-content: center; margin-top: 0.2em;`;

    // An edit names this bubble by created and carries the latest text; it
    // never changes the media, so the image stays the original's.
    const editHit = chatEditFor(payer, parsedMessage.created);
    const displayText = editHit ? editHit.userMessage : (hasText ? String(userMessage) : '');
    const displayImage = editHit ? editHit.image : parsedMessage.image;

    const messageText = document.createElement('div');
    messageText.style.cssText = `color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;`;
    messageText.className = 'chat-msg-text';
    fillChatMessage(messageText, displayText, displayImage);
    messageWrapper.appendChild(messageText);

    const timestampSpan = document.createElement('span');
    timestampSpan.style.cssText = `font-size: ${timestampFontSizeTopicChat}vh; color: gray;`;
    timestampSpan.className = 'chat-msg-time';
    timestampSpan.textContent = message.pending ? `⏳ ${timestamp}` : timestamp;
    if (editHit) addChatEditedMark(timestampSpan);
    messageWrapper.appendChild(timestampSpan);
    if (message.pending) messageWrapper.dataset.sig = messageSig(message);
    annotateBubble(messageWrapper, payer, chatCreatedIso(parsedMessage.created), !!message.pending);

    currentMessagesGroupDiv.appendChild(messageWrapper);

    // // Auto scroll
    // messagesContainer.scrollTop = messagesContainer.scrollHeight;
    adjustTextareaHeight(messagesContainer);
    applyTopicChatMsgFilterSort();

  } catch (err) {
    console.error("Error rendering message:", err);
  }
}

// Live search + sort for the topic chat message groups
// (payer id = "topic id", username = "topic name")
let topicChatMsgSortDir = null; // null = chronological, 'az'/'za' = by username

function topicChatGroupUsername(group) {
  const payer = group.querySelector('.profile-img-click')?.dataset.payer || '';
  return (usernames[payer]?.username || '').trim() || payer;
}

function applyTopicChatMsgFilterSort() {
  const container = document.getElementById('messages-from-topic-chat');
  if (!container) return;
  const searchEl = document.getElementById('topic-chat-msg-search');
  const query = (searchEl ? searchEl.value : '').trim().toLowerCase();

  const oldEmpty = container.querySelector('.chat-msg-empty');
  if (oldEmpty) oldEmpty.remove();
  const groups = Array.from(container.children).filter(el => el.classList.contains('toolbar-group-messages'));

  let visible = groups;
  if (query) {
    visible = groups.filter(g => {
      const payer = g.querySelector('.profile-img-click')?.dataset.payer || '';
      const username = (usernames[payer]?.username || '').toLowerCase();
      return payer.toLowerCase().includes(query) || username.includes(query);
    });
  }
  groups.forEach(g => g.style.display = 'none');
  visible.forEach(g => g.style.display = '');

  if (topicChatMsgSortDir) {
    visible = [...visible].sort((a, b) =>
      topicChatMsgSortDir === 'az'
        ? topicChatGroupUsername(a).localeCompare(topicChatGroupUsername(b), undefined, { sensitivity: 'base', numeric: true })
        : topicChatGroupUsername(b).localeCompare(topicChatGroupUsername(a), undefined, { sensitivity: 'base', numeric: true }));
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
  scheduleTopicChatLayout();
}

const topicChatMsgSearch = document.getElementById('topic-chat-msg-search');
const topicChatMsgSortAz = document.getElementById('topic-chat-msg-sort-az');
const topicChatMsgSortZa = document.getElementById('topic-chat-msg-sort-za');

function updateTopicChatMsgSortButtons() {
  topicChatMsgSortAz.classList.toggle('active', topicChatMsgSortDir === 'az');
  topicChatMsgSortZa.classList.toggle('active', topicChatMsgSortDir === 'za');
}

if (topicChatMsgSearch) {
  topicChatMsgSearch.addEventListener('input', applyTopicChatMsgFilterSort);
}
if (topicChatMsgSortAz) {
  topicChatMsgSortAz.addEventListener('click', (e) => {
    e.stopPropagation();
    topicChatMsgSortDir = topicChatMsgSortDir === 'az' ? null : 'az';
    updateTopicChatMsgSortButtons();
    applyTopicChatMsgFilterSort();
  });
}
if (topicChatMsgSortZa) {
  topicChatMsgSortZa.addEventListener('click', (e) => {
    e.stopPropagation();
    topicChatMsgSortDir = topicChatMsgSortDir === 'za' ? null : 'za';
    updateTopicChatMsgSortButtons();
    applyTopicChatMsgFilterSort();
  });
}

document.getElementById("load-msgs-from").addEventListener("click", async () => {
  try {
    let userInput = document.getElementById("topic-chat-topic-id").value.toLowerCase();
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId = (domainEntry && domainEntry.lastMessage)
      ? domainEntry.lastMessage.topic
      : userInput;

    const messagesContainer = document.getElementById("messages-from-topic-chat");

    // Show spinner
    messagesContainer.innerHTML = `
      <div class="chat-state" style="display: flex; justify-content: left; align-items: left; height: 100%;">
        <div id="topicspinnerchat"></div>
        <span style="margin-left: 0.45vh;">Loading messages from ${topicId}</span>
      </div>`;
    adjustTextareaHeight(messagesContainer);
    expandTopicChat();

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
      messagesContainer.innerHTML = `
        <div class="chat-state" style="display: flex; justify-content: left; align-items: left; height: 100%;">
          <span style="margin-left: 0.45vh;">Invalid Topic ID</span>
        </div>`;
      adjustTextareaHeight(messagesContainer);
      expandTopicChat();
      return;
    }

    // Load history + start live updates — via the data layer (backend when
    // it already has the topic: instant, phones stay off the mirror;
    // otherwise the original mirror path: subscribeToTopic)
    const onNewMsg = async (newMsg) => {
      // This runs every time a NEW message arrives
      await appendTopicChatMessage(newMsg, messagesContainer, topicAdmin, loadedNFTsForTopicChat);
    };
    let rawResult;
    // A pending bubble became canonical: clear its ⏳ marker, then tag the
    // bubble and give it the edit control (a pending row has no created yet).
    const onConfirm = (m) => {
      const sig = messageSig(m);
      for (const el of messagesContainer.querySelectorAll('[data-sig]')) {
        if (el.dataset.sig !== sig) continue;
        delete el.dataset.sig;
        const t = el.querySelector('.chat-msg-time');
        if (t) t.textContent = t.textContent.replace('⏳ ', '');
        annotateBubble(el, m.payer, chatCreatedIso(m.created), false);
        break;
      }
    };
    // A pending bubble never reached the mirror: drop it
    const onExpire = (m) => {
      const sig = messageSig(m);
      for (const el of messagesContainer.querySelectorAll('[data-sig]')) {
        if (el.dataset.sig === sig) {
          el.remove();
          scheduleTopicChatLayout();
          break;
        }
      }
    };
    const viaData = await getTopicData(topicId);
    if (viaData.viaBackend) {
      // Live via the shared SSE stream (no 3s polling): the server pushes
      // new / pending / confirmed / expired events the moment they happen
      const seen = new Set(viaData.messages.map(messageSig));
      const pendingSigs = new Set(viaData.messages.filter((m) => m.pending).map(messageSig));
      let liveReady = false;
      const handleStream = (evt) => {
        const m = evt.message;
        const sig = messageSig(m);
        if (evt.type === "pending") {
          if (seen.has(sig)) return; // the canonical row already arrived
          seen.add(sig);
          pendingSigs.add(sig);
          onNewMsg(m);
        } else if (evt.type === "message") {
          if (seen.has(sig)) {
            if (pendingSigs.has(sig)) {
              pendingSigs.delete(sig);
              onConfirm(m);
            }
            return;
          }
          seen.add(sig);
          onNewMsg(m);
        } else if (evt.type === "confirmed") {
          if (pendingSigs.has(sig)) {
            pendingSigs.delete(sig);
            onConfirm(m);
          }
        } else if (evt.type === "expired") {
          if (pendingSigs.has(sig)) {
            pendingSigs.delete(sig);
            onExpire(m);
          }
        }
      };
      const offTopic = streamOnTopic(topicId, handleStream);
      const offReconnect = streamOnReconnect(async () => {
        if (!liveReady) {
          liveReady = true; // first open: the history is already fresh
          return;
        }
        // The stream just came back: absorb anything missed while down
        const fresh = await getTopicData(topicId, { force: true });
        for (const m of fresh.messages) {
          const sig = messageSig(m);
          if (seen.has(sig)) continue;
          seen.add(sig);
          if (m.pending) pendingSigs.add(sig);
          await onNewMsg(m);
        }
      });
      // A re-Load of this panel drops the previous live subscription first
      if (messagesContainer.__offLive) messagesContainer.__offLive();
      const offLive = () => {
        offTopic();
        offReconnect();
      };
      messagesContainer.__offLive = offLive;
      rawResult = { messages: viaData.messages, close: offLive };
    } else {
      rawResult = await subscribeToTopic(topicId, onNewMsg);
    }

    // Clear spinner
    while (messagesContainer.firstChild) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }

    // Collect NFTs from history
    const loadedNFTsForTopicChat = [];
    for (const msg of rawResult.messages || []) {
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

    // Render all historical messages
    storedMessages = [];
    for (const message of rawResult.messages || []) {
      await appendTopicChatMessage(message, messagesContainer, topicAdmin, loadedNFTsForTopicChat);
    }

    // No messages case
    if (!messagesContainer.firstChild) {
      const noMessagesDiv = document.createElement('div');
      noMessagesDiv.style.cssText = 'display: flex; justify-content: left; align-items: left; height: 100%;';
      noMessagesDiv.className = 'chat-state';
      const span = document.createElement('span');
      span.style.marginLeft = '0.45vh';
      span.textContent = 'No messages found';
      noMessagesDiv.appendChild(span);
      messagesContainer.appendChild(noMessagesDiv);
    } else {
      adjustTextareaHeight(messagesContainer);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      toast.loaded("Messages loaded");
    }
    expandTopicChat();

  } catch (error) {
    console.error("Error loading messages:", error);
  }
});
  
  async function filterTopicMessages(fromDateValue, toDateValue, fromTimeValue, toTimeValue, loadUsersArray, blockUsersArray) {
    let loadedUsersTopicChat = loadUsersArray || [];
    let blockUsersTopicChat = blockUsersArray || [];
  
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
  
    // Filter messages (unchanged logic)
    const filteredMessages = storedMessages.filter(parsedMessage => {
      const messageDate = new Date(parsedMessage.created);
  
      const conditions = [];
  
      if (fromDate && toDate) {
        conditions.push(messageDate >= fromDate && messageDate <= toDate);
      }
  
      if (loadedUsersTopicChat.length > 0) {
        conditions.push(loadedUsersTopicChat.includes(parsedMessage.payer));
      }
  
      if (blockUsersTopicChat.length > 0) {
        conditions.push(!blockUsersTopicChat.includes(parsedMessage.payer));
      }
  
      if (conditions.length === 0) return true;
  
      return conditions.every(condition => condition);
    });
  
    // ────────────────────────────────────────────────────────────────
    // SAFE RENDERING (Full DOM version matching first function structure)
    // ────────────────────────────────────────────────────────────────
  
    const messagesContainer = document.getElementById('messages-from-topic-chat');
    if (!messagesContainer) return;
  
    // Clear container using DOM
    while (messagesContainer.firstChild) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }
  
    const fragment = document.createDocumentFragment();
  
    let previousPayer = null;
    let currentGroupDiv = null;
    let currentMessagesGroupDiv = null;
    let isFirstGroup = true;
  
    filteredMessages.forEach(parsedMessage => {
      const userMessage = parsedMessage.userMessage;
      const hasText = userMessage != null && String(userMessage) !== '';
      if (!hasText && !parsedMessage.image) return;
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
  
      // New payer → new group
      if (payer !== previousPayer) {
        // Add <br> before new group (except first group)
        if (!isFirstGroup) {
          const br = document.createElement('br');
          fragment.appendChild(br);
        }
        isFirstGroup = false;
  
        currentGroupDiv = document.createElement('div');
        currentGroupDiv.className = 'toolbar-group-messages';
        if (payer && payer === connectedAccount) currentGroupDiv.classList.add('chat-group-own');
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
        img.className = 'profile-img-click';
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
  
        // Content wrapper (matches first function structure)
        const contentWrapper = document.createElement('div');
        contentWrapper.style.cssText = 'display: flex; flex-direction: column;';
  
        // Header container (matches first function structure)
        const headerContainer = document.createElement('div');
        headerContainer.style.cssText = 'display: flex; align-items: center;';
  
        // Header
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
  
        // Username link or span
        const trimmedUsername = username.trim();
        if (trimmedUsername) {
          headerDiv.appendChild(payerUsernameNode(trimmedUsername, click2link, {
            cssText: `color: ${usernameTopicChatColor}; font-size: ${headerFontSizeTopicChat}vh;`
          }));
        }
  
        headerContainer.appendChild(headerDiv);
        contentWrapper.appendChild(headerContainer);
  
        // Messages group div (where messages will be appended)
        currentMessagesGroupDiv = document.createElement('div');
        contentWrapper.appendChild(currentMessagesGroupDiv);
  
        currentGroupDiv.appendChild(contentWrapper);
        fragment.appendChild(currentGroupDiv);
      }
  
      // An edit names this bubble by created; show the latest text and keep
      // the original image.
      const editHit = chatEditFor(payer, parsedMessage.created);
      const displayText = editHit ? editHit.userMessage : (hasText ? String(userMessage) : '');
      const displayImage = editHit ? editHit.image : parsedMessage.image;

      // Message content
      const msgWrapper = document.createElement('div');
      msgWrapper.style.cssText = `
        display: flex;
        flex-direction: column;
        justify-content: center;
        margin-top: 0.2em;
      `;

      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = `color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;`;
      contentDiv.className = 'chat-msg-text';
      fillChatMessage(contentDiv, displayText, displayImage);

      const timeSpan = document.createElement('span');
      timeSpan.style.cssText = `font-size: ${timestampFontSizeTopicChat}vh; color: gray;`;
      timeSpan.className = 'chat-msg-time';
      timeSpan.textContent = timestamp;
      if (editHit) addChatEditedMark(timeSpan);

      msgWrapper.appendChild(contentDiv);
      msgWrapper.appendChild(timeSpan);
      annotateBubble(msgWrapper, payer, chatCreatedIso(parsedMessage.created), false);
      currentMessagesGroupDiv.appendChild(msgWrapper);

      previousPayer = payer;
    });
  
    messagesContainer.appendChild(fragment);
  
    // Handle empty state with DOM
    if (messagesContainer.children.length === 0) {
      const noMessagesDiv = document.createElement('div');
      noMessagesDiv.style.cssText = 'display: flex; justify-content: left; align-items: left; height: 100%;';
      noMessagesDiv.className = 'chat-state';
  
      const noMessagesSpan = document.createElement('span');
      noMessagesSpan.style.marginLeft = '0.45vh';
      noMessagesSpan.textContent = 'No messages found';
  
      noMessagesDiv.appendChild(noMessagesSpan);
      messagesContainer.appendChild(noMessagesDiv);
    } else {
      adjustTextareaHeight(messagesContainer);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    applyTopicChatMsgFilterSort();
  }
  
  async function handleFilterMessages() {
    console.log("handleFilterMessages");
    // Get values from all input fields
    const fromDateValue = document.getElementById("from-mmddyyyy").value;
    const toDateValue = document.getElementById("to-mmddyyyy").value;
    const fromTimeValue = document.getElementById("from-hhmmss").value;
    const toTimeValue = document.getElementById("to-hhmmss").value;
    const topicChatFromUsers = document.getElementById("load-msgs-from-ids-topic-chat").value;
    const topicChatBlockUsers = document.getElementById("load-blocks-from-ids-topic-chat")?.value || ''; // Assuming a block users input field
  
    // Process loadUsersArray
    let loadUsersArrayTopicChat = [];
    if (topicChatFromUsers) {
      loadUsersArrayTopicChat = topicChatFromUsers.split(',').map(user => user.trim()).filter(user => user !== '');
    }
  
    // Process blockUsersArray
    let blockUsersArrayTopicChat = [];
    if (topicChatBlockUsers) {
      blockUsersArrayTopicChat = topicChatBlockUsers.split(',').map(user => user.trim()).filter(user => user !== '');
    }
  
    // Call filterTopicMessages with all parameters, passing undefined for empty fields
    await filterTopicMessages(
      fromDateValue || undefined,
      toDateValue || undefined,
      fromTimeValue || undefined,
      toTimeValue || undefined,
      loadUsersArrayTopicChat.length > 0 ? loadUsersArrayTopicChat : undefined,
      blockUsersArrayTopicChat.length > 0 ? blockUsersArrayTopicChat : undefined
    );
  }
  
  document.getElementById("topic-msgs-filter").addEventListener("click", handleFilterMessages);
  document.getElementById("load-msgs-from-ids-button-topic-chat").addEventListener("click", handleFilterMessages);
  document.getElementById("load-block-from-users-button-topic-chat").addEventListener("click", handleFilterMessages);
  
  document.getElementById("save-time-from-topic-chat").addEventListener("click", async () => {
    try {
      if (!signer) {
        toast.error("Connect wallet first");
        return;
      }
      let userInput = document.getElementById("topic-chat-topic-id").value;
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;

        if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput;
      }
      if (!topicId) {
        toast.error("Please enter a Topic ID or domain.");
        return;
      }
      const fromMmddyyyy = document.getElementById("from-mmddyyyy").value;
      const toMmddyyyy = document.getElementById("to-mmddyyyy").value;
      const fromHhmmss = document.getElementById("from-hhmmss").value;
      const toHhmmss = document.getElementById("to-hhmmss").value;
  
      const meesageobject = {
        saveTimeFromTopicChat: {
        fromMmddyyyy: fromMmddyyyy,
          toMmddyyyy: toMmddyyyy,
          fromHhmmss: fromHhmmss,
          toHhmmss: toHhmmss
        }
      };
      const meesage = JSON.stringify(meesageobject);
      toast.info("Confirm in wallet 👛");
      const reciept = await sendMessage(topicId, meesage);
    } catch (error) {
      console.error("Error saving time from topic chat:", error);
    }
  });
  
  document.getElementById("load-time-from-topic-chat").addEventListener("click", async () => {
    try {
      const messages = allLoadedMessagesTopicChat[0];
      const userMessages = messages.messages.filter(message => message.payer === connectedAccount);
      let lastValidMessage = null;
      for (let i = userMessages.length - 1; i >= 0; i--) {
        if (userMessages[i] && userMessages[i].saveTimeFromTopicChat) {
          lastValidMessage = userMessages[i];
          break;
        }
      }
      if (lastValidMessage) {
        document.getElementById("from-mmddyyyy").value = lastValidMessage.saveTimeFromTopicChat.fromMmddyyyy || '';
        document.getElementById("to-mmddyyyy").value = lastValidMessage.saveTimeFromTopicChat.toMmddyyyy || '';
        document.getElementById("from-hhmmss").value = lastValidMessage.saveTimeFromTopicChat.fromHhmmss || '000000';
        document.getElementById("to-hhmmss").value = lastValidMessage.saveTimeFromTopicChat.toHhmmss || '000000';
        refreshFilterTimeButtons();
      } else {
        console.log("No valid user message found with saveTimeFromTopicChat");
      }
    } catch (error) {
      console.error("Error loading time from users load column:", error);
    }
  });
  
  document.getElementById("save-filters-from-topic-chat").addEventListener("click", async () => {
    try {
      if (!signer) {
        toast.error("Connect wallet first");
        return;
      }
      let userInput = document.getElementById("topic-chat-topic-id").value;
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;

        if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput;
      }
      if (!topicId) {
        toast.error("Please enter a Topic ID or domain.");
        return;
      }
      const topicChatFromUsers = document.getElementById("load-msgs-from-ids-topic-chat").value;
      if (!topicChatFromUsers) {
        toast.error("Please enter the account IDs to load.");
        return;
      }
      console.log("topicChatFromUsers", topicChatFromUsers);
      const meesageobject = {
        topicChatFromUsers: topicChatFromUsers
      };
      const meesage = JSON.stringify(meesageobject);
      toast.info("Confirm in wallet 👛");
      const reciept = await sendMessage(topicId, meesage);
    } catch (error) {
      console.error("Error loading filters from users:", error);
    }
  });
  
  document.getElementById("load-filters-from-topic-chat").addEventListener("click", async () => {
    try {
      const messages = allLoadedMessagesTopicChat[0];
      const userMessages = messages.messages.filter(message => message.payer === connectedAccount);
      let lastValidMessage = null;
      for (let i = userMessages.length - 1; i >= 0; i--) {
        if (userMessages[i] && userMessages[i].topicChatFromUsers) {
          lastValidMessage = userMessages[i];
          break;
        }
      }
      if (lastValidMessage) {
        document.getElementById("load-msgs-from-ids-topic-chat").value = lastValidMessage.topicChatFromUsers;
      } else {
        console.log("No valid user message found with topicChatFromUsers");
      }
    } catch (error) {
      console.error("Error loading filters from users:", error);
    }
  });
  
  document.getElementById("save-blocks-from-topic-chat").addEventListener("click", async () => {
    try {
      if (!signer) {
        toast.error("Connect wallet first");
        return;
      }
      let userInput = document.getElementById("topic-chat-topic-id").value;
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;

        if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput;
      }
      if (!topicId) {
        toast.error("Please enter a Topic ID or domain.");
        return;
      }
      const topicChatBlocks = document.getElementById("load-blocks-from-ids-topic-chat").value;
      if (!topicChatBlocks) {
        toast.error("Please enter the account IDs to block.");
        return;
      }
        console.log("topicChatBlocks", topicChatBlocks);
      const meesageobject = {
        topicChatBlocks: topicChatBlocks
      };
      const meesage = JSON.stringify(meesageobject);
      toast.info("Confirm in wallet 👛");
      const reciept = await sendMessage(topicId, meesage);
    } catch (error) {
      console.error("Error loading filters from users:", error);
    }
  });
  
  document.getElementById("load-blocks-from-topic-chat").addEventListener("click", async () => {
    try {
      const messages = allLoadedMessagesTopicChat[0];
      const userMessages = messages.messages.filter(message => message.payer === connectedAccount);
      let lastValidMessage = null;
      for (let i = userMessages.length - 1; i >= 0; i--) {
        if (userMessages[i] && userMessages[i].topicChatBlocks) {
          lastValidMessage = userMessages[i];
          break;
        }
      }
      if (lastValidMessage) {
        document.getElementById("load-blocks-from-ids-topic-chat").value = lastValidMessage.topicChatBlocks;
      } else {
        console.log("No valid user message found with topicChatBlocks");
      }
      console.log("messagesObject", messages);
    } catch (error) {
      console.error("Error loading filters from users:", error);
    }
  });
  