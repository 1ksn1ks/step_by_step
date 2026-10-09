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
import { connectedAccount } from "./web3.js";
import { profilePictures } from "./loadalladata.js";

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

// POST the file to /api/upload with progress events (XHR — fetch has none).
function uploadToR2(file, pill, baseLabel) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) pill.set(`${baseLabel} ${Math.round((e.loaded / e.total) * 100)}%`);
    };
    xhr.onload = () => {
      if (xhr.status === 200 && xhr.response && xhr.response.ok) resolve(xhr.response.url);
      else reject(new Error((xhr.response && xhr.response.error) || `upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("network error — is the backend up?"));
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
    const url = await uploadToR2(file, pill, `Uploading ${label}`);
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
