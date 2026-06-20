
import {
  everythinginsideoptionsbuttons,
  firstlayercolumns, 
  everythinginsideyourfov, 
  everythinginsidetoolbar,
  everyoverlay
} from './ui.js'
import { adjustTextareaHeight } from './adjusttextarea.js';
import { currentUfoModelInGLTF, globalLoadedTopicIdsWithNames} from './letall.js';
import { activePolygonPopups } from './polygons.js';
import { activeMarkerPopups } from './marker.js';
import { scene } from './threejs.js'

const toolbarColumns = document.querySelectorAll('.toolbar-column');

toolbarColumns.forEach(column => {
  column.addEventListener('touchstart', () => {
    column.classList.add('active'); // Add active class on touch
  });

  column.addEventListener('touchend', () => {
    column.classList.remove('active'); // Remove active class on touch end
  });
});

export function OpenToggleToolbar() {
    document.getElementById("main-toggle-btn").style.display = "none";
    document.getElementById("toggle-toolbar-btn-btn").style.display = "block";
    document.getElementById("topic-chat-btn").style.display = "block";
    document.getElementById("toggle-encrypted-chat-btn").style.display = "block";
  }
  
 export function OpenToggleYourFov() {
    document.getElementById("main-toggle-btn").style.display = "none";
    document.getElementById("toggle-your-fov-btn-btn").style.display = "block";
    document.getElementById("topic-chat-btn").style.display = "block";
    document.getElementById("toggle-encrypted-chat-btn").style.display = "block";
  }
  
export let popIsOpen = false;
export function changePopupState(a){
  popIsOpen = a
}

export let isinfo = true;
  
