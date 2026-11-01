// Install service worker for Meritocracy. v5
// The fetch listener is what the install prompt looks for.
// /api, the app shell, map tiles, WalletConnect, and post pictures stay on
// the network. R2 sends Cache-Control: public, max-age=31536000, immutable,
// so the browser HTTP cache keeps each post picture after the first download.
// Profile picture files whose links this phone has saved are the exception:
// the page sends those links, and a later visit uses the saved file.
// v5 is the picture cache. A no-cors image saves an opaque body and only a
// no-cors request is answered with it. A cors or same-origin request never
// receives an opaque body; that hit is dropped. Older cache names are deleted
// on activate.

const PICTURES = "meritocracy-profile-pictures-v5";
const RETIRED_CACHES = ["meritocracy-post-media", "meritocracy-profile-pictures"];
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
    ...RETIRED_CACHES.map((name) => caches.delete(name)),
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
    // A saved no-cors body is opaque. Replaying it for a CORS image is a
    // network error. Only a no-cors request may receive one.
    if (hit && hit.type === "opaque" && event.request.mode !== "no-cors") {
      try { await cache.delete(event.request); } catch { /* fetch the request */ }
    } else if (hit) {
      return hit;
    }
    const response = await fetch(event.request);
    // Never answer a cors or same-origin request with an opaque body.
    if (response && response.type === "opaque" && event.request.mode !== "no-cors") {
      return Response.error();
    }
    // A plain <img> is no-cors, so a cross-origin picture is opaque (status 0)
    // and response.ok is false. That is the body worth saving. A cors image
    // is saved only when the server actually allowed it.
    const opaqueNoCors = !!(response && response.type === "opaque" && event.request.mode === "no-cors");
    if (response && (opaqueNoCors || (response.ok && response.type !== "opaque"))) {
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
