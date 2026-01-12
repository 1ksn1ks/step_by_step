import { map } from './map.js';
import { load3dModels } from './loadP2PModels.js';

async function updateMapLayer() {
    if (map.getLayer('3d-model')) {
        map.removeLayer('3d-model');
    }
    map.addLayer(await load3dModels());
}

let updateMapLayerIntervalId = null;

let updateInterval = 300000;

let isInitialUpdateLoop = true;

document.getElementById("update-loop").addEventListener("click", () => {
  const newInterval = parseFloat(document.getElementById("time-input").value, 10);
  const updatesValue = document.getElementById("updates-value");
  const updatesValue2 = document.getElementById("updates-value2");
  const visibilityValue = document.getElementById("3d-model-visibility-value");
  const toggle3DModelButton = document.getElementById("toggle-3d-model-visibility");

  if (!isNaN(newInterval) && newInterval > 0) {
    updateInterval = newInterval;
    stopUpdateMapLayerLoop(); // Stop the current loop
    startUpdateMapLayerLoop(); // Start a new loop with the updated interval
    console.log(`Update interval set to ${updateInterval} milliseconds.`);
    updatesValue.textContent = "On"; // Ensure updates are "On"
    updatesValue2.textContent = "On";

    // Ensure 3D models are visible
    if (visibilityValue.textContent === "Off") {
      toggle3DModelButton.click(); // Simulate a click to turn on 3D models
    }
  } else {
    console.error("Invalid interval value. Please enter a positive number.");
  }
});

document.getElementById("toggle-updates").addEventListener("click", () => {
  const updatesValue = document.getElementById("updates-value");
  const updatesValue2 = document.getElementById("updates-value2");
  const visibilityValue = document.getElementById("3d-model-visibility-value");
  const toggle3DModelButton = document.getElementById("toggle-3d-model-visibility");

  if (isInitialUpdateLoop) {
    console.log('stopping update loop');
    stopUpdateMapLayerLoop(); // Stop the update loop
    updatesValue.textContent = "Off";
    updatesValue2.textContent = "Off";
  } else {
    startUpdateMapLayerLoop(); // Start the update loop
    updatesValue.textContent = "On";
    updatesValue2.textContent = "On";
    // Ensure 3D models are visible
    if (visibilityValue.textContent === "Off") {
      toggle3DModelButton.click(); // Simulate a click to turn on 3D models
    }
  }
});

function startUpdateMapLayerLoop() {
  if (updateMapLayerIntervalId === null) { // Only start if not already running
    updateMapLayerIntervalId = setInterval(() => {
      updateMapLayer();
    }, updateInterval); // Use the updated interval time
  }
  isInitialUpdateLoop = true;
}

function stopUpdateMapLayerLoop() {
  if (updateMapLayerIntervalId !== null) {
    clearInterval(updateMapLayerIntervalId);
    updateMapLayerIntervalId = null; // Reset the interval ID
  }
  isInitialUpdateLoop = false;
}
startUpdateMapLayerLoop();

document.getElementById("update-map-layer-btn").addEventListener("click", async function() {
  await updateMapLayer();
});

document.getElementById("toggle-3d-model-visibility").addEventListener("click", async function() {
    const button = this;
    const visibilityValue = document.getElementById("3d-model-visibility-value");
    const visibilityValue2 = document.getElementById("3d-model-visibility-value2");
    const updatesValue = document.getElementById("updates-value");
    const updatesValue2 = document.getElementById("updates-value2");

    if (visibilityValue.textContent === "Off") {
        await updateMapLayer(); // Show 3D models
        startUpdateMapLayerLoop(); // Start the update loop
        visibilityValue.textContent = "On";
        visibilityValue2.textContent = "On";
        button.textContent = "Hide 3D models";
        updatesValue.textContent = "On"; // Ensure updates are "On"
        updatesValue2.textContent = "On";
    } else {
        if (map.getLayer('3d-model')) {
            map.removeLayer('3d-model'); // Hide 3D models
        }
        stopUpdateMapLayerLoop(); // Stop the update loop
        visibilityValue.textContent = "Off";
        visibilityValue2.textContent = "Off";
        button.textContent = "Show 3D models";
        updatesValue.textContent = "Off"; // Turn updates "Off" when 3D models are hidden
        updatesValue2.textContent = "Off";
    }
});