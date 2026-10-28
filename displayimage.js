// Local display downscale + lazy media for inline stills: chat bubbles,
// feed cards, and the inside media of marker/polygon popups fetch their
// bytes only once the slot is about to paint — a card that never comes
// near the viewport costs nothing. The visible still is re-encoded to a
// bitmap capped to the slot, so decode and GPU cost drop. The R2 object
// stays one file, and fullscreen (openPreview) always gets the original
// https URL, kept in dataset.fullSrc.
//
//   attachDisplayImage(el, src, poster)  // owns el.src from the start
//   displayUrlFor(src, el)               // Promise<blob: url, or the original>
//
// Until the slot is eligible the element keeps NO src — just the
// placeholder box. Video and gif URLs pass through untouched (a gif must
// stay animated), but their download also starts at eligibility, not at
// build time. A slot that scrolls away before its fetch finishes is
// ignored — the result is never applied and an unclaimed blob is
// reclaimed, so the LRU never fills with off-screen blobs.
// Images that already fit the target are never upscaled. Every failure —
// CORS, decode, encode — falls back to the original URL. Results are
// cached by original URL; evicted blobs are revoked only once no <img>
// still shows them, the rest at pagehide.

const CACHE_CAP = 50;
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.85;
// Start a bit before the slot is on screen so the next card is ready.
const ARM_PX = 250;
const NOT_INLINE_STILL = /\.(gif|mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

const cache = new Map(); // original URL -> display URL (blob: or the original)
const inflight = new Map(); // original URL -> pending promise
const createdBlobs = new Set(); // blob: URLs this module made and has not revoked
// Registered slots, so a host (a popup being drawn) can force eligibility
// on a slot the observer never reported for.
const slots = new WeakMap(); // el → force()

// A popup card just painted: any still inside that is on screen starts
// now, even if the observer never fired for it (0×0 size at observe time,
// a node built while detached, or an open the observer missed).
export function forceDisplayEligibility(el) {
  const force = el && slots.get(el);
  if (force) force();
}

function trackBlob(url) {
  createdBlobs.add(url);
  return url;
}

function untrackBlob(url) {
  createdBlobs.delete(url);
}

// The marker popup hands over data.image raw — an array, the way the map
// features do — so a single-entry array is unwrapped before anything else.
function asUrl(value) {
  if (Array.isArray(value)) value = value[0];
  return typeof value === "string" ? value : "";
}

export function isInlineStill(url) {
  const src = asUrl(url);
  if (!src) return false;
  try {
    const u = new URL(src);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return !NOT_INLINE_STILL.test(u.pathname);
  } catch {
    return false;
  }
}

function cssRect(el) {
  const measure = (node) => {
    if (!node || typeof node.getBoundingClientRect !== "function") return null;
    const r = node.getBoundingClientRect();
    return r && (r.width > 1 || r.height > 1) ? r : null;
  };
  return measure(el) || measure(el && el.parentElement) || null;
}

// Longest edge the slot needs: device pixels of the laid-out box (the 360px
// floor keeps small slots crisp), capped at 1280. No layout yet — fixed cap.
function targetEdge(el) {
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const rect = cssRect(el);
  if (!rect) return MAX_EDGE;
  return Math.min(MAX_EDGE, Math.max(1, Math.floor(dpr * Math.max(rect.width, rect.height, 360))));
}

function hasAlpha(canvas) {
  try {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  } catch {
    return false;
  }
  return false;
}

function encodeCanvas(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), type, JPEG_QUALITY);
  });
}