export function CloseALL() {
    everythinginsideoptionsbuttons.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    everythinginsideyourfov.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    everythinginsidetoolbar.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    firstlayercolumns.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    everyoverlay.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "none";
    });
    document.getElementById("main-toggle-btn").style.display = "block";
    document.getElementById("topic-chat-btn").style.display = "block";
    document.getElementById("toggle-encrypted-chat-btn").style.display = "block";
    document.getElementById("toggle-toolbar-btn-btn").style.display = "none";
    document.getElementById("toggle-your-fov-btn-btn").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "block";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
    document.getElementById("go-to-submit-message-encrypted-chat").style.display = "block";
    if (isinfo) {
      document.getElementById("show-manual").style.display = "block";
    } else {
      document.getElementById("hide-manual").style.display = "block";
    }
    if (popIsOpen === false) {
      if (currentUfoModelInGLTF) {
              scene.add(currentUfoModelInGLTF);
              crosshair.style.display = "block";
            }
    }
  }
  
  document.addEventListener('click', function(event) {
    CloseALL();
  });
  
 export function removeUfoModel() {
    if (currentUfoModelInGLTF) {
      scene.remove(currentUfoModelInGLTF);
      crosshair.style.display = "none";
    }
  }
  
  document.getElementById("main-toggle-btn").addEventListener("click", function(event) {
    event.stopPropagation();
    CloseALL();
    activePolygonPopups.forEach((popup) => popup.remove());
    activeMarkerPopups.forEach((popup) => popup.remove());
    document.getElementById("main-toggle-btn").style.display = "none";
    document.getElementById("topic-chat-btn").style.display = "none";
    document.getElementById("toggle-encrypted-chat-btn").style.display = "none";

    if (isinfo) {
      document.getElementById("show-manual").style.display = "none";
    } else {
      document.getElementById("hide-manual").style.display = "none";
    }

    everythinginsideoptionsbuttons.forEach(buttonId => {
      document.getElementById(buttonId).style.display = "flex";
    });
  });

  document.getElementById("show-manual").addEventListener("click", function(event) {
    event.stopPropagation();
    document.getElementById("show-manual").style.display = "none";
    document.getElementById("hide-manual").style.display = "block";
    isinfo = false;
  });

  document.getElementById("hide-manual").addEventListener("click", function(event) {
    event.stopPropagation();
    document.getElementById("show-manual").style.display = "block";
    document.getElementById("hide-manual").style.display = "none";
    isinfo = true;
  });
  
  // let toggleControlsPressCount = 0;
  
  // document.getElementById("toggle-controls-btn").addEventListener("click", (event) => {
  //   event.stopPropagation();
  //   CloseALL();
  //   const speedSlider = document.getElementById("speed-slider");
  //   const maplibreglCtrlGroup = document.querySelector(".maplibregl-ctrl.maplibregl-ctrl-group");
  //   toggleControlsPressCount++;
  //   if (toggleControlsPressCount === 1) {
  //     speedSlider.style.display = "block";
  //     if (maplibreglCtrlGroup) maplibreglCtrlGroup.style.display = "block";
  //   } else if (toggleControlsPressCount > 3) {
  //     speedSlider.style.display = "none";
  //     if (maplibreglCtrlGroup) maplibreglCtrlGroup.style.display = "none";
  //     toggleControlsPressCount = 0;
  //   }
  //   const zoomControls = document.getElementById("zoom-controls");
  //   const leftDpad = document.getElementById("left-dpad");
  //   const rightDpad = document.getElementById("right-dpad");
  //   const isVisible = getComputedStyle(zoomControls).display !== "none";
  //   if (isVisible) {
  //     zoomControls.setAttribute("style", "display: none !important");
  //     leftDpad.setAttribute("style", "display: none !important");
  //     rightDpad.setAttribute("style", "display: none !important");
  //   } else {
  //     zoomControls.setAttribute("style", "display: flex !important; z-index: 2000 !important; opacity: 1 !important; visibility: visible !important;");
  //     leftDpad.setAttribute("style", "display: grid !important; z-index: 2000 !important; opacity: 1 !important; visibility: visible !important;");
  //     rightDpad.setAttribute("style", "display: grid !important; z-index: 2000 !important; opacity: 1 !important; visibility: visible !important;");
  //   }
  // });
  
  document.getElementById("toggle-visibility-controls-btn").addEventListener("click", function(event) {
    event.stopPropagation();
    CloseALL();
    document.getElementById("visibility-controls").style.display = "block";
    removeUfoModel();
  });
  
  document.getElementById("toggle-your-fov-btn").addEventListener("click", function(event) {
    event.stopPropagation();
    CloseALL();
    document.getElementById("rotation-controls").style.display = "block";
  });
  
  document.getElementById("toggle-your-fov-btn-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    activePolygonPopups.forEach((popup) => popup.remove());
    activeMarkerPopups.forEach((popup) => popup.remove());
    document.getElementById("rotation-controls").style.display = "block";
  });
  
  document.getElementById("change-model-settings").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("model-column").style.display = "block";
    document.getElementById("model-column-container").style.display = "block";
    document.getElementById("model-column-save").style.display = "block";
    document.getElementById("model-column-container-save").style.display = "block";

    if (isinfo) {
      document.getElementById("change-model-help-overlay").style.display = "block";
    }
    
    OpenToggleYourFov();
  });
  
  document.getElementById("change-crosshair-settings").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("crosshair-column").style.display = "block";
    document.getElementById("crosshair-column-container").style.display = "block";
    document.getElementById("crosshair-column-save").style.display = "block";
    document.getElementById("crosshair-column-container-save").style.display = "block";

    if (isinfo) {
      document.getElementById("crosshair-settings-help-overlay").style.display = "block";
    }

    OpenToggleYourFov();
  });

  document.getElementById("change-marker-options").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("marker-options-column").style.display = "block";
    document.getElementById("marker-options-column-container").style.display = "block";
    document.getElementById("marker-column-save").style.display = "block";
    document.getElementById("marker-column-container-save").style.display = "block";

    if (isinfo) {
      document.getElementById("marker-size-help-overlay").style.display = "block";
    }
    
    OpenToggleYourFov();
    removeUfoModel();
  });
  
  document.getElementById("change-color-of-main-buttons").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("main-button-column").style.display = "block";
    document.getElementById("main-button-column-container").style.display = "block";
    document.getElementById("main-button-column-save").style.display = "block";
    document.getElementById("main-button-column-container-save").style.display = "block";

    if (isinfo) {
      document.getElementById("main-buttons-style-help-overlay").style.display = "block";
    }

    OpenToggleYourFov();
    removeUfoModel();
  });
  
  document.getElementById("change-button-input-settings").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("button-input-column").style.display = "block";
    document.getElementById("button-input-column-container").style.display = "block";
    document.getElementById("button-input-column-save").style.display = "block";
    document.getElementById("button-input-column-container-save").style.display = "block";

    if (isinfo) {
      document.getElementById("main-buttons-advanced-style-help-overlay").style.display = "block";
    }
    
    OpenToggleYourFov();
    removeUfoModel();
  });
  
  document.getElementById("change-topic-chat-options").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("topic-chat-column").style.display = "block";
    document.getElementById("topic-chat-column-container").style.display = "block";
    document.getElementById("topic-chat-save").style.display = "block";
    document.getElementById("topic-chat-container-save").style.display = "block";
    
    if (isinfo) {
      document.getElementById("chat-style-help-overlay").style.display = "block";
    }

    OpenToggleYourFov();
    removeUfoModel();
  });
  
  document.getElementById("toggle-toolbar-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("toolbar").style.display = "block";
    removeUfoModel();
  });
  
  document.getElementById("Edit_Profile").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("Edit_Profile-column").style.display = "block";
    document.getElementById("Edit_Profile-column-container").style.display = "block";

    if (isinfo) {
      document.getElementById("edit-profile-help-overlay").style.display = "block";
    }

    OpenToggleToolbar();
    removeUfoModel();
  });
  
  document.getElementById("Load_Everything").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    loadColumnsEverything();
    loadColumnsHideOptionsload();
    document.getElementById("show-options-from-load").style.display = "block";
    document.getElementById("hide-options-from-load").style.display = "none";
    document.getElementById("load-column").style.display = "block";
    document.getElementById("load-column-container").style.display = "block";
    const loaded_text_area = document.getElementById("loaded-topics");
    loaded_text_area.innerHTML = '';
    loaded_text_area.innerHTML = globalLoadedTopicIdsWithNames.join('<br>');

    if (isinfo) {
      document.getElementById("load-options-help-overlay").style.display = "block";
    }

    adjustTextareaHeight(loaded_text_area);
    OpenToggleToolbar();
    removeUfoModel();
  });
  
  document.getElementById("Create_New_Topic").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("create-column").style.display = "block";
    document.getElementById("create-column-container").style.display = "block";

    if (isinfo) {
      document.getElementById("create-topic-help-overlay").style.display = "block";
    }

    OpenToggleToolbar();
    removeUfoModel();
  });


  
  document.getElementById("Draw_Marker_Polygon").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("draw-column").style.display = "block";
    document.getElementById("draw-column-container").style.display = "block";

    if (isinfo) {
      document.getElementById("map-draw-help-overlay").style.display = "block";
    }

    OpenToggleToolbar();
    removeUfoModel();
  });
  
  
  document.getElementById("Set_Rules").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("rules-column").style.display = "block";
    document.getElementById("rules-column-container").style.display = "block";

    if (isinfo) {
      document.getElementById("topic-rules-help-overlay").style.display = "block";
    }

    OpenToggleToolbar();
    removeUfoModel();
  });
  
  document.getElementById("NFT-utility").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("utility-column").style.display = "block";
    document.getElementById("utility-column-container").style.display = "block";

    if (isinfo) {
      document.getElementById("model-sharing-rules-help-overlay").style.display = "block";
    }

    OpenToggleToolbar();
    removeUfoModel();
  });
  
  document.getElementById("Change_Memo").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("memo-column").style.display = "block";
    document.getElementById("memo-column-container").style.display = "block";

    if (isinfo) {
      document.getElementById("edit-topic-rules-help-overlay").style.display = "block";
    }
    OpenToggleToolbar();
    removeUfoModel();
  });
  
  document.getElementById("Stack_topic_IDs").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("stack-topic-ids").style.display = "block";
    document.getElementById("stack-topic-ids-container").style.display = "block";

    if (isinfo) {
      document.getElementById("stack-topic-ids-help-overlay").style.display = "block";
    }

    OpenToggleToolbar();
    removeUfoModel();
  });
  
  document.getElementById("topic-chat-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    hideAllShowButtonsFromTopicChat()
    activePolygonPopups.forEach((popup) => popup.remove());
    activeMarkerPopups.forEach((popup) => popup.remove());
    document.getElementById("topic-chat-container").style.display = "block";
    document.getElementById("options-from-topic-chat").style.display = "none";
    document.getElementById("show-options-from-topic-chat").style.display = "block";
    document.getElementById("show-options-from-topic-chat-btn").style.display = "none";

    if (isinfo) {
      document.getElementById("topic-chat-help-overlay").style.display = "block";
    }

    removeUfoModel();
  });
  
  document.getElementById("show-options-from-topic-chat").addEventListener("click", (event) => {
    document.getElementById("options-from-topic-chat").style.display = "block";
    document.getElementById("show-options-from-topic-chat").style.display = "none";
    document.getElementById("show-options-from-topic-chat-btn").style.display = "block";
    showAllShowButtonsFromTopicChatOptions()
  });
  
  document.getElementById("show-options-from-topic-chat-btn").addEventListener("click", (event) => {
    document.getElementById("options-from-topic-chat").style.display = "none";
    document.getElementById("show-options-from-topic-chat-btn").style.display = "none";
    document.getElementById("show-options-from-topic-chat").style.display = "block";
    hideAllShowButtonsFromTopicChat()
  });
  







  const allShowButtonsFromTopicChat = [
    document.getElementById("time-from-topic-chat"),
    document.getElementById("time-from-topic-chat-filter"),
    document.getElementById("load-msgs-from-ids-from-topic-chat"),
    document.getElementById("load-blocks-from-ids-from-topic-chat"),
    document.getElementById("load-load-from-users-label-from-topic-chat"),
    document.getElementById("load-load-from-users-from-topic-chat"),
    document.getElementById("load-block-from-users-label-from-topic-chat"),
    document.getElementById("load-block-from-users-from-topic-chat"),
    document.getElementById("hide-time-from-topic-chat"),
    document.getElementById("hide-from-from-topic-chat"),
    document.getElementById("hide-block-from-topic-chat"),
  ];
  
  function hideAllShowButtonsFromTopicChat() {
    allShowButtonsFromTopicChat.forEach(element => {
    element.style.display = "none";
  });
  }
  
  const allShowButtonsFromTopicChatOptions = [
    document.getElementById("show-time-from-topic-chat"),
    document.getElementById("show-from-from-topic-chat"),
    document.getElementById("show-block-from-topic-chat"),
  ];
  
  function showAllShowButtonsFromTopicChatOptions() {
    allShowButtonsFromTopicChatOptions.forEach(element => {
    element.style.display = "block";
  });
  }
  
  document.getElementById("show-time-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("time-from-topic-chat").style.display = "block";
    document.getElementById("time-from-topic-chat-filter").style.display = "flex";
    document.getElementById("hide-time-from-topic-chat").style.display = "block";
    document.getElementById("show-time-from-topic-chat").style.display = "none";
  });
  
  document.getElementById("hide-time-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("hide-time-from-topic-chat").style.display = "none";
    document.getElementById("show-time-from-topic-chat").style.display = "block";
  });
  
  document.getElementById("show-from-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("load-msgs-from-ids-from-topic-chat").style.display = "block";
    document.getElementById("load-load-from-users-label-from-topic-chat").style.display = "block";
    document.getElementById("load-load-from-users-from-topic-chat").style.display = "flex";
    document.getElementById("hide-from-from-topic-chat").style.display = "block";
    document.getElementById("show-from-from-topic-chat").style.display = "none";
  });
  
  document.getElementById("hide-from-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("hide-from-from-topic-chat").style.display = "none";
    document.getElementById("show-from-from-topic-chat").style.display = "block";
  });
  
  document.getElementById("show-block-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("load-block-from-users-from-topic-chat").style.display = "flex";
    document.getElementById("load-blocks-from-ids-from-topic-chat").style.display = "block";
    document.getElementById("load-block-from-users-label-from-topic-chat").style.display = "block";
    document.getElementById("hide-block-from-topic-chat").style.display = "block";
    document.getElementById("show-block-from-topic-chat").style.display = "none";
  });
  
  document.getElementById("hide-block-from-topic-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromTopicChat()
    showAllShowButtonsFromTopicChatOptions()
    document.getElementById("hide-block-from-topic-chat").style.display = "none";
    document.getElementById("show-block-from-topic-chat").style.display = "block";
  });
  








  
  const allShowButtonsFromEncryptedChat = [
    document.getElementById("time-from-encrypted-chat"),
    document.getElementById("time-from-encrypted-chat-filter"),
    document.getElementById("load-msgs-from-ids-from-encrypted-chat"),
    document.getElementById("load-blocks-from-ids-from-encrypted-chat"),
    document.getElementById("load-load-from-users-label-from-encrypted-chat"),
    document.getElementById("load-load-from-users-from-encrypted-chat"),
    document.getElementById("load-block-from-users-label-from-encrypted-chat"),
    document.getElementById("load-block-from-users-from-encrypted-chat"),
    document.getElementById("pin-public-key-from-encrypted-chat"),
    document.getElementById("hide-pin-public-key-from-encrypted-chat"),
    document.getElementById("hide-block-from-encrypted-chat"),
    document.getElementById("hide-from-from-encrypted-chat"),
    document.getElementById("hide-time-from-encrypted-chat"),
    document.getElementById("hide-block-change-password-encrypted-chat"),
    document.getElementById("hide-time-set-password-encrypted-chat"),
    document.getElementById("encrypted-chat-change-password-key"),
    document.getElementById("encrypted-chat-new-password-key"),
    document.getElementById("change-password-encrypted-chat"),
    document.getElementById("set-password-encrypted-chat"),
    document.getElementById("encrypted-chat-public-key"),
  ];
  
  function hideAllShowButtonsFromEncryptedChat() {
    allShowButtonsFromEncryptedChat.forEach(element => {
    element.style.display = "none";
  });
  }
  
  const allShowButtonsFromEncryptedChatOptions = [
    document.getElementById("show-time-from-encrypted-chat"),
    document.getElementById("show-from-from-encrypted-chat"),
    document.getElementById("show-block-from-encrypted-chat"),
    document.getElementById("show-pin-public-key-from-encrypted-chat"),
    document.getElementById("go-to-submit-message-encrypted-chat"),
    document.getElementById("show-block-change-password-encrypted-chat"),
    document.getElementById("show-time-set-password-encrypted-chat"),
  ];
  
  function showAllShowButtonsFromEncryptedChatOptions() {
    allShowButtonsFromEncryptedChatOptions.forEach(element => {
    element.style.display = "block";
  });
  }
  
  document.getElementById("show-time-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("time-from-encrypted-chat").style.display = "block";
    document.getElementById("time-from-encrypted-chat-filter").style.display = "flex";
    document.getElementById("hide-time-from-encrypted-chat").style.display = "block";
    document.getElementById("show-time-from-encrypted-chat").style.display = "none";
  });
  
  document.getElementById("hide-time-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("hide-time-from-encrypted-chat").style.display = "none";
    document.getElementById("show-time-from-encrypted-chat").style.display = "block";
  });
  
  document.getElementById("show-from-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("load-msgs-from-ids-from-encrypted-chat").style.display = "block";
    document.getElementById("load-load-from-users-label-from-encrypted-chat").style.display = "block";
    document.getElementById("load-load-from-users-from-encrypted-chat").style.display = "flex";
    document.getElementById("hide-from-from-encrypted-chat").style.display = "block";
    document.getElementById("show-from-from-encrypted-chat").style.display = "none";
  });
  
  document.getElementById("hide-from-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("hide-from-from-encrypted-chat").style.display = "none";
    document.getElementById("show-from-from-encrypted-chat").style.display = "block";
  });
  
  document.getElementById("show-block-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("load-block-from-users-from-encrypted-chat").style.display = "flex";
    document.getElementById("load-blocks-from-ids-from-encrypted-chat").style.display = "block";
    document.getElementById("load-block-from-users-label-from-encrypted-chat").style.display = "block";
    document.getElementById("hide-block-from-encrypted-chat").style.display = "block";
    document.getElementById("show-block-from-encrypted-chat").style.display = "none";
  });
  
  document.getElementById("hide-block-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("hide-block-from-encrypted-chat").style.display = "none";
    document.getElementById("show-block-from-encrypted-chat").style.display = "block";
  });
  
  document.getElementById("show-pin-public-key-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("pin-public-key-from-encrypted-chat").style.display = "block";
    document.getElementById("encrypted-chat-public-key").style.display = "block";

    document.getElementById("hide-pin-public-key-from-encrypted-chat").style.display = "block";
    document.getElementById("show-pin-public-key-from-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "none";
    document.getElementById("encrypted-chat-chat-container").style.display = "none";
    document.getElementById("go-to-submit-message-encrypted-chat").style.display = "none";
  });
  
  document.getElementById("hide-pin-public-key-from-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("hide-pin-public-key-from-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-public-key").style.display = "none";

    document.getElementById("show-pin-public-key-from-encrypted-chat").style.display = "block";
    document.getElementById("go-to-submit-message-encrypted-chat").style.display = "block";
    document.getElementById("encrypted-chat-private-key-container").style.display = "block";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
  });

  document.getElementById("show-block-change-password-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("change-password-encrypted-chat").style.display = "block";
    document.getElementById("encrypted-chat-change-password-key").style.display = "block";
    document.getElementById("encrypted-chat-new-password-key").style.display = "block";
    document.getElementById("hide-block-change-password-encrypted-chat").style.display = "block";
    document.getElementById("show-block-change-password-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "none";
    document.getElementById("encrypted-chat-chat-container").style.display = "none";
    document.getElementById("go-to-submit-message-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-public-key").style.display = "none";

  });
  
  document.getElementById("hide-block-change-password-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("go-to-submit-message-encrypted-chat").style.display = "block";
    document.getElementById("encrypted-chat-public-key").style.display = "block";
    document.getElementById("encrypted-chat-private-key-container").style.display = "block";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
  });

  document.getElementById("show-time-set-password-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("set-password-encrypted-chat").style.display = "block";
    document.getElementById("encrypted-chat-change-password-key").style.display = "block";
    document.getElementById("encrypted-chat-new-password-key").style.display = "block";
    document.getElementById("hide-time-set-password-encrypted-chat").style.display = "block";
    document.getElementById("show-time-set-password-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-private-key-container").style.display = "none";
    document.getElementById("encrypted-chat-chat-container").style.display = "none";
    document.getElementById("go-to-submit-message-encrypted-chat").style.display = "none";
    document.getElementById("encrypted-chat-public-key").style.display = "none";
  });
  
  document.getElementById("hide-time-set-password-encrypted-chat").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("go-to-submit-message-encrypted-chat").style.display = "block";
    document.getElementById("encrypted-chat-public-key").style.display = "block";
    document.getElementById("encrypted-chat-private-key-container").style.display = "block";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
  });
  
  document.getElementById("toggle-toolbar-btn-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    document.getElementById("toolbar").style.display = "block";
    removeUfoModel();
  });
  
  document.getElementById("toggle-encrypted-chat-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    CloseALL();
    activePolygonPopups.forEach((popup) => popup.remove());
    activeMarkerPopups.forEach((popup) => popup.remove());
    hideAllShowButtonsFromEncryptedChat()
    document.getElementById("encrypted-chat-container").style.display = "block";
    document.getElementById("options-from-encrypted-chat").style.display = "none";
    document.getElementById("show-options-from-encrypted-chat").style.display = "block";
    document.getElementById("show-options-from-encrypted-chat-btn").style.display = "none";

    if (isinfo) {
    document.getElementById("e2ee-chat-help-overlay").style.display = "block";
    }

    removeUfoModel();
  });
  
  document.getElementById("show-options-from-encrypted-chat").addEventListener("click", (event) => {
    showAllShowButtonsFromEncryptedChatOptions()
    document.getElementById("options-from-encrypted-chat").style.display = "block";
    document.getElementById("show-options-from-encrypted-chat").style.display = "none";
    document.getElementById("show-options-from-encrypted-chat-btn").style.display = "block";
  });
  
  document.getElementById("show-options-from-encrypted-chat-btn").addEventListener("click", (event) => {
    hideAllShowButtonsFromEncryptedChat()
    document.getElementById("options-from-encrypted-chat").style.display = "none";
    document.getElementById("show-options-from-encrypted-chat-btn").style.display = "none";
    document.getElementById("show-options-from-encrypted-chat").style.display = "block";
    document.getElementById("go-to-submit-message-encrypted-chat").style.display = "block";
    document.getElementById("encrypted-chat-private-key-container").style.display = "block";
    document.getElementById("encrypted-chat-chat-container").style.display = "block";
  
  });
  







  function closePopupColumn3options() {
    document.getElementById("popup-column-3-border").style.display = "none";
    document.getElementById("popup-column-3-number").style.display = "none";
    document.getElementById("popup-column-3-close").style.display = "none";
    document.getElementById("popup-column-3-accid").style.display = "none";
    document.getElementById("popup-column-3-username").style.display = "none";
    document.getElementById("popup-column-3-titles").style.display = "none";
    document.getElementById("popup-column-3-text").style.display = "none";
    document.getElementById("popup-column-3-font").style.display = "none";
    removeUfoModel();
  };
  
  document.getElementById("popup-column-2-border").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-border").style.display = "block";
  });
  
  document.getElementById("popup-column-2-number").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-number").style.display = "block";
  });
  
  document.getElementById("popup-column-2-close").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-close").style.display = "block";
  });
  
  document.getElementById("popup-column-2-accid").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-accid").style.display = "block";
  });
  
  document.getElementById("popup-column-2-username").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-username").style.display = "block";
  });
  
  document.getElementById("popup-column-2-titles").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-titles").style.display = "block";
  });
  
  document.getElementById("popup-column-2-text").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-text").style.display = "block";
  });
  
  document.getElementById("popup-column-2-font").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopupColumn3options()
    document.getElementById("popup-column-3-font").style.display = "block";
  });
  
  
  




  
  
  const allOptionsFromNFTUtility = [
    document.getElementById("hide-topic-rules-from-nft-utility"),
    document.getElementById("hide-model-sharing-from-nft-utility"),
    document.getElementById("hide-model-size-scale-factor-from-nft-utility"),
    document.getElementById("hide-topic-chat-from-nft-utility"),
    document.getElementById("topic-rules-from-nft-utility"),
    document.getElementById("model-sharing-from-nft-utility-label"),
    document.getElementById("model-sharing-from-nft-utility"),
    document.getElementById("model-sharing-from-nft-utility-button-group"),
    document.getElementById("model-size-scale-factor-from-nft-utility"),
    document.getElementById("topic-chat-from-nft-utility"),
  ];
  
  function hideAllInnerOptionsFromNFTUtility() {
    allOptionsFromNFTUtility.forEach(element => {
    element.style.display = "none";
  });
  }
  
  const allShowButtonsFromNFTUtility = [
    document.getElementById("show-topic-rules-from-nft-utility"),
    document.getElementById("show-model-sharing-from-nft-utility"),
    document.getElementById("show-model-size-scale-factor-from-nft-utility"),
    document.getElementById("show-topic-chat-from-nft-utility"),
  ];
  
  function showAllInnerOptionsFromNFTUtility() {
    allShowButtonsFromNFTUtility.forEach(element => {
    element.style.display = "block";
  });
  }
  
  document.getElementById("show-topic-rules-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("topic-rules-from-nft-utility").style.display = "block";
    document.getElementById("hide-topic-rules-from-nft-utility").style.display = "block";
    document.getElementById("show-topic-rules-from-nft-utility").style.display = "none";
  });
  
  document.getElementById("hide-topic-rules-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });
  
  document.getElementById("show-model-sharing-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("model-sharing-from-nft-utility").style.display = "block";
    document.getElementById("hide-model-sharing-from-nft-utility").style.display = "block";
    document.getElementById("show-model-sharing-from-nft-utility").style.display = "none";
    document.getElementById("model-sharing-from-nft-utility-button-group").style.display = "block";
    document.getElementById("model-sharing-from-nft-utility-label").style.display = "block";
  });
  
  document.getElementById("hide-model-sharing-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });
  
  document.getElementById("show-model-size-scale-factor-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("model-sharing-from-nft-utility-label").style.display = "block";
    document.getElementById("model-size-scale-factor-from-nft-utility").style.display = "block";
    document.getElementById("hide-model-size-scale-factor-from-nft-utility").style.display = "block";
    document.getElementById("show-model-size-scale-factor-from-nft-utility").style.display = "none";
    document.getElementById("model-sharing-from-nft-utility").style.display = "block";
  });
  
  document.getElementById("hide-model-size-scale-factor-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });
  
  document.getElementById("show-topic-chat-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
    document.getElementById("topic-chat-from-nft-utility").style.display = "block";
    document.getElementById("hide-topic-chat-from-nft-utility").style.display = "block";
    document.getElementById("show-topic-chat-from-nft-utility").style.display = "none";
  });
  
  document.getElementById("hide-topic-chat-from-nft-utility").addEventListener("click", (event) => {
    hideAllInnerOptionsFromNFTUtility()
    showAllInnerOptionsFromNFTUtility()
  });
  
  
