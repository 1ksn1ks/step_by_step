// Visibility rules for a muted GIF clip. No DOM, so the encrypted chat
// view can use them without loading the picture stack.

export const GIF_FAR_PX = 800;

export function viewDistance(rect, view) {
  if (!rect || !view) return 0;
  const above = Number(view.top) - Number(rect.bottom);
  const below = Number(rect.top) - Number(view.bottom);
  const left = Number(view.left) - Number(rect.right);
  const right = Number(rect.left) - Number(view.right);
  const sides = [above, below, left, right].filter((n) => Number.isFinite(n));
  if (!sides.length) return 0;
  return Math.max(0, ...sides);
}

// play while it is on screen, pause just off screen, drop the file when it
// is far, and leave a reduced-motion viewer on the poster.
export function loopPlayback(state) {
  if (!state || state.reduced) return "poster";
  const distance = Number(state.distance);
  if (Number.isFinite(distance) && distance > GIF_FAR_PX) return "unload";
  if (!state.visible) return "pause";
  return "play";
}
