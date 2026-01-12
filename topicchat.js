import {adjustTextareaHeight} from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { getMessages, getAccountNFTs, sendMessage, getTopicInfo } from './hedera';
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



export let allLoadedMessagesTopicChat = [];
export let storedMessages = [];

document.getElementById('go-to-top-msgs').addEventListener('click', function() {
    const container = document.getElementById('messages-from-topic-chat');
    container.scrollTop = 0;
  });
  
  document.getElementById("load-msgs-from").addEventListener("click", async () => {
    try {
      let userInput = document.getElementById("topic-chat-topic-id").value.toLowerCase();
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;
  
      if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput;
      }
  
      
      const messagesContainer = document.getElementById("messages-from-topic-chat");
      const topicSpinnerChat = `
      <div style="display: flex; justify-content: left; align-items: left; height: 100%; ">
        <div id="topicspinnerchat"></div>
         <span style="margin-left: 1vw;">Loading messages from ${topicId}</span>
        </div>`;
      messagesContainer.innerHTML = topicSpinnerChat;
      adjustTextareaHeight(messagesContainer);
  
  
      const topicAdmin = [];
  
      try{
      const topicInfo = await getTopicInfo(topicId);
            const memo = topicInfo.memo;
  
            // Split the memo by commas
            const parts = memo.split(',');
  
            // Iterate over each part
            parts.forEach(part => {
              // Check if the part starts with "0.0."
              if (part.startsWith("0.0.")) {
                // Add it to the topicAdmin array
                topicAdmin.push(part);
              }
            });
          } catch (error){
                const messagesContainer = document.getElementById('messages-from-topic-chat');
                messagesContainer.innerHTML = 
                `<div style="display: flex; justify-content: left; align-items: left; height: 100%; ">
                  <span style="margin-left: 1vw;">Invalid Topic ID</span>
                  </div>`;
                adjustTextareaHeight(messagesContainer);
                return;
          }
  
          const rawResult = await getMessages(topicId);

  
          const seen = new Map();
          const uniqueMessages = {messages:[]};
  
          for (let index = 0; index < rawResult.messages.length; index++) {
            const message = rawResult.messages[index];
            const seqNum = message.sequence_number;
  
            if (!seen.has(seqNum)) {
              seen.set(seqNum, true);
              uniqueMessages.messages.push(message);
            }
          }
  
  
          allLoadedMessagesTopicChat = [];
          allLoadedMessagesTopicChat.push(uniqueMessages);
  
          if (!rawResult || !Array.isArray(rawResult.messages)) {
            console.log("No messages found or rawResult is not an array.");
            return [];
          }
  
  
  
    
      const loadedNFTsForTopicChat = [];
  
  
  
      for (let index = 0; index < rawResult.messages.length; index++) {
        const message = rawResult.messages[index];
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }
          const timestamp = message.timestamp || Date.now(); // Use message timestamp or current time
  
          if (parsedMessage.addTopicChatNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nfts = parsedMessage.addTopicChatNFT.split(',').map(nft => nft.trim());
          nfts.forEach(nft => {
            if (nft.startsWith("0.0.") && !loadedNFTsForTopicChat.includes(nft)) { // Check if NFT starts with "0.0."
              loadedNFTsForTopicChat.push(nft);
            }
          });
        }
  
        if (parsedMessage.removeTopicChatNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nft = parsedMessage.removeTopicChatNFT.trim();
          if (nft.startsWith("0.0.")) { // Check if NFT starts with "0.0."
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
  
  
  let allMessages = '';
  let previousPayer = null;
  storedMessages = [];
  let groupHTML = '';
  let groupOpen = false;
  
  for (let index = 0; index < rawResult.messages.length; index++) {
    const message = rawResult.messages[index];
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
  
  
      if (payerHasNFT && parsedMessage.userMessage) {
        const userMessage = parsedMessage.userMessage;
        storedMessages.push(parsedMessage);
  
        const payerImage = profilePictures[payer]?.url || 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
  
        // ----- URL validation (unchanged) -----
        function isValidUrl(string) {
          try { new URL(string); return true; } catch (_) { return false; }
        }
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
  
        const payerInfo = message.payer ? `${message.payer}` : 'Anonymous';
        const username = message.payer && usernames[message.payer] ?
          ` ${usernames[message.payer].username}` : '';
        const click2link = message.payer && click2url[message.payer] ?
          ` ${click2url[message.payer].click2url}` : '';
  
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
          groupHTML += `<div style="color: ${textTopicChatColor}; margin-top: 0.5em; font-size: ${textFontSizeTopicChat}vh;">${userMessage}</div>
                        <span style="font-size: ${timestampFontSizeTopicChat}vh; color: gray;">${timestamp}</span>`;
        } else {
          // Continuation – indented block
          groupHTML += `
            <div style="display: flex; flex-direction: column; justify-content: center; margin-top: 0.5em;">
              <div style="color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;">${userMessage}</div>
              <span style="font-size: ${timestampFontSizeTopicChat}vh; color: gray;">${timestamp}</span>
            </div>`;
        }
  
        previousPayer = payer;
      } else {
        console.warn(`Message ${index} is missing payer or data.`);
      }
    } catch (messageError) {
      console.error(`Error processing message ${index}:`, messageError);
    }
  }
  
  // ----- Flush the very last group -----
  if (groupOpen) {
    groupHTML += '</div></div></div><br></div>';
    allMessages += groupHTML;
  }
  
    messagesContainer.innerHTML = allMessages;
  
    if (allMessages.length === 0) {
      const messagesContainer = document.getElementById('messages-from-topic-chat');
  
      messagesContainer.innerHTML = 
       `<div style="display: flex; justify-content: left; align-items: left; height: 100%; ">
         <span style="margin-left: 1vw;">No messages found</span>
        </div>`; 
      return;
      }
    
    adjustTextareaHeight(messagesContainer);
  
    // Scroll to the bottom of the message container
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
    } catch (error) {
  
      console.error("Error setting rules:", error);
    }
  });
  
  async function filterTopicMessages(fromDateValue, toDateValue, fromTimeValue, toTimeValue, loadUsersArray, blockUsersArray) {
    let loadedUsersTopicChat = loadUsersArray || [];
    let blockUsersTopicChat = blockUsersArray || [];
  
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
  
    const filteredMessages = storedMessages.filter(parsedMessage => {
    const messageDate = new Date(parsedMessage.created);
  
    // Initialize an array to hold active filter conditions
    const conditions = [];
  
    // Date range filter (apply only if both fromDate and toDate are defined)
    if (fromDate && toDate) {
      conditions.push(messageDate >= fromDate && messageDate <= toDate);
    }
  
    // Load users filter (apply only if loadedUsers has values)
    if (loadedUsersTopicChat.length > 0) {
      conditions.push(loadedUsersTopicChat.includes(parsedMessage.payer));
    }
  
    // Block users filter (apply only if blockUsers has values)
    if (blockUsersTopicChat.length > 0) {
      conditions.push(!blockUsersTopicChat.includes(parsedMessage.payer));
    }
  
    // If no conditions are defined, include all messages
    if (conditions.length === 0) {
      return true;
    }
  
    // Return true only if all defined conditions are true
    return conditions.every(condition => condition);
  });
  
    // Rest of the function (HTML generation, grouping, etc.) remains unchanged
    let filteredMessagesHtml = '';
    let previousPayer = null;
    let groupHTML = '';
    let groupOpen = false;
  
    filteredMessages.forEach(parsedMessage => {
      const userMessage = parsedMessage.userMessage;
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
        groupHTML += `<div style="color: ${textTopicChatColor}; margin-top: 0.5em; font-size: ${textFontSizeTopicChat}vh;">${userMessage}</div>
                      <span style="font-size: ${timestampFontSizeTopicChat}vh; color: gray;">${timestamp}</span>`;
      } else {
        groupHTML += `
          <div style="display: flex; flex-direction: column; justify-content: center; margin-top: 0.5em;">
            <div style="color: ${textTopicChatColor}; font-size: ${textFontSizeTopicChat}vh;">${userMessage}</div>
            <span style="font-size: ${timestampFontSizeTopicChat}vh; color: gray;">${timestamp}</span>
          </div>`;
      }
  
      previousPayer = payer;
    });
  
    if (groupOpen) {
      groupHTML += '</div></div></div><br></div>';
      filteredMessagesHtml += groupHTML;
    }
  
    const messagesContainer = document.getElementById('messages-from-topic-chat');
    messagesContainer.innerHTML = filteredMessagesHtml;
  
    if (filteredMessagesHtml.length === 0) {
      messagesContainer.innerHTML = 
        `<div style="display: flex; justify-content: left; align-items: left; height: 100%;">
          <span style="margin-left: 1vw;">No messages found</span>
        </div>`;
      return;
    }
  
    adjustTextareaHeight(messagesContainer);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };
  
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
      const userMessages = messages.messages.filter(message => message.payer === globalAccountId);
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
      const userMessages = messages.messages.filter(message => message.payer === globalAccountId);
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
      console.log("messagesObject", messages);
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
      const userMessages = messages.messages.filter(message => message.payer === globalAccountId);
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
  