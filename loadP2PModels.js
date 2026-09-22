import { models } from "./letall";
import * as THREE from 'three';
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";


const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('node_modules/three/examples/jsm/libs/draco/');

export function generateModels() {
    // Generate 100 unique bot peers
for (let i = 0; i < 100; i++) {
    const modelIndex = i; // or use a unique key if not sequential
    const peer_id = `bot_${i}`; // Unique ID: bot_0, bot_1, ..., bot_99

    const coordinates = {
        x: -180 + Math.random() * 360,     // longitude:  -180 to +180
        y: -90 + Math.random() * 180,    // latitude: -90 to +90
        z:  50000 + Math.random() * 7000000       // altitude:  0 to 10,000,000 meters
    };

    // Random scale factor for NFT (e.g., 0.5x to 3x)
    const scaleFactorNFT = 1 + Math.random() * 1.5;

const urls = [
    'https://kiloscribe.com/api/inscription-cdn/0.0.9742046',
    'https://kiloscribe.com/api/inscription-cdn/0.0.8412117',
    'https://kiloscribe.com/api/inscription-cdn/0.0.8392276'
];

    // Overwrite any existing entry at this modelIndex (or create new)
    models[modelIndex] = {
        peer_id: peer_id,
        url: urls[Math.floor(Math.random() * urls.length)],
        origin: [coordinates.x, coordinates.y],
        altitude: coordinates.z,
        scaleFactorNFT: scaleFactorNFT,
        heading: Math.random() * Math.PI * 2,
        latDir: Math.random() < 0.5 ? -1 : 1,
        speed: 1.5 + Math.random() * 2,
        speedTarget: 0
    };

}

// One shared ticker: every bot drifts gently all the time — each with its
// own slowly-wandering heading, so the field never stops and never jumps
setInterval(() => {
    models.forEach((bot) => {
        if (!bot || !String(bot.peer_id || "").startsWith("bot_")) return;
        bot.heading += (Math.random() - 0.5) * 0.5;
        // Real-life feel: users pan in bursts and pause — each bot gets a new
        // target speed ~every 50s (0.5–3.5°/s) and eases toward it
        if (Math.random() < 0.02 || !bot.speedTarget) bot.speedTarget = 0.5 + Math.random() * 3;
        bot.speed += (bot.speedTarget - bot.speed) * 0.05;
        // Latitude has its own direction, flipped at the caps — and hard-clamped,
        // because a value outside -90..90 makes MapLibre throw and kills the render
        if (bot.origin[1] > 85) bot.latDir = -1;
        else if (bot.origin[1] < -85) bot.latDir = 1;
        const lat = Math.max(-89, Math.min(89, bot.origin[1] + bot.latDir * bot.speed * 0.5));
        let lng = bot.origin[0] + Math.cos(bot.heading) * bot.speed;
        if (lng > 180) lng -= 360;
        if (lng < -180) lng += 360;
        bot.origin[0] = lng;
        bot.origin[1] = lat;
    });
}, 1000);
}

generateModels();


let P2Pcamera = new THREE.Camera();
let P2Pscene = new THREE.Scene();

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
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
  directionalLight.position.set(...dir).normalize();
  P2Pscene.add(directionalLight);
});


// ────────────────────────────────────────────────
// Global / module-level (outside the function)
// ────────────────────────────────────────────────
const modelInstances = []; // will hold { threeObject, peer_id, index, finalScale, animState }

// Scratch objects for the fluid smoothing (no per-frame allocation)
const _posA = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _scaleA = new THREE.Vector3();
const _posB = new THREE.Vector3();
const _quatB = new THREE.Quaternion();
const _scaleB = new THREE.Vector3();
let lastDriftTime = 0;

