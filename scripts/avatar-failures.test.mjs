// A profile picture thumbnail that fails (avatarsrc.js, loopmedia.js) is
// remembered: asked for once however many draws want it, the original
// drawn instead until AVATAR_FAIL_MS is up, an original that fails too goes
// straight to the default avatar, a route that is missing or down turns
// thumbnails off for a while, and draws of one thumbnail share its load.
// Thumbnails that work are drawn as before.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  AVATAR_FAIL_MS,
  AVATAR_PATH,
  AVATAR_ROUTE_FAILS,
  AVATAR_ROUTE_OFF_MS,
  AVATAR_ROUTE_WINDOW_MS,
  AVATAR_VERSION,
  avatarRouteAnswerDown,
  avatarRouteState,
  avatarSrc,
  avatarThumbFailed,
  avatarThumbSrc,
  isAvatarThumb,
  resetAvatarState,
} from "../avatarsrc.js";
import { AVATAR_WAIT_MS, pictureElement, presentImage } from "../loopmedia.js";
import { profilePictureUrls } from "../picturecache.js";
import { avatarRoute, clearAvatarCache, fetchAvatarSource } from "../server/avatar.js";

globalThis.location = { origin: "https://app.test" };

const thumbOf = (link) => `${location.origin}${AVATAR_PATH}?src=${encodeURIComponent(link)}&v=${AVATAR_VERSION}`;

// A page's images, the way a browser loads them: an src set starts a load
// on the next turn (one replaced before then is dropped), a lazy image
// waits until it scrolls in, and a picture that loaded once comes from the
// cache. answer(url): true loads, false fails, "hang" never answers.
function fakePage(answer) {
  const asked = [];
  const queue = [];
  const deferred = [];
  const cached = new Set();

  function fire(el, type) {
    let stopped = false;
    const event = { type, target: el, stopImmediatePropagation() { stopped = true; } };
    for (const capture of [true, false]) {
      for (const entry of el.listeners.slice()) {
        if (entry.type !== type || entry.capture !== capture) continue;
        entry.fn.call(el, event);
        if (stopped) return;
      }
    }
    const handler = el[`on${type}`];
    if (typeof handler === "function") handler.call(el, event);
  }

  function img() {
    const attrs = new Map();
    const classes = new Set();
    const el = {
      tagName: "IMG",
      dataset: {},
      listeners: [],
      loading: "auto",
      near: true,
      complete: true,
      onload: null,
      onerror: null,
      alt: "",
      decoding: "",
      className: "",
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
      },
      getAttribute: (key) => (attrs.has(key) ? attrs.get(key) : null),
      setAttribute(key, value) {
        if (key === "src") el.src = value;
        else attrs.set(key, String(value));
      },
      removeAttribute(key) {
        attrs.delete(key);
        if (key === "src") el.complete = true;
      },
      get src() { return attrs.get("src") || ""; },
      set src(value) {
        attrs.set("src", String(value));
        el.complete = false;
        queue.push({ el, url: String(value) });
      },
      previousElementSibling: null,
      parentNode: null,
      parentElement: null,
      isConnected: false,
      closest: () => null,
      addEventListener(type, fn, capture) {
        el.listeners.push({ type, fn, capture: capture === true || !!(capture && capture.capture) });
      },
      dispatchEvent(event) {
        fire(el, event.type);
        return true;
      },
    };
    return el;
  }

  function startAll() {
    const batch = queue.splice(0);
    for (const item of batch) {
      const { el, url } = item;
      if (el.getAttribute("src") !== url) continue;
      if (el.loading === "lazy" && !el.near) {
        deferred.push(item);
        continue;
      }
      if (cached.has(url)) {
        el.complete = true;
        fire(el, "load");
        continue;
      }
      asked.push(url);
      const result = answer(url);
      if (result === "hang") continue;
      el.complete = true;
      if (result) cached.add(url);
      fire(el, result ? "load" : "error");
    }
    return batch.length;
  }

  return {
    img,
    asked,
    count: (url) => asked.filter((entry) => entry === url).length,
    scrollIn(el) {
      el.near = true;
      for (let i = deferred.length - 1; i >= 0; i -= 1) {
        if (deferred[i].el === el) queue.push(...deferred.splice(i, 1));
      }
    },
    // Loads, error events sent a turn later, and route checks, until
    // nothing is left to do.
    async settle() {
      let quiet = 0;
      while (quiet < 3) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setImmediate(resolve));
        quiet = startAll() ? 0 : quiet + 1;
      }
    },
  };
}

