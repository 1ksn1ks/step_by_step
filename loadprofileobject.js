import { getMessages, sendMessage } from "./hedera";

document.getElementById("buttonforobject").addEventListener("click", async (event) => {
    event.stopPropagation();
    const inputValue = document.getElementById("object-input").value;

    try {
      const topicId = "0.0.9609898";
      const cleanUrl = inputValue.replace(/\?network=mainnet$/, "");

      const messageData = {
        data: {
          settings: [],
          urls: [cleanUrl],
        },
      };
      const message = JSON.stringify(messageData);

      const receipt = await sendMessage(
        topicId,
        message
      );
      console.log("Profile picture updated successfully:", receipt);

      document.getElementById("object-input").value = "";

    } catch (error) {
      console.error("Error updating profile picture:", error);
      // Removed alert
    }
  });

export async function loadProfileObject(a) {

const topicId = "0.0.9609898";
const accountObjectUrl = []; // Initialize an empty array to store account URLs
try {
    const result = await getMessages(topicId);

    // Check if result exists and has messages
    if (!result || !Array.isArray(result.messages) || result.messages.length === 0) {
        console.log("No profile object found, using defaults");
        return accountObjectUrl; // Return empty array if no messages
    }

    // Filter messages to find those from the current user
    const userMessages = result.messages.filter(message => message.payer === a);

    // Get the last message from the filtered user messages
    const lastMessage = userMessages[userMessages.length - 1];

    // Check if the last message has valid data
    if (lastMessage && lastMessage.data && lastMessage.data.urls && lastMessage.data.urls.length > 0) {
        // Store the URL for this account
        accountObjectUrl.push(lastMessage.data.urls[0]); // Accessing the first URL
    }

    return accountObjectUrl; // Return the populated array

} catch (error) {
    console.log("Error in loadProfileObject:", error);
    return []; // Return empty array instead of throwing error
}
}
