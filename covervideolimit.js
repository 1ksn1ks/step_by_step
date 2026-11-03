// Polygon cover videos only. Inside and popup media have no length cap.
export const COVER_VIDEO_MAX_SECONDS = 30;

// loadedmetadata on a slow phone can take longer than 5s. The wait only
// runs until the browser answers or errors, so a fast file is not delayed.
export const COVER_VIDEO_PROBE_MS = 15000;

// A file that rounds to the cap (30.5) still counts as 30 seconds.
const COVER_VIDEO_ROUNDING_SECONDS = 0.5;

export const COVER_VIDEO_UNKNOWN_TOAST = "Couldn't read the video length. Try MP4/H.264";

// True only when the length is known and past the cap. An unread length
// is a separate refusal: the map loop rewinds playback, it does not stop
// a long file from being stored or played where that loop does not run.
export function coverVideoTooLong(seconds) {
  return typeof seconds === "number"
    && Number.isFinite(seconds)
    && seconds > COVER_VIDEO_MAX_SECONDS + COVER_VIDEO_ROUNDING_SECONDS;
}

export function coverVideoLengthUnknown(seconds) {
  return typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0;
}

// Empty when the cover may upload. Otherwise the toast for that refusal.
export function coverVideoReject(seconds) {
  if (coverVideoLengthUnknown(seconds)) return COVER_VIDEO_UNKNOWN_TOAST;
  if (coverVideoTooLong(seconds)) return `Cover video max ${COVER_VIDEO_MAX_SECONDS} seconds`;
  return "";
}
