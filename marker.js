import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import { debounce } from '/debounce'
import { animateMapTo } from './animatemapto';
import { geojson, existingMarkers, newExistingMarkers, currentUfoModelInGLTF } from './letall';
import { map } from './map'
import { activePolygonPopups } from './polygons';
import { CloseALL, changePopupState } from './cssLogic';
import { closeDrawAnchor } from './drawhere';
import { closePressAnchor } from './poiinfo';
import { applyAllStyles } from './loadprofilepopup';
import { scene } from "./threejs";
import { makeScrollable } from './makescrollable';
// Circular with localnews.js (which imports the topic helpers from here) —
// safe: both sides only touch the other's bindings inside functions.
import { livePointCoords, livePointTitles } from './localnews';



export let activeMarkerPopups = [];

export function newActiveMarkerPopups(a) {
  activeMarkerPopups = a;
}

// Encoded once per URL — cluster re-renders reuse it instead of re-reading
// the GPU back for every marker on every zoom/move. Module top: updateClusters
// runs at load time, so this must exist before any marker is built.
const lowQualityImageCache = new Map();

// True when [lng, lat] is on the visible side of the globe. On a globe,
// far-side points otherwise project onto the visible disc (see-through).
function isOnVisibleHemisphere(coords) {
  const toRad = (d) => (d * Math.PI) / 180;
  const center = map.getCenter();
  const cl = toRad(center.lat);
  const cgn = toRad(center.lng);
  const pl = toRad(coords[1]);
  const pg = toRad(coords[0]);
  const dot = Math.sin(cl) * Math.sin(pl) + Math.cos(cl) * Math.cos(pl) * Math.cos(pg - cgn);
  return dot > -0.03; // small horizon margin so edge markers don't pop
}


export const index = new Supercluster({
    radius: 60,
    maxZoom: 11,
  });

let currentMarkerSize = 5;

export function setcurrentMarkerSize(a) {
  currentMarkerSize = a;
}

// The live view (localnews.js) sizes its glowing ring to this same value so
// it wraps a topic marker dot exactly when they share a spot.
export function getCurrentMarkerSize() {
  return currentMarkerSize;
}

// True when topic markers are both loaded (a topic was searched) and the
// visibility toggle is on — the live layer needs this to tell "twin sits
// behind a cluster bubble" (hide the live marker) from "no topic layer at
// all" (plain solid dot at the true point).
export function isTopicLayerActive() {
  return markersVisible && geojson.features.length > 0;
}

