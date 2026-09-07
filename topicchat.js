import {adjustTextareaHeight} from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { getMessages, getAccountNFTs, sendMessage, getTopicInfo, subscribeToTopic } from './hedera';
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

 import { connectedAccount } from './web3';


export let allLoadedMessagesTopicChat = [];
export let storedMessages = [];

document.getElementById('go-to-top-msgs').addEventListener('click', function() {
    const container = document.getElementById('messages-from-topic-chat');
    container.scrollTop = 0;
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

    if (!payerHasNFT || !parsedMessage.userMessage) return;

    const userMessage = parsedMessage.userMessage;
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
      currentGroupContainer.style.cssText = `position: relative; padding-left: 2.5em; min-height: 2.5em; border-color: ${innerContainerTopicChatColor};`;

      // Profile image
      const img = document.createElement('img');
      img.src = validPayerImage;
      img.alt = 'Profile photo';
      img.style.cssText = 'position: absolute; left: 0.25em; top: 0.5em; width: 2em; height: 2em; border-radius: 1em; cursor: pointer;';
      img.dataset.payer = payer;
      img.className = 'profile-img-click';
      img.addEventListener('click', () => loadTOPIC4PIC(payer));
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

      if (click2link.trim()) {
        const usernameLink = document.createElement('a');
        usernameLink.href = click2link.trim();
        usernameLink.target = '_blank';
        usernameLink.style.cssText = `color: ${usernameTopicChatColor}; text-decoration: none; font-size: ${headerFontSizeTopicChat}vh;`;
        usernameLink.textContent = username.trim();
        header.appendChild(usernameLink);
      } else if (username.trim()) {
        const usernameSpan = document.createElement('span');
        usernameSpan.style.cssText = `color: ${usernameTopicChatColor}; font-size: ${headerFontSizeTopicChat}vh;`;
        usernameSpan.textContent = username.trim();
        header.appendChild(usernameSpan);
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
    messageWrapper.style.cssText = `display: flex; flex-direction: column; justify-content: center; margin-top: 0.5em;`;

    const messageText = document.createElement('div');
    messageText.style.cssText = `color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;`;
    messageText.className = 'chat-msg-text';
    messageText.textContent = userMessage;
    messageWrapper.appendChild(messageText);

    const timestampSpan = document.createElement('span');
    timestampSpan.style.cssText = `font-size: ${timestampFontSizeTopicChat}vh; color: gray;`;
    timestampSpan.className = 'chat-msg-time';
    timestampSpan.textContent = timestamp;
    messageWrapper.appendChild(timestampSpan);

    currentMessagesGroupDiv.appendChild(messageWrapper);

    // // Auto scroll
    // messagesContainer.scrollTop = messagesContainer.scrollHeight;
    adjustTextareaHeight(messagesContainer);

  } catch (err) {
    console.error("Error rendering message:", err);
  }
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
        <span style="margin-left: 1vw;">Loading messages from ${topicId}</span>
      </div>`;
    adjustTextareaHeight(messagesContainer);

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
          <span style="margin-left: 1vw;">Invalid Topic ID</span>
        </div>`;
      adjustTextareaHeight(messagesContainer);
      return;
    }

    // Load history + start live subscription
    const rawResult = await subscribeToTopic(topicId, async (newMsg) => {
      // This runs every time a NEW message arrives
      await appendTopicChatMessage(newMsg, messagesContainer, topicAdmin, loadedNFTsForTopicChat);
    });

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
      span.style.marginLeft = '1vw';
      span.textContent = 'No messages found';
      noMessagesDiv.appendChild(span);
      messagesContainer.appendChild(noMessagesDiv);
    } else {
      adjustTextareaHeight(messagesContainer);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

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
        img.style.cssText = `
          position: absolute;
          left: 0.25em;
          top: 0.5em;
          width: 2em;
          height: 2em;
          border-radius: 1em;
          cursor: pointer;
        `;
        img.addEventListener('click', () => loadTOPIC4PIC(payer));
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
        const trimmedClick2link = click2link.trim();
  
        if (trimmedClick2link) {
          const linkA = document.createElement('a');
          try {
            new URL(trimmedClick2link);
            linkA.href = trimmedClick2link;
          } catch (e) {
            console.warn('Invalid click2link URL:', trimmedClick2link);
          }
          linkA.target = '_blank';
          linkA.rel = 'noopener noreferrer';
          linkA.style.cssText = `
            color: ${usernameTopicChatColor};
            text-decoration: none;
            font-size: ${headerFontSizeTopicChat}vh;
          `;
          linkA.textContent = trimmedUsername;
          headerDiv.appendChild(linkA);
        } else if (trimmedUsername) {
          const span = document.createElement('span');
          span.style.cssText = `
            color: ${usernameTopicChatColor};
            font-size: ${headerFontSizeTopicChat}vh;
          `;
          span.textContent = trimmedUsername;
          headerDiv.appendChild(span);
        }
  
        headerContainer.appendChild(headerDiv);
        contentWrapper.appendChild(headerContainer);
  
        // Messages group div (where messages will be appended)
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
        margin-top: 0.5em;
      `;
  
      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = `color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;`;
      contentDiv.className = 'chat-msg-text';
      contentDiv.textContent = userMessage;

      const timeSpan = document.createElement('span');
      timeSpan.style.cssText = `font-size: ${timestampFontSizeTopicChat}vh; color: gray;`;
      timeSpan.className = 'chat-msg-time';
      timeSpan.textContent = timestamp;
  
      msgWrapper.appendChild(contentDiv);
      msgWrapper.appendChild(timeSpan);
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
      noMessagesSpan.style.marginLeft = '1vw';
      noMessagesSpan.textContent = 'No messages found';
  
      noMessagesDiv.appendChild(noMessagesSpan);
      messagesContainer.appendChild(noMessagesDiv);
    } else {
      adjustTextareaHeight(messagesContainer);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
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
      let userInput = document.getElementById("topic-chat-topic-id").value;
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;
  
        if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput;
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
      } else {
        console.log("No valid user message found with saveTimeFromTopicChat");
      }
    } catch (error) {
      console.error("Error loading time from users load column:", error);
    }
  });
  
  document.getElementById("save-filters-from-topic-chat").addEventListener("click", async () => {
    try {
      let userInput = document.getElementById("topic-chat-topic-id").value;
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;
  
        if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput;
      }
      const topicChatFromUsers = document.getElementById("load-msgs-from-ids-topic-chat").value;
      console.log("topicChatFromUsers", topicChatFromUsers);
      const meesageobject = {
        topicChatFromUsers: topicChatFromUsers
      };
      const meesage = JSON.stringify(meesageobject);
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
      let userInput = document.getElementById("topic-chat-topic-id").value;
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;
  
        if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput;
      }
      const topicChatBlocks = document.getElementById("load-blocks-from-ids-topic-chat").value;
        console.log("topicChatBlocks", topicChatBlocks);
      const meesageobject = {
        topicChatBlocks: topicChatBlocks
      };
      const meesage = JSON.stringify(meesageobject);
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
  