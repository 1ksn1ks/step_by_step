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

}, 3000); // every 60 seconds
}
}
generateModels();



const renderedModels = [];  // will contain { model: THREE.Object3D, peer_id, ... }

let lastTime = performance.now();


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
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
  directionalLight.position.set(...dir).normalize();
  P2Pscene.add(directionalLight);
});


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


    models.forEach(({ url, origin, altitude, scaleFactorNFT }) => {
      loader.load(url, (gltf) => {
        const model = gltf.scene;
        P2Pscene.add(model);

        // Calculate the model's bounding box
        const box = new THREE.Box3().setFromObject(model);
        const modelSize = new THREE.Vector3();
        box.getSize(modelSize);

        // Define the desired bounding box dimensions
        const boundingBoxSize = new THREE.Vector3(10000, 10000, 10000); // Width, Height, Depth

        // Calculate the scale factor to fit the model within the bounding box
        const scaleFactor = Math.min(
          boundingBoxSize.x / modelSize.x,
          boundingBoxSize.y / modelSize.y,
          boundingBoxSize.z / modelSize.z
        );

        // Apply the scale to the model
        model.scale.set(scaleFactor*scaleFactorNFT, scaleFactor*scaleFactorNFT, scaleFactor*scaleFactorNFT);

          // Calculate the transformation matrix for each model's location and altitude
          const modelMatrix = this.map.transform.getMatrixForModel(origin, altitude);

          // Apply the transformation matrix to the model
          const modelTransformMatrix = new THREE.Matrix4()
            .fromArray(modelMatrix)
            .scale(new THREE.Vector3(5, 5, 5)); // Example scaling

          // Adjust the model's position to the bottom of the bounding box
          const modelHeight = modelSize.y * scaleFactor;
          const boundingBoxHeight = boundingBoxSize.y;
          const yOffset = (boundingBoxHeight - modelHeight) / 2;
          model.position.set(0, -yOffset, 0);

          model.applyMatrix4(modelTransformMatrix);
      });
    });
  },
  render(gl, args) {
    const mapProjectionMatrix = new THREE.Matrix4().fromArray(
      args.defaultProjectionData.mainMatrix
    );

    P2Pcamera.projectionMatrix = mapProjectionMatrix;

    this.renderer.resetState();
    this.renderer.render(P2Pscene, P2Pcamera);
    this.map.triggerRepaint();

  },
}
return customLayer;
};

load3dModels()