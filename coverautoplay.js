// Whether a polygon cover video may start by itself. No DOM.
// Save-Data, a low battery, and reduced motion always refuse.
// The last return is the NFT / topic rule, and it stays off until one lands.

export const COVER_RELEASE_MS = 3000;

// getBattery level at or below this, and not charging, counts as low.
export const COVER_LOW_BATTERY = 0.2;

export function shouldAutoplayCover(polygon, viewer) {
  const view = viewer || {};
  if (view.saveData) return false;
  if (view.lowBattery) return false;
  if (view.reducedMotion) return false;
  // A later NFT or topic rule replaces the line below. The three checks stay first.
  if (!polygon) return false;
  return false;
}

export function coverBatteryIsLow(battery) {
  if (!battery || typeof battery !== "object") return false;
  const level = Number(battery.level);
  if (!Number.isFinite(level)) return false;
  if (battery.charging) return false;
  return level <= COVER_LOW_BATTERY;
}

// True while the file should stay attached. Off screen, a hidden tab, the
// feed, or another cover taking the only play slot all let it go.
export function coverHoldSrc(state) {
  if (!state || !state.hasSrc) return false;
  if (state.replaced || state.hidden || state.feed || !state.inView) return false;
  return true;
}

export function coverShouldRelease(since, now) {
  if (since == null || now == null) return false;
  const start = Number(since);
  const at = Number(now);
  if (!Number.isFinite(start) || !Number.isFinite(at)) return false;
  return at - start >= COVER_RELEASE_MS;
}

// Every other cover gives its file back when this one starts. One plays.
export function coverIdsToRelease(ids, nextId) {
  if (!nextId || !Array.isArray(ids)) return [];
  return ids.filter((id) => id && id !== nextId);
}
