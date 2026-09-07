import { getMessages, sendMessage } from "./hedera";
import { setCurrentUfoModel} from './letall'
import { signer } from "./web3";
import { isValidUrl } from "./ISVALIDURL.JS";
import { toast } from "./toast";

document.getElementById("buttonforobject").addEventListener("click", async (event) => {
    event.stopPropagation();
    const inputValue = document.getElementById("object-input").value;

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
      const topicId = "0.0.9609898";
      const cleanUrl = inputValue.replace(/\?network=mainnet$/, "");

      const messageData = {
        data: {
          settings: [],
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

      document.getElementById("object-input").value = "";

    } catch (error) {
      console.error("Error updating profile picture:", error);
      // Removed alert
    }
  });

export async function loadProfileObject(a) {

const topicId = "0.0.9609898";
try {
    const result = await getMessages(topicId);
    let model = 'https://kiloscribe.com/api/inscription-cdn/0.0.9742046';

    // Check if result exists and has messages
    if (!result || !Array.isArray(result.messages) || result.messages.length === 0) {
        console.log("No profile object found, using defaults");
        return;
    }

    // Filter messages to find those from the current user
    const userMessages = result.messages.filter(message => message.payer === a);

    // Get the last message from the filtered user messages
    const lastMessage = userMessages[userMessages.length - 1];

    // Check if the last message has valid data
    if (lastMessage && lastMessage.data && lastMessage.data.urls && lastMessage.data.urls.length > 0) {
      setCurrentUfoModel(lastMessage.data.urls[0])
      model = lastMessage.data.urls[0]
    }


    return model

} catch (error) {
    console.log("Error in loadProfileObject:", error);
    return []; // Return empty array instead of throwing error
}
}