// Coordinates of topic markers currently drawn as INDIVIDUAL dots (not
// inside a cluster). The live layer checks this by coordinate: a live marker
// whose twin is an individual dot gets the border-only "live ring" style;
// one whose twin sits inside a cluster gets the old solid dot.
export const unclusteredTopicPoints = new Set();
const topicPointKey = ([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
function notifyTopicClustersUpdated() {
  document.dispatchEvent(new Event('topic-clusters-updated'));
}

let lastTopicSig = null;

export function updateClusters(force = true) {
  if (markersVisible){
    if (geojson.features.length === 0) {
      // Notify only on the real transition — the per-frame viewport path
      // calls this constantly and must stay silent when nothing changed.
      if (unclusteredTopicPoints.size > 0) {
        unclusteredTopicPoints.clear();
        notifyTopicClustersUpdated();
      }
      return;
    }

    const currentBounds = map.getBounds().toArray().flat();
    const zoom = map.getZoom();
    // Drop points on the far side of the globe — they would project
    // through the sphere onto the visible disc
    const clusters = index.getClusters(currentBounds, Math.floor(zoom)).filter(
      (c) => isOnVisibleHemisphere(c.geometry.coordinates)
    );
    // Per-frame viewport path (force=false): re-render only on the exact
    // frame the cluster state changes — otherwise the markers are already
    // at their true coordinates and simply pan/zoom with the map.
    const sig = clusters
      .map((c) => (c.properties.cluster ? 'c' + c.properties.cluster_id : 'p' + topicPointKey(c.geometry.coordinates)))
      .sort()
      .join('|');
    if (!force && sig === lastTopicSig) return;
    lastTopicSig = sig;

    unclusteredTopicPoints.clear();
    existingMarkers.forEach((marker) => marker.remove());
    newExistingMarkers([]);
  
    clusters.forEach(async (cluster) => {
      const el = document.createElement("div");
      el.className = cluster.properties.cluster ? "cluster-bubble" : "marker";
      const iconSize = [`${currentMarkerSize}vh`, `${currentMarkerSize}vh`];
      el.style.width = iconSize[0];
      el.style.height = iconSize[1];
      el.style.cursor = "pointer";

      if (cluster.properties.cluster) {
        el.textContent = cluster.properties.point_count_abbreviated;
        el.style.minWidth = iconSize[0]; // the size slider still sizes the bubble
        el.style.boxSizing = "border-box";

        el.addEventListener("click", async (e) => {
          e.stopPropagation();
          activePolygonPopups.forEach((popup) => popup.remove());
          activeMarkerPopups.forEach((popup) => popup.remove());
          const expansionZoom = await index.getClusterExpansionZoom(cluster.id) + 0.1;
          animateMapTo(map, cluster.geometry.coordinates, expansionZoom);
        });
      } else {
        const twinKey = topicPointKey(cluster.geometry.coordinates);
        unclusteredTopicPoints.add(twinKey);
        // The visual goes on an inner face element: the outer element is
        // MapLibre's marker element (positioned absolute + transform by
        // .maplibregl-marker) and must NEVER get a position of its own —
        // position:relative would put it back in the document flow (stacked
        // after the other markers) and shift it. The face fills the outer
        // element, so the anchored box stays exactly the dot.
        const face = document.createElement("div");
        face.className = "marker-face" + (livePointCoords.has(twinKey) ? " live-twin" : "");
        el.appendChild(face);
        try {
          const lowQualityUrl = await createLowQualityImage(cluster.properties.imageUrl);
          face.style.backgroundImage = `url(${lowQualityUrl})`;

          const img = new Image();
          img.onload = () => {
            face.style.backgroundImage = `url(${cluster.properties.imageUrl})`;
          };
          img.src = cluster.properties.imageUrl;
        } catch (error) {
          console.error("Error loading marker image:", error);
          face.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
        }
        if (livePointCoords.has(twinKey)) {
          // A live point at this exact spot → the live border (on the face)
          // and the live title under it.
          const liveTitle = livePointTitles.get(twinKey);
          if (liveTitle) {
            const label = document.createElement("div");
            label.className = "local-marker-label";
            label.textContent = liveTitle;
            face.appendChild(label);
          }
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
          activePolygonPopups.forEach((popup) => popup.remove());
          activeMarkerPopups.forEach((popup) => popup.remove());
          activeMarkerPopups.push(popup);
          CloseALL();
          closeDrawAnchor();
          closePressAnchor(); // a marker popup replaces the 🗺/📡 pin too
          popup.setLngLat(cluster.geometry.coordinates).addTo(map).setDOMContent(cluster.properties.message);
          const markerPopupContent = popup.getElement()?.querySelector('.maplibregl-popup-content');
          if (markerPopupContent && !markerPopupContent._scrollable) {
            makeScrollable(markerPopupContent);
            markerPopupContent._scrollable = true;
          }
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

    notifyTopicClustersUpdated();
  } else {
    // topic markers hidden → every live dot uses the old solid style
    unclusteredTopicPoints.clear();
    notifyTopicClustersUpdated();
  }

  function createLowQualityImage(imageUrl, size = 32) {
    const cached = lowQualityImageCache.get(imageUrl);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => {
        // Create a small canvas for the low quality version
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        // CPU-backed canvas: toDataURL here must not churn GPU readbacks
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // Draw image at lower resolution
        ctx.drawImage(img, 0, 0, size, size);

        // Convert to low quality JPEG-like format
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
        lowQualityImageCache.set(imageUrl, dataUrl);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = imageUrl;
    });}
  }
  
  
 export const debouncedUpdateClusters = debounce(() => {
    updateClusters();
  }, 1000);

  // Per-frame viewport path (see updateClusters) — the old 1s-debounced
  // moveend re-render let the cluster state lag the zoom, which read as
  // markers sliding and jumping mid-zoom.
  const viewportTopicUpdate = () => updateClusters(false);

  let markersVisible = false;

  document.getElementById("toggle-marker-visibility").addEventListener("click", () => {
    toggleMarkers();
});

// The live dataset was loaded or cleared — re-render so every topic dot
// picks up (or drops) the live border.
document.addEventListener("live-dataset-changed", () => {
  if (markersVisible) updateClusters();
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
          map.off("move", viewportTopicUpdate);
          map.off("moveend", viewportTopicUpdate);
          // Topic layer just went away — the live layer must re-check which
          // of its points still duplicate it.
          document.dispatchEvent(new Event('topic-clusters-updated'));
      } else {
          map.on("move", viewportTopicUpdate);
          map.on("moveend", viewportTopicUpdate);
          // Fresh cluster state (the map may have moved while hidden) and a
          // fresh live-border pass over every dot.
          updateClusters();
      }
  }

  toggleMarkers()