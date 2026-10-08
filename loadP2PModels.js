import { models, shadeMode } from "./letall";
import * as THREE from 'three';
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ────────────────────────────────────────────────
// 10,000-bot instanced rendering
//
// Every bot that shares a model URL draws through ONE InstancedMesh per
// model part (3 bot models × ~4 parts ≈ 13 draw calls for 10k bots), with
// per-bot matrices written straight into the instanceMatrix buffers.
//
// MapLibre's globe world frame (GlobeTransform.getMatrixForModel) is a FIXED
// unit sphere: the globe has radius 1 at the origin and meters map to world
// units via 1/earthRadius. The frame never moves — panning the camera only
// changes the projection (mainMatrix) — and the drift itself runs in the
// vertex shader (each bot orbits its static home point, uTime-driven), so
// bot matrices only need rewriting when the CAMERA moves, never for the
// bots themselves. Mass scale: 10k+ bots idle cost zero per-frame CPU.
// Per bot:  pos = (1 + alt/R) · (cosφ·sinλ, sinφ, cosφ·cosλ)
//           orient: model +Y -> radial (up),  +X -> east
//
// The camera, however, does move: its offset from the surface shrinks as
// 1/2^zoom (cameraToCenterDistance is a fixed screen distance, the world
// scale e grows with zoom). Past zoom ~12 it is only ~16km above the ground
// on a phone — so size clamping uses the exact pinhole px/m at each bot's
// depth, and bots that pass behind the camera are skipped.
// ────────────────────────────────────────────────

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('node_modules/three/examples/jsm/libs/draco/');

const RAD = Math.PI / 180;
const EARTH_R = 6371008.8; // MapLibre's globe radius (meters)

// Where the sun is directly overhead (low-precision solar formula, same as
// globemode.js), returned as a unit vector in the fixed globe frame, using the
// same (lat,lng) -> (cosφ·sinλ, sinφ, cosφ·cosλ) mapping as the bot positions.
function sunDirectionVec(date) {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const n = (date.getTime() - yearStart) / 86400000; // fractional day of year
  const decl = 23.44 * Math.sin(RAD * (360 / 365) * (284 + n));
  const b = RAD * (360 / 365) * (n - 81);
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lon = ((12 - utcH) * 15 + eot / 4 + 540) % 360 - 180;
  const cl = Math.cos(decl * RAD);
  return {
    x: cl * Math.sin(lon * RAD),
    y: Math.sin(decl * RAD),
    z: cl * Math.cos(lon * RAD)
  };
}

// The daynight fragment shader's math, in JS: the shade strength at a
// (lat,lng) — 0 = full day, 1 = full night. The flat view can't use the 3D
// shade sphere, so it tints the whole screen with the value the globe shows
// at that spot (same (lat,lng)->normal mapping, same 15° fade, same
// smoothstep — the tint matches the globe pixel-for-pixel).
export function shadeStrengthAt(lat, lon, date = new Date()) {
  const phi = lat * RAD;
  const lam = lon * RAD;
  const nx = Math.cos(phi) * Math.sin(lam);
  const ny = Math.sin(phi);
  const nz = Math.cos(phi) * Math.cos(lam);
  const sun = sunDirectionVec(date);
  const cosAng = Math.min(1, Math.max(-1, nx * sun.x + ny * sun.y + nz * sun.z));
  const el = Math.asin(cosAng); // sun elevation (radians), 0 at the terminator
  const t = Math.min(1, Math.max(0, (15 * RAD - el) / (30 * RAD)));
  return t * t * (3 - 2 * t); // smoothstep — identical to the shader
}

// Major cities [lng, lat, population weight] — real users live in cities
const CITIES = [
    [139.69, 35.68, 37],   // Tokyo
    [77.2, 28.61, 32],     // Delhi
    [121.47, 31.23, 29],   // Shanghai
    [-74.0, 40.71, 22],    // New York
    [116.4, 39.9, 21],     // Beijing
    [72.87, 19.08, 21],    // Mumbai
    [-99.13, 19.43, 21],   // Mexico City
    [113.26, 23.13, 21],   // Guangzhou
    [28.98, 41.01, 16],    // Istanbul
    [-70.66, -33.45, 15],  // São Paulo
    [-58.38, -34.6, 15],   // Buenos Aires
    [-0.12, 51.51, 15],    // London
    [48.86, 30.04, 15],    // Cairo
    [114.06, 22.32, 15],   // Hong Kong
    [30.52, 50.45, 13],    // Kyiv
    [37.62, 55.75, 13],    // Moscow
    [-118.24, 34.05, 14],  // Los Angeles
    [126.98, 37.57, 10],   // Seoul
    [-87.6, 41.88, 10],    // Chicago
    [106.8, -6.2, 10],     // Jakarta
    [7.48, 3.39, 12],      // Lagos
    [55.29, 25.2, 9],      // Dubai
    [2.35, 48.85, 12],     // Paris
    [103.82, 1.35, 11]     // Singapore
];
const CITY_WEIGHT_TOTAL = CITIES.reduce((sum, c) => sum + c[2], 0);
function pickCity() {
    let r = Math.random() * CITY_WEIGHT_TOTAL;
    for (const c of CITIES) { r -= c[2]; if (r <= 0) return c; }
    return CITIES[0];
}

const BOT_SKY_COUNT = 300;    // atmosphere: high-altitude layer (visible from space)
const BOTS_PER_CITY = 50;     // per city, on the ground
const BOT_TOTAL = BOT_SKY_COUNT + CITIES.length * BOTS_PER_CITY; // 300 + 24*50 = 1500
const BOT_URLS = [
    'https://kiloscribe.com/api/inscription-cdn/0.0.9742046',
    'https://kiloscribe.com/api/inscription-cdn/0.0.8412117',
    'https://kiloscribe.com/api/inscription-cdn/0.0.8392276'
];

let modelsVersion = 0; // bumped whenever the bot list is (re)generated

