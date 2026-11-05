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
const EAGER_GRAB_MAX = 2;

// Newest last. A dropped still revokes its blob URL. A poster a connected
// video still shows stays in the map until that video lets go of it.
const frameCache = new Map();
const retainedFrames = new Set();
const grabQueue = [];
let grabsBusy = 0;
let eagerUsed = 0;

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

function frameUrlInUse(blobUrl) {
  if (!blobUrl || typeof document === "undefined" || typeof document.querySelectorAll !== "function") return false;
  try {
    const nodes = document.querySelectorAll("video[poster]");
    if (!nodes) return false;
    for (const video of nodes) {
      if (!video || video.isConnected === false) continue;
      const attr = typeof video.getAttribute === "function" ? video.getAttribute("poster") || "" : "";
      const prop = typeof video.poster === "string" ? video.poster : "";
      if (attr === blobUrl || prop === blobUrl) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function revokeFrameUrl(blobUrl) {
  if (!blobUrl || frameUrlInUse(blobUrl)) return false;
  try { URL.revokeObjectURL(blobUrl); } catch { /* already revoked */ }
  retainedFrames.delete(blobUrl);
  return true;
}

function releaseRetainedFrames() {
  for (const blobUrl of [...retainedFrames]) revokeFrameUrl(blobUrl);
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
    if (prev !== blobUrl && !revokeFrameUrl(prev)) retainedFrames.add(prev);
  }
  frameCache.set(key, blobUrl);
  retainedFrames.delete(blobUrl);
  for (const old of [...frameCache.keys()]) {
    if (frameCache.size <= FRAME_CACHE_MAX) break;
    if (old === key) continue;
    const dropped = frameCache.get(old);
    if (frameUrlInUse(dropped)) continue;
    frameCache.delete(old);
    revokeFrameUrl(dropped);
  }
  releaseRetainedFrames();
  return blobUrl;
}

export function resetVideoFrames() {
  eagerUsed = 0;
  for (const [key, blobUrl] of [...frameCache]) {
    if (frameUrlInUse(blobUrl)) continue;
    frameCache.delete(key);
    revokeFrameUrl(blobUrl);
  }
  releaseRetainedFrames();
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

function hidePlayFace(video) {
  const parent = video && video.parentElement;
  if (!parent || typeof parent.querySelector !== "function") return;
  const btn = parent.querySelector(":scope > .video-play");
  if (btn) btn.hidden = true;
}

function revealControls(video) {
  if (!video) return;
  if (video.dataset && video.dataset.controlsWanted === "1") video.controls = true;
  hidePlayFace(video);
}

// The centred picture is the native control overlay on a poster with no
// source. Take those controls off and show one play button. Playback puts
// the native bar back.
function queuePlayFace(video) {
  if (!video || !video.dataset || video.dataset.controlsWanted !== "1") return;
  const mount = () => {
    if (video.isConnected === false || !video.parentElement) return;
    if (typeof video.getAttribute === "function" && video.getAttribute("src")) {
      revealControls(video);
      return;
    }
    // A later binder (the feed card) can turn controls back on in the same
    // turn. The overlay is the broken picture, so they stay off until play.
    video.controls = false;
    const parent = video.parentElement;
    if (!parent || typeof parent.querySelector !== "function") return;
    let btn = parent.querySelector(":scope > .video-play");
    if (!btn && typeof document !== "undefined" && typeof document.createElement === "function") {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "video-play";
      btn.setAttribute("aria-label", "Play");
      btn.innerHTML = '<span class="video-play-glass" aria-hidden="true">'
        + '<svg class="video-play-icon" viewBox="0 0 24 24" focusable="false">'
        + '<path class="is-play" d="M9 6.2v11.6l9.2-5.8z" fill="#22D3EE"></path>'
        + '<path class="is-pause" d="M7 5.5h3.2v13H7zm6.8 0H17v13h-3.2z" fill="#22D3EE"></path>'
        + '</svg></span>';
      parent.appendChild(btn);
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pending = typeof video.play === "function" ? video.play() : null;
        if (pending && typeof pending.catch === "function") pending.catch(() => {});
      });
    }
    if (btn) btn.hidden = false;
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(mount);
  else mount();
}

// One hook for every surface. A poster, or the first decoded frame, drops
// the centred broken-image overlay and shows the play button.
export function showVideoFace(video) {
  if (!video) return;
  // A GIF clip plays itself. The glass play button stays on real videos.
  if (video.dataset && video.dataset.gif === "1") {
    const posted = (typeof video.getAttribute === "function" && video.getAttribute("poster"))
      || (typeof video.poster === "string" && video.poster)
      || Number(video.readyState) >= 2;
    if (posted && video.classList && typeof video.classList.add === "function") video.classList.add("has-poster");
    return;
  }
  const attr = typeof video.getAttribute === "function" ? video.getAttribute("poster") || "" : "";
  const prop = typeof video.poster === "string" ? video.poster : "";
  const loaded = Number(video.readyState) >= 2;
  if (!attr && !prop && !loaded) return;
  if (video.classList && typeof video.classList.add === "function") video.classList.add("has-poster");
  const hasSrc = typeof video.getAttribute === "function" && video.getAttribute("src");
  if (hasSrc) {
    revealControls(video);
    return;
  }
  if (video.controls) {
    if (video.dataset) video.dataset.controlsWanted = "1";
    video.controls = false;
  }
  queuePlayFace(video);
}

export function watchVideoFace(video) {
  if (!video) return video;
  if (video.dataset && video.dataset.faceWatch === "1") {
    showVideoFace(video);
    return video;
  }
  if (video.dataset) video.dataset.faceWatch = "1";
  showVideoFace(video);
  if (typeof video.addEventListener === "function") {
    video.addEventListener("loadeddata", () => showVideoFace(video));
  }
  return video;
}

function applyPoster(video, poster) {
  if (!video || !poster) return;
  video.poster = poster;
  showVideoFace(video);
  if (typeof Image !== "function") return;
  const probe = new Image();
  probe.onload = () => pinBox(video, probe.naturalWidth, probe.naturalHeight);
  probe.src = poster;
}

// Copies dataset.src onto the element before a play. Already-set src stays.
export function assignDeferredSrc(video) {
  if (!video) return false;
  const src = video.dataset && typeof video.dataset.src === "string" ? video.dataset.src : "";
  if (!src) return false;
  if (typeof video.getAttribute === "function" && video.getAttribute("src")) return false;
  video.src = src;
  return true;
}

const PLAY_KEYS = new Set([" ", "Enter", "MediaPlayPause"]);

function isPlayKey(event) {
  if (!event) return false;
  if (PLAY_KEYS.has(event.key)) return true;
  return event.code === "Space";
}

function nativePlay(video) {
  const fn = video && video.__posterPlay;
  if (typeof fn !== "function") return undefined;
  return fn.call(video);
}

function playFromDataset(video) {
  assignDeferredSrc(video);
  revealControls(video);
  let pending;
  try {
    pending = nativePlay(video);
  } catch (err) {
    return Promise.reject(err);
  }
  if (!pending || typeof pending.catch !== "function") return pending;
  return pending.catch((err) => {
    if (!assignDeferredSrc(video)) return Promise.reject(err);
    try {
      const again = nativePlay(video);
      if (again && typeof again.catch === "function") return again.catch(() => {});
      return again;
    } catch (err2) {
      return Promise.reject(err2);
    }
  });
}

// Pointer and keyboard set src before the native control plays. A tap that
// is still paused after that control runs starts playback, and the rejection
// is caught. holdSrc leaves the gesture to the caller (chat opens a preview).
function armDeferredPlay(video, holdSrc) {
  if (!video || (video.dataset && video.dataset.posterArmed === "1")) return;
  if (video.dataset) video.dataset.posterArmed = "1";
  if (typeof video.play === "function" && !video.__posterPlay) {
    video.__posterPlay = video.play.bind(video);
    video.play = function playWithSrc() {
      return playFromDataset(video);
    };
  }
  if (holdSrc || typeof video.addEventListener !== "function") return;
  // primed is only the gesture that first copied dataset.src. A later tap
  // is the native control's own play or pause, so it must not start again.
  let primed = false;
  const prime = (event) => {
    if (event && event.type === "keydown" && !isPlayKey(event)) return;
    primed = assignDeferredSrc(video);
  };
  const finish = (event) => {
    if (event && (event.type === "keyup" || event.type === "keydown") && !isPlayKey(event)) return;
    if (!primed) return;
    primed = false;
    if (video.paused === false) return;
    const pending = playFromDataset(video);
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  };
  video.addEventListener("pointerdown", prime, true);
  video.addEventListener("keydown", prime, true);
  video.addEventListener("click", finish);
  video.addEventListener("keyup", finish);
  video.addEventListener("play", () => {
    if (!assignDeferredSrc(video)) return;
    try {
      const pending = nativePlay(video);
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch {
      /* the control already reported the failure */
    }
  });
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
      if (job.video.getAttribute("poster") && job.watch && typeof job.watch.disconnect === "function") job.watch.disconnect();
    }).catch(() => {}).finally(() => {
      grabsBusy -= 1;
      job.controller = null;
      if (job.owner.current === job) job.owner.current = null;
      pumpFrameGrabs();
    });
  }
}

