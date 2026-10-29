// Install service worker for Meritocracy. v4
// The fetch listener is what the install prompt looks for.
// /api, the app shell, map tiles, WalletConnect, and post pictures stay on
// the network. R2 sends Cache-Control: public, max-age=31536000, immutable,
// so the browser HTTP cache keeps each post picture after the first download.
// Profile picture files whose links this phone has saved are the exception:
// the page sends those links, and a later visit uses the saved file.

const PICTURES = "meritocracy-profile-pictures";
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
  event.waitUntil(Promise.all([
    loadKnownPictures(),
    caches.delete("meritocracy-post-media"),
  ]).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "profile-pictures") {
    rememberPictures(data.urls);
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
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
