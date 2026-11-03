// A GIF is converted on the device before upload. Animated frames are drawn
// at their real delays and recorded with MediaRecorder. One frame becomes a
// JPEG. The .gif itself is never uploaded.
import { coverVideoReject } from "./covervideolimit.js";

export const GIF_BROWSER_ERROR = "This browser can't convert GIFs. Try Chrome or Safari";
export const GIF_COVER_EDGE = 512;
const JPEG_QUALITY = 0.85;
const COVER_ROLES = new Set(["cover", "avatar", "polygon-cover"]);
const MIME_CANDIDATES = [
  "video/mp4",
  "video/mp4;codecs=avc1.42E01E",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function normRole(role) {
  return String(role || "").trim().toLowerCase();
}

export function evenFloor(n) {
  const v = Math.floor(Number(n) || 0);
  const even = v - (v % 2);
  return even < 2 ? 2 : even;
}

// Cover, avatar, and polygon-cover: centre square, then an even edge of at
// most 512. Media keeps its frame and only drops a pixel so both sides are
// even. Still photos stay on shrinkCoverImage (long edge, no crop).
export function frameBox(width, height, role) {
  const w = Math.max(0, Math.floor(Number(width) || 0));
  const h = Math.max(0, Math.floor(Number(height) || 0));
  if (COVER_ROLES.has(normRole(role))) {
    const side = Math.min(w, h);
    const sx = Math.floor((w - side) / 2);
    const sy = Math.floor((h - side) / 2);
    const capped = side > GIF_COVER_EDGE ? GIF_COVER_EDGE : side;
    const out = evenFloor(capped);
    return { width: out, height: out, sx, sy, sw: side, sh: side };
  }
  return { width: evenFloor(w), height: evenFloor(h), sx: 0, sy: 0, sw: w, sh: h };
}

// One bar. Conversion fills 0–70. The upload fills 70–100.
export function mapGifProgress(phase, ratio) {
  const t = Math.min(1, Math.max(0, Number(ratio) || 0));
  if (phase === "upload") return Math.round(70 + t * 30);
  return Math.round(t * 70);
}

// Whichever clock is further along: frames already drawn, or time already waited.
export function conversionRatio(framesDone, frameCount, elapsedMs, durationMs) {
  const frames = frameCount > 0 ? framesDone / frameCount : 0;
  const time = durationMs > 0 ? elapsedMs / durationMs : 0;
  const ratio = Math.max(frames, time);
  if (!Number.isFinite(ratio) || ratio < 0) return 0;
  return ratio > 1 ? 1 : ratio;
}

export function pickRecorderMime(isTypeSupported) {
  if (typeof isTypeSupported !== "function") return "";
  for (const mime of MIME_CANDIDATES) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      /* this candidate is unusable */
    }
  }
  return "";
}

export function storedType(mime) {
  const text = String(mime || "").toLowerCase();
  if (text.startsWith("video/mp4")) return { type: "video/mp4", ext: ".mp4" };
  if (text.startsWith("video/webm")) return { type: "video/webm", ext: ".webm" };
  return null;
}

// Empty when this browser can record. Otherwise the sentence shown instead of an upload.
export function recorderFallback(hasCaptureStream, mime) {
  if (!hasCaptureStream || !mime || !storedType(mime)) return GIF_BROWSER_ERROR;
  return "";
}

// Polygon covers only. 30 seconds is allowed. 31 is not. Media is not capped.
export function gifDurationReject(role, seconds) {
  if (normRole(role) !== "polygon-cover") return "";
  return coverVideoReject(seconds);
}

export function gifCancelError() {
  const err = new Error("Upload cancelled");
  err.code = "GIF_CANCEL";
  return err;
}

function delayMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return n;
}

function baseName(file) {
  const raw = String((file && file.name) || "gif").replace(/\.[a-z0-9]+$/i, "");
  return raw || "gif";
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw gifCancelError();
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(gifCancelError());
    };
    function finish() {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      reject(gifCancelError());
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitProgress(ms, signal, tick) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    throwIfAborted(signal);
    if (tick) tick();
    const slice = Math.min(100, end - Date.now());
    if (slice <= 0) break;
    await wait(slice, signal);
  }
}

function canvasJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.size) resolve(blob);
      else reject(new Error(GIF_BROWSER_ERROR));
    }, "image/jpeg", JPEG_QUALITY);
  });
}

