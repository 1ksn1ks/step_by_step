// Image attach for topic chat and encrypted chat. The button sits on the
// left of the compose row; Send stays on the right. The file is uploaded
// when it is picked, and Send includes the address.
import { toast } from "./toast.js";
import { uploadChatImage } from "./uploadmedia.js";
import { openPreview } from "./fullscreenmedia.js";

const CHAT_IMAGE_PREFIX = "\u001echat1\n";

const slots = {
  topic: slot("topic-chat"),
  e2ee: slot("encrypted-chat"),
};

function slot(prefix) {
  return {
    url: "",
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
  s.uploading = false;
  if (s.img) s.img.removeAttribute("src");
  if (s.preview) {
    s.preview.hidden = true;
    s.preview.style.display = "none";
  }
  if (s.file) s.file.value = "";
  if (s.btn) s.btn.disabled = false;
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
export function packChatPayload(text, imageUrl) {
  const body = text || "";
  const image = safeHttpUrl(imageUrl);
  if (!image) return body;
  return CHAT_IMAGE_PREFIX + JSON.stringify({ t: body, i: image });
}

export function unpackChatPayload(raw) {
  const text = typeof raw === "string" ? raw : "";
  if (!text.startsWith(CHAT_IMAGE_PREFIX)) return { text, image: "" };
  try {
    const data = JSON.parse(text.slice(CHAT_IMAGE_PREFIX.length));
    return {
      text: typeof data.t === "string" ? data.t : "",
      image: safeHttpUrl(data.i),
    };
  } catch {
    return { text, image: "" };
  }
}

export function fillChatMessage(el, text, imageUrl) {
  const body = text == null ? "" : String(text);
  const src = safeHttpUrl(imageUrl);
  el.replaceChildren();
  if (body) el.appendChild(document.createTextNode(body));
  if (!src) return;
  if (body) el.appendChild(document.createElement("br"));
  const img = document.createElement("img");
  img.className = "chat-msg-image";
  img.src = src;
  img.alt = "";
  img.addEventListener("click", (event) => {
    event.stopPropagation();
    openPreview(src);
  });
  el.appendChild(img);
}

function showPreview(s, src) {
  if (!s.preview || !s.img) return;
  s.img.src = src;
  s.preview.hidden = false;
  s.preview.style.display = "flex";
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
    s.uploading = true;
    s.btn.disabled = true;
    showPreview(s, s.objectUrl);
    try {
      const url = await uploadChatImage(file);
      if (mine !== s.gen) return;
      if (s.objectUrl) {
        URL.revokeObjectURL(s.objectUrl);
        s.objectUrl = "";
      }
      s.url = url;
      showPreview(s, s.url);
      toast.success("Uploaded");
    } catch (err) {
      if (mine !== s.gen) return;
      clearPendingChatImage(kind);
      toast.error(err.message || "Upload failed");
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
