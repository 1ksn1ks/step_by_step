// Touch and pen hold on a single marker. A mouse never starts it.
// Same 480 ms as the bubble list (marker.js bindBubbleList) and the same
// short swallow after pointerup, so a later keyboard or screen-reader
// click is never eaten. The movement limit is half a rem.

export const MARKER_HOLD_MS = 480;
export const MARKER_SWALLOW_MS = 600;

// 0.5rem from the root font size. A missing size uses the CSS initial 16px.
export function holdMoveLimit(rootFontPx) {
  const size = Number(rootFontPx);
  return (Number.isFinite(size) && size > 0 ? size : 16) * 0.5;
}

// show(el, x, y) returns true when the title pill is actually visible.
// listen hears pointermove / pointerup / pointercancel (the window).
// cancelPending() drops a hold that has not fired yet.
// endHold() drops the gesture because the marker went away.
export function bindMarkerHold(el, options = {}) {
  const root = options.listen || globalThis;
  const holdMs = options.holdMs ?? MARKER_HOLD_MS;
  const swallowMs = options.swallowMs ?? MARKER_SWALLOW_MS;
  const moveLimit = options.moveLimit || (() => holdMoveLimit(16));
  const show = options.show || (() => false);

  let timer = 0;
  let sx = 0;
  let sy = 0;
  let pointerId = 0;
  let active = false;
  let shown = false;
  let swallowUntil = 0;
  let watching = false;

  const cancelTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
  };

  const stopWatch = () => {
    if (!watching) return;
    watching = false;
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerup", onLift);
    root.removeEventListener("pointercancel", onLift);
  };

  function onMove(event) {
    if (!timer || !active || event.pointerId !== pointerId) return;
    if (Math.hypot(event.clientX - sx, event.clientY - sy) > moveLimit()) cancelTimer();
  }

  function onLift(event) {
    if (!active || event.pointerId !== pointerId) return;
    const didShow = shown;
    cancelTimer();
    stopWatch();
    active = false;
    shown = false;
    if (didShow) swallowUntil = performance.now() + swallowMs;
  }

  function armWatch() {
    if (watching) return;
    watching = true;
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onLift);
    root.addEventListener("pointercancel", onLift);
  }

  el.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    // The map's long-press listens for a touch that reaches the canvas.
    // This press belongs to the marker.
    event.stopPropagation();
    swallowUntil = 0;
    shown = false;
    cancelTimer();
    pointerId = event.pointerId;
    active = true;
    sx = event.clientX;
    sy = event.clientY;
    armWatch();
    timer = setTimeout(() => {
      timer = 0;
      if (!active || pointerId !== event.pointerId) return;
      shown = !!show(el, sx, sy);
    }, holdMs);
  });

  // Capture runs before the marker's own click, which opens the post.
  el.addEventListener("click", (event) => {
    if (performance.now() < swallowUntil) {
      swallowUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    swallowUntil = 0;
  }, true);

  return {
    cancelPending: cancelTimer,
    endHold() {
      cancelTimer();
      stopWatch();
      active = false;
      shown = false;
    },
  };
}