// ==================== HELPER FUNCTIONS (reuse from before) ====================

function showElements(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "block";
  });
}

function showElementsFlex(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "flex";
  });
}

function hideElements(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}

// ==================== MARKER EVENT LISTENERS ====================

document.getElementById("show-topic-rules-from-marker").addEventListener("click", () => {
  showElements(
    "loaded-topic-rules-from-marker",
    "hide-topic-rules-from-marker",
    "input-field-2-0",
  );
  hideElements(
    "show-topic-rules-from-marker",
    "input-field-number-of-marker",
    "input-field-2-3",
    "input-field-coverimage-marker",
    "input-field-2-1",
    "input-field-image-marker",
    "input-field-2-2",
    "char-counter-marker",
    "marker-submit-buttons"
  );

  hideElements("optional-settings-from-marker", "hide-optional-settings-from-marker");
  showElements("show-optional-settings-marker");

  hideElements("delete-marker-from-marker", "hide-delete-marker-from-marker");
  showElements("show-delete-marker-from-marker");
});

document.getElementById("hide-topic-rules-from-marker").addEventListener("click", () => {
  hideElements("loaded-topic-rules-from-marker", "hide-topic-rules-from-marker");
  showElements("show-topic-rules-from-marker");

  showElements(
    "input-field-number-of-marker",
    "input-field-2-3",
    "input-field-coverimage-marker",
    "input-field-2-1",
    "input-field-image-marker",
    "input-field-2-2",
    "char-counter-marker",
  );

  showElementsFlex(
    "marker-submit-buttons"
  )
});

