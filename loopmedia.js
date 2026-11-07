// Pictures go through here before they are painted. Where a post is read
// (feed cards, popups, chat, the fullscreen viewer: presentImage with
// play) a GIF is a normal <img> and the browser animates it. Everywhere
// else (avatars, marker dots) and with reduced motion, a GIF is a canvas
// of frame 0. A GIF uploaded through this app is already a muted clip
// (gifvideo.js); nothing is converted while viewing.
import { GIF_FAR_PX, loopPlayback, viewDistance } from "./gifloop.js";
import { gifStillCanvas } from "./gifvideo.js";
import { armIpfsAttempt, preferGateway } from "./ipfsimage.js";
import { forgetProfilePicture, watchProfilePicture } from "./markertilt.js";
import {
  classifyImageUrl,
  isGifClipUrl,
  isGifUrl,
  loadImageBytes,
  needsGifCheck,
  readGifCache,
  resolveMediaUrl,
} from "./mediaurl.js";
import { bindVideoPoster } from "./videoposter.js";

export { GIF_FAR_PX, loopPlayback, viewDistance };

const watching = new Set();
let observer = null;
let gifObserver = null;
let visibilityBound = false;

function reducedMotion() {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function viewportBox() {
  const w = typeof window !== "undefined" ? window.innerWidth : 0;
  const h = typeof window !== "undefined" ? window.innerHeight : 0;
  return { top: 0, left: 0, right: w, bottom: h };
}

function pauseLoop(video) {
  if (!video || video.paused) return;
  try { video.pause(); } catch { /* already idle */ }
}

function playLoop(video) {
  if (!video || !video.isConnected || document.hidden) return;
  if (reducedMotion()) return;
  if (video.dataset.loopOn === "0") return;
  if (!video.getAttribute("src")) {
    const src = video.dataset.src || "";
    if (!src) return;
    video.preload = "auto";
    video.src = src;
  }
  if (video.paused) video.play().catch(() => {});
}

function unloadLoop(video) {
  pauseLoop(video);
  const src = video.getAttribute("src");
  if (!src) return;
  const keep = video.dataset.src || src;
  const poster = video.getAttribute("poster");
  video.removeAttribute("src");
  video.preload = "none";
  try { video.load(); } catch { /* already idle */ }
  if (keep) video.dataset.src = keep;
  if (poster) video.setAttribute("poster", poster);
}

function applyLoop(video, visible, distance) {
  const action = loopPlayback({ reduced: reducedMotion(), visible, distance });
  if (action === "play") playLoop(video);
  else if (action === "unload" || action === "poster") unloadLoop(video);
  else pauseLoop(video);
}

function ensureLoops() {
  if (!visibilityBound && typeof document !== "undefined") {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      for (const video of watching) {
        if (reducedMotion()) unloadLoop(video);
        else if (document.hidden) pauseLoop(video);
        else if (video.dataset.loopOn === "1") playLoop(video);
      }
    });
  }
  if (!observer && typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const video = entry.target;
        const visible = !!(entry.isIntersecting && entry.intersectionRatio > 0);
        video.dataset.loopOn = visible ? "1" : "0";
        const distance = visible ? 0 : viewDistance(entry.boundingClientRect, entry.rootBounds || viewportBox());
        applyLoop(video, visible, distance);
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
  watching.add(video);
  if (observer) {
    if (!video.dataset.loopOn) video.dataset.loopOn = "0";
    observer.observe(video);
    return video;
  }
  video.dataset.loopOn = "1";
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
  while (prev && prev.classList && prev.classList.contains("media-still")) {
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

function showStill(img, canvas) {
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
    img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  img.dispatchEvent(new Event("load"));
}

// Frame 0 drawn from a plain image load. A canvas draw of an animated
// image takes a single frame. A host without CORS taints the canvas,
// which only stops reading it back; it still shows.
function elementStill(url) {
  return new Promise((resolve) => {
    if (!url || typeof Image !== "function") {
      resolve(null);
      return;
    }
    const probe = new Image();
    probe.decoding = "async";
    probe.onload = () => {
      const w = probe.naturalWidth;
      const h = probe.naturalHeight;
      if (!w || !h) {
        resolve(null);
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(probe, 0, 0);
        resolve(canvas);
      } catch {
        resolve(null);
      }
    };
    probe.onerror = () => resolve(null);
    probe.src = url;
  });
}

async function paintGifStill(img, url, seq) {
  let canvas = null;
  try {
    const buf = await loadImageBytes(url);
    if (img.dataset.mediaSeq !== String(seq)) return;
    canvas = await gifStillCanvas(new File([buf], "frame.gif", { type: "image/gif" }));
  } catch {
    canvas = null;
  }
  if (img.dataset.mediaSeq !== String(seq)) return;
  // No bytes: the host does not allow the read, or the file is past 15 MB,
  // or the decoder gave up. The browser can still load the picture, and a
  // canvas copy of it is one frame, so it stays still.
  if (!canvas) canvas = await elementStill(url);
  if (img.dataset.mediaSeq !== String(seq)) return;
  if (!canvas) {
    // The browser cannot load it either (gone, or a gateway that is down).
    // Show the address as a normal picture instead of leaving the skeleton:
    // the img retries the gateways and fires its own error at the end,
    // which armFallback answers.
    dropStill(img);
    assignSrc(img, url);
    return;
  }
  if (!img.parentNode) {
    requestAnimationFrame(() => {
      if (img.dataset.mediaSeq !== String(seq) || !img.parentNode) return;
      showStill(img, canvas);
    });
    return;
  }
  showStill(img, canvas);
}

// The body loads once the element is on screen, then the element is done.
function onGifEntry(entry) {
  const img = entry.target;
  if (!entry.isIntersecting || entry.intersectionRatio <= 0) return;
  if (gifObserver) gifObserver.unobserve(img);
  if (img.dataset.gifArmed === "1") return;
  img.dataset.gifArmed = "1";
  paintGifStill(img, img.dataset.mediaUrl || "", img.dataset.mediaSeq);
}

function ensureGifObserver() {
  if (gifObserver || typeof IntersectionObserver !== "function") return gifObserver;
  gifObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) onGifEntry(entry);
  }, { threshold: [0, 0.01] });
  return gifObserver;
}

