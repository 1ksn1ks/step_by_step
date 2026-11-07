// arrowfilters.js — two of the popup settings' "Prev / next arrows"
// choices, shared by the topic arrows (processallmessages.js) and the live
// arrows (localnews.js):
//   Video length: the presets (Under 30s, 30s–2 min, Over 2 min) or a
//                 custom range, from / to, either end open.
//   Distance:     Any, 1 km, 10 km, 100 km, or a custom km. The arrows
//                 only step to posts within that distance of the post that
//                 is open (a shape counts from its middle).
// Both are kept across visits. No imports: anything may load this.

const LENGTH_CUSTOM_KEY = 'meritocracy-length-custom';
const RADIUS_MODE_KEY = 'meritocracy-radius-mode';
const RADIUS_CUSTOM_KEY = 'meritocracy-radius-custom';

export const RADIUS_PRESETS = ['any', '1', '10', '100'];
export const RADIUS_MAX_KM = 20000; // half the Earth: anything farther is everywhere
export const LENGTH_MAX_SECONDS = 24 * 3600;

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // blocked or broken store: the default
  }
}

function writeValue(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch { /* kept for this visit only by the caller's own state */ }
}

// null / '' is an open end (Number(null) would read as 0 seconds).
function cleanBound(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= LENGTH_MAX_SECONDS ? Math.round(n) : null;
}

// ── Video length ───────────────────────────────────────────────────────
// { min, max } in seconds; null is an open end. From above To swaps.
export function customLength() {
  const saved = readJson(LENGTH_CUSTOM_KEY) || {};
  let min = cleanBound(saved.min);
  let max = cleanBound(saved.max);
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return { min, max };
}

export function setCustomLength(min, max) {
  let lo = cleanBound(min);
  let hi = cleanBound(max);
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  writeValue(LENGTH_CUSTOM_KEY, { min: lo, max: hi });
  return { min: lo, max: hi };
}

// A video of known length against the Video length choice.
export function secondsMatch(seconds, mode) {
  if (mode === 'any') return true;
  if (seconds == null) return false;
  if (mode === 'under') return seconds < 30;
  if (mode === 'mid') return seconds >= 30 && seconds <= 120;
  if (mode === 'over') return seconds > 120;
  if (mode === 'custom') {
    const { min, max } = customLength();
    if (min != null && seconds < min) return false;
    if (max != null && seconds > max) return false;
    return true;
  }
  return true;
}

// "90", "1:30", "1m30s", "2m", "45s", "1h" → seconds. Empty → null (open
// end). Anything else → NaN, so the field can say it is not a length.
export function parseDuration(text) {
  const value = String(text == null ? '' : text).trim().toLowerCase();
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value));
  const clock = value.match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2})$/);
  if (clock) {
    const [, h, m, s] = clock;
    if (Number(s) > 59) return NaN;
    return Number(h || 0) * 3600 + Number(m) * 60 + Number(s);
  }
  const units = value.replace(/\s+/g, '').match(/^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s(?:ec)?)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0);
  }
  return NaN;
}

// 90 → "1:30", 45 → "0:45", 3700 → "1:01:40".
export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// The custom range in words, for the button and the "No more" note.
export function customLengthLabel() {
  const { min, max } = customLength();
  if (min != null && max != null) return `${formatDuration(min)}–${formatDuration(max)}`;
  if (min != null) return `Over ${formatDuration(min)}`;
  if (max != null) return `Under ${formatDuration(max)}`;
  return 'Any length';
}

// ── Distance ───────────────────────────────────────────────────────────
export function radiusMode() {
  try {
    const mode = localStorage.getItem(RADIUS_MODE_KEY);
    if (RADIUS_PRESETS.includes(mode) || mode === 'custom') return mode;
  } catch { /* the default */ }
  return 'any';
}

export function setRadiusMode(mode) {
  if (!RADIUS_PRESETS.includes(mode) && mode !== 'custom') return;
  writeValue(RADIUS_MODE_KEY, mode);
}

export function customRadius() {
  const km = Number(readJson(RADIUS_CUSTOM_KEY));
  return Number.isFinite(km) && km > 0 && km <= RADIUS_MAX_KM ? km : null;
}

export function setCustomRadius(km) {
  const n = Number(km);
  const clean = Number.isFinite(n) && n > 0 ? Math.min(n, RADIUS_MAX_KM) : null;
  writeValue(RADIUS_CUSTOM_KEY, clean == null ? null : String(clean));
  return clean;
}

// The distance limit in km, or null for Any (a custom choice with no
// number yet is Any too).
export function radiusKm() {
  const mode = radiusMode();
  if (mode === 'any') return null;
  if (mode === 'custom') return customRadius();
  return Number(mode);
}

// "12", "12 km", "0,5", "800 m", "5 mi" → km. Empty → null; else NaN.
export function parseKm(text) {
  const value = String(text == null ? '' : text).trim().toLowerCase().replace(',', '.');
  if (!value) return null;
  const m = value.match(/^(\d+(?:\.\d+)?)\s*(km|m|mi)?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  if (m[2] === 'm') return n / 1000;
  if (m[2] === 'mi') return n * 1.609344;
  return n;
}

export function formatKm(km) {
  if (km == null || !Number.isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${rounded} km`;
}

// Great-circle distance between two [lng, lat] points.
export function distanceKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// True when point is within the Distance choice of origin. Any always is;
// with a limit, a post without a place (or no origin) is not.
export function withinRadius(origin, point) {
  const km = radiusKm();
  if (km == null) return true;
  if (!origin || !point) return false;
  return distanceKm(origin, point) <= km;
}

// "within 10 km", for the "No more" note; '' for Any.
export function radiusLabel() {
  const km = radiusKm();
  return km == null ? '' : `within ${formatKm(km)}`;
}