document.getElementById("show-optional-settings-marker").addEventListener("click", () => {
  showElements("optional-settings-from-marker", "hide-optional-settings-from-marker");
  hideElements("show-optional-settings-marker");

  showElements(
    "input-field-number-of-marker",
    "input-field-2-3",
    "input-field-coverimage-marker",
    "input-field-2-1",
    "input-field-image-marker",
    "input-field-2-2",
    "char-counter-marker",
  );

  showElementsFlex(
    "marker-submit-buttons"
  )

  hideElements("delete-marker-from-marker", "hide-delete-marker-from-marker");
  showElements("show-delete-marker-from-marker");

  hideElements("loaded-topic-rules-from-marker", "hide-topic-rules-from-marker");
  showElements("show-topic-rules-from-marker");
});

document.getElementById("hide-optional-settings-from-marker").addEventListener("click", () => {
  hideElements("optional-settings-from-marker", "hide-optional-settings-from-marker");
  showElements("show-optional-settings-marker");

  hideElements("delete-marker-from-marker", "hide-delete-marker-from-marker");
  showElements("show-delete-marker-from-marker");

  hideElements("loaded-topic-rules-from-marker", "hide-topic-rules-from-marker");
  showElements("show-topic-rules-from-marker");
});

document.getElementById("show-delete-marker-from-marker").addEventListener("click", () => {
  showElements("delete-marker-from-marker", "hide-delete-marker-from-marker");
  hideElements("show-delete-marker-from-marker");

  hideElements(
    "input-field-number-of-marker",
    "input-field-2-3",
    "input-field-coverimage-marker",
    "input-field-2-1",
    "input-field-image-marker",
    "input-field-2-2",
    "char-counter-marker",
    "marker-submit-buttons"
  );

  hideElements("optional-settings-from-marker", "hide-optional-settings-from-marker");
  showElements("show-optional-settings-marker");

  hideElements("loaded-topic-rules-from-marker", "hide-topic-rules-from-marker");
  showElements("show-topic-rules-from-marker");
});

