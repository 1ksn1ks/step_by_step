import 'maplibre-gl/dist/maplibre-gl.css';
import { load3dModels, loadDayNight } from './loadP2PModels.js';
import maplibregl from 'maplibre-gl';
import { toast } from './toast';

// OpenFreeMap Liberty layers held back on the zoomed-out globe.
// The number is the zoom where that layer first appears. Casing and fill
// of one road class share a value so they show up together.
const BASE_MAP_MINZOOM = {
  road_motorway: 8,
  road_motorway_casing: 8,
  tunnel_motorway: 8,
  tunnel_motorway_casing: 8,
  bridge_motorway: 8,
  bridge_motorway_casing: 8,
  road_trunk_primary: 10,
  road_trunk_primary_casing: 10,
  tunnel_trunk_primary: 10,
  tunnel_trunk_primary_casing: 10,
  bridge_trunk_primary: 10,
  bridge_trunk_primary_casing: 10,
  road_secondary_tertiary: 11,
  road_secondary_tertiary_casing: 11,
  tunnel_secondary_tertiary: 11,
  tunnel_secondary_tertiary_casing: 11,
  bridge_secondary_tertiary: 11,
  bridge_secondary_tertiary_casing: 11,
  road_minor_casing: 15,
  tunnel_street_casing: 15,
  bridge_street_casing: 15,
  road_minor: 17,
  tunnel_minor: 17,
  road_service_track_casing: 18,
  tunnel_service_track_casing: 18,
  bridge_service_track_casing: 18,
  road_major_rail: 17,
  road_transit_rail: 17,
  tunnel_major_rail: 17,
  tunnel_transit_rail: 17,
  bridge_major_rail: 17,
  bridge_transit_rail: 17,
  road_major_rail_hatching: 18,
  road_transit_rail_hatching: 18,
  tunnel_major_rail_hatching: 18,
  tunnel_transit_rail_hatching: 18,
  bridge_major_rail_hatching: 18,
  bridge_transit_rail_hatching: 18,
  road_area_pattern: 14,
  'highway-shield-us-interstate': 10,
  'highway-shield-non-us': 11,
  road_shield_us: 12,
  park: 8,
  park_outline: 8,
  landuse_residential: 11,
  landuse_pitch: 12,
  landuse_track: 12,
  landuse_cemetery: 12,
  landuse_hospital: 12,
  landuse_school: 12,
  landcover_wood: 7,
  landcover_grass: 7,
  waterway_river: 14,
  waterway_tunnel: 12,
  waterway_other: 16,
  waterway_line_label: 13,
  boundary_3: 8,
  label_town: 9,
  label_other: 11,
  label_village: 12,
  poi_transit: 14,
};

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

    // style.load can run again. Setting the same range twice changes nothing.
    // A missing layer, or one call that throws, still leaves the models to load.
    for (const [id, minzoom] of Object.entries(BASE_MAP_MINZOOM)) {
      try {
        const layer = map.getLayer(id);
        if (!layer) continue;
        const maxzoom = layer.maxzoom === undefined ? 24 : layer.maxzoom;
        map.setLayerZoomRange(id, minzoom, maxzoom);
      } catch {
        // Keep going. The 3D models and the day/night shade load below.
      }
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


  function flashCoordinatesCopied() {
    const display = document.getElementById("coordinates-display");
    if (display) display.dataset.copiedUntil = String(Date.now() + 1000);
  }

  document.getElementById("copy-coordinates").addEventListener("click", (e) => {
    e.stopPropagation();
    const center = map.getCenter();
    const coordinates = `${center.lng.toFixed(5)},${center.lat.toFixed(5)}`;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(coordinates).then(() => {
        toast.success("Coordinates copied");
        flashCoordinatesCopied();
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
      flashCoordinatesCopied();
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

// Turning location ON loads the 24h live markers within the Look for Live
// distance of the user (same view a search pick shows). trackuserlocationstart fires on
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