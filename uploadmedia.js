// Marker/polygon media upload — pick a file from the phone, stream it to
// Cloudflare R2 through /api/upload (server/index.js), and auto-fill the
// form field, then show the file itself instead of the address.
// Four uploaders (2026-10-06 layout):
//   marker form:  "📎 Upload image / video" → Image URL (a GIF becomes mp4, webm, or jpeg here)
//                 "📎 Upload image (cover)" → Cover Image URL (stills + gif input)
//   polygon form: "📎 Upload cover (image / gif / video)" → Cover Image URL
//                 "📎 Upload image / video" → Inside image URL (the popup)
// A polygon cover video is max 30s and animates in the map (polygons.js
// pump). An animated GIF is converted on this device to that same loop.
// The Inside field is what the popup plays. A video stays at 100 MB.
// A GIF is capped at 8 MB and 30 seconds, then becomes a muted clip
// plus a JPEG poster. A video can carry a JPEG poster: the picture
// the sender picks, or one frame from the file.
import { toast } from "./toast.js";
import { connectedAccount, signer } from "./web3.js";
import { profilePictures } from "./loadalladata.js";
import { paintDrawField } from "./drawpreview.js";
import { rememberGrant, withUploadAuth } from "./uploadgrant.js";
import { COVER_VIDEO_PROBE_MS, coverVideoReject } from "./covervideolimit.js";
import { isGifUrl, needsGifCheck, resolveMediaUrl, siblingPosterUrl, withGifClip } from "./mediaurl.js";
import { presentImage } from "./loopmedia.js";
import { HCS_MESSAGE_MAX_BYTES } from "./hcschunks.js";
import {
  GIF_BROWSER_ERROR,
  GIF_TOO_BIG,
  GIF_TOO_LONG,
  convertGifFile,
  gifCancelError,
  gifSizeReject,
  mapGifProgress,
} from "./gifvideo.js";
import {
  THUMB_EDGE,
  THUMB_EDGES,
  captureVideoPoster,
  e2eeWireBytes,
  fitThumb,
  packSealedThumb,
  posterPlan,
} from "./videoposter.js";
import {
  POSTER_EMBED_MAX,
  SEALED_CONTENT_TYPE,
  SEALED_MAX,
  encryptStream,
  packSealedMedia,
  sealPosterBytes,
} from "./e2eemedia.js";

const VIDEO_MAX = 100 * 1024 * 1024;
const IMAGE_MAX = 20 * 1024 * 1024;
const MEDIA_TYPES = new Set([
  "video/mp4", "video/webm", "video/quicktime",
  "image/png", "image/jpeg", "image/gif", "image/webp",
]);
// Marker dot cover: stills, plus a GIF file. This device stores an MP4 or
// WebM loop (or a JPEG when the GIF has one frame). The dot plays that loop.
const MARKER_COVER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// Polygon cover: stills, gif, and video. A cover video is max 30s and
// animates in the map via the updateImage pump in polygons.js.
// Inside/popup media is unlimited.
const POLYGON_COVER_TYPES = MEDIA_TYPES;
// Cover stills are the only uploads shrunk before they reach R2: the map
// fill (createResizedImage in polygons.js) caps textures at 512, so a
// multi-MP phone photo would only cost bandwidth. Inside/popup media,
// profile pictures, chat images, video covers, and hand-typed remote
// URLs all keep full quality.
const COVER_FIELD_IDS = new Set([
  "input-field-coverimage-marker",
  "input-field-coverimage-polygon",
]);
const COVER_SHRINK_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const COVER_MAX_EDGE = 512;
const COVER_JPEG_QUALITY = 0.85;
const THUMB_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const POSTER_FIELDS = new Set([
  "input-field-image-marker",
  "input-field-image-polygon",
]);
const DRAW_THUMB = {
  "input-field-image-marker": "draw-marker-media",
  "input-field-image-polygon": "draw-polygon-media",
};
const thumbs = new Map();

let uploading = false;

// Managed Turnstile. Nothing is drawn until an upload starts, and only when
// the public site key is set, so a local run with no key uploads as before.
// The widget lives inside the open sheet, then leaves once the token is
// used or that sheet closes. Chat images use uploadToR2 too.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
let turnstileWidgetId = null;
let turnstileScript = null;
let turnstileUnwatch = null;
let turnstilePending = null;

function sheetFor(anchor) {
  if (!anchor || !anchor.closest) return null;
  return anchor.closest("#draw-column, #Edit_Profile-column, #topic-chat-container, #encrypted-chat-container");
}

function removeTurnstile(reason) {
  if (turnstileUnwatch) {
    turnstileUnwatch();
    turnstileUnwatch = null;
  }
  if (window.turnstile && turnstileWidgetId != null) {
    try { window.turnstile.remove(turnstileWidgetId); } catch { /* already gone */ }
  }
  turnstileWidgetId = null;
  const box = document.getElementById("upload-turnstile");
  if (box) box.remove();
  const pending = turnstilePending;
  turnstilePending = null;
  if (pending && reason) pending.reject(reason);
}

function loadTurnstileApi() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      turnstileScript = null;
      reject(new Error("Could not load the check"));
    };
    document.head.appendChild(script);
  });
  return turnstileScript;
}

function watchSheet(sheet, onHide) {
  const hidden = () => !sheet.isConnected || sheet.hidden || sheet.style.display === "none";
  const observer = new MutationObserver(() => {
    if (hidden()) onHide();
  });
  observer.observe(sheet, { attributes: true, attributeFilter: ["style", "hidden", "class"] });
  return () => observer.disconnect();
}

// Shows the check inside the sheet that started the upload and resolves
// with a single-use token. No site key means the upload stays unchanged.
function ensureTurnstileToken(anchor) {
  if (!TURNSTILE_SITE_KEY) return Promise.resolve("");
  const sheet = sheetFor(anchor);
  if (!sheet) return Promise.reject(new Error("Open the upload panel first"));
  removeTurnstile();
  const box = document.createElement("div");
  box.id = "upload-turnstile";
  box.className = "upload-turnstile";
  sheet.prepend(box);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      turnstilePending = null;
      fn(value);
    };
    turnstilePending = { reject: (err) => finish(reject, err) };
    turnstileUnwatch = watchSheet(sheet, () => removeTurnstile(new Error("Upload cancelled")));
    loadTurnstileApi().then(() => {
      if (settled || !box.isConnected || !window.turnstile) return;
      turnstileWidgetId = window.turnstile.render(box, {
        sitekey: TURNSTILE_SITE_KEY,
        size: "flexible",
        callback(token) {
          if (turnstileUnwatch) {
            turnstileUnwatch();
            turnstileUnwatch = null;
          }
          const value = token || "";
          removeTurnstile();
          if (!value) finish(reject, new Error("Complete the check first"));
          else finish(resolve, value);
        },
        "expired-callback"() {},
        "error-callback"() {
          removeTurnstile();
          finish(reject, new Error("Check failed"));
        },
      });
    }).catch((err) => {
      removeTurnstile();
      finish(reject, err);
    });
  });
}

