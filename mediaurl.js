// One media address for every renderer. A GIF URL is never painted:
// hosted files point at the sibling MP4 and poster, and any other GIF
// goes through /api/media/gif, which transcodes it once and redirects.
import { COVER_VIDEO_MAX_SECONDS, coverVideoTooLong } from "./covervideolimit.js";

export const GIF_CONVERT_ERROR = "Couldn't convert that GIF";
export const COVER_MAX_EDGE = 512;

const GIF_URL = /\.gif(?=$|[?#])/i;
const VIDEO_URL = /\.(mp4|webm|mov|m4v)(?=$|[?#])/i;

export function isGifUrl(url) {
  return typeof url === "string" && GIF_URL.test(url);
}

export function isVideoUrl(url) {
  return typeof url === "string" && VIDEO_URL.test(url);
}

function hostedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "r2.dev" || host.endsWith(".r2.dev") || host.endsWith(".r2.pub");
}

export function gifSiblings(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  const path = parsed.pathname.replace(/\.gif$/i, "");
  const mp4 = new URL(parsed.href);
  mp4.pathname = path + ".mp4";
  const poster = new URL(parsed.href);
  poster.pathname = path + ".poster.jpg";
  return { mp4: mp4.href, poster: poster.href };
}

// The public bucket, when this URL is one of our stored GIF objects.
// Anything else (IPFS gateways, other sites) is remote.
export function ownGifKey(url, publicBase) {
  const base = String(publicBase || "").replace(/\/+$/, "");
  if (!base || typeof url !== "string" || !isGifUrl(url)) return "";
  let parsed;
  let root;
  try {
    parsed = new URL(url);
    root = new URL(base);
  } catch {
    return "";
  }
  if (parsed.origin !== root.origin) return "";
  const prefix = root.pathname.replace(/\/+$/, "");
  const path = decodeURIComponent(parsed.pathname);
  if (prefix && path !== prefix && !path.startsWith(prefix + "/")) return "";
  const key = path.slice(prefix.length).replace(/^\/+/, "");
  if (!key || key.includes("..") || !/\.gif$/i.test(key)) return "";
  return key;
}

export function siblingKeys(gifKey) {
  const base = String(gifKey || "").replace(/\.gif$/i, "");
  return { video: base + ".mp4", poster: base + ".poster.jpg" };
}

export function resolveMediaUrl(url) {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return { kind: "image", src: "", poster: "" };
  if (!isGifUrl(raw)) {
    if (isVideoUrl(raw)) return { kind: "video", src: raw, poster: "" };
    return { kind: "image", src: raw, poster: "" };
  }
  try {
    const parsed = new URL(raw);
    if (hostedHost(parsed.hostname)) {
      const sib = gifSiblings(raw);
      return { kind: "video", src: sib.mp4, poster: sib.poster };
    }
  } catch {
    /* a relative GIF still goes through the route */
  }
  const q = encodeURIComponent(raw);
  return {
    kind: "video",
    src: `/api/media/gif?url=${q}`,
    poster: `/api/media/gif?url=${q}&poster=1`,
    remote: true,
  };
}

export function gifRole(header) {
  const role = String(header || "").trim().toLowerCase();
  if (role === "cover" || role === "avatar" || role === "polygon-cover" || role === "media") return role;
  return "media";
}

export function maxEdgeFor(role) {
  if (role === "cover" || role === "avatar" || role === "polygon-cover") return COVER_MAX_EDGE;
  return 0;
}

// Even output. A long edge above the cap is scaled down; media keeps its
// size and only loses a pixel when a side is odd (yuv420p needs both even).
export function scaleFilter(maxEdge) {
  const edge = Number(maxEdge) || 0;
  if (edge > 0) {
    return `scale='if(gt(iw,ih),min(${edge},iw),-2)':'if(gt(iw,ih),-2,min(${edge},ih))'`;
  }
  return "scale=trunc(iw/2)*2:trunc(ih/2)*2";
}

export function ffmpegVideoArgs(input, output, maxEdge) {
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-an",
    "-movflags", "+faststart",
    "-pix_fmt", "yuv420p",
    "-vf", scaleFilter(maxEdge),
    "-c:v", "libx264",
    "-profile:v", "baseline",
    "-level", "3.1",
    output,
  ];
}

export function ffmpegStillArgs(input, output, maxEdge) {
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-frames:v", "1",
    "-vf", scaleFilter(maxEdge),
    "-q:v", "3",
    output,
  ];
}

function skipSubBlocks(buf, index) {
  let i = index;
  while (i < buf.length) {
    const size = buf[i];
    i += 1;
    if (!size) return i;
    i += size;
  }
  return i;
}

// frames and duration (seconds). A frame with no graphic-control delay
// counts as 100ms, which is how browsers play that frame.
export function inspectGif(bytes) {
  const buf = bytes && bytes.length != null ? bytes : new Uint8Array();
  if (buf.length < 13) return { frames: 0, seconds: 0 };
  const sig = String.fromCharCode(buf[0], buf[1], buf[2], buf[3], buf[4], buf[5]);
  if (sig !== "GIF87a" && sig !== "GIF89a") return { frames: 0, seconds: 0 };
  let i = 13;
  if (buf[10] & 0x80) i += (2 << (buf[10] & 7)) * 3;
  let frames = 0;
  let centiseconds = 0;
  let pending = null;
  while (i < buf.length) {
    const marker = buf[i];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = buf[i + 1];
      if (label === 0xf9 && i + 7 < buf.length && buf[i + 2] === 4) {
        pending = buf[i + 4] | (buf[i + 5] << 8);
      }
      i = skipSubBlocks(buf, i + 2);
      continue;
    }
    if (marker === 0x2c) {
      if (i + 10 > buf.length) break;
      frames += 1;
      centiseconds += pending == null ? 10 : pending;
      pending = null;
      const packed = buf[i + 9];
      i += 10;
      if (packed & 0x80) i += (2 << (packed & 7)) * 3;
      i += 1;
      i = skipSubBlocks(buf, i);
      continue;
    }
    break;
  }
  return { frames, seconds: centiseconds / 100 };
}

