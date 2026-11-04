// A video poster is a JPEG still: a picture the sender picked, or one frame
// from the file. An upload keeps an even long edge of at most 720. A viewer
// grab uses 480.
import { evenFloor } from "./gifvideo.js";
import { isVideoUrl, siblingPosterUrl } from "./mediaurl.js";

export const THUMB_EDGE = 720;
export const THUMB_AT_S = 0.1;
export const THUMB_EDGES = [720, 480, 320, 160];
export const CHAT_IMAGE_PREFIX = "\u001echat1\n";
const E2EE_SEAL_BYTES = 48;
const FRAME_CACHE_MAX = 60;
const VIEWER_GRAB_EDGE = 480;
const VIEWER_GRAB_LIMIT = 2;

// Newest last. A dropped still revokes its blob URL.
const frameCache = new Map();
const grabQueue = [];
let grabsBusy = 0;

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

function revokeFrameUrl(blobUrl) {
  if (!blobUrl) return;
  try { URL.revokeObjectURL(blobUrl); } catch { /* already revoked */ }
}

export function cachedVideoFrame(url) {
  const key = typeof url === "string" ? url.trim() : "";
  if (!key || !frameCache.has(key)) return "";
  const blobUrl = frameCache.get(key) || "";
  frameCache.delete(key);
  if (blobUrl) frameCache.set(key, blobUrl);
  return blobUrl;
}

export function rememberVideoFrame(url, blobUrl) {
  const key = typeof url === "string" ? url.trim() : "";
  if (!key || !blobUrl) return "";
  if (frameCache.has(key)) {
    const prev = frameCache.get(key);
    frameCache.delete(key);
    if (prev !== blobUrl) revokeFrameUrl(prev);
  }
  frameCache.set(key, blobUrl);
  while (frameCache.size > FRAME_CACHE_MAX) {
    const oldest = frameCache.keys().next().value;
    const dropped = frameCache.get(oldest);
    frameCache.delete(oldest);
    revokeFrameUrl(dropped);
  }
  return blobUrl;
}

export function resetVideoFrames() {
  for (const blobUrl of frameCache.values()) revokeFrameUrl(blobUrl);
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

function seekTo(video, time, signal) {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      if (signal) signal.removeEventListener("abort", stop);
      resolve();
    };
    const stop = () => {
      video.removeEventListener("seeked", done);
      reject(new Error("abort"));
    };
    if (signal && signal.aborted) {
      reject(new Error("abort"));
      return;
    }
    if (Math.abs((video.currentTime || 0) - time) < 0.001) {
      resolve();
      return;
    }
    video.addEventListener("seeked", done, { once: true });
    if (signal) signal.addEventListener("abort", stop, { once: true });
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

function clearGrabSrc(video) {
  if (!video) return;
  video.removeAttribute("src");
  try { video.load(); } catch { /* already idle */ }
}

// One frame at about 0.1s. Any failure is null so the upload still goes out.
export async function captureVideoPoster(source, options) {
  if (typeof document === "undefined") return null;
  const signal = options && options.signal;
  if (signal && signal.aborted) return null;
  const at = options && options.at >= 0 ? options.at : THUMB_AT_S;
  const maxEdge = options && options.maxEdge > 0 ? options.maxEdge : THUMB_EDGE;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = options && options.preload === "metadata" ? "metadata" : "auto";
  let url = "";
  let timer = 0;
  let failLoad = null;
  const onAbort = () => {
    clearGrabSrc(video);
    if (failLoad) failLoad(new Error("abort"));
  };
  if (signal) signal.addEventListener("abort", onAbort);
  try {
    if (typeof source === "string") url = source;
    else if (source) url = URL.createObjectURL(source);
    if (!url) return null;
    const remote = typeof source === "string";
    await new Promise((resolve, reject) => {
      failLoad = reject;
      const fail = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      timer = setTimeout(() => fail(new Error("timeout")), 8000);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => fail(new Error("decode"));
      if (signal && signal.aborted) {
        fail(new Error("abort"));
        return;
      }
      if (remote) video.crossOrigin = "anonymous";
      video.src = url;
    });
    failLoad = null;
    const dur = video.duration;
    const when = Number.isFinite(dur) && dur > 0 ? Math.min(at, Math.max(0, dur - 0.04)) : 0;
    await seekTo(video, when, signal);
    const box = fitThumb(video.videoWidth, video.videoHeight, maxEdge);
    if (!box.width || !box.height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = box.width;
    canvas.height = box.height;
    canvas.getContext("2d").drawImage(video, 0, 0, box.width, box.height);
    const file = await jpegFile(canvas, "poster.jpg");
    if (signal && signal.aborted) return null;
    return file;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    failLoad = null;
    if (signal) signal.removeEventListener("abort", onAbort);
    clearGrabSrc(video);
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

function cancelFrameGrab(job) {
  if (!job || job.dead) return;
  job.dead = true;
  const at = grabQueue.indexOf(job);
  if (at >= 0) grabQueue.splice(at, 1);
  if (job.controller) job.controller.abort();
}

function pumpFrameGrabs() {
  while (grabsBusy < VIEWER_GRAB_LIMIT && grabQueue.length) {
    const job = grabQueue.shift();
    if (!job || job.dead) continue;
    grabsBusy += 1;
    const controller = new AbortController();
    job.controller = controller;
    captureVideoPoster(job.raw, {
      maxEdge: VIEWER_GRAB_EDGE,
      preload: "metadata",
      signal: controller.signal,
    }).then((file) => {
      if (job.dead || !file || job.video.getAttribute("poster")) return;
      const blob = URL.createObjectURL(file);
      rememberVideoFrame(job.raw, blob);
      if (job.video.isConnected) applyPoster(job.video, blob);
      if (job.video.getAttribute("poster")) job.watch.disconnect();
    }).catch(() => {}).finally(() => {
      grabsBusy -= 1;
      job.controller = null;
      if (job.owner.current === job) job.owner.current = null;
      pumpFrameGrabs();
    });
  }
}

function armFrameGrab(video, raw) {
  if (!isVideoUrl(raw) || typeof IntersectionObserver !== "function") return;
  const owner = { current: null };
  const watch = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) {
      cancelFrameGrab(owner.current);
      owner.current = null;
      return;
    }
    if (owner.current) return;
    if (video.getAttribute("poster")) {
      watch.disconnect();
      return;
    }
    const again = cachedVideoFrame(raw);
    if (again) {
      applyPoster(video, again);
      watch.disconnect();
      return;
    }
    const job = { video, raw, dead: false, controller: null, owner, watch };
    owner.current = job;
    grabQueue.push(job);
    pumpFrameGrabs();
  }, { rootMargin: "15%" });
  watch.observe(video);
}

// Poster image only until the viewer plays. A sibling still is used when
// it loads. A miss is grabbed near the viewport, two at a time, and kept
// in memory. Leaving the viewport drops that grab. It is never uploaded.
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
