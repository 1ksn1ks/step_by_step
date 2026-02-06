import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import { debounce } from '/debounce'
import { animateMapTo } from './animatemapto';
import { geojson, existingMarkers, newExistingMarkers, currentUfoModelInGLTF } from './letall';
import { map } from './map'
import { activePolygonPopups } from './polygons';
import { CloseALL, changePopupState } from './cssLogic';
import { applyAllStyles } from './loadprofilepopup';
import { scene } from "./threejs";

let lastBounds = null;


export let activeMarkerPopups = [];

export function newActiveMarkerPopups(a) {
  activeMarkerPopups = a;
}


export const index = new Supercluster({
    radius: 60,
    maxZoom: 11,
  });

let currentMarkerSize = 5;

export function setcurrentMarkerSize(a) {
  currentMarkerSize = a;
}

export function updateClusters() {
  if (markersVisible){
    if (geojson.features.length === 0) {
      console.log("No features to update clusters.");
      return;
    }
  
    const currentBounds = map.getBounds().toArray().flat();
    lastBounds = currentBounds;
    const zoom = map.getZoom();
    const clusters = index.getClusters(currentBounds, Math.floor(zoom));
  
    existingMarkers.forEach((marker) => marker.remove());
    newExistingMarkers([]);
  
    clusters.forEach(async (cluster) => {
      const el = document.createElement("div");
      el.className = cluster.properties.cluster ? "cluster-marker" : "marker";
      const iconSize = [`${currentMarkerSize}vh`, `${currentMarkerSize}vh`];
      el.style.width = iconSize[0];
      el.style.height = iconSize[1];
      el.style.cursor = "pointer";
      el.style.borderRadius = "50%";
  
      if (cluster.properties.cluster) {
        el.textContent = cluster.properties.point_count_abbreviated;
        el.style.color = "black";
        el.style.textAlign = "center";
        el.style.lineHeight = iconSize[0];
        el.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
  
        el.addEventListener("click", async (e) => {
          e.stopPropagation();
          activePolygonPopups.forEach((popup) => popup.remove());
          activeMarkerPopups.forEach((popup) => popup.remove());
          const expansionZoom = await index.getClusterExpansionZoom(cluster.id) + 0.1;
          animateMapTo(map, cluster.geometry.coordinates, expansionZoom);
        });
      } else {
        try {
          const lowQualityUrl = await createLowQualityImage(cluster.properties.imageUrl);
          el.style.backgroundImage = `url(${lowQualityUrl})`;
          el.style.backgroundSize = "cover";
  
          const img = new Image();
          img.onload = () => {
            el.style.backgroundImage = `url(${cluster.properties.imageUrl})`;
          };
          img.src = cluster.properties.imageUrl;
        } catch (error) {
          console.error("Error loading marker image:", error);
          el.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
        }
      }
  
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(cluster.geometry.coordinates)
        .addTo(map);
  
      if (!cluster.properties.cluster) {
        const popup = new maplibregl.Popup();
  
        popup.on("close", () => {
          changePopupState(false);
          if (currentUfoModelInGLTF) {
            scene.add(currentUfoModelInGLTF);
            crosshair.style.display = "block";
          }
        });
  
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          popup.setLngLat(cluster.geometry.coordinates).addTo(map).setDOMContent(cluster.properties.message);
          activePolygonPopups.forEach((popup) => popup.remove());
          activeMarkerPopups.forEach((popup) => popup.remove());
          activeMarkerPopups.push(popup);
          CloseALL();
          animateMapTo(map, cluster.geometry.coordinates, null);
          applyAllStyles();
          changePopupState(true);
          if (currentUfoModelInGLTF) {
            scene.remove(currentUfoModelInGLTF);
            crosshair.style.display = "none";
          }
        });
      }
      existingMarkers.push(marker);
    });
  }

  function createLowQualityImage(imageUrl, size = 32) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => {
        // Create a small canvas for the low quality version
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
  
        // Draw image at lower resolution
        ctx.drawImage(img, 0, 0, size, size);
  
        // Convert to low quality JPEG-like format
        resolve(canvas.toDataURL('image/jpeg', 0.5));
      };
      img.onerror = reject;
      img.src = imageUrl;
    });}
  }
  
  
 export const debouncedUpdateClusters = debounce(() => {
    updateClusters();
  }, 1000);

  let markersVisible = false;

  document.getElementById("toggle-marker-visibility").addEventListener("click", () => {
    toggleMarkers();
});



    function toggleMarkers() {
      markersVisible = !markersVisible;

      existingMarkers.forEach(marker => {
          if (marker.getElement()) {
              if (markersVisible) {
                  marker.getElement().style.display = 'block';
                  marker.addTo(map);
              } else {
                  marker.getElement().style.display = 'none';
                  marker.remove();
              }
          }
      });

      document.getElementById("marker-visibility-value").textContent = markersVisible ? "On" : "Off";
      document.getElementById("marker-visibility-value2").textContent = markersVisible ? "On" : "Off";

      if (!markersVisible) {
          map.off("moveend", debouncedUpdateClusters);
      } else {
          map.on("moveend", debouncedUpdateClusters);
      }
  }

  toggleMarkers()