document.getElementById("hide-delete-marker-from-marker").addEventListener("click", () => {
  hideElements("delete-marker-from-marker", "hide-delete-marker-from-marker");
  showElements("show-delete-marker-from-marker");

  showElements(
    "input-field-number-of-marker",
    "input-field-2-3",
    "input-field-coverimage-marker",
    "input-field-2-1",
    "input-field-image-marker",
    "input-field-2-2",
    "char-counter-marker",
  );

  showElementsFlex(
    "marker-submit-buttons"
  )

});
  
  document.getElementById("show-new-topic-from-create").addEventListener("click", (event) => {
    document.getElementById("new-topic-from-create").style.display = "block";
    document.getElementById("hide-new-topic-from-create").style.display = "block";
    document.getElementById("show-new-topic-from-create").style.display = "none";
  });
  
  document.getElementById("hide-new-topic-from-create").addEventListener("click", (event) => {
    document.getElementById("new-topic-from-create").style.display = "none";
    document.getElementById("hide-new-topic-from-create").style.display = "none";
    document.getElementById("show-new-topic-from-create").style.display = "block";
  });
  
  document.getElementById("show-new-keys-from-create").addEventListener("click", (event) => {
    document.getElementById("new-keys-from-create").style.display = "block";
    document.getElementById("hide-new-keys-from-create").style.display = "block";
    document.getElementById("show-new-keys-from-create").style.display = "none";
  });
  
  document.getElementById("hide-new-keys-from-create").addEventListener("click", (event) => {
    document.getElementById("new-keys-from-create").style.display = "none";
    document.getElementById("hide-new-keys-from-create").style.display = "none";
    document.getElementById("show-new-keys-from-create").style.display = "block";
  });

  document.getElementById("show-draw-marker").addEventListener("click", (event) => {
    document.getElementById("polygon-column-container").style.display = "none";
    document.getElementById("marker-column-container").style.display = "block";
    document.getElementById("hide-draw-marker").style.display = "block";
    document.getElementById("show-draw-marker").style.display = "none";
    document.getElementById("hide-draw-polygon").style.display = "none";
    document.getElementById("show-draw-polygon").style.display = "block";
  });
  
  document.getElementById("hide-draw-marker").addEventListener("click", (event) => {
    document.getElementById("marker-column-container").style.display = "none";
    document.getElementById("hide-draw-marker").style.display = "none";
    document.getElementById("show-draw-marker").style.display = "block";
  });
  
  document.getElementById("show-draw-polygon").addEventListener("click", (event) => {
    document.getElementById("marker-column-container").style.display = "none";
    document.getElementById("polygon-column-container").style.display = "block";
    document.getElementById("hide-draw-polygon").style.display = "block";
    document.getElementById("show-draw-polygon").style.display = "none";
    document.getElementById("hide-draw-marker").style.display = "none";
    document.getElementById("show-draw-marker").style.display = "block";
  });
  
  document.getElementById("hide-draw-polygon").addEventListener("click", (event) => {
    document.getElementById("polygon-column-container").style.display = "none";
    document.getElementById("hide-draw-polygon").style.display = "none";
    document.getElementById("show-draw-polygon").style.display = "block";
  });
  