test("a failing thumbnail is asked for once, however many draws want it", async () => {
  resetAvatarState({ checkRoute: async () => false });
  const link = "https://cdn.example/gone.png";
  const thumb = thumbOf(link);
  const page = fakePage((url) => url !== thumb);
  assert.equal(avatarSrc(link), thumb);

  // A feed of one author's cards, some from addresses worked out earlier
  // (a marker's imageUrl).
  const first = [];
  for (let i = 0; i < 30; i += 1) first.push(presentImage(page.img(), i % 3 ? avatarSrc(link) : thumb));
  await page.settle();
  assert.equal(page.count(thumb), 1, "one request for thirty draws");
  for (const img of first) assert.equal(img.getAttribute("src"), link, "each shows the original");

  // Remembered: avatarSrc hands out the original, and a thumbnail address
  // drawn again paints it, with no request.
  for (let i = 0; i < 100; i += 1) assert.equal(avatarSrc(link), link);
  assert.equal(avatarSrc(thumb), link);
  assert.equal(avatarSrc(avatarSrc(link)), link, "still safe to call twice");
  for (let i = 0; i < 30; i += 1) presentImage(page.img(), i % 2 ? thumb : avatarSrc(link));
  await page.settle();
  assert.equal(page.count(thumb), 1, "redraws never ask again");
  assert.equal(avatarRouteState().off, false, "one picture does not turn thumbnails off");
});

test("an original that fails too goes straight to the default avatar, and is not asked for again", async () => {
  resetAvatarState({ checkRoute: async () => false });
  const link = "https://cdn.example/broken.jpg";
  const thumb = thumbOf(link);
  const fallback = "https://app.test/default-avatar.png";
  const page = fakePage((url) => url === fallback);
  globalThis.document = { createElement: () => page.img() };
  try {
    const first = pictureElement(avatarSrc(link), { fallback });
    await page.settle();
    assert.equal(first.getAttribute("src"), fallback, "thumbnail -> original -> default avatar");
    assert.deepEqual([page.count(thumb), page.count(link)], [1, 1]);

    // Every later draw shows the default at once: no request for either.
    const later = [];
    for (let i = 0; i < 20; i += 1) later.push(pictureElement(i % 2 ? thumb : avatarSrc(link), { fallback }));
    // A marker dot has no default: its own error handler shows a blank face.
    const blank = [];
    const dot = pictureElement(thumb, { alt: "" });
    dot.onerror = () => blank.push("blank");
    await page.settle();
    assert.deepEqual([page.count(thumb), page.count(link)], [1, 1], "nothing asked again");
    for (const img of later) assert.equal(img.getAttribute("src"), fallback);
    assert.equal(dot.getAttribute("src"), null);
    assert.deepEqual(blank, ["blank"], "once, not a loop");
  } finally {
    delete globalThis.document;
  }
});

test("a failed thumbnail and original are asked for again once AVATAR_FAIL_MS is up", async () => {
  let now = 9_000_000;
  resetAvatarState({ now: () => now, checkRoute: async () => false });
  const link = "https://cdn.example/later.png";
  const thumb = thumbOf(link);
  let thumbWorks = false;
  const page = fakePage((url) => (url === thumb ? thumbWorks : false));
  presentImage(page.img(), avatarSrc(link));
  await page.settle();
  assert.deepEqual([page.count(thumb), page.count(link)], [1, 1]);

  now += AVATAR_FAIL_MS - 1;
  assert.equal(avatarSrc(link), link);
  presentImage(page.img(), thumb);
  await page.settle();
  assert.deepEqual([page.count(thumb), page.count(link)], [1, 1], "still remembered");

  now += 1;
  thumbWorks = true;
  assert.equal(avatarSrc(link), thumb, "time is up: the thumbnail is asked for again");
  const img = presentImage(page.img(), avatarSrc(link));
  await page.settle();
  assert.equal(page.count(thumb), 2);
  assert.equal(img.getAttribute("src"), thumb);
});

