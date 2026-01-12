
document.getElementById("load-topic-rules-for-utility").addEventListener("click", async () => {
    try {
        let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
        let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
        let topicId;

        if (domainEntry && domainEntry.lastMessage) {
            topicId = domainEntry.lastMessage.topic;
        } else {
            topicId = userInput;
        }

        const messagesContainer = document.getElementById('loaded-topic-rules-for-utility');
              messagesContainer.innerHTML = '';
              const topicSpinnerChat = `
        <div style="display: flex; justify-content: left; align-items: left; padding-top: 1vh; padding-bottom: 1vh;">
          <div id="topicspinnerchat"></div>
          <span style="margin-left: 1vw;">loading messages from ${topicId}</span>
          </div>`;
        messagesContainer.innerHTML = topicSpinnerChat;
        adjustTextareaHeight(messagesContainer);


        const response = await getMessages(topicId);
        const topicInfo = await getTopicInfo(topicId);
        const topicAdmin = [];
        const memo = topicInfo.memo;
        let hasRules = false;

        // Split the memo by commas
        const parts = memo.split(',');

        // Iterate over each part
        parts.forEach(part => {
            // Check if the part starts with "0.0."
            if (part.startsWith("0.0.")) {
                // Add it to the topicAdmin array
                topicAdmin.push(part);
                hasRules = true;
            }
        });

        const messages = response.messages; // Extract messages

        let formattedRules;


const loadedNFTsForModel = [];
const loadedNFTScaleForModel = [];
const loadedNFTsForTopicChat = [];


for (let index = 0; index < messages.length; index++) {
  const message = messages[index];
  try {
    let parsedMessage = message;
    if (typeof message === 'string') {
      parsedMessage = JSON.parse(message);
    }
    if (parsedMessage.addTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
  const nfts = parsedMessage.addTopicNFT.split(',').map(nft => nft.trim());
  nfts.forEach(nft => {
    if (!loadedNFTsForModel.includes(nft)) {
      loadedNFTsForModel.push(nft);
    }
  });
}

if (parsedMessage.removeTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
  const nft = parsedMessage.removeTopicNFT.trim();
  const index = loadedNFTsForModel.indexOf(nft);
  if (index !== -1) {
    loadedNFTsForModel.splice(index, 1);
  }
}

  if (parsedMessage.addScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
    const { NFT, scale } = parsedMessage.addScale;
    loadedNFTScaleForModel.push({ NFT, scale });
  }

  if (parsedMessage.removeScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
    const { NFT } = parsedMessage.removeScale;
    const index = loadedNFTScaleForModel.findIndex(item => item.NFT === NFT);
    if (index !== -1) {
      loadedNFTScaleForModel.splice(index, 1); // Remove the item if it exists
    } else {
      console.log(`NFT: ${NFT} not found in addScale list`);
    }
  }

  if (parsedMessage.addTopicChatNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
  const nfts = parsedMessage.addTopicChatNFT.split(',').map(nft => nft.trim());
  nfts.forEach(nft => {
    if (!loadedNFTsForTopicChat.includes(nft)) {
      loadedNFTsForTopicChat.push(nft);
    }
  });
}

if (parsedMessage.removeTopicChatNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
  const nft = parsedMessage.removeTopicChatNFT.trim();
  const index = loadedNFTsForTopicChat.indexOf(nft);
  if (index !== -1) {
    loadedNFTsForTopicChat.splice(index, 1);
  }
}
}
catch (messageError) {
  console.error(`Error processing message ${index}:`, messageError);
  }
}

if (loadedNFTsForModel.length === 0 && loadedNFTScaleForModel.length === 0 && loadedNFTsForTopicChat.length === 0) {
  formattedRules = '<span style="user-select: text;">No rules for this topic.</span>';
}

  if (loadedNFTsForModel.length > 0) {
    formattedRules += `<span style="user-select: text;">NFTs for model: ${loadedNFTsForModel.join(', ')}</span><br>`;
    hasRules = true;
  }
  if (loadedNFTScaleForModel.length > 0) {
    formattedRules += `<span style="user-select: text;">Scales for model: ${loadedNFTScaleForModel.map(item => `${item.NFT} = ${item.scale}`).join(', ')}</span><br>`;
    hasRules = true;
  }
  if (loadedNFTsForTopicChat.length > 0) {
    formattedRules += `<span style="user-select: text;">NFTs for topic chat: ${loadedNFTsForTopicChat.join(', ')}</span><br>`;
    hasRules = true;
  }

          // Check if messages exist and is an array
          if (hasRules===false) {
            const utilityRulesMessage = `<span>No rules for this topic.</span>`;
            messagesContainer.innerHTML = utilityRulesMessage;
            adjustTextareaHeight(messagesContainer);
            return;
        }

        // Log the formatted rules onto the textarea
        messagesContainer.innerHTML = formattedRules;
        adjustTextareaHeight(messagesContainer);

    } catch (error) {
        console.error("Error creating topic:", error);
        const messagesContainer = document.getElementById('loaded-topic-rules-for-utility');
        const invalidTopicIdMessage = `<span style="padding-top: 1vh;">Invalid Topic ID</span>`;
        messagesContainer.innerHTML = invalidTopicIdMessage;
        adjustTextareaHeight(messagesContainer);
    }
});