export function generateModels() {
    // 1,500 bot peers: a light atmosphere layer + a fixed crowd per city
    let i = 0;
    const addBot = (coords, isCityBot) => {
        // The drift lives in the VERTEX SHADER (patchOrbitDrift): each bot
        // orbits its home point on a slow circle, so origin/altitude stay
        // static and the CPU rewrites matrices only on camera moves.
        // City bots circle 0.2–1.5km around home (inside the 2km cull floor,
        // so they never pop at the view edge); sky bots take wide slow
        // 50–300km circles (lively from space) with a bigger altitude bob.
        models[i] = {
            peer_id: `bot_${i}`, // Unique ID: bot_0, bot_1, ...
            url: BOT_URLS[Math.floor(Math.random() * BOT_URLS.length)],
            origin: [coords.x, coords.y],
            altitude: coords.z,
            scaleFactorNFT: 1 + Math.random() * 1.5, // random NFT scale (0.5x–3x)
            city: isCityBot,
            oRad: isCityBot ? 200 + Math.random() * 1300 : 50000 + Math.random() * 250000,
            oSpd: (2 * Math.PI) / (isCityBot ? 90 + Math.random() * 310 : 40 + Math.random() * 260),
            oPhs: Math.random() * Math.PI * 2,
            oBob: isCityBot ? 20 + Math.random() * 40 : 1000 + Math.random() * 4000
        };
        i++;
    };

    // Atmosphere: BOT_SKY_COUNT high-altitude bots scattered over the whole globe
    for (let s = 0; s < BOT_SKY_COUNT; s++) {
        addBot({
            x: -180 + Math.random() * 360,      // longitude:  -180 to +180
            y: -89 + Math.random() * 178,       // latitude: -89 to +89
            z: 50000 + Math.random() * 3450000  // altitude: 50km–3,500km
        }, false);
    }

    // Cities: exactly BOTS_PER_CITY on the ground around each city center
    for (const city of CITIES) {
        for (let c = 0; c < BOTS_PER_CITY; c++) {
            // Scatter within ~9km of the city center
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.sqrt(Math.random()) * 0.08; // ~0–0.08° ≈ 0–9km
            let x = city[0] + Math.cos(angle) * dist;
            if (x > 180) x -= 360;
            if (x < -180) x += 360;
            const y = Math.max(-89, Math.min(89, city[1] + Math.sin(angle) * dist));
            // City bots on the ground: 100m–1000m
            addBot({ x, y, z: 100 + Math.random() * 900 }, true);
        }
    }
    modelsVersion++;
}

generateModels();

// ── GPU-side drift (mass scale: zero per-frame CPU at any bot count) ─────
// Each bot orbits its static home point, evaluated in the VERTEX SHADER from
// uTime — no per-frame CPU integration, no buffer re-uploads while the
// camera is still (the map repaints for the shader; the matrices sit
// untouched). The instance matrix carries the home pose, so the shader reads
// the bot's local frame straight off it (col0 = east·k, col1 = up·k) and
// displaces the translation along east/north/up:
//   east·(r·cos t) + north·(r·sin t) + up·(bob·sin t')      [meters]
// 1 meter = 1/EARTH_R world units in BOTH frames (unit-sphere and mercator
// alike — that's why the same patch works globe and flat). aOrbit (per
// slot) packs [radius m, angularSpeed rad/s, phase, bobAmp m] and is
// rewritten alongside the matrices, only when slots change.
const uTime = { value: 0 }; // shader drift clock — render() sets it each frame

const SKY_ORBIT_MAX = 300000; // m — largest sky orbit; sky culling adds it to rCull

const patchOrbitDrift = (mat) => {
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uTime;
        // three r182 calls onBeforeCompile with the UNRESOLVED template
        // (the #include directives are still in it), so the displacement
        // replaces the project_vertex INCLUDE with the chunk's own code plus
        // the orbit drift (kept inside #ifdef USE_INSTANCING so non-instanced
        // compiles drop it). Declarations at global scope (in-body `in` is
        // illegal GLSL).
        shader.vertexShader =
            'attribute vec4 aOrbit;\n' +
            'uniform float uTime;\n' +
            shader.vertexShader.replace(
                '#include <project_vertex>',
                `vec4 mvPosition = vec4( transformed, 1.0 );
                #ifdef USE_BATCHING
                mvPosition = batchingMatrix * mvPosition;
                #endif
                #ifdef USE_INSTANCING
                mat4 iM = instanceMatrix;
                {
                    vec3 iUp = normalize(iM[1].xyz);
                    vec3 iEast = normalize(iM[0].xyz);
                    float tO = uTime * aOrbit.y + aOrbit.z;
                    iM[3].xyz += (iEast * cos(tO) + cross(iUp, iEast) * sin(tO)) * aOrbit.x / 6371008.8;
                    iM[3].xyz += iUp * aOrbit.w * sin(uTime * aOrbit.y * 0.7 + aOrbit.z) / 6371008.8;
                }
                mvPosition = iM * mvPosition;
                #endif
                mvPosition = modelViewMatrix * mvPosition;
                gl_Position = projectionMatrix * mvPosition;`
            );
    };
};


let P2Pcamera = new THREE.Camera();

// ────────────────────────────────────────────────
// Shared across layer instances (survives visibility toggles)
//
// The visibility toggle removes and re-adds the custom layer. GLTF data is
// decoded/optimized ONCE per URL here, and each live layer instance builds
// its own InstancedMeshes + scene + renderer on top of it (all disposed in
// onRemove). Without this split, re-enabling stacked another full set of
// instanced meshes — still carrying the old baked-in matrices — into one
// shared scene, which rendered as gigantic ghost models.
// ────────────────────────────────────────────────
let MAX_ANISO = 1;

const sharedLoader = new GLTFLoader();
sharedLoader.setDRACOLoader(dracoLoader);

const gltfCache = {};
const optimizedTex = new WeakMap();
const groupDataCache = new Map(); // url -> { url, loaded, scaleCity, scaleSky, parts: [{geo, mat}] }

// Texture diet: NFT models often ship 2K–4K maps, but bots are drawn at
// <=40px on screen. Downsample every texture to 512px once per unique model
// (4K RGBA = 64MB GPU memory -> ~1MB) and raise anisotropy so grazing-angle
// views don't wash out.
const MAX_TEX_SIZE = 512;

const downscale = (tex) => {
    if (optimizedTex.has(tex)) return optimizedTex.get(tex);
    const img = tex.image;
    const w = img && img.width;
    const h = img && img.height;
    let out = tex;
    if (w && h && Math.max(w, h) > MAX_TEX_SIZE) {
      const scale = MAX_TEX_SIZE / Math.max(w, h);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      out = new THREE.CanvasTexture(canvas);
      out.colorSpace = tex.colorSpace;
      out.wrapS = tex.wrapS;
      out.wrapT = tex.wrapT;
    }
    out.anisotropy = MAX_ANISO;
    optimizedTex.set(tex, out);
    return out;
  };

