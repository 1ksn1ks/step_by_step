// Image attach for topic chat and encrypted chat. The button sits on the
// left of the compose row; Send stays on the right. The file is uploaded
// when it is picked, and Send includes the address.
import { toast } from "./toast.js";
import { clearVideoThumb, mountThumbControls, primeChatVideoThumb, sealedThumbDataUrl, uploadChatImage } from "./uploadmedia.js";
import { openPreview } from "./fullscreenmedia.js";
import { pictureElement, stillObjectUrl } from "./loopmedia.js";
import { resolveMediaUrl } from "./mediaurl.js";
import { HCS_MESSAGE_MAX_BYTES, normalizeMessageNewlines, utf8ByteLength } from "./hcschunks.js";
import { packSealedThumb, unpackSealedThumb } from "./videoposter.js";

const CHAT_IMAGE_PREFIX = "\u001echat1\n";

const slots = {
  topic: slot("topic-chat"),
  e2ee: slot("encrypted-chat"),
};

function slot(prefix) {
  return {
    url: "",
    poster: "",
    video: false,
    thumb: false,
    uploading: false,
    objectUrl: "",
    gen: 0,
    btn: document.getElementById(prefix + "-image-btn"),
    file: document.getElementById(prefix + "-image-file"),
    preview: document.getElementById(prefix + "-image-preview"),
    img: document.getElementById(prefix + "-image-preview-img"),
    clear: document.getElementById(prefix + "-image-clear"),
  };
}

export function pendingChatImage(kind) {
  const s = slots[kind];
  return s && s.url && !s.uploading ? s.url : "";
}

export function pendingChatPoster(kind) {
  const s = slots[kind];
  return s && !s.uploading && typeof s.poster === "string" ? s.poster : "";
}

export function chatImageBusy(kind) {
  return !!(slots[kind] && slots[kind].uploading);
}

export function clearPendingChatImage(kind) {
  const s = slots[kind];
  if (!s) return;
  s.gen += 1;
  if (s.objectUrl) URL.revokeObjectURL(s.objectUrl);
  s.objectUrl = "";
  s.url = "";
  s.poster = "";
  s.video = false;
  s.thumb = false;
  s.uploading = false;
  clearVideoThumb(kind === "topic" || kind === "e2ee" ? `chat:${kind}` : "");
  if (s.img) {
    s.img.removeAttribute("src");
    delete s.img.dataset.src;
    if (s.img.pause) s.img.pause();
  }
  if (s.preview) {
    const bar = s.preview.querySelector(".video-thumb-bar");
    if (bar) bar.hidden = true;
    s.preview.hidden = true;
    s.preview.style.display = "none";
  }
  if (s.file) s.file.value = "";
  if (s.btn) s.btn.disabled = false;
  notifyChatImage();
}

function safeHttpUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.href;
  } catch {
    return "";
  }
}

// Plain text stays plain. An image message is prefixed so older text
// messages are never parsed as JSON.
export function packChatPayload(text, imageUrl, poster) {
  const body = normalizeMessageNewlines(text || "");
  const image = safeHttpUrl(imageUrl);
  if (!image) return body;
  return packSealedThumb(body, image, poster);
}

// Topic chat is one JSON object. A newline in userMessage is the two
// characters \ and n, so it costs 2 UTF-8 bytes. E2EE encrypts
// packChatPayload: raw text (newline = 1 byte) until an image makes it JSON.
export function topicChatWire(text, imageUrl) {
  const payload = { userMessage: normalizeMessageNewlines(text) };
  const image = safeHttpUrl(imageUrl);
  if (image) payload.image = image;
  return JSON.stringify(payload);
}

export function composerWireBytes(kind, text) {
  if (kind === "topic") return utf8ByteLength(topicChatWire(text, pendingChatImage("topic")));
  const image = pendingChatImage("e2ee");
  const poster = pendingChatPoster("e2ee");
  const packed = utf8ByteLength(packChatPayload(text, image, poster));
  if (!poster || packed <= HCS_MESSAGE_MAX_BYTES) return packed;
  return utf8ByteLength(packChatPayload(text, image, ""));
}

function notifyChatImage() {
  document.dispatchEvent(new Event("chat-image-changed"));
}

export function unpackChatPayload(raw) {
  const parts = unpackSealedThumb(raw);
  if (typeof raw !== "string" || !raw.startsWith(CHAT_IMAGE_PREFIX)) {
    return { text: parts.text, image: "", poster: "" };
  }
  return {
    text: parts.text,
    image: safeHttpUrl(parts.image),
    poster: parts.poster,
  };
}

const CHAT_CLAMP_CHARS = 400;
const CHAT_CLAMP_LINES = 8;

function textIsLong(text) {
  if (text.length > CHAT_CLAMP_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines += 1;
      if (lines > CHAT_CLAMP_LINES) return true;
    }
  }
  return false;
}

