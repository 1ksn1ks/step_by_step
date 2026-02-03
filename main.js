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
    script.async = false;
  
    script.onload = () => {
      overlay.style.display = 'none';
    };

  
    document.head.appendChild(script);
  }
  
  loadMapScript();