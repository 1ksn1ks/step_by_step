import { getMessages, sendMessage } from "./hedera";

document.getElementById("save-main-button").addEventListener("click", async (event) => {
    event.stopPropagation();
    
    try {
        const topicId = "0.0.9797981";
        
        const colorDisconnect = document.getElementById("disconnect-button-color").value;
        const colorMainButton = document.getElementById("main-button-color").value;
        const MainButtonHeight = Math.min(parseFloat(document.getElementById("Main-Button-Height").value) || 100, 100);
        const MainButtonWidth = Math.min(parseFloat(document.getElementById("Main-Button-Width").value) || 100, 100);
        const MainButtonFontSize = Math.min(parseFloat(document.getElementById("Main-Button-Font-Size").value) || 2, 10);
        const messageData = {
            data: {
                colorDisconnect: colorDisconnect,
                colorMainButton: colorMainButton,
                MainButtonHeight: MainButtonHeight,
                MainButtonWidth: MainButtonWidth,
                MainButtonFontSize: MainButtonFontSize
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

export async function loadMainButtonSettings(a) {
    const topicId = "0.0.9797981";
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
            const { colorDisconnect, colorMainButton, MainButtonHeight, MainButtonWidth, MainButtonFontSize } = lastMessage.data;

            accountObjectSettings.push({
                colorDisconnect: colorDisconnect,
                colorMainButton: colorMainButton,
                MainButtonHeight: MainButtonHeight,
                MainButtonWidth: MainButtonWidth,
                MainButtonFontSize: MainButtonFontSize
            });

            document.getElementById("disconnect-button-color").value = colorDisconnect;
            document.getElementById("main-button-color").value = colorMainButton;
            document.getElementById("Main-Button-Height").value = MainButtonHeight;
            document.getElementById("Main-Button-Width").value = MainButtonWidth;
            document.getElementById("Main-Button-Font-Size").value = MainButtonFontSize;
            updateMainButtonSettings();

        }

        return accountObjectSettings;

    } catch (error) {
        console.log("Error in loadMainButtonSettings:", error);
        return [];
    }
    }

    function updateMainButtonSettings() {
        const colorDisconnect = document.getElementById("disconnect-button-color").value;
        const colorMainButton = document.getElementById("main-button-color").value;
        const MainButtonHeight = Math.min(parseFloat(document.getElementById("Main-Button-Height").value) || 2, 100);
        const MainButtonWidth = Math.min(parseFloat(document.getElementById("Main-Button-Width").value) || 10, 100);
        const MainButtonFontSize = Math.min(parseFloat(document.getElementById("Main-Button-Font-Size").value) || 2, 10);
        const disconnectButton = document.querySelectorAll('#disconnect-wallet-btn');
        const menuButtons = document.querySelectorAll('.menu_buttons');
        const optionsButtons = document.querySelectorAll('.options-and-topic');

        disconnectButton.forEach(button => {
            button.style.backgroundColor = colorDisconnect;
            button.style.height = MainButtonHeight + "vh";
            button.style.width = MainButtonWidth + "vw";
            button.style.fontSize = MainButtonFontSize + "vh";
        });

        menuButtons.forEach(button => {
            button.style.backgroundColor = colorMainButton;
            button.style.height = MainButtonHeight + "vh";
            button.style.width = MainButtonWidth + "vw";
            button.style.fontSize = MainButtonFontSize + "vh";
        });

        optionsButtons.forEach(button => {
            button.style.backgroundColor = colorMainButton;
            button.style.height = MainButtonHeight + "vh";
            button.style.width = MainButtonWidth + "vw";
            button.style.fontSize = MainButtonFontSize + "vh";
        });
    }

    document.getElementById("disconnect-button-color").addEventListener("input", (event) => {updateMainButtonSettings();});
    document.getElementById("main-button-color").addEventListener("input", (event) => {updateMainButtonSettings();});
    document.getElementById("Main-Button-Height").addEventListener("input", (event) => {updateMainButtonSettings();});
    document.getElementById("Main-Button-Width").addEventListener("input", (event) => {updateMainButtonSettings();});
    document.getElementById("Main-Button-Font-Size").addEventListener("input", (event) => {updateMainButtonSettings();});


