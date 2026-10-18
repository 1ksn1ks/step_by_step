// A 100x100 plot with half its cells hidden must stay one layer and finish quickly.
import sharp from "sharp";
import { plotLayers, renderAppIcon } from "../server/appicon.js";

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function pixel(buf, x, y) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return {
    w: info.width,
    h: info.height,
    r: data[i],
    g: data[i + 1],
    b: data[i + 2],
    a: data[i + 3],
  };
}

const red = await sharp({
  create: { width: 2, height: 2, channels: 3, background: { r: 220, g: 10, b: 10 } },
}).png().toBuffer();
const split = await sharp({
  create: { width: 2, height: 1, channels: 3, background: { r: 0, g: 0, b: 230 } },
}).composite([{
  input: await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 220, g: 10, b: 10 } },
  }).png().toBuffer(),
  left: 0,
  top: 0,
}]).png().toBuffer();

const tiles = new Map([
  ["https://1mhbar.com/tile-red.png", red],
  ["https://1mhbar.com/tile-split.png", split],
]);

const hidden = {};
for (let serial = 2; serial <= 10000; serial += 2) hidden[String(serial)] = "";

let wallPlots = [];
let ownersBody = hidden;
globalThis.fetch = async (url) => {
  const key = String(url);
  if (key.endsWith("/api/wall")) {
    return { ok: true, status: 200, json: async () => ({ plots: wallPlots }) };
  }
  if (key.endsWith("/api/wall-owners")) {
    return { ok: true, status: 200, json: async () => ({ owners: ownersBody }) };
  }
  const buf = tiles.get(key);
  if (!buf) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

const started = Date.now();
const layers = await plotLayers(
  { origin: 1, w: 100, h: 100, img: "https://1mhbar.com/tile-red.png", owner: "0.0.1" },
  hidden,
);
const elapsed = Date.now() - started;
if (elapsed >= 2000) fail("100x100 half-hidden plot took " + elapsed + "ms");
if (layers.length !== 1 || layers[0].left !== 0 || layers[0].top !== 0) {
  fail("partial plot should be one layer, got " + layers.length);
}
const kept = await pixel(layers[0].input, 0, 0);
const skipped = await pixel(layers[0].input, 10, 0);
if (kept.w !== 1000 || kept.h !== 1000 || kept.r !== 220 || kept.a !== 255) {
  fail("kept cell changed " + JSON.stringify(kept));
}
if (skipped.a !== 0) fail("hidden cell should be transparent " + JSON.stringify(skipped));

const framed = await plotLayers(
  {
    origin: 1,
    w: 2,
    h: 1,
    img: "https://1mhbar.com/tile-split.png",
    owner: "0.0.1",
    frameOrigin: 1,
    frameW: 2,
    frameH: 1,
  },
  { "2": "" },
);
if (framed.length !== 1) fail("framed partial plot should be one layer");
const frameKept = await pixel(framed[0].input, 0, 0);
const frameHidden = await pixel(framed[0].input, 10, 0);
if (frameKept.w !== 20 || frameKept.r !== 220 || frameKept.a !== 255 || frameHidden.a !== 0) {
  fail("frame crop changed " + JSON.stringify({ frameKept, frameHidden }));
}

const cropped = await plotLayers(
  {
    origin: 2,
    w: 1,
    h: 1,
    img: "https://1mhbar.com/tile-split.png",
    owner: "0.0.1",
    frameOrigin: 1,
    frameW: 2,
    frameH: 1,
  },
  {},
);
if (cropped.length !== 1 || cropped[0].left !== 10) fail("full frame crop placement");
const blue = await pixel(cropped[0].input, 0, 0);
if (blue.w !== 10 || blue.b !== 230 || blue.r !== 0 || blue.a !== 255) {
  fail("full frame crop color " + JSON.stringify(blue));
}

const dark = await plotLayers(
  { origin: 1, w: 1, h: 2, owner: "0.0.1" },
  { "101": "0.0.9" },
);
if (dark.length !== 1) fail("dark partial plot should be one layer");
const ink = await pixel(dark[0].input, 0, 0);
const clear = await pixel(dark[0].input, 0, 10);
if (ink.r !== 26 || ink.g !== 26 || ink.b !== 26 || ink.a !== 255 || clear.a !== 0) {
  fail("dark fill changed " + JSON.stringify({ ink, clear }));
}

wallPlots = [{ origin: 1, w: 1, h: 2, img: "https://1mhbar.com/tile-red.png", owner: "0.0.1" }];
ownersBody = { "101": "" };
const icon = await renderAppIcon("icon-192.png");
const meta = await sharp(icon.png).metadata();
if (meta.width !== 192 || meta.height !== 192 || meta.format !== "png") {
  fail("snapshot png " + JSON.stringify(meta));
}

console.log("app icon plot ok in " + elapsed + "ms");
