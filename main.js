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

window.restrictLength = function(input, maxLength) {
    if (input.value.length > maxLength) {
      input.value = input.value.slice(0, maxLength);
    }
  };