function paintOutput(ctx, source, box) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, box.width, box.height);
  ctx.drawImage(source, box.sx, box.sy, box.sw, box.sh, 0, 0, box.width, box.height);
}

function blitPatch(ctx, frame) {
  const dims = frame.dims;
  const patch = document.createElement("canvas");
  patch.width = dims.width;
  patch.height = dims.height;
  const pixels = new Uint8ClampedArray(frame.patch);
  patch.getContext("2d").putImageData(new ImageData(pixels, dims.width, dims.height), 0, 0);
  ctx.drawImage(patch, dims.left, dims.top);
}

function gifuctPainter(decoded) {
  let comp = null;
  let ctx = null;
  let next = 0;
  const ensure = () => {
    if (comp) return;
    comp = document.createElement("canvas");
    comp.width = decoded.width;
    comp.height = decoded.height;
    ctx = comp.getContext("2d", { willReadFrequently: true });
    next = 0;
  };
  return {
    reset() {
      comp = null;
      ctx = null;
      next = 0;
    },
    paint(index, target, box) {
      ensure();
      const frame = decoded.frames[index];
      if (!frame || index !== next) throw new Error(GIF_BROWSER_ERROR);
      const disposal = frame.disposalType || 0;
      const saved = disposal === 3 ? ctx.getImageData(0, 0, comp.width, comp.height) : null;
      blitPatch(ctx, frame);
      paintOutput(target, comp, box);
      if (disposal === 2) ctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
      else if (disposal === 3 && saved) ctx.putImageData(saved, 0, 0);
      next += 1;
    },
  };
}

function imageDecoderPainter(decoded) {
  return {
    reset() {},
    paint(index, target, box) {
      const frame = decoded.frames[index];
      if (!frame || !frame.image) throw new Error(GIF_BROWSER_ERROR);
      paintOutput(target, frame.image, box);
    },
  };
}

async function decodeWithImageDecoder(file) {
  if (typeof ImageDecoder !== "function") return null;
  let decoder = null;
  const frames = [];
  try {
    decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: "image/gif" });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const count = track && track.frameCount;
    if (!count) {
      try { decoder.close(); } catch { /* already closed */ }
      return null;
    }
    for (let i = 0; i < count; i += 1) {
      const result = await decoder.decode({ frameIndex: i });
      const image = result && result.image;
      if (!image) throw new Error("empty frame");
      const micros = typeof image.duration === "number" ? image.duration / 1000 : 0;
      frames.push({ image, delay: delayMs(micros) });
    }
    const first = frames[0].image;
    const width = first.displayWidth || first.codedWidth || 0;
    const height = first.displayHeight || first.codedHeight || 0;
    if (!width || !height) throw new Error("empty frame");
    return {
      width,
      height,
      frames,
      painter: null,
      close() {
        for (const frame of frames) {
          try { frame.image.close(); } catch { /* already closed */ }
        }
        try { decoder.close(); } catch { /* already closed */ }
      },
    };
  } catch {
    for (const frame of frames) {
      try { frame.image.close(); } catch { /* already closed */ }
    }
    if (decoder) {
      try { decoder.close(); } catch { /* already closed */ }
    }
    return null;
  }
}

async function decodeWithGifuct(file) {
  const { parseGIF, decompressFrames } = await import("gifuct-js");
  const gif = parseGIF(await file.arrayBuffer());
  const width = gif && gif.lsd ? gif.lsd.width : 0;
  const height = gif && gif.lsd ? gif.lsd.height : 0;
  const frames = decompressFrames(gif, true).filter((frame) => frame && frame.patch && frame.dims);
  if (!width || !height || !frames.length) return null;
  return {
    width,
    height,
    frames: frames.map((frame) => ({
      patch: frame.patch,
      dims: frame.dims,
      delay: delayMs(frame.delay),
      disposalType: frame.disposalType || 0,
    })),
    close() {},
  };
}

async function decodeGif(file) {
  const native = await decodeWithImageDecoder(file);
  if (native) {
    native.painter = imageDecoderPainter(native);
    return native;
  }
  const parsed = await decodeWithGifuct(file);
  if (!parsed) return null;
  parsed.painter = gifuctPainter(parsed);
  return parsed;
}

function stopTracks(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* already ended */ }
  }
}

