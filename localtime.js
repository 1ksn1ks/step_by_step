import tzlookup from '@photostructure/tz-lookup';
import { map } from './map.js';

const clockEl = document.getElementById('local-clock');

function normLon(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

let zoneFormatter = null;
let zoneName = null;
let lonOffset = null;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Local time of the map center: exact IANA timezone via tz-lookup +
// Intl (handles DST / summer-winter and half-hour zones). Falls back to a
// longitude-based UTC offset if no zone is found.
function updateClock() {
  if (!clockEl) return;
  const { lat, lng } = map.getCenter();
  const zone = tzlookup(lat, lng);

  if (zone && zone !== 'Unknown') {
    if (zone !== zoneName) {
      zoneName = zone;
      try {
        zoneFormatter = new Intl.DateTimeFormat('en-GB', {
          timeZone: zone,
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: 'short',
          hourCycle: 'h23',
        });
      } catch {
        zoneFormatter = null;
      }
    }
    lonOffset = null;
  } else {
    zoneFormatter = null;
    lonOffset = Math.round(normLon(lng) / 15);
  }

  if (zoneFormatter) {
    const parts = zoneFormatter.formatToParts(new Date());
    const get = (t) => {
      const p = parts.find((x) => x.type === t);
      return p ? p.value : '';
    };
    clockEl.textContent = `${get('hour')}:${get('minute')} · ${get('day')} ${get('month')}`;
  } else {
    const local = new Date(Date.now() + lonOffset * 3600000);
    const hh = String(local.getUTCHours()).padStart(2, '0');
    const mm = String(local.getUTCMinutes()).padStart(2, '0');
    const dd = String(local.getUTCDate()).padStart(2, '0');
    clockEl.textContent = `${hh}:${mm} · ${dd} ${MONTHS[local.getUTCMonth()]}`;
  }
}

updateClock();
setInterval(updateClock, 1000);
map.on('move', updateClock);
