// Saved profile pictures: a fresh copy is served then refreshed, an old copy
// is fetched first, and the cache drops the oldest past 150 plus unknown links.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function fakeResponse(body, type, ok) {
  return {
    body,
    type,
    ok,
    clone() {
      return fakeResponse(body, type, ok);
    },
  };
}

function createCache() {
  const entries = new Map();
  return {
    async put(request, response) {
      entries.set(request.url, { request, response });
    },
    async match(request) {
      const url = typeof request === "string" ? request : request.url;
      const entry = entries.get(url);
      return entry ? entry.response : undefined;
    },
    async delete(request) {
      const url = typeof request === "string" ? request : request.url;
      return entries.delete(url);
    },
    async keys() {
      return [...entries.values()].map((entry) => entry.request);
    },
  };
}

function loadWorker(clock, fetchImpl, cache) {
  const listeners = {};
  const self = {
    location: { origin: "https://app.example" },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    skipWaiting() {},
    clients: {
      claim() { return Promise.resolve(); },
      matchAll: async () => [],
    },
  };
  const api = new Function(
    "caches",
    "fetch",
    "self",
    "Date",
    "indexedDB",
    `${source}\nreturn { servePicture, storePicture, trimPictures, dropUnknownPictures, loadKnownPictures, knownPictures, PICTURE_CAP, PICTURE_MAX_AGE, pictureSavedAt, pictureKey };`,
  )(
    {
      open: async () => cache,
      delete: async () => true,
    },
    fetchImpl,
    self,
    { now: () => clock.now },
    undefined,
  );
  api.listeners = listeners;
  return api;
}

function pictureRequest(url) {
  return {
    method: "GET",
    url,
    mode: "no-cors",
    destination: "image",
  };
}