const optimizeModel = (gltf) => {
    gltf.scene.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (!m) return;
        ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"].forEach(
          (slot) => { if (m[slot]) m[slot] = downscale(m[slot]); }
        );
      });
    });
  };

const loadGltf = (url) => {
    if (!gltfCache[url]) {
      gltfCache[url] = new Promise((resolve, reject) =>
        sharedLoader.load(
          url,
          (gltf) => { optimizeModel(gltf); resolve(gltf); },
          undefined,
          reject
        )
      );
    }
    return gltfCache[url];
  };

// Heavy models (the 15k-triangle ghost) would blow the GPU budget at 10k
// instances, so any model above the triangle cap gets quantized down at
// load: vertices snap to a 3D grid, coincident ones merge, and the
// degenerate triangles that collapse are dropped. O(n), works for any mesh.
const MAX_MODEL_TRIS = 2000;
const decimate = (geo) => {
    const pos = geo.attributes.position;
    if (!pos) return geo;
    const bb = new THREE.Box3().setFromBufferAttribute(pos);
    const size = new THREE.Vector3();
    bb.getSize(size);
    const grid = 16;
    const keyOf = (i) => {
      const qx = Math.min(grid - 1, Math.max(0, Math.round((pos.getX(i) - bb.min.x) / (size.x || 1) * (grid - 1))));
      const qy = Math.min(grid - 1, Math.max(0, Math.round((pos.getY(i) - bb.min.y) / (size.y || 1) * (grid - 1))));
      const qz = Math.min(grid - 1, Math.max(0, Math.round((pos.getZ(i) - bb.min.z) / (size.z || 1) * (grid - 1))));
      return (qx * grid + qy) * grid + qz;
    };
    const seen = new Map();
    const outPos = [];
    const remap = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const key = keyOf(i);
      let j = seen.get(key);
      if (j === undefined) {
        j = outPos.length / 3;
        seen.set(key, j);
        outPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
      remap[i] = j;
    }
    const src = geo.index ? geo.index.array : null;
    const n = src ? src.length : pos.count;
    const outIdx = [];
    for (let t = 0; t < n; t += 3) {
      const a = remap[src ? src[t] : t];
      const b = remap[src ? src[t + 1] : t + 1];
      const c = remap[src ? src[t + 2] : t + 2];
      if (a !== b && b !== c && a !== c) outIdx.push(a, b, c);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
    out.setIndex(outIdx);
    out.computeVertexNormals();
    return out;
  };

// Bake every GLTF node transform into the part geometry (model-root space)
// so one InstancedMesh per part can carry every bot of that model.
const buildGroupData = (url) => {
    let g = groupDataCache.get(url);
    if (g) return g.promise;
    g = { url, loaded: false, scaleCity: 1, scaleSky: 1, parts: [] };
    groupDataCache.set(url, g);
    g.promise = loadGltf(url).then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const rootInv = gltf.scene.matrixWorld.clone().invert();
        let totalTris = 0;
        const modelBox = new THREE.Box3();
        gltf.scene.traverse((child) => {
            if (!child.isMesh || !child.geometry || !child.geometry.attributes.position) return;
            const local = new THREE.Matrix4().multiplyMatrices(rootInv, child.matrixWorld);
            const geo = child.geometry.clone().applyMatrix4(local);
            const tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
            totalTris += tris;
            // Flat-color (untextured) parts render UNLIT: bot models ship noisy
            // normals, and per-triangle lighting makes them look mottled/speckled.
            // Textured parts keep the lit material.
            const toMat = (m) => {
                const out = (m && m.map)
                    ? m
                    : new THREE.MeshBasicMaterial({
                        color: (m && m.color ? m.color : new THREE.Color(0xffffff)).clone(),
                        side: m && m.side ? m.side : THREE.DoubleSide
                      });
                patchOrbitDrift(out); // GPU drift — idempotent for shared materials
                return out;
            };
            g.parts.push({
                geo,
                mat: Array.isArray(child.material) ? toMat(child.material[0]) : toMat(child.material)
            });
            modelBox.union(new THREE.Box3().setFromBufferAttribute(geo.attributes.position));
        });
        if (totalTris > MAX_MODEL_TRIS) for (const p of g.parts) p.geo = decimate(p.geo);

        const modelSize = new THREE.Vector3();
        modelBox.getSize(modelSize);
        const safe = (v) => (v > 0 ? v : 1);
        // City bots are 100m tall, sky bots 50km — same geometry, per-tier size
        g.scaleCity = Math.min(100 / safe(modelSize.x), 100 / safe(modelSize.y), 100 / safe(modelSize.z));
        g.scaleSky = Math.min(50000 / safe(modelSize.x), 50000 / safe(modelSize.y), 50000 / safe(modelSize.z));
        g.loaded = true;
        return g;
    }).catch(() => g);
    return g.promise;
};

