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

function ringPoints(polygon) {
  const ring = Array.isArray(polygon && polygon.coordinates) ? polygon.coordinates[0] : null;
  if (!Array.isArray(ring)) return [];
  const points = [];
  for (const pair of ring) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    points.push([lng, lat]);
  }
  return points;
}

function ringCenter(polygon) {
  const points = ringPoints(polygon);
  if (!points.length) return null;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of points) {
    lng += x;
    lat += y;
  }
  return [lng / points.length, lat / points.length];
}

// A marker is a point, so it keeps one close zoom. A polygon is framed
// from its own bounds: a ocean-sized shape stays pulled back, a tiny
// one comes in close, and neither one is allowed onto the rooftops.
const MARKER_ZOOM = 18;
const POLYGON_ZOOM_MIN = 1.5;
const POLYGON_ZOOM_MAX = 16;

function clampZoom(zoom) {
  return Math.round(Math.min(POLYGON_ZOOM_MAX, Math.max(POLYGON_ZOOM_MIN, zoom)) * 10) / 10;
}

function fallbackZoom(spanLng, spanLat, midLat, viewW, viewH) {
  const usableW = Math.max(viewW || 800, 320) * 0.76;
  const usableH = Math.max(viewH || 600, 320) * 0.76;
  const zLng = spanLng > 1e-6 ? Math.log2((usableW * 360) / (spanLng * 512)) : POLYGON_ZOOM_MAX;
  const cos = Math.max(0.2, Math.cos(midLat * Math.PI / 180));
  const zLat = spanLat > 1e-6 ? Math.log2((usableH * 360 * cos) / (spanLat * 512)) : POLYGON_ZOOM_MAX;
  return Math.min(zLng, zLat);
}

function zoomForPolygon(polygon) {
  const points = ringPoints(polygon);
  if (points.length < 2) return 14;
  const origin = points[0][0];
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    let x = lng - origin;
    if (x > 180) x -= 360;
    else if (x < -180) x += 360;
    const absLng = origin + x;
    if (absLng < minLng) minLng = absLng;
    if (absLng > maxLng) maxLng = absLng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const spanLng = maxLng - minLng;
  const spanLat = maxLat - minLat;
  // No real area: close enough to see the shape, not inside a building.
  if (spanLng < 0.0008 && spanLat < 0.0008) return 15;

  const canvas = map.getCanvas();
  const viewW = canvas ? canvas.clientWidth : 0;
  const viewH = canvas ? canvas.clientHeight : 0;
  const padX = Math.max(36, Math.round(viewW * 0.12));
  const padY = Math.max(36, Math.round(viewH * 0.12));
  let zoom = null;
  try {
    const cam = map.cameraForBounds([[minLng, minLat], [maxLng, maxLat]], {
      padding: { top: padY, bottom: padY, left: padX, right: padX },
      maxZoom: POLYGON_ZOOM_MAX,
    });
    if (cam && Number.isFinite(cam.zoom)) zoom = cam.zoom;
  } catch (err) {
    zoom = null;
  }
  if (zoom == null) zoom = fallbackZoom(spanLng, spanLat, (minLat + maxLat) / 2, viewW, viewH);
  return clampZoom(zoom);
}

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
      if (polygon && polygon.description && lngLat) {
        showPopup(lngLat, polygon.description, activePolygonPopups, zoom);
        return;
      }
      if (lngLat) {
        animateMapTo(map, lngLat, zoom);
        return;
      }
    } else {
      const marker = findMarker(place);
      const lngLat = (marker && marker.geometry && marker.geometry.coordinates) || place.point;
      if (marker && marker.properties && marker.properties.message && lngLat) {
        showPopup(lngLat, marker.properties.message, activeMarkerPopups, MARKER_ZOOM);
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