// Off unless the public flag is exactly "1". The server flag is separate
// and stays off by default, so a normal local upload does not ask the wallet.
const REQUIRE_UPLOAD_AUTH = import.meta.env.VITE_REQUIRE_UPLOAD_AUTH === "1";
const UPLOAD_FAILED = "Upload failed, please try again";
const HASHPACK_WAIT = "Confirm in HashPack to start uploading. This is only needed once per day.";
const HASHPACK_CANCEL = "Upload cancelled. Approve the HashPack request to upload.";
const HASHPACK_TIMEOUT = "HashPack didn't respond. Open HashPack and try again.";
const CONNECT_UPLOAD = "Connect your wallet to upload";
const SIGN_WAIT_MS = 60000;
const KEPT_UPLOAD_MESSAGES = new Set([
  "Complete the check first",
  "Check failed",
  "Could not load the check",
  "Open the upload panel first",
  "Upload cancelled",
  "Cover video max 30 seconds",
  "Couldn't read the video length. Try MP4/H.264",
  "Too big — 100 MB max",
  "Too big — 20 MB max",
  GIF_TOO_BIG,
  GIF_TOO_LONG,
  GIF_BROWSER_ERROR,
  HASHPACK_CANCEL,
  HASHPACK_TIMEOUT,
  CONNECT_UPLOAD,
  UPLOAD_FAILED,
]);

// sessionStorage for this tab. A wallet change is a different key, so the
// previous account's token is not sent. A blocked store falls back to memory.
const memoryGrants = new Map();
const grantStorage = {
  getItem(key) {
    try {
      if (typeof sessionStorage !== "undefined") {
        const value = sessionStorage.getItem(key);
        if (value != null) return value;
      }
    } catch {
      /* private mode */
    }
    return memoryGrants.has(key) ? memoryGrants.get(key) : null;
  },
  setItem(key, value) {
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(key, value);
        memoryGrants.delete(key);
        return;
      }
    } catch {
      /* fall through to memory */
    }
    memoryGrants.set(key, value);
  },
  removeItem(key) {
    memoryGrants.delete(key);
    try {
      if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
    } catch {
      /* already gone */
    }
  },
};

let connectHold = null;
let signingPromise = null;

function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function uploadFace(err) {
  if (err && err.serverError) return err.serverError;
  if (err && KEPT_UPLOAD_MESSAGES.has(err.message)) return err.message;
  return UPLOAD_FAILED;
}

function dismissConnectToast() {
  if (!connectHold) return;
  const current = connectHold;
  connectHold = null;
  current.done();
}

function showConnectToast() {
  if (connectHold) return;
  const connectBtn = document.getElementById("connect-wallet-btn");
  let action = null;
  if (connectBtn) {
    action = document.createElement("button");
    action.type = "button";
    action.className = "toast-connect";
    const label = (connectBtn.textContent || "").trim();
    action.textContent = label || "Connect";
    action.addEventListener("click", () => {
      dismissConnectToast();
      connectBtn.skipOverlayClose = true;
      try {
        connectBtn.click();
      } finally {
        connectBtn.skipOverlayClose = false;
      }
    });
  }
  connectHold = toast.hold(CONNECT_UPLOAD, { action, stay: !!connectBtn });
  if (!connectBtn) connectHold = null;
}

function userRejected(err) {
  if (!err) return false;
  const code = err.code;
  if (code === 4001 || code === "4001" || code === "USER_REJECTED" || code === "USER_REJECT") return true;
  const message = String(err.message || err).toLowerCase();
  return /reject|denied|cancel|closed|dismiss|declin/.test(message);
}

function failedUpload(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

// One HashPack prompt at a time. A second upload waits on the same signature.
function signUploadChallenge() {
  if (!signingPromise) {
    signingPromise = requestUploadGrant().finally(() => {
      signingPromise = null;
    });
  }
  return signingPromise;
}

async function requestUploadGrant() {
  if (!connectedAccount || !signer) {
    showConnectToast();
    const err = failedUpload(CONNECT_UPLOAD, "NO_WALLET");
    err.shown = true;
    throw err;
  }
  let challenge;
  try {
    const challengeRes = await fetch("/api/upload/challenge");
    challenge = await challengeRes.json().catch(() => null);
    if (!challengeRes.ok || !challenge || typeof challenge.nonce !== "string") {
      throw failedUpload(UPLOAD_FAILED);
    }
  } catch (err) {
    if (err instanceof Error && err.message === UPLOAD_FAILED) throw err;
    throw failedUpload(UPLOAD_FAILED);
  }
  if (!connectedAccount || !signer) {
    showConnectToast();
    const err = failedUpload(CONNECT_UPLOAD, "NO_WALLET");
    err.shown = true;
    throw err;
  }
  const accountId = connectedAccount;
  dismissConnectToast();
  const hold = toast.hold(HASHPACK_WAIT);
  let timer = null;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timeout: true }), SIGN_WAIT_MS);
    });
    const signedAttempt = signer.sign([new TextEncoder().encode(challenge.nonce)]).then(
      (value) => ({ value }),
      (err) => ({ err })
    );
    const outcome = await Promise.race([signedAttempt, timeout]);
    if (outcome.timeout) throw failedUpload(HASHPACK_TIMEOUT, "SIGN_TIMEOUT");
    if (outcome.err) {
      if (userRejected(outcome.err)) throw failedUpload(HASHPACK_CANCEL, "SIGN_CANCELLED");
      throw failedUpload(UPLOAD_FAILED);
    }
    const signatureBytes = outcome.value && outcome.value[0] && outcome.value[0].signature;
    if (!signatureBytes || signatureBytes.length === 0) {
      throw failedUpload(HASHPACK_CANCEL, "SIGN_CANCELLED");
    }
    const authRes = await fetch("/api/upload/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId,
        nonce: challenge.nonce,
        signature: bytesToBase64(signatureBytes),
      }),
    });
    const auth = await authRes.json().catch(() => null);
    if (!authRes.ok || !auth || typeof auth.token !== "string") throw failedUpload(UPLOAD_FAILED);
    return rememberGrant(grantStorage, accountId, auth);
  } catch (err) {
    if (err && (err.code === "SIGN_TIMEOUT" || err.code === "SIGN_CANCELLED" || err.message === UPLOAD_FAILED)) {
      throw err;
    }
    if (userRejected(err)) throw failedUpload(HASHPACK_CANCEL, "SIGN_CANCELLED");
    throw failedUpload(UPLOAD_FAILED);
  } finally {
    if (timer) clearTimeout(timer);
    hold.done();
  }
}

// A persistent pill in the toast container that reports upload progress —
// the regular toasts auto-hide after 2.6 s, too short for a big file.
// GIF conversion passes onCancel so the same pill can stop the recorder.
function progressPill(label, onCancel) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = onCancel ? "toast toast-info toast-show toast-gif" : "toast toast-info toast-show";
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = label;
  el.appendChild(text);
  if (onCancel) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "toast-gif-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    });
    el.appendChild(cancel);
  }
  container.appendChild(el);
  return {
    set(textContent) { text.textContent = textContent; },
    done() { if (el.isConnected) el.remove(); },
  };
}

