// Opens one marker or polygon from a notification link:
//   https://onlyonhbar.com/0.0.1?place=marker&topic=0.0.1&payer=0.0.2&n=4&at=lng,lat
// The path is the topic Meritocracy loads. place, payer, n, and at pick the pin.
// An installed Meritocracy window is the handler for that address
// (manifest launch_handler: navigate-existing). A normal browser visit
// uses the same address.

import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { geojson, polygons, currentUfoModelInGLTF } from './letall.js';
import { activeMarkerPopups } from './marker.js';
import { activePolygonPopups, addPolygonWithImageFill } from './polygons.js';
import { updateClusters, index } from './marker.js';
import { processTopicMessages, allLoadedMessages, markerPopupNode, polygonPopupNode } from './processallmessages.js';
import { animateMapTo } from './animatemapto.js';
import { applyAllStyles } from './loadprofilepopup.js';
import { CloseALL, changePopupState, closeTransientMapUI } from './cssLogic.js';
import { scene } from './threejs.js';
import { toast } from './toast.js';
import { ringCenter, zoomForPolygon } from './polygonframe.js';

let opening = false;

function readPlace(href) {
  let url;
  try {
    url = new URL(href);
  } catch (err) {
    return null;
  }
  const kind = url.searchParams.get('place');
  if (kind !== 'marker' && kind !== 'polygon') return null;
  const topic = (url.searchParams.get('topic') || '').trim();
  const payer = (url.searchParams.get('payer') || '').trim();
  const number = (url.searchParams.get('n') || '').trim();
  const at = (url.searchParams.get('at') || '').split(',').map((part) => Number(part.trim()));
  const point = at.length >= 2 && at.slice(0, 2).every((n) => Number.isFinite(n)) ? [at[0], at[1]] : null;
  if (!topic && !point) return null;
  return { kind, topic, payer, number, point, key: url.search };
}

function sameId(a, b) {
  return String(a ?? '') === String(b ?? '');
}

function findMarker(place) {
  return geojson.features.find((feature) => {
    if (place.topic && !sameId(feature.topicId, place.topic)) return false;
    if (place.payer && !sameId(feature.payer, place.payer)) return false;
    if (place.number && !sameId(feature.msgNumber, place.number)) return false;
    return Boolean(place.topic || place.number);
  });
}

function findPolygon(place) {
  return polygons.find((polygon) => {
    if (place.topic && !sameId(polygon.topicId, place.topic)) return false;
    if (place.payer && !sameId(polygon.payer, place.payer)) return false;
    if (place.number && !sameId(polygon.msgNumber, place.number)) return false;
    return Boolean(place.topic || place.number);
  });
}

// A marker is a point, so it keeps one close zoom. Polygon zoom lives in
// polygonframe.js and is shared with the popup number.
const MARKER_ZOOM = 18;

function hideModel() {
  if (currentUfoModelInGLTF) {
    scene.remove(currentUfoModelInGLTF);
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = 'none';
  }
}

function showPopup(lngLat, content, list, zoom) {
  closeTransientMapUI();
  CloseALL();
  const popup = new maplibregl.Popup({ focusAfterOpen: false })
    .setLngLat(lngLat)
    .setDOMContent(content)
    .addTo(map);
  popup.on('close', () => {
    changePopupState(false);
    if (currentUfoModelInGLTF) {
      scene.add(currentUfoModelInGLTF);
      const crosshair = document.getElementById('crosshair');
      if (crosshair) crosshair.style.display = 'block';
    }
  });
  list.push(popup);
  changePopupState(true);
  applyAllStyles();
  hideModel();
  animateMapTo(map, lngLat, zoom);
}

async function ensureTopic(topicId) {
  if (!topicId) return;
  if (allLoadedMessages.some((entry) => sameId(entry.topicId, topicId))) return;
  const before = polygons.length;
  await processTopicMessages(topicId);
  if (geojson.features.length > 0) {
    index.load(geojson.features);
    updateClusters();
  }
  for (let i = before; i < polygons.length; i++) {
    addPolygonWithImageFill(map, polygons[i]);
  }
}

export async function openLinkedPlace(href) {
  const place = readPlace(href || window.location.href);
  if (!place || opening) return;
  opening = true;
  try {
    // Markers have no area, so they can fly immediately. A polygon's zoom
    // depends on the ring, which is only known once that topic is loaded.
    if (place.kind === 'marker' && place.point) animateMapTo(map, place.point, MARKER_ZOOM);
    if (place.topic) {
      toast.info(place.kind === 'polygon' ? 'Opening polygon…' : 'Opening marker…');
      await ensureTopic(place.topic);
    }
    if (place.kind === 'polygon') {
      const polygon = findPolygon(place);
      const lngLat = (polygon && ringCenter(polygon)) || place.point;
      const zoom = polygon ? zoomForPolygon(polygon) : 8;
      const polygonCard = polygon && polygonPopupNode(polygon);
      if (polygonCard && lngLat) {
        showPopup(lngLat, polygonCard, activePolygonPopups, zoom);
        return;
      }
      if (lngLat) {
        animateMapTo(map, lngLat, zoom);
        return;
      }
    } else {
      const marker = findMarker(place);
      const lngLat = (marker && marker.geometry && marker.geometry.coordinates) || place.point;
      const markerCard = marker && marker.properties && markerPopupNode(marker.properties);
      if (markerCard && lngLat) {
        showPopup(lngLat, markerCard, activeMarkerPopups, MARKER_ZOOM);
        return;
      }
    }
    if (place.point) return;
    toast.error(place.kind === 'polygon' ? 'That polygon is not on this topic.' : 'That marker is not on this topic.');
  } catch (err) {
    console.error('Open place failed:', err);
    toast.error('Could not open that place.');
  } finally {
    opening = false;
  }
}

function arm() {
  const place = readPlace(window.location.href);
  if (!place) return;
  const run = () => openLinkedPlace(window.location.href);
  if (window.__topicsReady) run();
  else window.addEventListener('topics-ready', run, { once: true });
}

arm();

if ('launchQueue' in window) {
  window.launchQueue.setConsumer((params) => {
    if (!params.targetURL) return;
    const place = readPlace(params.targetURL);
    if (!place) return;
    if (window.__topicsReady) openLinkedPlace(params.targetURL);
    else window.addEventListener('topics-ready', () => openLinkedPlace(params.targetURL), { once: true });
  });
}
