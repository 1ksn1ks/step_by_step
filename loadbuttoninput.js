import { getMessages, sendMessage } from "./hedera";

document.getElementById("save-button-button-input").addEventListener("click", async (event) => {
    event.stopPropagation();

    try {
        const topicId = "0.0.9798047";

        const InputBorderColor = document.getElementById("input-border-color").value;
        const InputFontColor = document.getElementById("input-font-color").value;
        const ButtonBorderColor = document.getElementById("button-border-color").value;
        const ButtonFontColor = document.getElementById("button-font-color").value;
        const OnhoverButtonColor = document.getElementById("onhover-button-color").value;
        const RulesContainerColor = document.getElementById("rules-container-color").value;
        const FontForButtonInput = Math.min(parseFloat(document.getElementById("font-for-button-input").value) || 1.5, 10);
        const TransparencyButtonInput = Math.min(parseFloat(document.getElementById("transparency-button-input").value) || 0.5, 1);
        const ButtonInputHeight = Math.min(parseFloat(document.getElementById("Button-Input-Height").value) || 3, 100);
        const ButtonInputWidth = Math.min(parseFloat(document.getElementById("Button-Input-Width").value) || 25, 100);

        const messageData = {
            data: {
                InputBorderColor: InputBorderColor,
                InputFontColor: InputFontColor,
                ButtonBorderColor: ButtonBorderColor,
                ButtonFontColor: ButtonFontColor,
                OnhoverButtonColor: OnhoverButtonColor,
                RulesContainerColor: RulesContainerColor,
                FontForButtonInput: FontForButtonInput,
                TransparencyButtonInput: TransparencyButtonInput,
                ButtonInputHeight: ButtonInputHeight,
                ButtonInputWidth: ButtonInputWidth,
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

export async function loadButtonInputSettings(a) {
  const topicId = "0.0.9798047";
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
          const { InputBorderColor, InputFontColor,
             ButtonBorderColor, ButtonFontColor,
              OnhoverButtonColor, FontForButtonInput,
               TransparencyButtonInput, RulesContainerColor,
               ButtonInputHeight, ButtonInputWidth } = lastMessage.data;

          accountObjectSettings.push({
              InputBorderColor,
              InputFontColor,
              ButtonBorderColor,
              ButtonFontColor,
              OnhoverButtonColor,
              RulesContainerColor,
              FontForButtonInput,
              TransparencyButtonInput,
              ButtonInputHeight,
              ButtonInputWidth,
          });


          document.getElementById("input-border-color").value = InputBorderColor;
          document.getElementById("input-font-color").value = InputFontColor;
          document.getElementById("button-border-color").value = ButtonBorderColor;
          document.getElementById("button-font-color").value = ButtonFontColor;
          document.getElementById("onhover-button-color").value = OnhoverButtonColor;
          document.getElementById("rules-container-color").value = RulesContainerColor;
          document.getElementById("font-for-button-input").value = FontForButtonInput;
          document.getElementById("transparency-button-input").value = TransparencyButtonInput;
          document.getElementById("Button-Input-Height").value = ButtonInputHeight;
          document.getElementById("Button-Input-Width").value = ButtonInputWidth;
          updateButtonInputSettings();
      }

      return accountObjectSettings;

  } catch (error) {
      console.log("Error in loadButtonInputSettings:", error);
      return [];
  }
  }

  function updateButtonInputSettings() {
      const inputFontColor = document.getElementById("input-font-color").value;
      const inputBorderColor = document.getElementById("input-border-color").value;
      const buttonFontColor = document.getElementById("button-font-color").value;
      const onhoverButtonColor = document.getElementById("onhover-button-color").value;
      const buttonBorderColor = document.getElementById("button-border-color").value;
      const rulesContainerColor = document.getElementById("rules-container-color").value;
      const fontForButtonInput = Math.min(parseFloat(document.getElementById("font-for-button-input").value) || 1.5, 10);
      const transparencyButtonInput = Math.min(parseFloat(document.getElementById("transparency-button-input").value) || 0.5, 1);
      const ButtonInputHeight = Math.min(parseFloat(document.getElementById("Button-Input-Height").value) || 5, 100);
      const ButtonInputWidth = Math.min(parseFloat(document.getElementById("Button-Input-Width").value) || 25, 100);
      const inputButtons = document.querySelectorAll('.toolbar-column, .yourfov');

      inputButtons.forEach(button => {
          button.style.borderColor = inputBorderColor;
          button.style.opacity = transparencyButtonInput;
          button.style.fontSize = fontForButtonInput + "vh" ;
          button.style.color = inputFontColor;
          button.style.height = ButtonInputHeight + "vh";
          button.style.width = ButtonInputWidth + "%";
      });

      const ButtonInputButtons = document.querySelectorAll('.toolbar-column-btns, .toolbar-column-first-settings-btns, .toolbar-column-settings-btns, .pin-public-key-from-encrypted-chat');
      ButtonInputButtons.forEach(button => {
          button.style.borderColor = buttonBorderColor;
          button.style.opacity = transparencyButtonInput;
          button.style.fontSize = fontForButtonInput + "vh" ;
          button.style.color = buttonFontColor;
          button.style.height = ButtonInputHeight + "vh";
          button.addEventListener('mouseover', () => {
              button.style.backgroundColor = onhoverButtonColor;
          });
          button.addEventListener('mouseout', () => {
              button.style.backgroundColor = 'transparent';
              button.style.color = buttonFontColor;
          });
      });

      const rulesContainer = document.querySelectorAll('.toolbar-column-loaded-rules');
      rulesContainer.forEach(rule => {
        rule.style.borderColor = rulesContainerColor;
        rule.style.height = ButtonInputHeight + "vh";
        rule.style.width = ButtonInputWidth + "%";
      });
  }

  const everythingInsdieButtonInput = [
    document.getElementById("input-border-color"),
    document.getElementById("input-font-color"),
    document.getElementById("button-border-color"),
    document.getElementById("button-font-color"),
    document.getElementById("onhover-button-color"),
    document.getElementById("rules-container-color"),
    document.getElementById("font-for-button-input"),
    document.getElementById("transparency-button-input"),
    document.getElementById("Button-Input-Height"),
    document.getElementById("Button-Input-Width"),
  ]

  everythingInsdieButtonInput.forEach(element => {
    element.addEventListener("input", (event) => {updateButtonInputSettings();});
  });