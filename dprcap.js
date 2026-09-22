// Cap the device pixel ratio for every canvas backend (MapLibre + three.js):
// phones report 2-3x, which means 4-9x more pixels than the eye can use.
// Must be imported first in main.js, before map.js / threejs.js read it.
const _nativeDPR = window.devicePixelRatio;
Object.defineProperty(window, "devicePixelRatio", {
  get: () => Math.min(_nativeDPR, 1.5),
});