test("different thumbnails failing while the route is down turn thumbnails off, then one check brings them back", async () => {
  let now = 1_000_000;
  const checks = [];
  let routeDown = true;
  resetAvatarState({ now: () => now, checkRoute: async (thumb) => { checks.push(thumb); return routeDown; } });
  const page = fakePage((url) => !isAvatarThumb(url) || !routeDown);
  const links = [1, 2, 3, 4, 5].map((n) => `https://cdn${n}.example/face.png`);

  for (const link of links.slice(0, AVATAR_ROUTE_FAILS - 1)) presentImage(page.img(), avatarSrc(link));
  await page.settle();
  assert.equal(checks.length, 0, "two are not enough");
  presentImage(page.img(), avatarSrc(links[2]));
  await page.settle();
  assert.deepEqual(checks, [thumbOf(links[2])], "the third makes one check, of the thumbnail that failed");
  assert.equal(avatarRouteState().off, true);

  // Off: every picture is drawn from its original, no thumbnail requested,
  // including an address worked out before the route went off.
  assert.equal(avatarSrc(links[3]), links[3]);
  const fresh = presentImage(page.img(), avatarSrc(links[3]));
  const marker = presentImage(page.img(), thumbOf(links[4]));
  await page.settle();
  assert.equal(fresh.getAttribute("src"), links[3]);
  assert.equal(marker.getAttribute("src"), links[4]);
  assert.deepEqual([page.count(thumbOf(links[3])), page.count(thumbOf(links[4]))], [0, 0]);

  // AVATAR_ROUTE_OFF_MS later, one check. Still down: off again.
  now += AVATAR_ROUTE_OFF_MS - 1;
  assert.equal(avatarSrc(links[3]), links[3]);
  await page.settle();
  assert.equal(checks.length, 1, "no check before the pause is over");
  now += 1;
  assert.equal(avatarSrc(links[3]), links[3], "originals until the check answers");
  assert.equal(avatarSrc(links[4]), links[4]);
  await page.settle();
  assert.equal(checks.length, 2, "one check, however many draws");
  assert.equal(avatarRouteState().off, true);

  // The files this phone keeps are still the thumbnails, so the service
  // worker does not drop its saved copies during the outage.
  assert.deepEqual(profilePictureUrls([{ profilePic: links[0] }], [{ profilePic: links[3] }]), [thumbOf(links[0]), thumbOf(links[3])]);
  assert.equal(avatarThumbSrc(links[3]), thumbOf(links[3]));

  // The route is back: the next check turns thumbnails on.
  routeDown = false;
  now += AVATAR_ROUTE_OFF_MS;
  avatarSrc(links[3]);
  await page.settle();
  assert.equal(checks.length, 3);
  assert.equal(avatarRouteState().off, false);
  assert.equal(avatarSrc(links[3]), thumbOf(links[3]));
  const back = presentImage(page.img(), avatarSrc(links[3]));
  await page.settle();
  assert.equal(back.getAttribute("src"), thumbOf(links[3]));
});

test("pictures that are only missing, or failures far apart, leave thumbnails on", async () => {
  let now = 5_000_000;
  const checks = [];
  const dead = [1, 2, 3].map((n) => `https://gone${n}.example/a.png`);
  const page = fakePage((url) => !dead.some((link) => url === thumbOf(link)));

  // Our route answered "source not found" for each: the check says so.
  resetAvatarState({ now: () => now, checkRoute: async (thumb) => { checks.push(thumb); return false; } });
  for (const link of dead) presentImage(page.img(), avatarSrc(link));
  await page.settle();
  assert.equal(checks.length, 1);
  assert.equal(avatarRouteState().off, false);
  assert.equal(avatarSrc("https://cdn.example/fine-too.png"), thumbOf("https://cdn.example/fine-too.png"));
  assert.equal(avatarSrc(dead[0]), dead[0], "each missing one stays remembered on its own");

  // Further apart than AVATAR_ROUTE_WINDOW_MS: not a run, no check.
  checks.length = 0;
  resetAvatarState({ now: () => now, checkRoute: async (thumb) => { checks.push(thumb); return true; } });
  for (const link of dead) {
    presentImage(page.img(), avatarSrc(link));
    await page.settle();
    now += AVATAR_ROUTE_WINDOW_MS + 1;
  }
  assert.equal(checks.length, 0);
  assert.equal(avatarRouteState().off, false);
});

test("a thumbnail that works: one load for many draws, then drawn at once", async () => {
  resetAvatarState({ checkRoute: async () => false });
  const link = "https://cdn.example/fine.png";
  const thumb = thumbOf(link);
  const broken = "https://cdn.example/someone-else.png";
  const page = fakePage((url) => url !== thumbOf(broken));
  // Another picture failing changes nothing for this one.
  presentImage(page.img(), avatarSrc(broken));

  const imgs = Array.from({ length: 20 }, () => presentImage(page.img(), avatarSrc(link)));
  assert.equal(imgs[0].getAttribute("src"), thumb, "the first draw loads it as before");
  assert.ok(imgs.slice(1).every((img) => img.getAttribute("src") === null), "the others wait for that load");
  await page.settle();
  assert.equal(page.count(thumb), 1);
  for (const img of imgs) {
    assert.equal(img.getAttribute("src"), thumb);
    assert.equal(img.classList.contains("is-media-pending"), false);
  }

  // Loaded once: a later draw is painted at once.
  const again = presentImage(page.img(), thumb);
  assert.equal(again.getAttribute("src"), thumb);
  assert.equal(avatarSrc(link), thumb);
  assert.equal(avatarSrc(thumb), thumb);
  await page.settle();
  assert.equal(page.count(thumb), 1);
  assert.equal(page.count(link), 0, "the original is never asked for");
});

