// The draw forms type the post on a popup instead of separate fields.
// The hidden textareas stay, because submit still reads those.
import { connectedAccount } from "./web3.js";
import { formatHcsUsage, HCS_TOO_LONG, utf8ByteLength, normalizeMessageNewlines } from "./hcschunks.js";
import { toast } from "./toast.js";
import { capMessageEditor } from "./bytecap.js";
import { syncPopupChrome } from "./loadprofilepopup.js";
import { isGifUrl, needsGifCheck, resolveMediaUrl } from "./mediaurl.js";
import { presentImage } from "./loopmedia.js";

const MEDIA = {
  "input-field-image-marker": "draw-marker-media",
  "input-field-image-polygon": "draw-polygon-media",
};
const COVER = {
  "input-field-coverimage-marker": "draw-marker-cover",
  "input-field-coverimage-polygon": "draw-polygon-cover",
};
const COVER_PREVIEW = {
  "input-field-coverimage-marker": "draw-marker-cover-preview",
  "input-field-coverimage-polygon": "draw-polygon-cover-preview",
};

function isVideoUrl(url) {
  return resolveMediaUrl(url).kind === "video";
}

function playable(url) {
  if (isGifUrl(url)) return "";
  return resolveMediaUrl(url).src || "";
}

// A GIF address has an empty playable src. It still has to be checked so
// the preview can show frame 0 instead of skipping the picture.
function stillUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (isGifUrl(raw) || needsGifCheck(raw)) return raw;
  return playable(raw);
}

