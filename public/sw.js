// Install service worker for Meritocracy. v5
// The fetch listener is what the install prompt looks for.
// /api, the app shell, map tiles, WalletConnect, and post pictures stay on
// the network. R2 sends Cache-Control: public, max-age=31536000, immutable,
// so the browser HTTP cache keeps each post picture after the first download.
// Profile picture files whose links this phone has saved are the exception.
// A copy from the last 7 days is shown at once and refreshed behind that
// visit. Older than that, the network answers first. The cache keeps 150
// pictures and drops the oldest. A cached file whose link is not in the
// page's list is deleted when that list is applied.
// v5 is the picture cache. A no-cors image saves an opaque body and only a
// no-cors request is answered with it. A cors or same-origin request never
// receives an opaque body; that hit is dropped. Older cache names are deleted
// on activate.

const PICTURES = "meritocracy-profile-pictures-v5";
const RETIRED_CACHES = ["meritocracy-post-media", "meritocracy-profile-pictures"];
const SETTINGS_DB = "meritocracy-user-settings";
const PICTURE_CAP = 150;
const PICTURE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const knownPictures = new Set();
// Set once the saved accounts have been read. A picture message before that
// only adds links, so a short list cannot wipe the cache first.
let picturesLoaded = false;

function rememberPictures(urls) {
  // The page sends its full list. Once the saved accounts are loaded, that
  // list replaces the set so a removed account's picture can be dropped.
  // Before that, only add: a short list must not wipe the cache.
  if (picturesLoaded) knownPictures.clear();
  for (const url of urls || []) {
    if (typeof url !== "string" || !url) continue;
    try {
      knownPictures.add(new URL(url).href);
    } catch {
      // Skip a link the browser would not request.
    }
  }
}

// An opaque body has no headers we can write. The time rides on the cache
// key, which cache.keys() still returns. A missing time is treated as old.
function pictureSavedAt(request) {
  if (!request || !request.headers || typeof request.headers.get !== "function") return 0;
  const savedAt = Number(request.headers.get("x-saved-at"));
  return Number.isFinite(savedAt) ? savedAt : 0;
}

function pictureKey(url, savedAt) {
  return new Request(url, { headers: { "x-saved-at": String(savedAt) } });
}

function pictureIsFresh(savedAt) {
  return savedAt > 0 && Date.now() - savedAt <= PICTURE_MAX_AGE;
}

function pictureIsCacheable(request, response) {
  if (!response) return false;
  const opaqueNoCors = response.type === "opaque" && request.mode === "no-cors";
  return !!(opaqueNoCors || (response.ok && response.type !== "opaque"));
}

// One address only. Listing the whole cache here walks every saved picture.
async function findPicture(cache, url) {
  const keys = await cache.keys(url);
  for (const key of keys) {
    if (key.url === url) return key;
  }
  return null;
}

async function dropUnknownPictures() {
  // An empty set means the list has not arrived, not that every picture went.
  if (knownPictures.size === 0) return;
  const cache = await caches.open(PICTURES);
  const keys = await cache.keys();
  await Promise.all(keys.map((key) => (
    knownPictures.has(key.url) ? Promise.resolve() : cache.delete(key)
  )));
}

async function trimPictures(cache) {
  const keys = await cache.keys();
  if (keys.length <= PICTURE_CAP) return;
  const ranked = keys.map((key) => ({ key, savedAt: pictureSavedAt(key) }));
  ranked.sort((a, b) => {
    if (a.savedAt !== b.savedAt) return a.savedAt - b.savedAt;
    if (a.key.url < b.key.url) return -1;
    if (a.key.url > b.key.url) return 1;
    return 0;
  });
  const extra = ranked.length - PICTURE_CAP;
  await Promise.all(ranked.slice(0, extra).map((item) => cache.delete(item.key)));
}

async function storePicture(cache, request, response) {
  if (!knownPictures.has(request.url)) return false;
  if (!pictureIsCacheable(request, response)) return false;
  try {
    // A refresh replaces this same link, so the count does not grow.
    const existing = await findPicture(cache, request.url);
    await cache.put(pictureKey(request.url, Date.now()), response.clone());
    if (!existing) await trimPictures(cache);
    return true;
  } catch (error) {
    if (error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
      try {
        const pages = await self.clients.matchAll({ type: "window" });
        for (const page of pages) page.postMessage({ type: "picture-cache-full" });
      } catch {
        // The picture still reaches the page.
      }
    }
    return false;
  }
}

async function revalidatePicture(request) {
  try {
    if (!knownPictures.has(request.url)) return;
    const response = await fetch(request);
    if (!knownPictures.has(request.url)) return;
    // Never replace a saved picture with an opaque body for a cors request.
    if (!response || (response.type === "opaque" && request.mode !== "no-cors")) return;
    const cache = await caches.open(PICTURES);
    await storePicture(cache, request, response);
  } catch {
    // The saved copy stays.
  }
}

async function servePicture(request, finish) {
  let background = null;
  try {
    const cache = await caches.open(PICTURES);
    const key = await findPicture(cache, request.url);
    let hit = null;
    if (key) {
      hit = await cache.match(key);
      // A saved no-cors body is opaque. Replaying it for a CORS image is a
      // network error. Only a no-cors request may receive one.
      if (hit && hit.type === "opaque" && request.mode !== "no-cors") {
        try { await cache.delete(key); } catch { /* fetch the request */ }
        hit = null;
      }
    }
    if (hit && pictureIsFresh(pictureSavedAt(key))) {
      background = revalidatePicture(request);
      return hit;
    }
    let response = null;
    try {
      response = await fetch(request);
    } catch (error) {
      if (hit) return hit;
      throw error;
    }
    // Never answer a cors or same-origin request with an opaque body.
    if (response && response.type === "opaque" && request.mode !== "no-cors") {
      if (hit) return hit;
      return Response.error();
    }
    if (pictureIsCacheable(request, response)) {
      await storePicture(cache, request, response);
      return response;
    }
    if (hit) return hit;
    return response;
  } finally {
    if (typeof finish === "function") finish(background || Promise.resolve());
  }
}

function loadKnownPictures() {
  return new Promise((resolve) => {
    const finish = () => {
      picturesLoaded = true;
      resolve();
    };
    if (typeof indexedDB === "undefined") {
      finish();
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
    request.onerror = () => finish();
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("accounts")) {
        finish();
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
        finish();
      };
      all.onerror = () => finish();
    };
  });
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    loadKnownPictures().then(() => dropUnknownPictures()),
    ...RETIRED_CACHES.map((name) => caches.delete(name)),
  ]).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "profile-pictures") {
    rememberPictures(data.urls);
    const pending = picturesLoaded ? dropUnknownPictures() : Promise.resolve();
    if (event.waitUntil) event.waitUntil(pending);
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) return;
  if (event.request.destination !== "image") return;
  if (!knownPictures.has(event.request.url)) return;
  let settled = false;
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  event.waitUntil(gate);
  event.respondWith(servePicture(event.request, (promise) => {
    if (settled) return;
    settled = true;
    release(promise || Promise.resolve());
  }));
});
