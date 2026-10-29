import * as THREE from 'three';
import { handleMovement } from './joystick.js';
import { map } from './map.js';
import { updateMoon, moonScreen } from './moon.js';

export const scene = new THREE.Scene();

// preserveDrawingBuffer keeps the last star frame on the canvas while the
// loop below skips redraws. Without it the browser may clear the canvas
// after compositing, and a still map would lose its stars.
export const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document
  .getElementById("three-container")
  .appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

function createStars() {
  const starsGeometry = new THREE.BufferGeometry();
  const starCount = 2000;
  const positions = new Float32Array(starCount * 3);
  const innerRadius = 900;
  const outerRadius = 950;

  for (let i = 0; i < starCount; i++) {
    const i3 = i * 3;

    // Generate random spherical coordinates
    const theta = Math.random() * 2 * Math.PI; // Azimuthal angle
    const phi = Math.acos(2 * Math.random() - 1); // Polar angle
    // Random radius between innerRadius and outerRadius
    const radius = Math.cbrt(Math.random()) * (outerRadius - innerRadius) + innerRadius;

    // Convert to Cartesian coordinates
    positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = radius * Math.cos(phi);
  }

  starsGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3)
  );
  const starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5,
    sizeAttenuation: true,
  });

  const stars = new THREE.Points(starsGeometry, starsMaterial);
  scene.add(stars);
  return stars;
}

const stars = createStars();

const directions = [
  [1, 1, 1],
  [-1, 1, 1],
  [1, -1, 1],
  [-1, -1, 1],
  [1, 1, -1],
  [-1, 1, -1],
  [1, -1, -1],
  [-1, -1, -1],
];

directions.forEach((dir) => {
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.25);
  directionalLight.position.set(...dir).normalize();
  scene.add(directionalLight);
});

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

camera.position.z = 10;

const randomLatitude = (Math.random() * 180) - 90; // Random latitude between -90 and 90
const randomLongitude = (Math.random() * 360) - 180; // Random longitude between -180 and 180

let targetRotationX = 0;
let targetRotationY = 0;
let prevLng = 0;
let prevLat = 0;
let coordTextLen = -1;
const lerpFactor = 0.05; // Controls smoothness

// Stars only show in space: the globe is a circle centered on the map center.
// The moon is a DOM div painted UNDER this canvas, so stars over it would
// show through — cull that circle too (moonScreen: {x, y, half} or null).
// Both checks run when the picture can change: the map view, the catch-up
// spin, the moon's screen circle, or a resize. A still sky keeps the last frame.
let lastRenderTime = 0;
let globeCenterX = 0;
let globeCenterY = 0;
let globeRadius = 0;
let heldLat = null;
let heldLng = null;
let heldZoom = null;
let heldBearing = null;
let heldPitch = null;
let heldMoon = '';
let starsDirty = true;
let resizeDirty = false;
// ~0.1px at this camera. Snap the leftover so the glide can finish and stay finished.
const ROT_EPS = 1e-4;

function viewMoved(lat, lng, zoom, bearing, pitch) {
  if (heldLat === null) return true;
  return Math.abs(lat - heldLat) > 1e-7
    || Math.abs(lng - heldLng) > 1e-7
    || Math.abs(zoom - heldZoom) > 1e-5
    || Math.abs(bearing - heldBearing) > 1e-4
    || Math.abs(pitch - heldPitch) > 1e-4;
}

function moonBucket() {
  const moon = moonScreen;
  if (!moon) return 'none';
  return `${Math.round(moon.x)}|${Math.round(moon.y)}|${Math.round(moon.half)}`;
}

function updateGlobeRadius() {
  const c = map.getCenter();
  // a point 89.9° along the meridian from center (wraps over the pole)
  let lat = c.lat + 89.9;
  let lng = c.lng;
  if (lat > 90) { lat = 180 - lat; lng += 180; }
  if (lat < -90) { lat = -180 - lat; lng -= 180; }
  const centerPx = map.project([c.lng, c.lat]);
  const horizonPx = map.project([lng, lat]);
  globeCenterX = centerPx.x;
  globeCenterY = centerPx.y;
  globeRadius = Math.hypot(horizonPx.x - centerPx.x, horizonPx.y - centerPx.y);
}

// The live position buffer is rewritten by culling, so keep the full pool separately
const originalStarPositions = new Float32Array(stars.geometry.attributes.position.array);