// ==================== EVENT LISTENERS ====================

document.getElementById("show-topic-rules-from-polygon").addEventListener("click", () => {
  showElements(
    "loaded-topic-rules-from-polygon",
    "hide-topic-rules-from-polygon"
  );
  hideElements(
    "show-topic-rules-from-polygon",
    "input-field-number-of-polygon",
    "input-field-3-3",
    "input-field-3-5",
    "input-field-3-2",
    "char-counter-polygon",
    "polygon-submit-buttons"
  );

  hideElements("optional-settings-from-polygon", "hide-optional-settings-from-polygon");
  showElements("show-optional-settings-polygon");

  hideElements("delete-polygon-from-polygon", "hide-delete-polygon-from-polygon");
  showElements("show-delete-polygon-from-polygon");
});

document.getElementById("hide-topic-rules-from-polygon").addEventListener("click", () => {
  hideElements("loaded-topic-rules-from-polygon", "hide-topic-rules-from-polygon");
  showElements("show-topic-rules-from-polygon");

  showElements(
    "input-field-number-of-polygon",
    "input-field-3-3",
    "input-field-3-5",
    "input-field-3-2",
    "char-counter-polygon",
  );
  showElementsFlex(
    "polygon-submit-buttons"
  )

});

document.getElementById("show-optional-settings-polygon").addEventListener("click", () => {
  showElements("optional-settings-from-polygon", "hide-optional-settings-from-polygon");
  hideElements("show-optional-settings-polygon");

  showElements(
    "input-field-number-of-polygon",
    "input-field-3-3",
    "input-field-3-5",
    "input-field-3-2",
    "char-counter-polygon",
  );
  showElementsFlex(
    "polygon-submit-buttons"
  )

  hideElements("delete-polygon-from-polygon", "hide-delete-polygon-from-polygon");
  showElements("show-delete-polygon-from-polygon");

  hideElements("loaded-topic-rules-from-polygon", "hide-topic-rules-from-polygon");
  showElements("show-topic-rules-from-polygon");
});

document.getElementById("hide-optional-settings-from-polygon").addEventListener("click", () => {
  hideElements("optional-settings-from-polygon", "hide-optional-settings-from-polygon");
  showElements("show-optional-settings-polygon");

  hideElements("delete-polygon-from-polygon", "hide-delete-polygon-from-polygon");
  showElements("show-delete-polygon-from-polygon");

  hideElements("loaded-topic-rules-from-polygon", "hide-topic-rules-from-polygon");
  showElements("show-topic-rules-from-polygon");
});

document.getElementById("show-delete-polygon-from-polygon").addEventListener("click", () => {
  showElements("delete-polygon-from-polygon", "hide-delete-polygon-from-polygon");
  hideElements("show-delete-polygon-from-polygon");

  hideElements(
    "input-field-number-of-polygon",
    "input-field-3-3",
    "input-field-3-5",
    "input-field-3-2",
    "char-counter-polygon",
    "polygon-submit-buttons"
  );

  hideElements("optional-settings-from-polygon", "hide-optional-settings-from-polygon");
  showElements("show-optional-settings-polygon");

  hideElements("loaded-topic-rules-from-polygon", "hide-topic-rules-from-polygon");
  showElements("show-topic-rules-from-polygon");
});

