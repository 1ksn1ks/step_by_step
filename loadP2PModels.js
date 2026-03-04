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
    const drift = () => -1 + Math.random() * 2;
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

}, 100);
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



// Add this outside load3dModels, or inside the customLayer object
const modelInstances = []; // array of { threeObject, peer_id, index } or Map

export async function load3dModels() {
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

          // Initial scale + centering logic (same as before)
          const box = new THREE.Box3().setFromObject(threeModel);
          const modelSize = new THREE.Vector3();
          box.getSize(modelSize);

          const boundingBoxSize = new THREE.Vector3(50000, 50000, 50000);
          const scaleFactor = Math.min(
            boundingBoxSize.x / modelSize.x,
            boundingBoxSize.y / modelSize.y,
            boundingBoxSize.z / modelSize.z
          );

          const finalScale = scaleFactor * modelData.scaleFactorNFT;
          threeModel.scale.set(finalScale, finalScale, finalScale);

          // Center vertically (bottom-aligned or centered – your choice)
          const modelHeight = modelSize.y * scaleFactor;
          const yOffset = (boundingBoxSize.y - modelHeight) / 2;
          threeModel.position.set(0, -yOffset, 0);   // local offset

          P2Pscene.add(threeModel);

          // Store reference
          modelInstances.push({
            threeObject: threeModel,
            peer_id: modelData.peer_id,
            index: index,   // or just use peer_id if unique
            finalScale:finalScale
          });

          // Optional: trigger repaint once loaded
          this.map.triggerRepaint();
        });
      });
    },

    render(gl, args) {
      // Critical part: update ALL models' world matrices every frame
      modelInstances.forEach(({ threeObject, index, finalScale }) => {
        const data = models[index];  // always read latest data
        if (!data) return;

        // Get current matrix from map for this lon/lat/alt
        const modelMatrixArray = this.map.transform.getMatrixForModel(
          data.origin,     // [lon, lat]
          data.altitude
        );

        // Convert to THREE.Matrix4
        const transformMatrix = new THREE.Matrix4().fromArray(modelMatrixArray);

        // Optional extra scale/rotation if needed (you had ×5 before)
        transformMatrix.scale(new THREE.Vector3(finalScale, finalScale, finalScale));

        threeObject.matrix.copy(transformMatrix);
        threeObject.matrixAutoUpdate = false;
      });

      const mapProjectionMatrix = new THREE.Matrix4().fromArray(
        args.defaultProjectionData.mainMatrix
      );
      P2Pcamera.projectionMatrix = mapProjectionMatrix;
      P2Pcamera.matrixWorldInverse.identity(); // usually needed for custom layers

      this.renderer.resetState();
      this.renderer.render(P2Pscene, P2Pcamera);

      this.map.triggerRepaint();
    }
  };

  return customLayer;
}