async function decodeSource(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

async function buildDisplayUrl(src, el) {
  const res = await fetch(src, { mode: "cors" });
  if (!res.ok) throw new Error("fetch " + res.status);
  const blob = await res.blob();
  const bitmap = await decodeSource(blob);
  try {
    const w = bitmap.width || bitmap.naturalWidth || 0;
    const h = bitmap.height || bitmap.naturalHeight || 0;
    if (!w || !h) throw new Error("no native size");
    const cap = targetEdge(el);
    if (Math.max(w, h) <= cap) return src; // never upscale
    const scale = cap / Math.max(w, h);
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, tw, th);
    // JPEG has no alpha — a transparent png/webp would paint black.
    const mayHaveAlpha = /^(image\/png|image\/webp)$/.test(blob.type || "");
    const out = await encodeCanvas(canvas, mayHaveAlpha && hasAlpha(canvas) ? "image/png" : "image/jpeg");
    return trackBlob(URL.createObjectURL(out));
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

// A live <img> still pointing at the blob keeps it; pagehide reclaims it.
function stillShown(blobUrl) {
  try {
    return !!document.querySelector('img[src="' + blobUrl + '"]');
  } catch {
    return false;
  }
}

// LRU insert happens at apply time — a slot that scrolls away before its
// fetch lands never parks its blob in the cache. Eviction revokes a blob
// only once no <img> shows it.
export function rememberDisplay(src, display) {
  if (!src || display === src) return;
  cache.set(src, display);
  while (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    const url = cache.get(oldest);
    cache.delete(oldest);
    if (url.startsWith("blob:")) {
      if (!stillShown(url)) URL.revokeObjectURL(url);
      untrackBlob(url);
    }
  }
}

// Blob URLs this module created that no longer live in the cache and no
// <img> shows — i.e. leaked. Empty while everything is healthy.
export function leakedDisplayBlobs() {
  const kept = new Set([...cache.values()]);
  const out = [];
  for (const url of createdBlobs) {
    if (kept.has(url)) continue;
    if (stillShown(url)) continue;
    out.push(url);
  }
  return out;
}

// Job bookkeeping for one in-flight build. Consumers of the promise read
// it through `promise._job`:
//   claimed — some slot applied the result (it is in the LRU)
//   reaped  — the result landed while no slot wanted it; the blob was
//             revoked, and the promise's URL must never be applied
//   _display — the display URL the job resolved to (may be the original)
export function displayUrlFor(src, el) {
  if (!isInlineStill(src)) return Promise.resolve(asUrl(src) || src);
  src = asUrl(src);
  const hit = cache.get(src);
  if (hit) {
    cache.delete(src);
    cache.set(src, hit); // LRU touch
    return Promise.resolve(hit);
  }
  let job = inflight.get(src);
  if (!job) {
    const state = { claimed: false, reaped: false, _display: src };
    job = buildDisplayUrl(src, el)
      .then((display) => {
        state._display = display;
        if (display && display.startsWith("blob:")) {
          // Every consumer attached at settlement runs in microtasks, all
          // before this timer — so by now every slot that was eligible has
          // claimed (or refused) the result. An unclaimed blob is revoked
          // on the spot instead of leaking until pagehide.
          setTimeout(() => {
            if (!state.claimed) {
              state.reaped = true;
              URL.revokeObjectURL(display);
              untrackBlob(display);
            }
          }, 0);
        }
        return display;
      })
      .catch(() => src)
      .finally(() => inflight.delete(src));
    job._job = state;
    inflight.set(src, job);
  }
  return job;
}

// A job's result is unusable once it was reaped, or once the LRU dropped
// it and no <img> still shows the blob (eviction revoked it).
function jobDead(job, src) {
  const j = job && job._job;
  if (!j) return false;
  if (j.reaped) return true;
  if (j.claimed && !cache.has(src) && !stillShown(j._display || "")) return true;
  return false;
}

// Owns el.src: nothing is fetched until the slot is near the viewport,
// then a still is swapped for its downscaled blob and a gif/video gets its
// passthrough URL (video poster included). dataset.fullSrc keeps the
// original for fullscreen.
export function attachDisplayImage(el, src, poster) {
  if (!el || typeof el.setAttribute !== "function") return;
  src = asUrl(src);
  if (!src) return;
  try {
    const u = new URL(src);
    if (u.protocol !== "https:" && u.protocol !== "http:") return;
  } catch {
    return;
  }
  poster = asUrl(poster);
  const isStill = isInlineStill(src);
  el.dataset.fullSrc = src;
  el.classList.add("media-pending");

  const inView = () => {
    if (!el.isConnected) return false;
    let r = cssRect(el);
    if (!r) {
      // A pending still has no intrinsic size yet — a 0×0 img in a 0×0
      // card (e.g. --u unresolved, or a card that collapses before paint).
      // Judge by the nearest laid-out host: that is where the slot paints.
      const host = el.closest(".maplibregl-popup-content, .popup-sheet, .feed-card, .feed-comments-stage") || el.parentElement;
      r = cssRect(host);
      if (!r) return false;
    }
    // All four sides: a slot parked in a hidden side panel (or a test host
    // off the left edge) is not about to paint either.
    return (
      r.right > -ARM_PX &&
      r.left < window.innerWidth + ARM_PX &&
      r.top < window.innerHeight + ARM_PX &&
      r.bottom > -ARM_PX
    );
  };

  let done = false;
  let alive = false; // the slot is currently near the viewport
  let job = null;
  let attached = null; // the job whose result this slot is watching
  let io = null;
  let ticking = false;

  const finish = () => {
    if (done) return;
    done = true;
    el.classList.remove("media-pending");
    if (io) {
      io.disconnect();
      io = null;
    }
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
  };

  // Externally changed src (a re-render) wins — do not fight it.
  const srcTouched = () => {
    const current = el.getAttribute("src");
    return current !== null && current !== src;
  };

  const apply = () => {
    if (done || !el.isConnected) return;
    if (srcTouched()) {
      finish();
      return;
    }
    if (!isStill) {
      // gif / video — passthrough, but the download starts NOW, at
      // eligibility, not at build time.
      if (!inView()) return;
      el.src = src;
      if (poster) el.poster = poster;
      finish();
      return;
    }
    if (!alive) return;
    if (job && jobDead(job, src)) {
      // The previous result was reaped or evicted — start a fresh fetch.
      job = null;
      attached = null;
    }
    if (!job) job = displayUrlFor(src, el);
    if (attached === job) return;
    attached = job;
    job.then((display) => {
      if (done || !el.isConnected || !alive || srcTouched()) return;
      if (display === src) {
        el.src = display; // no-upscale or failure — the original URL
        finish();
        return;
      }
      if (display.startsWith("blob:")) {
        const j = job._job;
        if (j && !j.claimed) {
          j.claimed = true;
          rememberDisplay(src, display);
        }
      }
      el.src = display;
      finish();
    });
  };

  const onScroll = () => {
    if (ticking || done) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (done) return;
      if (!el.isConnected) {
        finish();
        return;
      }
      const view = inView();
      if (view !== alive) alive = view;
      if (view) apply();
    });
  };

  // Manual trigger for hosts that know the slot is about to paint — a
  // popup card being drawn. Covers the slots the observer never reports:
  // 0×0 at observe time, built while detached, or an open the observer
  // missed. No-op while off-view, done, or already handled.
  const force = () => {
    if (done || !el.isConnected) return;
    if (srcTouched()) {
      finish();
      return;
    }
    if (inView()) {
      alive = true;
      apply();
    }
  };
  slots.set(el, force);

  const start = () => {
    if (done) return;
    // Two triggers: the observer (the normal case) plus a capture-phase
    // scroll check, in case the observer misses the transition for a card
    // built during the first paint.
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(
        (entries) => {
          if (done) {
            io.disconnect();
            io = null;
            return;
          }
          if (entries.some((entry) => entry.isIntersecting)) {
            io.disconnect();
            io = null;
            alive = true;
            apply();
          }
        },
        { rootMargin: ARM_PX + "px 0px" }
      );
      io.observe(el);
    }
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    alive = inView();
    if (alive) apply();
  };

  if (el.isConnected) {
    start();
    return;
  }
  // Feed and chat cards are appended a moment after this runs; wait for
  // the connection before observing.
  let tries = 0;
  const tick = () => {
    if (done) return;
    if (el.isConnected || ++tries > 120) {
      start();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

window.addEventListener("pagehide", () => {
  for (const url of cache.values()) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
  cache.clear();
  for (const url of createdBlobs) URL.revokeObjectURL(url);
  createdBlobs.clear();
});
