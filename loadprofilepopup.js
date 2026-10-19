import { sendMessage } from "./msgbackend";
import { getTopicData as getMessages } from "./topicdata";
import { signer, connectedAccount } from "./web3";
import { toast } from "./toast";
import { earlyHashinalNumber } from "./earlyhashinal.js";
import {
    EARLY_POPUP_CLASS,
    EARLY_PROFILE_CLASS,
} from "./earlypopup.js";

const STYLE_INPUTS = [
    "color-picker-popup-border",
    "color-picker-popup-number",
    "color-picker-popup-close",
    "color-picker-popup-accid",
    "color-picker-popup-username",
    "color-picker-popup-titles",
    "color-picker-popup-text",
    "popup-font-size",
];

let styleAccount = "";

document.getElementById("savepopup3").addEventListener("click", async (event) => {
    event.stopPropagation();

            try {
                if (!signer) {
                    toast.error("Connect wallet first");
                    return;
                }
                if (earlyHashinalNumber(styleAccount) > 0) return;
                const topicId = "0.0.9771374";

                const hexColorBorder = document.getElementById('color-picker-popup-border').value;
                const hexColorNumber = document.getElementById('color-picker-popup-number').value;
                const hexColorClose = document.getElementById('color-picker-popup-close').value;
                const hexColorAccid = document.getElementById('color-picker-popup-accid').value;
                const hexColorUsername = document.getElementById('color-picker-popup-username').value;
                const hexColorTitles = document.getElementById('color-picker-popup-titles').value;
                const hexColorText = document.getElementById('color-picker-popup-text').value;
                const popupFontSize = Math.min(Math.max(parseFloat(document.getElementById("popup-font-size").value) || 1, 1), 3);

                if (!hexColorBorder || !hexColorNumber || !hexColorClose || !hexColorAccid || !hexColorUsername || !hexColorTitles || !hexColorText) {
                    toast.error("Please fill in all color fields.");
                    return;
                }
    
                const messageData = {
                    data: {
                        colorBorder: hexColorBorder,
                        colorNumber: hexColorNumber,
                        colorClose: hexColorClose,
                        colorUsername: hexColorUsername,
                        colorAccid: hexColorAccid,
                        colorText: hexColorText,
                        colorTitles: hexColorTitles,
                        popupFontSize: popupFontSize
                    },
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
                // Removed alert
            }
          });
    
export async function loadProfilePopup(a) {
        styleAccount = typeof a === "string" ? a : "";
        const topicId = "0.0.9771374";
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
                const { colorBorder, colorNumber, colorClose, colorUsername, colorAccid, colorText, colorTitles, popupFontSize } = lastMessage.data;
    
                accountObjectSettings.push({
                    colorBorder: colorBorder,
                    colorNumber: colorNumber,
                    colorClose: colorClose,
                    colorUsername: colorUsername,
                    colorAccid: colorAccid,
                    colorText: colorText,
                    colorTitles: colorTitles,
                    popupFontSize: popupFontSize
                });
    
                document.getElementById("color-picker-popup-border").value = colorBorder;
                document.getElementById("color-picker-popup-number").value = colorNumber;
                document.getElementById("color-picker-popup-close").value = colorClose;
                document.getElementById("color-picker-popup-accid").value = colorAccid;
                document.getElementById("color-picker-popup-username").value = colorUsername;
                document.getElementById("color-picker-popup-titles").value = colorTitles;
                document.getElementById("color-picker-popup-text").value = colorText;
                document.getElementById("popup-font-size").value = Math.min(Math.max(parseFloat(popupFontSize) || 1, 1), 3);
    
                updatePopupBorder();
                updatePopupNumber();
                updatePopupClose();
                updatePopupAccid();
                updatePopupUsername();
                updatePopupTitles();
                updatePopupText();
                updatePopupFontSize();

            }
    
            return accountObjectSettings;
    
        } catch (error) {
            console.log("Error in loadProfilePopup:", error);
            return [];
        } finally {
            syncEarlyStyleEditor(styleAccount);
        }
    }

function payerOf(popup) {
    if (!popup) return "";
    if (popup.id === "popup-settings-preview") return styleAccount;
    const sheet = popup.querySelector(".popup-sheet");
    const id = sheet && sheet.dataset ? sheet.dataset.popupPayer : "";
    return typeof id === "string" ? id : "";
}

function dropEarlyBadges(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll(".early-holder-badge").forEach((node) => node.remove());
}

export function syncPopupChrome(popup) {
    if (!popup || !popup.classList) return;
    const locked = earlyHashinalNumber(payerOf(popup)) > 0;
    popup.classList.toggle(EARLY_POPUP_CLASS, locked);
    dropEarlyBadges(popup);
}

