import {getMessages,
  getTopicInfo,
   sendMessage,
    generatePrivateAndPublicKey,
     createTopic,
      updateTopic} from './hedera'
import {adjustTextareaHeight} from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { loadAllData } from './loadalladata';
import { debounce } from './debounce';
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage, encryptWithPassword, decryptWithPassword } from './sodium' 



let allLoadedMessages;


document.getElementById("submit-button-Create_New_Topic").addEventListener("click", async () => {
   try {
     const memo = document.getElementById("input-field-5-1").value || 'this is memo';
     const adminKey = document.getElementById("input-field-5-2").value;
     // const fee = document.getElementById("input-field-5-3").value;
     // const tokenId = document.getElementById("input-field-5-4").value;
     // const royaltyAccount = document.getElementById("input-field-5-5").value;
 
     // if ((memo && !adminKey) || (!memo && adminKey)) {
     //   console.error("Both memo and adminKey must be provided together.");
     //   return;
     // }
 
     let createdTopicId;

     if (memo && adminKey) {
       createdTopicId = await createTopic({memo:memo, adminkey:adminKey});
     } 
     else if (adminKey) {
       createdTopicId = await createTopic({adminkey:adminKey});
     } 
     else if (memo) {
       createdTopicId = await createTopic({memo:memo});
     } 
     else {
       await createTopic();
     }
 
     console.log("createdTopicId is", createdTopicId);
 
 
     document.getElementById("input-field-5").value = createdTopicId;
     document.getElementById("input-field-2-0").value = createdTopicId;
     document.getElementById("input-field-3-0").value = createdTopicId;
     } catch (error) {
     console.error("Error creating topic:", error);
   }
 });
 
 document.getElementById("generate-private-and-public-key").addEventListener("click", async () => {
   try {
     const { privateKey, publicKey } = await generatePrivateAndPublicKey();
 
     const privateKeyTextarea = document.getElementById("generated-private-key");
     const publicKeyTextarea = document.getElementById("generated-public-key");
 
     privateKeyTextarea.value = privateKey;
     publicKeyTextarea.value = publicKey;
 
     adjustTextareaHeight(privateKeyTextarea);
     adjustTextareaHeight(publicKeyTextarea);
     } catch (error) {
     console.error("Error creating topic:", error);
   }
 });
 
 document.getElementById("submit-button-Change_Memo").addEventListener("click", async () => {
   try {
     let userInput = document.getElementById("input-field-topic-id").value.toLowerCase();
     let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
     let topicId;
 
     if (domainEntry && domainEntry.lastMessage) {
       topicId = domainEntry.lastMessage.topic;
       } else {
       topicId = userInput;
     }
     const memo =document.getElementById("input-field-memo").value || '';
     let adminKey = document.getElementById("input-field-admin-key").value;
     const realfee = document.getElementById("input-field-fee").value;
     const tokenId = document.getElementById("input-field-fee-token").value;
     const royaltyAccount = document.getElementById("input-field-royal-acc").value;
 
     const fee = realfee * 1000000
 
     let customFees = [];
 
     if (realfee && tokenId && royaltyAccount) {
       customFees.push({
         denominatingTokenId: tokenId,
         amount: fee,
         collectorAccountId: royaltyAccount
       });


       await updateTopic({topicId:topicId , memo:memo, adminKey:adminKey, customFees:customFees});
     } else {
     await updateTopic({topicId:topicId , memo:memo, adminKey:adminKey});
     }
 
 
   } catch (error) {
   console.error("Error creating topic:", error);
   }
 });
 
 document.getElementById("button3").addEventListener("click", async () => {
 try {
   let userInput = document.getElementById("Edit_Profile-topic-id").value.toLowerCase();
   const newName = document.getElementById("toolbar-input").value;
 
 
   let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
   let topicId;
 
   if (domainEntry && domainEntry.lastMessage) {
     topicId = domainEntry.lastMessage.topic;
   } else {
     topicId = userInput;
   }
 
   const meesageobject = {
     changeName: newName
   };
 
   const meesage = JSON.stringify(meesageobject);
   const reciept = await sendMessage(topicId, meesage);
 
 } catch (error) {
   console.error("Error setting rules:", error);
 }
 });
 
 document.getElementById("save-filters-from-users").addEventListener("click", async () => {
   try {
     let userInput = document.getElementById("input-field").value;
     let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
     let topicId;
 
       if (domainEntry && domainEntry.lastMessage) {
       topicId = domainEntry.lastMessage.topic;
     } else {
       topicId = userInput;
     }
 
     const loadColumnsFromUsers = document.getElementById("load-msgs-from-ids").value;
     console.log("loadColumnsFromUsers", loadColumnsFromUsers);
     const meesageobject = {
       loadColumnsFromUsers: loadColumnsFromUsers
     };
     const meesage = JSON.stringify(meesageobject);
     const reciept = await sendMessage(topicId, meesage);
   } catch (error) {
     console.error("Error loading filters from users:", error);
   }
 });
 
 document.getElementById("save-time-from-users-load-column").addEventListener("click", async () => {
   try {
     let userInput = document.getElementById("input-field").value;
     let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
     let topicId;
 
       if (domainEntry && domainEntry.lastMessage) {
       topicId = domainEntry.lastMessage.topic;
     } else {
       topicId = userInput;
     }
     const fromMmddyyyy = document.getElementById("from-mmddyyyy-users-load-column").value;
     const toMmddyyyy = document.getElementById("to-mmddyyyy-users-load-column").value;
     const fromHhmmss = document.getElementById("from-hhmmss-users-load-column").value;
     const toHhmmss = document.getElementById("to-hhmmss-users-load-column").value;
 
     const meesageobject = {
       saveTimeFromUsersLoadColumn: {
       fromMmddyyyy: fromMmddyyyy,
         toMmddyyyy: toMmddyyyy,
         fromHhmmss: fromHhmmss,
         toHhmmss: toHhmmss
       }
     };
     const meesage = JSON.stringify(meesageobject);
     const reciept = await sendMessage(topicId, meesage);
   } catch (error) {
     console.error("Error loading filters from users:", error);
   }
 });
 
 document.getElementById("load-filters-from-users").addEventListener("click", async () => {
   try {
     const messages = allLoadedMessages[0];
     const userMessages = messages.messages.filter(message => message.payer === globalAccountId);
     let lastValidMessage = null;
     for (let i = userMessages.length - 1; i >= 0; i--) {
       if (userMessages[i] && userMessages[i].loadColumnsFromUsers) {
         lastValidMessage = userMessages[i];
         break; // Stop at the first valid message
       }
     }
     if (lastValidMessage) {
       document.getElementById("load-msgs-from-ids").value = lastValidMessage.loadColumnsFromUsers;
     } else {
       console.log("No valid user message found with loadMsgsFromIds");
     }
     console.log("messagesObject", messages);
   } catch (error) {
     console.error("Error loading filters from users:", error);
   }
 });
 
 document.getElementById("load-time-from-users-load-column").addEventListener("click", async () => {
   try {
     const messages = allLoadedMessages[0];
     const userMessages = messages.messages.filter(message => message.payer === globalAccountId);
     let lastValidMessage = null;
     for (let i = userMessages.length - 1; i >= 0; i--) {
       if (userMessages[i] && userMessages[i].saveTimeFromUsersLoadColumn) {
         lastValidMessage = userMessages[i];
         break; // Stop at the first valid message
       }
     }
     if (lastValidMessage) {
       document.getElementById("from-mmddyyyy-users-load-column").value = lastValidMessage.saveTimeFromUsersLoadColumn.fromMmddyyyy || '';
       document.getElementById("to-mmddyyyy-users-load-column").value = lastValidMessage.saveTimeFromUsersLoadColumn.toMmddyyyy || '';
       document.getElementById("from-hhmmss-users-load-column").value = lastValidMessage.saveTimeFromUsersLoadColumn.fromHhmmss || '000000';
       document.getElementById("to-hhmmss-users-load-column").value = lastValidMessage.saveTimeFromUsersLoadColumn.toHhmmss || '000000';
     } else {
       console.log("No valid user message found with loadTimeFromUsersLoadColumn");
     }
   } catch (error) {
     console.error("Error loading time from users load column:", error);
   }
 });
 
 document.getElementById("save-blocks-from-users").addEventListener("click", async () => {
   try {
     let userInput = document.getElementById("input-field").value;
     let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
     let topicId;
 
       if (domainEntry && domainEntry.lastMessage) {
       topicId = domainEntry.lastMessage.topic;
     } else {
       topicId = userInput;
     }
     const loadColumnChatBlocks = document.getElementById("load-blocks-from-ids").value;
       console.log("loadColumnChatBlocks", loadColumnChatBlocks);
     const meesageobject = {
       loadColumnChatBlocks: loadColumnChatBlocks
     };
     const meesage = JSON.stringify(meesageobject);
     const reciept = await sendMessage(topicId, meesage);
   } catch (error) {
     console.error("Error loading filters from users:", error);
   }
 });
 
 document.getElementById("load-blocks-from-users").addEventListener("click", async () => {
   try {
     const messages = allLoadedMessages[0];
     const userMessages = messages.messages.filter(message => message.payer === globalAccountId);
     let lastValidMessage = null;
     for (let i = userMessages.length - 1; i >= 0; i--) {
       if (userMessages[i] && userMessages[i].loadColumnChatBlocks) {
         lastValidMessage = userMessages[i];
         break; // Stop at the first valid message
       }
     }
     if (lastValidMessage) {
       document.getElementById("load-blocks-from-ids").value = lastValidMessage.loadColumnChatBlocks;
     } else {
       console.log("No valid user message found with loadColumnChatBlocks");
     }
     console.log("messagesObject", messages);
   } catch (error) {
     console.error("Error loading filters from users:", error);
   }
 });
 
 document.getElementById("post-msg").addEventListener("click", async () => {
 try {
   const newMessage = document.getElementById("user-write-message").value;
 
 let userInput = document.getElementById("topic-chat-topic-id").value.toLowerCase();
 let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
 let topicId;
 
 if (domainEntry && domainEntry.lastMessage) {
   topicId = domainEntry.lastMessage.topic;
 } else {
   topicId = userInput;
 }
 
   const meesageobject = {
     userMessage: newMessage
   };
 
   const meesage = JSON.stringify(meesageobject);
   const reciept = await sendMessage(topicId, meesage);
 
 } catch (error) {
   console.error("Error setting rules:", error);
 }
 });
 
 document.getElementById("submit-button-Set_Rules").addEventListener("click", async () => {
             try {
               let userInput = document.getElementById("input-field-topic-id-for-rules").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
               const polygonTopicId = document.getElementById("input-field-topic-id-for-polygons").value;
               const markerTopicId = document.getElementById("input-field-topic-id-for-markers").value;
               const messagesPerNftPolygon = document.getElementById("input-field-messages-per-nft-for-polygons").value;
               const messagesPerNftMarker = document.getElementById("input-field-messages-per-nft-for-markers").value;
               const SizeForPolygons = document.getElementById("input-field-messages-size-for-polygons").value;
 
               const meesageobject = {
                 rules : {
                   forpolygon: {
                     polygonTopicId: polygonTopicId,
                     polygonMessagesPerNft: messagesPerNftPolygon,
                     polygonSize: SizeForPolygons
                   },
                   formarker: {
                     markerTopicId: markerTopicId,
                     markerMessagesPerNft: messagesPerNftMarker
                   }
               }};
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("load-topic-rules-for-topic").addEventListener("click", async () => {
     try {
         let userInput = document.getElementById("input-field-topic-id-for-rules").value.toLowerCase();
         let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
         let topicId;
 
         if (domainEntry && domainEntry.lastMessage) {
             topicId = domainEntry.lastMessage.topic;
         } else {
             topicId = userInput;
         }
 
 
             const messagesContainer = document.getElementById('loaded-topic-rules-for-topic');
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
         let lastRule = null;
 
 
 
         // Read rules from messages in reverse order
         for (let index = messages.length - 1; index >= 0; index--) {
             const message = messages[index];
             try {
                 let parsedMessage = message;
                 if (typeof message === 'string') {
                     parsedMessage = JSON.parse(message);
                 }
                 if (parsedMessage.rules && topicAdmin.includes(message.payer)) {
                     lastRule = parsedMessage.rules;
                     break; // Exit the loop after finding the last message with rules
                 }
 
             } catch (messageError) {
                 console.error(`Error processing message ${index}:`, messageError);
             }
         }
 
       let formattedRules = '';
       if (lastRule) {
         if (lastRule.forpolygon) {
           const polygonSize = lastRule.forpolygon.polygonSize;
           const maxLongitudeSize = 360 / polygonSize;
           const maxLatitudeSize = 180 / polygonSize;
           formattedRules +=
             `<span style="user-select: text;">Polygon NFT ID: ${lastRule.forpolygon.polygonTopicId}</span><br>
             <span style="user-select: text;">Polygon Messages Per NFT: ${lastRule.forpolygon.polygonMessagesPerNft}</span><br>
             <span style="user-select: text;">Maximum distance between points is:</span> <br>
             <span style="user-select: text;">Polygon Size: ${polygonSize}</span><br>
             <span style="user-select: text;">360/${polygonSize} = ${maxLongitudeSize} for longitude</span><br>
             <span style="user-select: text;">180/${polygonSize} = ${maxLatitudeSize} for latitude.</span><br>`;
           hasRules = true;
           }
 
         if (lastRule.formarker ) {
           formattedRules +=
             `<span style="user-select: text;">Marker NFT ID: ${lastRule.formarker.markerTopicId}</span><br>
             <span style="user-select: text;">Marker Messages Per NFT: ${lastRule.formarker.markerMessagesPerNft}</span>`;
           hasRules = true;
         }
       }
 
                       // Check if messages exist and is an array
         if (hasRules===false) {
           const noRulesMessage = `<span style="padding-top: 1vh;">No rules for this topic.</span>`;
           messagesContainer.innerHTML = noRulesMessage;
           adjustTextareaHeight(messagesContainer);
           return;
         }
 
                       // Log the formatted rules onto the textarea
                       messagesContainer.innerHTML = formattedRules;
                       adjustTextareaHeight(messagesContainer);
 
                   } catch (error) {
                     const messagesContainer = document.getElementById('loaded-topic-rules-for-topic');
                     const invalidTopicIdMessage = `<span style="padding-top: 1vh;">Invalid Topic ID</span>`;
                     messagesContainer.innerHTML = invalidTopicIdMessage;
                     adjustTextareaHeight(messagesContainer);
                       
                   }
 });

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
 
 document.getElementById("button5").addEventListener("click", async () => {
             try {
               const topicId = '0.0.9606779';
               const topic = document.getElementById("Edit_Profile-topic-id").value;
               const domain = document.getElementById("toolbar-input").value.toLowerCase();
 
 
               const meesageobject = {
                 topic : topic,
                 domain : domain
               };
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-add-scale-for-model").addEventListener("click", async () => {
             try {
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
               const stackTopicAddTopicNFT = document.getElementById("input-field-add-remove-NFT-for-model").value;
               const stackTopicAddScale = document.getElementById("input-field-add-remove-scale-for-model").value;
 
 
               const meesageobject = {
                     addScale:{
                       NFT: stackTopicAddTopicNFT,
                       scale: stackTopicAddScale
                     }
               };
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-remove-scale-for-model").addEventListener("click", async () => {
             try {
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
               const stackTopicRemoveTopicNFT = document.getElementById("input-field-add-remove-NFT-for-model").value;
 
               const meesageobject = {
                       removeScale:{
                         NFT: stackTopicRemoveTopicNFT
                       }
               };
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-add-NFT-for-model").addEventListener("click", async () => {
             try {
                 let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
               const stackTopicAddTopicNFT = document.getElementById("input-field-add-remove-NFT-for-model").value;
 
 
               const meesageobject = {
                     addTopicNFT: stackTopicAddTopicNFT
               };
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
           
 document.getElementById("submit-button-remove-NFT-for-model").addEventListener("click", async () => {
             try {
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
               const stackTopicRemoveTopicNFT = document.getElementById("input-field-add-remove-NFT-for-model").value;
 
 
               const meesageobject = {
                   removeTopicNFT: stackTopicRemoveTopicNFT
               };
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-add-topic-chat").addEventListener("click", async () => {
             try {
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
               const stackTopicAddTopicNFT = document.getElementById("input-field-add-remove-topic-chat").value;
 
 
               const meesageobject = {
                     addTopicChatNFT: stackTopicAddTopicNFT
               };
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-remove-topic-chat").addEventListener("click", async () => {
             try {
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
               const stackTopicRemoveTopicNFT = document.getElementById("input-field-add-remove-topic-chat").value;
 
 
               const meesageobject = {
                   removeTopicChatNFT: stackTopicRemoveTopicNFT
               };
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("add-topic-id").addEventListener("click", async () => {
             try {
               let userInput = document.getElementById("stack-topic-ids-topic").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
               const stackTopicAddTopic = document.getElementById("stack-topic-add-remove-topic").value;
 
 
               const meesageobject = {
                   addTopic: {
                     addTopic: stackTopicAddTopic
                   },
               };
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("remove-topic-id").addEventListener("click", async () => {
             try {
               let userInput = document.getElementById("stack-topic-ids-topic").value.toLowerCase();
     let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
     let topicId;
 
     if (domainEntry && domainEntry.lastMessage) {
       topicId = domainEntry.lastMessage.topic;
     } else {
       topicId = userInput;
     }
               const stackTopicRemoveTopic = document.getElementById("stack-topic-add-remove-topic").value;
 
 
               const meesageobject = {
                 removeTopic: {
                   removeTopic: stackTopicRemoveTopic
                 }
               };
 
               const meesage = JSON.stringify(meesageobject);
 
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-Create_Marker").addEventListener("click", async () => {
     try {
       let userInput = document.getElementById("input-field-2-0").value.toLowerCase();
       let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
       let topicId;
 
       if (domainEntry && domainEntry.lastMessage) {
         topicId = domainEntry.lastMessage.topic;
       } else {
         topicId = userInput;
       }
       const title = document.getElementById("input-field-2-1").value;
       const imageurl = document.getElementById("input-field-image-marker").value;
       const coverimage = document.getElementById("input-field-coverimage-marker").value;
       const cleanUrl = imageurl.replace(/\?network=mainnet$/, "");
       const cleanCoverimage = coverimage.replace(/\?network=mainnet$/, "");
       const msg = document.getElementById("input-field-2-2").value;
       const cord = document.getElementById("input-field-2-3").value;
       const numberOfMarker = document.getElementById("input-field-number-of-marker").value;
 
             if (numberOfMarker === "" || !Number.isInteger(Number(numberOfMarker))) {
           alert("Please enter a valid whole number for the Number of Marker.");
           return;
       }
 
       if (!numberOfMarker || !topicId || !cord) {
             alert("Please fill in all required fields: Number of Marker, Topic ID, and Coordinates.");
             return;
           }
 
       const messageObj = {marker: {data: {title: title, image: [cleanUrl], coverimage: [cleanCoverimage], msg: msg, cord: cord, numberOfMarker: numberOfMarker }}};
       const message = JSON.stringify(messageObj);
 
       const receipt = await sendMessage(
         topicId,
         message
       );
       console.log('Receipt:', receipt);
     } catch (error) {
       console.error('Error submitting message:', error);
     }
 });

 document.getElementById("submit-button-Create_encrypted-Marker").addEventListener("click", async () => {
  try {
    let userInput = document.getElementById("input-field-2-0").value.toLowerCase();
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;
    let PublicKey;


    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }

    
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
      console.error("Error getting topic info:", error);
      return;
    }

    const result = await getMessages(topicId);

    const messages = result.messages;

    try {
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index];
          let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;

          if (parsedMessage.publicKey && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            PublicKey = parsePublicKey(parsedMessage.publicKey);
            break;
          }
        
      }
    } catch (error) {
      console.error("Error getting public key:", error);
      return;
    }

    const title = document.getElementById("input-field-2-1").value;
    const imageurl = document.getElementById("input-field-image-marker").value;
    const coverimage = document.getElementById("input-field-coverimage-marker").value;
    const cleanUrl = imageurl.replace(/\?network=mainnet$/, "");
    const cleanCoverimage = coverimage.replace(/\?network=mainnet$/, "");
    const msg = document.getElementById("input-field-2-2").value;
    const cord = document.getElementById("input-field-2-3").value;
    const numberOfMarker = document.getElementById("input-field-number-of-marker").value;

          if (numberOfMarker === "" || !Number.isInteger(Number(numberOfMarker))) {
        alert("Please enter a valid whole number for the Number of Marker.");
        return;
    }

    if (!numberOfMarker || !topicId || !cord) {
          alert("Please fill in all required fields: Number of Marker, Topic ID, and Coordinates.");
          return;
        }

    const messageObj = {marker: {data: {title: title, image: [cleanUrl], coverimage: [cleanCoverimage], msg: msg, cord: cord, numberOfMarker: numberOfMarker }}};
    const messageStringify = JSON.stringify(messageObj);

    console.log(messageStringify)

    const encryptedMessage = await encryptMessage(messageStringify, PublicKey);

    const message = JSON.stringify(encryptedMessage);

    const receipt = await sendMessage(topicId,message);
    console.log('Receipt:', receipt);
  } catch (error) {
    console.error('Error submitting message:', error);
  }
});


 
 document.getElementById("delete-marker-number").addEventListener("click", async () => {
     try {
 
       let userInput = document.getElementById("input-field-2-0").value.toLowerCase();
       let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
       let topicId;
 
       if (domainEntry && domainEntry.lastMessage) {
         topicId = domainEntry.lastMessage.topic;
       } else {
         topicId = userInput;
       }
       const oldMarkerNumber = document.getElementById("input-field-delete-marker-number").value;
 
             if (oldMarkerNumber === "" || !Number.isInteger(Number(oldMarkerNumber))) {
           alert("Please enter a valid whole number for the Number of Marker.");
           return;
       }
 
       if (!oldMarkerNumber || !topicId) {
             alert("Please fill in all required fields: Number of Marker, Topic ID");
             return;
           }
 
       const messageObj = {marker: {data: {deleteMarkerNumber: oldMarkerNumber}}};
       const message = JSON.stringify(messageObj);
 
       const receipt = await sendMessage(
         topicId,
         message
       );
       console.log('Receipt:', receipt);
 
 
     } catch (error) {
       console.error('Error submitting message:', error);
     }
 });
 
 document.getElementById("submit-button-Create_Polygon").addEventListener("click", async () => {
     try {
       let userInput = document.getElementById("input-field-3-0").value.toLowerCase();
       let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
       let topicId;
 
       if (domainEntry && domainEntry.lastMessage) {
         topicId = domainEntry.lastMessage.topic;
       } else {
         topicId = userInput;
       }
       const title = document.getElementById("input-field-3-1").value;
       const msg = document.getElementById("input-field-3-2").value;
       const imageurl = document.getElementById("input-field-image-polygon").value;
       const coverimage = document.getElementById("input-field-coverimage-polygon").value;
       const cord1 = document.getElementById("input-field-3-3").value; // TOP LEFT
       const cord3 = document.getElementById("input-field-3-5").value; // BOTTOM RIGHT
       const numberOfPolygon = document.getElementById("input-field-number-of-polygon").value;
       const cleanUrl = imageurl.replace(/\?network=mainnet$/, "");
       const cleanCoverimage = coverimage.replace(/\?network=mainnet$/, "");
 
             if (numberOfPolygon === "" || !Number.isInteger(Number(numberOfPolygon))) {
           alert("Please enter a valid whole number for the Number of Polygon.");
           return;
       }
 
       if (!numberOfPolygon || !topicId || !cord1 || !cord3) {
             alert("Please fill in all required fields: Number of Polygon, Topic ID, and Coordinates.");
             return; // Stop the submission if any field is empty
           }
 
       // Validate and format the coordinates input
       const Cords = {
         cord1 : cord1.split(',').map(Number), // Convert to array of numbers
         cord3 : cord3.split(',').map(Number),
       };
 
       const formattedCord = [
         Cords.cord1,
         [Cords.cord1[0],Cords.cord3[1]],
         Cords.cord3,
         [Cords.cord3[0],Cords.cord1[1]]
       ];
 
       // Ensure all coordinates are valid numbers
       const isValid = formattedCord.every(cord =>
         Array.isArray(cord) &&
         cord.length === 2 &&
         cord.every(num => !isNaN(num) && isFinite(num))
       );
 
       if (!isValid) {
         throw new Error('Please enter valid coordinates in the format number,number for all four corners.');
       }
 
       // Create the desired coordinate string without additional array wrapping
       const cordString = formattedCord.map(cord => `[${cord.join(',')}]`).join(', '); // Join the valid coordinates
 
       const messageObj = {
         polygon: {
           data: {
             title: title,
             image: [cleanUrl],
             coverimage: [cleanCoverimage],
             msg: msg,
             cord: cordString,
             numberOfPolygon: numberOfPolygon
           }
         }
       };
       const message = JSON.stringify(messageObj);
 
       const receipt = await sendMessage(
         topicId,
         message
       );
       console.log('Receipt:', receipt);
 
     } catch (error) {
       console.error('Error submitting message:', error);
     }
 });

  document.getElementById("submit-button-Create_encrypted-Polygon").addEventListener("click", async () => {
  try {
    let userInput = document.getElementById("input-field-3-0").value.toLowerCase();
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;
    let PublicKey;


    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }

    
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
      console.error("Error getting topic info:", error);
      return;
    }

    const result = await getMessages(topicId);

    const messages = result.messages;

    try {
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index];
          let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;

          if (parsedMessage.publicKey && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            PublicKey = parsePublicKey(parsedMessage.publicKey);
            break;
          }
        
      }
    } catch (error) {
      console.error("Error getting public key:", error);
      return;
    }

    const title = document.getElementById("input-field-3-1").value;
    const msg = document.getElementById("input-field-3-2").value;
    const imageurl = document.getElementById("input-field-image-polygon").value;
    const coverimage = document.getElementById("input-field-coverimage-polygon").value;
    const cord1 = document.getElementById("input-field-3-3").value; // TOP LEFT
    const cord3 = document.getElementById("input-field-3-5").value; // BOTTOM RIGHT
    const numberOfPolygon = document.getElementById("input-field-number-of-polygon").value;
    const cleanUrl = imageurl.replace(/\?network=mainnet$/, "");
    const cleanCoverimage = coverimage.replace(/\?network=mainnet$/, "");

          if (numberOfPolygon === "" || !Number.isInteger(Number(numberOfPolygon))) {
        alert("Please enter a valid whole number for the Number of Polygon.");
        return;
    }

    if (!numberOfPolygon || !topicId || !cord1 || !cord3) {
          alert("Please fill in all required fields: Number of Polygon, Topic ID, and Coordinates.");
          return; // Stop the submission if any field is empty
        }

    // Validate and format the coordinates input
    const Cords = {
      cord1 : cord1.split(',').map(Number), // Convert to array of numbers
      cord3 : cord3.split(',').map(Number),
    };

    const formattedCord = [
      Cords.cord1,
      [Cords.cord1[0],Cords.cord3[1]],
      Cords.cord3,
      [Cords.cord3[0],Cords.cord1[1]]
    ];

    // Ensure all coordinates are valid numbers
    const isValid = formattedCord.every(cord =>
      Array.isArray(cord) &&
      cord.length === 2 &&
      cord.every(num => !isNaN(num) && isFinite(num))
    );

    if (!isValid) {
      throw new Error('Please enter valid coordinates in the format number,number for all four corners.');
    }

    // Create the desired coordinate string without additional array wrapping
    const cordString = formattedCord.map(cord => `[${cord.join(',')}]`).join(', '); // Join the valid coordinates

    const messageObj = {
      polygon: {
        data: {
          title: title,
          image: [cleanUrl],
          coverimage: [cleanCoverimage],
          msg: msg,
          cord: cordString,
          numberOfPolygon: numberOfPolygon
        }
      }
    };

    const messageStringify = JSON.stringify(messageObj);

    console.log(messageStringify)

    const encryptedMessage = await encryptMessage(messageStringify, PublicKey);

    const message = JSON.stringify(encryptedMessage);

    const receipt = await sendMessage(topicId,message);
    console.log('Receipt:', receipt);
  } catch (error) {
    console.error('Error submitting message:', error);
  }
});
 
 document.getElementById("delete-polygon-number").addEventListener("click", async () => {
     try {
       let userInput = document.getElementById("input-field-3-0").value.toLowerCase();
       let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
       let topicId;
 
       if (domainEntry && domainEntry.lastMessage) {
         topicId = domainEntry.lastMessage.topic;
       } else {
         topicId = userInput;
       }
       const oldPolygonNumber = document.getElementById("input-field-delete-polygon-number").value;
 
             if (oldPolygonNumber === "" || !Number.isInteger(Number(oldPolygonNumber))) {
           alert("Please enter a valid whole number for the Number of Polygon.");
           return;
       }
 
       if (!oldPolygonNumber || !topicId) {
             alert("Please fill in all required fields: Number of Polygon, Topic ID");
             return;
           }
 
       const messageObj = {polygon: {data: {deletePolygonNumber: oldPolygonNumber}}};
       const message = JSON.stringify(messageObj);
 
       const receipt = await sendMessage(
         topicId,
         message
       );
       console.log('Receipt:', receipt);
 
 
     } catch (error) {
       console.error('Error submitting message:', error);
     }
 });
 
 document.getElementById("button1").addEventListener("click", async (event) => {
         event.stopPropagation();
         const inputValue = document.getElementById("toolbar-input").value;
 
         try {
           const topicId = "0.0.9609881";
           const cleanUrl = inputValue.replace(/\?network=mainnet$/, "");
 
           const messageData = {
             data: {
               urls: [cleanUrl],
             },
           };
           const message = JSON.stringify(messageData);
 
           const receipt = await sendMessage(
             topicId,
             message
           );
           console.log("Profile picture updated successfully:", receipt);
 
           document.getElementById("toolbar-input").value = "";
 
           debounce(loadAllData(), 10000);
 
         } catch (error) {
           console.error("Error updating profile picture:", error);
           // Removed alert
         }
 });
 
 document.getElementById("button2").addEventListener("click", async (event) => {
   event.stopPropagation();
   const inputValue = document.getElementById("toolbar-input").value;
 
   // Check if inputValue has less than 20 characters
   if (inputValue.length >= 20) {
     console.error("Input must be less than 20 characters");
     return; // Exit the function if the input is too long
   }
 
   try {
     const topicId = "0.0.9609904";
 
     const messageData = {
       data: {
         username: inputValue,
       },
     };
     const message = JSON.stringify(messageData);
 
     const receipt = await sendMessage(topicId, message);
     console.log("Username updated successfully:", receipt);
 
     document.getElementById("toolbar-input").value = "";
 
     debounce(loadAllData(), 10000);
 
   } catch (error) {
     console.error("Error updating username:", error);
   }
 });
 
 document.getElementById("button_for_click_url").addEventListener("click", async (event) => {
         event.stopPropagation();
         const inputValue = document.getElementById("toolbar-input").value;
 
         try {
           const topicId = "0.0.9752486";
           const cleanUrl = inputValue.replace(/\?network=mainnet$/, "");
 
           const messageData = {
             data: {
               click2url: [cleanUrl],
             },
           };
           const message = JSON.stringify(messageData);
 
           const receipt = await sendMessage(
             topicId,
             message
           );
           console.log("Profile CLICK2URL updated successfully:", receipt);
 
           document.getElementById("toolbar-input").value = "";
 
           debounce(loadAllData(), 10000);
 
         } catch (error) {
           console.error("Error updating profile CLICK2URL:", error);
           // Removed alert
         }
 });
 
 document.getElementById("button_for_topic2pic").addEventListener("click", async (event) => {
   event.stopPropagation();
   const inputValue = document.getElementById("Edit_Profile-topic-id").value;
   if (inputValue.length >= 20) {
     console.error("Input must be less than 20 characters");
     return;
   }
   try {
     const topicId = "0.0.9759201";
     const messageData = {
       data: {
         topic2pic: [inputValue],
       },
     };
     const message = JSON.stringify(messageData);
     const receipt = await sendMessage(
       topicId,
       message
     );
     console.log("Profile TOPIC2PIC updated successfully:", receipt);
     document.getElementById("Edit_Profile-topic-id").value = "";
 
     debounce(loadAllData(), 10000);
 
   } catch (error) {
     console.error("Error updating profile TOPIC2PIC:", error);
   }
 });
 
 document.getElementById("load-topic-rules-for-marker").addEventListener("click", async () => {
     try {
       let userInput = document.getElementById("input-field-2-0").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
 
               const messagesContainer = document.getElementById('loaded-topic-rules-for-marker');
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
       let hasRules = false;
       const memo = topicInfo.memo;
 
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
 
       const loadedTopicRulesForMarker = [];
 
       // Read rules from messages
       for (let index = messages.length - 1; index >= 0; index--) {
         const message = messages[index];
         try {
           let parsedMessage = message;
           if (typeof message === 'string') {
             parsedMessage = JSON.parse(message);
           }
           if (parsedMessage.rules && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
             loadedTopicRulesForMarker.push(parsedMessage.rules.formarker);
             hasRules = true;
             break; // Exit the loop after finding the last message with rules
           }
         } catch (messageError) {
           console.error(`Error processing message ${index}:`, messageError);
         }
       }
 
         if (hasRules===false) {
           const utilityRulesMessage = `<span>No rules for this topic.</span>`;
           messagesContainer.innerHTML = utilityRulesMessage;
           adjustTextareaHeight(messagesContainer);
           return;
       }
 
 
 
   const markerRulesMessage = `<span style="user-select: text;">To post markers, you must own NFT.<br>
     NFT = ${loadedTopicRulesForMarker[0].markerTopicId}.<br>
     Each NFT allows posting ${loadedTopicRulesForMarker[0].markerMessagesPerNft} markers.</span>`;
   messagesContainer.innerHTML = markerRulesMessage;
   adjustTextareaHeight(messagesContainer);
 
 
 
     } catch (error) {
         const messagesContainer = document.getElementById('loaded-topic-rules-for-marker');
         const invalidTopicIdMessage = `<span style="padding-top: 1vh;">Invalid Topic ID</span>`;
         messagesContainer.innerHTML = invalidTopicIdMessage;
         adjustTextareaHeight(messagesContainer);
     }
 });
 
 document.getElementById("load-topic-rules-for-polygon").addEventListener("click", async () => {
     try {
       let userInput = document.getElementById("input-field-3-0").value.toLowerCase();
               let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
               let topicId;
 
               if (domainEntry && domainEntry.lastMessage) {
                 topicId = domainEntry.lastMessage.topic;
               } else {
                 topicId = userInput;
               }
 
               const messagesContainer = document.getElementById('loaded-topic-rules-for-polygon');
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
       let hasRules = false;
       const memo = topicInfo.memo;
 
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
 
       const loadedTopicRulesForPolygon = [];
 
       // Read rules from messages
       for (let index = messages.length - 1; index >= 0; index--) {
         const message = messages[index];
         try {
           let parsedMessage = message;
           if (typeof message === 'string') {
             parsedMessage = JSON.parse(message);
           }
           if (parsedMessage.rules && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
             loadedTopicRulesForPolygon.push(parsedMessage.rules.forpolygon);
             hasRules = true;
             break; // Exit the loop after finding the last message with rules
           }
         } catch (messageError) {
           console.error(`Error processing message ${index}:`, messageError);
         }
       }
 
         if (hasRules===false) {
           const utilityRulesMessage = `<span>No rules for this topic.</span>`;
           messagesContainer.innerHTML = utilityRulesMessage;
           adjustTextareaHeight(messagesContainer);
           return;
       }
 
 
 
 const polygonRulesMessage = `<span style="user-select: text;">To post polygons, you must own NFT.<br>
   NFT = ${loadedTopicRulesForPolygon[0].polygonTopicId}.<br>
   Each NFT allows posting ${loadedTopicRulesForPolygon[0].polygonMessagesPerNft} polygons.<br></span>`;
 
 const polygonSize = loadedTopicRulesForPolygon[0].polygonSize;
 const maxLongitudeSize = 360 / polygonSize;
 const maxLatitudeSize = 180 / polygonSize;
 
 const polygonRulesMessages = `<span style="user-select: text;">Maximum distance between points is:<br>
    ${maxLongitudeSize} for longitude<br>
    ${maxLatitudeSize} for latitude.<br>
    If not = wont load.</span>`;
 
   messagesContainer.innerHTML = polygonRulesMessage + polygonRulesMessages;
   adjustTextareaHeight(messagesContainer);
 
 
 
     } catch (error) {
       const messagesContainer = document.getElementById('loaded-topic-rules-for-polygon');
         const invalidTopicIdMessage = `<span style="padding-top: 1vh;">Invalid Topic ID</span>`;
         messagesContainer.innerHTML = invalidTopicIdMessage;
         adjustTextareaHeight(messagesContainer);    }
 });
 
 