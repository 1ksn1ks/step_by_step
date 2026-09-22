import { getMessages, sendMessage } from "./hedera";
import {
    setTopicChatAccidColor,
    setTopicChatUsernameColor,
    setTopicChatTextColor,
    setTopicChatTextFontSize,
    setTopicChatTimestampFontSize,
    setTopicChatHeaderFontSize
} from './letall'
import { signer } from "./web3";
import { toast } from "./toast";

const $ = (id) => document.getElementById(id);

const els = {
    textFont: $("text-font-size-topic-chat"),
    textFontPill: $("text-font-size-topic-chat-pill"),
    timestampFont: $("timestamp-font-size-topic-chat"),
    timestampFontPill: $("timestamp-font-size-topic-chat-pill"),
    headerFont: $("header-font-size-topic-chat"),
    headerFontPill: $("header-font-size-topic-chat-pill"),
    previewAccid: $("mb-chat-preview-accid"),
    previewUsername: $("mb-chat-preview-username"),
    previewTime: $("mb-chat-preview-time"),
    previewMsg: $("mb-chat-preview-msg"),
    previewOuter: $("mb-chat-preview-outer"),
};

// [colorState key, color input id] — the swatch label is <id>-swatch
const COLOR_FIELDS = [
    ["accid", "accid-topic-chat-color"],
    ["username", "username-topic-chat-color"],
    ["text", "text-topic-chat-color"],
    ["outer", "text-container-topic-chat-color"],
];

// The defaults are the values the app really ships with:
// fonts 2 / 1.25 / 2 and text colors from the letall.js render defaults,
// outer container border from the CSS glass border rgba(255, 255, 255, 0.3).
const CSS_DEFAULTS = {
    textFont: 2,
    timestampFont: 1.25,
    headerFont: 2,
    accid: "#800080",
    username: "#ff9933",
    text: "#ffffff",
    outer: "rgba(255, 255, 255, 0.3)",
};

// The chips can hold rgba (transparency) but the native color inputs only
// hold #rrggbb, so the current colors live in JS state, not in the inputs
const colorState = {
    accid: CSS_DEFAULTS.accid,
    username: CSS_DEFAULTS.username,
    text: CSS_DEFAULTS.text,
    outer: CSS_DEFAULTS.outer,
};

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value);

function readControls() {
    return {
        textFont: Math.min(parseFloat(els.textFont.value) || 1.5, 10),
        timestampFont: Math.min(parseFloat(els.timestampFont.value) || 1.5, 10),
        headerFont: Math.min(parseFloat(els.headerFont.value) || 0.5, 10),
        ...colorState,
    };
}

function syncControls(values) {
    els.textFont.value = values.textFont;
    els.timestampFont.value = values.timestampFont;
    els.headerFont.value = values.headerFont;
    for (const [key, id] of COLOR_FIELDS) {
        const input = $(id);
        if (isHex(values[key])) input.value = values[key];
        colorState[key] = values[key];
        $(id + "-swatch").style.background = values[key];
    }
}

function updatePills() {
    els.textFontPill.textContent = `${els.textFont.value} vh`;
    els.timestampFontPill.textContent = `${els.timestampFont.value} vh`;
    els.headerFontPill.textContent = `${els.headerFont.value} vh`;
}

function updatePreview() {
    const { textFont, timestampFont, headerFont, ...colors } = readControls();
    els.previewAccid.style.color = colors.accid;
    els.previewAccid.style.fontSize = headerFont + "vh";
    els.previewUsername.style.color = colors.username;
    els.previewUsername.style.fontSize = headerFont + "vh";
    els.previewTime.style.fontSize = timestampFont + "vh";
    els.previewMsg.style.color = colors.text;
    els.previewMsg.style.fontSize = textFont + "vh";
    els.previewOuter.style.borderColor = colors.outer;
}

function updateTopicChatSettings() {
    const { textFont, timestampFont, headerFont, ...colors } = readControls();

    // Render-time values for new messages (topicchat.js reads these from letall)
    setTopicChatAccidColor(colors.accid);
    setTopicChatUsernameColor(colors.username);
    setTopicChatTextColor(colors.text);
    setTopicChatTextFontSize(textFont);
    setTopicChatTimestampFontSize(timestampFont);
    setTopicChatHeaderFontSize(headerFont);

    // Live border color on the already-rendered chat container
    document.querySelectorAll(".chat-container").forEach((el) => {
        el.style.borderColor = colors.outer;
    });

    updatePills();
    updatePreview();
}