export function paintEarlyProfile(card, account) {
    if (!card || !card.classList) return;
    const id = typeof account === "string" ? account : "";
    const n = earlyHashinalNumber(id);
    card.classList.toggle(EARLY_PROFILE_CLASS, n > 0);
    if (card.dataset) card.dataset.popupPayer = id;
    dropEarlyBadges(card);
}

export function syncEarlyStyleEditor(account) {
    if (typeof account === "string") styleAccount = account;
    else styleAccount = typeof connectedAccount === "string" ? connectedAccount : "";
    const n = earlyHashinalNumber(styleAccount);
    for (const id of STYLE_INPUTS) {
        const el = document.getElementById(id);
        if (el) el.disabled = n > 0;
    }
    const save = document.getElementById("savepopup3");
    if (save) {
        save.classList.toggle("is-locked", n > 0);
        save.setAttribute("aria-disabled", n > 0 ? "true" : "false");
    }
    const live = document.getElementById("profile-live-preview");
    if (live) paintEarlyProfile(live, styleAccount);
    const bio = document.getElementById("loaded-bio-card");
    if (bio) paintEarlyProfile(bio, bio.dataset.popupPayer || "");
    applyAllStyles();
}

document.addEventListener("early-hashinals", () => {
    syncEarlyStyleEditor();
});

export function applyAllStyles() {
        document.querySelectorAll(".maplibregl-popup").forEach(syncPopupChrome);
        updatePopupBorder();
        updatePopupNumber();
        updatePopupClose();
        updatePopupAccid();
        updatePopupUsername();
        updatePopupTitles();
        updatePopupText();
        updatePopupFontSize();
    }
    
    function updatePopupBorder() {
      const color = document.getElementById('color-picker-popup-border').value;
      const popupContents = document.querySelectorAll('.maplibregl-popup');
      popupContents.forEach(popup => {
          if (!color) {
              popup.style.borderColor = '';
              popup.style.removeProperty('--popup-border-color');
              return;
          }
          popup.style.borderColor = color;
          popup.style.setProperty('--popup-border-color', color);
      });
    }
    document.getElementById('color-picker-popup-border').addEventListener('input', (event) => {updatePopupBorder();});
    
    function updatePopupNumber() {
      const color = document.getElementById('color-picker-popup-number').value;
      const popupNumbers = document.querySelectorAll('.maplibregl-popup .number');
      popupNumbers.forEach(number => {
        number.style.color = color;
      });
    }
    document.getElementById('color-picker-popup-number').addEventListener('input', (event) => {updatePopupNumber();});
    
    function updatePopupClose() {
      const color = document.getElementById('color-picker-popup-close').value;
      const popupCloses = document.querySelectorAll('.maplibregl-popup-close-button');
      popupCloses.forEach(close => {
        close.style.color = color;
      });
    }
    document.getElementById('color-picker-popup-close').addEventListener('input', (event) => {updatePopupClose();});
    
    function updatePopupAccid() {
      const color = document.getElementById('color-picker-popup-accid').value;
      const popupAccids = document.querySelectorAll('.maplibregl-popup .payer-info');
      popupAccids.forEach(accid => {
        accid.style.color = color;
      });
    }
    document.getElementById('color-picker-popup-accid').addEventListener('input', (event) => {updatePopupAccid();});
    
    function updatePopupUsername() {
      const color = document.getElementById('color-picker-popup-username').value;
      const popupUsernames = document.querySelectorAll('.maplibregl-popup .username');
      popupUsernames.forEach(username => {
        username.style.color = color;
      });
    }
    document.getElementById('color-picker-popup-username').addEventListener('input', (event) => {updatePopupUsername();});
    
    function updatePopupTitles() {
      const color = document.getElementById('color-picker-popup-titles').value;
      const popupTitles = document.querySelectorAll('.maplibregl-popup .title_color');
      popupTitles.forEach(title => {
        title.style.color = color;
      });
    }
    document.getElementById('color-picker-popup-titles').addEventListener('input', (event) => {updatePopupTitles();});
    
    function updatePopupText() {
      const color = document.getElementById('color-picker-popup-text').value;
      const popupTexts = document.querySelectorAll('.maplibregl-popup-content');
      popupTexts.forEach(text => {
        text.style.color = color;
      });
    }
    document.getElementById('color-picker-popup-text').addEventListener('input', (event) => {updatePopupText();});
    
    function updatePopupFontSize() {
        const popupFontSize = document.getElementById("popup-font-size").value;
        const popupFontSizeValue = Math.min(Math.max(parseFloat(popupFontSize) || 1, 1), 3);
        const popupTexts = document.querySelectorAll('.maplibregl-popup-content');
        popupTexts.forEach(text => {
            text.style.fontSize = `calc(var(--u) * ${popupFontSizeValue})`;
        });
    }
    document.getElementById('popup-font-size').addEventListener('input', (event) => {updatePopupFontSize();});