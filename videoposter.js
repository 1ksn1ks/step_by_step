// A video poster is a JPEG still: a picture the sender picked, or one frame
// from the file. The long edge stays at most 720 and both sides stay even.
import { evenFloor } from "./gifvideo.js";
import { isVideoUrl, siblingPosterUrl } from "./mediaurl.js";

export const THUMB_EDGE = 720;
export const THUMB_AT_S = 0.1;
export const THUMB_EDGES = [720, 480, 320, 160];
export const CHAT_IMAGE_PREFIX = "\u001echat1\n";
const E2EE_SEAL_BYTES = 48;

const frameCache = new Map();

export function fitThumb(width, height, maxEdge = THUMB_EDGE) {
  const w = Math.max(0, Math.floor(Number(width) || 0));
  const h = Math.max(0, Math.floor(Number(height) || 0));
  const edge = maxEdge > 0 ? maxEdge : THUMB_EDGE;
  if (!w || !h) return { width: 0, height: 0 };
  const long = Math.max(w, h);
  const scale = long > edge ? edge / long : 1;
  return { width: evenFloor(w * scale), height: evenFloor(h * scale) };
}

// Custom wins. Removed uploads nothing. A missed frame grab does not block.
export function posterPlan({ custom = null, captured = null, removed = false } = {}) {
  if (removed) return { upload: false, file: null, reason: "removed" };
  if (custom) return { upload: true, file: custom, reason: "custom" };
  if (captured) return { upload: true, file: captured, reason: "frame" };
  return { upload: false, file: null, reason: "capture-failed" };
}

export function posterSrc(videoUrl, hint) {
  const off = hint && hint.posterOff;
  if (off) return "";
  const explicit = hint && typeof hint.poster === "string" ? hint.poster.trim() : "";
  if (explicit) return explicit;
  const sibling = siblingPosterUrl(videoUrl);
  if (!sibling) return "";
  const rev = hint && Number(hint.posterV);
  if (rev > 0) return `${sibling}?v=${Math.floor(rev)}`;
  return sibling;
}

export function cachedVideoFrame(url) {
  const key = typeof url === "string" ? url.trim() : "";
  return key ? frameCache.get(key) || "" : "";
}

export function rememberVideoFrame(url, blobUrl) {
  const key = typeof url === "string" ? url.trim() : "";
  if (!key || !blobUrl) return "";
  frameCache.set(key, blobUrl);
  return blobUrl;
}

export function resetVideoFrames() {
  frameCache.clear();
}

// Flags carried on an edit. Absent fields stay unset so a text-only edit
// can keep the previous still.
export function posterFlags(data) {
  if (!data || typeof data !== "object") return { posterOff: false, posterV: 0 };
  const rev = Number(data.posterV);
  const off = data.posterOff === true || data.posterOff === 1 || data.posterOff === "1";
  return { posterOff: off, posterV: off || !(rev > 0) ? 0 : Math.floor(rev) };
}

// Bytes of the topic message that wraps a sealed chat payload.
// crypto_box_seal adds 48 bytes and to_base64 is unpadded.
export function e2eeWireBytes(payload) {
  const inner = new TextEncoder().encode(String(payload || "")).length;
  const sealed = inner + E2EE_SEAL_BYTES;
  const mod = sealed % 3;
  const b64 = Math.floor(sealed / 3) * 4 + (mod === 1 ? 2 : mod === 2 ? 3 : 0);
  return new TextEncoder().encode(JSON.stringify({
    encryptedMessage: { ciphertext: "x".repeat(b64) },
  })).length;
}

// E2EE keeps the still inside the sealed payload. A data URL is not an
// upload, and the outer topic message must not contain those bytes.
export function packSealedThumb(text, videoUrl, thumbDataUrl) {
  const data = {
    t: typeof text === "string" ? text : "",
    i: typeof videoUrl === "string" ? videoUrl : "",
  };
  if (typeof thumbDataUrl === "string" && thumbDataUrl.startsWith("data:image/")) data.p = thumbDataUrl;
  return CHAT_IMAGE_PREFIX + JSON.stringify(data);
}

export function sealedThumbHidden(outer, thumbDataUrl) {
  if (!thumbDataUrl) return true;
  return !String(outer || "").includes(thumbDataUrl);
}

