// Install service worker for Meritocracy. v3
// The fetch listener is what the install prompt looks for.
// /api, the app shell, map tiles, and WalletConnect stay on the network.
// Profile picture files whose links this phone has saved are the exception:
// the page sends those links, and a later visit uses the saved file.
// Post pictures on the R2 host are saved on first view. Videos are not
// intercepted; the browser cache keeps those.

const PICTURES = "meritocracy-profile-pictures";
const MEDIA = "meritocracy-post-media";
const MEDIA_HOST = "pub-243bb90aeefc464884cd212612165e5b.r2.dev";
const MEDIA_MAX = 400;
const SETTINGS_DB = "meritocracy-user-settings";
const knownPictures = new Set();

function rememberPictures(urls) {
  for (const url of urls || []) {
    if (typeof url === "string" && url) knownPictures.add(url);
  }
}

function loadKnownPictures() {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    const request = indexedDB.open(SETTINGS_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("accounts")) {
        database.createObjectStore("accounts", { keyPath: "accountId" });
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta", { keyPath: "id" });
      }
    };
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("accounts")) {
        resolve();
        return;
      }
      const tx = database.transaction("accounts", "readonly");
      const all = tx.objectStore("accounts").getAll();
      all.onsuccess = () => {
        const urls = [];
        for (const row of all.result || []) {
          if (row && row.profilePic) urls.push(row.profilePic);
        }
        rememberPictures(urls);
        resolve();
      };
      all.onerror = () => resolve();
    };
  });
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(loadKnownPictures().then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "profile-pictures") {
    rememberPictures(data.urls);
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
  }
});

function isPostPicture(request, url) {
  if (request.method !== "GET") return false;
  if (request.destination !== "image") return false;
  if (url.host !== MEDIA_HOST) return false;
  if (!url.pathname.startsWith("/markers/")) return false;
  // Videos use Range requests. The browser cache handles them.
  if (/\.(mp4|webm)(\?|#|$)/i.test(url.pathname)) return false;
  return true;
}

async function notifyPictureCacheFull() {
  const pages = await self.clients.matchAll({ type: "window" });
  for (const page of pages) page.postMessage({ type: "picture-cache-full" });
}

async function postPicture(event) {
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  let response;
  try {
    response = await fetch(new Request(event.request.url, { mode: "cors", credentials: "omit" }));
  } catch {
    return fetch(event.request);
  }
  if (response.ok) {
    try {
      await cache.put(event.request, response.clone());
      const keys = await cache.keys();
      let extra = keys.length - MEDIA_MAX;
      for (let i = 0; extra > 0 && i < keys.length; i += 1, extra -= 1) {
        await cache.delete(keys[i]);
      }
    } catch (error) {
      if (error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
        await notifyPictureCacheFull();
      }
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (isPostPicture(event.request, url)) {
    event.respondWith(postPicture(event));
    return;
  }
  if (url.origin === self.location.origin) return;
  if (event.request.destination !== "image") return;
  if (!knownPictures.has(event.request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(PICTURES);
    const hit = await cache.match(event.request);
    if (hit) return hit;
    const response = await fetch(event.request);
    // Image tags use no-cors, so a saved picture is often an opaque response
    // (status 0). Those still replay correctly into an image tag.
    if (response && (response.ok || response.type === "opaque")) {
      try {
        await cache.put(event.request, response.clone());
      } catch (error) {
        if (error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
          const pages = await self.clients.matchAll({ type: "window" });
          for (const page of pages) page.postMessage({ type: "picture-cache-full" });
        }
      }
    }
    return response;
  })());
});