// Read the length from the local file before it is uploaded. The popup
// later reads that number out of the filename, so it never loads the video
// just to filter. Inside media still uploads when the length never arrives.
// A polygon cover refuses that case on its own.
function readVideoSeconds(localUrl) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const finish = (seconds) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      try { video.load(); } catch { /* the element is already idle */ }
      resolve(seconds);
    };
    const timer = setTimeout(() => finish(null), COVER_VIDEO_PROBE_MS);
    video.onloadedmetadata = () => {
      const duration = video.duration;
      // Raw length so a cover can allow 30.5s of rounding. The caller
      // rounds a positive length for the filename header.
      finish(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    video.onerror = () => finish(null);
    video.src = localUrl;
  });
}

const POSTER_EDIT_STORE = "poster-edit";
const POSTER_EDIT_MAX = 50;
const POSTER_EDIT_MS = 7 * 24 * 60 * 60 * 1000;

function writePosterEdits(map) {
  try {
    localStorage.setItem(POSTER_EDIT_STORE, JSON.stringify(map));
  } catch {
    /* private mode */
  }
}

function loadPosterEdits(now = Date.now()) {
  let stored = "{}";
  try {
    stored = localStorage.getItem(POSTER_EDIT_STORE) || "{}";
  } catch {
    return {};
  }
  let parsed = null;
  try { parsed = JSON.parse(stored); } catch { parsed = null; }
  const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const map = {};
  let dropped = !parsed || typeof parsed !== "object" || Array.isArray(parsed);
  for (const [url, row] of Object.entries(raw)) {
    const videoUrl = String(url || "").trim();
    const token = row && typeof row === "object" && !Array.isArray(row) && typeof row.t === "string" ? row.t.trim() : "";
    const at = row && typeof row === "object" ? Number(row.at) : NaN;
    if (!videoUrl || !token || !Number.isFinite(at) || now - at > POSTER_EDIT_MS) {
      dropped = true;
      continue;
    }
    map[videoUrl] = { t: token, at };
  }
  const rows = Object.entries(map).sort((a, b) => a[1].at - b[1].at);
  while (rows.length > POSTER_EDIT_MAX) {
    rows.shift();
    dropped = true;
  }
  const kept = {};
  for (const [key, row] of rows) kept[key] = row;
  if (dropped) writePosterEdits(kept);
  return kept;
}

function rememberPosterEdit(url, token, now = Date.now()) {
  const videoUrl = typeof url === "string" ? url.trim() : "";
  const edit = typeof token === "string" ? token.trim() : "";
  if (!videoUrl || !edit) return;
  const map = loadPosterEdits(now);
  delete map[videoUrl];
  const rows = Object.entries(map).sort((a, b) => a[1].at - b[1].at);
  while (rows.length >= POSTER_EDIT_MAX) rows.shift();
  const next = {};
  for (const [key, row] of rows) next[key] = row;
  next[videoUrl] = { t: edit, at: now };
  writePosterEdits(next);
}

function posterEditFor(url, now = Date.now()) {
  const videoUrl = typeof url === "string" ? url.trim() : "";
  if (!videoUrl) return "";
  const row = loadPosterEdits(now)[videoUrl];
  return row ? row.t : "";
}

function clearPosterEdits() {
  try {
    localStorage.removeItem(POSTER_EDIT_STORE);
  } catch {
    /* private mode */
  }
}

function watchPosterEditWallet() {
  const account = document.getElementById("account-id");
  if (!account || account.dataset.posterEditWatch) return;
  account.dataset.posterEditWatch = "1";
  let last = "";
  const text = account.textContent ? account.textContent.trim() : "";
  if (/^\d+\.\d+\.\d+$/.test(text) && text.length <= 40) last = text;
  new MutationObserver(() => {
    const raw = account.textContent ? account.textContent.trim() : "";
    const now = /^\d+\.\d+\.\d+$/.test(raw) && raw.length <= 40 ? raw : "";
    if (now === last) return;
    const left = !!last && now !== last;
    last = now;
    if (left) clearPosterEdits();
  }).observe(account, { childList: true, characterData: true, subtree: true });
}

function postFile({ file, seconds, turnstile, uploadToken, role, posterFor, expectPoster, seal, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      try { xhr.abort(); } catch { /* already stopped */ }
      finish(reject, gifCancelError());
    };
    if (signal) {
      if (signal.aborted) {
        finish(reject, gifCancelError());
        return;
      }
      signal.addEventListener("abort", onAbort);
    }
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";
    // A sealed body is ciphertext. Its original name, mime, size, and
    // duration stay off this request. The blob type is octet-stream.
    if (seal) {
      xhr.setRequestHeader("X-Sealed", "1");
    } else {
      if (role && !posterFor) xhr.setRequestHeader("X-Media-Role", role);
      if (Number.isInteger(seconds) && seconds > 0) xhr.setRequestHeader("X-Media-Duration", String(seconds));
      if (posterFor) xhr.setRequestHeader("X-Poster-For", posterFor);
      if (expectPoster) xhr.setRequestHeader("X-Expect-Poster", "1");
    }
    if (connectedAccount) xhr.setRequestHeader("X-Account", connectedAccount);
    if (uploadToken) xhr.setRequestHeader("X-Upload-Token", uploadToken);
    if (turnstile) xhr.setRequestHeader("CF-Turnstile-Response", turnstile);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 200 && xhr.response && xhr.response.ok && typeof xhr.response.url === "string") {
        if (!seal && typeof xhr.response.posterEdit === "string") rememberPosterEdit(xhr.response.url, xhr.response.posterEdit);
        finish(resolve, xhr.response.url);
        return;
      }
      const serverError = xhr.response && typeof xhr.response.error === "string" ? xhr.response.error : "";
      const err = new Error(xhr.status === 401 || !serverError ? UPLOAD_FAILED : serverError);
      err.status = xhr.status;
      if (serverError && xhr.status !== 401) err.serverError = serverError;
      finish(reject, err);
    };
    xhr.onerror = () => finish(reject, new Error(UPLOAD_FAILED));
    xhr.onabort = () => finish(reject, gifCancelError());
    xhr.send(file);
  });
}

// The 0% pill appears only once the bytes start moving. Signature, wallet,
// and Turnstile failures never leave it on screen. A GIF pill is owned by
// uploadToR2 so conversion and the upload share one bar.
function sendUpload(file, baseLabel, seconds, turnstile, uploadToken, role, extra) {
  const gif = !!(extra && extra.gif);
  const pill = gif ? extra.pill : progressPill(`${baseLabel} 0%`);
  const signal = extra && extra.signal;
  const ownPill = !gif;
  const job = postFile({
    file,
    seconds,
    turnstile,
    uploadToken,
    role,
    expectPoster: !!(extra && extra.expectPoster),
    seal: !!(extra && extra.seal),
    signal,
    onProgress(ratio) {
      if (!pill) return;
      if (gif) pill.set(`Uploading ${mapGifProgress("upload", ratio)}%`);
      else pill.set(`${baseLabel} ${Math.round(ratio * 100)}%`);
    },
  });
  return job.finally(() => {
    if (ownPill && pill) pill.done();
  });
}