test("a lazy draw, or one painted with something else first, hands the load on", async () => {
  resetAvatarState({ checkRoute: async () => false });
  const link = "https://cdn.example/rows.png";
  const thumb = thumbOf(link);
  const page = fakePage((url) => url !== thumb);

  // A held cluster's list: rows load as they scroll in (markerstack.js).
  const row = presentImage(page.img(), avatarSrc(link));
  row.loading = "lazy";
  row.near = false;
  const card = presentImage(page.img(), avatarSrc(link));
  assert.equal(card.getAttribute("src"), thumb, "a row off screen does not hold the card back");
  await page.settle();
  assert.equal(page.count(thumb), 1);
  assert.equal(card.getAttribute("src"), link);
  assert.equal(row.getAttribute("src"), link, "the row is moved to the original before it asks");
  page.scrollIn(row);
  await page.settle();
  assert.equal(page.count(thumb), 1);

  // The loader is painted with a post picture first: a waiting draw loads it.
  const other = "https://cdn.example/swap.png";
  const otherThumb = thumbOf(other);
  const a = presentImage(page.img(), avatarSrc(other));
  const b = presentImage(page.img(), avatarSrc(other));
  assert.equal(b.getAttribute("src"), null);
  presentImage(a, "https://cdn.example/post.png");
  assert.equal(b.getAttribute("src"), otherThumb);
  await page.settle();
  assert.equal(page.count(otherThumb), 1, "a's load was dropped before it started");
  assert.equal(b.getAttribute("src"), otherThumb);
  assert.equal(a.getAttribute("src"), "https://cdn.example/post.png");
});

test("a load that never answers holds no draw back past AVATAR_WAIT_MS", (t) => {
  resetAvatarState({ checkRoute: async () => false });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const link = "https://cdn.example/stuck.png";
    const thumb = thumbOf(link);
    const page = fakePage(() => "hang");
    presentImage(page.img(), avatarSrc(link));
    const waiting = presentImage(page.img(), avatarSrc(link));
    assert.equal(waiting.getAttribute("src"), null);
    t.mock.timers.tick(AVATAR_WAIT_MS - 1);
    assert.equal(waiting.getAttribute("src"), null);
    t.mock.timers.tick(1);
    assert.equal(waiting.getAttribute("src"), thumb, "it loads the thumbnail itself");
  } finally {
    t.mock.timers.reset();
  }
});

test("what the route check reads as missing or down", () => {
  const json = "application/json; charset=utf-8";
  const ours = (error) => ({ ok: false, error });
  assert.equal(avatarRouteAnswerDown(200, "image/webp", null), false);
  for (const [status, error] of [[400, "bad src"], [403, "source not allowed"], [404, "source not found"], [413, "source too large"], [415, "not a picture"]]) {
    assert.equal(avatarRouteAnswerDown(status, json, ours(error)), false, `our ${status}: this picture only`);
  }
  for (const [status, error] of [[429, "rate limit"], [502, "source unavailable"], [503, "busy"]]) {
    assert.equal(avatarRouteAnswerDown(status, json, ours(error)), true, `our ${status}`);
  }
  // Not our route: a server without it, a proxy with no server behind it,
  // the app's page instead of a picture.
  assert.equal(avatarRouteAnswerDown(404, "text/html; charset=utf-8", null), true);
  assert.equal(avatarRouteAnswerDown(404, json, { error: "not found" }), true);
  assert.equal(avatarRouteAnswerDown(500, "text/plain", null), true);
  assert.equal(avatarRouteAnswerDown(504, "", null), true);
  assert.equal(avatarRouteAnswerDown(200, "text/html", null), true);
});

async function serve(app) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function checked() {
  for (let i = 0; i < 200 && avatarRouteState().checking; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  return avatarRouteState();
}

test("the real check: our route's misses keep thumbnails on, a server without the route turns them off", async () => {
  const saved = globalThis.location;
  const nowhere = (url) => fetchAvatarSource(url, { lookup: (host, options, callback) => callback(Object.assign(new Error("nx"), { code: "ENOTFOUND" })) });
  const withRoute = express();
  withRoute.get(AVATAR_PATH, avatarRoute({ fetchSource: nowhere, isProfileSource: () => true }));
  const without = express();
  const servers = [await serve(withRoute), await serve(without)];
  try {
    for (const [server, down] of [[servers[0], false], [servers[1], true]]) {
      clearAvatarCache();
      resetAvatarState();
      globalThis.location = { origin: server.base };
      for (const n of [1, 2, 3]) avatarThumbFailed(avatarSrc(`https://gone${n}.example/a.png`));
      assert.equal((await checked()).off, down, server.base);
    }
  } finally {
    globalThis.location = saved;
    await Promise.all(servers.map((server) => server.close()));
    clearAvatarCache();
    resetAvatarState();
  }
});
