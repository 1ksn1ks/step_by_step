import {
  getTopicInfo,
    generatePrivateAndPublicKey,
     createTopic,
      updateTopic} from './hedera'
import { sendMessage, reportMarker } from './msgbackend'
import { getTopicData as getMessages } from './topicdata'
import {adjustTextareaHeight} from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { loadAllData, showOwnProfile } from './loadalladata';
import { debounce } from './debounce';
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage, encryptWithPassword, decryptWithPassword } from './sodium' 
import { allLoadedMessages } from './processallmessages';
import { handleAllMessages } from './handleallmessages';
import { connectedAccount, signer } from './web3';
import { PrivateKey } from '@hashgraph/sdk';
import { isValidUrl } from './ISVALIDURL.JS';
import { toast } from './toast';
import { nextDrawNumber } from './nextdrawnumber.js';
import { initialTopicId } from './extracttopic.js';
import { openDrawDatePicker, refreshFilterTimeButtons } from './drawdate.js';
import { pendingChatImage, chatImageBusy, clearPendingChatImage } from './chatimage.js';
import { stackedTopicRules } from './topicrules.js';
import { adminsFromMemo, currentTopicBio, currentTopicName, currentStackedTopics, currentInitialXYZ } from './loadcurrenttopic.js';




document.getElementById("submit-button-Create_New_Topic").addEventListener("click", async () => {
   try {
     if (!signer) {
       toast.error("Connect wallet first");
       return;
     }
     const memo = document.getElementById("input-field-5-1").value || 'this is memo';
     const adminKey = document.getElementById("input-field-5-2").value;

     if (adminKey) {
       try {
         PrivateKey.fromStringED25519(adminKey);
       } catch (keyError) {
         toast.error("Please enter a valid admin private key.");
         return;
       }
     }
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
 
 async function loadCurrentMemo(topicInputId, boxId, fieldId) {
   const messagesContainer = document.getElementById(boxId);
   try {
     const userInput = document.getElementById(topicInputId).value.trim().toLowerCase();
     if (!userInput) {
       toast.error("Please enter a Topic ID or domain.");
       return;
     }
     const domainEntry = loadedDomains.find(entry => entry.domain === userInput);
     const topicId = (domainEntry && domainEntry.lastMessage)
       ? domainEntry.lastMessage.topic
       : userInput;

     messagesContainer.innerHTML = `
     <div style="display: flex; justify-content: left; align-items: left; padding-top: 1vh; padding-bottom: 1vh;">
       <div id="topicspinnerchat"></div>
       <span style="margin-left: 0.45vh;">loading memo from ${topicId}</span>
     </div>`;
     adjustTextareaHeight(messagesContainer);

     const topicInfo = await getTopicInfo(topicId);
     if (!topicInfo) {
       messagesContainer.textContent = "Invalid Topic ID";
       adjustTextareaHeight(messagesContainer);
       return;
     }
     const memo = topicInfo.memo || "";
     messagesContainer.textContent = memo || "No memo for this topic.";
     const memoField = document.getElementById(fieldId);
     memoField.value = memo;
     memoField.style.height = "";
     memoField.style.height = memoField.scrollHeight + "px";
     adjustTextareaHeight(messagesContainer);
   } catch (error) {
     console.error("Error loading memo:", error);
     messagesContainer.textContent = "Invalid Topic ID";
     adjustTextareaHeight(messagesContainer);
   }
 }

 document.getElementById("load-memo-for-topic").addEventListener("click", () => {
   loadCurrentMemo("input-field-topic-id", "loaded-memo-for-topic", "input-field-memo");
 });

 document.getElementById("load-memo-for-fee").addEventListener("click", () => {
   loadCurrentMemo("input-field-topic-id-fee", "loaded-memo-for-fee", "input-field-memo-fee");
 });

 function fillGrownField(fieldId, value) {
   const field = document.getElementById(fieldId);
   if (!field) return;
   field.value = value;
   field.style.height = "";
   field.style.height = field.scrollHeight + "px";
 }

 // Same load as memo: resolve the topic, show the current value, and drop it
 // into the field so it can be edited and sent again.
 async function loadTopicRecord(topicInputId, boxId, label) {
   const box = document.getElementById(boxId);
   try {
     const userInput = document.getElementById(topicInputId).value.trim().toLowerCase();
     if (!userInput) {
       toast.error("Please enter a Topic ID or domain.");
       return null;
     }
     const domainEntry = loadedDomains.find(entry => entry.domain === userInput);
     const topicId = (domainEntry && domainEntry.lastMessage)
       ? domainEntry.lastMessage.topic
       : userInput;

     const safeTopicId = String(topicId).replace(/[&<>"']/g, (ch) => ({
       '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
     }[ch]));
     box.innerHTML = `
     <div style="display: flex; justify-content: left; align-items: left; padding-top: 1vh; padding-bottom: 1vh;">
       <div id="topicspinnerchat"></div>
       <span style="margin-left: 0.45vh;">loading ${label} from ${safeTopicId}</span>
     </div>`;
     adjustTextareaHeight(box);

     const topicInfo = await getTopicInfo(topicId);
     if (!topicInfo) {
       box.textContent = "Invalid Topic ID";
       adjustTextareaHeight(box);
       return null;
     }
     const result = await getMessages(topicId, { force: true });
     const messages = result && Array.isArray(result.messages) ? result.messages : [];
     return { messages, topicAdmin: adminsFromMemo(topicInfo.memo), box };
   } catch (error) {
     console.error(`Error loading ${label}:`, error);
     box.textContent = "Invalid Topic ID";
     adjustTextareaHeight(box);
     return null;
   }
 }

 document.getElementById("load-bio-for-topic").addEventListener("click", async () => {
   const loaded = await loadTopicRecord("input-field-topic-id-bio", "loaded-bio-for-topic", "bio");
   if (!loaded) return;
   const bio = currentTopicBio(loaded.messages, loaded.topicAdmin);
   loaded.box.textContent = bio || "No bio for this topic.";
   adjustTextareaHeight(loaded.box);
   fillGrownField("topic-bio-input", bio);
   const counter = document.getElementById("char-counter-topic-bio");
   if (counter) counter.textContent = `${bio.length}/256`;
 });

 document.getElementById("load-name-for-topic").addEventListener("click", async () => {
   const loaded = await loadTopicRecord("input-field-topic-id-name", "loaded-name-for-topic", "name");
   if (!loaded) return;
   const name = currentTopicName(loaded.messages, loaded.topicAdmin);
   loaded.box.textContent = name || "No name for this topic.";
   adjustTextareaHeight(loaded.box);
   fillGrownField("input-field-topic-name", name);
 });

 document.getElementById("load-stack-for-topic").addEventListener("click", async () => {
   const loaded = await loadTopicRecord("stack-topic-ids-topic", "loaded-stack-for-topic", "topics");
   if (!loaded) return;
   const ids = currentStackedTopics(loaded.messages, loaded.topicAdmin);
   loaded.box.textContent = ids.length ? ids.join("\n") : "No stacked topics.";
   adjustTextareaHeight(loaded.box);
   fillGrownField("stack-topic-add-remove-topic", ids.join(","));
 });

 document.getElementById("load-xyz-for-topic").addEventListener("click", async () => {
   const loaded = await loadTopicRecord("input-field-topic-id-for-initial-xyz", "loaded-xyz-for-topic", "view");
   if (!loaded) return;
   const view = currentInitialXYZ(loaded.messages, loaded.topicAdmin);
   if (!view) {
     loaded.box.textContent = "No saved view for this topic.";
     fillGrownField("input-field-lng-lat-for-initial-xyz", "");
     fillGrownField("input-field-zoom-for-initial-xyz", "");
   } else {
     const coords = `${view.lng},${view.lat}`;
     loaded.box.textContent = `${coords} zoom ${view.zoom}`;
     fillGrownField("input-field-lng-lat-for-initial-xyz", coords);
     fillGrownField("input-field-zoom-for-initial-xyz", String(view.zoom));
   }
   adjustTextareaHeight(loaded.box);
 });

 document.getElementById("submit-button-Change_Memo").addEventListener("click", async () => {
   try {
     if (!signer) {
       toast.error("Connect wallet first");
       return;
     }
     let userInput = document.getElementById("input-field-topic-id").value.toLowerCase();
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
     const memo =document.getElementById("input-field-memo").value || '';
     let adminKey = document.getElementById("input-field-admin-key").value;

     if (adminKey) {
       try {
         PrivateKey.fromStringED25519(adminKey);
       } catch (keyError) {
         toast.error("Please enter a valid admin private key.");
         return;
       }
     }

     await updateTopic({topicId:topicId , memo:memo, adminKey:adminKey});

   } catch (error) {
   console.error("Error creating topic:", error);
   }
 });

 document.getElementById("submit-button-Change_Fee").addEventListener("click", async () => {
   try {
     if (!signer) {
       toast.error("Connect wallet first");
       return;
     }
     let userInput = document.getElementById("input-field-topic-id-fee").value.toLowerCase();
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
     const memo = document.getElementById("input-field-memo-fee").value || '';
     let adminKey = document.getElementById("input-field-admin-key-fee").value;
     const realfee = document.getElementById("input-field-fee").value;
     const tokenId = document.getElementById("input-field-fee-token").value;
     const royaltyAccount = document.getElementById("input-field-royal-acc").value;

     if (adminKey) {
       try {
         PrivateKey.fromStringED25519(adminKey);
       } catch (keyError) {
         toast.error("Please enter a valid admin private key.");
         return;
       }
     }
     if (!realfee || !tokenId || !royaltyAccount) {
       toast.error("Fee, Token ID, and Royalty Account must all be filled in.");
       return;
     }
     if (isNaN(Number(realfee))) {
       toast.error("Please enter a valid number for the fee.");
       return;
     }

     const fee = realfee * 1000000

     const customFees = [{
       denominatingTokenId: tokenId,
       amount: fee,
       collectorAccountId: royaltyAccount
     }];

     await updateTopic({topicId:topicId , memo:memo, adminKey:adminKey, customFees:customFees});

   } catch (error) {
   console.error("Error updating topic fee:", error);
   }
 });
 
 document.getElementById("button3").addEventListener("click", async () => {
 try {
   if (!signer) {
     toast.error("Connect wallet first");
     return;
   }
   let userInput = document.getElementById("input-field-topic-id-name").value.toLowerCase();
   const newName = document.getElementById("input-field-topic-name").value;

   if (!newName) {
     toast.error("Please enter a new name.");
     return;
   }

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
 
   const meesageobject = {
     changeName: newName
   };
 
   const meesage = JSON.stringify(meesageobject);
   toast.info("Confirm in wallet 👛");
   const reciept = await sendMessage(topicId, meesage);
 
 } catch (error) {
   console.error("Error setting rules:", error);
 }
 });
 
 document.getElementById("save-filters-from-users").addEventListener("click", async () => {
   try {
     if (!signer) {
       toast.error("Connect wallet first");
       return;
     }
     let userInput = document.getElementById("input-field").value;
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

     const loadColumnsFromUsers = document.getElementById("load-msgs-from-ids").value;
     if (!loadColumnsFromUsers) {
       toast.error("Please enter the account IDs to load.");
       return;
     }
     console.log("loadColumnsFromUsers", loadColumnsFromUsers);
     const meesageobject = {
       loadColumnsFromUsers: loadColumnsFromUsers
     };
     const meesage = JSON.stringify(meesageobject);
     toast.info("Confirm in wallet 👛");
     const reciept = await sendMessage(topicId, meesage);
   } catch (error) {
     console.error("Error loading filters from users:", error);
   }
 });
 
 document.getElementById("save-time-from-users-load-column").addEventListener("click", async () => {
   try {
     if (!signer) {
       toast.error("Connect wallet first");
       return;
     }
     let userInput = document.getElementById("input-field").value;
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
     toast.info("Confirm in wallet 👛");
     const reciept = await sendMessage(topicId, meesage);
   } catch (error) {
     console.error("Error loading filters from users:", error);
   }
 });
 
 document.getElementById("load-filters-from-users").addEventListener("click", async () => {
   try {
     const messages = allLoadedMessages[0];
     const userMessages = messages.messages.filter(message => message.payer === connectedAccount);
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
     const userMessages = messages.messages.filter(message => message.payer === connectedAccount);
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
       refreshFilterTimeButtons();
     } else {
       console.log("No valid user message found with loadTimeFromUsersLoadColumn");
     }
   } catch (error) {
     console.error("Error loading time from users load column:", error);
   }
 });
 
 document.getElementById("save-blocks-from-users").addEventListener("click", async () => {
   try {
     if (!signer) {
       toast.error("Connect wallet first");
       return;
     }
     let userInput = document.getElementById("input-field").value;
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
     const loadColumnChatBlocks = document.getElementById("load-blocks-from-ids").value;
     if (!loadColumnChatBlocks) {
       toast.error("Please enter the account IDs to block.");
       return;
     }
       console.log("loadColumnChatBlocks", loadColumnChatBlocks);
     const meesageobject = {
       loadColumnChatBlocks: loadColumnChatBlocks
     };
     const meesage = JSON.stringify(meesageobject);
     toast.info("Confirm in wallet 👛");
     const reciept = await sendMessage(topicId, meesage);
   } catch (error) {
     console.error("Error loading filters from users:", error);
   }
 });
 
 document.getElementById("load-blocks-from-users").addEventListener("click", async () => {
   try {
     const messages = allLoadedMessages[0];
     const userMessages = messages.messages.filter(message => message.payer === connectedAccount);
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
   if (!signer) {
     toast.error("Connect wallet first");
     return;
   }
   const newMessage = document.getElementById("user-write-message").value;
   if (chatImageBusy("topic")) {
     toast.error("Wait for the image to finish uploading");
     return;
   }
   const image = pendingChatImage("topic");

   if (!newMessage && !image) {
     toast.error("Please enter a message.");
     return;
   }

 let userInput = document.getElementById("topic-chat-topic-id").value.toLowerCase();
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
 
   const meesageobject = {
     userMessage: newMessage
   };
   if (image) meesageobject.image = image;
 
   const meesage = JSON.stringify(meesageobject);
   toast.info("Confirm in wallet 👛");
   const reciept = await sendMessage(topicId, meesage);
   if (image) clearPendingChatImage("topic");
 
 } catch (error) {
   console.error("Error setting rules:", error);
 }
 });
 
 function utilityTopicId() {
   const userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
   const domainEntry = loadedDomains.find(entry => entry.domain === userInput);
   if (domainEntry && domainEntry.lastMessage) {
     return domainEntry.lastMessage.topic;
   }
   return userInput;
 }

 async function sendUtilityRules(rules, topicId = utilityTopicId()) {
   if (!signer) {
     toast.error("Connect wallet first");
     return false;
   }
   if (!topicId) {
     toast.error("Please enter a Topic ID or domain.");
     return false;
   }
   toast.info("Confirm in wallet 👛");
   const reciept = await sendMessage(topicId, JSON.stringify({ rules }));
   console.log("Reciept is", reciept);
   return true;
 }

 function appendStaticRule(container, text) {
   const line = document.createElement('div');
   line.style.userSelect = 'text';
   line.textContent = text;
   container.appendChild(line);
 }

 function appendRemovableRule(container, text, side, nftId, extraLines = []) {
   const row = document.createElement('div');
   row.className = 'topic-rule-row';
   row.dataset.side = side;
   const label = document.createElement('span');
   label.textContent = text;
   const button = document.createElement('button');
   button.type = 'button';
   button.className = 'topic-rule-remove';
   button.dataset.side = side;
   button.dataset.nftId = nftId;
   button.textContent = '×';
   button.setAttribute('aria-label', `Remove ${nftId}`);
   row.appendChild(label);
   row.appendChild(button);
   if (!extraLines.length) {
     container.appendChild(row);
     return;
   }
   const block = document.createElement('div');
   block.className = 'topic-rule-block';
   block.dataset.side = side;
   block.appendChild(row);
   for (const extra of extraLines) appendStaticRule(block, extra);
   container.appendChild(block);
 }

 function bindLoadedRuleRemove(container) {
   container.addEventListener('click', async (event) => {
     const button = event.target.closest('.topic-rule-remove');
     if (!button || !container.contains(button)) return;
     event.stopPropagation();
     const nftId = button.dataset.nftId;
     const side = button.dataset.side;
     const topicId = container.dataset.loadedTopicId;
     if (!nftId || !topicId) return;
     const rules = side === 'polygon'
       ? { forpolygon: { remove: true, polygonTopicId: nftId } }
       : { formarker: { remove: true, markerTopicId: nftId } };
     try {
       const sent = await sendUtilityRules(rules, topicId);
       if (!sent) return;
       const block = button.closest('.topic-rule-block') || button.closest('.topic-rule-row');
       if (block) block.remove();
       if (!container.querySelector(`.topic-rule-row[data-side="${side}"]`)) {
         appendStaticRule(container, side === 'polygon' ? 'Polygon NFT: none' : 'Marker NFT: none');
       }
       adjustTextareaHeight(container);
     } catch (error) {
       console.error('Error removing loaded rule:', error);
     }
   });
 }

 bindLoadedRuleRemove(document.getElementById('loaded-topic-rules-for-utility'));
 bindLoadedRuleRemove(document.getElementById('loaded-topic-rules-for-marker'));
 bindLoadedRuleRemove(document.getElementById('loaded-topic-rules-for-polygon'));

 document.getElementById("submit-button-add-rules-for-markers").addEventListener("click", async () => {
   try {
     const markerTopicId = document.getElementById("input-field-topic-id-for-markers").value.trim();
     const messagesPerNftMarker = document.getElementById("input-field-messages-per-nft-for-markers").value.trim();
     if (!markerTopicId || !messagesPerNftMarker) {
       toast.error("Please fill in the Marker NFT and how many markers per NFT.");
       return;
     }
     if (!Number.isInteger(Number(messagesPerNftMarker))) {
       toast.error("Please enter a valid number for how many markers per NFT.");
       return;
     }
     await sendUtilityRules({
       formarker: {
         add: true,
         markerTopicId: markerTopicId,
         markerMessagesPerNft: messagesPerNftMarker
       }
     });
   } catch (error) {
     console.error("Error setting marker rules:", error);
   }
 });

 document.getElementById("submit-button-remove-rules-for-markers").addEventListener("click", async () => {
   try {
     const markerTopicId = document.getElementById("input-field-topic-id-for-markers").value.trim();
     if (!markerTopicId) {
       toast.error("Type the NFT ID of the marker rule to remove.");
       return;
     }
     await sendUtilityRules({
       formarker: { remove: true, markerTopicId: markerTopicId }
     });
   } catch (error) {
     console.error("Error removing marker rules:", error);
   }
 });

 document.getElementById("submit-button-add-rules-for-polygons").addEventListener("click", async () => {
   try {
     const polygonTopicId = document.getElementById("input-field-topic-id-for-polygons").value.trim();
     const messagesPerNftPolygon = document.getElementById("input-field-messages-per-nft-for-polygons").value.trim();
     const sizeForPolygons = document.getElementById("input-field-messages-size-for-polygons").value.trim();
     if (!polygonTopicId || !messagesPerNftPolygon || !sizeForPolygons) {
       toast.error("Please fill in the Polygon NFT, how many polygons per NFT, and the polygon size.");
       return;
     }
     if (!Number.isInteger(Number(messagesPerNftPolygon)) || isNaN(Number(sizeForPolygons))) {
       toast.error("Please enter valid numbers for how many polygons per NFT and the polygon size.");
       return;
     }
     await sendUtilityRules({
       forpolygon: {
         add: true,
         polygonTopicId: polygonTopicId,
         polygonMessagesPerNft: messagesPerNftPolygon,
         polygonSize: sizeForPolygons
       }
     });
   } catch (error) {
     console.error("Error setting polygon rules:", error);
   }
 });

 document.getElementById("submit-button-remove-rules-for-polygons").addEventListener("click", async () => {
   try {
     const polygonTopicId = document.getElementById("input-field-topic-id-for-polygons").value.trim();
     if (!polygonTopicId) {
       toast.error("Type the NFT ID of the polygon rule to remove.");
       return;
     }
     await sendUtilityRules({
       forpolygon: { remove: true, polygonTopicId: polygonTopicId }
     });
   } catch (error) {
     console.error("Error removing polygon rules:", error);
   }
 });

document.getElementById("load-topic-rules-for-utility").addEventListener("click", async () => {
  try {
    let userInput = document.getElementById("input-field-topic-id-for-utility").value.trim().toLowerCase();
    if (!userInput) {
      toast.error("Please enter a Topic ID or domain.");
      return;
    }
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
    <span style="margin-left: 0.45vh;">loading messages from ${topicId}</span>
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

    const { markers, polygons } = stackedTopicRules(messages, topicAdmin);
    messagesContainer.innerHTML = '';
    messagesContainer.dataset.loadedTopicId = topicId;

    if (loadedNFTsForModel.length > 0) {
      appendStaticRule(messagesContainer, `NFTs for model: ${loadedNFTsForModel.join(', ')}`);
    }
    if (loadedNFTScaleForModel.length > 0) {
      appendStaticRule(messagesContainer, `Scales for model: ${loadedNFTScaleForModel.map(item => `${item.NFT} = ${item.scale}`).join(', ')}`);
    }
    if (loadedNFTsForTopicChat.length > 0) {
      appendStaticRule(messagesContainer, `NFTs for topic chat: ${loadedNFTsForTopicChat.join(', ')}`);
    }
    if (markers.length === 0) {
      appendStaticRule(messagesContainer, 'Marker NFT: none');
    }
    for (const marker of markers) {
      if (marker.open) {
        appendRemovableRule(messagesContainer, 'Marker NFT: anyone can post', 'marker', marker.id);
      } else {
        appendRemovableRule(messagesContainer, `Marker NFT: ${marker.markerTopicId} (${marker.markerMessagesPerNft} per NFT)`, 'marker', marker.markerTopicId);
      }
    }
    if (polygons.length === 0) {
      appendStaticRule(messagesContainer, 'Polygon NFT: none');
    }
    for (const polygon of polygons) {
      if (polygon.open) {
        appendRemovableRule(messagesContainer, 'Polygon NFT: anyone can post', 'polygon', polygon.id);
        continue;
      }
      const polygonSize = polygon.polygonSize;
      const maxLongitudeSize = 360 / polygonSize;
      const maxLatitudeSize = 180 / polygonSize;
      appendRemovableRule(
        messagesContainer,
        `Polygon NFT: ${polygon.polygonTopicId} (${polygon.polygonMessagesPerNft} per NFT, size ${polygonSize})`,
        'polygon',
        polygon.polygonTopicId,
        [
          `360/${polygonSize} = ${maxLongitudeSize} for longitude`,
          `180/${polygonSize} = ${maxLatitudeSize} for latitude`,
        ]
      );
    }

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
               if (!signer) {
                 toast.error("Connect wallet first");
                 return;
               }
               const topicId = '0.0.9606779';
               const topic = document.getElementById("domain-topic-id").value;
               const domain = document.getElementById("domain-name-input").value.toLowerCase();

               if (!topic || !domain) {
                 toast.error("Please fill in both the Topic ID and the Domain.");
                 return;
               }
 
 
               const meesageobject = {
                 topic : topic,
                 domain : domain
               };
 
               const meesage = JSON.stringify(meesageobject);

               toast.info("Confirm in wallet 👛");
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-add-scale-for-model").addEventListener("click", async () => {
             try {
               if (!signer) {
                 toast.error("Connect wallet first");
                 return;
               }
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
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
               const stackTopicAddTopicNFT = document.getElementById("input-field-add-remove-NFT-for-model").value;
               const stackTopicAddScale = document.getElementById("input-field-add-remove-scale-for-model").value;

               if (!stackTopicAddTopicNFT || !stackTopicAddScale) {
                 toast.error("Please fill in both the NFT ID and the Scale.");
                 return;
               }
               if (isNaN(Number(stackTopicAddScale))) {
                 toast.error("Please enter a valid number for the Scale.");
                 return;
               }
 
 
               const meesageobject = {
                     addScale:{
                       NFT: stackTopicAddTopicNFT,
                       scale: stackTopicAddScale
                     }
               };
 
               const meesage = JSON.stringify(meesageobject);

               toast.info("Confirm in wallet 👛");
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-remove-scale-for-model").addEventListener("click", async () => {
             try {
               if (!signer) {
                 toast.error("Connect wallet first");
                 return;
               }
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
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
               const stackTopicRemoveTopicNFT = document.getElementById("input-field-add-remove-NFT-for-model").value;

               if (!stackTopicRemoveTopicNFT) {
                 toast.error("Please enter the NFT ID.");
                 return;
               }
 
               const meesageobject = {
                       removeScale:{
                         NFT: stackTopicRemoveTopicNFT
                       }
               };
 
               const meesage = JSON.stringify(meesageobject);

               toast.info("Confirm in wallet 👛");
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-add-NFT-for-model").addEventListener("click", async () => {
             try {
               if (!signer) {
                 toast.error("Connect wallet first");
                 return;
               }
                 let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
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
               const stackTopicAddTopicNFT = document.getElementById("input-field-add-remove-NFT-for-model").value;

               if (!stackTopicAddTopicNFT) {
                 toast.error("Please enter the NFT ID.");
                 return;
               }
 
 
               const meesageobject = {
                     addTopicNFT: stackTopicAddTopicNFT
               };
 
               const meesage = JSON.stringify(meesageobject);

               toast.info("Confirm in wallet 👛");
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
           
 document.getElementById("submit-button-remove-NFT-for-model").addEventListener("click", async () => {
             try {
               if (!signer) {
                 toast.error("Connect wallet first");
                 return;
               }
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
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
               const stackTopicRemoveTopicNFT = document.getElementById("input-field-add-remove-NFT-for-model").value;

               if (!stackTopicRemoveTopicNFT) {
                 toast.error("Please enter the NFT ID.");
                 return;
               }
 
 
               const meesageobject = {
                   removeTopicNFT: stackTopicRemoveTopicNFT
               };
 
               const meesage = JSON.stringify(meesageobject);

               toast.info("Confirm in wallet 👛");
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-add-topic-chat").addEventListener("click", async () => {
             try {
               if (!signer) {
                 toast.error("Connect wallet first");
                 return;
               }
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
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
               const stackTopicAddTopicNFT = document.getElementById("input-field-add-remove-topic-chat").value;

               if (!stackTopicAddTopicNFT) {
                 toast.error("Please enter the Topic Chat NFT ID.");
                 return;
               }
 
 
               const meesageobject = {
                     addTopicChatNFT: stackTopicAddTopicNFT
               };
 
               const meesage = JSON.stringify(meesageobject);

               toast.info("Confirm in wallet 👛");
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("submit-button-remove-topic-chat").addEventListener("click", async () => {
             try {
               if (!signer) {
                 toast.error("Connect wallet first");
                 return;
               }
               let userInput = document.getElementById("input-field-topic-id-for-utility").value.toLowerCase();
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
               const stackTopicRemoveTopicNFT = document.getElementById("input-field-add-remove-topic-chat").value;

               if (!stackTopicRemoveTopicNFT) {
                 toast.error("Please enter the Topic Chat NFT ID.");
                 return;
               }
 
 
               const meesageobject = {
                   removeTopicChatNFT: stackTopicRemoveTopicNFT
               };
 
               const meesage = JSON.stringify(meesageobject);

               toast.info("Confirm in wallet 👛");
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("add-topic-id").addEventListener("click", async () => {
             try {
               if (!signer) {
                 toast.error("Connect wallet first");
                 return;
               }
               let userInput = document.getElementById("stack-topic-ids-topic").value.toLowerCase();
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
               const stackTopicAddTopic = document.getElementById("stack-topic-add-remove-topic").value;

               if (!stackTopicAddTopic) {
                 toast.error("Please enter the Topic ID to add.");
                 return;
               }
 
 
               const meesageobject = {
                   addTopic: {
                     addTopic: stackTopicAddTopic
                   },
               };
 
               const meesage = JSON.stringify(meesageobject);

               toast.info("Confirm in wallet 👛");
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 document.getElementById("remove-topic-id").addEventListener("click", async () => {
             try {
               if (!signer) {
                 toast.error("Connect wallet first");
                 return;
               }
               let userInput = document.getElementById("stack-topic-ids-topic").value.toLowerCase();
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
               const stackTopicRemoveTopic = document.getElementById("stack-topic-add-remove-topic").value;

               if (!stackTopicRemoveTopic) {
                 toast.error("Please enter the Topic ID to remove.");
                 return;
               }
 
 
               const meesageobject = {
                 removeTopic: {
                   removeTopic: stackTopicRemoveTopic
                 }
               };
 
               const meesage = JSON.stringify(meesageobject);

               toast.info("Confirm in wallet 👛");
               const reciept = await sendMessage(topicId, meesage);
               console.log("Reciept is", reciept);
 
             } catch (error) {
               console.error("Error setting rules:", error);
             }
 });
 
 function topicIdFromDrawField(fieldId) {
  const typed = (document.getElementById(fieldId).value || '').trim().toLowerCase();
  const userInput = typed || (document.getElementById('input-field').value || '').trim().toLowerCase() || initialTopicId;
  if (!userInput) return '';
  const domainEntry = loadedDomains.find(entry => entry.domain === userInput);
  if (domainEntry && domainEntry.lastMessage && domainEntry.lastMessage.topic) {
    return domainEntry.lastMessage.topic;
  }
  return userInput;
}

async function fillNextDrawNumber(kind) {
  if (!connectedAccount) {
    toast.error('Connect wallet first');
    return;
  }
  const topicField = kind === 'polygon' ? 'input-field-3-0' : 'input-field-2-0';
  const numberFieldId = kind === 'polygon' ? 'input-field-number-of-polygon' : 'input-field-number-of-marker';
  const topicFieldEl = document.getElementById(topicField);
  const topicId = topicIdFromDrawField(topicField);
  if (!topicId || !String(topicId).startsWith('0.0.')) {
    toast.error('Enter a topic first');
    return;
  }
  if (!topicFieldEl.value.trim()) topicFieldEl.value = topicId;
  try {
    const result = await getMessages(topicId, { force: true });
    const next = nextDrawNumber(result.messages, connectedAccount, kind);
    const field = document.getElementById(numberFieldId);
    field.value = String(next);
    adjustTextareaHeight(field);
  } catch (err) {
    console.error('Next number failed:', err);
    toast.error('Could not read your numbers on that topic');
  }
}

document.getElementById('use-date-marker-number').addEventListener('click', () => {
  openDrawDatePicker('marker');
});

document.getElementById('use-date-polygon-number').addEventListener('click', () => {
  openDrawDatePicker('polygon');
});

document.getElementById('next-marker-number').addEventListener('click', () => {
  fillNextDrawNumber('marker');
});

document.getElementById('next-polygon-number').addEventListener('click', () => {
  fillNextDrawNumber('polygon');
});

document.getElementById("submit-button-Create_Marker").addEventListener("click", async () => {
     try {
       if (!signer) {
         toast.error("Connect wallet first");
         return;
       }
       let userInput = document.getElementById("input-field-2-0").value.toLowerCase();
       let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
       let topicId;
 
       if (domainEntry && domainEntry.lastMessage) {
         topicId = domainEntry.lastMessage.topic;
       } else {
         topicId = userInput;
       }
       const title = document.getElementById("input-field-2-1").value.slice(0, 20);
       const imageurl = document.getElementById("input-field-image-marker").value;
       const coverimage = document.getElementById("input-field-coverimage-marker").value;
       const cleanUrl = imageurl.replace(/\?network=mainnet$/, "");
       const cleanCoverimage = coverimage.replace(/\?network=mainnet$/, "");
       const msg = document.getElementById("input-field-2-2").value;
       const cord = document.getElementById("input-field-2-3").value;
       const numberOfMarker = document.getElementById("input-field-number-of-marker").value;
 
             if (numberOfMarker === "" || !Number.isInteger(Number(numberOfMarker))) {
           toast.error("Please enter a valid whole number for the Number of Marker.");
           return;
       }
 
       if (!numberOfMarker || !topicId || !cord) {
             toast.error("Please fill in all required fields: Number of Marker, Topic ID, and Coordinates.");
             return;
           }
 
       const messageObj = {marker: {data: {title: title, image: [cleanUrl], coverimage: [cleanCoverimage], msg: msg, cord: cord, numberOfMarker: numberOfMarker }}};
       const message = JSON.stringify(messageObj);

       toast.info("Confirm in wallet 👛");
       const receipt = await sendMessage(
         topicId,
         message
       );
       console.log('Receipt:', receipt);
       reportMarker(topicId, cord, title, cleanUrl, msg, connectedAccount, numberOfMarker);
     } catch (error) {
       console.error('Error submitting message:', error);
     }
 });

 document.getElementById("submit-button-Create_encrypted-Marker").addEventListener("click", async () => {
  try {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    let userInput = document.getElementById("input-field-2-0").value.toLowerCase();
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;
    let PublicKey;


    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }
    if (!topicId) {
      toast.error("Please enter a Topic ID or domain.");
      return;
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
    if (!PublicKey) {
      toast.error("No public key found for this topic. The admin must pin one first.");
      return;
    }

    const title = document.getElementById("input-field-2-1").value.slice(0, 20);
    const imageurl = document.getElementById("input-field-image-marker").value;
    const coverimage = document.getElementById("input-field-coverimage-marker").value;
    const cleanUrl = imageurl.replace(/\?network=mainnet$/, "");
    const cleanCoverimage = coverimage.replace(/\?network=mainnet$/, "");
    const msg = document.getElementById("input-field-2-2").value;
    const cord = document.getElementById("input-field-2-3").value;
    const numberOfMarker = document.getElementById("input-field-number-of-marker").value;

          if (numberOfMarker === "" || !Number.isInteger(Number(numberOfMarker))) {
        toast.error("Please enter a valid whole number for the Number of Marker.");
        return;
    }

    if (!numberOfMarker || !topicId || !cord) {
          toast.error("Please fill in all required fields: Number of Marker, Topic ID, and Coordinates.");
          return;
        }

    const messageObj = {marker: {data: {title: title, image: [cleanUrl], coverimage: [cleanCoverimage], msg: msg, cord: cord, numberOfMarker: numberOfMarker }}};
    const messageStringify = JSON.stringify(messageObj);

    console.log(messageStringify)

    const encryptedMessage = await encryptMessage(messageStringify, PublicKey);

    const message = JSON.stringify(encryptedMessage);

    toast.info("Confirm in wallet 👛");
    const receipt = await sendMessage(topicId,message);
    console.log('Receipt:', receipt);
    reportMarker(topicId, cord, title, cleanUrl, msg, connectedAccount, numberOfMarker);
  } catch (error) {
    console.error('Error submitting message:', error);
  }
});


 
 document.getElementById("delete-marker-number").addEventListener("click", async () => {
     try {
       if (!signer) {
         toast.error("Connect wallet first");
         return;
       }

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
           toast.error("Please enter a valid whole number for the Number of Marker.");
           return;
       }
 
       if (!oldMarkerNumber || !topicId) {
             toast.error("Please fill in all required fields: Number of Marker, Topic ID");
             return;
           }
 
       const messageObj = {marker: {data: {deleteMarkerNumber: oldMarkerNumber}}};
       const message = JSON.stringify(messageObj);
 
       toast.info("Confirm in wallet 👛");
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
       if (!signer) {
         toast.error("Connect wallet first");
         return;
       }
       let userInput = document.getElementById("input-field-3-0").value.toLowerCase();
       let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
       let topicId;
 
       if (domainEntry && domainEntry.lastMessage) {
         topicId = domainEntry.lastMessage.topic;
       } else {
         topicId = userInput;
       }
       const title = document.getElementById("input-field-3-1").value.slice(0, 20);
       const msg = document.getElementById("input-field-3-2").value;
       const imageurl = document.getElementById("input-field-image-polygon").value;
       const coverimage = document.getElementById("input-field-coverimage-polygon").value;
       const cord1 = document.getElementById("input-field-3-3").value; // TOP LEFT
       const cord3 = document.getElementById("input-field-3-5").value; // BOTTOM RIGHT
       const numberOfPolygon = document.getElementById("input-field-number-of-polygon").value;
       const cleanUrl = imageurl.replace(/\?network=mainnet$/, "");
       const cleanCoverimage = coverimage.replace(/\?network=mainnet$/, "");
 
             if (numberOfPolygon === "" || !Number.isInteger(Number(numberOfPolygon))) {
           toast.error("Please enter a valid whole number for the Number of Polygon.");
           return;
       }
 
       if (!numberOfPolygon || !topicId || !cord1 || !cord3) {
             toast.error("Please fill in all required fields: Number of Polygon, Topic ID, and Coordinates.");
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
         toast.error("Please enter valid coordinates in the format number,number for all four corners.");
         return;
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
 
       toast.info("Confirm in wallet 👛");
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
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    let userInput = document.getElementById("input-field-3-0").value.toLowerCase();
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;
    let PublicKey;


    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }
    if (!topicId) {
      toast.error("Please enter a Topic ID or domain.");
      return;
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
    if (!PublicKey) {
      toast.error("No public key found for this topic. The admin must pin one first.");
      return;
    }

    const title = document.getElementById("input-field-3-1").value.slice(0, 20);
    const msg = document.getElementById("input-field-3-2").value;
    const imageurl = document.getElementById("input-field-image-polygon").value;
    const coverimage = document.getElementById("input-field-coverimage-polygon").value;
    const cord1 = document.getElementById("input-field-3-3").value; // TOP LEFT
    const cord3 = document.getElementById("input-field-3-5").value; // BOTTOM RIGHT
    const numberOfPolygon = document.getElementById("input-field-number-of-polygon").value;
    const cleanUrl = imageurl.replace(/\?network=mainnet$/, "");
    const cleanCoverimage = coverimage.replace(/\?network=mainnet$/, "");

          if (numberOfPolygon === "" || !Number.isInteger(Number(numberOfPolygon))) {
        toast.error("Please enter a valid whole number for the Number of Polygon.");
        return;
    }

    if (!numberOfPolygon || !topicId || !cord1 || !cord3) {
          toast.error("Please fill in all required fields: Number of Polygon, Topic ID, and Coordinates.");
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
      toast.error("Please enter valid coordinates in the format number,number for all four corners.");
      return;
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

    toast.info("Confirm in wallet 👛");
    const receipt = await sendMessage(topicId,message);
    console.log('Receipt:', receipt);
  } catch (error) {
    console.error('Error submitting message:', error);
  }
});
 
 document.getElementById("delete-polygon-number").addEventListener("click", async () => {
     try {
       if (!signer) {
         toast.error("Connect wallet first");
         return;
       }
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
           toast.error("Please enter a valid whole number for the Number of Polygon.");
           return;
       }
 
       if (!oldPolygonNumber || !topicId) {
             toast.error("Please fill in all required fields: Number of Polygon, Topic ID");
             return;
           }
 
       const messageObj = {polygon: {data: {deletePolygonNumber: oldPolygonNumber}}};
       const message = JSON.stringify(messageObj);
 
       toast.info("Confirm in wallet 👛");
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
         const inputValue = document.getElementById("input-field-profile-picture").value;

         if (!signer) {
           toast.error("Connect wallet first");
           return;
         }
         if (!inputValue) {
           toast.error("Upload an image first.");
           return;
         }
         if (!isValidUrl(inputValue)) {
           toast.error("Please enter a valid URL.");
           return;
         }

         try {
           const topicId = "0.0.9609881";
           const cleanUrl = inputValue.replace(/\?network=mainnet$/, "");
 
           const messageData = {
             data: {
               urls: [cleanUrl],
             },
           };
           const message = JSON.stringify(messageData);
 
           toast.info("Confirm in wallet 👛");
           const receipt = await sendMessage(
             topicId,
             message
           );
           console.log("Profile picture updated successfully:", receipt);
           showOwnProfile(connectedAccount, { profilePic: cleanUrl });
 
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

   if (!signer) {
     toast.error("Connect wallet first");
     return;
   }
   if (!inputValue) {
     toast.error("Please enter a username.");
     return;
   }
   // Check if inputValue has less than 20 characters
   if (inputValue.length >= 20) {
     toast.error("Please enter a username with less than 20 characters.");
     return;
   }
 
   try {
     const topicId = "0.0.9609904";
 
     const messageData = {
       data: {
         username: inputValue,
       },
     };
     const message = JSON.stringify(messageData);
 
     toast.info("Confirm in wallet 👛");
     const receipt = await sendMessage(topicId, message);
     console.log("Username updated successfully:", receipt);
     showOwnProfile(connectedAccount, { username: inputValue });
 
     document.getElementById("toolbar-input").value = "";
 
     debounce(loadAllData(), 10000);
 
   } catch (error) {
     console.error("Error updating username:", error);
   }
 });
 
 document.getElementById("button_for_click_url").addEventListener("click", async (event) => {
         event.stopPropagation();
         const inputValue = document.getElementById("toolbar-input").value;

         if (!signer) {
           toast.error("Connect wallet first");
           return;
         }
         if (!inputValue) {
           toast.error("Please enter a URL.");
           return;
         }
         if (!isValidUrl(inputValue)) {
           toast.error("Please enter a valid URL.");
           return;
         }

         try {
           const topicId = "0.0.9752486";
           const cleanUrl = inputValue.replace(/\?network=mainnet$/, "");
 
           const messageData = {
             data: {
               click2url: [cleanUrl],
             },
           };
           const message = JSON.stringify(messageData);
 
           toast.info("Confirm in wallet 👛");
           const receipt = await sendMessage(
             topicId,
             message
           );
           console.log("Profile CLICK2URL updated successfully:", receipt);
           showOwnProfile(connectedAccount, { click2url: cleanUrl });
 
           document.getElementById("toolbar-input").value = "";
 
           debounce(loadAllData(), 10000);
 
         } catch (error) {
           console.error("Error updating profile CLICK2URL:", error);
           // Removed alert
         }
 });
 
 document.getElementById("button_for_bio").addEventListener("click", async (event) => {
   event.stopPropagation();
   const inputValue = document.getElementById("Edit_Profile-bio").value;
   if (!signer) {
     toast.error("Connect wallet first");
     return;
   }
   if (!inputValue) {
     toast.error("Please enter your bio.");
     return;
   }
   if (inputValue.length > 256) {
     toast.error("Please enter a bio with 256 characters or less.");
     return;
   }
   try {
     const topicId = "0.0.9759201";
     const messageData = {
       data: {
         topic_bio: [inputValue],
       },
     };
     const message = JSON.stringify(messageData);
     toast.info("Confirm in wallet 👛");
     const receipt = await sendMessage(
       topicId,
       message
     );
     console.log("Profile topic_bio updated successfully:", receipt);
     showOwnProfile(connectedAccount, { bio: inputValue });
     document.getElementById("Edit_Profile-bio").value = "";

     debounce(loadAllData(), 10000);

   } catch (error) {
     console.error("Error updating profile topic_bio:", error);
   }
 });

 document.getElementById("button_for_topic_bio").addEventListener("click", async (event) => {
   event.stopPropagation();
   const inputValue = document.getElementById("topic-bio-input").value;
   if (!signer) {
     toast.error("Connect wallet first");
     return;
   }
   if (!inputValue) {
     toast.error("Please enter a topic bio.");
     return;
   }
   if (inputValue.length > 256) {
     toast.error("Please enter a topic bio with 256 characters or less.");
     return;
   }
   try {
     const userInput = document.getElementById("input-field-topic-id-bio").value.toLowerCase();
     const domainEntry = loadedDomains.find(entry => entry.domain === userInput);
     const topicId = (domainEntry && domainEntry.lastMessage)
       ? domainEntry.lastMessage.topic
       : userInput;
     if (!topicId) {
       toast.error("Please enter a Topic ID or domain.");
       return;
     }
     const messageData = {
       data: {
         topic_bio: [inputValue],
       },
     };
     const message = JSON.stringify(messageData);
     toast.info("Confirm in wallet 👛");
     const receipt = await sendMessage(
       topicId,
       message
     );
     console.log("Topic topic_bio updated successfully:", receipt);
     document.getElementById("topic-bio-input").value = "";
     document.getElementById("char-counter-topic-bio").textContent = "0/256";

     debounce(handleAllMessages(), 10000);

   } catch (error) {
     console.error("Error updating topic topic_bio:", error);
   }
 });

 document.getElementById("load-topic-rules-for-marker").addEventListener("click", async () => {
     try {
       let userInput = document.getElementById("input-field-2-0").value.trim().toLowerCase();
               if (!userInput) {
                 toast.error("Please enter a Topic ID or domain.");
                 return;
               }
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
           <span style="margin-left: 0.45vh;">loading messages from ${topicId}</span>
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
       const markerRules = stackedTopicRules(messages, topicAdmin).markers;

         if (markerRules.length === 0) {
           const utilityRulesMessage = `<span>No rules for this topic.</span>`;
           messagesContainer.innerHTML = utilityRulesMessage;
           delete messagesContainer.dataset.loadedTopicId;
           adjustTextareaHeight(messagesContainer);
           return;
       }

   messagesContainer.innerHTML = '';
   messagesContainer.dataset.loadedTopicId = topicId;
   for (const markerRule of markerRules) {
     if (markerRule.open) {
       appendRemovableRule(messagesContainer, 'Anyone can post markers.', 'marker', markerRule.id);
       continue;
     }
     appendRemovableRule(
       messagesContainer,
       `To post markers, you must own NFT ${markerRule.markerTopicId}. Each NFT allows posting ${markerRule.markerMessagesPerNft} markers.`,
       'marker',
       markerRule.markerTopicId
     );
   }
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
       let userInput = document.getElementById("input-field-3-0").value.trim().toLowerCase();
               if (!userInput) {
                 toast.error("Please enter a Topic ID or domain.");
                 return;
               }
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
           <span style="margin-left: 0.45vh;">loading messages from ${topicId}</span>
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
       const polygonRules = stackedTopicRules(messages, topicAdmin).polygons;

         if (polygonRules.length === 0) {
           const utilityRulesMessage = `<span>No rules for this topic.</span>`;
           messagesContainer.innerHTML = utilityRulesMessage;
           delete messagesContainer.dataset.loadedTopicId;
           adjustTextareaHeight(messagesContainer);
           return;
       }

 messagesContainer.innerHTML = '';
 messagesContainer.dataset.loadedTopicId = topicId;
 for (const polygonRule of polygonRules) {
   if (polygonRule.open) {
     appendRemovableRule(messagesContainer, 'Anyone can post polygons.', 'polygon', polygonRule.id);
     continue;
   }
   const polygonSize = polygonRule.polygonSize;
   const maxLongitudeSize = 360 / polygonSize;
   const maxLatitudeSize = 180 / polygonSize;
   appendRemovableRule(
     messagesContainer,
     `To post polygons, you must own NFT ${polygonRule.polygonTopicId}. Each NFT allows posting ${polygonRule.polygonMessagesPerNft} polygons. Maximum distance between points is ${maxLongitudeSize} for longitude and ${maxLatitudeSize} for latitude. If not = wont load.`,
     'polygon',
     polygonRule.polygonTopicId
   );
 }
   adjustTextareaHeight(messagesContainer);
 
 
 
     } catch (error) {
       const messagesContainer = document.getElementById('loaded-topic-rules-for-polygon');
         const invalidTopicIdMessage = `<span style="padding-top: 1vh;">Invalid Topic ID</span>`;
         messagesContainer.innerHTML = invalidTopicIdMessage;
         adjustTextareaHeight(messagesContainer);    }
 });
 
 