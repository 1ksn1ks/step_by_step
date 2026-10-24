// Offline city and country for feed place labels.
//
// Feed cells are coarser than live-marker GEO_GRID (0.1 deg, about 11 km).
// Key: "f" + Math.round(lng / 0.5) + ":" + Math.round(lat / 0.5)
// Example: longitude 13.4, latitude 52.5 is "f27:105".
// feedlayout.js placeKey() builds the same string. /api/place stores it in
// geo_cache. The leading "f" keeps a feed cell distinct from a live-marker
// key, which is an unprefixed "lngCell:latCell" on the 0.1 deg grid.
//
// City names are GeoNames places with population over 15,000 (CC-BY 4.0).
// https://www.geonames.org/

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FEED_PLACE_GRID = 0.5;
const REACH_KM = 100;

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "feed-cities.json"), "utf8"));
const countries = data.countries || {};
const buckets = new Map();

function wrapLng(lng) {
  const wrapped = ((lng + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function bucketId(lat, lng) {
  const cellLng = Math.floor(wrapLng(lng));
  return Math.floor(lat) + ":" + (cellLng === 180 ? -180 : cellLng);
}

for (const row of data.cities || []) {
  if (!row || !countries[row[3]]) continue;
  const id = bucketId(row[0], row[1]);
  let list = buckets.get(id);
  if (!list) {
    list = [];
    buckets.set(id, list);
  }
  list.push(row);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const radius = 6371;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function feedGeoKey(lng, lat) {
  return "f" + Math.round(lng / FEED_PLACE_GRID) + ":" + Math.round(lat / FEED_PLACE_GRID);
}

export function parseFeedGeoKey(key) {
  const match = /^f(-?\d+):(-?\d+)$/.exec(String(key || ""));
  if (!match) return null;
  const lng = Number(match[1]) * FEED_PLACE_GRID;
  const lat = Number(match[2]) * FEED_PLACE_GRID;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

// Nearest listed city within REACH_KM. Null when the cell is ocean or
// too far from a city, so the caller can fall through to Nominatim.
export function lookupFeedPlace(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  const baseLat = Math.floor(lat);
  const lng0 = Math.floor(wrapLng(lng));
  let best = null;
  let bestPop = -1;
  let bestKm = REACH_KM;
  for (let dLat = -2; dLat <= 2; dLat += 1) {
    for (let dLng = -2; dLng <= 2; dLng += 1) {
      let cellLng = lng0 + dLng;
      if (cellLng >= 180) cellLng -= 360;
      if (cellLng < -180) cellLng += 360;
      const list = buckets.get((baseLat + dLat) + ":" + cellLng);
      if (!list) continue;
      for (const row of list) {
        const km = haversineKm(lat, lng, row[0], row[1]);
        if (km > REACH_KM) continue;
        const pop = row[4] || 0;
        if (pop > bestPop || (pop === bestPop && km < bestKm)) {
          best = row;
          bestPop = pop;
          bestKm = km;
        }
      }
    }
  }
  if (!best) return null;
  const code = best[3];
  const country = countries[code];
  if (!country) return null;
  return { city: best[2], country, code };
}