// Panel starts on the default values; the real chat is left untouched
syncControls(CSS_DEFAULTS);
updatePills();
updatePreview();

document.getElementById("save-topic-chat-settings").addEventListener("click", async (event) => {
    event.stopPropagation();

    try {
        if (!signer) {
            toast.error("Connect wallet first");
            return;
        }
        const topicId = "0.0.9798064";

        const { textFont, timestampFont, headerFont, ...colors } = readControls();

        if (!colors.accid || !colors.username || !colors.text || !colors.outer) {
            toast.error("Please fill in all color fields.");
            return;
        }

        const messageData = {
            data: {
                accidTopicChatColor: colors.accid,
                usernameTopicChatColor: colors.username,
                textTopicChatColor: colors.text,
                textContainerTopicChatColor: colors.outer,
                textFontSizeTopicChat: textFont,
                timestampFontSizeTopicChat: timestampFont,
                headerFontSizeTopicChat: headerFont,
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
            return accountObjectSettings; // Return empty array if there are no messages
        }

        // Filter messages to find those from the current user
        const userMessages = result.messages.filter(message => message.payer === a);

        const lastMessage = userMessages[userMessages.length - 1];

        // Check if the last message has valid data
        if (lastMessage && lastMessage.data) {
            // Extract relevant data (old saved innerContainerTopicChatColor /
            // topicChatHeaderColor are ignored)
            const { accidTopicChatColor, usernameTopicChatColor, textTopicChatColor, textContainerTopicChatColor, textFontSizeTopicChat, timestampFontSizeTopicChat, headerFontSizeTopicChat } = lastMessage.data;


            accountObjectSettings.push({
                accidTopicChatColor: accidTopicChatColor,
                usernameTopicChatColor: usernameTopicChatColor,
                textTopicChatColor: textTopicChatColor,
                textContainerTopicChatColor: textContainerTopicChatColor,
                textFontSizeTopicChat: textFontSizeTopicChat,
                timestampFontSizeTopicChat: timestampFontSizeTopicChat,
                headerFontSizeTopicChat: headerFontSizeTopicChat,
            });

            syncControls({
                textFont: textFontSizeTopicChat,
                timestampFont: timestampFontSizeTopicChat,
                headerFont: headerFontSizeTopicChat,
                accid: accidTopicChatColor,
                username: usernameTopicChatColor,
                text: textTopicChatColor,
                outer: textContainerTopicChatColor,
            });
            updateTopicChatSettings();
        }

        return accountObjectSettings;

    } catch (error) {
        console.log("Error in loadTopicChatSettings:", error);
        return [];
    }
    }

    // Reset: panel shows the default values, the letall render values go
    // back to defaults, and the inline border colors are cleared so the
    // CSS styles the containers again
    document.getElementById("reset-topic-chat").addEventListener("click", (event) => {
        event.stopPropagation();
        syncControls(CSS_DEFAULTS);
        setTopicChatAccidColor(CSS_DEFAULTS.accid);
        setTopicChatUsernameColor(CSS_DEFAULTS.username);
        setTopicChatTextColor(CSS_DEFAULTS.text);
        setTopicChatTextFontSize(CSS_DEFAULTS.textFont);
        setTopicChatTimestampFontSize(CSS_DEFAULTS.timestampFont);
        setTopicChatHeaderFontSize(CSS_DEFAULTS.headerFont);
        document.querySelectorAll(".chat-container").forEach((el) => {
            el.style.removeProperty("border-color");
        });
        updatePills();
        updatePreview();
        toast.info("Reset to defaults");
    });

    for (const [key, id] of COLOR_FIELDS) {
        $(id).addEventListener("input", (event) => {
            colorState[key] = event.target.value;
            $(id + "-swatch").style.background = colorState[key];
            updateTopicChatSettings();
        });
    }

    ["text-font-size-topic-chat", "timestamp-font-size-topic-chat", "header-font-size-topic-chat"].forEach((id) => {
        $(id).addEventListener("input", () => { updateTopicChatSettings(); });
    });
