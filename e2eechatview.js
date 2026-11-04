// Paints one sealed chat file. The worker decrypts. Blob URLs stay in
// memory and are revoked when the bubble leaves the encrypted list.
const PLAY_FACE = '<span class="video-play-glass" aria-hidden="true">'
  + '<svg class="video-play-icon" viewBox="0 0 24 24" focusable="false">'
  + '<path class="is-play" d="M9 6.2v11.6l9.2-5.8z" fill="#22D3EE"></path>'
  + '<path class="is-pause" d="M7 5.5h3.2v13H7zm6.8 0H17v13h-3.2z" fill="#22D3EE"></path>'
  + '</svg></span>';

const blobUrls = new WeakMap();
const liveUrls = new Set();
const mediaByKey = new Map();
let observer = null;
let worker = null;
let jobId = 0;
const jobs = new Map();

function track(el, url) {
  liveUrls.add(url);
  const list = blobUrls.get(el) || [];
  list.push(url);
  blobUrls.set(el, list);
}

function releaseNode(node) {
  if (!node || node.nodeType !== 1) return;
  const list = blobUrls.get(node);
  if (list) {
    for (const url of list) {
      URL.revokeObjectURL(url);
      liveUrls.delete(url);
    }
    blobUrls.delete(node);
  }
  if (typeof node.querySelectorAll === "function") {
    for (const child of node.querySelectorAll("*")) releaseNode(child);
  }
}

function watchList() {
  if (observer || typeof document === "undefined") return;
  const root = document.getElementById("messages-from-encrypted-chat");
  if (!root) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) releaseNode(node);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
}

function revokeAll() {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls.clear();
}

if (typeof window !== "undefined") window.addEventListener("pagehide", revokeAll);

function workerOf() {
  if (worker) return worker;
  worker = new Worker(new URL("./e2eeworker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const data = event.data || {};
    const job = jobs.get(data.id);
    if (!job) return;
    jobs.delete(data.id);
    if (data.ok && data.blob) job.resolve(data.blob);
    else job.reject(new Error("decrypt"));
  };
  worker.onerror = () => {
    for (const job of jobs.values()) job.reject(new Error("decrypt"));
    jobs.clear();
    worker = null;
  };
  return worker;
}

function decryptJob(part) {
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    workerOf().postMessage({
      id,
      url: part.url || "",
      b64: part.b64 || "",
      fileKey: part.fileKey,
      header: part.header,
      mime: part.mime || "",
    });
  });
}

function showFail(node) {
  const fail = document.createElement("p");
  fail.className = "chat-sealed-fail";
  fail.textContent = "Can't decrypt";
  if (node && node.parentNode) node.replaceWith(fail);
  else if (node) node.appendChild(fail);
}

export function rememberSealedChat(payer, created, media) {
  if (!payer || !created || !media) return;
  mediaByKey.set(`${payer}|${created}`, media);
}

export function sealedChatMedia(payer, created) {
  if (!payer || !created) return null;
  return mediaByKey.get(`${payer}|${created}`) || null;
}

async function revealStill(img, box, part) {
  const blob = await decryptJob(part);
  if (!box.isConnected) return;
  const url = URL.createObjectURL(blob);
  track(box, url);
  img.src = url;
}

async function playSealed(box, img, button, media) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const blob = await decryptJob(media);
    if (!box.isConnected) return;
    const url = URL.createObjectURL(blob);
    track(box, url);
    const video = document.createElement("video");
    video.className = "chat-msg-image";
    video.playsInline = true;
    video.controls = true;
    video.src = url;
    img.replaceWith(video);
    button.hidden = true;
    const pending = video.play();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {
    showFail(box);
  }
}

export function mountSealedMedia(el, media) {
  watchList();
  if (!el) return;
  const usable = media && media.fileKey && media.header && media.url;
  if (!usable) {
    const fail = document.createElement("p");
    fail.className = "chat-sealed-fail";
    fail.textContent = "Can't decrypt";
    el.appendChild(fail);
    return;
  }
  const video = typeof media.mime === "string" && media.mime.startsWith("video/");
  const box = document.createElement("div");
  box.className = "chat-sealed";
  const img = document.createElement("img");
  img.className = "chat-msg-image";
  img.alt = "";
  box.appendChild(img);
  if (video) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "video-play";
    button.setAttribute("aria-label", "Play");
    button.innerHTML = PLAY_FACE;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playSealed(box, img, button, media);
    });
    box.appendChild(button);
  }
  el.appendChild(box);
  const poster = media.poster;
  const posterOk = poster && poster.fileKey && poster.header && (poster.b64 || poster.url);
  if (posterOk) {
    revealStill(img, box, poster).catch(() => {
      if (!video) showFail(box);
    });
  } else if (!video) {
    revealStill(img, box, media).catch(() => showFail(box));
  }
}
