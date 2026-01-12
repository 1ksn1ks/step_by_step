import { getMessages, sendMessage } from "./hedera";
import { setcurrentMarkerSize } from "./marker";

document.getElementById("save-marker-settings").addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
        const topicId = "0.0.9796116";

        const sizeMarker = Math.min(parseFloat(document.getElementById("Marker-Sizer").value) || 0, 255);
        const messageData = {
            data: {
                sizeMarker: sizeMarker
            }
        };

        const message = JSON.stringify(messageData);

        const receipt = await sendMessage(
            topicId,
            message
        );
        console.log("Profile settings updated successfully:", receipt);

    } catch (error) {
        console.error("Error updating settings picture:", error);
    }
    
});

export async function loadMarkerSettings(a) {
        const topicId = "0.0.9796116";
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
                // Extract relevant data and clamp to max 255
                const { sizeMarker } = lastMessage.data;

                const clampedSizeMarker = Math.min(parseFloat(sizeMarker) || 0, 10);

                accountObjectSettings.push({
                    sizeMarker: clampedSizeMarker
                });

                document.getElementById("Marker-Size").value = clampedSizeMarker;

                updateMarkerSettings();
            }

            return accountObjectSettings;

        } catch (error) {
            console.log("Error in loadMarkerSettings:", error);
            return [];
        }
        }

function updateMarkerSettings() {
  const MarkerSize = document.getElementById("Marker-Size").value;
  setcurrentMarkerSize(Math.min(parseFloat(MarkerSize) || 5, 10));
  updateClusters();
}

document.getElementById("Marker-Size").addEventListener("input", (event) => {updateMarkerSettings();});
