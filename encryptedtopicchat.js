import { adjustTextareaHeight } from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { getMessages, getAccountNFTs, sendMessage, getTopicInfo } from './hedera';
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage } from './sodium' 
import { connectedAccount } from './web3';
import { profilePictures, usernames, click2url } from './loadalladata';
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
  
  const emptySpan = document.createElement('span');
  emptySpan.style.marginLeft = '1vw';
  emptySpan.textContent = message;
  
  emptyDiv.appendChild(emptySpan);
  container.appendChild(emptyDiv);
}

// Helper function to create loading spinner
function createLoadingSpinner(container, topicId) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  
  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'display: flex; justify-content: left; align-items: left; height: 100%;';
  
  const spinner = document.createElement('div');
  spinner.id = 'topicspinnerchat';
  loadingDiv.appendChild(spinner);
  
  const loadingSpan = document.createElement('span');
  loadingSpan.style.marginLeft = '1vw';
  loadingSpan.textContent = `Loading messages from ${topicId}`;
  loadingDiv.appendChild(loadingSpan);
  
  container.appendChild(loadingDiv);
}

document.getElementById("load-msgs-from-encrypted-chat").addEventListener("click", async () => {
  await loadMessagesFromEncryptedChat();
});

async function loadMessagesFromEncryptedChat() {
  try {
    let userInput = document.getElementById("encrypted-chat-topic-id").value.toLowerCase();
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;

    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }

    const messagesContainer = document.getElementById("messages-from-encrypted-chat");
    if (!messagesContainer) return;

    // Show loading spinner
    createLoadingSpinner(messagesContainer, topicId);
    adjustTextareaHeight(messagesContainer);

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

    const result = await getMessages(topicId);
    allLoadedMessagesEncryptedChat = [result];

    if (!result || !Array.isArray(result.messages)) {
      console.log("No messages found or result is not an array.");
      createEmptyStateMessage(messagesContainer, 'No messages found');
      adjustTextareaHeight(messagesContainer);
      return;
    }

    const messages = result.messages;

    const PublicKeyContainer = document.getElementById("encrypted-chat-public-key");
    const PrivateKeyContainer = document.getElementById("encrypted-chat-private-key");
    const PrivateKeyValue = PrivateKeyContainer.value;

    // Try to load public key from messages (backward scan)
    try {
      if (PrivateKeyValue.length < 30 && PublicKeyContainer.value.length < 55) {
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index];
          let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;

          if (parsedMessage.publicKey && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            PublicKeyContainer.value = parsedMessage.publicKey;
            createEmptyStateMessage(messagesContainer, `Loaded Public Key for topic ${topicId}`);
            adjustTextareaHeight(messagesContainer);
            adjustTextareaHeight(PublicKeyContainer);
            break;
          }
        }

        if (PublicKeyContainer.value.length < 20) {
          createEmptyStateMessage(messagesContainer, 'No public key found');
          adjustTextareaHeight(messagesContainer);
          return;
        }
      }
    } catch (error) {
      PublicKeyContainer.value = '';
      createEmptyStateMessage(PublicKeyContainer, 'No public key found');
      adjustTextareaHeight(PublicKeyContainer);
      console.error("Error getting public key:", error);
      return;
    }

    // Collect NFTs
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

    if (loadedNFTsForTopicChat.length > 0) {
      console.log("loadedNFTsForTopicChat", loadedNFTsForTopicChat);
    }

    // ────────────────────────────────────────────────────────────────
    // SAFE RENDERING WITH DOM
    // ────────────────────────────────────────────────────────────────

    while (messagesContainer.firstChild) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }

    const fragment = document.createDocumentFragment();

    let previousPayer = null;
    storedMessagesEncryptedChat = [];
    let currentGroupDiv = null;
    let currentMessagesGroupDiv = null;
    let isFirstGroup = true;

    const PrivateKey = parsePrivateKey(PrivateKeyValue);

    for (const message of messages) {
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

        if (payerHasNFT && parsedMessage.encryptedMessage) {
          const encryptedMsg = parsedMessage.encryptedMessage;
          const decryptedMessage = await decryptMessage(encryptedMsg, PrivateKey);

          const fullMessage = {
            decryptedMessage,
            created: parsedMessage.created,
            payer
          };
          storedMessagesEncryptedChat.push(fullMessage);

          const payerImage = profilePictures[payer]?.url || 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
          const validPayerImage = isValidUrl(payerImage) ? payerImage : 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';

          const timestamp = new Date(parsedMessage.created)
            .toLocaleString('en-US', {
              hour12: false,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });

          const payerInfo = message.payer ? message.payer : 'Anonymous';
          const username = message.payer && usernames[message.payer]?.username
            ? ` ${usernames[message.payer].username}` : '';
          const click2link = message.payer && click2url[message.payer]?.click2url
            ? ` ${click2url[message.payer].click2url}` : '';

          // New payer → new group
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

            // Content wrapper
            const contentWrapper = document.createElement('div');
            contentWrapper.style.cssText = 'display: flex; flex-direction: column;';

            // Header container
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

            // Add space
            headerDiv.appendChild(document.createTextNode('\u00A0'));

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
            margin-top: 0.5em;
          `;

          const contentDiv = document.createElement('div');
          contentDiv.style.cssText = `color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;`;
          contentDiv.textContent = decryptedMessage;

          const timeSpan = document.createElement('span');
          timeSpan.style.cssText = `font-size: ${timestampFontSizeTopicChat}vh; color: gray;`;
          timeSpan.textContent = timestamp;

          msgWrapper.appendChild(contentDiv);
          msgWrapper.appendChild(timeSpan);
          currentMessagesGroupDiv.appendChild(msgWrapper);

          previousPayer = payer;
        }
      } catch (err) {
        console.error(`Error processing message:`, err);
        continue;
      }
    }

    messagesContainer.appendChild(fragment);

    if (messagesContainer.children.length === 0) {
      createEmptyStateMessage(messagesContainer, 'No messages found');
    } else {
      adjustTextareaHeight(messagesContainer);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

  } catch (error) {
    console.error("Error loading encrypted chat messages:", error);
  }
}

document.getElementById('go-to-top-msgs-encrypted-chat').addEventListener('click', function() {
  const container = document.getElementById('messages-from-encrypted-chat');
  container.scrollTop = 0;
});

document.getElementById("post-msg-encrypted-chat").addEventListener("click", async () => {
  try {
    let userInput = document.getElementById("encrypted-chat-topic-id").value.toLowerCase();
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    const PublicKey = parsePublicKey(document.getElementById("encrypted-chat-public-key").value);
    let topicId;

    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }

    const message = document.getElementById("user-write-message-encrypted-chat").value;
    const encryptedMessage = await encryptMessage(message, PublicKey);

    const meesageobject = {
      encryptedMessage: encryptedMessage
    };
    
    const newMeesage = JSON.stringify(meesageobject);
    console.log('New Meesage:', newMeesage);
    const reciept = await sendMessage(topicId, newMeesage);
    console.log('Reciept:', reciept);
  } catch (error) {
    console.error('Error:', error.message);
  }
});

document.getElementById("stack-encrypted-chat-public-key-button").addEventListener("click", async () => {
  try {
    let userInput = document.getElementById("encrypted-chat-topic-id").value.toLowerCase();
    let publicKey = document.getElementById("encrypted-chat-public-key").value;
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;

    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }

    const messageobject = {
      publicKey: publicKey
    };
    const message = JSON.stringify(messageobject);
    const receipt = await sendMessage(topicId, message);
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

  // Handle date and time parsing
  if (fromTimeValue && toTimeValue && fromDateValue && toDateValue) {
    fromDate = new Date(
      fromDateValue.slice(4, 8),
      fromDateValue.slice(0, 2) - 1,
      fromDateValue.slice(2, 4),
      fromTimeValue.slice(0, 2),
      fromTimeValue.slice(2, 4),
      fromTimeValue.slice(4, 6)
    );
    toDate = new Date(
      toDateValue.slice(4, 8),
      toDateValue.slice(0, 2) - 1,
      toDateValue.slice(2, 4),
      toTimeValue.slice(0, 2),
      toTimeValue.slice(2, 4),
      toTimeValue.slice(4, 6)
    );
  } else if (fromDateValue && toDateValue) {
    fromDate = new Date(fromDateValue.slice(4, 8), fromDateValue.slice(0, 2) - 1, fromDateValue.slice(2, 4));
    toDate = new Date(toDateValue.slice(4, 8), toDateValue.slice(0, 2) - 1, toDateValue.slice(2, 4));
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
      margin-top: 0.5em;
    `;

    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = `color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;`;
    contentDiv.textContent = decryptedMessage;

    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = `font-size: ${timestampFontSizeTopicChat}vh; color: gray;`;
    timeSpan.textContent = timestamp;

    msgWrapper.appendChild(contentDiv);
    msgWrapper.appendChild(timeSpan);
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
    let userInput = document.getElementById("encrypted-chat-topic-id").value;
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;

    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }
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
    } else {
      console.log("No valid user message found with saveTimeFromEncryptedChat");
    }
  } catch (error) {
    console.error("Error loading time from encrypted chat:", error);
  }
});

document.getElementById("load-save-filters-from-users-encrypted-chat").addEventListener("click", async () => {
  try {
    let userInput = document.getElementById("encrypted-chat-topic-id").value;
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;

    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }
    const encryptedChatFromUsers = document.getElementById("load-msgs-from-ids-encrypted-chat").value;
    console.log("encryptedChatFromUsers", encryptedChatFromUsers);
    const meesageobject = {
      encryptedChatFromUsers: encryptedChatFromUsers
    };
    const meesage = JSON.stringify(meesageobject);
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
    let userInput = document.getElementById("encrypted-chat-topic-id").value;
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;

    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }
    const encryptedChatBlocks = document.getElementById("load-blocks-from-ids-encrypted-chat").value;
    console.log("encryptedChatBlocks", encryptedChatBlocks);
    const meesageobject = {
      encryptedChatBlocks: encryptedChatBlocks
    };
    const meesage = JSON.stringify(meesageobject);
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