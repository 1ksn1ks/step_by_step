import { models } from "./letall";
import * as THREE from 'three';
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";


const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('node_modules/three/examples/jsm/libs/draco/');

function generateModels() {
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
        scaleFactorNFT: scaleFactorNFT
    };

    // After initial creation, start live updates
setInterval(() => {
    const randomBotIndex = Math.floor(Math.random() * 100);
    const bot = models[randomBotIndex];

    // Slight movement (e.g., ±0.1° lat/lon, ±1000m altitude)
    const drift = () => -10 + Math.random() * 20;
    const altDrift = () => -1000 + Math.random() * 2000;

    const newX = Math.max(-180, Math.min(180, bot.origin[0] + drift()));
    const newY = Math.max(-90, Math.min(90, bot.origin[1] + drift()));
    const newZ = Math.max(0, Math.min(3500000, bot.altitude + altDrift()));

    // Overwrite same peer with new position
    models[randomBotIndex] = {
        ...bot,
        origin: [newX, newY],
        altitude: newZ,
        scaleFactorNFT: bot.scaleFactorNFT
    };

}, 1000);
}
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
            prevMatrix: new THREE.Matrix4(),
            targetMatrix: new THREE.Matrix4(),
            animStartTime: 0,
            animDurationMs: 500,
            isAnimating: false,
            lastKnownOrigin: null,
            lastKnownAltitude: null,
            opacity: 0,           // ← new
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

      modelInstances.forEach((instance) => {
        const { 
          threeObject, 
          index, 
          finalScale,
          prevMatrix,
          targetMatrix,
          animStartTime,
          animDurationMs,
          isAnimating,
          lastKnownOrigin,
          lastKnownAltitude
        } = instance;

        const data = models[index];
        if (!data) return;

        // Get the newest map matrix
        const modelMatrixArray = this.map.transform.getMatrixForModel(
          data.origin,
          data.altitude
        );

        const newMatrix = new THREE.Matrix4().fromArray(modelMatrixArray);
        newMatrix.scale(new THREE.Vector3(finalScale, finalScale, finalScale));

        // ─── Detect change ───────────────────────────────────────
        const originChanged =
          !lastKnownOrigin ||
          data.origin[0] !== lastKnownOrigin[0] ||
          data.origin[1] !== lastKnownOrigin[1];

        const altitudeChanged =
          lastKnownAltitude !== null && data.altitude !== lastKnownAltitude;

        const positionChanged = originChanged || altitudeChanged;

        if (positionChanged) {
          // Start new animation
          prevMatrix.copy(targetMatrix);           // old target → previous
          targetMatrix.copy(newMatrix);            // new target

          instance.animStartTime = now;
          instance.isAnimating = true;
        }

        // ─── Always update last known values ──────────────────────
        instance.lastKnownOrigin = [...data.origin];
        instance.lastKnownAltitude = data.altitude;

        // ─── Compute current matrix ─────────────────────────────
        let matrixToApply;

      // Inside your loop, instead of .lerpMatrices(...)

      if (instance.isAnimating) {
        const elapsed = now - instance.animStartTime;
        let t = elapsed / instance.animDurationMs;
        t = Math.min(1, Math.max(0, t));

        // Optional nice ease-in-out
        t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        // ─── Decompose both matrices ────────────────────────────────
        const posA = new THREE.Vector3();
        const quatA = new THREE.Quaternion();
        const scaleA = new THREE.Vector3();

        const posB = new THREE.Vector3();
        const quatB = new THREE.Quaternion();
        const scaleB = new THREE.Vector3();

        prevMatrix.decompose(posA, quatA, scaleA);
        targetMatrix.decompose(posB, quatB, scaleB);

        // ─── Interpolate components ─────────────────────────────────
        const pos = new THREE.Vector3().lerpVectors(posA, posB, t);
        const quat = new THREE.Quaternion().slerpQuaternions(quatA, quatB, t);
        const scale = new THREE.Vector3().lerpVectors(scaleA, scaleB, t);

        // ─── Recompose into final matrix ────────────────────────────
        matrixToApply = new THREE.Matrix4().compose(pos, quat, scale);

        if (t >= 0.999) {
          instance.isAnimating = false;
        }
      } else {
        matrixToApply = targetMatrix;
      }

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