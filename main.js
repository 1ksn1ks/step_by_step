import './map.js';
import './loaderprogress.js';
import './popupanim.js';
import './cssLogic.js'
import './marker.js';
import './joystick.js';
import './threejs.js';
import './makescrollable.js';
import './web3.js'
import './coorddisplay.js'
import './localtime.js'
import './P2PModel.js'
import './visibility.js'
import './globemode.js'
import './loadP2PModels.js'
import './loadUFOModel.js'
import './extracttopic.js'
import './rest.js'
import './loadTOPIC4PIC.js'
import './topicchat.js'
import './encryptedtopicchat.js'
import './LOADcolumn.js'
import './handlegofilter.js'

window.restrictLength = function(input, maxLength) {
    if (input.value.length > maxLength) {
      input.value = input.value.slice(0, maxLength);
    }
  };