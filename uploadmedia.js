// Marker/polygon media upload — pick a file from the phone, stream it to
// Cloudflare R2 through /api/upload (server/index.js), and auto-fill the
// form field, then show the file itself instead of the address.
// Four uploaders (2026-10-06 layout):
//   marker form:  "📎 Upload image / video" → Image URL (image/gif/mp4/webm)
//                 "📎 Upload image (cover)" → Cover Image URL (stills + gif)
//   polygon form: "📎 Upload cover (image / gif / video)" → Cover Image URL
//                 "📎 Upload image / video" → Inside image URL (the popup)
// A polygon cover video/gif animates in the map (polygons.js pump); the
// Inside field is what the popup plays — e.g. a 15s cover ad + the real
// video in the popup. No automatic thumbnail.
import { toast } from "./toast.js";
import { connectedAccount, signer } from "./web3.js";
import { profilePictures } from "./loadalladata.js";
import { paintDrawField } from "./drawpreview.js";

const VIDEO_MAX = 100 * 1024 * 1024;
const IMAGE_MAX = 20 * 1024 * 1024;
const MEDIA_TYPES = new Set([
  "video/mp4", "video/webm", "video/quicktime",
  "image/png", "image/jpeg", "image/gif", "image/webp",
]);
// Marker dot cover: stills + gif (a gif CSS background animates natively —
// a video can't play inside a dot).
const MARKER_COVER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// Polygon cover: everything — gif/video animate in the map via the
// updateImage pump in polygons.js (the 15s cover ad case).
const POLYGON_COVER_TYPES = MEDIA_TYPES;

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
let uploadGrant = null;

function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

async function uploadAuthToken() {
  if (!REQUIRE_UPLOAD_AUTH) return "";
  if (!connectedAccount || !signer) throw new Error("Connect wallet first");
  if (uploadGrant && uploadGrant.account === connectedAccount && uploadGrant.exp > Date.now() + 15000) {
    return uploadGrant.token;
  }
  const challengeRes = await fetch("/api/upload/challenge");
  const challenge = await challengeRes.json().catch(() => null);
  if (!challengeRes.ok || !challenge || typeof challenge.nonce !== "string") {
    throw new Error((challenge && challenge.error) || "Could not start the upload check");
  }
  const signed = await signer.sign([new TextEncoder().encode(challenge.nonce)]);
  const signatureBytes = signed && signed[0] && signed[0].signature;
  if (!signatureBytes) throw new Error("Wallet did not sign the upload check");
  const authRes = await fetch("/api/upload/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountId: connectedAccount,
      nonce: challenge.nonce,
      signature: bytesToBase64(signatureBytes),
    }),
  });
  const auth = await authRes.json().catch(() => null);
  if (!authRes.ok || !auth || typeof auth.token !== "string") {
    throw new Error((auth && auth.error) || "Upload was not authorized");
  }
  uploadGrant = { account: connectedAccount, token: auth.token, exp: Date.now() + 14 * 60 * 1000 };
  return auth.token;
}

// A persistent pill in the toast container that reports upload progress —
// the regular toasts auto-hide after 2.6 s, too short for a big file.
function progressPill(label) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = "toast toast-info toast-show";
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = label;
  el.appendChild(text);
  container.appendChild(el);
  return {
    set(textContent) { text.textContent = textContent; },
    done() { el.remove(); },
  };
}

// Read the length from the local file before it is uploaded. The popup
// later reads that number out of the filename, so it never loads the video
// just to filter. A slow or broken file uploads without a length.
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
    const timer = setTimeout(() => finish(null), 5000);
    video.onloadedmetadata = () => {
      const duration = video.duration;
      const seconds = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
      finish(seconds > 0 ? seconds : null);
    };
    video.onerror = () => finish(null);
    video.src = localUrl;
  });
}

// POST the file to /api/upload with progress events (XHR — fetch has none).
async function uploadToR2(file, pill, baseLabel, seconds, anchor) {
  const turnstile = await ensureTurnstileToken(anchor);
  const uploadToken = await uploadAuthToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";
    if (Number.isInteger(seconds) && seconds > 0) xhr.setRequestHeader("X-Media-Duration", String(seconds));
    if (connectedAccount) xhr.setRequestHeader("X-Account", connectedAccount);
    if (uploadToken) xhr.setRequestHeader("X-Upload-Token", uploadToken);
    if (turnstile) xhr.setRequestHeader("CF-Turnstile-Response", turnstile);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) pill.set(`${baseLabel} ${Math.round((e.loaded / e.total) * 100)}%`);
    };
    xhr.onload = () => {
      if (xhr.status === 200 && xhr.response && xhr.response.ok) resolve(xhr.response.url);
      else reject(new Error((xhr.response && xhr.response.error) || `upload failed (${xhr.status})`));
    };
    xhr.onerror = () => {
      reject(new Error("network error — is the backend up?"));
    };
    xhr.send(file);
  });
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
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
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
  const videoMode = kind === "video" || isVideoUrl(url);
  if (box.dataset.objectUrl && box.dataset.objectUrl !== url) revokePreviewUrl(box);
  if (String(url).startsWith("blob:")) box.dataset.objectUrl = url;
  if (videoMode) {
    img.hidden = true;
    img.removeAttribute("src");
    video.hidden = false;
    if (video.getAttribute("src") !== url) {
      video.src = url;
      video.play().catch(() => {});
    }
  } else {
    video.pause();
    video.hidden = true;
    video.removeAttribute("src");
    video.load();
    img.hidden = false;
    if (img.getAttribute("src") !== url) img.src = url;
  }
  box.hidden = false;
  paintDrawField(fieldId, url, videoMode ? "video" : "image");
}

function hideFieldPreview(fieldId) {
  const field = document.getElementById(fieldId);
  const box = previewBox(fieldId);
  if (!field || !box) return;
  const img = box.querySelector("img");
  const video = box.querySelector("video");
  revokePreviewUrl(box);
  img.removeAttribute("src");
  img.hidden = true;
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.hidden = true;
  box.hidden = true;
  paintDrawField(fieldId, "");
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
  uploading = true;
  btn.disabled = true;
  const label = isVideo ? "video" : "image";
  const previous = document.getElementById(targetFieldId)?.value || "";
  const localUrl = URL.createObjectURL(file);
  showFieldPreview(targetFieldId, localUrl, isVideo ? "video" : "image");
  const pill = progressPill(`Uploading ${label} 0%`);
  try {
    const seconds = isVideo ? await readVideoSeconds(localUrl) : null;
    const url = await uploadToR2(file, pill, `Uploading ${label}`, seconds, btn);
    fillField(targetFieldId, url);
    showFieldPreview(targetFieldId, url, isVideo ? "video" : "image");
    toast.success("Uploaded");
  } catch (err) {
    fillField(targetFieldId, previous);
    if (/^https?:\/\//i.test(previous)) showFieldPreview(targetFieldId, previous);
    else hideFieldPreview(targetFieldId);
    toast.error(err.message || "Upload failed");
  } finally {
    pill.done();
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

// Topic chat and encrypted chat attach one still image. The address goes
// in the message; the bytes stay on R2.
export async function uploadChatImage(file, anchor) {
  if (!file || !MARKER_COVER_TYPES.has(file.type)) {
    throw new Error("Only PNG, JPG, WebP, GIF");
  }
  if (file.size > IMAGE_MAX) throw new Error("Image is too large");
  const pill = progressPill("Uploading image 0%");
  try {
    return await uploadToR2(file, pill, "Uploading image", null, anchor);
  } finally {
    pill.done();
  }
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