function paintMedia(id, url, kind) {
  const card = document.getElementById(id);
  if (!card) return;
  const img = card.querySelector("img");
  const video = card.querySelector("video");
  const clear = card.querySelector(".draw-popup-clear");
  const src = stillUrl(url);
  const videoMode = kind === "video" || isVideoUrl(url);
  if (!src) {
    img.hidden = true;
    presentImage(img, "");
    video.pause();
    video.hidden = true;
    video.removeAttribute("src");
    video.load();
    clear.hidden = true;
    card.classList.remove("has-media");
    return;
  }
  card.classList.add("has-media");
  clear.hidden = false;
  if (videoMode) {
    img.hidden = true;
    img.removeAttribute("src");
    video.hidden = false;
    if (video.getAttribute("src") !== src) {
      video.src = src;
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
    presentImage(img, src);
  }
}

function paintCover(id, url, kind, fieldId) {
  const chip = document.getElementById(id);
  if (chip) {
    chip.classList.toggle("has-cover", !!stillUrl(url));
    chip.textContent = stillUrl(url) ? "Cover ✓" : "Cover";
  }
  const preview = document.getElementById(COVER_PREVIEW[fieldId]);
  if (!preview) return;
  const img = preview.querySelector("img");
  const video = preview.querySelector("video");
  const clear = preview.querySelector(".draw-popup-clear");
  const src = stillUrl(url);
  const videoMode = !!video && (kind === "video" || isVideoUrl(url));
  if (!src) {
    preview.classList.remove("has-cover", "has-media");
    if (clear) clear.hidden = true;
    if (img) {
      img.hidden = true;
      presentImage(img, "");
    }
    if (video) {
      video.pause();
      video.hidden = true;
      video.removeAttribute("src");
      video.load();
    }
    return;
  }
  preview.classList.add("has-cover", "has-media");
  if (clear) clear.hidden = false;
  if (videoMode) {
    img.hidden = true;
    img.removeAttribute("src");
    video.hidden = false;
    if (video.getAttribute("src") !== src) {
      video.src = src;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.play().catch(() => {});
    }
    return;
  }
  if (video) {
    video.pause();
    video.hidden = true;
    video.removeAttribute("src");
    video.load();
  }
  if (!img) return;
  img.hidden = false;
  presentImage(img, src);
}

export function paintDrawField(fieldId, url, kind) {
  if (MEDIA[fieldId]) paintMedia(MEDIA[fieldId], url, kind);
  if (COVER[fieldId]) paintCover(COVER[fieldId], url, kind, fieldId);
}

function plainText(el) {
  return (el.innerText || "").replace(/\u00a0/g, " ");
}

function placeCaretEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function fieldValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function cleanMedia(url) {
  return String(url || "").replace(/\?network=mainnet$/, "");
}

// Same JSON rest.js submits for a regular marker, so the counter matches
// the bytes that land on the topic.
function markerWire() {
  return JSON.stringify({
    marker: {
      data: {
        title: fieldValue("input-field-2-1").replace(/\r?\n/g, "").slice(0, 20),
        image: [cleanMedia(fieldValue("input-field-image-marker"))],
        coverimage: [cleanMedia(fieldValue("input-field-coverimage-marker"))],
        msg: normalizeMessageNewlines(fieldValue("input-field-2-2")),
        cord: fieldValue("input-field-2-3"),
      },
    },
  });
}

function polygonCord(cord1, cord3) {
  const topLeft = String(cord1 || "").split(",").map(Number);
  const bottomRight = String(cord3 || "").split(",").map(Number);
  const formatted = [
    topLeft,
    [topLeft[0], bottomRight[1]],
    bottomRight,
    [bottomRight[0], topLeft[1]],
  ];
  const valid = formatted.every((cord) =>
    Array.isArray(cord) && cord.length === 2 && cord.every((num) => !isNaN(num) && isFinite(num))
  );
  if (!valid) return "";
  return formatted.map((cord) => `[${cord.join(",")}]`).join(", ");
}

function polygonWire() {
  return JSON.stringify({
    polygon: {
      data: {
        title: fieldValue("input-field-3-1").replace(/\r?\n/g, "").slice(0, 20),
        image: [cleanMedia(fieldValue("input-field-image-polygon"))],
        coverimage: [cleanMedia(fieldValue("input-field-coverimage-polygon"))],
        msg: normalizeMessageNewlines(fieldValue("input-field-3-2")),
        cord: polygonCord(fieldValue("input-field-3-3"), fieldValue("input-field-3-5")),
      },
    },
  });
}

function paintByteCounter(counterId, wire, sendIds) {
  const counter = document.getElementById(counterId);
  if (!counter) return;
  const usage = formatHcsUsage(utf8ByteLength(wire));
  counter.hidden = false;
  counter.textContent = usage.text;
  counter.classList.toggle("hcs-warn", usage.warn);
  counter.classList.toggle("hcs-over", usage.over);
  for (const id of sendIds) {
    const button = document.getElementById(id);
    if (button) button.classList.toggle("hcs-send-blocked", usage.over);
  }
}

function paintMarkerBytes() {
  paintByteCounter("draw-marker-bytes", markerWire(), [
    "submit-button-Create_Marker",
    "submit-button-Create_encrypted-Marker",
  ]);
}

function paintPolygonBytes() {
  paintByteCounter("draw-polygon-bytes", polygonWire(), [
    "submit-button-Create_Polygon",
    "submit-button-Create_encrypted-Polygon",
  ]);
}

function watchOverLimitSend(id) {
  const button = document.getElementById(id);
  if (!button || button.dataset.hcsWatch) return;
  button.dataset.hcsWatch = "1";
  button.addEventListener("click", (event) => {
    if (!button.classList.contains("hcs-send-blocked")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toast.error(HCS_TOO_LONG);
  }, true);
}

function bindEditable(editorId, fieldId, singleLine, measure) {
  const el = document.getElementById(editorId);
  const field = document.getElementById(fieldId);
  if (!el || !field) return;
  const max = Number(el.dataset.max);
  const capped = Number.isFinite(max) && max > 0;
  const countLeft = capped && el.classList.contains("draw-popup-title");
  const syncLeft = (text) => {
    if (countLeft) el.dataset.left = String(Math.max(0, max - text.length));
  };
  const paintBytes = () => {
    if (editorId === "draw-marker-text" || editorId === "draw-marker-title") paintMarkerBytes();
    if (editorId === "draw-polygon-text" || editorId === "draw-polygon-title") paintPolygonBytes();
  };
  const write = () => {
    let text = plainText(el).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (singleLine) text = text.replace(/\n/g, "");
    if (capped && text.length > max) {
      text = text.slice(0, max);
      el.textContent = text;
      placeCaretEnd(el);
    }
    // A cleared box keeps a <br>, which hides the empty placeholder.
    if (!text && el.childNodes.length) el.textContent = "";
    if (field.value !== text) field.value = text;
    syncLeft(text);
    paintBytes();
  };
  el.addEventListener("keydown", (event) => {
    if (singleLine && event.key === "Enter") event.preventDefault();
  });
  el.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData("text/plain");
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    selection.deleteFromDocument();
    selection.getRangeAt(0).insertNode(document.createTextNode(text));
    selection.collapseToEnd();
    write();
  });
  el.addEventListener("input", write);
  // A post text stops at 18 KB: the post's whole size (title, media, place).
  if (measure) capMessageEditor(el, field, measure, write);
  const shown = () => {
    let text = plainText(el).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (singleLine) text = text.replace(/\n/g, "");
    return text;
  };
  field.addEventListener("input", () => {
    if (document.activeElement === el) return;
    if (plainText(el) !== field.value) el.textContent = field.value;
    syncLeft(shown());
    paintBytes();
  });
  syncLeft(shown());
  paintBytes();
}

