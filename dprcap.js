// Draw every screen at the same fraction of its real pixels. A fixed cap of
// 1.5 left a 3× iPhone at half resolution and a 2× screen at three quarters.
// 75% is what that 2× screen already got. A 1× screen stays at 1, since
// drawing fewer CSS pixels would only make it softer. MapLibre and three.js
// both read this. Must be imported first in main.js, before they do.
const _nativeDPR = window.devicePixelRatio || 1;
const _cappedDPR = Math.min(_nativeDPR, Math.max(1, _nativeDPR * 0.75));
Object.defineProperty(window, "devicePixelRatio", {
  get: () => _cappedDPR,
});