export async function load3dModels() {
  const state = {
    map: null,
    renderer: null,
    scene: new THREE.Scene(),
    groups: new Map(),   // url -> { g, parts: [{geo,mat,imesh,buf}], capacity, slotCount, loaded, fade }
    modelGroup: [],      // models[i] -> instance group entry
    lastCamKey: '',
    cv: null,            // camera-derived values, cached per cvKey
    cvKey: '',
    lastT: 0,            // last render timestamp — drives the load-fade dt
    t0: 0,               // onAdd timestamp — origin of the shader drift clock
    lastLen: -1,
    lastVersion: -1,
    dirty: true,
  };

  // One key light + soft ambient — for textured (lit) real-peer models. The flat
  // bot parts render unlit, so the light can never wash them out.
  const keyLight = new THREE.DirectionalLight(0xffffff, 2);
  keyLight.position.set(1, 1.5, 1).normalize();
  state.scene.add(keyLight);
  state.scene.add(new THREE.AmbientLight(0xffffff, 1.2));

  // One InstancedMesh per part for this layer instance, on top of the shared
  // group data. GPU instance buffers are per-instance and disposed in onRemove.
  const attachParts = (inst) => {
    const g = inst.g;
    // Capacity: every model entry currently sharing this URL + headroom for
    // real peers (which arrive later and may use this URL too)
    let cap = 16;
    for (let i = 0; i < models.length; i++) if (models[i] && models[i].url === g.url) cap++;
    inst.capacity = cap;
    // Per-slot orbit params for the GPU drift — ONE shared instanced buffer
    // across the group's parts (same slot layout), rewritten alongside the
    // matrices whenever slots change.
    inst.aOrbit = new Float32Array(cap * 4);
    inst.aAttr = new THREE.InstancedBufferAttribute(inst.aOrbit, 4);
    inst.aAttr.setUsage(THREE.DynamicDrawUsage);
    inst.parts = g.parts.map((p) => {
      const geo = p.geo.clone(); // per-instance: carries aOrbit (shared geos stay clean)
      geo.setAttribute('aOrbit', inst.aAttr);
      const im = new THREE.InstancedMesh(geo, p.mat, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; // instances span the whole globe — culling is per-instance
      im.count = 0;
      state.scene.add(im);
      return { geo, mat: p.mat, imesh: im, buf: im.instanceMatrix.array };
    });
    inst.loaded = true;
    state.dirty = true;
  };

  const ensureGroup = (url) => {
    let inst = state.groups.get(url);
    if (inst) return inst;
    inst = { g: null, parts: [], capacity: 0, slotCount: 0, loaded: false, fade: 0 };
    state.groups.set(url, inst);
    buildGroupData(url).then((g) => {
      if (!state.map || !g.loaded) return; // removed while loading, or load failed
      inst.g = g;
      attachParts(inst);
    });
    return inst;
  };

  const rebuildMapping = () => {
    const arr = new Array(models.length);
    for (let i = 0; i < models.length; i++) arr[i] = models[i] ? ensureGroup(models[i].url) : null;
    state.modelGroup = arr;
  };

  // Real peers keep arriving — if a group overflows, double its capacity
  const growGroup = (inst) => {
    const newCap = inst.capacity * 2;
    const oldParts = inst.parts;
    // Grow the orbit buffer the same way (the filled slots carry over)
    const aOrbit = new Float32Array(newCap * 4);
    aOrbit.set(inst.aOrbit);
    inst.aOrbit = aOrbit;
    const aAttr = new THREE.InstancedBufferAttribute(aOrbit, 4);
    aAttr.setUsage(THREE.DynamicDrawUsage);
    aAttr.needsUpdate = true;
    if (inst.aAttr) inst.aAttr.dispose();
    inst.aAttr = aAttr;
    inst.parts = oldParts.map((p) => {
      p.geo.setAttribute('aOrbit', aAttr);
      const im = new THREE.InstancedMesh(p.geo, p.mat, newCap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      im.instanceMatrix.array.set(p.buf);
      state.scene.add(im);
      return { geo: p.geo, mat: p.mat, imesh: im, buf: im.instanceMatrix.array };
    });
    inst.capacity = newCap;
    for (const p of oldParts) { state.scene.remove(p.imesh); p.imesh.dispose(); }
  };

  // ── The heart of the 10k-bot path ──────────────────────────────────
  // One pass over every model writes instance matrices straight into the
  // GPU buffers. World frame (derived from getMatrixForModel's source): the
  // globe is a unit sphere at the origin, so for a bot at (lat,lng,alt):
  //   pos = (1 + alt/R) · (cosφ·sinλ, sinφ, cosφ·cosλ)
  //   orient: model +Y -> radial (up), +X -> east
  // The frame is fixed — panning the camera never touches these matrices,
  // only the projection (mainMatrix) changes.
  // All camera-derived render values in one closure: surface px/m, kappa,
  // view axis, disk center, the on-screen disk radius (rVis) and the cull
  // radius (rCull). updateInstances recomputes this ONLY when the camera
  // actually moves — the 24×unproject perimeter sampling in here is what
  // we don't want paying on idle frames (drift is uTime in the shader).
  const computeCam = (projData) => {
    const map = state.map;
    const zoom = map.getZoom();
    const center = map.getCenter();
    // MapLibre's globe FLATTENS to a flat (mercator) projection around z12
    // (the "globe auto-transitions to mercator at high zoom" in
    // GlobeTransform.isGlobeRendering). In the flat case the custom-layer
    // projection data sets mainMatrix === fallbackMatrix (the same matrix —
    // mercator_transform.getProjectionDataForCustomLayer); in the globe case
    // they differ (globe view-proj vs. mercator). Our unit-sphere bot
    // positions are only valid in the GLOBE frame — in the flat frame they
    // fling off-screen (this is the "bots vanish past z12" bug). We detect the
    // frame and, when flat, place bots with MapLibre's own getMatrixForModel.
    const isFlat = (projData.mainMatrix === projData.fallbackMatrix);

    // Grow smaller as we zoom in — the map scale doubles per level, so the
    // decay must beat 0.5/level or the 40px cap pins the size at every zoom
    // (city 0.2 -> ~5px at max z19, sky 0.4 -> ~4px, 4px floor at world zoom)
    const zoomScaleCity = zoom > 15 ? Math.pow(0.2, zoom - 15) : 1;
    const zoomScaleSky = zoom > 5 ? Math.pow(0.4, zoom - 5) : 1;
    // On-screen clamp: below the floor they vanish, above 40px they eat fill-rate.
    // Flat floor: a constant 4px minimum so models never grow as you zoom in
    // (a zoom-ramping floor made them balloon past z8).
    const floor = 4;

    // Surface px/m at the map center. Measuring at every bot (10k × 2
    // projections) is too slow — but the globe's projection is an exact
    // pinhole, so the surface-center scale plus the pinhole depth ratio per
    // bot below is exact (no approximation error) for any altitude/angle.
    const pxAtLat = (latDeg) => {
      const qA = map.project([center.lng, latDeg]);
      const qB = map.project([center.lng + 0.001, latDeg]);
      // 0.001° of longitude shrinks with cos(lat): dividing by the equatorial
      // distance underestimates px/m by 1/cos(lat) (11.5x at lat 85), which
      // made the 4/40px clamp balloon to ~46/460px on screen near the poles.
      const meters = 0.001 * 111320 * Math.max(Math.cos(latDeg * RAD), 1e-6);
      return Math.hypot(qB.x - qA.x, qB.y - qA.y) / meters;
    };
    const px0 = pxAtLat(center.lat);

    // Camera geometry in the fixed unit-sphere frame (derived from
    // vertical_perspective_transform.ts): the camera sits at
    //   C = c + κ·n'
    // where c = map-center direction, n' = unit vector from the center
    // toward the camera (tilted by pitch), and κ = camera altitude in
    // globe radii (shrinks as 1/2^zoom: ~16km z12, ~2km z15, ~500m z17).
    // |C|² = 1 + κ² + 2κ·cos(pitch)  →  κ = √(|C|²−sin²p) − cos(pitch)
    // (|C| = 1+κ only at pitch 0 — cameraPosition alone is not enough).
    // The view axis is −n', and the exact pinhole depth of a bot at
    // altitude u (globe radii) is
    //   depth = κ + cos(pitch) − (1+u)·(p·n')   (globe radii)
    //   px/m  = px0 · κ / depth                 (exact magnification)
    // depth <= 0 means the bot is behind the camera — the GPU would clip
    // it (this is what used to kill sky bots past zoom ~12 and city bots
    // past ~17, and let capped models render 2–4x too big).
    //
    // Requirement: models stay visible down to max zoom. A bot higher than
    // the camera plane is behind the camera, so bots are pinned a hair
    // below it (u -> 0.9κ) whenever their real altitude would put them
    // behind. The pin is continuous (min) and positionally invisible: near
    // the map center the altitude offset lies along the view axis, and the
    // visible disk at those zooms is only a few hundred meters across.
    const camPos = map.transform && map.transform.cameraPosition;
    const cLat = center.lat * RAD, cLng = center.lng * RAD;
    const cmx = Math.cos(cLat) * Math.sin(cLng);
    const cmy = Math.sin(cLat);
    const cmz = Math.cos(cLat) * Math.cos(cLng);
    const pitchR = (map.getPitch() || 0) * RAD;
    // kappa = camera altitude in globe radii, taken DIRECTLY from the
    // projection's focal length over its globe radius (both public, both
    // smooth in zoom):  kappa = D / e,  D = cameraToCenterDistance
    // (0.5/tan(fov/2)·height, a constant),  e = worldSize/(2π·cos(lat))
    // (globe radius in pixels, grows as 2^zoom). NOT derived from
    // |cameraPosition|: there |C| ≈ 1 and kappa = √(|C|²−sin²p)−cos(p)
    // subtracts two ≈1 float32 numbers, which loses the tiny deep-zoom
    // altitude (~1e-5) and made the readout jump ~500x at z12.
    const Dcam = map.transform && map.transform.cameraToCenterDistance;
    const wSize = map.transform && map.transform.worldSize;
    const ePix = wSize > 0 ? wSize / (2 * Math.PI) / Math.cos(cLat) : 0;
    let kappa = (Dcam > 0 && ePix > 0) ? Dcam / ePix : 1e9;
    // Flat-frame camera height above the ground (meters): Dcam px / px0 px/m.
    // At deep zoom this drops BELOW the bots' real altitude, so a bot placed
    // at its true height sits above the camera and leaves the frustum — the
    // "bots vanish when zooming in" bug. emitBot pins flat altitudes to 0.9x.
    const camAltFlat = (Dcam > 0 && px0 > 0.0001) ? Dcam / px0 : Infinity;
    const cosPitch = Math.cos(pitchR);
    // n' = unit direction from the map center toward the camera — normalized
    // (robust, no cancellation); falls back to the center direction if the
    // camera is unavailable.
    let nvx = cmx, nvy = cmy, nvz = cmz;
    if (camPos) {
      const dx = camPos[0] - cmx, dy = camPos[1] - cmy, dz = camPos[2] - cmz;
      const dl = Math.hypot(dx, dy, dz);
      if (dl > 1e-9) { nvx = dx / dl; nvy = dy / dl; nvz = dz / dl; }
    }

    // S_true = the point directly below the camera (C normalized) — the
    // disk/chunk reference. NOT n' = (C−c)/κ: that is the direction from
    // the MAP CENTER to the camera, which at pitch p lies p·R along the
    // surface away from the view (8,300km at z12/p75 — the disk ballooned
    // to half the globe and the chunk respawned behind the view). At
    // pitch 0 all three points coincide, so p=0 behavior is unchanged.
    const cax = cmx + kappa * nvx, cay = cmy + kappa * nvy, caz = cmz + kappa * nvz;
    const cLen = Math.hypot(cax, cay, caz) || 1;
    const stx = cax / cLen, sty = cay / cLen, stz = caz / cLen;

    // GTA-style view culling: only bots in the on-screen region (plus a
    // margin) are drawn. rVis = the farthest ON-SCREEN surface point, arc
    // from the map center c. Measured with MapLibre's OWN projection —
    // unproject the screen perimeter to ground lng/lat and take the max
    // central angle. NOT a matrix raycast: inverting the float32 view
    // matrix + the rpx solve over-reached (~60km where the screen was ~16km)
    // and went to 0 on some frames, so the disk flapped and the bot count
    // swung 0↔7500. unproject is exact and stable at every zoom/pitch.
    // rCull = max(1.5·rVis, 2km): bots fade out across that margin so the
    // edge melts instead of popping; the 2km floor keeps deep zoom non-empty.
    let rVis = 0, rCull = Infinity;
    {
      const cw = map.getCanvas().clientWidth, ch = map.getCanvas().clientHeight;
      const cLatR = center.lat * RAD, cLng = center.lng;
      const arcMeters = (lng, lat) => {
        const φ1 = lat * RAD, dφ = (lat - center.lat) * RAD, dλ = (lng - cLng) * RAD;
        const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(cLatR) * Math.sin(dλ / 2) ** 2;
        return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * EARTH_R;
      };
      let maxArc = 0;
      const N = 6;
      for (let i = 0; i <= N; i++) {
        const f = i / N;
        for (const [x, y] of [[f * cw, 0], [f * cw, ch], [0, f * ch], [cw, f * ch]]) {
          let ll;
          try { ll = map.unproject([x, y]); } catch (err) { continue; }
          if (!ll || !isFinite(ll.lng) || !isFinite(ll.lat)) continue;
          const a = arcMeters(ll.lng, ll.lat);
          if (a > maxArc) maxArc = a;
        }
      }
      if (maxArc > 0) rVis = 1.15 * maxArc;
      if (rVis <= 0) rVis = Math.acos(1 / (1 + kappa)) * 1.15 * EARTH_R; // horizon fallback
      rCull = Math.max(1.5 * rVis, 2000);
    }

    return {
      isFlat, zoomScaleCity, zoomScaleSky, floor, px0, camAltFlat,
      kappa, cosPitch, nvx, nvy, nvz, stx, sty, stz,
      rVis, rCull, cmx, cmy, cmz
    };
  };

  const updateInstances = (projData, dt) => {
    const map = state.map;
    const zoom = map.getZoom();
    const center = map.getCenter();
    const camKey = center.lat + '|' + center.lng + '|' + zoom + '|' + map.getBearing() + '|' + map.getPitch();
    // Camera-derived values recompute ONLY on a camera move — bots drift
    // every frame, so this keeps idle frames from paying the 24×unproject
    // perimeter sampling for nothing.
    if (camKey !== state.cvKey) {
      state.cv = computeCam(projData);
      state.cvKey = camKey;
    }
    const cv = state.cv;

    for (const inst of state.groups.values()) {
      inst.slotCount = 0;
      if (inst.fade < 1) inst.fade = Math.min(1, inst.fade + dt / 0.6); // load fade-in: grow 0→1 over 0.6s
    }
    // Far zoom-out (engine floor is -2): if the globe ever shrinks below the
    // bots' 4px floor, px/m rounds to 0 and the size clamp divides by zero
    // (Infinity matrices). Skip the pass (negated form also catches NaN).
    if (!(2 * cv.px0 * EARTH_R >= 4)) return;
    let overflow = false;

    // Writes one bot's matrix into its group's instance buffers
    const emitBot = (b, inst) => {
      const g = inst.g;
      const lat = b.origin[1] * RAD, lng = b.origin[0] * RAD;
      const sφ = Math.sin(lat), cφ = Math.cos(lat);
      const sλ = Math.sin(lng), cλ = Math.cos(lng);
      const dirx = cφ * sλ, diry = sφ, dirz = cφ * cλ;

      // Far side of the globe (past the horizon): never visible — skip.
      // Measured from S_true (the point below the camera): the horizon arc
      // from S_true is always < 90°, so −0.05 (≈93°) never culls a visible bot
      const dotS = cv.stx * dirx + cv.sty * diry + cv.stz * dirz;
      if (dotS < -0.05) return;

      // View cull: arc distance from the map center c (the screen center).
      // rVis/rCull now come from MapLibre's own unproject, so they tightly
      // bound the ON-SCREEN region — only bots in the view (plus the fade
      // margin) are drawn. This is what keeps street-zoom to a sensible
      // crowd instead of the whole near-hemisphere (~7500), while still
      // showing every bot that's actually on screen (no more "0 bots").
      const dotC = cv.cmx * dirx + cv.cmy * diry + cv.cmz * dirz;
      const d = Math.acos(Math.min(1, Math.max(-1, dotC))) * EARTH_R;
      // d is measured to the bot's HOME — the GPU drift can carry the model
      // up to its orbit radius away from it, so sky bots (50–300km orbits)
      // get a wider cull radius; city orbits (≤1.5km) already fit inside
      // the 2km floor and keep the exact margin.
      const rc = cv.rCull + (b.city ? 0 : SKY_ORBIT_MAX);
      if (d > rc) return;
      // Proximity fade across the margin: 1 up to the screen edge (rVis),
      // cubic down to 0 at rc — the edge melts, no pop.
      let fade = d <= cv.rVis ? 1 : 1 - (d - cv.rVis) / (rc - cv.rVis);
      fade *= fade * fade;
      if (fade < 0.01) return;

      // Rendered altitude: the real one, pinned just below the camera
      // plane (0.9κ) when the real one would put the bot behind the camera
      const u = Math.min(b.altitude / EARTH_R, cv.kappa * 0.9);
      // Exact pinhole depth uses the VIEW-AXIS dot (n'), not the disk dot.
      // Only meaningful in the GLOBE frame (it drives the behind-camera cull
      // there); the flat frame is near-orthographic at street zoom.
      const depth = cv.kappa + cv.cosPitch - (1 + u) * (cv.nvx * dirx + cv.nvy * diry + cv.nvz * dirz);
      if (!cv.isFlat && depth <= 1e-9) return;

      // px/m at the bot: globe uses the pinhole magnification (κ/depth); the
      // flat frame is uniform at the surface scale (px0) — px0 already comes
      // from map.project, so it is frame-correct.
      let px = cv.isFlat ? cv.px0 : cv.px0 * cv.kappa / depth;
      if (!(px > 0.0001)) px = cv.px0;

      const isCity = !!b.city;
      const worldSize = isCity ? 100 : 50000;
      const f = b.scaleFactorNFT || 1;
      const zS = isCity ? cv.zoomScaleCity : cv.zoomScaleSky;
      // The per-bot NFT factor is part of the on-screen size, so it goes
      // into the clamp: the rendered size is then strictly within
      // [floor, 40] px at every zoom.
      const mMin = cv.floor / (worldSize * px * f);
      const mMax = 40 / (worldSize * px * f);
      const clamped = zS < mMin ? mMin : zS > mMax ? mMax : zS;
      // The margin fade + the load fade-in (inst.fade) multiply the clamped
      // size (they may dip below the floor toward the view edge — the melt)
      const s = (isCity ? g.scaleCity : g.scaleSky) * f * clamped * fade * inst.fade;
      const k = s / EARTH_R;
      const h = 1 + u;

      const slot = inst.slotCount;
      if (slot >= inst.capacity) { overflow = true; return; }
      inst.slotCount = slot + 1;
      // Orbit params for the shader drift — same slot as the matrix
      const ao = inst.aOrbit, aoO = slot * 4;
      ao[aoO] = b.oRad; ao[aoO + 1] = b.oSpd; ao[aoO + 2] = b.oPhs; ao[aoO + 3] = b.oBob;

      // Write the model matrix for the CURRENT frame (identical across all of
      // the bot's parts — part offsets are baked into the part geometries).
      if (cv.isFlat) {
        // Flat (mercator) frame: MapLibre's own real-size model matrix, scaled
        // to our clamped size (s). Unit-sphere positions are invalid here —
        // this is the frame that flung the bots off-screen before.
        // Pin the altitude just below the flat camera plane (the same rule as
        // the globe frame's u-pin): at deep zoom the camera is lower than the
        // bots' real altitude and they leave the frustum otherwise.
        const altFlat = Math.min(b.altitude, cv.camAltFlat * 0.9);
        const mm = map.transform.getMatrixForModel([b.origin[0], b.origin[1]], altFlat);
        const o = slot * 16;
        for (let pi = 0, pn = inst.parts.length; pi < pn; pi++) {
          const buf = inst.parts[pi].buf;
          buf[o] = mm[0] * s;   buf[o + 1] = mm[1] * s;   buf[o + 2] = mm[2] * s;   buf[o + 3] = 0;
          buf[o + 4] = mm[4] * s; buf[o + 5] = mm[5] * s; buf[o + 6] = mm[6] * s;   buf[o + 7] = 0;
          buf[o + 8] = mm[8] * s; buf[o + 9] = mm[9] * s; buf[o + 10] = mm[10] * s; buf[o + 11] = 0;
          buf[o + 12] = mm[12];  buf[o + 13] = mm[13];    buf[o + 14] = mm[14];    buf[o + 15] = 1;
        }
      } else {
        // Globe frame: unit-sphere position — identical to MapLibre's
        // getMatrixForModel for the globe (verified rotation + translation).
        // Column-major, identity rotation + uniform scale + translation.
        for (let pi = 0, pn = inst.parts.length; pi < pn; pi++) {
          const buf = inst.parts[pi].buf;
          const o = slot * 16;
          buf[o] = k * cλ;      buf[o + 1] = 0;            buf[o + 2] = -k * sλ;     buf[o + 3] = 0;
          buf[o + 4] = k * sλ * cφ; buf[o + 5] = k * sφ;   buf[o + 6] = k * cλ * cφ; buf[o + 7] = 0;
          buf[o + 8] = k * sλ * sφ; buf[o + 9] = -k * cφ;  buf[o + 10] = k * cλ * sφ; buf[o + 11] = 0;
          buf[o + 12] = h * dirx;   buf[o + 13] = h * diry; buf[o + 14] = h * dirz;  buf[o + 15] = 1;
        }
      }
    };

    for (let i = 0; i < models.length; i++) {
      const b = models[i];
      if (!b || !b.origin) continue;
      const inst = state.modelGroup[i];
      if (!inst || !inst.loaded) continue;
      emitBot(b, inst);
    }

    for (const inst of state.groups.values()) {
      if (inst.slotCount > inst.capacity) growGroup(inst);
      for (const p of inst.parts) {
        p.imesh.count = inst.slotCount;
        p.imesh.instanceMatrix.needsUpdate = true;
      }
      if (inst.aAttr) inst.aAttr.needsUpdate = true;
    }
    if (overflow) state.dirty = true; // recompute next frame with the grown capacity
  };

  const customLayer = {
    id: "3d-model",
    type: "custom",
    renderingMode: "3d",

    onAdd(map, gl) {
      state.map = map;
      state.t0 = performance.now(); // start the shader drift clock
      state.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      state.renderer.autoClear = false;
      MAX_ANISO = state.renderer.capabilities.getMaxAnisotropy();
      // A canvas resize changes px/m and the on-screen disk, but the cached
      // camera values (state.cv) only refresh on a camera move — dirty them.
      state.onResize = () => { state.dirty = true; };
      map.on('resize', state.onResize);

      rebuildMapping(); // load every URL in use right now
    },

    onRemove(map, gl) {
      // Drop this instance's meshes and free the per-instance GPU buffers.
      // The shared group data (geometry/materials) survives so a re-enable
      // doesn't re-download or re-optimize the models.
      for (const inst of state.groups.values()) {
        for (const p of inst.parts) {
          state.scene.remove(p.imesh);
          p.imesh.dispose();
          p.geo.dispose(); // per-instance clone (the shared group geos stay cached)
        }
        if (inst.aAttr) { inst.aAttr.dispose(); inst.aAttr = null; }
        inst.parts = [];
        inst.loaded = false;
      }
      if (state.onResize) { map.off('resize', state.onResize); state.onResize = null; }
      if (state.renderer) state.renderer.dispose();
      state.renderer = null;
      state.map = null;
      state.dirty = true;
    },

    render(gl, args) {
      if (!state.renderer || !state.map) return;
      const map = state.map;
      try {
        // Real frame dt — drives the load fade-in ramp (the drift itself is
        // uTime in the shader, smooth at any frame rate for free).
        const now = performance.now();
        const dt = state.lastT ? Math.min(0.1, Math.max(0, (now - state.lastT) / 1000)) : 0;
        state.lastT = now;
        uTime.value = (now - state.t0) / 1000; // shader drift clock

        const center = map.getCenter();
        const camKey = center.lat + '|' + center.lng + '|' + map.getZoom() + '|' + map.getBearing() + '|' + map.getPitch();
        const camChanged = camKey !== state.lastCamKey;
        state.lastCamKey = camKey;

        // Real peers join/leave (gossip) or the bot list regenerates — re-map
        // models[] to groups and load any new URLs
        const listChanged = models.length !== state.lastLen || modelsVersion !== state.lastVersion;
        if (listChanged) {
          state.lastLen = models.length;
          state.lastVersion = modelsVersion;
          rebuildMapping();
          state.dirty = true;
        }
        // Matrices are static until the camera moves (the drift is in the
        // shader) — rewrite on a camera move, and while a group's load
        // fade-in is still ramping its scale.
        let fadeActive = false;
        for (const inst of state.groups.values()) if (inst.fade < 1) { fadeActive = true; break; }
        if (camChanged || fadeActive) state.dirty = true;
        if (state.dirty) {
          updateInstances(args.defaultProjectionData, dt);
          state.dirty = false;
        }

        const mapProjectionMatrix = new THREE.Matrix4().fromArray(
          args.defaultProjectionData.mainMatrix
        );
        P2Pcamera.projectionMatrix = mapProjectionMatrix;
        P2Pcamera.matrixWorldInverse.identity();

        state.renderer.resetState();
        state.renderer.render(state.scene, P2Pcamera);
        map.triggerRepaint();
      } catch (err) {
        console.error('3d-model render error', err);
      }
    }
  };

  return customLayer;
}

// ────────────────────────────────────────────────
// Day/night shade — its own custom 3D layer
//
// Split out of the bot layer so it survives hiding the 3D models: the
// "Hide 3D models" toggle removes/re-adds only the "3d-model" layer, so the
// terminator keeps tracking the sun (and light/dark/daynight keeps working)
// even when the bots are off. It must stay the TOPMOST 3D layer so its shade
// (depthTest off) blends over the bots.
//
// Same per-pixel fragment-shader sphere as before: a unit sphere at the origin
// whose fragment computes the sun elevation (dot of surface normal and sun
// direction) and blends day->night with a wide, smoothstep-eased fade.
// ────────────────────────────────────────────────
export function loadDayNight() {
  const state = {
    map: null,
    renderer: null,
    scene: new THREE.Scene(),
  };
  // Its own camera, decoupled from the bot layer's P2Pcamera — the projection
  // is set from the map's mainMatrix every frame, exactly like the bot layer.
  const dnCamera = new THREE.Camera();

  const dayNightMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false, // blend over everything; depth-testing caused banding
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uFade: { value: 15 * RAD }, // fade half-width in sun elevation (radians) — wide band, smoothstep-eased
      uNightOnly: { value: 0 }, // 1 = dark mode: no sun, no terminator — whole globe in night
      uOpacity: { value: 0.75 }
    },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        // Sphere sits at the origin with no transform, so its object-space
        // normal is already the world-space (globe-frame) normal. Interpolating
        // the normal (a direction) is smooth; interpolating the position and
        // normalizing it aliases into stripes on mobile GPUs.
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      precision highp float;
      uniform vec3 uSunDir;
      uniform float uFade;
      uniform float uNightOnly;
      uniform float uOpacity;
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal);
        float cosAng = clamp(dot(n, uSunDir), -1.0, 1.0);
        float el = asin(cosAng); // sun elevation (radians), 0 at the terminator
        float t = clamp((uFade - el) / (2.0 * uFade), 0.0, 1.0); // 0 = full day, 1 = full night
        t = mix(t, 1.0, uNightOnly); // dark mode: no light, so no fade — full night everywhere
        float d = t * t * (3.0 - 2.0 * t); // smoothstep — imperceptibly gradual, no visible edge
        gl_FragColor = vec4(0.0, 0.0, 0.102, d * uOpacity); // #00001a
      }`
  });
  const dayNightMesh = new THREE.Mesh(new THREE.SphereGeometry(1.001, 96, 48), dayNightMat);
  dayNightMesh.frustumCulled = false;
  state.scene.add(dayNightMesh);

  // Flat frame: the shade sphere can't exist there, so the flat view tints
  // the whole screen at the strength sampled at the map center (same math as
  // the shader). Re-sampled on every painted frame, so dragging across the
  // terminator darkens/lightens the view live.
  //
  // Rendered as ONE clip-space fullscreen quad in its own scene — NOT as a
  // map fill layer: a map layer gets split into per-tile chunks, and during
  // the globe->flat morph each chunk warps differently, showing a visible
  // grid of seams at the tile boundaries. A clip-space quad has no tiles:
  // one square, exactly the screen, no seams.
  const tintScene = new THREE.Scene();
  const tintCamera = new THREE.Camera(); // identity projection — quad is in clip space
  const tintMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uColor: { value: new THREE.Color(0.0, 0.0, 0.102) }, // #00001a, same as the sphere
      uOpacity: { value: 0 },
    },
    vertexShader: `
      void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0); // PlaneGeometry(2,2) -> exact screen
      }`,
    fragmentShader: `
      precision highp float;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
      }`
  });
  const tintMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tintMat);
  tintMesh.frustumCulled = false;
  tintScene.add(tintMesh);

  function flatTintOpacity() {
    if (shadeMode === 'dark') return dayNightMat.uniforms.uOpacity.value;
    if (shadeMode !== 'daynight') return 0;
    const c = state.map.getCenter();
    return shadeStrengthAt(c.lat, c.lng) * dayNightMat.uniforms.uOpacity.value;
  }

  return {
    id: "daynight",
    type: "custom",
    renderingMode: "3d",

    onAdd(map, gl) {
      state.map = map;
      state.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      state.renderer.autoClear = false;
    },

    onRemove(map, gl) {
      state.scene.remove(dayNightMesh);
      dayNightMesh.geometry.dispose();
      dayNightMat.dispose();
      tintScene.remove(tintMesh);
      tintMesh.geometry.dispose();
      tintMat.dispose();
      if (state.renderer) state.renderer.dispose();
      state.renderer = null;
      state.map = null;
    },

    render(gl, args) {
      if (!state.renderer || !state.map) return;
      const map = state.map;
      // The globe->flat transition MORPHS a single frame (the tile shaders
      // mix flat/globe positions with _globeness; z11 = pure globe, z12 =
      // pure flat — MapLibre's own ["interpolate", ["zoom"], 11, globe,
      // 12, mercator] expression), so the shade must be ONE constant
      // strength across it, with the two shades NEVER overlapping (overlap
      // = double shade = too dark). Handover at z11: the 3D sphere owns
      // the pure-globe side (z<=11), and from the first transition frame on
      // (z>11) the fullscreen tint quad takes over — one clip-space square,
      // no tiles, so no seam grid during the morph. First and last
      // transition frame carry the identical shade, no fade, no pop.
      const modeOn = shadeMode === 'daynight' || shadeMode === 'dark';
      const inFlat = map.getZoom() > 11;
      const sphereVisible = modeOn && !inFlat;
      const tintVisible = modeOn && inFlat;
      dayNightMesh.visible = sphereVisible;
      tintMesh.visible = tintVisible;
      if (tintVisible) tintMat.uniforms.uOpacity.value = flatTintOpacity();
      if (!sphereVisible && !tintVisible) return; // nothing to draw this frame
      try {
        if (sphereVisible) {
          const nightOnly = shadeMode === 'dark';
          dayNightMat.uniforms.uNightOnly.value = nightOnly ? 1.0 : 0.0;
          if (!nightOnly) {
            const sun = sunDirectionVec(new Date());
            dayNightMat.uniforms.uSunDir.value.set(sun.x, sun.y, sun.z);
          }
          dnCamera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
          dnCamera.matrixWorldInverse.identity();
          state.renderer.resetState();
          state.renderer.render(state.scene, dnCamera);
          if (!nightOnly) map.triggerRepaint(); // only daynight animates; dark is static
        }
        if (tintVisible) {
          state.renderer.resetState();
          state.renderer.render(tintScene, tintCamera);
        }
      } catch (err) {
        console.error('daynight render error', err);
      }
    }
  };
}
