import { sendMessage } from "./msgbackend";
import { getTopicData as getMessages } from "./topicdata";
import { signer } from "./web3";
import { toast } from "./toast";

const $ = (id) => document.getElementById(id);

const els = {
    previewInput: $("mb-preview-input"),
    previewButton: $("mb-preview-button"),
};

// [colorState key, color input id] — the swatch label is <id>-swatch
const COLOR_FIELDS = [
    ["inputBorder", "input-border-color"],
    ["inputFont", "input-font-color"],
    ["buttonBorder", "button-border-color"],
    ["buttonFont", "button-font-color"],
    ["onhover", "onhover-button-color"],
];

// The defaults are the colors literally set in style.css
// (.toolbar-column / .yourfov / .toolbar-column-btns):
// border rgba(255, 255, 255, 0.3), font white, hover background rgba(255, 255, 255, 0.2).
const CSS_DEFAULTS = {
    inputBorder: "rgba(255, 255, 255, 0.3)",
    inputFont: "#ffffff",
    buttonBorder: "rgba(255, 255, 255, 0.3)",
    buttonFont: "#ffffff",
    onhover: "rgba(255, 255, 255, 0.2)",
};

// The chips can hold rgba (transparency) but the native color inputs only
// hold #rrggbb, so the current colors live in JS state, not in the inputs
const colorState = {
    inputBorder: CSS_DEFAULTS.inputBorder,
    inputFont: CSS_DEFAULTS.inputFont,
    buttonBorder: CSS_DEFAULTS.buttonBorder,
    buttonFont: CSS_DEFAULTS.buttonFont,
    onhover: CSS_DEFAULTS.onhover,
};

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value);

function readControls() {
    return { ...colorState };
}

function syncControls(values) {
    for (const [key, id] of COLOR_FIELDS) {
        const input = $(id);
        if (isHex(values[key])) input.value = values[key];
        colorState[key] = values[key];
        $(id + "-swatch").style.background = values[key];
    }
}

function updatePreview() {
    const { inputBorder, inputFont, buttonBorder, buttonFont } = readControls();
    els.previewInput.style.borderColor = inputBorder;
    els.previewInput.style.color = inputFont;
    els.previewButton.style.borderColor = buttonBorder;
    els.previewButton.style.color = buttonFont;
}

// The same selectors the legacy code styled
const INPUT_SELECTORS = ".toolbar-column, .yourfov";
const BUTTON_SELECTORS = ".toolbar-column-btns, .toolbar-column-first-settings-btns, .toolbar-column-settings-btns, .pin-public-key-from-encrypted-chat";

function updateButtonInputSettings() {
    const { inputBorder, inputFont, buttonBorder, buttonFont } = readControls();

    document.querySelectorAll(INPUT_SELECTORS).forEach((button) => {
        button.style.borderColor = inputBorder;
        button.style.color = inputFont;
    });

    document.querySelectorAll(BUTTON_SELECTORS).forEach((button) => {
        button.style.borderColor = buttonBorder;
        button.style.color = buttonFont;
    });

    updatePreview();
}

// Hover behavior: attached ONCE (the legacy code re-added these listeners
// on every slider drag, stacking duplicates)
document.querySelectorAll(BUTTON_SELECTORS).forEach((button) => {
    button.addEventListener("mouseover", () => {
        button.style.backgroundColor = colorState.onhover;
    });
    button.addEventListener("mouseout", () => {
        button.style.backgroundColor = "transparent";
        button.style.color = colorState.buttonFont;
    });
});

// Panel starts on the CSS values; the real elements are left untouched
syncControls(CSS_DEFAULTS);
updatePreview();

document.getElementById("save-button-button-input").addEventListener("click", async (event) => {
    event.stopPropagation();

    try {
        if (!signer) {
            toast.error("Connect wallet first");
            return;
        }
        const topicId = "0.0.9798047";

        const colors = readControls();

        if (!colors.inputBorder || !colors.inputFont || !colors.buttonBorder || !colors.buttonFont || !colors.onhover) {
            toast.error("Please fill in all color fields.");
            return;
        }

        const messageData = {
            data: {
                InputBorderColor: colors.inputBorder,
                InputFontColor: colors.inputFont,
                ButtonBorderColor: colors.buttonBorder,
                ButtonFontColor: colors.buttonFont,
                OnhoverButtonColor: colors.onhover,
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

export async function loadButtonInputSettings(a) {
  const topicId = "0.0.9798047";
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
          // Older messages may still carry FontForButtonInput,
          // ButtonInputHeight, ButtonInputWidth, RulesContainerColor, or
          // TransparencyButtonInput. Those are ignored.
          const { InputBorderColor, InputFontColor,
             ButtonBorderColor, ButtonFontColor,
              OnhoverButtonColor } = lastMessage.data;

          accountObjectSettings.push({
              InputBorderColor,
              InputFontColor,
              ButtonBorderColor,
              ButtonFontColor,
              OnhoverButtonColor,
          });

          syncControls({
              inputBorder: InputBorderColor,
              inputFont: InputFontColor,
              buttonBorder: ButtonBorderColor,
              buttonFont: ButtonFontColor,
              onhover: OnhoverButtonColor,
          });
          updateButtonInputSettings();
      }

      return accountObjectSettings;

  } catch (error) {
      console.log("Error in loadButtonInputSettings:", error);
      return [];
  }
  }

  // Reset: panel shows the CSS values and the inline overrides are cleared
  // from the elements, so the CSS rules style them again
  document.getElementById("reset-button-input").addEventListener("click", (event) => {
      event.stopPropagation();
      syncControls(CSS_DEFAULTS);
      document.querySelectorAll(`${INPUT_SELECTORS}, ${BUTTON_SELECTORS}`).forEach((element) => {
          element.style.removeProperty("border-color");
          element.style.removeProperty("font-size");
          element.style.removeProperty("color");
          element.style.removeProperty("height");
          element.style.removeProperty("width");
          element.style.removeProperty("background-color");
      });
      updatePreview();
      toast.info("Reset to defaults");
  });

  for (const [key, id] of COLOR_FIELDS) {
      $(id).addEventListener("input", (event) => {
          colorState[key] = event.target.value;
          $(id + "-swatch").style.background = colorState[key];
          updateButtonInputSettings();
      });
  }