// POST the file to /api/upload with progress events (XHR — fetch has none).
function uploadRole(fieldId) {
  if (fieldId === "input-field-coverimage-polygon") return "polygon-cover";
  if (fieldId === "input-field-coverimage-marker") return "cover";
  if (fieldId === "input-field-profile-picture") return "avatar";
  return "media";
}

function outputTooBig(file) {
  const video = file && String(file.type || "").startsWith("video/");
  const cap = video ? VIDEO_MAX : IMAGE_MAX;
  if (!file || file.size <= cap) return "";
  return video ? "Too big — 100 MB max" : "Too big — 20 MB max";
}

// Convert a GIF here, then upload the MP4, WebM, or JPEG. The original
// bytes are not sent. Cancel stops the recorder and aborts the request.
function posterCapableFile(file) {
  const type = file && file.type;
  return type === "video/mp4" || type === "video/webm";
}

function postPosterArm(videoUrl, uploadToken, clear) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload/poster");
    xhr.responseType = "json";
    xhr.setRequestHeader("X-Poster-For", videoUrl);
    const edit = posterEditFor(videoUrl);
    if (edit) xhr.setRequestHeader("X-Poster-Edit", edit);
    if (clear) xhr.setRequestHeader("X-Poster-Clear", "1");
    if (connectedAccount) xhr.setRequestHeader("X-Account", connectedAccount);
    if (uploadToken) xhr.setRequestHeader("X-Upload-Token", uploadToken);
    xhr.onload = () => {
      if (xhr.status === 200 && xhr.response && xhr.response.ok) {
        resolve(xhr.response);
        return;
      }
      const serverError = xhr.response && typeof xhr.response.error === "string" ? xhr.response.error : "";
      const err = new Error(xhr.status === 401 || !serverError ? UPLOAD_FAILED : serverError);
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(new Error(UPLOAD_FAILED));
    xhr.send();
  });
}

// A later edit replaces or deletes only the still. The JPEG still goes
// through the owner-checked follow-up. Clear deletes the object.
export async function replaceVideoPoster(videoUrl, file) {
  const url = typeof videoUrl === "string" ? videoUrl.trim() : "";
  if (!url || !siblingPosterUrl(url)) throw new Error(UPLOAD_FAILED);
  const send = async (uploadToken) => {
    await postPosterArm(url, uploadToken, !file);
    if (!file) return { ok: true, cleared: true };
    await postFile({ file, uploadToken, posterFor: url });
    return { ok: true };
  };
  if (REQUIRE_UPLOAD_AUTH) {
    return withUploadAuth({
      account: connectedAccount,
      storage: grantStorage,
      sign: signUploadChallenge,
      send,
    });
  }
  return send("");
}

async function uploadToR2(file, baseLabel, seconds, anchor, role, extra) {
  const gif = !!(file && file.type === "image/gif");
  const abort = gif ? new AbortController() : null;
  let pill = null;
  let gifClip = false;
  try {
    let uploadFile = file;
    let poster = null;
    let uploadSeconds = seconds;
    if (gif) {
      pill = progressPill("Converting GIF 0%", () => abort.abort());
      const converted = await convertGifFile(file, {
        role: role || "media",
        signal: abort.signal,
        onProgress(ratio) {
          pill.set(`Converting GIF ${mapGifProgress("convert", ratio)}%`);
        },
      });
      if (converted.original) {
        uploadFile = file;
        poster = null;
        uploadSeconds = null;
      } else {
        uploadFile = converted.file;
        poster = converted.poster;
        uploadSeconds = uploadFile.type === "image/jpeg" || !(converted.seconds > 0)
          ? null
          : Math.round(converted.seconds);
        if (uploadSeconds != null && uploadSeconds < 1) uploadSeconds = null;
        const tooBig = outputTooBig(uploadFile);
        if (tooBig) throw new Error(tooBig);
        if (!uploadFile || uploadFile.type === "image/gif" || /\.gif$/i.test(uploadFile.name || "")) {
          throw new Error(GIF_BROWSER_ERROR);
        }
        gifClip = (role || "media") === "media" && !!posterCapableFile(uploadFile);
      }
      pill.set(`Uploading ${mapGifProgress("upload", 0)}%`);
    }
    if (abort && abort.signal.aborted) throw gifCancelError();
    let turnstile = "";
    if (abort) {
      const onAbort = () => removeTurnstile(gifCancelError());
      abort.signal.addEventListener("abort", onAbort);
      try {
        turnstile = await ensureTurnstileToken(anchor);
      } finally {
        abort.signal.removeEventListener("abort", onAbort);
      }
      if (abort.signal.aborted) throw gifCancelError();
    } else {
      turnstile = await ensureTurnstileToken(anchor);
    }
    const thumbKey = extra && extra.thumbKey || "";
    const seal = !!(extra && extra.seal);
    const send = async (uploadToken) => {
      const state = thumbKey ? thumbs.get(thumbKey) : null;
      const capable = posterCapableFile(uploadFile);
      const expectPoster = capable && !seal && !(state && state.removed) && (thumbKey ? true : !!poster);
      const url = await sendUpload(
        uploadFile,
        baseLabel,
        uploadSeconds,
        turnstile,
        uploadToken,
        role || "media",
        { gif, pill, signal: abort && abort.signal, expectPoster, seal },
      );
      await finishPoster({
        url,
        gifPoster: poster,
        thumbKey,
        seal,
        turnstile,
        uploadToken,
        signal: abort && abort.signal,
      });
      return url;
    };
    const sendJob = REQUIRE_UPLOAD_AUTH
      ? withUploadAuth({
        account: connectedAccount,
        storage: grantStorage,
        sign: signUploadChallenge,
        send,
      })
      : send("");
    let url;
    if (abort) {
      let cancelWait = null;
      const cancelled = new Promise((_, reject) => {
        cancelWait = () => reject(gifCancelError());
        if (abort.signal.aborted) cancelWait();
        else abort.signal.addEventListener("abort", cancelWait, { once: true });
      });
      cancelled.catch(() => {});
      try {
        url = await Promise.race([sendJob, cancelled]);
      } catch (err) {
        sendJob.catch(() => {});
        throw err;
      } finally {
        if (cancelWait) abort.signal.removeEventListener("abort", cancelWait);
      }
    } else {
      url = await sendJob;
    }
    dismissConnectToast();
    return gifClip ? withGifClip(url) : url;
  } finally {
    if (pill) pill.done();
  }
}

// Fill a form field the same way user typing would — the inline oninput
// handlers auto-resize the textarea height.
function fillField(id, value) {
  const el = document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new Event("input"));
}

const PREVIEW_FOR = {
  "input-field-coverimage-marker": "preview-coverimage-marker",
  "input-field-image-marker": "preview-image-marker",
  "input-field-coverimage-polygon": "preview-coverimage-polygon",
  "input-field-image-polygon": "preview-image-polygon",
  "input-field-profile-picture": "preview-profile-picture",
};

function isVideoUrl(url) {
  return resolveMediaUrl(url).kind === "video";
}

function previewSrc(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (isGifUrl(raw) || needsGifCheck(raw)) return raw;
  return resolveMediaUrl(raw).src || "";
}