document.getElementById("hide-delete-polygon-from-polygon").addEventListener("click", () => {
  hideElements("delete-polygon-from-polygon", "hide-delete-polygon-from-polygon");
  showElements("show-delete-polygon-from-polygon");

  showElements(
    "input-field-number-of-polygon",
    "input-field-3-3",
    "input-field-3-5",
    "input-field-3-2",
    "char-counter-polygon",
  );
  showElementsFlex(
    "polygon-submit-buttons"
  )
});

  
  
  
  
  
  
  
  const insideEditProfileEverything = [
    document.getElementById("edit-profile-url-name-domain"),
    document.getElementById("edit-profile-picture"),
    document.getElementById("edit-profile-username"),
    document.getElementById("edit-profile-click2link"),
    document.getElementById("edit-profile-topic-id"),
    document.getElementById("edit-profile-topic-id-name"),
    document.getElementById("edit-profile-topic-id-name-topic2pic"),
    document.getElementById("edit-profile-domain-time-left"),
  ];
  
  const insideEditProfileShowOptions = [
    document.getElementById("show-profile-picture-from-edit-profile"),
    document.getElementById("show-username-from-edit-profile"),
    document.getElementById("show-click2link-from-edit-profile"),
    document.getElementById("show-topic-id-name-from-edit-profile"),
    document.getElementById("show-topic-id-to-pfp-from-edit-profile"),
    document.getElementById("show-check-domain-availability-from-edit-profile"),
  ];
  
  
  const insideEditProfileHideOptions = [
    document.getElementById("hide-profile-picture-from-edit-profile"),
    document.getElementById("hide-username-from-edit-profile"),
    document.getElementById("hide-click2link-from-edit-profile"),
    document.getElementById("hide-topic-id-name-from-edit-profile"),
    document.getElementById("hide-topic-id-to-pfp-from-edit-profile"),
    document.getElementById("hide-check-domain-availability-from-edit-profile"),
  ];
  
  
  function editProfileShowOptions() {
    insideEditProfileShowOptions.forEach(element => {
    element.style.display = "block";
  });
  }
  
  
  function editProfileEverything() {
    insideEditProfileEverything.forEach(element => {
    element.style.display = "none";
  });
  }
  
  function editProfileHideOptions() {
    insideEditProfileHideOptions.forEach(element => {
    element.style.display = "none";
  });
  }
  
  document.getElementById("show-profile-picture-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "block";
    document.getElementById("hide-profile-picture-from-edit-profile").style.display = "block";
    document.getElementById("show-profile-picture-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-picture").style.display = "block";
  });
  
  document.getElementById("hide-profile-picture-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "none";
    document.getElementById("hide-profile-picture-from-edit-profile").style.display = "none";
    document.getElementById("show-profile-picture-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-picture").style.display = "none";
  });
  
  document.getElementById("show-username-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "block";
    document.getElementById("hide-username-from-edit-profile").style.display = "block";
    document.getElementById("show-username-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-username").style.display = "block";
  });
  
  
  document.getElementById("hide-username-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "none";
    document.getElementById("hide-username-from-edit-profile").style.display = "none";
    document.getElementById("show-username-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-username").style.display = "none";
  });
  
  document.getElementById("show-click2link-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "block";
    document.getElementById("hide-click2link-from-edit-profile").style.display = "block";
    document.getElementById("show-click2link-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-click2link").style.display = "block";
  });
  
  document.getElementById("hide-click2link-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "none";
    document.getElementById("hide-click2link-from-edit-profile").style.display = "none";
    document.getElementById("show-click2link-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-click2link").style.display = "none";
  });
  
  document.getElementById("show-topic-id-name-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "block";
    document.getElementById("hide-topic-id-name-from-edit-profile").style.display = "block";
    document.getElementById("show-topic-id-name-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-topic-id").style.display = "block";
    document.getElementById("edit-profile-topic-id-name").style.display = "block";
  });
  
  document.getElementById("hide-topic-id-name-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "none";
    document.getElementById("hide-topic-id-name-from-edit-profile").style.display = "none";
    document.getElementById("show-topic-id-name-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-topic-id-name").style.display = "none";
  });
  
  document.getElementById("show-topic-id-to-pfp-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-topic-id").style.display = "block";
    document.getElementById("hide-topic-id-to-pfp-from-edit-profile").style.display = "block";
    document.getElementById("show-topic-id-to-pfp-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-topic-id-name-topic2pic").style.display = "block";
  });
  
  document.getElementById("hide-topic-id-to-pfp-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-topic-id").style.display = "none";
    document.getElementById("hide-topic-id-to-pfp-from-edit-profile").style.display = "none";
    document.getElementById("show-topic-id-to-pfp-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-topic-id-name-topic2pic").style.display = "none";
  });
  
  document.getElementById("show-check-domain-availability-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "block";
    document.getElementById("edit-profile-topic-id").style.display = "block";
    document.getElementById("hide-check-domain-availability-from-edit-profile").style.display = "block";
    document.getElementById("show-check-domain-availability-from-edit-profile").style.display = "none";
    document.getElementById("edit-profile-domain-time-left").style.display = "block";
  });
  
  document.getElementById("hide-check-domain-availability-from-edit-profile").addEventListener("click", (event) => {
    editProfileEverything()
    editProfileShowOptions()
    editProfileHideOptions()
    document.getElementById("edit-profile-url-name-domain").style.display = "none";
    document.getElementById("edit-profile-topic-id").style.display = "none";
    document.getElementById("hide-check-domain-availability-from-edit-profile").style.display = "none";
    document.getElementById("show-check-domain-availability-from-edit-profile").style.display = "block";
    document.getElementById("edit-profile-domain-time-left").style.display = "none";
  });
  
  const allLoadColumns = [
    document.getElementById("time-from-users-load-column"),
    document.getElementById("time-from-users-load-column-filter"),
    document.getElementById("load-msgs-from-ids-load-column"),
    document.getElementById("load-blocks-from-ids-load-column"),
    document.getElementById("load-load-from-users"),
    document.getElementById("load-block-from-users"),
    document.getElementById("load-load-from-users-label"),
    document.getElementById("load-block-from-users-label"),
    document.getElementById("hide-load-from-users"),
    document.getElementById("hide-block-from-users"),
    document.getElementById("hide-time-from-users-load-column"),
    document.getElementById("hide-change-password-load"),
    document.getElementById("hide-set-password-load"),
    document.getElementById("hide-unlock-load"),
    document.getElementById("unlockkey-load"),
    document.getElementById("encrypt-key-load"),
    document.getElementById("change-key-load"),
    document.getElementById("change-password-load"),
    document.getElementById("set-password-load"),
    document.getElementById("unlock-load-few"),
    document.getElementById("unlock-load-all"),
    document.getElementById("hide-pin-key-load"),
    document.getElementById("pin-publickkey-load"),
    document.getElementById("publickkey-load"),
  ];

  function loadColumnsEverything() {
    allLoadColumns.forEach(element => {
    element.style.display = "none";
  });
  }
  
  const loadColumnsShowOptions = [
    document.getElementById("show-load-from-users"),
    document.getElementById("show-block-from-users"),
    document.getElementById("show-time-from-users-load-column"),
    document.getElementById("show-change-password-load"),
    document.getElementById("show-set-password-load"),
    document.getElementById("show-unlock-load"),
    document.getElementById("show-pin-key-load"),
  ];
  
  
  function loadColumnsShowOptionsload() {
    loadColumnsShowOptions.forEach(element => {
    element.style.display = "block";
  });
  }

  function loadColumnsHideOptionsload() {
    loadColumnsShowOptions.forEach(element => {
    element.style.display = "none";
  });
  }
  
  document.getElementById("show-time-from-users-load-column").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("time-from-users-load-column").style.display = "block";
    document.getElementById("time-from-users-load-column-filter").style.display = "flex";
    document.getElementById("hide-time-from-users-load-column").style.display = "block";
    document.getElementById("show-time-from-users-load-column").style.display = "none";
  });
  document.getElementById("hide-time-from-users-load-column").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });
  
  document.getElementById("show-load-from-users").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("load-msgs-from-ids-load-column").style.display = "block";
    document.getElementById("load-load-from-users").style.display = "flex";
    document.getElementById("load-load-from-users-label").style.display = "block";
    document.getElementById("show-load-from-users").style.display = "none";
    document.getElementById("hide-load-from-users").style.display = "block";
  });
  document.getElementById("hide-load-from-users").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });
  
  document.getElementById("show-block-from-users").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("load-blocks-from-ids-load-column").style.display = "block";
    document.getElementById("load-block-from-users").style.display = "flex";
    document.getElementById("load-block-from-users-label").style.display = "block";
    document.getElementById("show-block-from-users").style.display = "none";
    document.getElementById("hide-block-from-users").style.display = "block";
  });
  document.getElementById("hide-block-from-users").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });

  document.getElementById("show-change-password-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("hide-change-password-load").style.display = "block";
    document.getElementById("show-change-password-load").style.display = "none";
    document.getElementById("encrypt-key-load").style.display = "block";
    document.getElementById("change-key-load").style.display = "block";
    document.getElementById("change-password-load").style.display = "block";
  });
  document.getElementById("hide-change-password-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });
  
  document.getElementById("show-set-password-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("hide-set-password-load").style.display = "block";
    document.getElementById("show-set-password-load").style.display = "none";
    document.getElementById("encrypt-key-load").style.display = "block";
    document.getElementById("change-key-load").style.display = "block";
    document.getElementById("set-password-load").style.display = "block";
  });
  document.getElementById("hide-set-password-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });

  document.getElementById("show-unlock-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("hide-unlock-load").style.display = "block";
    document.getElementById("show-unlock-load").style.display = "none";
    document.getElementById("unlockkey-load").style.display = "block";
    document.getElementById("unlock-load-all").style.display = "block";
    document.getElementById("unlock-load-few").style.display = "block";

  });
  document.getElementById("hide-unlock-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });

  document.getElementById("show-options-from-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("options-from-load").style.display = "block";
    document.getElementById("hide-options-from-load").style.display = "block";
    document.getElementById("show-options-from-load").style.display = "none";
  });
  document.getElementById("hide-options-from-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsHideOptionsload();
    document.getElementById("show-options-from-load").style.display = "block";
    document.getElementById("hide-options-from-load").style.display = "none";
  });

  document.getElementById("show-pin-key-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
    document.getElementById("hide-pin-key-load").style.display = "block";
    document.getElementById("show-pin-key-load").style.display = "none";
    document.getElementById("pin-publickkey-load").style.display = "block";
    document.getElementById("publickkey-load").style.display = "block";
  });
  document.getElementById("hide-pin-key-load").addEventListener("click", (event) => {
    loadColumnsEverything();
    loadColumnsShowOptionsload();
  });
  



  
  const everythinginsidemodelcolumn = [
    document.getElementById("model-column-model-url"),
    document.getElementById("model-column-model-rotation"),
    document.getElementById("model-column-model-position"),
    document.getElementById("model-column-model-scale-factor"),
    document.getElementById("hide-model-column-model-url"),
    document.getElementById("hide-model-column-model-rotation"),
    document.getElementById("hide-model-column-model-position"),
    document.getElementById("hide-model-column-model-scale-factor"),
  ];
  
  const showoptionsinsidemodelcolumn = [
    document.getElementById("show-model-column-model-url"),
    document.getElementById("show-model-column-model-rotation"),
    document.getElementById("show-model-column-model-position"),
    document.getElementById("show-model-column-model-scale-factor"),
  ];
  
  
  function modelColumnShowOptions() {
    showoptionsinsidemodelcolumn.forEach(element => {
    element.style.display = "block";
  });
  }
  
  function modelColumnEverything() {
    everythinginsidemodelcolumn.forEach(element => {
    element.style.display = "none";
  });
  }
  
  document.getElementById("show-model-column-model-url").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-url").style.display = "block";
    document.getElementById("hide-model-column-model-url").style.display = "block";
    document.getElementById("show-model-column-model-url").style.display = "none";
  });
  
  document.getElementById("hide-model-column-model-url").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-url").style.display = "none";
    document.getElementById("hide-model-column-model-url").style.display = "none";
    document.getElementById("show-model-column-model-url").style.display = "block";
  });
  
  document.getElementById("show-model-column-model-rotation").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-rotation").style.display = "block";
    document.getElementById("hide-model-column-model-rotation").style.display = "block";
    document.getElementById("show-model-column-model-rotation").style.display = "none";
  });
  
  document.getElementById("hide-model-column-model-rotation").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-rotation").style.display = "none";
    document.getElementById("hide-model-column-model-rotation").style.display = "none";
    document.getElementById("show-model-column-model-rotation").style.display = "block";
  });
  
  document.getElementById("show-model-column-model-position").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-position").style.display = "block";
    document.getElementById("hide-model-column-model-position").style.display = "block";
    document.getElementById("show-model-column-model-position").style.display = "none";
  });
  
  document.getElementById("hide-model-column-model-position").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-position").style.display = "none";
    document.getElementById("hide-model-column-model-position").style.display = "none";
    document.getElementById("show-model-column-model-position").style.display = "block";
  });
  
  document.getElementById("show-model-column-model-scale-factor").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-scale-factor").style.display = "block";
    document.getElementById("hide-model-column-model-scale-factor").style.display = "block";
    document.getElementById("show-model-column-model-scale-factor").style.display = "none";
  });
  
  document.getElementById("hide-model-column-model-scale-factor").addEventListener("click", (event) => {
    modelColumnEverything()
    modelColumnShowOptions()
    document.getElementById("model-column-model-scale-factor").style.display = "none";
    document.getElementById("hide-model-column-model-scale-factor").style.display = "none";
    document.getElementById("show-model-column-model-scale-factor").style.display = "block";
  });
  
  