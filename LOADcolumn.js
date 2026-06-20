import { adjustTextareaHeight } from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { getMessages, getAccountNFTs, sendMessage, getTopicInfo } from './hedera';
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage, encryptWithPassword, decryptWithPassword } from './sodium' 

export let allLoadedMessagesFromLoad = [];

 
 
 
 document.getElementById("set-password-load").addEventListener("click", async () => {
    try {
      const userInput = document.getElementById("input-field").value;
      
      const privateKey = document.getElementById("encrypt-key-load").value; 
      const newPassword = document.getElementById("change-key-load").value;
  
      if (!privateKey) throw new Error("Private key is required");
      if (!newPassword) throw new Error("Password is required");
  
      let topicId = userInput;
      const domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      }
  
      const result = await encryptWithPassword(privateKey, newPassword);
  
      const messageobject = {
        type: "set_encrypted_key",
        encryptedPrivateKeyForLoad: result.encrypted,
        nonce: result.nonce,
        salt: result.salt
      };
  
      const message = JSON.stringify(messageobject);
      console.log("message", message);
      
      await sendMessage(topicId, message);
  
      console.log("✅ Encrypted private key sent successfully!");
  
      // Clear fields for security
      document.getElementById("encrypt-key-load").value = "";
      document.getElementById("change-key-load").value = "";
  
    } catch (error) {
      console.error("Error:", error.message);
      alert("Failed to encrypt: " + error.message);
    }
  });
  
  
  
  document.getElementById("change-password-load").addEventListener("click", async () => {
    try {
      const userInput = document.getElementById("input-field");
      
      const oldPass = document.getElementById("encrypt-key-load"); 
      const newPassword = document.getElementById("change-key-load");
  
      let encryptedPrivateKey;
      let decryptedPrivateKey;
  
      if (!oldPass) throw new Error("oldPass key is required");
      if (!newPassword) throw new Error("Password is required");
  
      let topicId = userInput;
      const domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
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
        createEmptyStateMessage(messagesContainer, 'Invalid Topic ID');
        adjustTextareaHeight(messagesContainer);
        console.error("Error getting topic info:", error);
        return;
      }
  
  
      const messagesContainer = document.getElementById("messages-from-encrypted-chat");
      
      const allmesages = await getMessages(topicId);
      allLoadedMessagesFromLoad = [allmesages];
      const messages = allmesages.messages;

      try {
        for (let index = messages.length - 1; index >= 0; index--) {
  
          const message = messages[index];
          let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
          if (parsedMessage.encryptedPrivateKeyForLoad && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            encryptedPrivateKey = parsedMessage.encryptedPrivateKeyForLoad;
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
  
      const result = await encryptWithPassword(decryptedPrivateKey, newPassword);
  
      const messageobject = {
        type: "set_encrypted_key",
        encryptedPrivateKeyForLoad: result.encrypted,
        nonce: result.nonce,
        salt: result.salt
      };
  
      const message = JSON.stringify(messageobject);
      console.log("message", message);
      
      await sendMessage(topicId, message);
  
      console.log("✅ Encrypted private key sent successfully!");
  
      // Clear fields for security
      document.getElementById("encrypt-key-load").value = "";
      document.getElementById("change-key-load").value = "";
  
    } catch (error) {
      console.error("Error:", error.message);
      alert("Failed to encrypt: " + error.message);
    }
  });



  document.getElementById("pin-publickkey-load").addEventListener("click", async () => {
    try {
      let userInput = document.getElementById("input-field").value.toLowerCase();
      let publicKey = document.getElementById("publickkey-load").value;
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;
  
      if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput;
      }
  
      const messageobject = {
        publicKeyForLoad: publicKey
      };
      const message = JSON.stringify(messageobject);
      const receipt = await sendMessage(topicId, message);
      console.log('Receipt:', receipt);
    } catch (error) {
      console.error('Error:', error.message);
    }
  });