import {debouncedUpdateClusters} from './marker'
import { polygons } from './letall';

let markersVisible = false;
  let polygonsVisible = true;

  // Function to toggle markers visibility
  function toggleMarkers() {
      markersVisible = !markersVisible;
      existingMarkers.forEach(marker => {
          // Check if the marker element exists and toggle its visibility
          if (marker.getElement()) {
              if (markersVisible) {
                  marker.getElement().style.display = 'block'; // Show marker
                  marker.addTo(map); // Add marker back to the map
              } else {
                  marker.getElement().style.display = 'none'; // Hide marker
                  marker.remove(); // Remove marker from the map
              }
          }
      });
      // Update the button state text
      document.getElementById("marker-visibility-value").textContent = markersVisible ? "On" : "Off";
      document.getElementById("marker-visibility-value2").textContent = markersVisible ? "On" : "Off";

      // Prevent updating clusters if markers are not visible
      if (!markersVisible) {
          map.off("moveend", debouncedUpdateClusters); // Unsubscribe from moveend event
      } else {
          map.on("moveend", debouncedUpdateClusters); // Subscribe back to moveend event
      }
  }

  toggleMarkers();

  // Function to toggle polygons visibility
  function togglePolygons() {
      polygonsVisible = !polygonsVisible; // Toggle state

      polygons.forEach(polygon => {
          const layerId = `${polygon.id}-image-layer`;
          const maskLayerId = `${polygon.id}-mask-layer`; // Define the mask layer ID

          if (map.getLayer(layerId)) {
              const visibility = polygonsVisible ? 'visible' : 'none'; // Set visibility based on the current state
              map.setLayoutProperty(layerId, 'visibility', visibility);
              map.setLayoutProperty(maskLayerId, 'visibility', visibility); // Also toggle the mask layer visibility
          }
      });

      document.getElementById("polygon-visibility-value").textContent = polygonsVisible ? "On" : "Off"; // Update button state
      document.getElementById("polygon-visibility-value2").textContent = polygonsVisible ? "On" : "Off"; // Update button state
  }

  document.getElementById("toggle-polygon-visibility").addEventListener("click", togglePolygons);

  document.getElementById("toggle-marker-visibility").addEventListener("click", () => {
      toggleMarkers(); // Call the toggle function directly
  });