export function fillChatMessage(el, text, imageUrl, hint) {
  const body = text == null ? "" : String(text);
  const src = safeHttpUrl(imageUrl);
  const posterHint = hint && typeof hint === "object" ? hint : null;
  el.replaceChildren();
  if (body) {
    const textEl = document.createElement("span");
    textEl.className = "chat-msg-body";
    textEl.appendChild(document.createTextNode(body));
    if (textIsLong(body)) textEl.classList.add("is-clamped");
    el.appendChild(textEl);
    if (textEl.classList.contains("is-clamped")) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "chat-msg-more";
      more.textContent = "Show more";
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        const clamped = textEl.classList.toggle("is-clamped");
        more.textContent = clamped ? "Show more" : "Show less";
      });
      el.appendChild(more);
    }
  }
  if (!src) return;
  if (body) el.appendChild(document.createElement("br"));
  const resolved = resolveMediaUrl(src);
  const video = resolved.kind === "video";
  const img = pictureElement(src, {
    className: "chat-msg-image",
    alt: "",
    posterHold: video,
    posterHint: video ? Object.assign({ holdSrc: true }, posterHint || {}) : null,
  });
  img.dataset.fullSrc = src;
  img.addEventListener("click", (event) => {
    event.stopPropagation();
    openPreview(src, Object.assign({ video }, posterHint || {}));
  });
  el.appendChild(img);
}

function previewNode(src, className, forceVideo) {
  if (forceVideo && resolveMediaUrl(src).kind !== "video") {
    const video = document.createElement("video");
    video.className = className;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = "metadata";
    video.dataset.src = src;
    video.src = src;
    video.play().catch(() => {});
    return video;
  }
  return pictureElement(src, { className, alt: "" });
}

function showPreview(s, src) {
  if (!s.preview) return;
  const live = s.img && s.img.isConnected ? s.img : s.preview.querySelector("img, video");
  if (!live) return;
  const next = previewNode(src, live.className, s.video);
  if (live.id) next.id = live.id;
  if (next !== live && live.parentNode) live.replaceWith(next);
  s.img = next;
  s.preview.hidden = false;
  s.preview.style.display = "flex";
  if (s.thumb || s.video || resolveMediaUrl(src).kind === "video" || next.tagName === "VIDEO") {
    const kind = s === slots.e2ee ? "e2ee" : "topic";
    mountThumbControls(s.preview, `chat:${kind}`, (state) => {
      s.poster = state && typeof state.dataUrl === "string" ? state.dataUrl : "";
      if (kind === "e2ee") notifyChatImage();
    });
  }
}

function bind(kind) {
  const s = slots[kind];
  if (!s.btn || !s.file) return;
  s.btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!s.uploading) s.file.click();
  });
  s.file.addEventListener("change", async () => {
    const file = s.file.files && s.file.files[0];
    if (!file) return;
    const mine = ++s.gen;
    if (s.objectUrl) URL.revokeObjectURL(s.objectUrl);
    s.objectUrl = URL.createObjectURL(file);
    s.url = "";
    s.poster = "";
    s.video = file.type === "video/mp4" || file.type === "video/webm";
    s.thumb = s.video || file.type === "image/gif";
    primeChatVideoThumb(kind, file);
    if (!s.thumb && s.preview) {
      const bar = s.preview.querySelector(".video-thumb-bar");
      if (bar) bar.hidden = true;
    }
    s.uploading = true;
    s.btn.disabled = true;
    if (s.thumb && s.preview) {
      mountThumbControls(s.preview, `chat:${kind}`, (state) => {
        s.poster = state && typeof state.dataUrl === "string" ? state.dataUrl : "";
        if (kind === "e2ee") notifyChatImage();
      });
    }
    if (file.type === "image/gif") {
      // The chat preview stays a JPEG still. uploadChatImage converts the
      // GIF on this device and never sends the .gif.
      const still = await stillObjectUrl(file);
      URL.revokeObjectURL(s.objectUrl);
      s.objectUrl = still;
      if (still) showPreview(s, still);
    } else {
      showPreview(s, s.objectUrl);
    }
    try {
      const url = await uploadChatImage(file, s.btn, { kind });
      if (mine !== s.gen) return;
      if (s.objectUrl) {
        URL.revokeObjectURL(s.objectUrl);
        s.objectUrl = "";
      }
      s.url = url;
      if (kind === "e2ee") {
        const field = document.getElementById("user-write-message-encrypted-chat");
        const text = field ? field.value : "";
        s.poster = await sealedThumbDataUrl(`chat:${kind}`, url, text);
      } else {
        s.poster = "";
      }
      showPreview(s, s.url);
      notifyChatImage();
      toast.success("Uploaded");
    } catch (err) {
      if (mine !== s.gen) return;
      clearPendingChatImage(kind);
      if (!err || !err.shown) {
        const message = (err && (err.serverError || err.message)) || "Upload failed, please try again";
        toast.error(message, { hold: true });
      }
    } finally {
      if (s.file) s.file.value = "";
      if (mine !== s.gen) return;
      s.uploading = false;
      if (s.btn) s.btn.disabled = false;
    }
  });
  if (s.img) {
    s.img.addEventListener("click", (event) => {
      event.stopPropagation();
      const src = s.img.getAttribute("src");
      if (src) openPreview(src);
    });
  }
  if (s.clear) {
    s.clear.addEventListener("click", (event) => {
      event.stopPropagation();
      clearPendingChatImage(kind);
    });
  }
}

bind("topic");
bind("e2ee");