function bindUpload(triggerId, pickerId, fieldId, paint) {
  const trigger = document.getElementById(triggerId);
  const picker = document.getElementById(pickerId);
  const field = document.getElementById(fieldId);
  if (!trigger || !picker || !field) return;
  const open = () => picker.click();
  trigger.addEventListener("click", (event) => {
    if (event.target.closest(".draw-popup-clear, .video-thumb-bar")) return;
    open();
  });
  if (trigger.tagName !== "BUTTON") {
    trigger.addEventListener("keydown", (event) => {
      if (event.target.closest(".video-thumb-bar")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
  }
  const clear = trigger.querySelector(".draw-popup-clear");
  if (!clear) return;
  clear.addEventListener("click", (event) => {
    event.stopPropagation();
    field.value = "";
    field.dispatchEvent(new Event("input"));
    paint("");
  });
}

// The Draw copy of the popup shows only what can be typed (no profile,
// no arrows), but it is still this account's popup: the sheet carries the
// account, so the Early Hashinal holder look (syncPopupChrome) follows the
// wallet that is logged in.
export function paintDrawProfile(root, account = connectedAccount || "") {
  if (!root) return;
  const sheet = root.querySelector(".popup-sheet");
  if (sheet) sheet.dataset.popupPayer = typeof account === "string" ? account : "";
  syncPopupChrome(root.querySelector(".maplibregl-popup"));
}

function bindAccount(editorId) {
  const root = document.getElementById(editorId);
  if (!root) return;
  const paint = () => paintDrawProfile(root);
  paint();
  return paint;
}

bindEditable("draw-marker-title", "input-field-2-1", true);
bindEditable("draw-marker-text", "input-field-2-2", false, () => utf8ByteLength(markerWire()));
bindEditable("draw-polygon-title", "input-field-3-1", true);
bindEditable("draw-polygon-text", "input-field-3-2", false, () => utf8ByteLength(polygonWire()));
for (const id of ["input-field-2-3", "input-field-image-marker", "input-field-coverimage-marker"]) {
  const node = document.getElementById(id);
  if (node) node.addEventListener("input", paintMarkerBytes);
}
for (const id of ["input-field-3-3", "input-field-3-5", "input-field-image-polygon", "input-field-coverimage-polygon"]) {
  const node = document.getElementById(id);
  if (node) node.addEventListener("input", paintPolygonBytes);
}
for (const id of [
  "submit-button-Create_Marker",
  "submit-button-Create_encrypted-Marker",
  "submit-button-Create_Polygon",
  "submit-button-Create_encrypted-Polygon",
]) watchOverLimitSend(id);
bindEditable("draw-marker-topic", "input-field-2-0", true);
bindEditable("draw-polygon-topic", "input-field-3-0", true);
bindUpload("draw-marker-media", "upload-media-marker-file", "input-field-image-marker", (url) => paintMedia("draw-marker-media", url, "image"));
bindUpload("draw-polygon-media", "upload-media-polygon-file", "input-field-image-polygon", (url) => paintMedia("draw-polygon-media", url, "image"));
bindUpload("draw-marker-cover-preview", "upload-cover-marker-file", "input-field-coverimage-marker", () => {});
bindUpload("draw-polygon-cover-preview", "upload-cover-polygon-file", "input-field-coverimage-polygon", () => {});
const paintAccounts = [
  bindAccount("draw-marker-editor"),
  bindAccount("draw-polygon-editor"),
].filter(Boolean);
const paintLoggedIn = () => paintAccounts.forEach((paint) => paint());
document.addEventListener("profiles-loaded", paintLoggedIn);
const accountLabel = document.getElementById("account-id");
if (accountLabel) {
  new MutationObserver(paintLoggedIn).observe(accountLabel, { childList: true, characterData: true, subtree: true });
}

for (const fieldId of Object.keys(MEDIA)) {
  const field = document.getElementById(fieldId);
  if (!field) continue;
  field.addEventListener("input", () => paintDrawField(fieldId, field.value));
}
for (const fieldId of Object.keys(COVER)) {
  const field = document.getElementById(fieldId);
  if (!field) continue;
  field.addEventListener("input", () => paintDrawField(fieldId, field.value));
}
