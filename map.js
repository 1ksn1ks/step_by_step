import 'maplibre-gl/dist/maplibre-gl.css';
import { load3dModels } from './loadP2PModels.js';
import maplibregl from 'maplibre-gl';

export const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [-172, -19],
    zoom: 0,
    pitch: 0,
    bearing: 0,
    maxPitch: 75,
    maxZoom: 19,
    antialias: true,
    projection: {
      name: "globe",
    },
  });

  map.on("style.load", async () => {
    map.setProjection({
      type: "globe",
    });
  
    const layers = map.getStyle().layers;
    const roadShieldLayer = layers.find(
      (layer) =>
        layer.id.toLowerCase().includes("road_shield") ||
        layer.id.toLowerCase().includes("shield")
    );
  
    if (roadShieldLayer) {
      map.setLayoutProperty(roadShieldLayer.id, "visibility", "none");
    }
  
    map.addLayer(await load3dModels());
    });
  
const navigation = new maplibregl.NavigationControl({
  showCompass: true,
  showZoom: false
});

map.addControl(navigation);
navigation._container.classList.add('custom-map-control');


  document.getElementById("copy-coordinates").addEventListener("click", (e) => {
    e.stopPropagation();
    const center = map.getCenter();
    const coordinates = `${center.lng.toFixed(5)},${center.lat.toFixed(5)}`;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(coordinates).catch(err => {
        console.error("Failed to copy coordinates:", err);
      });
    } else {
      // Fallback for non-HTTPS contexts where navigator.clipboard is unavailable
      const textarea = document.createElement("textarea");
      textarea.value = coordinates;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  });



// Add the geolocation control to the map
const geolocate = new maplibregl.GeolocateControl({
  positionOptions: {
      enableHighAccuracy: true // Forces the phone to use GPS instead of Wi-Fi
  },
  trackUserLocation: true, // Automatically keeps the map centered on the user as they move
  showUserLocation: true   // Displays a blue dot at the user's current location
});

map.addControl(geolocate);

geolocate._container.classList.add('custom-geolocate-position');