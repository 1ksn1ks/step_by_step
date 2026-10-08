import 'maplibre-gl/dist/maplibre-gl.css';
import { load3dModels, loadDayNight } from './loadP2PModels.js';
import maplibregl from 'maplibre-gl';
import { toast } from './toast';

export const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [-172, -19],
    zoom: 0,
    // no minZoom: the engine default is already -2 (globe projection floor)
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
    // No setMinZoom: the globe projection's engine floor is -2 by default,
    // and asking for less THROWS inside this handler — which also adds the
    // 3D layers, so the throw silently killed the daynight shade + bots.
    map.setMaxZoom(19);

    // Pole-zoom pin: the globe pan couples zoom to the center latitude
    // (zoom -= log2(cos lat)), so dragging toward a pole zooms the map out and
    // shrinks the bots/markers. Re-pin the zoom after every PURE pan (no pinch /
    // rotate / pitch delta) so the zoom level stays fixed while the globe
    // rotates. Pinch, scroll and double-click zoom are left untouched. Done on
    // the cameraHelper instance that is active once the globe projection is set.
    const ch = map.cameraHelper;
    if (ch && !ch.__poleZoomPinned) {
      const origPan = ch.handleMapControlsPan.bind(ch);
      ch.__poleZoomPinned = true;
      ch.handleMapControlsPan = (deltas, tr, preZoomAroundLoc) => {
        const purePan = !deltas.zoomDelta && !deltas.bearingDelta &&
          !deltas.pitchDelta && !deltas.rollDelta;
        const oldZoom = purePan ? tr.zoom : null;
        origPan(deltas, tr, preZoomAroundLoc);
        if (purePan && Math.abs(tr.zoom - oldZoom) > 1e-6) tr.setZoom(oldZoom);
      };
    }

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
    map.addLayer(await loadDayNight()); // day/night shade — own layer, topmost so it blends over the bots
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
      navigator.clipboard.writeText(coordinates).then(() => {
        toast.success("Coordinates copied");
      }).catch(err => {
        console.error("Failed to copy coordinates:", err);
        toast.error("Failed to copy coordinates");
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
      toast.success("Coordinates copied");
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

// Turning location ON loads the 24h live markers of the user's country
// (same view the geographic search shows). trackuserlocationstart fires on
// the button tap; the FIRST position fix after it does the loading, so
// continuous tracking never re-fetches.
let pendingLocation = false;
let trackingAutoStopped = false;
geolocate.on('trackuserlocationstart', () => {
  pendingLocation = true;
});
geolocate.on('geolocate', (e) => {
  if (!pendingLocation || !e.coords) return;
  pendingLocation = false;
  // Tracking has done its job (the first fix). Turn it OFF — once: with
  // trackUserLocation on, the engine re-centers the map on the user on
  // EVERY GPS fix, which aborts any in-flight camera animation (the
  // popup number's flyTo died ~1s after starting = "press twice").
  // The blue dot stays at the last position. If the user taps the button
  // again to re-enable tracking, it stays on (their choice) and the
  // markers reload on the next fix.
  if (!trackingAutoStopped) {
    geolocate.trigger();
    trackingAutoStopped = true;
  }
  // Dynamic: localnews pulls in processallmessages → threejs, which use
  // `map` at MODULE LEVEL — a static import here would hit the temporal
  // dead zone while map.js is still initializing.
  import('./localnews.js')
    .then(({ showLocationMarkers }) =>
      showLocationMarkers(e.coords.latitude, e.coords.longitude)
    )
    .catch(() => {});
});