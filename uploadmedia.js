// Marker/polygon media upload — pick a file from the phone, stream it to
// Cloudflare R2 through /api/upload (server/index.js), and auto-fill the
// form field. Four uploaders (2026-10-06 layout):
//   marker form:  "📎 Upload image / video" → Image URL (image/gif/mp4/webm)
//                 "📎 Upload image (cover)" → Cover Image URL (stills + gif)
//   polygon form: "📎 Upload cover (image / gif / video)" → Cover Image URL
//                 "📎 Upload image / video" → Inside image URL (the popup)
// A polygon cover video/gif animates in the map (polygons.js pump); the
// Inside field is what the popup plays — e.g. a 15s cover ad + the real
// video in the popup. No automatic thumbnail.
import { toast } from "./toast.js";

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
  const pill = progressPill(`Uploading ${label} 0%`);
  try {
    const url = await uploadToR2(file, pill, `Uploading ${label}`);
    fillField(targetFieldId, url);
    toast.success("Uploaded — URL filled in");
  } catch (err) {
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
