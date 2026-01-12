import { getMessages, sendMessage } from "./hedera";


document.getElementById("savecrosshair").addEventListener("click", async (event) => {
    event.stopPropagation();
    
            try {
                const topicId = "0.0.9609927";
    
                const colorCrosshair = document.getElementById("crosshair-color").value;
    
                const crosshairBeforeWidth = document.getElementById("crosshair-before-after").value;
                const crosshairAfterHeight = document.getElementById("crosshair-after-before").value;
    
                // Construct the message data
                const messageData = {
                    data: {
                        color: {
                            colorCrosshair: colorCrosshair
                        },
                        crosshair: {
                            beforeWidth: crosshairBeforeWidth,
                            afterHeight: crosshairAfterHeight
                        }
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

    
export async function loadProfileCrosshair(a) {
      const topicId = "0.0.9609927";
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
            const { color, crosshair } = lastMessage.data;
    
            // Store the settings in accountObjectSettings
            accountObjectSettings.push({
                color,
                crosshair
            });
    
            document.getElementById("crosshair-color").value = color.colorCrosshair; // Set color crosshair
    
            document.getElementById("crosshair-before-after").value = crosshair.beforeWidth; // Set crosshair before width
            document.getElementById("crosshair-before-after-value").value = crosshair.beforeWidth; // Set crosshair before width value
            document.getElementById("crosshair-after-before").value = crosshair.afterHeight; // Set crosshair after height
            document.getElementById("crosshair-after-before-value").value = crosshair.afterHeight; // Set crosshair after height value
    
            // Call update functions to apply the loaded values
            updateColorCrosshair(); // Update crosshair color
            updateCrosshairBeforeAfter(crosshair.beforeWidth); // Update crosshair before width
            updateCrosshairAfterBefore(crosshair.afterHeight); // Update crosshair after height
    
        } else {
            console.log("Last message does not have valid data."); // Log invalid data
        }
    
        return accountObjectSettings; // Return the populated array
    
    } catch (error) {
        console.log("Error in loadProfileCrosshair:", error);
        return []; // Return empty array instead of throwing error
    }
    }
    
    function updateCrosshairBeforeAfter(value) {
        const crosshair = document.getElementById("crosshair");
        crosshair.style.setProperty('--crosshair-before-width', `${value}px`); // Width of ::before
        crosshair.style.setProperty('--crosshair-after-height', `${value}px`); // Height of ::after
    }
    
    function updateCrosshairAfterBefore(value) {
        const crosshair = document.getElementById("crosshair");
        crosshair.style.setProperty('--crosshair-after-width', `${value}px`); // Width of ::after
        crosshair.style.setProperty('--crosshair-before-height', `${value}px`); // Height of ::before
    }
    
    // Add event listeners for crosshair size sliders
    document.getElementById("crosshair-before-after").addEventListener("input", (event) => {
        const value = event.target.value;
        document.getElementById("crosshair-before-after-value").textContent = value;
        updateCrosshairBeforeAfter(value);
        document.getElementById("crosshair-before-after-value").value = value; // Update number input
    });
    
    document.getElementById("crosshair-after-before").addEventListener("input", (event) => {
        const value = event.target.value;
        document.getElementById("crosshair-after-before-value").textContent = value;
        updateCrosshairAfterBefore(value);
        document.getElementById("crosshair-after-before-value").value = value; // Update number input
    });
    
    // Add event listeners for number inputs to update sliders
    document.getElementById("crosshair-before-after-value").addEventListener("input", (event) => {
        const value = event.target.value;
        document.getElementById("crosshair-before-after").value = value; // Update range input
        updateCrosshairBeforeAfter(value);
    });
    
    document.getElementById("crosshair-after-before-value").addEventListener("input", (event) => {
        const value = event.target.value;
        document.getElementById("crosshair-after-before").value = value; // Update range input
        updateCrosshairAfterBefore(value);
    });
    
    function updateColorCrosshair() {
      const color = document.getElementById("crosshair-color").value;
      const crosshair = document.getElementById("crosshair");
      crosshair.style.setProperty('--crosshair-color', color);
    }
    document.getElementById("crosshair-color").addEventListener("input", (event) => {updateColorCrosshair();});