function videoShown(video) {
  if (!video || video.isConnected === false) return false;
  if (typeof video.getBoundingClientRect !== "function") return false;
  let box = null;
  try { box = video.getBoundingClientRect(); } catch { return false; }
  if (!box || !(box.width > 0) || !(box.height > 0)) return false;
  const w = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 0;
  const h = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 0;
  if (!w || !h) return false;
  return box.bottom > 0 && box.right > 0 && box.top < h && box.left < w;
}

function beginGrab(video, raw, owner, watch) {
  if (!owner || owner.current) return "";
  if (typeof video.getAttribute === "function" && video.getAttribute("poster")) {
    if (watch && typeof watch.disconnect === "function") watch.disconnect();
    return "";
  }
  const again = cachedVideoFrame(raw);
  if (again) {
    applyPoster(video, again);
    if (watch && typeof watch.disconnect === "function") watch.disconnect();
    return "cached";
  }
  const job = { video, raw, dead: false, controller: null, owner, watch };
  owner.current = job;
  grabQueue.push(job);
  pumpFrameGrabs();
  return "grab";
}

function onFrame(fn) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
  else queueMicrotask(fn);
}

// The first two videos already on screen start on the render frame.
// The rest still wait until the observer says they are near the viewport.
function eagerKick(video, raw, owner, watch, attempt) {
  if (eagerUsed >= EAGER_GRAB_MAX) return;
  onFrame(() => {
    if (eagerUsed >= EAGER_GRAB_MAX || owner.current) return;
    if (typeof video.getAttribute === "function" && video.getAttribute("poster")) return;
    if (video.isConnected === false) {
      if (attempt < 3) eagerKick(video, raw, owner, watch, attempt + 1);
      return;
    }
    if (!videoShown(video)) {
      let box = null;
      if (typeof video.getBoundingClientRect === "function") {
        try { box = video.getBoundingClientRect(); } catch { box = null; }
      }
      if (attempt < 3 && box && !(box.width > 0)) eagerKick(video, raw, owner, watch, attempt + 1);
      return;
    }
    if (beginGrab(video, raw, owner, watch) === "grab") eagerUsed += 1;
  });
}

function armFrameGrab(video, raw) {
  if (!isVideoUrl(raw)) return;
  const owner = { current: null };
  let watch = null;
  if (typeof IntersectionObserver === "function") {
    watch = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        cancelFrameGrab(owner.current);
        owner.current = null;
        return;
      }
      beginGrab(video, raw, owner, watch);
    }, { rootMargin: "15%" });
    watch.observe(video);
  }
  eagerKick(video, raw, owner, watch, 0);
}

// Poster image only until the viewer plays. A sibling still is used when
// it loads. A miss is grabbed near the viewport, two at a time, and kept
// in memory. The first two already on screen start on the render frame.
// Leaving the viewport drops that grab. It is never uploaded.
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
  watchVideoFace(video);
  armDeferredPlay(video, !!(hint && hint.holdSrc));
  return video;
}