function fetchEvent(request) {
  const waits = [];
  let responded = null;
  return {
    waits,
    event: {
      request,
      waitUntil(promise) { waits.push(promise); },
      respondWith(promise) { responded = promise; },
    },
    response() { return responded; },
  };
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test("a picture older than 7 days is refetched before it is served", async () => {
  const cache = createCache();
  const clock = { now: 1_700_000_000_000 };
  const url = "https://cdn.example/old.png";
  let releaseFetch = null;
  let started = false;
  const api = loadWorker(clock, () => {
    started = true;
    return new Promise((resolve) => {
      releaseFetch = () => resolve(fakeResponse("new", "opaque", false));
    });
  }, cache);
  api.knownPictures.add(url);
  const savedAt = clock.now - api.PICTURE_MAX_AGE - 1;
  await cache.put(api.pictureKey(url, savedAt), fakeResponse("old", "opaque", false));

  const flight = fetchEvent(pictureRequest(url));
  api.listeners.fetch(flight.event);
  let settled = false;
  const pending = flight.response().then((response) => {
    settled = true;
    return response;
  });
  await flush();
  assert.equal(started, true);
  assert.equal(settled, false);
  releaseFetch();
  const response = await pending;
  assert.equal(response.body, "new");
  const key = (await cache.keys()).find((item) => item.url === url);
  assert.equal(api.pictureSavedAt(key), clock.now);
  await Promise.all(flight.waits);
});

test("a saved picture with no time is refetched before it is served", async () => {
  const cache = createCache();
  const clock = { now: 1_700_000_000_000 };
  const url = "https://cdn.example/untimed.png";
  const api = loadWorker(clock, async () => fakeResponse("new", "opaque", false), cache);
  api.knownPictures.add(url);
  await cache.put(new Request(url), fakeResponse("old", "opaque", false));
  const flight = fetchEvent(pictureRequest(url));
  api.listeners.fetch(flight.event);
  const response = await flight.response();
  assert.equal(response.body, "new");
  assert.equal(api.pictureSavedAt((await cache.keys())[0]), clock.now);
});

test("a fresh picture is served immediately and replaced in the background", async () => {
  const cache = createCache();
  const savedAt = 1_700_000_000_000;
  const clock = { now: savedAt + 1000 };
  const url = "https://cdn.example/fresh.png";
  let releaseFetch = null;
  const api = loadWorker(clock, () => new Promise((resolve) => {
    releaseFetch = () => resolve(fakeResponse("new", "opaque", false));
  }), cache);
  api.knownPictures.add(url);
  await cache.put(api.pictureKey(url, savedAt), fakeResponse("old", "opaque", false));

  const flight = fetchEvent(pictureRequest(url));
  api.listeners.fetch(flight.event);
  const response = await flight.response();
  assert.equal(response.body, "old");
  assert.equal((await cache.match(url)).body, "old");
  clock.now = savedAt + 5000;
  releaseFetch();
  await Promise.all(flight.waits);
  const key = (await cache.keys()).find((item) => item.url === url);
  assert.equal(api.pictureSavedAt(key), savedAt + 5000);
  assert.equal((await cache.match(url)).body, "new");
});

test("a picture saved exactly 7 days ago is still served from the cache", async () => {
  const cache = createCache();
  const clock = { now: 1_700_000_000_000 };
  const url = "https://cdn.example/edge.png";
  let started = false;
  const api = loadWorker(clock, () => {
    started = true;
    return new Promise(() => {});
  }, cache);
  api.knownPictures.add(url);
  await cache.put(
    api.pictureKey(url, clock.now - api.PICTURE_MAX_AGE),
    fakeResponse("old", "opaque", false),
  );
  const flight = fetchEvent(pictureRequest(url));
  api.listeners.fetch(flight.event);
  const response = await flight.response();
  assert.equal(response.body, "old");
  assert.equal(started, true);
});

test("an expired picture stays when the refetch fails", async () => {
  const cache = createCache();
  const clock = { now: 1_700_000_000_000 };
  const url = "https://cdn.example/offline.png";
  const api = loadWorker(clock, async () => {
    throw new Error("offline");
  }, cache);
  api.knownPictures.add(url);
  const savedAt = clock.now - api.PICTURE_MAX_AGE - 1;
  await cache.put(api.pictureKey(url, savedAt), fakeResponse("old", "opaque", false));
  const flight = fetchEvent(pictureRequest(url));
  api.listeners.fetch(flight.event);
  const response = await flight.response();
  assert.equal(response.body, "old");
  assert.equal(api.pictureSavedAt((await cache.keys())[0]), savedAt);
});

test("the picture cache keeps 150 entries and drops the oldest", async () => {
  const cache = createCache();
  const clock = { now: 10_000_000 };
  const api = loadWorker(clock, async () => fakeResponse("unused", "opaque", false), cache);
  assert.equal(api.PICTURE_CAP, 150);
  for (let i = 0; i < api.PICTURE_CAP; i++) {
    const url = `https://cdn.example/p${i}.png`;
    api.knownPictures.add(url);
    await cache.put(api.pictureKey(url, 1000 + i), fakeResponse(`body-${i}`, "opaque", false));
  }
  await api.trimPictures(cache);
  assert.equal((await cache.keys()).length, 150);

  const extra = "https://cdn.example/new.png";
  api.knownPictures.add(extra);
  const stored = await api.storePicture(
    cache,
    { url: extra, mode: "no-cors" },
    fakeResponse("new", "opaque", false),
  );
  assert.equal(stored, true);
  const keys = await cache.keys();
  const urls = keys.map((key) => key.url);
  assert.equal(urls.length, 150);
  assert.equal(urls.includes("https://cdn.example/p0.png"), false);
  assert.equal(urls.includes("https://cdn.example/p1.png"), true);
  assert.equal(urls.includes(extra), true);
  const newest = keys.find((key) => key.url === extra);
  assert.equal(api.pictureSavedAt(newest), clock.now);
});

test("a picture list update drops cached links that are no longer known", async () => {
  const clock = { now: 1_700_000_000_000 };
  const keep = "https://cdn.example/keep.png";
  const gone = "https://cdn.example/gone.png";

  const earlyCache = createCache();
  const early = loadWorker(clock, async () => fakeResponse("unused", "opaque", false), earlyCache);
  await earlyCache.put(early.pictureKey(keep, clock.now), fakeResponse("keep", "opaque", false));
  await earlyCache.put(early.pictureKey(gone, clock.now), fakeResponse("gone", "opaque", false));
  let earlyPending = null;
  early.listeners.message({
    data: { type: "profile-pictures", urls: [keep] },
    waitUntil(promise) { earlyPending = promise; },
    ports: [],
  });
  await earlyPending;
  assert.equal((await earlyCache.keys()).length, 2);

  const cache = createCache();
  const api = loadWorker(clock, async () => fakeResponse("unused", "opaque", false), cache);
  await cache.put(api.pictureKey(keep, clock.now), fakeResponse("keep", "opaque", false));
  await cache.put(api.pictureKey(gone, clock.now), fakeResponse("gone", "opaque", false));
  await api.loadKnownPictures();
  await api.dropUnknownPictures();
  assert.equal((await cache.keys()).length, 2);

  let pending = null;
  api.listeners.message({
    data: { type: "profile-pictures", urls: [keep] },
    waitUntil(promise) { pending = promise; },
    ports: [],
  });
  await pending;
  const urls = (await cache.keys()).map((key) => key.url);
  assert.deepEqual(urls, [keep]);
  assert.equal(api.knownPictures.has(keep), true);
  assert.equal(api.knownPictures.has(gone), false);
});

test("a cors or same-origin request never receives an opaque picture", async () => {
  const cache = createCache();
  const clock = { now: 1_700_000_000_000 };
  const url = "https://cdn.example/cors.png";
  const api = loadWorker(clock, async () => fakeResponse("hidden", "opaque", false), cache);
  api.knownPictures.add(url);
  await cache.put(api.pictureKey(url, clock.now), fakeResponse("saved", "opaque", false));

  const flight = fetchEvent({
    method: "GET",
    url,
    mode: "cors",
    destination: "image",
  });
  api.listeners.fetch(flight.event);
  const response = await flight.response();
  assert.equal(response.type, "error");
  assert.equal((await cache.keys()).length, 0);

  let responded = false;
  api.listeners.fetch({
    request: {
      method: "GET",
      url: "https://app.example/local.png",
      mode: "same-origin",
      destination: "image",
    },
    waitUntil() {},
    respondWith() { responded = true; },
  });
  assert.equal(responded, false);
});
