import './map.js';
import './cssLogic.js'
import './marker.js';
import './joystick.js';
import './threejs.js';
import './makescrollable.js';
import './web3.js'
import './coorddisplay.js'
import './P2PModel.js'
import './visibility.js'
import './loadP2PModels.js'
import './loadUFOModel.js'
import './extracttopic.js'
import './rest.js'
import './loadTOPIC4PIC.js'
import './topicchat.js'
import './encryptedtopicchat.js'
import './helia.js'
import './upload.js'
import './fetch.js'

window.restrictLength = function(input, maxLength) {
    if (input.value.length > maxLength) {
      input.value = input.value.slice(0, maxLength);
    }
  };

  const overlay = document.getElementById('loader-overlay');

  function loadMapScript() {
    const script = document.createElement('script');
    script.src = './map.js';
    script.async = false;           // keep execution order if needed later
  
    script.onload = () => {
      console.log('map.js has loaded → hiding loader');
      overlay.style.display = 'none';
    };
  
    script.onerror = () => {
      console.error('Failed to load map.js');
      overlay.innerHTML = '<h3 style="color: #ff6b6b;">Error loading core map</h3>';
      // You can also add a retry button here if you want
    };
  
    document.head.appendChild(script);
  }
  
  // Start immediately
  loadMapScript();