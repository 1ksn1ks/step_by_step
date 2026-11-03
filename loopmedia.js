// Pictures go through classifyImageUrl before they are painted. A GIF is
// a canvas of frame 0, never an <img> src. Feed and popup taps can play
// that GIF through gifvideo.js in memory: muted, looping, one at a time.
// Marker dots, avatars, and polygon covers stay on the still.
import { gifStillCanvas, convertGifFile } from "./gifvideo.js";
import { armIpfsAttempt, preferGateway } from "./ipfsimage.js";
import { forgetProfilePicture, watchProfilePicture } from "./markertilt.js";
import {
  classifyImageUrl,
  isGifUrl,
  loadImageBytes,
  needsGifCheck,
  readGifCache,
  resolveMediaUrl,
} from "./mediaurl.js";

const watching = new Set();
let observer = null;
let visibilityBound = false;
let playSeq = 0;
let activePlay = null;
const videoUrlCache = new Map();

function pauseLoop(video) {
  if (!video || video.paused) return;
  try { video.pause(); } catch { /* already idle */ }
}

function playLoop(video) {
  if (!video || !video.isConnected || document.hidden) return;
  if (video.dataset.loopOn === "0") return;
  if (!video.getAttribute("src")) {
    const src = video.dataset.src || "";
    if (!src) return;
    video.preload = "auto";
    video.src = src;
  }
  if (video.paused) video.play().catch(() => {});
}

function ensureLoops() {
  if (!visibilityBound && typeof document !== "undefined") {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      for (const video of watching) {
        if (document.hidden) pauseLoop(video);
        else playLoop(video);
      }
    });
  }
  if (!observer && typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const video = entry.target;
        video.dataset.loopOn = entry.isIntersecting && entry.intersectionRatio > 0 ? "1" : "0";
        if (video.dataset.loopOn === "1") playLoop(video);
        else pauseLoop(video);
      }
    }, { threshold: [0, 0.15] });
  }
}

