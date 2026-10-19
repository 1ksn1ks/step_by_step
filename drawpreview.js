// The draw forms type the post on a popup instead of separate fields.
// The hidden textareas stay, because submit still reads those.
import { connectedAccount } from "./web3.js";
import { clipMessage, messageLimitLength } from "./hcschunks.js";
import { profilePictures, usernames, click2url } from "./loadalladata.js";
import { payerUsernameNode, safeHttpUrl } from "./payerlink.js";
import { paintProfileAvatar } from "./earlyhashinal.js";
import { watchProfilePicture } from "./markertilt.js";
import { syncPopupChrome } from "./loadprofilepopup.js";
import { watchFollowPrefetch } from "./followtopic.js";

const DEFAULT_PIC = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";

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
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url || "");
}

function paintMedia(id, url, kind) {
  const card = document.getElementById(id);
  if (!card) return;
  const img = card.querySelector("img");
  const video = card.querySelector("video");
  const clear = card.querySelector(".draw-popup-clear");
  const videoMode = kind === "video" || isVideoUrl(url);
  if (!url) {
    img.hidden = true;
    img.removeAttribute("src");
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
}

function paintCover(id, url, kind, fieldId) {
  const chip = document.getElementById(id);
  if (chip) {
    chip.classList.toggle("has-cover", !!url);
    chip.textContent = url ? "Cover ✓" : "Cover";
  }
  const preview = document.getElementById(COVER_PREVIEW[fieldId]);
  if (!preview) return;
  const img = preview.querySelector("img");
  const video = preview.querySelector("video");
  const clear = preview.querySelector(".draw-popup-clear");
  const videoMode = !!video && (kind === "video" || isVideoUrl(url));
  if (!url) {
    preview.classList.remove("has-cover", "has-media");
    if (clear) clear.hidden = true;
    if (img) {
      img.hidden = true;
      img.removeAttribute("src");
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
    if (video.getAttribute("src") !== url) {
      video.src = url;
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
  if (img.getAttribute("src") !== url) img.src = url;
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

function bindEditable(editorId, fieldId, singleLine) {
  const el = document.getElementById(editorId);
  const field = document.getElementById(fieldId);
  if (!el || !field) return;
  const max = Number(el.dataset.max) || (singleLine ? 20 : 256);
  const countLeft = el.classList.contains("draw-popup-title") || el.classList.contains("draw-popup-text");
  const used = (text) => singleLine ? text.length : messageLimitLength(text);
  const syncLeft = (text) => {
    if (countLeft) el.dataset.left = String(Math.max(0, max - used(text)));
  };
  const write = () => {
    let text = plainText(el).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (singleLine) text = text.replace(/\n/g, "");
    if (used(text) > max) {
      text = singleLine ? text.slice(0, max) : clipMessage(text, max);
      el.textContent = text;
      placeCaretEnd(el);
    }
    // A cleared box keeps a <br>, which hides the empty placeholder.
    if (!text && el.childNodes.length) el.textContent = "";
    if (field.value !== text) field.value = text;
    syncLeft(text);
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
  const shown = () => {
    let text = plainText(el).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (singleLine) text = text.replace(/\n/g, "");
    return text;
  };
  field.addEventListener("input", () => {
    if (document.activeElement === el) return;
    if (plainText(el) !== field.value) el.textContent = field.value;
    syncLeft(shown());
  });
  syncLeft(shown());
}

function bindUpload(triggerId, pickerId, fieldId, paint) {
  const trigger = document.getElementById(triggerId);
  const picker = document.getElementById(pickerId);
  const field = document.getElementById(fieldId);
  if (!trigger || !picker || !field) return;
  const open = () => picker.click();
  trigger.addEventListener("click", (event) => {
    if (event.target.closest(".draw-popup-clear")) return;
    open();
  });
  if (trigger.tagName !== "BUTTON") {
    trigger.addEventListener("keydown", (event) => {
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

function textOf(value) {
  if (Array.isArray(value)) return String(value[0] || "");
  return typeof value === "string" ? value : "";
}

function httpPicture(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    /* not a picture address */
  }
  return "";
}

function pickerColor(id, fallback) {
  const el = document.getElementById(id);
  return el && el.value ? el.value : fallback;
}

// Same bubble a posted popup paints for this account: picture, Hashpack
// account id, and the username that opens that account's link.
export function paintDrawProfile(root, account = connectedAccount || "") {
  if (!root) return;
  const img = root.querySelector(".popup-profile-bubble > img, .popup-profile-bubble > .early-hashinal > img");
  const heading = root.querySelector(".popup-profile-bubble h2");
  if (!img || !heading) return;

  const rawPic = httpPicture(account && profilePictures[account] && profilePictures[account].url);
  const picture = rawPic && rawPic !== img.dataset.failedPic ? rawPic : DEFAULT_PIC;
  if (img.getAttribute("src") !== picture) img.src = picture;

  let idLink = heading.querySelector(".payer-info");
  if (!idLink) {
    idLink = document.createElement("a");
    idLink.className = "payer-info";
    heading.prepend(idLink);
  }
  idLink.style.textDecoration = "none";
  idLink.style.color = pickerColor("color-picker-popup-accid", "#ffffff");
  if (account) {
    idLink.href = `https://explore.hashpack.app/${encodeURIComponent(account)}`;
    idLink.target = "_blank";
    idLink.rel = "noopener noreferrer";
    idLink.textContent = account;
  } else {
    idLink.removeAttribute("href");
    idLink.removeAttribute("target");
    idLink.removeAttribute("rel");
    idLink.textContent = "";
  }

  const name = textOf(account && usernames[account] && usernames[account].username).trim();
  const link = textOf(account && click2url[account] && click2url[account].click2url).trim();
  const wantHref = safeHttpUrl(link);
  let nameNode = heading.querySelector(".username");
  const sameName = nameNode
    && nameNode.textContent === name
    && (nameNode.getAttribute("href") || "") === wantHref;
  if (!name) {
    if (nameNode) nameNode.remove();
  } else if (!sameName) {
    if (nameNode) nameNode.remove();
    nameNode = payerUsernameNode(name, link, { className: "username" });
    heading.appendChild(nameNode);
  }
  if (name && nameNode) nameNode.style.color = pickerColor("color-picker-popup-username", "#ffffff");
  paintProfileAvatar(img, account);
  watchProfilePicture(img);
  watchFollowPrefetch(img, account);
  const sheet = root.querySelector(".popup-sheet");
  if (sheet) sheet.dataset.popupPayer = typeof account === "string" ? account : "";
  syncPopupChrome(root.querySelector(".maplibregl-popup"));
}

function bindAccount(editorId) {
  const root = document.getElementById(editorId);
  if (!root) return;
  const img = root.querySelector(".popup-profile-bubble > img, .popup-profile-bubble > .early-hashinal > img");
  if (img) {
    img.addEventListener("error", () => {
      const failed = img.getAttribute("src");
      if (!failed || failed === DEFAULT_PIC) return;
      img.dataset.failedPic = failed;
      img.src = DEFAULT_PIC;
    });
    img.addEventListener("click", (event) => {
      if (!connectedAccount || typeof window.loadBio4PIC !== "function") return;
      event.stopPropagation();
      window.loadBio4PIC(connectedAccount);
    });
  }
  const paint = () => paintDrawProfile(root);
  paint();
  return paint;
}

bindEditable("draw-marker-title", "input-field-2-1", true);
bindEditable("draw-marker-text", "input-field-2-2", false);
bindEditable("draw-polygon-title", "input-field-3-1", true);
bindEditable("draw-polygon-text", "input-field-3-2", false);
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
