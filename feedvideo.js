// Which feed video may play. No DOM. Popup, chat, and cover videos are not inputs.

export const FEED_VIDEO_MIN = 0.6;

export const FEED_VIDEO_THRESHOLDS = Object.freeze([0, 0.25, 0.5, 0.6, 0.75, 1]);

// A fast scroll must not start every video it passes. A paused video that
// has sat fully off screen this long gives its file back.
export const FEED_VIDEO_DWELL_MS = 250;
export const FEED_VIDEO_RELEASE_MS = 3000;

// A user-started or unmuted video stays as-is while any of it is visible.
export function feedVideoHeld(state) {
  const ratio = Number(state && state.ratio);
  if (!(ratio > 0)) return false;
  return !!(state && (state.user || state.held));
}

// Autoplay waits out the dwell. A user start, and a video that is already
// playing, do not.
export function feedVideoStartDelay(state) {
  if (!state || state.id == null) return 0;
  if (state.user || state.playing) return 0;
  return FEED_VIDEO_DWELL_MS;
}

// Metadata after an autoplay pause. Empty means leave the current preload.
export function feedVideoPreloadOnPause(state) {
  if (!state || !state.hasSrc) return "";
  if (feedVideoHeld(state)) return "";
  return "metadata";
}

// True once a paused video has been at 0 visibility for the release window.
export function feedVideoShouldRelease(state, now) {
  if (!state || state.zeroSince == null) return false;
  if (feedVideoHeld(state)) return false;
  const ratio = Number(state.ratio);
  if (ratio > 0) return false;
  const since = Number(state.zeroSince);
  const at = Number(now);
  if (!Number.isFinite(since) || !Number.isFinite(at)) return false;
  return at - since >= FEED_VIDEO_RELEASE_MS;
}

// A scroll frame remeasures videos the observer still reports, plus the one
// playing and the one the user chose. A stored 0 stays 0 until the observer
// sees the video again.
export function feedVideosToMeasure(ratios, active, preferred) {
  const list = [];
  const seen = new Set();
  const rows = ratios && typeof ratios[Symbol.iterator] === "function" ? ratios : [];
  for (const row of rows) {
    if (!row) continue;
    const video = row[0];
    const ratio = Number(row[1]);
    if (video == null || seen.has(video)) continue;
    if (ratio > 0 || video === active || video === preferred) {
      seen.add(video);
      list.push(video);
    }
  }
  for (const extra of [active, preferred]) {
    if (extra == null || seen.has(extra)) continue;
    seen.add(extra);
    list.push(extra);
  }
  return list;
}

// Highest ratio at or above the minimum. A user-chosen video stays while any
// of it is still visible. An equal ratio keeps the video that is already playing.
export function pickFeedVideo(candidates, options) {
  const list = Array.isArray(candidates) ? candidates : [];
  const preferred = options && options.preferred;
  const current = options && options.current;
  if (preferred != null) {
    for (const item of list) {
      if (!item || item.id !== preferred) continue;
      if (Number(item.ratio) > 0) return preferred;
    }
  }
  let best = null;
  for (const item of list) {
    if (!item) continue;
    const ratio = Number(item.ratio);
    if (!(ratio >= FEED_VIDEO_MIN)) continue;
    if (!best || ratio > Number(best.ratio) || (ratio === Number(best.ratio) && item.id === current)) {
      best = item;
    }
  }
  return best ? best.id : null;
}

// Autoplay is off for reduced motion, the browser Save-Data flag, an explicit
// autoplay opt-out, and the feed data-saver switch.
export function feedAutoplayAllowed(flags) {
  const opts = flags || {};
  if (opts.autoplay === false) return false;
  if (opts.reducedMotion) return false;
  if (opts.saveData) return false;
  if (opts.dataSaver) {
    if (opts.connectionKnown === false) return false;
    if (opts.constrained) return false;
  }
  return true;
}