const _starVec = new THREE.Vector3();
function cullStarsToSpace() {
  const pos = stars.geometry.attributes.position;
  const dst = pos.array;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const r2 = globeRadius * globeRadius;
  // Refresh matrixWorld to the CURRENT rotation before culling: animate()
  // lerps stars.rotation every frame, but matrixWorld otherwise still holds
  // the PREVIOUS render's transform — during a fast spin that one-frame lag
  // painted stars up to a frame's worth of travel inside the globe/moon
  // circles (they "flew behind" the moon while rotating). The render below
  // recomputes the same matrix, so cull decision == painted position.
  stars.updateMatrixWorld();
  let n = 0;
  for (let i = 0; i < originalStarPositions.length / 3; i++) {
    _starVec.set(originalStarPositions[i * 3], originalStarPositions[i * 3 + 1], originalStarPositions[i * 3 + 2])
      .applyMatrix4(stars.matrixWorld)
      .project(camera);
    const sx = (_starVec.x + 1) * 0.5 * w;
    const sy = (1 - _starVec.y) * 0.5 * h;
    const dx = sx - globeCenterX;
    const dy = sy - globeCenterY;
    if (dx * dx + dy * dy <= r2) continue; // behind the globe
    const moon = moonScreen; // live binding — {x, y, half} or null
    if (moon) {
      // +2px pad: a star sprite is ~2px wide, so cull to the rim, not the
      // exact circle — no star pixels can ever overlap the moon's edge, even
      // mid-spin when the rotation lerp moves stars a sub-pixel per frame.
      const mr = moon.half + 2;
      const mx = sx - moon.x;
      const my = sy - moon.y;
      if (mx * mx + my * my <= mr * mr) continue; // behind the moon
    }
    dst[n * 3] = originalStarPositions[i * 3];
    dst[n * 3 + 1] = originalStarPositions[i * 3 + 1];
    dst[n * 3 + 2] = originalStarPositions[i * 3 + 2];
    n++;
  }
  pos.needsUpdate = true;
  stars.geometry.setDrawRange(0, n);
}

function animate(now) {
    requestAnimationFrame(animate);
    // Feed mode covers the globe. Skip drawing and keyboard motion until
    // the feed peeks or closes. The next frame resumes on its own.
    if (document.documentElement.classList.contains('feed-app')) return;
    handleMovement();
  
    const center = map.getCenter();
    const lat = center.lat.toFixed(5);
    const lng = center.lng.toFixed(5);
    const zoom = map.getZoom().toFixed(1);

    // Update coordinates display only if changed. A successful copy holds
    // the same "Copyed!" flash the topic name uses, then the live text returns.
    const coordinatesDisplay = document.getElementById("coordinates-display");
    const newCoords = `Z: ${zoom} lng: ${lng}, lat: ${lat}`;
    const copiedUntil = Number(coordinatesDisplay.dataset.copiedUntil) || 0;
    const nextText = Date.now() < copiedUntil ? "Copyed!" : newCoords;
    if (coordinatesDisplay.value !== nextText) {
      coordinatesDisplay.value = nextText;

      // Re-measure the field width only when the text length changes —
      // measuring every frame forced a full layout pass on the main thread
      if (nextText.length !== coordTextLen) {
        coordTextLen = nextText.length;
        const tempSpan = document.createElement("span");
        tempSpan.style.visibility = "hidden";
        tempSpan.style.position = "absolute";
        tempSpan.style.whiteSpace = "nowrap";
        tempSpan.style.font = window.getComputedStyle(coordinatesDisplay).font;
        tempSpan.textContent = nextText;
        document.body.appendChild(tempSpan);

        coordinatesDisplay.style.width = `${tempSpan.offsetWidth + 1}px`;
        document.body.removeChild(tempSpan);
      }
    }
  
    // Smooth longitude transition
    let deltaLng = lng - prevLng;
    if (deltaLng > 180) deltaLng -= 360;
    else if (deltaLng < -180) deltaLng += 360;
    prevLng = lng;
  
    // Smooth latitude transition
    let deltaLat = lat - prevLat;
    if (deltaLat > 90) deltaLat -= 180;
    else if (deltaLat < -90) deltaLat += 180;
    prevLat = lat;
  
    // Update target rotations (removed 0.5 factor)
    targetRotationY -= (deltaLng * Math.PI) / 180; // Full rotation mapping
    targetRotationX += (deltaLat * Math.PI) / 180;
  
    // Glide toward the map, then snap the last fraction of a pixel.
    // Leaving the lerp running would creep forever and never count as still.
    const dy = targetRotationY - stars.rotation.y;
    const dx = targetRotationX - stars.rotation.x;
    let spinning = false;
    if (Math.abs(dy) < ROT_EPS && Math.abs(dx) < ROT_EPS) {
      if (dy !== 0 || dx !== 0) {
        stars.rotation.y = targetRotationY;
        stars.rotation.x = targetRotationX;
        spinning = true;
      }
    } else {
      stars.rotation.y += dy * lerpFactor;
      stars.rotation.x += dx * lerpFactor;
      spinning = true;
    }

    updateMoon();
    const moonNow = moonBucket();
    if (viewMoved(center.lat, center.lng, map.getZoom(), map.getBearing(), map.getPitch())
      || spinning
      || moonNow !== heldMoon
      || resizeDirty) {
      starsDirty = true;
    }
    // Settled sky: keyboard and the readout already ran. Leave the last frame up.
    if (!starsDirty) return;
    if (!resizeDirty && now - lastRenderTime < 16) return;

    updateGlobeRadius();
    cullStarsToSpace();
    renderer.render(scene, camera);
    lastRenderTime = now || performance.now();
    heldLat = center.lat;
    heldLng = center.lng;
    heldZoom = map.getZoom();
    heldBearing = map.getBearing();
    heldPitch = map.getPitch();
    heldMoon = moonNow;
    starsDirty = false;
    resizeDirty = false;
  }
  
  // Initialize with starting longitude and latitude
  function initializeRotation(initialLng, initialLat) {
    prevLng = initialLng;
    prevLat = initialLat;
  }
  
  // Example: Call this when your map or scene is initialized
  initializeRotation(map.getCenter().lng, map.getCenter().lat);
  
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    map.resize();
    resizeDirty = true;
  });
  
  animate();