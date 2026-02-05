import { applyAllStyles } from './loadprofilepopup';
import { scene } from "./threejs";
import maplibregl from 'maplibre-gl';
import { animateMapTo } from './animatemapto';
import { currentUfoModel, polygons } from './letall';
import { map } from './map'
import { activeMarkerPopups } from './marker';
import { CloseALL, changePopupState } from './cssLogic';




export let addedLayers = new Set();

export let activePolygonPopups = [];
export function newActivePolygonPopups(a) {
  activePolygonPopups = a;
}



async function createResizedImage(imageUrl, maxWidth = 256, maxHeight = 256, fallbackUrl = null) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Maintain aspect ratio
      if (width > maxWidth || height > maxHeight) {
        if (width / height > maxWidth / maxHeight) {
          // wider than target ratio → constrain by width
          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
        } else {
          // taller or same → constrain by height
          if (height > maxHeight) {
            width = Math.round(width * (maxHeight / height));
            height = maxHeight;
          }
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(img, 0, 0, width, height);

      // You can also do: 'image/webp', 0.85 for smaller size & good quality
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };

    img.onerror = () => {
      if (fallbackUrl && img.src !== fallbackUrl) {
        // Try fallback once
        img.src = fallbackUrl;
      } else {
        reject(new Error(`Failed to load image: ${img.src}`));
      }
    };

    img.src = imageUrl;
  });
}
  
export async function addPolygonWithImageFill(map, polygon) {
    const sourceId = `${polygon.id}-source`;
    const layerId = `${polygon.id}-image-layer`;
    const maskLayerId = `${polygon.id}-mask-layer`;
  
    // Check if the source already exists
    if (map.getSource(sourceId)) {
      return; // Skip adding this polygon if the source already exists
    }
  
    // Wait for the map style to load if not already loaded
    if (!map.isStyleLoaded()) {
      await new Promise((resolve) => {
        map.once('load', () => resolve());
      });
    }
  
    try {
      // Calculate the bounding box of the polygon
      const coordinates = polygon.coordinates[0];
      const bounds = coordinates.reduce((bounds, coord) => {
        return {
          minLng: Math.min(bounds.minLng, coord[0]),
          maxLng: Math.max(bounds.maxLng, coord[0]),
          minLat: Math.min(bounds.minLat, coord[1]),
          maxLat: Math.max(bounds.maxLat, coord[1])
        };
      }, {
        minLng: Infinity,
        maxLng: -Infinity,
        minLat: Infinity,
        maxLat: -Infinity
      });
  
      const resizedImageUrl = await createResizedImage(polygon.imageUrl, 512, 512,"https://kiloscribe.com/api/inscription-cdn/0.0.4819119");
  
      // Now safe to add source and layers since style is loaded
      map.addSource(sourceId, {
        type: 'image',
        url: resizedImageUrl,
        coordinates: [
          [bounds.minLng, bounds.maxLat],
          [bounds.maxLng, bounds.maxLat],
          [bounds.maxLng, bounds.minLat],
          [bounds.minLng, bounds.minLat]
        ]
      });
  
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
          'raster-brightness-min': 0,
          'raster-brightness-max': 1,
          'raster-contrast': 0,
          'raster-saturation': 0
        },
        layout: {
          'visibility': 'visible'
        },
        interactive: false // Disable click interactions
      });
  
      // Opacity slider listener (only add once per layer, but since it's per-layer, it's fine here)
      document.getElementById("raster-opacity-slider").addEventListener("input", (event) => {
        const opacityValue = event.target.value; // Get the current value of the slider
        if (map.getLayer(layerId)) { // Safety check
          map.setPaintProperty(layerId, 'raster-opacity', parseFloat(opacityValue)); // Update the layer's opacity
        }
      });
  
      // Add mask for the polygon
      const maskSourceId = `${polygon.id}-mask-source`;
  
      map.addSource(maskSourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: polygon.coordinates
          }
        }
      });
  
      map.addLayer({
        id: maskLayerId,
        type: 'fill',
        source: maskSourceId,
        paint: {
          'fill-opacity': 0, // Set back to 0 for invisibility after debugging
          'fill-outline-color': '#000'
        }
      }, layerId); // Ensure mask layer is above raster layer
  
      // Add interactivity (only if not already added)
      if (!addedLayers.has(maskLayerId)) {
        const popup = new maplibregl.Popup();
  
        map.on('click', maskLayerId, (e) => {
          if (polygon.description) {
            const targetLngLat = e.lngLat.toArray()
            popup
              .setLngLat(e.lngLat)
              .setDOMContent(polygon.description)
              .addTo(map);
            animateMapTo(map, targetLngLat, null);
            activePolygonPopups.forEach((p) => p.remove());
            activeMarkerPopups.forEach((p) => p.remove());
            CloseALL();
            activePolygonPopups.push(popup);
            applyAllStyles();
          }
          changePopupState(true);
          if (currentUfoModel) {
            scene.remove(currentUfoModel);
            crosshair.style.display = "none";
          }
        });
  
        // Add a listener for the popup's close event
        popup.on('close', () => {
          changePopupState(false);
          if (currentUfoModel) {
            scene.add(currentUfoModel);
            crosshair.style.display = "block";
            // Remove popup from tracking array when closed
            const index = activePolygonPopups.indexOf(popup);
            if (index > -1) {
              activePolygonPopups.splice(index, 1);
            }
          }
        });
  
        map.on('mouseenter', maskLayerId, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
  
        map.on('mouseleave', maskLayerId, () => {
          map.getCanvas().style.cursor = '';
        });
  
        // Mark this layer as added
        addedLayers.add(maskLayerId);
      }
    } catch (error) {
      console.error('Error loading or resizing image:', error);
    }
  }
  


  let polygonsVisible = true;



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

