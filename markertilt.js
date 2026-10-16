// Topic marker dots lean toward the pointer. The lean caps at 32
// degrees so a small dot still reads. A hovered dot still floats a
// few pixels. The loop runs only while a dot is under the pointer
// or a lean is easing back. The outer element stays where MapLibre
// put it. Nothing is painted over the picture. The popup is not involved.

const MAX_DEG = 32;
const EASE_MS = 60;
const PERSPECTIVE_PX = 480;

const faces = new Set();
let running = false;
let pointer = null;
let touching = false;
let listening = false;
let lastNow = 0;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function restore(face) {
  const state = face._tilt;
  if (!state) return;
  state.nx = 0;
  state.ny = 0;
  if (face.style.transform) face.style.transform = '';
}

function restoreAll() {
  for (const face of faces) restore(face);
}

function leaning(face) {
  const state = face._tilt;
  return !!state && Math.hypot(state.nx, state.ny) >= 0.02;
}

function anyLeaning() {
  for (const face of faces) {
    if (leaning(face)) return true;
  }
  return false;
}

function faceAtPointer() {
  if (!pointer) return null;
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  if (!hit || !hit.closest) return null;
  const marker = hit.closest('.marker, .cluster-bubble');
  if (!marker) return null;
  const face = marker.querySelector(':scope > .marker-face, :scope > .cluster-face');
  if (!face || !faces.has(face)) return null;
  return face;
}

function bindPointer() {
  if (listening) return;
  listening = true;
  const wake = () => {
    if (reducedMotion()) return;
    if (!running && (faceAtPointer() || anyLeaning())) ensureLoop();
  };
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') {
      if (!touching) return;
      pointer = { x: event.clientX, y: event.clientY };
      wake();
      return;
    }
    if (touching) return;
    pointer = { x: event.clientX, y: event.clientY };
    wake();
  }, { passive: true });
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    touching = true;
    pointer = { x: event.clientX, y: event.clientY };
    wake();
  }, { passive: true });
  const lift = (event) => {
    if (event.pointerType !== 'touch') return;
    touching = false;
    pointer = null;
    if (anyLeaning()) ensureLoop();
  };
  window.addEventListener('pointerup', lift, { passive: true });
  window.addEventListener('pointercancel', lift, { passive: true });
  document.addEventListener('pointerout', (event) => {
    if (event.pointerType === 'touch') return;
    if (!event.relatedTarget) {
      pointer = null;
      if (anyLeaning()) ensureLoop();
    }
  }, { passive: true });
  window.addEventListener('blur', () => {
    touching = false;
    pointer = null;
    if (anyLeaning()) ensureLoop();
  });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    if (reducedMotion()) {
      restoreAll();
      running = false;
      return;
    }
    if (faceAtPointer() || anyLeaning()) ensureLoop();
  });
}

function frame(now) {
  if (faces.size === 0 || document.hidden || reducedMotion()) {
    if (faces.size) restoreAll();
    running = false;
    lastNow = 0;
    if (document.hidden && faces.size) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && (faceAtPointer() || anyLeaning())) ensureLoop();
      }, { once: true });
    }
    return;
  }
  const dt = lastNow ? Math.min(64, now - lastNow) : 16;
  lastNow = now;
  const ease = 1 - Math.exp(-dt / EASE_MS);
  // 0 at the start of the cycle, -4px at the middle, back to 0. One cycle is 6s.
  const bob = (Math.cos((now / 6000) * Math.PI * 2) - 1) * 2;
  const hot = faceAtPointer();
  let busy = false;

  for (const face of faces) {
    const state = face._tilt;
    if (!state) continue;
    if (!face.isConnected) {
      state.nx = 0;
      state.ny = 0;
      if (face.style.transform) face.style.transform = '';
      continue;
    }
    const marker = face.parentElement;
    const isHot = face === hot && marker && pointer;
    let tx = 0;
    let ty = 0;
    if (isHot) {
      const box = marker.getBoundingClientRect();
      const halfW = Math.max(8, box.width / 2);
      const halfH = Math.max(8, box.height / 2);
      tx = clamp((pointer.x - (box.left + box.width / 2)) / halfW, -1, 1);
      ty = clamp((pointer.y - (box.top + box.height / 2)) / halfH, -1, 1);
    } else if (!leaning(face)) {
      continue;
    }
    state.nx += (tx - state.nx) * ease;
    state.ny += (ty - state.ny) * ease;
    const mag = Math.hypot(state.nx, state.ny);
    // The float stays on the dot under the pointer. The others only ease home.
    const bobY = isHot ? bob * (1 - Math.min(1, mag)) : 0;
    if (mag < 0.02 && Math.abs(bobY) < 0.25) {
      state.nx = 0;
      state.ny = 0;
      if (face.style.transform) face.style.transform = '';
      continue;
    }
    busy = true;
    // The edge toward the pointer comes forward. translateY stays screen-up.
    const rotX = state.ny * MAX_DEG;
    const rotY = -state.nx * MAX_DEG;
    face.style.transform = `perspective(${PERSPECTIVE_PX}px) translateY(${bobY.toFixed(2)}px) rotateX(${rotX.toFixed(3)}deg) rotateY(${rotY.toFixed(3)}deg)`;
  }

  if ((busy || faceAtPointer()) && !reducedMotion() && !document.hidden) requestAnimationFrame(frame);
  else {
    running = false;
    lastNow = 0;
  }
}

function ensureLoop() {
  if (running || faces.size === 0 || reducedMotion() || document.hidden) return;
  running = true;
  lastNow = 0;
  requestAnimationFrame(frame);
}

export function watchMarkerTilt(face) {
  if (reducedMotion() || !face || faces.has(face)) return;
  face._tilt = { nx: 0, ny: 0 };
  faces.add(face);
  bindPointer();
}

export function forgetMarkerTilt(face) {
  if (!face) return;
  restore(face);
  faces.delete(face);
  delete face._tilt;
}
