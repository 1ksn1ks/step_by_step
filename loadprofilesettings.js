import { getMessages, sendMessage } from "./hedera";
import { defaultModelUrl, currentUfoModel} from "./letall";


document.getElementById("savesettings").addEventListener("click", async (event) => {
  event.stopPropagation();
  
  try {
    const topicId = "0.0.9609898";
    const cleanUrl = currentUfoModel||defaultModelUrl;

    const rotationX = document.getElementById("rotation-x").value;
    const rotationY = document.getElementById("rotation-y").value;
    const rotationZ = document.getElementById("rotation-z").value;

    const positionX = document.getElementById("position-x").value;
    const positionY = document.getElementById("position-y").value;
    const positionZ = document.getElementById("position-z").value;

    const scaleFactor = document.getElementById("scale-factor").value;

    // Construct the message data
    const messageData = {
        data: {
            settings : {
              rotation: {
                x: rotationX,
                y: rotationY,
                z: rotationZ
            },
            position: {
                x: positionX,
                y: positionY,
                z: positionZ
            },
            scale: {
              scaleFactor
            },
        },
        urls: [cleanUrl],
      },
    };

    const message = JSON.stringify(messageData);

    const receipt = await sendMessage(
        topicId,
        message
    );
    console.log("Profile settings updated successfully:", receipt);

  } catch (error) {
      console.error("Error updating settings picture:", error);
      // Removed alert
  }
});
    
    
    
export async function loadProfileSettings(a) {
  const topicId = "0.0.9609898";
  const accountObjectSettings = []; // Initialize an empty array to store account Settings
  try {
      const result = await getMessages(topicId);
  
      // Check if result exists and has messages
      if (!result || !Array.isArray(result.messages) || result.messages.length === 0) {
          return accountObjectSettings; // Return empty array if no messages
      }
  
      // Filter messages to find those from the current user
      const userMessages = result.messages.filter(message => message.payer === a);
  
      // Get the last message from the filtered user messages
      const lastMessage = userMessages[userMessages.length - 1];

  
      // Check if the last message has valid data
      if (lastMessage && lastMessage.data) {

         // Extract relevant data
          const { rotation, position, scale } = lastMessage.data.settings;
  
          // Store the settings in accountObjectSettings
          accountObjectSettings.push({ rotation, position, scale});
  
          // Update input fields with the extracted data
          document.getElementById("rotation-x").value = rotation.x; // Set rotation X
          document.getElementById("rotation-x-value").value = rotation.x; // Set rotation X value
          document.getElementById("rotation-y").value = rotation.y; // Set rotation Y
          document.getElementById("rotation-y-value").value = rotation.y; // Set rotation Y value
          document.getElementById("rotation-z").value = rotation.z; // Set rotation Z
          document.getElementById("rotation-z-value").value = rotation.z; // Set rotation Z value
  
          document.getElementById("position-x").value = position.x; // Set position X
          document.getElementById("position-x-value").value = position.x; // Set position X value
          document.getElementById("position-y").value = position.y; // Set position Y
          document.getElementById("position-y-value").value = position.y; // Set position Y value
          document.getElementById("position-z").value = position.z; // Set position Z
          document.getElementById("position-z-value").value = position.z; // Set position Z value
  
          // Add scale factor input update
          document.getElementById("scale-factor").value = scale.scaleFactor; // Update scale factor input
          document.getElementById("scale-factor-value").value = scale.scaleFactor; // Update scale factor value
  
        
      } else {
        console.log("Last message does not have valid data."); // Log invalid data
      }


  
      return accountObjectSettings; // Return the populated array
  } catch (error) {
      console.log("Error in loadProfileSettings:", error);
      return []; // Return empty array instead of throwing error
  }
}