async function recordCanvas(canvas, mime, paintFrame, count, delays, signal, onProgress) {
  const reason = recorderFallback(
    typeof canvas.captureStream === "function" && typeof MediaRecorder === "function",
    mime,
  );
  if (reason) throw new Error(reason);
  let stream = null;
  let rec = null;
  try {
    stream = canvas.captureStream(0);
    if (!stream.getVideoTracks().length) throw new Error(GIF_BROWSER_ERROR);
    rec = new MediaRecorder(stream, { mimeType: mime });
  } catch (err) {
    stopTracks(stream);
    if (err && err.message === GIF_BROWSER_ERROR) throw err;
    throw new Error(GIF_BROWSER_ERROR);
  }
  const chunks = [];
  let failed = false;
  rec.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  rec.onerror = () => { failed = true; };
  const stopped = new Promise((resolve) => {
    rec.onstop = () => resolve();
  });
  const duration = delays.reduce((sum, n) => sum + n, 0);
  const started = Date.now();
  const report = (framesDone, elapsed) => {
    if (onProgress) onProgress(conversionRatio(framesDone, count, elapsed, duration));
  };
  try {
    throwIfAborted(signal);
    rec.start(100);
    for (let i = 0; i < count; i += 1) {
      throwIfAborted(signal);
      paintFrame(i);
      const track = stream.getVideoTracks()[0];
      if (track && track.requestFrame) track.requestFrame();
      report(i + 1, Date.now() - started);
      await waitProgress(delays[i], signal, () => report(i + 1, Date.now() - started));
    }
    if (rec.state !== "inactive") rec.stop();
    await stopped;
    throwIfAborted(signal);
    if (failed) throw new Error(GIF_BROWSER_ERROR);
    const blob = new Blob(chunks, { type: storedType(mime).type });
    if (!blob.size) throw new Error(GIF_BROWSER_ERROR);
    return blob;
  } catch (err) {
    try { if (rec && rec.state !== "inactive") rec.stop(); } catch { /* already stopped */ }
    if (err && err.code === "GIF_CANCEL") throw err;
    if (err && err.message === GIF_BROWSER_ERROR) throw err;
    throw new Error(GIF_BROWSER_ERROR);
  } finally {
    stopTracks(stream);
  }
}

export async function convertGifFile(file, options) {
  const opts = options || {};
  const signal = opts.signal;
  const role = normRole(opts.role) || "media";
  let decoded = null;
  try {
    throwIfAborted(signal);
    decoded = await decodeGif(file);
  } catch (err) {
    if (err && err.code === "GIF_CANCEL") throw err;
    throw new Error(GIF_BROWSER_ERROR);
  }
  try {
    throwIfAborted(signal);
    const frames = decoded && decoded.frames;
    if (!frames || !frames.length || !decoded.painter) throw new Error(GIF_BROWSER_ERROR);
    const box = frameBox(decoded.width, decoded.height, role);
    if (!box.sw || !box.sh || !box.width || !box.height) throw new Error(GIF_BROWSER_ERROR);
    const delays = frames.map((frame) => delayMs(frame.delay));
    const seconds = delays.reduce((sum, n) => sum + n, 0) / 1000;
    if (frames.length > 1) {
      const reason = gifDurationReject(role, seconds);
      if (reason) {
        const err = new Error(reason);
        throw err;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = box.width;
    canvas.height = box.height;
    const ctx = canvas.getContext("2d");
    const paint = (index) => decoded.painter.paint(index, ctx, box);
    decoded.painter.reset();
    paint(0);
    const posterBlob = await canvasJpeg(canvas);
    const name = baseName(file);
    if (frames.length === 1) {
      return {
        file: new File([posterBlob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() }),
        poster: null,
        seconds: 0,
      };
    }
    decoded.painter.reset();
    const mime = pickRecorderMime(
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported
        ? (type) => MediaRecorder.isTypeSupported(type)
        : null,
    );
    const kind = storedType(mime);
    if (!kind) throw new Error(GIF_BROWSER_ERROR);
    if (opts.onProgress) opts.onProgress(0);
    const videoBlob = await recordCanvas(
      canvas,
      mime,
      paint,
      frames.length,
      delays,
      signal,
      opts.onProgress,
    );
    const poster = new File([posterBlob], `${name}.poster.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    return {
      file: new File([videoBlob], `${name}${kind.ext}`, { type: kind.type, lastModified: Date.now() }),
      poster,
      seconds,
    };
  } finally {
    if (decoded && decoded.close) decoded.close();
  }
}
