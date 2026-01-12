import {extractTopicId} from './extractTopicId'

let initialload = false;
let toolbarload = false;
let isLoggedIn = false;

function trackOpacity() {
  const host = document.querySelector('wcm-modal');
  if (host) {
    const shadowRoot = host.shadowRoot;
    if (shadowRoot) {
      const targetDiv = shadowRoot.querySelector('#wcm-modal');
      if (targetDiv) {
        const checkOpacity = 
        setInterval(() => {
          const opacity = window.getComputedStyle(targetDiv).opacity;
          const crosshair = document.getElementById("crosshair");
          if (opacity === '1') {
            initialload = true;
            if (crosshair) {
              crosshair.style.display = "none";
            } else {
              console.log('Crosshair element not found');
            }
          }

          if (opacity === '0') { // Ensure string comparison

            if (initialload === true) {

            if (toolbarload === false) {
              if (crosshair) {
          crosshair.style.display = "block";
        toolbarload = true;
              }

            if (isLoggedIn === false) {
        extractTopicId();
        handleAllMessages();
        const toolbarLoad = document.getElementById("toolbar-load");
        toolbarLoad.replaceWith(toolbarLoad.cloneNode(true));
        const newToolbarLoad = document.getElementById("toolbar-load");
        newToolbarLoad.addEventListener("click", debounce(async () => {
            await handleAllMessages();
        }, 500));
      }

      if (isLoggedIn === true) {
        extractTopicId();
        confirmNFTFunction(globalAccountId);
        const toolbarLoad = document.getElementById("toolbar-load");
        toolbarLoad.replaceWith(toolbarLoad.cloneNode(true));
        const newToolbarLoad = document.getElementById("toolbar-load");
        newToolbarLoad.addEventListener("click", debounce(async () => {
            await confirmNFTFunction(globalAccountId);
        }, 500));
      }
            }

            } else {
            }
          }
        }, 10); // Check every 10ms

        setTimeout(() => {
          if (!toolbarload) {
            clearInterval(checkOpacity);
          }
        }, 300000); // Stop after 300 seconds if not completed
      } else {
        setTimeout(trackOpacity, 100);
      }
    } else {
      setTimeout(trackOpacity, 100);
    }
  } else {
    setTimeout(trackOpacity, 100);
  }
}

trackOpacity(); // Start the process