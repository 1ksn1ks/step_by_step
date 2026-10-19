import { sendMessage } from "./msgbackend";
import { getTopicData as getMessages } from "./topicdata";
import { signer } from "./web3";
import { toast } from "./toast";
import { debounce } from "./debounce";

const $ = (id) => document.getElementById(id);

const els = {
    colorDisconnect: $("disconnect-button-color"),
    colorMain: $("main-button-color"),
    swatchDisconnect: $("disconnect-button-color-swatch"),
    swatchMain: $("main-button-color-swatch"),
    previewConnect: $("mb-preview-connect"),
    previewMenu: $("mb-preview-menu"),
};

// The row (OPTIONS / TOPIC CHAT / E2EE CHAT) sits just under the 6dvh line.
// Measure the button and pin the row from the bottom so it stays there when
// the visible height changes. The top inset keeps it clear of the notch.
const mainButtonsRow = $("main-buttons-row");
function anchorMainButtonsRow() {
    const toggle = $("main-toggle-btn");
    if (!mainButtonsRow || !toggle || !window.innerHeight) return;
    const rowBtnHeightVh = Math.round((toggle.offsetHeight / (window.innerHeight / 100)) * 100) / 100;
    mainButtonsRow.style.bottom = `calc(100dvh - 6dvh - ${rowBtnHeightVh}dvh - env(safe-area-inset-top, 0px))`;
}
anchorMainButtonsRow();
window.addEventListener("resize", debounce(anchorMainButtonsRow, 100));
window.addEventListener("orientationchange", debounce(anchorMainButtonsRow, 100));

// The default is the background literally set in style.css (.menu_buttons /
// #disconnect-wallet-btn): rgba(15, 15, 20, 0.45). Font size, height, and
// width stay on the stylesheet.
const CSS_DEFAULTS = {
    color: "rgba(15, 15, 20, 0.45)",
};

// The chip can hold rgba (transparency) but the native color input only
// holds #rrggbb, so the current colors live in JS state, not in the input
const colorState = { disconnect: CSS_DEFAULTS.color, main: CSS_DEFAULTS.color };

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value);

function readControls() {
    return {
        colorDisconnect: colorState.disconnect,
        colorMain: colorState.main,
    };
}

function syncControls(values) {
    if (isHex(values.colorDisconnect)) els.colorDisconnect.value = values.colorDisconnect;
    if (isHex(values.colorMain)) els.colorMain.value = values.colorMain;
    colorState.disconnect = values.colorDisconnect;
    colorState.main = values.colorMain;
    els.swatchDisconnect.style.background = values.colorDisconnect;
    els.swatchMain.style.background = values.colorMain;
}

function updatePreview() {
    const { colorDisconnect, colorMain } = readControls();
    els.previewConnect.style.backgroundColor = colorDisconnect;
    els.previewMenu.style.backgroundColor = colorMain;
}

function updateMainButtonSettings() {
    const { colorDisconnect, colorMain } = readControls();
    // All three wallet buttons (Wallet / Connect / Disconnect) share this class
    document.querySelectorAll(".connect-wallet-buttons").forEach((button) => {
        button.style.backgroundColor = colorDisconnect;
    });
    document.querySelectorAll(".menu_buttons, .options-and-topic").forEach((button) => {
        button.style.backgroundColor = colorMain;
    });
    updatePreview();
}

// Panel starts on the CSS values; the real buttons are left untouched
syncControls({ colorDisconnect: CSS_DEFAULTS.color, colorMain: CSS_DEFAULTS.color });
updatePreview();

document.getElementById("save-main-button").addEventListener("click", async (event) => {
    event.stopPropagation();

    try {
        if (!signer) {
            toast.error("Connect wallet first");
            return;
        }
        const topicId = "0.0.9797981";

        const { colorDisconnect, colorMain } = readControls();

        if (!colorDisconnect || !colorMain) {
            toast.error("Please fill in both color fields.");
            return;
        }
        const messageData = {
            data: {
                colorDisconnect: colorDisconnect,
                colorMain: colorMain
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

export async function loadMainButtonSettings(a) {
    const topicId = "0.0.9797981";
    const accountObjectSettings = []; // Initialize an empty array to store account Settings
    try {
        const result = await getMessages(topicId);
        // Check if result exists and has messages
        if (!result || !Array.isArray(result.messages) || result.messages.length === 0) {
            return accountObjectSettings; // Return empty array if there are no messages
        }

        // Filter messages to find those from the current user
        const userMessages = result.messages.filter(message => message.payer === a);

        // Get the last message from the filtered user's messages
        const lastMessage = userMessages[userMessages.length - 1];

        // Check if the last message has valid data
        if (lastMessage && lastMessage.data) {
            // Older messages may still carry MainButtonFontSize,
            // WalletButtonFontSize, MainButtonHeight, and MainButtonWidth.
            // Those sizes are ignored. colorMainButton is the saved main color.
            const { colorDisconnect, colorMainButton } = lastMessage.data;

            accountObjectSettings.push({
                colorDisconnect: colorDisconnect,
                colorMainButton: colorMainButton
            });

            syncControls({
                colorDisconnect: colorDisconnect,
                colorMain: colorMainButton,
            });
            updateMainButtonSettings();

        }

        return accountObjectSettings;

    } catch (error) {
        console.log("Error in loadMainButtonSettings:", error);
        return [];
    }
    }

    // Reset: panel shows the CSS values and the inline overrides are cleared
    // from the buttons, so the CSS rules style them again
    document.getElementById("reset-main-button").addEventListener("click", (event) => {
        event.stopPropagation();
        syncControls({ colorDisconnect: CSS_DEFAULTS.color, colorMain: CSS_DEFAULTS.color });
        document.querySelectorAll(".connect-wallet-buttons, .menu_buttons, .options-and-topic").forEach((button) => {
            button.style.removeProperty("background-color");
            button.style.removeProperty("height");
            button.style.removeProperty("width");
            button.style.removeProperty("font-size");
        });
        updatePreview();
        toast.info("Reset to defaults");
    });

    document.getElementById("disconnect-button-color").addEventListener("input", (event) => {
        colorState.disconnect = event.target.value;
        els.swatchDisconnect.style.background = colorState.disconnect;
        updateMainButtonSettings();
    });
    document.getElementById("main-button-color").addEventListener("input", (event) => {
        colorState.main = event.target.value;
        els.swatchMain.style.background = colorState.main;
        updateMainButtonSettings();
    });