export function planGif(inspected, role, forceVideo) {
  const frames = inspected && inspected.frames ? inspected.frames : 0;
  const edge = maxEdgeFor(role);
  if (!forceVideo && frames <= 1) {
    return { store: "image", ext: ".jpg", mime: "image/jpeg", maxEdge: edge, poster: false };
  }
  return { store: "video", ext: ".mp4", mime: "video/mp4", maxEdge: edge, poster: true };
}

// run(kind, { bytes, maxEdge }) returns the output bytes or throws.
// A throw, or an empty file, is a rejection. The GIF itself is never returned.
export async function applyGifTranscode({ bytes, role, run, forceVideo = false }) {
  const inspected = inspectGif(bytes);
  if (!inspected.frames) {
    return { ok: false, status: 415, error: "File contents do not match the declared type" };
  }
  const plan = planGif(inspected, gifRole(role), forceVideo === true);
  if (plan.store === "video" && gifRole(role) === "polygon-cover" && coverVideoTooLong(inspected.seconds)) {
    return { ok: false, status: 400, error: `Cover video max ${COVER_VIDEO_MAX_SECONDS} seconds` };
  }
  try {
    if (typeof run !== "function") throw new Error("no ffmpeg");
    if (plan.store === "image") {
      const still = await run("still", { bytes, maxEdge: plan.maxEdge });
      if (!still || !still.length) throw new Error("empty");
      return { ok: true, ext: ".jpg", mime: "image/jpeg", body: still, poster: null, seconds: 0 };
    }
    const video = await run("video", { bytes, maxEdge: plan.maxEdge });
    const poster = await run("poster", { bytes, maxEdge: plan.maxEdge });
    if (!video || !video.length || !poster || !poster.length) throw new Error("empty");
    return {
      ok: true,
      ext: ".mp4",
      mime: "video/mp4",
      body: video,
      poster,
      seconds: inspected.seconds,
    };
  } catch {
    return { ok: false, status: 422, error: GIF_CONVERT_ERROR };
  }
}
