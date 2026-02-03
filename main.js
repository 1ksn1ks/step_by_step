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

  const scripts = [
    './map.js',
    './cssLogic.js',
    './marker.js',
    './joystick.js',
    './threejs.js',
    './makescrollable.js',
    './web3.js',
    './coorddisplay.js',
    './P2PModel.js',
    './visibility.js',
    './loadP2PModels.js',
    './loadUFOModel.js',
    './extracttopic.js',
    './rest.js',
    './loadTOPIC4PIC.js',
    './topicchat.js',
    './encryptedtopicchat.js',
    './helia.js',
    './upload.js',
    './fetch.js'
  ];
  
  const total = scripts.length;
  let loaded = 0;
  
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const overlay = document.getElementById('loader-overlay');
  
  function updateProgress() {
    loaded++;
    const percent = Math.round((loaded / total) * 100);
    progressBar.style.width = percent + '%';
    progressText.textContent = percent + '%';
  }
  
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false; // important: preserve order
      script.onload = () => {
        updateProgress();
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }
  
  async function loadAllScripts() {
    for (const src of scripts) {
      try {
        await loadScript(src);
      } catch (err) {
        console.error(err);
        progressText.textContent = 'Error loading scripts';
        break;
      }
    }
    // All done → hide loader
    overlay.style.display = 'none';
  }
  
  // Start loading
  loadAllScripts();