// A local GIF must not play in an <img>. The first frame is a JPEG preview
// while the device converts the rest.
async function gifStillPreview(file) {
  if (!file || file.type !== "image/gif" || typeof createImageBitmap !== "function") return "";
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

function previewBox(fieldId) {
  const id = PREVIEW_FOR[fieldId];
  return id ? document.getElementById(id) : null;
}

function revokePreviewUrl(box) {
  const objectUrl = box && box.dataset.objectUrl;
  if (!objectUrl) return;
  URL.revokeObjectURL(objectUrl);
  delete box.dataset.objectUrl;
}

// The address stays in the textarea for submit. The draw form shows the
// picture or video in its place.
function showFieldPreview(fieldId, url, kind) {
  const field = document.getElementById(fieldId);
  const box = previewBox(fieldId);
  if (!field || !box) return;
  const img = box.querySelector("img");
  const video = box.querySelector("video");
  const shown = previewSrc(url);
  const videoMode = kind === "video" || isVideoUrl(url);
  if (!shown) {
    revokePreviewUrl(box);
    presentImage(img, "");
    img.hidden = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.hidden = true;
    box.hidden = true;
    paintDrawField(fieldId, "");
    if (POSTER_FIELDS.has(fieldId)) syncThumbBar(fieldId, false);
    return;
  }
  if (box.dataset.objectUrl && box.dataset.objectUrl !== url && box.dataset.objectUrl !== shown) revokePreviewUrl(box);
  if (String(url).startsWith("blob:") || String(shown).startsWith("blob:")) box.dataset.objectUrl = String(shown).startsWith("blob:") ? shown : url;
  if (videoMode) {
    img.hidden = true;
    img.removeAttribute("src");
    video.hidden = false;
    if (video.getAttribute("src") !== shown) {
      video.src = shown;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.play().catch(() => {});
    }
  } else {
    video.pause();
    video.hidden = true;
    video.removeAttribute("src");
    video.load();
    img.hidden = false;
    presentImage(img, shown);
  }
  box.hidden = false;
  paintDrawField(fieldId, shown, videoMode ? "video" : "image");
  // A GIF still is the preview while the device converts it to video.
  // The thumbnail control stays up so a custom picture can win.
  if (POSTER_FIELDS.has(fieldId)) syncThumbBar(fieldId, videoMode || thumbs.has(fieldId));
}

function hideFieldPreview(fieldId) {
  const field = document.getElementById(fieldId);
  const box = previewBox(fieldId);
  if (!field || !box) return;
  const img = box.querySelector("img");
  const video = box.querySelector("video");
  revokePreviewUrl(box);
  presentImage(img, "");
  img.hidden = true;
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.hidden = true;
  box.hidden = true;
  paintDrawField(fieldId, "");
  if (POSTER_FIELDS.has(fieldId)) {
    clearVideoThumb(fieldId);
    syncThumbBar(fieldId, false);
  }
}

// Shrink one still and re-encode it as JPEG. Covers stay at 512 and skip
// the re-encode when they are already small. A thumbnail passes
// { maxEdge: 720, even: true } so both sides stay even. Never upscales.
// Any decode/encode problem falls back to the original file.
async function shrinkCoverImage(file, options) {
  const maxEdge = options && options.maxEdge > 0 ? options.maxEdge : COVER_MAX_EDGE;
  const even = !!(options && options.even);
  const boxFor = (w, h) => {
    if (!w || !h) return null;
    if (even) {
      const box = fitThumb(w, h, maxEdge);
      return box.width && box.height ? box : null;
    }
    if (Math.max(w, h) <= maxEdge) return null;
    const scale = maxEdge / Math.max(w, h);
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
    };
  };
  const encode = (source, tw, th) => new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    canvas.getContext("2d").drawImage(source, 0, 0, tw, th);
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      COVER_JPEG_QUALITY
    );
  });
  const name = (blob) => {
    const base = String(file.name || "cover").replace(/\.[a-z0-9]+$/i, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  };
  if (typeof createImageBitmap !== "function") {
    // Old engines: load through <img> and draw, like polygons.js.
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode failed"));
        el.src = url;
      });
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      URL.revokeObjectURL(url);
      const box = boxFor(w, h);
      if (!box) return file;
      return name(await encode(img, box.width, box.height));
    } catch {
      return file;
    }
  }
  let native = null;
  let scaled = null;
  try {
    // Decode once for the native size — a small cover uploads untouched.
    native = await createImageBitmap(file);
    const box = boxFor(native.width, native.height);
    if (!box) return file;
    const tw = box.width;
    const th = box.height;
    // Prefer the downscale during decode; engines that ignore the resize
    // options (or return a different size) fall back to the native bitmap.
    // The re-encode is always a canvas draw — ImageBitmap.convertToBlob is
    // missing in some Chromium builds.
    try {
      scaled = await createImageBitmap(file, {
        resizeWidth: tw,
        resizeHeight: th,
        resizeQuality: "high",
      });
    } catch {
      scaled = null;
    }
    if (scaled && (scaled.width !== tw || scaled.height !== th)) {
      scaled.close();
      scaled = null;
    }
    const blob = await encode(scaled || native, tw, th);
    return name(blob);
  } catch {
    return file;
  } finally {
    if (native) native.close();
    if (scaled) scaled.close();
  }
}

// The same file input the cover buttons use: png, jpeg, webp, and gif.
let coverPickInput = null;
let coverPickResolve = null;

export function openCoverImagePicker() {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    if (!coverPickInput) {
      coverPickInput = document.createElement("input");
      coverPickInput.type = "file";
      coverPickInput.accept = "image/png,image/jpeg,image/webp,image/gif";
      coverPickInput.hidden = true;
      document.body.appendChild(coverPickInput);
      coverPickInput.addEventListener("change", () => {
        const picked = coverPickInput.files && coverPickInput.files[0];
        const done = coverPickResolve;
        coverPickResolve = null;
        coverPickInput.value = "";
        if (done) done(picked || null);
      });
    }
    let settled = false;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      if (coverPickResolve === finish) coverPickResolve = null;
      resolve(file || null);
    };
    coverPickResolve = finish;
    coverPickInput.click();
    setTimeout(() => {
      if (settled) return;
      window.addEventListener("focus", () => {
        setTimeout(() => finish(null), 400);
      }, { once: true });
    }, 0);
  });
}

