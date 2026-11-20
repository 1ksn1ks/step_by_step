// imagecompress.js — a post picture is shrunk and re-encoded on the device
// before it is uploaded: longest side POST_IMAGE_EDGE (2048), WebP at 80%,
// or JPEG at 80% where the browser cannot write WebP (Safari's canvas
// hands back a PNG for "image/webp"). The picture is turned the way the
// camera held it, and the re-encode drops the file's EXIF data (GPS
// position included). Never upscales.
//
// One picture is decoded at a time (postgallery.js holds the lock), so four
// large phone photos never sit in memory together.

import { POST_IMAGE_EDGE, POST_IMAGE_QUALITY } from "./postimages.js";

// The size a w x h picture is drawn at: its longest side at most maxEdge.
export function fitLongestSide(width, height, maxEdge = POST_IMAGE_EDGE) {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  if (!w || !h) return { width: 0, height: 0 };
  const long = Math.max(w, h);
  if (long <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

// "IMG_0042.HEIC.jpeg" + image/webp -> "IMG_0042.HEIC.webp".
export function compressedName(name, type) {
  const base = String(name || "image").replace(/\.[a-z0-9]{1,5}$/i, "") || "image";
  return `${base}.${type === "image/webp" ? "webp" : "jpg"}`;
}

function readError(file) {
  const err = new Error(`Could not read ${shortName(file && file.name)}`);
  err.userFacing = true;
  return err;
}

export function shortName(name) {
  const raw = String(name || "image");
  return raw.length > 28 ? `${raw.slice(0, 18)}…${raw.slice(-8)}` : raw;
}

// A decoded picture the canvas can draw, turned the way it was shot.
async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // An engine that does not know the option, or cannot decode the file
      // this way: the <img> path below still turns it by its EXIF.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    if (typeof img.decode === "function") await img.decode().catch(() => {});
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(source) {
  return {
    width: source.naturalWidth || source.width || 0,
    height: source.naturalHeight || source.height || 0,
  };
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob || null), type, quality);
    } catch {
      resolve(null);
    }
  });
}

// Halving steps keep a big downscale from aliasing where "high" smoothing
// is not a real filter. Each step is at most 2x.
function drawScaled(source, width, height, fill) {
  let canvas = document.createElement("canvas");
  let { width: sw, height: sh } = sizeOf(source);
  let from = source;
  while (sw / 2 > width && sh / 2 > height) {
    const half = document.createElement("canvas");
    half.width = Math.max(width, Math.round(sw / 2));
    half.height = Math.max(height, Math.round(sh / 2));
    const hctx = half.getContext("2d");
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(from, 0, 0, half.width, half.height);
    if (from !== source) from.width = 0;
    from = half;
    sw = half.width;
    sh = half.height;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(from, 0, 0, width, height);
  if (from !== source) from.width = 0;
  return canvas;
}

// A community install icon: JPG, PNG or WebP, cropped to the centre square
// and never larger than APP_ICON_EDGE. The upload is that square.
export const APP_ICON_EDGE = 512;
export const APP_ICON_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isAppIconFile(file) {
  const type = String((file && file.type) || "").toLowerCase();
  if (APP_ICON_TYPES.has(type)) return true;
  return /\.(?:jpe?g|png|webp)$/i.test(String((file && file.name) || ""));
}

// The centre square of a w x h picture. Null when it has no pixels.
export function squareCropBox(width, height) {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const side = Math.min(w, h);
  if (!side) return null;
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side };
}

export async function squareCenterFile(file, edge = APP_ICON_EDGE) {
  let source;
  try {
    source = await decode(file);
  } catch {
    throw readError(file);
  }
  try {
    const crop = squareCropBox(sizeOf(source).width, sizeOf(source).height);
    if (!crop) throw readError(file);
    const out = Math.max(1, Math.min(edge, crop.side));
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw readError(file);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, crop.sx, crop.sy, crop.side, crop.side, 0, 0, out, out);
    let blob = await toBlob(canvas, "image/webp", 0.85);
    if (!blob || blob.type !== "image/webp") {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, out, out);
      ctx.drawImage(source, crop.sx, crop.sy, crop.side, crop.side, 0, 0, out, out);
      blob = await toBlob(canvas, "image/jpeg", 0.85);
    }
    canvas.width = 0;
    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) throw readError(file);
    return new File([blob], compressedName(file && file.name, blob.type), {
      type: blob.type,
      lastModified: (file && file.lastModified) || Date.now(),
    });
  } finally {
    if (source && typeof source.close === "function") source.close();
  }
}

// The post picture as WebP (or JPEG), ready for /api/upload.
export async function compressPostImage(file, options = {}) {
  const maxEdge = options.maxEdge > 0 ? options.maxEdge : POST_IMAGE_EDGE;
  const quality = options.quality > 0 ? options.quality : POST_IMAGE_QUALITY;
  let source;
  try {
    source = await decode(file);
  } catch {
    throw readError(file);
  }
  try {
    const box = fitLongestSide(sizeOf(source).width, sizeOf(source).height, maxEdge);
    if (!box.width || !box.height) throw readError(file);
    let canvas = drawScaled(source, box.width, box.height, "");
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") {
      // JPEG has no alpha: a transparent PNG gets a white page, not black.
      canvas.width = 0;
      canvas = drawScaled(source, box.width, box.height, "#ffffff");
      blob = await toBlob(canvas, "image/jpeg", quality);
    }
    canvas.width = 0;
    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) throw readError(file);
    return new File([blob], compressedName(file && file.name, blob.type), {
      type: blob.type,
      lastModified: (file && file.lastModified) || Date.now(),
    });
  } finally {
    if (source && typeof source.close === "function") source.close();
  }
}
