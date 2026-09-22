import { getMessages, sendMessage } from "./hedera";
import { signer } from "./web3";
import { toast } from "./toast";

const $ = (id) => document.getElementById(id);

const els = {
    font: $("Main-Button-Font-Size"),
    fontPill: $("Main-Button-Font-Size-pill"),
    walletFont: $("Wallet-Button-Font-Size"),
    walletFontPill: $("Wallet-Button-Font-Size-pill"),
    colorDisconnect: $("disconnect-button-color"),
    colorMain: $("main-button-color"),
    swatchDisconnect: $("disconnect-button-color-swatch"),
    swatchMain: $("main-button-color-swatch"),
    previewConnect: $("mb-preview-connect"),
    previewMenu: $("mb-preview-menu"),
};

// The row (OPTIONS / TOPIC CHAT / E2EE CHAT) is anchored top: 6vh, so growing
// buttons stretch it downward. Re-anchor it from the bottom using the
// current button height, so any growth goes upward instead. Runs at module
// load, while the buttons still have their CSS-default height.
const mainButtonsRow = $("main-buttons-row");
const rowBtnHeightVh = Math.round(($("main-toggle-btn").offsetHeight / (window.innerHeight / 100)) * 100) / 100;
// dvh follows the visible area (URL bar), so phones and desktops match
mainButtonsRow.style.bottom = `calc(100dvh - 6dvh - ${rowBtnHeightVh}dvh)`;

// The defaults are the values literally set in style.css (.menu_buttons /
// #disconnect-wallet-btn): font-size 1.5vh, background rgba(15, 15, 20, 0.45).
// Height and width are auto (content) in the CSS and are never applied, so a
// bigger font grows the button in both directions.
const CSS_DEFAULTS = {
    font: 1.5,
    walletFont: 1.5,
    color: "rgba(15, 15, 20, 0.45)",
};

// The chip can hold rgba (transparency) but the native color input only
// holds #rrggbb, so the current colors live in JS state, not in the input
const colorState = { disconnect: CSS_DEFAULTS.color, main: CSS_DEFAULTS.color };

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value);

function readControls() {
    return {
        font: Math.min(parseFloat(els.font.value) || 2, 10),
        walletFont: Math.min(parseFloat(els.walletFont.value) || 2, 10),
        colorDisconnect: colorState.disconnect,
        colorMain: colorState.main,
    };
}

function syncControls(values) {
    els.font.value = values.font;
    els.walletFont.value = values.walletFont;
    if (isHex(values.colorDisconnect)) els.colorDisconnect.value = values.colorDisconnect;
    if (isHex(values.colorMain)) els.colorMain.value = values.colorMain;
    colorState.disconnect = values.colorDisconnect;
    colorState.main = values.colorMain;
    els.swatchDisconnect.style.background = values.colorDisconnect;
    els.swatchMain.style.background = values.colorMain;
}

function updatePills() {
    els.fontPill.textContent = `${els.font.value} vh`;
    els.walletFontPill.textContent = `${els.walletFont.value} vh`;
}

function updatePreview() {
    const { font, walletFont, colorDisconnect, colorMain } = readControls();
    els.previewConnect.style.backgroundColor = colorDisconnect;
    els.previewConnect.style.fontSize = walletFont + "vh";
    els.previewMenu.style.backgroundColor = colorMain;
    els.previewMenu.style.fontSize = font + "vh";
}

// Height and width are never set here — they stay auto (content) from the CSS
function updateMainButtonSettings() {
    const { font, walletFont, colorDisconnect, colorMain } = readControls();
    // All three wallet buttons (Wallet / Connect / Disconnect) share this class
    document.querySelectorAll(".connect-wallet-buttons").forEach((button) => {
        button.style.backgroundColor = colorDisconnect;
        button.style.fontSize = walletFont + "vh";
    });
    document.querySelectorAll(".menu_buttons, .options-and-topic").forEach((button) => {
        button.style.backgroundColor = colorMain;
        button.style.fontSize = font + "vh";
    });
    updatePills();
    updatePreview();
}

// Panel starts on the CSS values; the real buttons are left untouched
syncControls({ font: CSS_DEFAULTS.font, walletFont: CSS_DEFAULTS.walletFont, colorDisconnect: CSS_DEFAULTS.color, colorMain: CSS_DEFAULTS.color });
updatePills();
updatePreview();

document.getElementById("save-main-button").addEventListener("click", async (event) => {
    event.stopPropagation();

    try {
        if (!signer) {
            toast.error("Connect wallet first");
            return;
        }
        const topicId = "0.0.9797981";

        const { font, walletFont, colorDisconnect, colorMain } = readControls();

        if (!colorDisconnect || !colorMain) {
            toast.error("Please fill in both color fields.");
            return;
        }
        const messageData = {
            data: {
                colorDisconnect: colorDisconnect,
                colorMain: colorMain,
                MainButtonFontSize: font,
                WalletButtonFontSize: walletFont
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
            // Saved MainButtonHeight / MainButtonWidth are not applied:
            // height and width stay auto (content) from the CSS
            const { colorDisconnect, colorMainButton, MainButtonFontSize, WalletButtonFontSize } = lastMessage.data;
            // Old profiles have no WalletButtonFontSize — wallet buttons
            // follow the main font, like the legacy single slider did
            const walletFont = WalletButtonFontSize ?? MainButtonFontSize;

            accountObjectSettings.push({
                colorDisconnect: colorDisconnect,
                colorMainButton: colorMainButton,
                MainButtonFontSize: MainButtonFontSize,
                WalletButtonFontSize: walletFont
            });

            syncControls({
                font: MainButtonFontSize,
                walletFont: walletFont,
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
        syncControls({ font: CSS_DEFAULTS.font, walletFont: CSS_DEFAULTS.walletFont, colorDisconnect: CSS_DEFAULTS.color, colorMain: CSS_DEFAULTS.color });
        document.querySelectorAll(".connect-wallet-buttons, .menu_buttons, .options-and-topic").forEach((button) => {
            button.style.removeProperty("background-color");
            button.style.removeProperty("height");
            button.style.removeProperty("width");
            button.style.removeProperty("font-size");
        });
        updatePills();
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
    document.getElementById("Main-Button-Font-Size").addEventListener("input", (event) => { updateMainButtonSettings(); });
    document.getElementById("Wallet-Button-Font-Size").addEventListener("input", (event) => { updateMainButtonSettings(); });
