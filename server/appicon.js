// Install icons are drawn when a browser asks for them: the moon photo,
// plus the 1mhbar.com wall as it is right then. A change on that wall
// shows up on the next install without a new deploy.
//
// The wall is rechecked every 20s (same pace as the snapshot page).
// The drawn PNG is kept until that check sees a different wall.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOON_PATH = path.join(__dirname, "..", "moon.jpg");
const WALL_URL = "https://1mhbar.com/api/wall";
const WALL_ORIGIN = "https://1mhbar.com";
const WALL_TTL_MS = 20_000;
const TILE_LIMIT = 8_000_000;

export const APP_ICONS = {
  "icon-192.png": { size: 192, scale: 1 },
  "icon-512.png": { size: 512, scale: 1 },
  "icon-512-maskable.png": { size: 512, scale: 0.8 },
  "apple-touch-icon.png": { size: 180, scale: 1 },
};

let wallState = { at: 0, hash: "", plots: null, pending: null };
let snapState = { hash: "", png: null, pending: null };
const pngCache = new Map();
const iconPending = new Map();

function cellOf(origin) {
  const serial = origin - 1;
  return { x: serial % 100, y: Math.floor(serial / 100) };
}

function imageUrl(img) {
  if (typeof img !== "string") return "";
  const trimmed = img.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  if (trimmed.startsWith("/")) return WALL_ORIGIN + trimmed;
  return "";
}

async function fetchWall() {
  const now = Date.now();
  if (wallState.plots && now - wallState.at < WALL_TTL_MS) return wallState;
  if (wallState.pending) return wallState.pending;
  wallState.pending = (async () => {
    try {
      const res = await fetch(WALL_URL, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("wall " + res.status);
      const data = await res.json();
      const plots = Array.isArray(data.plots) ? data.plots : [];
      const hash = createHash("sha256").update(JSON.stringify(plots)).digest("hex").slice(0, 16);
      wallState = { at: Date.now(), hash, plots, pending: null };
      return wallState;
    } catch (err) {
      wallState.pending = null;
      if (wallState.plots) return wallState;
      throw err;
    }
  })();
  return wallState.pending;
}

async function fetchTile(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("tile " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > TILE_LIMIT) throw new Error("tile too large");
  return buf;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Math.min(limit, items.length);
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

async function snapshotPng() {
  const wall = await fetchWall();
  if (snapState.hash === wall.hash && snapState.png) return snapState;
  if (snapState.pending && snapState.pendingHash === wall.hash) return snapState.pending;

  const job = (async () => {
    const layers = (await mapPool(wall.plots, 6, async (plot) => {
      const origin = Number(plot.origin);
      const w = Number(plot.w);
      const h = Number(plot.h);
      if (!Number.isInteger(origin) || !Number.isInteger(w) || !Number.isInteger(h)) return null;
      if (w < 1 || h < 1) return null;
      const { x, y } = cellOf(origin);
      if (x < 0 || y < 0 || x + w > 100 || y + h > 100) return null;
      const url = imageUrl(plot.img);
      try {
        const input = url
          ? await sharp(await fetchTile(url), { failOn: "none" })
            .resize(w * 10, h * 10, { kernel: "nearest", fit: "fill" })
            .png()
            .toBuffer()
          : await sharp({
            create: {
              width: w * 10,
              height: h * 10,
              channels: 4,
              background: { r: 26, g: 26, b: 26, alpha: 1 },
            },
          }).png().toBuffer();
        return { input, left: x * 10, top: y * 10 };
      } catch (err) {
        console.warn("app icon tile skipped", url || plot.origin, err.message);
        return null;
      }
    })).filter(Boolean);

    let canvas = await sharp({
      create: { width: 1000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
    for (let i = 0; i < layers.length; i += 40) {
      canvas = await sharp(canvas).composite(layers.slice(i, i + 40)).png().toBuffer();
    }
    snapState = { hash: wall.hash, png: canvas, pending: null, pendingHash: "" };
    return snapState;
  })().catch((err) => {
    snapState.pending = null;
    snapState.pendingHash = "";
    throw err;
  });

  snapState.pending = job;
  snapState.pendingHash = wall.hash;
  return job;
}

async function drawIcon(name) {
  const spec = APP_ICONS[name];
  const snap = await snapshotPng();
  const cacheKey = name + ":" + snap.hash;
  const cached = pngCache.get(cacheKey);
  if (cached) return { png: cached, hash: snap.hash };

  const { size, scale } = spec;
  const moonBox = Math.round(size * scale);
  const iw = Math.round(moonBox * 1.25);
  const ih = Math.round(moonBox * 1.20);
  const cropLeft = Math.max(0, Math.round((iw - moonBox) / 2));
  const cropTop = Math.max(0, Math.round((ih - moonBox) / 2));

  const moonCrop = await sharp(MOON_PATH)
    .resize(iw, ih, { fit: "fill" })
    .extract({ left: cropLeft, top: cropTop, width: moonBox, height: moonBox })
    .png()
    .toBuffer();

  const diskBg = await sharp({
    create: {
      width: moonBox,
      height: moonBox,
      channels: 4,
      background: { r: 5, g: 7, b: 12, alpha: 1 },
    },
  }).composite([{ input: moonCrop, left: 0, top: 0 }]).png().toBuffer();

  const radius = moonBox / 2;
  const mask = Buffer.from(
    `<svg width="${moonBox}" height="${moonBox}"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="#fff"/></svg>`
  );
  const disk = await sharp(diskBg)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const side = Math.max(1, Math.round(moonBox * 0.7071));
  const wall = await sharp(snap.png)
    .resize(side, side, { kernel: "nearest", fit: "fill" })
    .png()
    .toBuffer();
  const placed = Math.round((moonBox - side) / 2);
  const diskWithWall = await sharp(disk)
    .composite([{ input: wall, left: placed, top: placed }])
    .png()
    .toBuffer();

  const offset = Math.round((size - moonBox) / 2);
  const png = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  }).composite([{ input: diskWithWall, left: offset, top: offset }]).png().toBuffer();

  for (const key of pngCache.keys()) {
    if (key.startsWith(name + ":")) pngCache.delete(key);
  }
  pngCache.set(cacheKey, png);
  return { png, hash: snap.hash };
}

export function renderAppIcon(name) {
  if (!APP_ICONS[name]) return Promise.reject(new Error("unknown icon"));
  const pending = iconPending.get(name);
  if (pending) return pending;
  const job = drawIcon(name).finally(() => iconPending.delete(name));
  iconPending.set(name, job);
  return job;
}

export function appIcon(req, res, next) {
  const name = path.basename(req.path);
  if (!APP_ICONS[name]) return next();
  if (!fs.existsSync(MOON_PATH)) return next();
  renderAppIcon(name).then(({ png, hash }) => {
    const etag = `"${hash}-${name}"`;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("CDN-Cache-Control", "no-cache");
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.send(png);
  }).catch((err) => {
    console.error("app icon failed", name, err);
    next();
  });
}
