import { adjustTextareaHeight } from './adjusttextarea'
import { loadedDomains } from './loaddomains';
import { getMessages, getAccountNFTs, sendMessage, getTopicInfo } from './hedera';
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage, encryptWithPassword, decryptWithPassword } from './sodium'
import { signer } from './web3';
import { toast } from './toast'

export let allLoadedMessagesFromLoad = [];

 
 
 
 document.getElementById("set-password-load").addEventListener("click", async () => {
    try {
      if (!signer) {
        toast.error("Connect wallet first");
        return;
      }
      const userInput = document.getElementById("input-field").value;

      const privateKey = document.getElementById("encrypt-key-load").value;
      const newPassword = document.getElementById("change-key-load").value;

      if (!userInput) {
        toast.error("Please enter a Topic ID or domain.");
        return;
      }
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
      
      toast.info("Confirm in wallet 👛");
      await sendMessage(topicId, message);
  
      console.log("✅ Encrypted private key sent successfully!");
  
      // Clear fields for security
      document.getElementById("encrypt-key-load").value = "";
      document.getElementById("change-key-load").value = "";
  
    } catch (error) {
      console.error("Error:", error.message);
      toast.error("Failed to encrypt: " + error.message);
    }
  });
  
  
  
  document.getElementById("change-password-load").addEventListener("click", async () => {
    try {
      if (!signer) {
        toast.error("Connect wallet first");
        return;
      }
      const userInput = document.getElementById("input-field").value;

      const oldPass = document.getElementById("encrypt-key-load").value;
      const newPassword = document.getElementById("change-key-load").value;

      let encryptedPrivateKey;
      let decryptedPrivateKey;

      if (!userInput) {
        toast.error("Please enter a Topic ID or domain.");
        return;
      }
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
        toast.error("Invalid Topic ID");
        console.error("Error getting topic info:", error);
        return;
      }

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
        toast.error("Wrong password");
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
        encryptedPrivateKeyForLoad: result.encrypted,
        nonce: result.nonce,
        salt: result.salt
      };
  
      const message = JSON.stringify(messageobject);
      console.log("message", message);
      
      toast.info("Confirm in wallet 👛");
      await sendMessage(topicId, message);
  
      console.log("✅ Encrypted private key sent successfully!");
  
      // Clear fields for security
      document.getElementById("encrypt-key-load").value = "";
      document.getElementById("change-key-load").value = "";
  
    } catch (error) {
      console.error("Error:", error.message);
      toast.error("Failed to encrypt: " + error.message);
    }
  });



  document.getElementById("pin-publickkey-load").addEventListener("click", async () => {
    try {
      if (!signer) {
        toast.error("Connect wallet first");
        return;
      }
      let userInput = document.getElementById("input-field").value.toLowerCase();
      let publicKey = document.getElementById("publickkey-load").value;
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
      if (!publicKey) {
        toast.error("Please enter a public key.");
        return;
      }

      const messageobject = {
        publicKeyForLoad: publicKey
      };
      const message = JSON.stringify(messageobject);
      toast.info("Confirm in wallet 👛");
      const receipt = await sendMessage(topicId, message);
      console.log('Receipt:', receipt);
    } catch (error) {
      console.error('Error:', error.message);
    }
  });