export async function stillObjectUrl(file) {
  if (!file || typeof createImageBitmap !== "function") return "";
  let bmp = null;
  try {
    bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width || 1;
    canvas.height = bmp.height || 1;
    canvas.getContext("2d").drawImage(bmp, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? URL.createObjectURL(blob) : "";
  } catch {
    return "";
  } finally {
    if (bmp && bmp.close) bmp.close();
  }
}

export function watchLoop(video) {
  if (!video) return video;
  ensureLoops();
  if (!video.dataset.loopOn) video.dataset.loopOn = "1";
  watching.add(video);
  if (observer) observer.observe(video);
  playLoop(video);
  return video;
}

export function forgetLoop(video) {
  if (!video) return;
  watching.delete(video);
  if (observer) observer.unobserve(video);
  pauseLoop(video);
}

function clearPending(img) {
  if (!img || !img.classList) return;
  img.classList.remove("is-media-pending");
  const card = img.closest && img.closest(".popup-media-card");
  if (card) card.classList.remove("is-media-pending");
}

function markPending(img) {
  img.classList.add("is-media-pending");
  img.removeAttribute("src");
  const card = img.closest && img.closest(".popup-media-card");
  if (card) card.classList.add("is-media-pending");
}

function assignSrc(img, url) {
  clearPending(img);
  const next = preferGateway(url) || url;
  if (img.getAttribute("src") !== next) img.src = next;
  if (img.isConnected) armIpfsAttempt(img);
}

function dropStill(img) {
  let prev = img.previousElementSibling;
  while (prev && prev.classList && (prev.classList.contains("media-still") || prev.classList.contains("media-gif-play"))) {
    const older = prev.previousElementSibling;
    prev.remove();
    prev = older;
  }
  img.classList.remove("is-gif-hit");
  delete img.dataset.mediaGif;
}

function armFallback(el, fallback) {
  if (!fallback) return;
  el.addEventListener("error", () => {
    if (el.dataset.fallbackTried === "1") return;
    const current = el.getAttribute("src") || "";
    if (current === fallback) return;
    const gifMiss = !current && (el.classList.contains("is-media-pending") || el.dataset.mediaGif === "1");
    if (!current && !gifMiss) return;
    el.dataset.fallbackTried = "1";
    if (el.tagName === "VIDEO") {
      forgetLoop(el);
      el.poster = "";
      el.removeAttribute("src");
      const img = document.createElement("img");
      img.className = String(el.className || "").replace(/\bloop-face\b/g, "").trim();
      img.alt = el.getAttribute("aria-label") || "";
      if (el.id) img.id = el.id;
      if (el.getAttribute("style")) img.setAttribute("style", el.getAttribute("style"));
      presentImage(img, fallback);
      if (el.parentNode) el.replaceWith(img);
      return;
    }
    clearPending(el);
    presentImage(el, fallback);
  });
}

function stillOf(img) {
  const prev = img.previousElementSibling;
  if (prev && prev.classList && prev.classList.contains("media-still")) return prev;
  return null;
}

function showStill(img, canvas, play) {
  if (!img.parentNode) return;
  clearPending(img);
  dropStill(img);
  canvas.classList.add("media-still");
  canvas.setAttribute("aria-hidden", "true");
  const parent = img.parentElement;
  const wrapped = parent && parent.classList.contains("early-hashinal");
  if (img.getAttribute("style")) canvas.setAttribute("style", img.getAttribute("style"));
  if (wrapped) {
    canvas.style.display = "block";
    if (!canvas.style.width) canvas.style.width = "100%";
    if (!canvas.style.height) canvas.style.height = "100%";
    if (!canvas.style.objectFit) canvas.style.objectFit = "cover";
    if (!canvas.style.borderRadius) canvas.style.borderRadius = "50%";
  }
  if (img.className) {
    const extra = String(img.className).replace(/\bis-media-pending\b/g, "").replace(/\bis-gif-hit\b/g, "").trim();
    if (extra) canvas.className = (extra + " media-still").trim();
  }
  parent.insertBefore(canvas, img);
  img.classList.add("is-gif-hit");
  img.removeAttribute("src");
  img.dataset.mediaGif = "1";
  if (play) img.dataset.mediaPlay = "1";
  else delete img.dataset.mediaPlay;
  const profile = img.closest && img.closest(".popup-profile-bubble, .profile-live-bubble");
  if (profile) {
    if (img.dataset.earlyAccount) canvas.dataset.earlyAccount = img.dataset.earlyAccount;
    forgetProfilePicture(img);
    watchProfilePicture(canvas);
  }
  canvas.addEventListener("pointerenter", () => img.dispatchEvent(new Event("pointerenter")));
  canvas.addEventListener("pointerdown", () => img.dispatchEvent(new Event("pointerdown")));
  canvas.addEventListener("click", (event) => {
    event.stopPropagation();
    if (img.dataset.mediaPlay === "1") {
      playStoredGif(img);
      return;
    }
    img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  img.dispatchEvent(new Event("load"));
}

async function paintGifStill(img, url, seq, play) {
  let canvas = null;
  try {
    const buf = await loadImageBytes(url);
    if (img.dataset.mediaSeq !== String(seq)) return;
    canvas = await gifStillCanvas(new File([buf], "frame.gif", { type: "image/gif" }));
  } catch {
    canvas = null;
  }
  if (img.dataset.mediaSeq !== String(seq)) return;
  if (!canvas) {
    img.dispatchEvent(new Event("error"));
    return;
  }
  if (!img.parentNode) {
    requestAnimationFrame(() => {
      if (img.dataset.mediaSeq !== String(seq) || !img.parentNode) return;
      showStill(img, canvas, play);
    });
    return;
  }
  showStill(img, canvas, play);
}

// The one paint path for a user image. A known still extension is set
// immediately. Anything else stays on the skeleton until classifyImageUrl
// answers. A GIF becomes a canvas of frame 0.
export function presentImage(img, url, options) {
  if (!img) return img;
  const opts = options || {};
  const raw = typeof url === "string" ? url.trim() : "";
  const painted = raw ? (preferGateway(raw) || raw) : "";
  const seq = (Number(img.dataset.mediaSeq) || 0) + 1;
  img.dataset.mediaSeq = String(seq);
  img.dataset.mediaUrl = painted;
  if (activePlay && activePlay.img === img) stopGifPlay();
  if (!painted) {
    clearPending(img);
    dropStill(img);
    img.removeAttribute("src");
    return img;
  }
  const knownStill = !needsGifCheck(painted);
  if (knownStill) {
    dropStill(img);
    delete img.dataset.mediaPlay;
    assignSrc(img, painted);
    return img;
  }
  const cached = isGifUrl(painted) ? true : readGifCache(painted);
  if (cached === false) {
    dropStill(img);
    delete img.dataset.mediaPlay;
    assignSrc(img, painted);
    return img;
  }
  markPending(img);
  dropStill(img);
  if (opts.play) img.dataset.mediaPlay = "1";
  else delete img.dataset.mediaPlay;
  if (cached === true) {
    paintGifStill(img, painted, seq, !!opts.play);
    return img;
  }
  classifyImageUrl(painted).then((isGif) => {
    if (img.dataset.mediaSeq !== String(seq)) return;
    if (isGif === false) {
      dropStill(img);
      assignSrc(img, painted);
      return;
    }
    if (isGif !== true) return;
    paintGifStill(img, painted, seq, !!opts.play);
  });
  return img;
}

function stopGifPlay() {
  const cur = activePlay;
  activePlay = null;
  if (!cur) return;
  if (cur.abort) cur.abort.abort();
  if (cur.video) {
    try { cur.video.pause(); } catch { /* already idle */ }
    cur.video.remove();
  }
  if (cur.canvas) cur.canvas.hidden = false;
}

function showGifVideo(img, objectUrl, seq) {
  if (!activePlay || activePlay.seq !== seq || !img.parentNode) return;
  const canvas = stillOf(img);
  const video = document.createElement("video");
  video.className = "loop-face media-gif-play";
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("loop", "");
  video.autoplay = true;
  video.src = objectUrl;
  video.addEventListener("click", (event) => {
    event.stopPropagation();
    playStoredGif(img);
  });
  img.parentNode.insertBefore(video, img);
  if (canvas) canvas.hidden = true;
  activePlay.video = video;
  activePlay.canvas = canvas;
  video.play().catch(() => {});
}

// In-memory playback for a feed or popup still. No upload. One at a time.
export function playStoredGif(img) {
  if (!img || img.dataset.mediaGif !== "1" || img.dataset.mediaPlay !== "1") return;
  if (activePlay && activePlay.img === img && activePlay.video) {
    stopGifPlay();
    return;
  }
  const url = img.dataset.mediaUrl || "";
  if (!url) return;
  if (videoUrlCache.get(url) === "") return;
  const seq = ++playSeq;
  stopGifPlay();
  const ctrl = new AbortController();
  activePlay = { img, url, abort: ctrl, video: null, canvas: stillOf(img), seq };
  const cached = videoUrlCache.get(url);
  if (cached) {
    showGifVideo(img, cached, seq);
    return;
  }
  loadImageBytes(url).then(async (buf) => {
    if (!activePlay || activePlay.seq !== seq) return;
    const file = new File([buf], "clip.gif", { type: "image/gif" });
    const out = await convertGifFile(file, { role: "media", signal: ctrl.signal });
    if (!activePlay || activePlay.seq !== seq) return;
    if (!out || !out.file || String(out.file.type || "").startsWith("image/")) {
      videoUrlCache.set(url, "");
      if (activePlay && activePlay.seq === seq) activePlay = null;
      return;
    }
    const objectUrl = URL.createObjectURL(out.file);
    videoUrlCache.set(url, objectUrl);
    showGifVideo(img, objectUrl, seq);
  }).catch((err) => {
    if (err && err.code === "GIF_CANCEL") return;
    if (activePlay && activePlay.seq === seq) stopGifPlay();
  });
}

export function makeLoopVideo(url, options) {
  const opts = options || {};
  const resolved = resolveMediaUrl(url);
  const video = document.createElement("video");
  const classes = [opts.className || "", "loop-face"].filter(Boolean).join(" ");
  video.className = classes;
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.loop = true;
  video.setAttribute("loop", "");
  video.preload = "none";
  video.setAttribute("aria-label", opts.alt || "");
  if (opts.style) video.setAttribute("style", opts.style);
  if (resolved.poster) video.poster = resolved.poster;
  video.dataset.src = resolved.src;
  if (opts.fallback) video.dataset.fallback = opts.fallback;
  armFallback(video, opts.fallback || "");
  watchLoop(video);
  return video;
}

function paintUserImage(img, url, options) {
  const raw = typeof url === "string" ? url.trim() : "";
  const resolved = resolveMediaUrl(raw);
  if (resolved.src) presentImage(img, resolved.src, options);
  else if (raw && (isGifUrl(raw) || needsGifCheck(raw))) presentImage(img, raw, options);
  else img.removeAttribute("src");
  return img;
}

export function pictureElement(url, options) {
  const opts = options || {};
  const resolved = resolveMediaUrl(url);
  if (resolved.kind === "video") return makeLoopVideo(url, opts);
  const img = document.createElement("img");
  if (opts.className) img.className = opts.className;
  img.alt = opts.alt || "";
  if (opts.style) img.setAttribute("style", opts.style);
  img.decoding = "async";
  armFallback(img, opts.fallback || "");
  paintUserImage(img, url, opts);
  return img;
}

// Swap an existing img or video. A GIF is a still canvas, not a src.
// The replacement keeps id, class, and style.
export function mountPicture(el, url, options) {
  if (!el) return el;
  const opts = options || {};
  const resolved = resolveMediaUrl(url);
  const raw = typeof url === "string" ? url.trim() : "";
  const className = opts.className || el.className || "";
  const style = opts.style || el.getAttribute("style") || "";
  const alt = opts.alt || el.getAttribute("alt") || el.getAttribute("aria-label") || "";
  const fallback = opts.fallback || el.dataset.fallback || "";
  if (resolved.kind === "video" && resolved.src) {
    if (el.tagName === "VIDEO") {
      if (className) el.className = className;
      if (!el.classList.contains("loop-face")) el.classList.add("loop-face");
      if (style) el.setAttribute("style", style);
      if (alt) el.setAttribute("aria-label", alt);
      if (resolved.poster) el.poster = resolved.poster;
      if (el.dataset.src !== resolved.src) {
        el.dataset.src = resolved.src;
        el.removeAttribute("src");
        el.preload = "none";
      }
      if (fallback) el.dataset.fallback = fallback;
      watchLoop(el);
      return el;
    }
    const video = makeLoopVideo(url, { className, alt, style, fallback });
    if (el.id) video.id = el.id;
    for (const key of Object.keys(el.dataset || {})) {
      if (key !== "src" && el.dataset[key] && !video.dataset[key]) video.dataset[key] = el.dataset[key];
    }
    if (el.parentNode) el.replaceWith(video);
    return video;
  }
  if (!resolved.src && !(raw && (isGifUrl(raw) || needsGifCheck(raw)))) {
    if (isGifUrl(url)) el.removeAttribute("src");
    return el;
  }
  if (el.tagName === "VIDEO") {
    const img = document.createElement("img");
    img.className = className.replace(/\bloop-face\b/g, "").trim();
    img.alt = alt;
    if (el.id) img.id = el.id;
    if (style) img.setAttribute("style", style);
    img.decoding = "async";
    armFallback(img, fallback);
    paintUserImage(img, raw, opts);
    forgetLoop(el);
    if (el.parentNode) el.replaceWith(img);
    return img;
  }
  if (className) el.className = className;
  paintUserImage(el, raw, opts);
  return el;
}
