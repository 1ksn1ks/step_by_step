// In-memory follower counts. No DOM, so tests can load this file alone.
// A missing count stays null. Zero is a real count and is stored as 0.

export function followerCountOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function accepted(data) {
  return !!data && followerCountOrNull(data.followers) !== null;
}

// fetchCount(key, viewer) resolves to { followers, following } or null.
// One flight per key and viewer. A failed load returns null and leaves
// the previous count in place, so a poll cannot treat a guess as confirmed.
export function createFollowLoader({ fetchCount }) {
  const cache = new Map();
  const flights = new Map();

  function cached(key, viewer) {
    const row = cache.get(key);
    if (!row || typeof row.followers !== 'number') return null;
    const viewerKey = viewer || '';
    const known = row.byViewer.has(viewerKey);
    return {
      followers: row.followers,
      following: known ? !!row.byViewer.get(viewerKey) : false,
    };
  }

  function remember(key, viewer, data) {
    if (!accepted(data)) return null;
    let row = cache.get(key);
    if (!row) {
      row = { followers: data.followers, byViewer: new Map() };
      cache.set(key, row);
    }
    row.followers = data.followers;
    row.byViewer.set(viewer || '', !!data.following);
    return cached(key, viewer);
  }

  async function attempt(key, viewer) {
    try {
      return await fetchCount(key, viewer);
    } catch {
      return null;
    }
  }

  function load(key, viewer) {
    const flightKey = key + '\0' + (viewer || '');
    const existing = flights.get(flightKey);
    if (existing) return existing;
    const run = (async () => {
      let data = await attempt(key, viewer);
      if (!accepted(data)) data = await attempt(key, viewer);
      if (!accepted(data)) return null;
      return remember(key, viewer, data);
    })().finally(() => {
      if (flights.get(flightKey) === run) flights.delete(flightKey);
    });
    flights.set(flightKey, run);
    return run;
  }

  return { cached, load, remember };
}
