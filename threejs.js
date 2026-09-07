import * as THREE from 'three';
import { handleMovement } from './joystick.js';
import { map } from './map.js';

export const scene = new THREE.Scene();

export const renderer = new THREE.WebGLRenderer({ alpha: true });
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
const lerpFactor = 0.05; // Controls smoothness


function animate() {
    requestAnimationFrame(animate);
    handleMovement();
  
    const center = map.getCenter();
    const lat = center.lat.toFixed(5);
    const lng = center.lng.toFixed(5);
  
    // Update coordinates display only if changed
    const coordinatesDisplay = document.getElementById("coordinates-display");
    const newCoords = `lng: ${lng}, lat: ${lat}`;
    if (coordinatesDisplay.value !== newCoords) {
      coordinatesDisplay.value = newCoords;
  
      const tempSpan = document.createElement("span");
      tempSpan.style.visibility = "hidden";
      tempSpan.style.position = "absolute";
      tempSpan.style.whiteSpace = "nowrap";
      tempSpan.style.font = window.getComputedStyle(coordinatesDisplay).font;
      tempSpan.textContent = newCoords;
      document.body.appendChild(tempSpan);
  
      coordinatesDisplay.style.width = `${tempSpan.offsetWidth}px`;
      document.body.removeChild(tempSpan);
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
  
    // Apply lerp for smooth rotation
    stars.rotation.y += (targetRotationY - stars.rotation.y) * lerpFactor;
    stars.rotation.x += (targetRotationX - stars.rotation.x) * lerpFactor;
  
    renderer.render(scene, camera);
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
  });
  
  animate();