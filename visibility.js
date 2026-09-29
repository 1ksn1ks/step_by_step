import { map } from './map.js';
import { load3dModels } from './loadP2PModels.js';

async function updateMapLayer() {
    if (map.getLayer('3d-model')) {
        map.removeLayer('3d-model');
    }
    // Re-add the bot layer just below the day/night shade so the shade (depthTest
    // off) stays topmost and keeps blending over the bots after a re-enable.
    map.addLayer(await load3dModels(), map.getLayer('daynight') ? 'daynight' : undefined);
}


document.getElementById("toggle-3d-model-visibility").addEventListener("click", async function() {
    const button = this;
    const visibilityValue = document.getElementById("3d-model-visibility-value");
    const visibilityValue2 = document.getElementById("3d-model-visibility-value2");

    if (visibilityValue.textContent === "Off") {
        await updateMapLayer(); // Show 3D models
        visibilityValue.textContent = "On";
        visibilityValue2.textContent = "On";
        button.textContent = "Hide 3D models";
    } else {
        if (map.getLayer('3d-model')) {
            map.removeLayer('3d-model'); // Hide 3D models
        }
        visibilityValue.textContent = "Off";
        visibilityValue2.textContent = "Off";
        button.textContent = "Show 3D models";
    }
});