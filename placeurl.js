// Deep link to one marker or polygon — the same address the notifications
// "Open on the map" builds (meritocracyFormat.placeUrl) and the one
// openplace.js opens. The topic is the path because Meritocracy loads the
// topic from the pathname; place, payer, n, and at pick the pin.
// Keep this in step with the backend meritocracyFormat.js.

// at = lng,lat — a marker keeps its point; a polygon uses its ring center,
// or the single stored pin for a shared polygon. Accepts "lng,lat" strings
// and [lng, lat] / [[lng, lat], ...] arrays.
export function placePoint(kind, cord) {
  if (Array.isArray(cord)) {
    if (cord.length === 2 && cord.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return `${cord[0]},${cord[1]}`;
    }
    cord = cord.flat().join(',');
  }
  const s = String(cord == null ? '' : cord);
  if (!s.trim()) return '';
  if (kind !== 'polygon') {
    const parts = s.split(',').map(part => part.trim());
    if (parts.length < 2) return '';
    if (parts.slice(0, 2).some(part => part === '' || Number.isNaN(Number(part)))) return '';
    return `${parts[0]},${parts[1]}`;
  }
  const nums = [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
  // A shared polygon stores one pin, not the ring. That point still opens the map.
  if (nums.length === 2 && nums.every(num => Number.isFinite(num))) return `${nums[0]},${nums[1]}`;
  if (nums.length < 4) return '';
  let lng = 0;
  let lat = 0;
  let count = 0;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    lng += nums[i];
    lat += nums[i + 1];
    count += 1;
  }
  if (!count) return '';
  return `${(lng / count).toFixed(5)},${(lat / count).toFixed(5)}`;
}

export function placeUrl(input) {
  const kind = input && input.kind === 'polygon' ? 'polygon' : 'marker';
  const topic = String((input && input.topicId) || '').trim();
  const url = new URL(
    topic ? `https://onlyonhbar.com/${encodeURIComponent(topic)}` : 'https://onlyonhbar.com/'
  );
  url.searchParams.set('place', kind);
  if (topic) url.searchParams.set('topic', topic);
  if (input && input.payer) url.searchParams.set('payer', input.payer);
  if (input && input.number != null && String(input.number) !== '') url.searchParams.set('n', String(input.number));
  const at = placePoint(kind, input && input.cord);
  if (at) url.searchParams.set('at', at);
  return url.toString();
}
