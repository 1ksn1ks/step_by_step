import { getMessages, sendMessage } from "./hedera";
import { 
    setTopicChatAccidColor,
    setTopicChatUsernameColor,
    setTopicChatTextColor,
    setTopicChatInnerContainerColor,
    setTopicChatHeaderColor,
    setTopicChatTextFontSize,
    setTopicChatTimestampFontSize,
    setTopicChatHeaderFontSize,
    innerContainerTopicChatColor,
    topicChatHeaderColor
} from './letall'

let textContainerTopicChatColor;


document.getElementById("save-topic-chat-settings").addEventListener("click", async (event) => {
    event.stopPropagation();

    try {
        const topicId = "0.0.9798064";
        const accidTopicChatColor = document.getElementById("accid-topic-chat-color").value;
        const usernameTopicChatColor = document.getElementById("username-topic-chat-color").value;
        const textTopicChatColor = document.getElementById("text-topic-chat-color").value;
        const textContainerTopicChatColor = document.getElementById("text-container-topic-chat-color").value;
        const innerContainerTopicChatColor = document.getElementById("inner-container-topic-chat-color").value;
        const topicChatHeaderColor = document.getElementById("topic-chat-header-color").value;
        const textFontSizeTopicChat = Math.min(parseFloat(document.getElementById("text-font-size-topic-chat").value) || 1.5, 10);
        const timestampFontSizeTopicChat = Math.min(parseFloat(document.getElementById("timestamp-font-size-topic-chat").value) || 1.5, 10);
        const headerFontSizeTopicChat = Math.min(parseFloat(document.getElementById("header-font-size-topic-chat").value) || 0.5, 10);

        const messageData = {
            data: {
                accidTopicChatColor: accidTopicChatColor,
                usernameTopicChatColor: usernameTopicChatColor,
                textTopicChatColor: textTopicChatColor,
                textContainerTopicChatColor: textContainerTopicChatColor,
                innerContainerTopicChatColor: innerContainerTopicChatColor,
                topicChatHeaderColor: topicChatHeaderColor,
                textFontSizeTopicChat: textFontSizeTopicChat,
                timestampFontSizeTopicChat: timestampFontSizeTopicChat,
                headerFontSizeTopicChat: headerFontSizeTopicChat,
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

export async function loadTopicChatSettings(a) {
    const topicId = "0.0.9798064";
    const accountObjectSettings = []; // Initialize an empty array to store account Settings
    try {
        const result = await getMessages(topicId);
        // Check if result exists and has messages
        if (!result || !Array.isArray(result.messages) || result.messages.length === 0) {
            return accountObjectSettings; // Return empty array if no messages
        }

        // Filter messages to find those from the current user
        const userMessages = result.messages.filter(message => message.payer === a);

        const lastMessage = userMessages[userMessages.length - 1];

        // Check if the last message has valid data
        if (lastMessage && lastMessage.data) {
            // Extract relevant data and clamp to max 255
            const { accidTopicChatColor, usernameTopicChatColor, textTopicChatColor, textContainerTopicChatColor, innerContainerTopicChatColor, topicChatHeaderColor, textFontSizeTopicChat, timestampFontSizeTopicChat, headerFontSizeTopicChat } = lastMessage.data;


            accountObjectSettings.push({
                accidTopicChatColor: accidTopicChatColor,
                usernameTopicChatColor: usernameTopicChatColor,
                textTopicChatColor: textTopicChatColor,
                textContainerTopicChatColor: textContainerTopicChatColor,
                innerContainerTopicChatColor: innerContainerTopicChatColor,
                topicChatHeaderColor: topicChatHeaderColor,
                textFontSizeTopicChat: textFontSizeTopicChat,
                timestampFontSizeTopicChat: timestampFontSizeTopicChat,
                headerFontSizeTopicChat: headerFontSizeTopicChat,
            });

            document.getElementById("accid-topic-chat-color").value = accidTopicChatColor;
            document.getElementById("username-topic-chat-color").value = usernameTopicChatColor;
            document.getElementById("text-topic-chat-color").value = textTopicChatColor;
            document.getElementById("text-container-topic-chat-color").value = textContainerTopicChatColor;
            document.getElementById("inner-container-topic-chat-color").value = innerContainerTopicChatColor;
            document.getElementById("topic-chat-header-color").value = topicChatHeaderColor;
            document.getElementById("text-font-size-topic-chat").value = textFontSizeTopicChat;
            document.getElementById("timestamp-font-size-topic-chat").value = timestampFontSizeTopicChat;
            document.getElementById("header-font-size-topic-chat").value = headerFontSizeTopicChat;
            updateTopicChatSettings();
        }

        return accountObjectSettings;

    } catch (error) {
        console.log("Error in loadTopicChatSettings:", error);
        return [];
    }
    }

    function updateTopicChatSettings() {
    const newAccidTopicChatColor = document.getElementById("accid-topic-chat-color").value;
    const newUsernameTopicChatColor = document.getElementById("username-topic-chat-color").value;
    const newTextTopicChatColor = document.getElementById("text-topic-chat-color").value;
    const newTextContainerTopicChatColor = document.getElementById("text-container-topic-chat-color").value;
    const newInnerContainerTopicChatColor = document.getElementById("inner-container-topic-chat-color").value;
    const newTopicChatHeaderColor = document.getElementById("topic-chat-header-color").value;
    const newTextFontSizeTopicChat = Math.min(parseFloat(document.getElementById("text-font-size-topic-chat").value) || 1.5, 10);
    const newTimestampFontSizeTopicChat = Math.min(parseFloat(document.getElementById("timestamp-font-size-topic-chat").value) || 1.5, 10);
    const newHeaderFontSizeTopicChat = Math.min(parseFloat(document.getElementById("header-font-size-topic-chat").value) || 1.5, 10);

    setTopicChatAccidColor(newAccidTopicChatColor);
    setTopicChatUsernameColor(newUsernameTopicChatColor);
    setTopicChatTextColor(newTextTopicChatColor);
    textContainerTopicChatColor = newTextContainerTopicChatColor;
    setTopicChatInnerContainerColor (newInnerContainerTopicChatColor);
    setTopicChatHeaderColor (newTopicChatHeaderColor);
    setTopicChatTextFontSize (newTextFontSizeTopicChat);
    setTopicChatTimestampFontSize (newTimestampFontSizeTopicChat);
    setTopicChatHeaderFontSize (newHeaderFontSizeTopicChat);

    const topicChatSettings = document.querySelectorAll('.chat-container');
    topicChatSettings.forEach(topicChat => {
        topicChat.style.borderColor = textContainerTopicChatColor;
    });

    const topicChatSettingsInner = document.querySelectorAll('.toolbar-group-messages');
    topicChatSettingsInner.forEach(topicChatInner => {
        topicChatInner.style.borderColor = innerContainerTopicChatColor;
    });

    const topicChatSettingsHeader = document.querySelectorAll('.toolbar-group-messages-header');
    topicChatSettingsHeader.forEach(topicChatHeader => {
        topicChatHeader.style.borderColor = topicChatHeaderColor;
    });

}

document.getElementById("accid-topic-chat-color").addEventListener("input", (event) => {updateTopicChatSettings();});
document.getElementById("username-topic-chat-color").addEventListener("input", (event) => {updateTopicChatSettings();});
document.getElementById("text-topic-chat-color").addEventListener("input", (event) => {updateTopicChatSettings();});
document.getElementById("text-container-topic-chat-color").addEventListener("input", (event) => {updateTopicChatSettings();});
document.getElementById("inner-container-topic-chat-color").addEventListener("input", (event) => {updateTopicChatSettings();});
document.getElementById("topic-chat-header-color").addEventListener("input", (event) => {updateTopicChatSettings();});
document.getElementById("text-font-size-topic-chat").addEventListener("input", (event) => {updateTopicChatSettings();});
document.getElementById("timestamp-font-size-topic-chat").addEventListener("input", (event) => {updateTopicChatSettings();});
document.getElementById("header-font-size-topic-chat").addEventListener("input", (event) => {updateTopicChatSettings();});