// The body stays unloaded until the still is on screen. A new address on
// the same element arms it again.
function armGifLoad(img) {
  delete img.dataset.gifArmed;
  const watch = ensureGifObserver();
  if (!watch) {
    paintGifStill(img, img.dataset.mediaUrl || "", img.dataset.mediaSeq);
    return;
  }
  watch.observe(img);
}

// The one paint path for a user image. A known still extension is set
// immediately, and so is anything where a post is read (options.play):
// there a GIF simply animates as a normal picture, unless reduced motion
// is on. Elsewhere an address that may be a GIF stays on the skeleton
// until classifyImageUrl answers, and a GIF becomes a canvas of frame 0.
// null (the check failed, was blocked, the device is offline, or the host
// was too slow) paints the address as a normal image and is not cached.
export function presentImage(img, url, options) {
  if (!img) return img;
  const opts = options || {};
  const raw = typeof url === "string" ? url.trim() : "";
  const painted = raw ? (preferGateway(raw) || raw) : "";
  const seq = (Number(img.dataset.mediaSeq) || 0) + 1;
  img.dataset.mediaSeq = String(seq);
  img.dataset.mediaUrl = painted;
  if (!painted) {
    clearPending(img);
    dropStill(img);
    img.removeAttribute("src");
    return img;
  }
  if (!needsGifCheck(painted) || (opts.play && !reducedMotion())) {
    dropStill(img);
    assignSrc(img, painted);
    return img;
  }
  const cached = isGifUrl(painted) ? true : readGifCache(painted);
  if (cached === false) {
    dropStill(img);
    assignSrc(img, painted);
    return img;
  }
  markPending(img);
  dropStill(img);
  if (cached === true) {
    armGifLoad(img);
    return img;
  }
  classifyImageUrl(painted).then((isGif) => {
    if (img.dataset.mediaSeq !== String(seq)) return;
    if (isGif === true) {
      armGifLoad(img);
      return;
    }
    dropStill(img);
    assignSrc(img, painted);
  }, () => {
    if (img.dataset.mediaSeq !== String(seq)) return;
    dropStill(img);
    assignSrc(img, painted);
  });
  return img;
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
  video.dataset.src = resolved.src;
  const clip = opts.gif === true || isGifClipUrl(url) || isGifClipUrl(resolved.src);
  if (clip) video.dataset.gif = "1";
  if (opts.fallback) video.dataset.fallback = opts.fallback;
  armFallback(video, opts.fallback || "");
  if (clip) {
    bindVideoPoster(video, typeof url === "string" ? url : resolved.src, opts.posterHint || null);
    if (!reducedMotion()) watchLoop(video);
    return video;
  }
  if (opts.posterHold) {
    bindVideoPoster(video, typeof url === "string" ? url : resolved.src, opts.posterHint || null);
    return video;
  }
  if (resolved.poster) video.poster = resolved.poster;
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
