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


// The switch reads the value spans (feedlayout.js syncVisRow), and the
// label stays "Show 3D models", like the markers and polygons rows. The
// state follows the map even if the layer's own cleanup throws.
document.getElementById("toggle-3d-model-visibility").addEventListener("click", async function() {
    const visibilityValue = document.getElementById("3d-model-visibility-value");
    const visibilityValue2 = document.getElementById("3d-model-visibility-value2");
    const paint = (on) => {
        visibilityValue.textContent = on ? "On" : "Off";
        visibilityValue2.textContent = on ? "On" : "Off";
    };

    if (visibilityValue.textContent.trim() === "Off") {
        await updateMapLayer(); // Show 3D models
        paint(true);
        return;
    }
    try {
        if (map.getLayer('3d-model')) map.removeLayer('3d-model'); // Hide 3D models
    } finally {
        paint(!!map.getLayer('3d-model'));
    }
});