export function unpackSealedThumb(raw) {
  const text = typeof raw === "string" ? raw : "";
  if (!text.startsWith(CHAT_IMAGE_PREFIX)) return { text, image: "", poster: "" };
  try {
    const data = JSON.parse(text.slice(CHAT_IMAGE_PREFIX.length));
    const poster = typeof data.p === "string" ? data.p : "";
    return {
      text: typeof data.t === "string" ? data.t : "",
      image: typeof data.i === "string" ? data.i : "",
      poster: poster.startsWith("data:image/") ? poster : "",
    };
  } catch {
    return { text, image: "", poster: "" };
  }
}

function seekTo(video, time) {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    if (Math.abs((video.currentTime || 0) - time) < 0.001) {
      resolve();
      return;
    }
    video.addEventListener("seeked", done, { once: true });
    try {
      video.currentTime = time;
    } catch {
      done();
    }
  });
}

function jpegFile(canvas, name) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      resolve(new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }));
    }, "image/jpeg", 0.85);
  });
}

// One frame at about 0.1s. Any failure is null so the upload still goes out.
export async function captureVideoPoster(source, options) {
  if (typeof document === "undefined") return null;
  const at = options && options.at >= 0 ? options.at : THUMB_AT_S;
  const maxEdge = options && options.maxEdge > 0 ? options.maxEdge : THUMB_EDGE;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  let url = "";
  try {
    if (typeof source === "string") url = source;
    else if (source) url = URL.createObjectURL(source);
    if (!url) return null;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 8000);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("decode"));
      };
      video.src = url;
    });
    const dur = video.duration;
    const when = Number.isFinite(dur) && dur > 0 ? Math.min(at, Math.max(0, dur - 0.04)) : 0;
    await seekTo(video, when);
    const box = fitThumb(video.videoWidth, video.videoHeight, maxEdge);
    if (!box.width || !box.height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = box.width;
    canvas.height = box.height;
    canvas.getContext("2d").drawImage(video, 0, 0, box.width, box.height);
    return jpegFile(canvas, "poster.jpg");
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    try { video.load(); } catch { /* already idle */ }
    if (url && typeof source !== "string") URL.revokeObjectURL(url);
  }
}

function pinBox(video, width, height) {
  if (!video || !width || !height) return;
  video.style.aspectRatio = `${width} / ${height}`;
}

function applyPoster(video, poster) {
  if (!video || !poster) return;
  video.poster = poster;
  if (typeof Image !== "function") return;
  const probe = new Image();
  probe.onload = () => pinBox(video, probe.naturalWidth, probe.naturalHeight);
  probe.src = poster;
}

function armFrameGrab(video, raw) {
  if (!isVideoUrl(raw) || typeof IntersectionObserver !== "function") return;
  const watch = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    watch.disconnect();
    if (video.getAttribute("poster")) return;
    const again = cachedVideoFrame(raw);
    if (again) {
      applyPoster(video, again);
      return;
    }
    captureVideoPoster(raw).then((file) => {
      if (!file || video.getAttribute("poster")) return;
      const blob = URL.createObjectURL(file);
      rememberVideoFrame(raw, blob);
      if (video.isConnected) applyPoster(video, blob);
    });
  }, { rootMargin: "15%" });
  watch.observe(video);
}

// Poster image only until the viewer plays. A sibling still is used when
// it loads. A miss is grabbed once, near the viewport, and kept in memory.
// That grab is never uploaded.
export function bindVideoPoster(video, videoUrl, hint) {
  if (!video) return video;
  const raw = typeof videoUrl === "string" ? videoUrl.trim() : "";
  video.preload = "none";
  if (!video.getAttribute("src")) video.removeAttribute("src");
  const known = posterSrc(raw, hint);
  const cached = cachedVideoFrame(raw);
  const explicit = hint && typeof hint.poster === "string" && hint.poster.trim();
  if (explicit) applyPoster(video, explicit);
  else if (cached && (hint && hint.posterOff)) applyPoster(video, cached);
  else if (known && typeof Image === "function") {
    const probe = new Image();
    probe.onload = () => applyPoster(video, known);
    probe.onerror = () => armFrameGrab(video, raw);
    probe.src = known;
  } else if (cached) applyPoster(video, cached);
  else armFrameGrab(video, raw);
  const holdSrc = !!(hint && hint.holdSrc);
  const armPlay = !holdSrc && !(hint && hint.armPlay === false);
  if (!video.dataset.posterArmed) {
    video.dataset.posterArmed = "1";
    if (armPlay) {
      video.addEventListener("pointerdown", () => {
        const src = video.dataset.src || "";
        if (src && !video.getAttribute("src")) video.src = src;
      });
    }
  }
  return video;
}