export async function prepareThumbFile(file) {
  if (!file || !THUMB_TYPES.has(file.type)) return null;
  const shrunk = await shrinkCoverImage(file, { maxEdge: THUMB_EDGE, even: true });
  if (!shrunk || shrunk.type !== "image/jpeg") return null;
  return shrunk;
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file || typeof FileReader === "undefined") {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

// Shrink until the sealed topic message fits. A miss drops the still.
export async function dataUrlForSeal(file, videoUrl, text) {
  if (!file) return "";
  const edges = THUMB_EDGES.slice();
  for (const edge of edges) {
    let next = file;
    try {
      next = await shrinkCoverImage(file, { maxEdge: edge, even: true });
    } catch {
      next = file;
    }
    if (!next || next.type !== "image/jpeg") continue;
    const data = await fileToDataUrl(next);
    if (!data.startsWith("data:image/")) continue;
    const packed = packSealedThumb(text || "", videoUrl || "", data);
    if (e2eeWireBytes(packed) <= HCS_MESSAGE_MAX_BYTES) return data;
  }
  return "";
}

function startThumbCapture(key, state, file) {
  if (!state || state.capture) return;
  const type = file && file.type;
  if (type !== "video/mp4" && type !== "video/webm" && type !== "video/quicktime") return;
  state.capture = captureVideoPoster(file).then((frame) => {
    if (thumbs.get(key) !== state) return null;
    state.captured = frame;
    return frame;
  }).catch(() => null);
}

function beginVideoThumb(key, file, options) {
  const prev = thumbs.get(key);
  const seal = !!(options && options.seal);
  // Chat primes the thumb before the upload call. A second begin for the
  // same attach must keep a picture the user already picked.
  if (prev && !prev.videoUrl && !prev.posted) {
    if (seal) prev.seal = true;
    startThumbCapture(key, prev, file);
    return prev;
  }
  if (prev && prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
  const state = {
    removed: false,
    custom: null,
    captured: null,
    capture: null,
    previewUrl: "",
    videoUrl: "",
    posted: false,
    seal,
    dataUrl: "",
  };
  startThumbCapture(key, state, file);
  thumbs.set(key, state);
  return state;
}

// Topic and encrypted chat show the thumbnail control before uploadChatImage
// runs. A still image clears any thumb left by the previous attach.
export function primeChatVideoThumb(kind, file) {
  if (kind !== "topic" && kind !== "e2ee") return;
  const key = `chat:${kind}`;
  const type = file && file.type;
  const thumb = type === "video/mp4" || type === "video/webm" || type === "image/gif";
  clearVideoThumb(key);
  if (!thumb) return;
  beginVideoThumb(key, file, { seal: kind === "e2ee" });
}

export function clearVideoThumb(key) {
  const state = thumbs.get(key);
  if (!state) return;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  thumbs.delete(key);
}

function refreshThumbBar(key) {
  const state = thumbs.get(key);
  const cards = thumbCards(key);
  for (const card of cards) {
    const drop = card.querySelector(".video-thumb-clear");
    if (!drop) continue;
    const show = !!(state && !state.removed && (state.custom || state.posted));
    drop.hidden = !show;
  }
}

function thumbCards(key) {
  const id = DRAW_THUMB[key];
  const nodes = [];
  if (id) {
    const card = document.getElementById(id);
    if (card) nodes.push(card);
  }
  if (key === "chat:topic") {
    const card = document.getElementById("topic-chat-image-preview");
    if (card) nodes.push(card);
  }
  if (key === "chat:e2ee") {
    const card = document.getElementById("encrypted-chat-image-preview");
    if (card) nodes.push(card);
  }
  return nodes;
}

async function applyThumbChoice(key, file) {
  const state = thumbs.get(key) || beginVideoThumb(key, null);
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.removed = false;
  state.custom = file;
  state.previewUrl = URL.createObjectURL(file);
  state.dataUrl = "";
  if (state.videoUrl && !state.seal) {
    try {
      await replaceVideoPoster(state.videoUrl, file);
      state.posted = true;
      toast.success("Thumbnail saved");
    } catch (err) {
      toast.error(uploadFace(err), { hold: true });
    }
  } else if (state.seal && state.videoUrl) {
    state.dataUrl = await dataUrlForSeal(file, state.videoUrl, "");
  }
  refreshThumbBar(key);
  return state;
}

async function applyThumbRemoval(key) {
  const state = thumbs.get(key);
  if (!state) return null;
  state.removed = true;
  state.custom = null;
  state.dataUrl = "";
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = "";
  }
  if (state.videoUrl && state.posted && !state.seal) {
    try {
      await replaceVideoPoster(state.videoUrl, null);
      state.posted = false;
    } catch (err) {
      toast.error(uploadFace(err), { hold: true });
    }
  }
  refreshThumbBar(key);
  return state;
}

export function mountThumbControls(card, key, onChange) {
  if (!card) return null;
  let bar = card.querySelector(".video-thumb-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "video-thumb-bar";
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "video-thumb-btn";
    pick.textContent = "Thumbnail";
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "video-thumb-btn video-thumb-clear";
    drop.textContent = "Remove";
    drop.hidden = true;
    pick.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const picked = await openCoverImagePicker();
      if (!picked) return;
      if (!THUMB_TYPES.has(picked.type)) {
        toast.error("Only PNG, JPG, WebP, GIF");
        return;
      }
      const shrunk = await prepareThumbFile(picked);
      if (!shrunk) {
        toast.error("Could not read that picture");
        return;
      }
      const state = await applyThumbChoice(key, shrunk);
      if (onChange) onChange(state);
    });
    drop.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const state = await applyThumbRemoval(key);
      if (onChange) onChange(state);
    });
    bar.append(pick, drop);
    card.appendChild(bar);
  }
  bar.hidden = false;
  refreshThumbBar(key);
  return bar;
}

function syncThumbBar(fieldId, videoOn) {
  const card = document.getElementById(DRAW_THUMB[fieldId] || "");
  if (!card) return;
  if (!videoOn) {
    const bar = card.querySelector(".video-thumb-bar");
    if (bar) bar.hidden = true;
    return;
  }
  mountThumbControls(card, fieldId);
}

// Public poster after the video URL exists. A sealed chat keeps the still
// on the thumb state and never posts it. A failed frame grab uploads nothing.
async function finishPoster(job) {
  const thumbKey = job.thumbKey || "";
  const state = thumbKey ? thumbs.get(thumbKey) : null;
  if (state) state.videoUrl = job.url || "";
  if (!siblingPosterUrl(job.url || "")) {
    if (state && job.seal && job.gifPoster && !state.custom && !state.removed && !state.captured) {
      state.captured = job.gifPoster;
    }
    return;
  }
  // Sealed thumbs never become a public poster.
  if (job.seal || (state && state.seal)) {
    if (state && job.gifPoster && !state.custom && !state.removed && !state.captured) {
      state.captured = job.gifPoster;
    }
    return;
  }
  if (!thumbKey) {
    if (!job.gifPoster) return;
    try {
      await postFile({
        file: job.gifPoster,
        turnstile: job.turnstile,
        uploadToken: job.uploadToken,
        posterFor: job.url,
        signal: job.signal,
      });
    } catch {
      /* the video url still stands */
    }
    return;
  }
  if (state && !state.removed && !state.custom && state.capture) {
    try { await state.capture; } catch { /* capture-failed */ }
  }
  const live = thumbs.get(thumbKey);
  if (live !== state) return;
  if (live && live.seal) return;
  const plan = posterPlan({
    custom: live && live.custom,
    captured: (live && live.custom) ? null : (job.gifPoster || (live && live.captured) || null),
    removed: !!(live && live.removed),
  });
  if (!plan.upload || !plan.file) return;
  try {
    await postFile({
      file: plan.file,
      turnstile: job.turnstile,
      uploadToken: job.uploadToken,
      posterFor: job.url,
      signal: job.signal,
    });
    if (live) live.posted = true;
    refreshThumbBar(thumbKey);
  } catch {
    /* the video url still stands */
  }
}

