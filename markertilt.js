// Topic marker dots, and the profile picture inside a popup, lean toward
// the pointer. The lean caps at 32 degrees. A hovered face still floats a
// few pixels. The loop runs only while a face is under the pointer or a
// lean is easing back. The outer marker element stays where MapLibre put
// it. Nothing is painted over the picture.

const MAX_DEG = 32;
const EASE_MS = 60;
const PERSPECTIVE_PX = 480;

// A popup picture, or the early-Hashinal ring wrapped around one.
const PROFILE_PICTURE = '.popup-profile-bubble > img, .popup-profile-bubble > .early-hashinal > img, img.profile-live-pic';

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

function clearLean(face) {
  if (face.style.transform) face.style.transform = '';
  if (face.style.transformStyle) face.style.transformStyle = '';
  if (face.style.willChange) face.style.willChange = '';
}

function restore(face) {
  const state = face._tilt;
  if (!state) return;
  state.nx = 0;
  state.ny = 0;
  state.bob = 0;
  clearLean(face);
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

function hostDepth(host) {
  let depth = 0;
  let node = host;
  while (node) {
    depth += 1;
    node = node.parentElement;
  }
  return depth;
}

// The watched face whose host contains the element under the pointer.
// Marker and cluster hosts are the outer box, so this matches the old
// .marker / .cluster-bubble lookup. A picture's host is the picture
// itself, or the ring wrapped around it. The moon stays pointer-events:none
// so a drag still hits the map; its face is chosen by the same box when
// the hit is the canvas. A finger never takes that path.
function faceAtPointer() {
  if (!pointer) return null;
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  if (!hit) return null;
  let best = null;
  let bestDepth = -1;
  for (const face of faces) {
    const host = face._tilt && face._tilt.host;
    if (!host || !host.contains(hit)) continue;
    const depth = hostDepth(host);
    if (depth >= bestDepth) {
      best = face;
      bestDepth = depth;
    }
  }
  if (best || touching) return best;
  if (typeof hit.closest !== 'function' || !hit.closest('.maplibregl-canvas')) return null;
  for (const face of faces) {
    if (!face.classList || !face.classList.contains('moon-face')) continue;
    const host = face._tilt && face._tilt.host;
    if (!host || !host.isConnected) continue;
    const box = host.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    if (pointer.x < box.left || pointer.x > box.right || pointer.y < box.top || pointer.y > box.bottom) continue;
    const depth = hostDepth(host);
    if (depth >= bestDepth) {
      best = face;
      bestDepth = depth;
    }
  }
  return best;
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
  for (const face of faces) {
    if (!face.isConnected) forgetTilt(face);
  }
  if (faces.size === 0) {
    running = false;
    lastNow = 0;
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
    const host = (state.host && state.host.isConnected) ? state.host : face.parentElement;
    const isHot = face === hot && host && pointer;
    let tx = 0;
    let ty = 0;
    if (isHot) {
      const box = host.getBoundingClientRect();
      let width = box.width;
      let height = box.height;
      let midX = box.left + width / 2;
      let midY = box.top + height / 2;
      // Marker hosts are the outer box and are not transformed. A picture
      // is its own host, so a lean would inflate the box it is measured from.
      if (host === face && face.style.transform) {
        if (face.offsetWidth) width = face.offsetWidth;
        if (face.offsetHeight) height = face.offsetHeight;
        midY -= state.bob || 0;
      }
      const halfW = Math.max(8, width / 2);
      const halfH = Math.max(8, height / 2);
      tx = clamp((pointer.x - midX) / halfW, -1, 1);
      ty = clamp((pointer.y - midY) / halfH, -1, 1);
    } else if (!leaning(face)) {
      continue;
    }
    state.nx += (tx - state.nx) * ease;
    state.ny += (ty - state.ny) * ease;
    const mag = Math.hypot(state.nx, state.ny);
    // The float stays on the face under the pointer. The others only ease home.
    const bobY = isHot ? bob * (1 - Math.min(1, mag)) : 0;
    if (mag < 0.02 && Math.abs(bobY) < 0.25) {
      state.nx = 0;
      state.ny = 0;
      state.bob = 0;
      clearLean(face);
      continue;
    }
    busy = true;
    state.bob = bobY;
    // The edge toward the pointer comes forward. translateY stays screen-up.
    const rotX = state.ny * MAX_DEG;
    const rotY = -state.nx * MAX_DEG;
    face.style.transformStyle = 'flat';
    face.style.willChange = 'transform';
    // The moon keeps this same perspective zoom and the same ease, with no
    // rotation. The near edge used to come forward by half * sin(angle);
    // that distance is translateZ, so the disc grows through the same 480px
    // perspective. Markers still rotate.
    if (face.classList && face.classList.contains('moon-face')) {
      const box = (host || face).getBoundingClientRect();
      const half = Math.max(8, box.width / 2);
      const zoomZ = half * Math.sin((Math.hypot(rotX, rotY) * Math.PI) / 180);
      face.style.transform = `perspective(${PERSPECTIVE_PX}px) translateY(${bobY.toFixed(2)}px) translateZ(${zoomZ.toFixed(2)}px)`;
    } else {
      face.style.transform = `perspective(${PERSPECTIVE_PX}px) translateY(${bobY.toFixed(2)}px) rotateX(${rotX.toFixed(3)}deg) rotateY(${rotY.toFixed(3)}deg)`;
    }
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

// host defaults to the parent, which is the marker or cluster box today.
export function watchTilt(face, host) {
  if (reducedMotion() || !face || faces.has(face)) return;
  face._tilt = { nx: 0, ny: 0, bob: 0, host: host || face.parentElement || face };
  faces.add(face);
  bindPointer();
  // A card built ahead of being shown is not connected yet. Drop it on the
  // next frame if it is still detached. setDOMContent watches it again.
  if (!face.isConnected) {
    requestAnimationFrame(() => {
      if (!face.isConnected && faces.has(face)) forgetTilt(face);
    });
  }
}

export function forgetTilt(face) {
  if (!face) return;
  restore(face);
  faces.delete(face);
  delete face._tilt;
}

export function watchMarkerTilt(face, host) {
  return watchTilt(face, host);
}

export function forgetMarkerTilt(face) {
  return forgetTilt(face);
}

function profileFace(img) {
  const parent = img && img.parentElement;
  if (parent && parent.classList.contains('early-hashinal')) return parent;
  return img;
}

// The picture leans. When an early-Hashinal ring is wrapped around it,
// the ring leans with it. The popup pill ring stays on the bubble.
export function watchProfilePicture(img) {
  if (!img) return;
  const face = profileFace(img);
  if (face !== img) forgetTilt(img);
  watchTilt(face, face);
}

export function forgetProfilePicture(img) {
  if (!img) return;
  forgetTilt(img);
  const parent = img.parentElement;
  if (parent && parent.classList.contains('early-hashinal')) forgetTilt(parent);
}

function profilePicturesIn(root) {
  const found = [];
  if (!root || typeof root.querySelectorAll !== 'function') return found;
  if (root.matches && root.matches(PROFILE_PICTURE)) found.push(root);
  root.querySelectorAll(PROFILE_PICTURE).forEach((img) => found.push(img));
  return found;
}

export function watchProfileTree(root) {
  profilePicturesIn(root).forEach(watchProfilePicture);
}

export function forgetProfileTree(root) {
  profilePicturesIn(root).forEach(forgetProfilePicture);
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.popup-profile-bubble > .early-hashinal, .profile-live-bubble > .early-hashinal').forEach((shell) => forgetTilt(shell));
}
