// Paints one sealed chat file. The worker decrypts two jobs at a time.
// A still waits until the bubble is near the encrypted list. Blob URLs
// stay in memory and are revoked when the bubble leaves that list.
import { r2PublicBase } from "./r2public.js";

const PLAY_FACE = '<span class="video-play-glass" aria-hidden="true">'
  + '<svg class="video-play-icon" viewBox="0 0 24 24" focusable="false">'
  + '<path class="is-play" d="M9 6.2v11.6l9.2-5.8z" fill="#22D3EE"></path>'
  + '<path class="is-pause" d="M7 5.5h3.2v13H7zm6.8 0H17v13h-3.2z" fill="#22D3EE"></path>'
  + '</svg></span>';

const DECRYPT_LIMIT = 2;
const blobUrls = new WeakMap();
const liveUrls = new Set();
const mediaByKey = new Map();
const waiting = new WeakMap();
let observer = null;
let nearObserver = null;
let worker = null;
let jobId = 0;
let decryptBusy = 0;
const jobs = new Map();
const decryptWait = [];

function track(el, url) {
  liveUrls.add(url);
  const list = blobUrls.get(el) || [];
  list.push(url);
  blobUrls.set(el, list);
}

function cancelNear(node) {
  if (!waiting.has(node)) return;
  waiting.delete(node);
  if (nearObserver) nearObserver.unobserve(node);
}

function releaseNode(node) {
  if (!node || node.nodeType !== 1) return;
  cancelNear(node);
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
    const pending = [...jobs.values()];
    jobs.clear();
    worker = null;
    for (const job of pending) job.reject(new Error("decrypt"));
  };
  return worker;
}

function settleDecrypt(fn, value) {
  decryptBusy = Math.max(0, decryptBusy - 1);
  try {
    fn(value);
  } finally {
    pumpDecrypt();
  }
}

function pumpDecrypt() {
  while (decryptBusy < DECRYPT_LIMIT && decryptWait.length) {
    const run = decryptWait.shift();
    decryptBusy += 1;
    run();
  }
}

function decryptJob(part) {
  return new Promise((resolve, reject) => {
    decryptWait.push(() => {
      const id = ++jobId;
      jobs.set(id, {
        resolve: (blob) => settleDecrypt(resolve, blob),
        reject: (error) => settleDecrypt(reject, error),
      });
      try {
        workerOf().postMessage({
          id,
          url: part.url || "",
          b64: part.b64 || "",
          fileKey: part.fileKey,
          header: part.header,
          mime: part.mime || "",
          size: part.size,
          publicBase: r2PublicBase(),
        });
      } catch (error) {
        jobs.delete(id);
        settleDecrypt(reject, error);
      }
    });
    pumpDecrypt();
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
  if (!box.isConnected) return;
  const blob = await decryptJob(part);
  if (!box.isConnected) return;
  const url = URL.createObjectURL(blob);
  track(box, url);
  img.src = url;
}

function onNear(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const box = entry.target;
    const run = waiting.get(box);
    if (!run) continue;
    waiting.delete(box);
    if (nearObserver) nearObserver.unobserve(box);
    run();
  }
}

function ensureNear() {
  if (nearObserver) return nearObserver;
  if (typeof IntersectionObserver !== "function" || typeof document === "undefined") return null;
  const root = document.getElementById("messages-from-encrypted-chat");
  if (!root) return null;
  const options = { root, rootMargin: "50dvh", threshold: 0 };
  try {
    nearObserver = new IntersectionObserver(onNear, options);
  } catch {
    const half = typeof window !== "undefined" && window.innerHeight
      ? Math.round(window.innerHeight / 2)
      : 0;
    nearObserver = new IntersectionObserver(onNear, {
      root,
      rootMargin: half > 0 ? `${half}px` : "50vh",
      threshold: 0,
    });
  }
  return nearObserver;
}

function scheduleReveal(img, box, part, onFail) {
  const run = () => {
    if (!box.isConnected) return;
    revealStill(img, box, part).catch(() => {
      if (onFail && box.isConnected) onFail();
    });
  };
  const watch = ensureNear();
  if (!watch) {
    run();
    return;
  }
  waiting.set(box, run);
  watch.observe(box);
}

function markPlayBusy(button) {
  button.disabled = true;
  button.classList.add("is-busy");
  button.setAttribute("aria-busy", "true");
}

function restorePlay(button) {
  button.disabled = false;
  button.hidden = false;
  button.classList.remove("is-busy");
  button.removeAttribute("aria-busy");
  button.innerHTML = PLAY_FACE;
  button.setAttribute("aria-label", "Play");
}

function dropPlayFail(box) {
  const next = box.nextElementSibling;
  if (next && next.className === "chat-sealed-fail" && typeof next.remove === "function") next.remove();
}

async function playSealed(box, img, button, media) {
  if (button.disabled) return;
  markPlayBusy(button);
  dropPlayFail(box);
  let blob;
  try {
    blob = await decryptJob(media);
  } catch {
    restorePlay(button);
    const fail = document.createElement("p");
    fail.className = "chat-sealed-fail";
    fail.textContent = "Can't decrypt";
    if (box.parentNode && typeof box.insertAdjacentElement === "function") box.insertAdjacentElement("afterend", fail);
    else box.appendChild(fail);
    return;
  }
  if (!box.isConnected) return;
  const url = URL.createObjectURL(blob);
  track(box, url);
  const video = document.createElement("video");
  video.className = "chat-msg-image";
  video.playsInline = true;
  video.controls = true;
  video.src = url;
  img.replaceWith(video);
  button.classList.remove("is-busy");
  button.removeAttribute("aria-busy");
  button.hidden = true;
  const pending = video.play();
  if (pending && typeof pending.catch === "function") pending.catch(() => {});
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
  if (posterOk) scheduleReveal(img, box, poster, video ? null : () => showFail(box));
  else if (!video) scheduleReveal(img, box, media, () => showFail(box));
}
