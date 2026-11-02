// Polygon cover videos only. Inside and popup media have no length cap.
export const COVER_VIDEO_MAX_SECONDS = 30;

// A file that rounds to the cap (30.5) still counts as 30 seconds.
const COVER_VIDEO_ROUNDING_SECONDS = 0.5;

// True when a cover video is past the cap, or its length cannot be read.
export function coverVideoTooLong(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return true;
  return seconds > COVER_VIDEO_MAX_SECONDS + COVER_VIDEO_ROUNDING_SECONDS;
}
