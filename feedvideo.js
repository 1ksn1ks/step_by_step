// Which feed video may play. No DOM. Popup, chat, and cover videos are not inputs.

export const FEED_VIDEO_MIN = 0.6;

export const FEED_VIDEO_THRESHOLDS = Object.freeze([0, 0.25, 0.5, 0.6, 0.75, 1]);

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