export async function sealedThumbDataUrl(key, videoUrl, text) {
  const state = thumbs.get(key);
  if (!state || state.removed) return "";
  if (!state.custom && state.capture) {
    try { await state.capture; } catch { /* capture-failed */ }
  }
  const live = thumbs.get(key);
  if (!live || live.removed) return "";
  const source = live.custom || live.captured;
  if (!source) return "";
  const data = await dataUrlForSeal(source, videoUrl || live.videoUrl || "", text || "");
  live.dataUrl = data;
  return data;
}

async function handleFile(btn, picker, file, targetFieldId, allowedTypes, badMsg) {
  if (uploading) return;
  if (!allowedTypes.has(file.type)) {
    toast.error(badMsg);
    return;
  }
  const isVideo = file.type.startsWith("video/");
  const max = isVideo ? VIDEO_MAX : IMAGE_MAX;
  if (file.size > max) {
    toast.error(`Too big — ${isVideo ? "100 MB" : "20 MB"} max`);
    return;
  }
  if (file.type === "image/gif") {
    const reason = gifSizeReject(file.size);
    if (reason) {
      toast.error(reason);
      return;
    }
  }
  uploading = true;
  btn.disabled = true;
  // Cover stills only: the map texture is 512, so R2 stores the small JPEG.
  if (COVER_FIELD_IDS.has(targetFieldId) && !isVideo && COVER_SHRINK_TYPES.has(file.type)) {
    file = await shrinkCoverImage(file);
  }
  const label = isVideo ? "video" : "image";
  const posterField = POSTER_FIELDS.has(targetFieldId);
  if (posterField && (isVideo || file.type === "image/gif")) beginVideoThumb(targetFieldId, file);
  const previous = document.getElementById(targetFieldId)?.value || "";
  const localUrl = URL.createObjectURL(file);
  const stillUrl = file.type === "image/gif" ? await gifStillPreview(file) : "";
  if (file.type === "image/gif") {
    if (stillUrl) showFieldPreview(targetFieldId, stillUrl, "image");
    URL.revokeObjectURL(localUrl);
  } else {
    showFieldPreview(targetFieldId, localUrl, isVideo ? "video" : "image");
  }
  try {
    const length = isVideo ? await readVideoSeconds(localUrl) : null;
    // Inside and popup video stay uncapped. Only a polygon cover is limited,
    // and only a length we could read can be "too long".
    const coverReason = targetFieldId === "input-field-coverimage-polygon" && isVideo
      ? coverVideoReject(length)
      : "";
    if (coverReason) {
      toast.error(coverReason);
      URL.revokeObjectURL(localUrl);
      fillField(targetFieldId, previous);
      if (/^https?:\/\//i.test(previous)) showFieldPreview(targetFieldId, previous);
      else hideFieldPreview(targetFieldId);
      return;
    }
    const seconds = Number.isFinite(length) && length > 0 ? Math.round(length) : null;
    const url = await uploadToR2(
      file,
      `Uploading ${label}`,
      seconds > 0 ? seconds : null,
      btn,
      uploadRole(targetFieldId),
      posterField ? { thumbKey: targetFieldId } : null,
    );
    fillField(targetFieldId, url);
    showFieldPreview(targetFieldId, url, resolveMediaUrl(url).kind === "video" ? "video" : "image");
    toast.success("Uploaded");
  } catch (err) {
    fillField(targetFieldId, previous);
    if (/^https?:\/\//i.test(previous)) showFieldPreview(targetFieldId, previous);
    else hideFieldPreview(targetFieldId);
    if (!err || !err.shown) toast.error(uploadFace(err), { hold: true });
  } finally {
    uploading = false;
    btn.disabled = false;
    picker.value = "";
  }
}

function bindUploader(btnId, pickerId, targetFieldId, allowedTypes, badMsg) {
  const b = document.getElementById(btnId);
  const p = document.getElementById(pickerId);
  if (!b || !p) return;
  b.addEventListener("click", () => p.click());
  p.addEventListener("change", () => {
    if (p.files && p.files[0]) handleFile(b, p, p.files[0], targetFieldId, allowedTypes, badMsg);
  });
}

bindUploader("upload-media-marker", "upload-media-marker-file", "input-field-image-marker", MEDIA_TYPES, "Only PNG, JPG, GIF, WebP, MP4, WebM");
bindUploader("upload-cover-marker", "upload-cover-marker-file", "input-field-coverimage-marker", MARKER_COVER_TYPES, "Only PNG, JPG, WebP, GIF");
bindUploader("upload-cover-polygon", "upload-cover-polygon-file", "input-field-coverimage-polygon", POLYGON_COVER_TYPES, "Only PNG, JPG, GIF, WebP, MP4, WebM");
bindUploader("upload-media-polygon", "upload-media-polygon-file", "input-field-image-polygon", MEDIA_TYPES, "Only PNG, JPG, GIF, WebP, MP4, WebM");
bindUploader("upload-profile-picture", "upload-profile-picture-file", "input-field-profile-picture", MARKER_COVER_TYPES, "Only PNG, JPG, WebP, GIF");

function measureLocalMedia(file) {
  return new Promise((resolve) => {
    const finish = (w, h) => resolve({
      w: w > 0 ? Math.round(w) : 0,
      h: h > 0 ? Math.round(h) : 0,
    });
    const type = file && file.type;
    if (type === "video/mp4" || type === "video/webm") {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      const stop = (w, h) => {
        video.removeAttribute("src");
        try { video.load(); } catch { /* already released */ }
        URL.revokeObjectURL(url);
        finish(w, h);
      };
      video.onloadedmetadata = () => stop(video.videoWidth, video.videoHeight);
      video.onerror = () => stop(0, 0);
      video.src = url;
      return;
    }
    if (typeof createImageBitmap === "function") {
      createImageBitmap(file).then((bmp) => {
        const box = { w: bmp.width, h: bmp.height };
        if (bmp.close) bmp.close();
        finish(box.w, box.h);
      }).catch(() => finish(0, 0));
      return;
    }
    finish(0, 0);
  });
}

function postSealedBlob(blob, anchor, label, uploadToken) {
  return ensureTurnstileToken(anchor).then((turnstile) => {
    const pill = progressPill(`${label} 0%`);
    return postFile({
      file: blob,
      turnstile,
      uploadToken,
      seal: true,
      onProgress(ratio) {
        if (pill) pill.set(`${label} ${Math.round(ratio * 100)}%`);
      },
    }).finally(() => {
      if (pill) pill.done();
    });
  });
}

// The still is made on this device, then encrypted with its own key.
// A small ciphertext rides inside the sealed message. A larger one is a
// second octet-stream object. A clear JPEG is never posted.
async function sealedChatPoster(key, gifPoster, media, anchor, uploadToken) {
  const state = thumbs.get(key);
  if (state && state.removed) return null;
  if (state && !state.custom && state.capture) {
    try { await state.capture; } catch { /* capture-failed */ }
  }
  const live = thumbs.get(key);
  if (live && live.removed) return null;
  const source = (live && (live.custom || live.captured)) || gifPoster;
  if (!source) return null;
  const field = document.getElementById("user-write-message-encrypted-chat");
  const text = field ? field.value : "";
  let fallback = null;
  for (const edge of THUMB_EDGES) {
    let shrunk = source;
    try {
      shrunk = await shrinkCoverImage(source, { maxEdge: edge, even: true });
    } catch {
      shrunk = source;
    }
    if (!shrunk) continue;
    const plain = new Uint8Array(await shrunk.arrayBuffer());
    const choice = await sealPosterBytes(plain, {
      embedMax: POSTER_EMBED_MAX,
      fits(poster) {
        const packed = packSealedMedia(text, Object.assign({}, media, { poster }));
        return !!packed && e2eeWireBytes(packed) <= HCS_MESSAGE_MAX_BYTES;
      },
    });
    if (choice.mode === "embed") return choice.poster;
    fallback = choice;
  }
  if (!fallback || !fallback.uploads.length) return null;
  const upload = fallback.uploads[0];
  const blob = new Blob([upload.body], { type: SEALED_CONTENT_TYPE });
  const posterUrl = await postSealedBlob(blob, anchor, "Uploading image", uploadToken);
  return {
    url: posterUrl,
    fileKey: fallback.poster.fileKey,
    header: fallback.poster.header,
    mime: "image/jpeg",
    size: fallback.poster.size,
  };
}

// Encrypt on this device, then upload only the ciphertext. Topic chat
// does not use this path.
async function uploadSealedChatMedia(file, anchor) {
  let uploadFile = file;
  let gifPoster = null;
  let fromGif = false;
  if (file && file.type === "image/gif") {
    const converted = await convertGifFile(file, { role: "media" });
    if (converted.original) {
      uploadFile = file;
      gifPoster = null;
    } else {
      uploadFile = converted.file;
      gifPoster = converted.poster || null;
      if (!uploadFile || uploadFile.type === "image/gif") throw new Error(GIF_BROWSER_ERROR);
    }
    const tooBig = outputTooBig(uploadFile);
    if (tooBig) throw new Error(tooBig);
  }
  const video = !!(uploadFile && (uploadFile.type === "video/mp4" || uploadFile.type === "video/webm"));
  const still = !!(uploadFile && (
    uploadFile.type === "image/png"
    || uploadFile.type === "image/jpeg"
    || uploadFile.type === "image/webp"
  ));
  const gifKept = !!(uploadFile && uploadFile.type === "image/gif");
  if (!video && !still && !gifKept) throw new Error("Only PNG, JPG, WebP, GIF, MP4, WebM");
  fromGif = !!(file && file.type === "image/gif" && video);
  if (video && uploadFile.size > VIDEO_MAX) throw new Error("Too big — 100 MB max");
  if (!video && uploadFile.size > IMAGE_MAX) throw new Error("Image is too large");
  const key = "chat:e2ee";
  if (video || (file && file.type === "image/gif")) beginVideoThumb(key, file, { seal: true });
  const dims = await measureLocalMedia(uploadFile);
  const enc = await encryptStream(uploadFile);
  if (enc.blob.size > SEALED_MAX) throw new Error(video ? "Too big — 100 MB max" : "Image is too large");
  const send = async (uploadToken) => {
    const url = await postSealedBlob(
      enc.blob,
      anchor,
      video ? "Uploading video" : "Uploading image",
      uploadToken,
    );
    const media = {
      url,
      fileKey: enc.fileKey,
      header: enc.header,
      mime: uploadFile.type,
      size: uploadFile.size,
      w: dims.w,
      h: dims.h,
    };
    if (video || gifPoster) {
      const poster = await sealedChatPoster(key, gifPoster, media, anchor, uploadToken);
      if (poster) media.poster = poster;
    }
    if (fromGif) media.gif = 1;
    return media;
  };
  if (REQUIRE_UPLOAD_AUTH) {
    return withUploadAuth({
      account: connectedAccount,
      storage: grantStorage,
      sign: signUploadChallenge,
      send,
    });
  }
  return send("");
}

// Topic chat and encrypted chat attach one image or a short video.
// Topic chat stores the file. E2EE stores ciphertext and keeps the key
// inside the sealed message.
export async function uploadChatImage(file, anchor, options) {
  const kind = options && (options.kind === "topic" || options.kind === "e2ee") ? options.kind : "";
  if (kind === "e2ee") return uploadSealedChatMedia(file, anchor);
  const video = file && (file.type === "video/mp4" || file.type === "video/webm");
  const gif = file && file.type === "image/gif";
  if (video) {
    if (file.size > VIDEO_MAX) throw new Error("Too big — 100 MB max");
    const key = kind ? `chat:${kind}` : "";
    if (key) beginVideoThumb(key, file, { seal: kind === "e2ee" });
    const local = URL.createObjectURL(file);
    let seconds = null;
    try {
      const length = await readVideoSeconds(local);
      seconds = Number.isFinite(length) && length > 0 ? Math.round(length) : null;
    } finally {
      URL.revokeObjectURL(local);
    }
    return uploadToR2(file, "Uploading video", seconds > 0 ? seconds : null, anchor, "media", {
      thumbKey: key,
      seal: kind === "e2ee",
    });
  }
  if (!file || !MARKER_COVER_TYPES.has(file.type)) {
    throw new Error("Only PNG, JPG, WebP, GIF, MP4, WebM");
  }
  if (file.size > IMAGE_MAX) throw new Error("Image is too large");
  const key = kind && gif ? `chat:${kind}` : "";
  if (key) beginVideoThumb(key, file, { seal: kind === "e2ee" });
  return uploadToR2(file, "Uploading image", null, anchor, "media", key ? {
    thumbKey: key,
    seal: kind === "e2ee",
  } : null);
}

function showSavedProfilePreview() {
  const field = document.getElementById("input-field-profile-picture");
  const uploaded = field && field.value;
  const saved = connectedAccount && profilePictures[connectedAccount] && profilePictures[connectedAccount].url;
  const url = uploaded || saved;
  if (url) showFieldPreview("input-field-profile-picture", url, "image");
}

const showProfilePicture = document.getElementById("show-profile-picture-from-edit-profile");
if (showProfilePicture) showProfilePicture.addEventListener("click", showSavedProfilePreview);

for (const fieldId of Object.keys(PREVIEW_FOR)) {
  const box = previewBox(fieldId);
  const clear = box && box.querySelector(".upload-preview-clear");
  if (!clear) continue;
  clear.addEventListener("click", (event) => {
    event.stopPropagation();
    fillField(fieldId, "");
    hideFieldPreview(fieldId);
  });
}

watchPosterEditWallet();

for (const fieldId of POSTER_FIELDS) {
  const field = document.getElementById(fieldId);
  if (!field) continue;
  field.addEventListener("input", () => {
    const value = field.value.trim();
    if (!value) {
      clearVideoThumb(fieldId);
      syncThumbBar(fieldId, false);
      return;
    }
    syncThumbBar(fieldId, resolveMediaUrl(value).kind === "video");
  });
}
