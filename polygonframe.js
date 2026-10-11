// Shared with Open on the map. A polygon is framed from its own ring:
// a large shape stays pulled back, a tiny one comes in close, and
// neither one is allowed onto the rooftops.
import { map } from './map.js';

export function ringPoints(polygon) {
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

export function ringCenter(polygon) {
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

export function zoomForPolygon(polygon) {
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
