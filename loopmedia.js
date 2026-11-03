// Small stand-in for a GIF: muted, looping, plays only while on screen,
// and pauses when the tab is in the background. Stills stay an img.
import { resolveMediaUrl } from "./mediaurl.js";

const watching = new Set();
let observer = null;
let visibilityBound = false;

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

function armFallback(el, fallback) {
  if (!fallback) return;
  el.addEventListener("error", () => {
    const current = el.getAttribute("src") || "";
    if (current && current !== fallback) {
      if (el.tagName === "VIDEO") {
        forgetLoop(el);
        el.poster = "";
        el.removeAttribute("src");
        const img = document.createElement("img");
        img.className = String(el.className || "").replace(/\bloop-face\b/g, "").trim();
        img.alt = el.getAttribute("aria-label") || "";
        if (el.id) img.id = el.id;
        if (el.getAttribute("style")) img.setAttribute("style", el.getAttribute("style"));
        img.src = fallback;
        if (el.parentNode) el.replaceWith(img);
        return;
      }
      el.src = fallback;
    }
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
  if (resolved.src) img.src = resolved.src;
  return img;
}

// Swap an existing img or video so a GIF address becomes a loop and a
// still stays an image. The replacement keeps id, class, and style.
export function mountPicture(el, url, options) {
  if (!el) return el;
  const opts = options || {};
  const resolved = resolveMediaUrl(url);
  const className = opts.className || el.className || "";
  const style = opts.style || el.getAttribute("style") || "";
  const alt = opts.alt || el.getAttribute("alt") || el.getAttribute("aria-label") || "";
  const fallback = opts.fallback || el.dataset.fallback || "";
  if (resolved.kind === "video") {
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
  if (el.tagName === "VIDEO") {
    const img = document.createElement("img");
    img.className = className.replace(/\bloop-face\b/g, "").trim();
    img.alt = alt;
    if (el.id) img.id = el.id;
    if (style) img.setAttribute("style", style);
    img.decoding = "async";
    armFallback(img, fallback);
    if (resolved.src) img.src = resolved.src;
    forgetLoop(el);
    if (el.parentNode) el.replaceWith(img);
    return img;
  }
  if (className) el.className = className;
  if (resolved.src && el.getAttribute("src") !== resolved.src) el.src = resolved.src;
  return el;
}
