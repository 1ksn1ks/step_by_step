import { getMessages, sendMessage } from "./hedera";
import { setcurrentMarkerSize, updateClusters } from "./marker";
import { signer } from "./web3";
import { toast } from "./toast";

const $ = (id) => document.getElementById(id);

const els = {
    size: $("marker-size"),
    sizePill: $("marker-size-pill"),
};

// The default is the value marker.js ships with (currentMarkerSize = 5)
const CSS_DEFAULTS = { size: 5 };

function readControls() {
    return { size: Math.min(parseFloat(els.size.value) || 5, 10) };
}

function syncControls(values) {
    els.size.value = values.size;
}

function updatePills() {
    els.sizePill.textContent = `${els.size.value} vh`;
}

function updateMarkerSettings() {
    const { size } = readControls();
    setcurrentMarkerSize(size);
    updateClusters();
    updatePills();
}

// Panel starts on the default value; the map markers are left untouched
syncControls(CSS_DEFAULTS);
updatePills();

document.getElementById("save-marker-settings").addEventListener("click", async (event) => {
    event.stopPropagation();

    try {
        if (!signer) {
            toast.error("Connect wallet first");
            return;
        }
        const topicId = "0.0.9796116";

        const { size } = readControls();

        const messageData = {
            data: {
                sizeMarker: size
            }
        };

        const message = JSON.stringify(messageData);

        toast.info("Confirm in wallet 👛");
        const receipt = await sendMessage(
            topicId,
            message
        );
        console.log("Profile settings updated successfully:", receipt);

    } catch (error) {
        console.error("Error updating marker settings:", error);
    }
});

export async function loadMarkerSettings(a) {
    const topicId = "0.0.9796116";
    const accountObjectSettings = []; // Initialize an empty array to store account Settings
    try {
        const result = await getMessages(topicId);
        // Check if result exists and has messages
        if (!result || !Array.isArray(result.messages) || result.messages.length === 0) {
            return accountObjectSettings; // Return empty array if there are no messages
        }

        // Filter messages to find those from the current user
        const userMessages = result.messages.filter(message => message.payer === a);

        const lastMessage = userMessages[userMessages.length - 1];

        // Check if the last message has valid data
        if (lastMessage && lastMessage.data) {
            // Extract relevant data and clamp to max 10
            const { sizeMarker } = lastMessage.data;

            const size = Math.min(parseFloat(sizeMarker) || 5, 10);

            accountObjectSettings.push({
                sizeMarker: size
            });

            syncControls({ size });
            updateMarkerSettings();
        }

        return accountObjectSettings;

    } catch (error) {
        console.log("Error in loadMarkerSettings:", error);
        return [];
    }
}

// Reset: panel shows the default value and the map markers go back to it
document.getElementById("reset-marker-size").addEventListener("click", (event) => {
    event.stopPropagation();
    syncControls(CSS_DEFAULTS);
    setcurrentMarkerSize(CSS_DEFAULTS.size);
    updateClusters();
    updatePills();
    toast.info("Reset to defaults");
});

els.size.addEventListener("input", () => { updateMarkerSettings(); });