export async function load3dModels() {
  // If not already created — do it once
  if (!P2Pscene) {
    P2Pscene = new THREE.Scene();
    P2Pcamera = new THREE.Camera(); // dummy — we'll override matrices anyway
  }

  const customLayer = {
    id: "3d-model",
    type: "custom",
    renderingMode: "3d",

    onAdd(map, gl) {
      this.map = map;

      this.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      this.renderer.autoClear = false;

      const loader = new GLTFLoader();
      loader.setDRACOLoader(dracoLoader);

      models.forEach((modelData, index) => {
        loader.load(modelData.url, (gltf) => {
          const threeModel = gltf.scene;

          // Compute scale + centering (same as before)
          const box = new THREE.Box3().setFromObject(threeModel);
          const modelSize = new THREE.Vector3();
          box.getSize(modelSize);

          const boundingBoxSize = new THREE.Vector3(50000, 50000, 50000);
          const scaleFactor = Math.min(
            boundingBoxSize.x / modelSize.x,
            boundingBoxSize.y / modelSize.y,
            boundingBoxSize.z / modelSize.z
          );

          const finalScale = scaleFactor * (modelData.scaleFactorNFT || 1);

          threeModel.scale.set(finalScale, finalScale, finalScale);

          // Center vertically (bottom or center — adjust yOffset as needed)
          const modelHeight = modelSize.y * finalScale;
          const yOffset = modelHeight / 2; // ← changed to center; use 0 for bottom-aligned
          threeModel.position.set(0, -yOffset, 0);

          P2Pscene.add(threeModel);

          // Store instance with animation state
          modelInstances.push({
            threeObject: threeModel,
            peer_id: modelData.peer_id,
            index,
            finalScale,
            currentMatrix: new THREE.Matrix4(),
            initialized: false,
            movedWhileHidden: false,
            lastKnownOrigin: null,
            lastKnownAltitude: null,
            opacity: 1,           // ← TEST: no fade, instant appear (was 0)
            opacityTarget: 1,     // ← new
            fadeStartTime: 0,
            fadeDurationMs: 600   // a bit longer than position anim looks nice
          });

          // Optional first repaint
          map.triggerRepaint();
        });
      });
    },

    render(gl, args) {
      const now = performance.now();
      // Frame delta for the smoothing (clamped: a tab switch must not fast-forward)
      const dt = lastDriftTime ? Math.min(100, now - lastDriftTime) : 16;
      lastDriftTime = now;

      // Only bots on the visible hemisphere are processed; the rest sit
      // behind the globe and are skipped entirely
      const cLat = (this.map.getCenter().lat * Math.PI) / 180;
      const cLng = (this.map.getCenter().lng * Math.PI) / 180;
      const centerVec = [
        Math.cos(cLat) * Math.cos(cLng),
        Math.cos(cLat) * Math.sin(cLng),
        Math.sin(cLat)
      ];

      modelInstances.forEach((instance) => {
        const {
          threeObject,
          index,
          finalScale,
          lastKnownOrigin,
          lastKnownAltitude
        } = instance;

        const data = models[index];
        if (!data) return;

        // Far side of the globe: never visible — skip all processing
        const bLat = (data.origin[1] * Math.PI) / 180;
        const bLng = (data.origin[0] * Math.PI) / 180;
        const dot =
          centerVec[0] * Math.cos(bLat) * Math.cos(bLng) +
          centerVec[1] * Math.cos(bLat) * Math.sin(bLng) +
          centerVec[2] * Math.sin(bLat);
        if (dot < -0.05) {
          // It drifted out of sight — it will snap in place when it reappears
          instance.lastKnownOrigin = [...data.origin];
          instance.lastKnownAltitude = data.altitude;
          instance.movedWhileHidden = true;
          if (threeObject.visible) threeObject.visible = false;
          return;
        }
        if (!threeObject.visible) threeObject.visible = true;

        // Get the newest map matrix
        const modelMatrixArray = this.map.transform.getMatrixForModel(
          data.origin,
          data.altitude
        );

        const newMatrix = new THREE.Matrix4().fromArray(modelMatrixArray);
        newMatrix.scale(new THREE.Vector3(finalScale, finalScale, finalScale));

        // First appearance, or it drifted out of sight — snap in place
        if (!instance.initialized || instance.movedWhileHidden) {
          instance.currentMatrix.copy(newMatrix);
          instance.initialized = true;
          instance.movedWhileHidden = false;
        }

        // ─── Always update last known values ──────────────────────
        instance.lastKnownOrigin = [...data.origin];
        instance.lastKnownAltitude = data.altitude;

        // ─── Compute current matrix: fluid exponential smoothing ───
        // Always ease toward the latest target (time constant ~1.5s) —
        // direction changes mid-flight just bend the path, never snap
        const t = 1 - Math.exp(-dt / 1500);
        instance.currentMatrix.decompose(_posA, _quatA, _scaleA);
        newMatrix.decompose(_posB, _quatB, _scaleB);
        _posA.lerp(_posB, t);
        _quatA.slerp(_quatB, t);
        _scaleA.lerp(_scaleB, t);
        instance.currentMatrix.compose(_posA, _quatA, _scaleA);

        const matrixToApply = instance.currentMatrix;

      // After computing matrixToApply ...

      // Handle fade-in (only on first appearance)
      if (instance.opacity < 0.999) {
        if (instance.fadeStartTime === 0) {
          // Start fade only once we have first valid position
          if (!instance.isAnimating && lastKnownOrigin) {  // or some other "settled" condition
            instance.fadeStartTime = now;
          }
        }

        if (instance.fadeStartTime > 0) {
          const elapsedFade = now - instance.fadeStartTime;
          let tFade = elapsedFade / instance.fadeDurationMs;
          tFade = Math.min(1, tFade);
          // same ease as position if you want
          tFade = tFade < 0.5 ? 2 * tFade * tFade : 1 - Math.pow(-2 * tFade + 2, 2) / 2;

          instance.opacity = THREE.MathUtils.lerp(0, instance.opacityTarget, tFade);
        }
      }

      // Apply opacity to all materials (do once on load or here)
      threeObject.traverse((child) => {
        if (child.isMesh && child.material) {
          if (!child.material.transparent) {
            child.material.transparent = true;
            child.material.needsUpdate = true;
          }
          child.material.opacity = instance.opacity;
        }
      });

      // ─── Only apply matrix if we're at least partially visible ───
      if (instance.opacity > 0.01) {
        threeObject.matrix.copy(matrixToApply);
        threeObject.matrixAutoUpdate = false;
      }

        // ─── Apply to object ────────────────────────────────────
        threeObject.matrix.copy(matrixToApply);
        threeObject.matrixAutoUpdate = false;
      });

      // Camera / projection setup (unchanged)
      const mapProjectionMatrix = new THREE.Matrix4().fromArray(
        args.defaultProjectionData.mainMatrix
      );
      P2Pcamera.projectionMatrix = mapProjectionMatrix;
      P2Pcamera.matrixWorldInverse.identity();

      this.renderer.resetState();
      this.renderer.render(P2Pscene, P2Pcamera);

      this.map.triggerRepaint();
    }
  };

  return customLayer;
}