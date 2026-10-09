// Opens one marker or polygon from a notification link:
//   https://onlyonhbar.com/?place=marker&topic=0.0.1&payer=0.0.2&n=4&at=lng,lat
// An installed Meritocracy window is the handler for that address
// (manifest launch_handler: navigate-existing). A normal browser visit
// uses the same query.

import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { geojson, polygons, currentUfoModelInGLTF } from './letall.js';
import { activeMarkerPopups } from './marker.js';
import { activePolygonPopups, addPolygonWithImageFill } from './polygons.js';
import { updateClusters, index } from './marker.js';
import { processTopicMessages, allLoadedMessages } from './processallmessages.js';
import { animateMapTo } from './animatemapto.js';
import { applyAllStyles } from './loadprofilepopup.js';
import { CloseALL, changePopupState, closeTransientMapUI } from './cssLogic.js';
import { scene } from './threejs.js';
import { toast } from './toast.js';

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

function ringCenter(polygon) {
  const ring = Array.isArray(polygon.coordinates) ? polygon.coordinates[0] : null;
  if (!Array.isArray(ring)) return null;
  let lng = 0;
  let lat = 0;
  let count = 0;
  for (const pair of ring) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    lng += x;
    lat += y;
    count += 1;
  }
  if (!count) return null;
  return [lng / count, lat / count];
}

function hideModel() {
  if (currentUfoModelInGLTF) {
    scene.remove(currentUfoModelInGLTF);
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = 'none';
  }
}

function showPopup(lngLat, content, list) {
  closeTransientMapUI();
  CloseALL();
  const popup = new maplibregl.Popup()
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
  animateMapTo(map, lngLat, 16);
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
    if (place.topic) {
      toast.info(place.kind === 'polygon' ? 'Opening polygon…' : 'Opening marker…');
      await ensureTopic(place.topic);
    }
    if (place.kind === 'polygon') {
      const polygon = findPolygon(place);
      const lngLat = (polygon && ringCenter(polygon)) || place.point;
      if (polygon && polygon.description && lngLat) {
        showPopup(lngLat, polygon.description, activePolygonPopups);
        return;
      }
    } else {
      const marker = findMarker(place);
      const lngLat = (marker && marker.geometry && marker.geometry.coordinates) || place.point;
      if (marker && marker.properties && marker.properties.message && lngLat) {
        showPopup(lngLat, marker.properties.message, activeMarkerPopups);
        return;
      }
    }
    if (place.point) animateMapTo(map, place.point, 16);
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
