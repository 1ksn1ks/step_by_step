import {adjustTextareaHeight} from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { getMessages, getAccountNFTs, sendMessage, getTopicInfo } from './hedera';
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage } from './sodium' 
import { connectedAccount } from './web3';
import { profilePictures, usernames, click2url } from './loadalladata';


export let allLoadedMessagesEncryptedChat = [];
export let storedMessagesEncryptedChat = [];


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
      const topicSpinnerChat = `
      <div style="display: flex; justify-content: left; align-items: left; height: 100%;">
        <div id="topicspinnerchat"></div>
         <span style="margin-left: 1vw;">Loading messages from ${topicId}</span>
        </div>`;
      messagesContainer.innerHTML = topicSpinnerChat;
      adjustTextareaHeight(messagesContainer);
  
      const topicAdmin = [];
      try {
      const topicInfo = await getTopicInfo(topicId);
            const memo = topicInfo.memo;
  
            const parts = memo.split(',');
  
            parts.forEach(part => {
              if (part.startsWith("0.0.")) {
                topicAdmin.push(part);
              }
            });
      } catch (error) {
        const messagesContainer = document.getElementById("messages-from-encrypted-chat");
        const topicSpinnerChat = `
        <div style="display: flex; justify-content: left; align-items: left; height: 100%;">
          <span style="margin-left: 1vw;">Invalid Topic ID</span>
        </div>`;
        messagesContainer.innerHTML = topicSpinnerChat;
        adjustTextareaHeight(messagesContainer);
        console.error("Error getting topic info:", error);
        return;
      }
  
      const result = await getMessages(topicId);
      allLoadedMessagesEncryptedChat = [];
      allLoadedMessagesEncryptedChat.push(result);
  
  
      if (!result || !Array.isArray(result.messages)) {
        console.log("No messages found or result is not an array.");
        return [];
      }
  
      const messages = result.messages;
  
      const PublicKeyContainer = document.getElementById("encrypted-chat-public-key");
      const PrivateKeyContainer = document.getElementById("encrypted-chat-private-key");
  
      const PrivateKeyValue = PrivateKeyContainer.value;
  
  
      try{
        if (PrivateKeyValue.length < 30 && PublicKeyContainer.value.length < 55) {
  
          for (let index = messages.length - 1; index >= 0; index--) {
          const message = result.messages[index];
          let parsedMessage = message;
  
          if (typeof message === 'string') {
                  try {
                    parsedMessage = JSON.parse(message);
                  } catch (parseError) {
                    console.warn("Failed to parse message as JSON:", message, parseError);
                    continue; // skip invalid JSON
                  }
                } else {
                  parsedMessage = message;
                }
  
          if (parsedMessage.publicKey && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            PublicKeyContainer.value = parsedMessage.publicKey;
            const messagesContainer = document.getElementById("messages-from-encrypted-chat");
            const topicSpinnerChat = `
            <div style="display: flex; justify-content: left; align-items: left; height: 100%; ">
              <span style="margin-left: 1vw;">Loaded Public Key for topic ${topicId}</span>
            </div>`;
            messagesContainer.innerHTML = topicSpinnerChat;
            adjustTextareaHeight(messagesContainer);
            adjustTextareaHeight(PublicKeyContainer);
            break;
          }
        }
        if (PublicKeyContainer.value.length < 20) {
        const messagesContainer = document.getElementById("messages-from-encrypted-chat");
            const topicSpinnerChat = `
            <div style="display: flex; justify-content: left; align-items: left; height: 100%;">
              <span style="margin-left: 1vw;">No public key found</span>
            </div>`;
            messagesContainer.innerHTML = topicSpinnerChat;
            adjustTextareaHeight(messagesContainer);
        return;
      }
        }
      }catch (error) {
        const PublicKeySpinnerChat = `No public key found`;
        PublicKeyContainer.innerHTML = '';
        PublicKeyContainer.innerHTML = PublicKeySpinnerChat;
        adjustTextareaHeight(PublicKeyContainer);
        console.error("Error getting public key:", error);
        return;
      }
  
    
      const loadedNFTsForTopicChat = [];
  
  
      for (let index = 0; index < result.messages.length; index++) {
        const message = result.messages[index];
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }

          if (parsedMessage.addTopicChatNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nfts = parsedMessage.addTopicChatNFT.split(',').map(nft => nft.trim());
          nfts.forEach(nft => {
            if (nft.startsWith("0.0.") && !loadedNFTsForTopicChat.includes(nft)) {
              loadedNFTsForTopicChat.push(nft);
            }
          });
        }
  
        if (parsedMessage.removeTopicChatNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nft = parsedMessage.removeTopicChatNFT.trim();
          if (nft.startsWith("0.0.")) {
            const index = loadedNFTsForTopicChat.indexOf(nft);
            if (index !== -1) {
              loadedNFTsForTopicChat.splice(index, 1);
            }
          }
        }
        } catch (messageError) {
          console.error(`Error processing message ${index}:`, messageError);
        }
      }
  
  
      if (loadedNFTsForTopicChat.length > 0) {
    console.log("loadedNFTsForTopicChat", loadedNFTsForTopicChat);
  }
  
  
  
  
  let allMessages = '';
  let previousPayer = null;
  storedMessagesEncryptedChat = [];
  let groupHTML = '';
  let groupOpen = false;
  let decryptedMessage = null;
  
  const PrivateKey = parsePrivateKey(PrivateKeyValue);
  
  for (let index = 0; index < result.messages.length; index++) {
    const message = result.messages[index];
    try {
      let parsedMessage = message;
      if (typeof message === 'string') {
        parsedMessage = JSON.parse(message);
      }
  
      const payer = parsedMessage.payer || 'Unknown';
  
      // ----- NFT check (unchanged) -----
      let payerHasNFT = false;
      if (loadedNFTsForTopicChat.length > 0) {
        for (const item of loadedNFTsForTopicChat) {
          const checkIfUserHasNFT = await getAccountNFTs(payer, item);
          if (checkIfUserHasNFT.length > 0) {
            payerHasNFT = true;
            break;
          }
        }
      } else {
        payerHasNFT = true;
      }
  
      if (payerHasNFT && parsedMessage.encryptedMessage) {
        const userMessage = parsedMessage.encryptedMessage;
  
    decryptedMessage = await decryptMessage(userMessage, PrivateKey);
  
    let fullMessage = {decryptedMessage: decryptedMessage, created: parsedMessage.created, payer: payer};
    storedMessagesEncryptedChat.push(fullMessage);
  
  const payerImage = profilePictures[payer]?.url || 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
  
  // Function to validate URL
  function isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }
  
  // Check if payerImage is valid, if not use fallback
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
    })
  
  const payerInfo = message.payer ? `${message.payer}` : 'Anonymous';
                const username = message.payer && usernames[message.payer] ?
                  ` ${usernames[message.payer].username}` :
                  '';
  
                  const click2link= message.payer && click2url[message.payer] ?
                  ` ${click2url[message.payer].click2url}` :
                  '';
  
                  const displayHeader = 
          `<div class="toolbar-group-messages-header" style="display: flex; align-items: center; border-color: ${topicChatHeaderColor}; font-size: ${headerFontSizeTopicChat}vh;"> 
          <a href="https://explore.hashpack.app/${payerInfo}" target="_blank" style="color: ${accidTopicChatColor}; text-decoration: none; font-size: ${headerFontSizeTopicChat}vh;">${payerInfo}</a>&nbsp;` +
          (click2link ?
            `<a href="${click2link}" target="_blank" style="color: ${usernameTopicChatColor}; text-decoration: none; font-size: ${headerFontSizeTopicChat}vh;">${username}</a>` :
            `<span style="color: ${usernameTopicChatColor}; font-size: ${headerFontSizeTopicChat}vh;">${username}</span>`);
  
  
        // ---------------------------------------------------------
        // GROUPING LOGIC
        // ---------------------------------------------------------
        if (payer !== previousPayer) {
          // 1. Close previous group (if any)
          if (groupOpen) {
            groupHTML += '</div></div></div><br></div>'; // close inner divs + toolbar-group
            allMessages += groupHTML;
            groupHTML = '';
            groupOpen = false;
          }
  
  // Open NEW toolbar-group with GRID layout
  groupHTML = `<div class="toolbar-group-messages" style="position: relative; padding-left: 2.5em; min-height: 2.5em; border-color: ${innerContainerTopicChatColor};">
                <img src="${validPayerImage}" alt="Profile photo"
                    style="position: absolute; left: 0.25em; top: 0.5em; width: 2em; height: 2em; border-radius: 1em; cursor: pointer;"
                    onclick="loadTOPIC4PIC('${message.payer}');">
                  <div style="display: flex; flex-direction: column;">
                  <div style="display: flex; align-items: center;">
                    ${displayHeader}
                  </div></div>`;
  
    groupOpen = true;
  }
  
        // 3. Append the message (first or continuation)
        if (payer !== previousPayer) {
          // First message of the group – already inside the header block
          groupHTML += `<div style="color: ${textTopicChatColor}; margin-top: 0.5em; font-size: ${textFontSizeTopicChat}vh;">${decryptedMessage}</div>
                        <span style="font-size: ${timestampFontSizeTopicChat}vh; color: gray;">${timestamp}</span>`;
        } else {
          // Continuation – indented block
          groupHTML += `
            <div style="display: flex; flex-direction: column; justify-content: center; margin-top: 0.5em;">
              <div style="color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;">${decryptedMessage}</div>
              <span style="font-size: ${timestampFontSizeTopicChat}vh; color: gray;">${timestamp}</span>
            </div>`;
        }
  
        previousPayer = payer;
      } else {
        continue;
      }
    } catch (messageError) {
      console.error(`Error processing message ${index}:`, messageError);
      continue
    }
  }
  
  // ----- Flush the very last group -----
  if (groupOpen) {
    groupHTML += '</div></div></div><br></div>';
    allMessages += groupHTML;
  }
  
    messagesContainer.innerHTML = allMessages;
  
    if (allMessages.length === 0) {
      const messagesContainer = document.getElementById('messages-from-encrypted-chat');
      messagesContainer.innerHTML = 
      `<div style="display: flex; justify-content: left; align-items: left; height: 100%;">
         <span style="margin-left: 1vw;">No messages found</span>
        </div>`;
        return;
    }
  
    adjustTextareaHeight(messagesContainer);
  
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
    } catch (error) {
  
      console.error("Error setting rules:", error);
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
        fromTimeValue.slice(0, 2), // Hours
        fromTimeValue.slice(2, 4), // Minutes
        fromTimeValue.slice(4, 6)  // Seconds
      );
      toDate = new Date(
        toDateValue.slice(4, 8),
        toDateValue.slice(0, 2) - 1,
        toDateValue.slice(2, 4),
        toTimeValue.slice(0, 2), // Hours
        toTimeValue.slice(2, 4), // Minutes
        toTimeValue.slice(4, 6)  // Seconds
      );
    } else if (fromDateValue && toDateValue) {
      fromDate = new Date(fromDateValue.slice(4, 8), fromDateValue.slice(0, 2) - 1, fromDateValue.slice(2, 4));
      toDate = new Date(toDateValue.slice(4, 8), toDateValue.slice(0, 2) - 1, toDateValue.slice(2, 4));
    } else {
      // Default to a wide date range if no dates are provided
      fromDate = new Date(0); // Unix epoch start
      toDate = new Date(); // Current time
    }
  
    const filteredMessagesEncryptedChat = storedMessagesEncryptedChat.filter(parsedMessage => {
    const messageDate = new Date(parsedMessage.created);
  
    // Initialize an array to hold active filter conditions
    const conditions = [];
  
    // Date range filter (apply only if both fromDate and toDate are defined)
    if (fromDate && toDate) {
      conditions.push(messageDate >= fromDate && messageDate <= toDate);
    }
  
    // Load users filter (apply only if loadedUsers has values)
    if (loadedUsersEncryptedChat.length > 0) {
      conditions.push(loadedUsersEncryptedChat.includes(parsedMessage.payer));
    }
  
    // Block users filter (apply only if blockUsers has values)
    if (blockUsersEncryptedChat.length > 0) {
      conditions.push(!blockUsersEncryptedChat.includes(parsedMessage.payer));
    }
  
    // If no conditions are defined, include all messages
    if (conditions.length === 0) {
      return true;
    }
  
    // Return true only if all defined conditions are true
    return conditions.every(condition => condition);
  });
  
    let filteredMessagesEncryptedChatHtml = '';
    let previousPayer = null;
    let groupHTML = '';
    let groupOpen = false;
  
  filteredMessagesEncryptedChat.forEach(parsedMessage => {
      const decryptedMessage = parsedMessage.decryptedMessage;
      const payer = parsedMessage.payer || 'Unknown';
      const payerImage = profilePictures[payer]?.url || 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
  
  
  
    function isValidUrl(string) {
        try {
          new URL(string);
          return true;
        } catch (_) {
          return false;
        }
      }
  
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
  
    const payerInfo = parsedMessage.payer ? `${parsedMessage.payer}` : 'Anonymous';
      const username = parsedMessage.payer && usernames[parsedMessage.payer] ?
        ` ${usernames[parsedMessage.payer].username}` : '';
      const click2link = parsedMessage.payer && click2url[parsedMessage.payer] ?
        ` ${click2url[parsedMessage.payer].click2url}` : '';
  
    const displayHeader = 
        `<div class="toolbar-group-messages-header" style="display: flex; align-items: center; border-color: ${topicChatHeaderColor}; font-size: ${headerFontSizeTopicChat}vh;"> 
        <a href="https://explore.hashpack.app/${payerInfo}" target="_blank" style="color: ${accidTopicChatColor}; text-decoration: none; font-size: ${headerFontSizeTopicChat}vh;">${payerInfo}</a>&nbsp;` +
        (click2link ?
          `<a href="${click2link}" target="_blank" style="color: ${usernameTopicChatColor}; text-decoration: none; font-size: ${headerFontSizeTopicChat}vh;">${username}</a>` :
          `<span style="color: ${usernameTopicChatColor}; font-size: ${headerFontSizeTopicChat}vh;">${username}</span>`);
  
      if (payer !== previousPayer) {
        if (groupOpen) {
          groupHTML += '</div></div></div><br></div>';
          filteredMessagesHtml += groupHTML;
          groupHTML = '';
          groupOpen = false;
        }
  
        groupHTML = `<div class="toolbar-group-messages" style="position: relative; padding-left: 2.5em; min-height: 2.5em; border-color: ${innerContainerTopicChatColor};">
                      <img src="${validPayerImage}" alt="Profile photo"
                          style="position: absolute; left: 0.25em; top: 0.5em; width: 2em; height: 2em; border-radius: 1em; cursor: pointer;"
                          onclick="loadTOPIC4PIC('${parsedMessage.payer}');">
                        <div style="display: flex; flex-direction: column;">
                        <div style="display: flex; align-items: center;">
                          ${displayHeader}
                        </div></div>`;
        groupOpen = true;
      }
  
      if (payer !== previousPayer) {
        groupHTML += `<div style="color: ${textTopicChatColor}; margin-top: 0.5em; font-size: ${textFontSizeTopicChat}vh;">${decryptedMessage}</div>
                      <span style="font-size: ${timestampFontSizeTopicChat}vh; color: gray;">${timestamp}</span>`;
      } else {
        groupHTML += `
          <div style="display: flex; flex-direction: column; justify-content: center; margin-top: 0.5em;">
            <div style="color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;">${decryptedMessage}</div>
            <span style="font-size: ${timestampFontSizeTopicChat}vh; color: gray;">${timestamp}</span>
          </div>`;
      }
  
        previousPayer = payer;
      }); 
  
  
  // ----- Flush the very last group -----
  if (groupOpen) {
    groupHTML += '</div></div></div><br></div>';
    filteredMessagesEncryptedChatHtml += groupHTML;
  }
  
  const messagesContainer = document.getElementById('messages-from-encrypted-chat');
    messagesContainer.innerHTML = filteredMessagesEncryptedChatHtml;
  
    if (filteredMessagesEncryptedChatHtml.length === 0) {
      messagesContainer.innerHTML = 
      `<div style="display: flex; justify-content: left; align-items: left; height: 100%;">
         <span style="margin-left: 1vw;">No messages found</span>
        </div>`;
        return;
    }
  
    adjustTextareaHeight(messagesContainer);
  
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
  };
    
  async function handleFilterMessagesEncryptedChat() {
    console.log("handleFilterMessagesEncryptedChat");
    // Get values from all input fields
    const fromDateValue = document.getElementById("from-mmddyyyy-encrypted-chat").value;
    const toDateValue = document.getElementById("to-mmddyyyy-encrypted-chat").value;
    const fromTimeValue = document.getElementById("from-hhmmss-encrypted-chat").value;
    const toTimeValue = document.getElementById("to-hhmmss-encrypted-chat").value;
    const topicChatFromUsers = document.getElementById("load-msgs-from-ids-encrypted-chat").value;
    const topicChatBlockUsers = document.getElementById("load-blocks-from-ids-encrypted-chat")?.value || ''; // Assuming a block users input field
  
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
          break; // Stop at the first valid message
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
          break; // Stop at the first valid message
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
          break; // Stop at the first valid message
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
  