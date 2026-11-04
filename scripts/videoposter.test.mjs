// Video posters: resize, the upload choice, and a sealed chat still.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  THUMB_EDGE,
  bindVideoPoster,
  cachedVideoFrame,
  captureVideoPoster,
  e2eeWireBytes,
  fitThumb,
  packSealedThumb,
  posterFlags,
  posterPlan,
  posterSrc,
  rememberVideoFrame,
  resetVideoFrames,
  sealedThumbHidden,
  unpackSealedThumb,
} from "../videoposter.js";

test("a thumbnail keeps an even long edge of 720 and does not grow", () => {
  assert.equal(THUMB_EDGE, 720);
  assert.deepEqual(fitThumb(1000, 400), { width: 720, height: 288 });
  assert.deepEqual(fitThumb(100, 40), { width: 100, height: 40 });
  assert.deepEqual(fitThumb(31, 11), { width: 30, height: 10 });
  assert.deepEqual(fitThumb(0, 40), { width: 0, height: 0 });
  const wide = fitThumb(2000, 1001);
  assert.ok(wide.width <= 720 && wide.height <= 720);
  assert.equal(wide.width % 2, 0);
  assert.equal(wide.height % 2, 0);
});

test("a custom picture wins, a removal uploads nothing, and a missed frame does not block", () => {
  const custom = { name: "custom" };
  const frame = { name: "frame" };
  assert.deepEqual(posterPlan({ removed: true, custom, captured: frame }), {
    upload: false,
    file: null,
    reason: "removed",
  });
  assert.deepEqual(posterPlan({ custom, captured: frame }), {
    upload: true,
    file: custom,
    reason: "custom",
  });
  assert.deepEqual(posterPlan({ captured: frame }), {
    upload: true,
    file: frame,
    reason: "frame",
  });
  assert.deepEqual(posterPlan({}), {
    upload: false,
    file: null,
    reason: "capture-failed",
  });
});

test("a poster address is the sibling still, unless the sender turned it off", () => {
  const video = "https://cdn.example/markers/12-ab.mp4";
  assert.equal(posterSrc(video, { posterOff: true }), "");
  assert.equal(posterSrc(video, { poster: "data:image/jpeg;base64,QQ" }), "data:image/jpeg;base64,QQ");
  assert.equal(posterSrc(video, { posterV: 9 }), "https://cdn.example/markers/12-ab.poster.jpg?v=9");
  assert.deepEqual(posterFlags({ posterOff: true, posterV: 9 }), { posterOff: true, posterV: 0 });
  assert.deepEqual(posterFlags({ posterV: 9 }), { posterOff: false, posterV: 9 });
});

test("a cross-origin poster url sets crossOrigin and a thrown toBlob is null", async () => {
  const previous = globalThis.document;
  const seen = [];
  const video = {
    muted: false,
    playsInline: false,
    preload: "",
    duration: 2,
    videoWidth: 320,
    videoHeight: 180,
    currentTime: 0,
    onloadeddata: null,
    onerror: null,
    _crossOrigin: "",
    set crossOrigin(value) { this._crossOrigin = value; },
    get crossOrigin() { return this._crossOrigin; },
    set src(value) {
      seen.push(this._crossOrigin);
      this._src = value;
      queueMicrotask(() => {
        if (typeof this.onloadeddata === "function") this.onloadeddata();
      });
    },
    addEventListener(type, fn) {
      if (type === "seeked") queueMicrotask(fn);
    },
    removeEventListener() {},
    removeAttribute() {},
    load() {},
  };
  globalThis.document = {
    createElement(tag) {
      if (tag === "video") return video;
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() { return { drawImage() {} }; },
          toBlob() { throw new Error("tainted"); },
        };
      }
      return {};
    },
  };
  try {
    const file = await captureVideoPoster("https://cdn.example/markers/12-ab.mp4");
    assert.equal(file, null);
    assert.deepEqual(seen, ["anonymous"]);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("an upload frame keeps preload auto and a 720 edge", async () => {
  const previous = globalThis.document;
  let canvas = null;
  const seen = { preload: "", cross: "" };
  globalThis.document = {
    createElement(tag) {
      if (tag === "video") {
        return {
          muted: false,
          playsInline: false,
          preload: "",
          duration: 2,
          videoWidth: 2000,
          videoHeight: 1000,
          currentTime: 0,
          onloadeddata: null,
          onerror: null,
          _crossOrigin: "",
          set crossOrigin(value) { this._crossOrigin = value; },
          get crossOrigin() { return this._crossOrigin; },
          set src(_value) {
            seen.preload = this.preload;
            seen.cross = this._crossOrigin;
            queueMicrotask(() => {
              if (typeof this.onloadeddata === "function") this.onloadeddata();
            });
          },
          addEventListener(type, fn) {
            if (type === "seeked") queueMicrotask(fn);
          },
          removeEventListener() {},
          removeAttribute() {},
          load() {},
        };
      }
      if (tag === "canvas") {
        canvas = {
          width: 0,
          height: 0,
          getContext() { return { drawImage() {} }; },
          toBlob(cb) { cb(new Blob(["jpeg"], { type: "image/jpeg" })); },
        };
        return canvas;
      }
      return {};
    },
  };
  try {
    const frame = await captureVideoPoster(new File(["video"], "clip.mp4", { type: "video/mp4" }));
    assert.ok(frame instanceof File);
    assert.equal(seen.preload, "auto");
    assert.equal(seen.cross, "");
    assert.equal(canvas.width, 720);
    assert.equal(canvas.height, 360);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("viewer grabs run two at a time and a grab that leaves is aborted", async () => {
  const previousDoc = globalThis.document;
  const previousIO = globalThis.IntersectionObserver;
  const captures = [];
  const canvases = [];
  const watches = [];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  function makeGrabVideo() {
    return {
      muted: false,
      playsInline: false,
      preload: "",
      duration: 2,
      videoWidth: 1000,
      videoHeight: 400,
      currentTime: 0,
      onloadeddata: null,
      onerror: null,
      srcClears: 0,
      _src: "",
      _crossOrigin: "",
      preloadAtSrc: "",
      crossAtSrc: "",
      set crossOrigin(value) { this._crossOrigin = value; },
      get crossOrigin() { return this._crossOrigin; },
      set src(value) {
        this._src = value;
        this.preloadAtSrc = this.preload;
        this.crossAtSrc = this._crossOrigin;
      },
      addEventListener(type, fn) {
        if (type === "seeked") queueMicrotask(fn);
      },
      removeEventListener() {},
      removeAttribute(name) {
        if (name === "src") {
          this.srcClears += 1;
          this._src = "";
        }
      },
      load() {},
      release() {
        if (typeof this.onloadeddata === "function") this.onloadeddata();
      },
    };
  }
  function pageVideo() {
    const el = {
      preload: "",
      dataset: {},
      isConnected: true,
      style: {},
      _poster: "",
      get poster() { return this._poster; },
      set poster(value) { this._poster = value || ""; },
      getAttribute(name) {
        if (name === "poster") return this._poster || null;
        if (name === "src") return null;
        return null;
      },
      removeAttribute() {},
      addEventListener() {},
    };
    return el;
  }
  function IO(callback, options) {
    this.callback = callback;
    this.options = options;
    this.dead = false;
    watches.push(this);
  }
  IO.prototype.observe = function () {};
  IO.prototype.disconnect = function () { this.dead = true; };
  IO.prototype.enter = function () {
    if (!this.dead) this.callback([{ isIntersecting: true }]);
  };
  IO.prototype.leave = function () {
    if (!this.dead) this.callback([{ isIntersecting: false }]);
  };
  globalThis.document = {
    createElement(tag) {
      if (tag === "video") {
        const video = makeGrabVideo();
        captures.push(video);
        return video;
      }
      if (tag === "canvas") {
        const canvas = {
          width: 0,
          height: 0,
          getContext() { return { drawImage() {} }; },
          toBlob(cb) { cb(new Blob(["jpeg"], { type: "image/jpeg" })); },
        };
        canvases.push(canvas);
        return canvas;
      }
      return {};
    },
  };
  globalThis.IntersectionObserver = IO;
  const clip = (name) => `https://cdn.example/clips/${name}.mp4`;
  const pages = [];
  const mount = (name) => {
    const video = pageVideo();
    pages.push(video);
    bindVideoPoster(video, clip(name), null);
    return video;
  };
  try {
    resetVideoFrames();
    mount("a");
    mount("b");
    mount("c");
    mount("d");
    assert.equal(watches[0].options.rootMargin, "15%");
    watches[0].enter();
    watches[1].enter();
    watches[2].enter();
    watches[3].enter();
    assert.deepEqual(captures.map((video) => video._src), [clip("a"), clip("b")]);
    assert.equal(captures[0].preloadAtSrc, "metadata");
    assert.equal(captures[1].preloadAtSrc, "metadata");
    assert.equal(captures[0].crossAtSrc, "anonymous");
    watches[3].leave();
    watches[0].leave();
    assert.ok(captures[0].srcClears >= 1);
    await settle();
    assert.equal(pages[0].poster, "");
    assert.equal(captures.length, 3);
    assert.equal(captures[2]._src, clip("c"));
    assert.equal(captures[2].preloadAtSrc, "metadata");
    captures[2].release();
    await settle();
    assert.equal(canvases.length, 1);
    assert.equal(canvases[0].width, 480);
    assert.equal(canvases[0].height, 192);
    assert.match(pages[2].poster, /^blob:/);
    assert.equal(pages[3].poster, "");
  } finally {
    for (const watch of watches) watch.leave();
    await settle();
    resetVideoFrames();
    if (previousDoc === undefined) delete globalThis.document;
    else globalThis.document = previousDoc;
    if (previousIO === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = previousIO;
  }
});

test("the frame cache keeps about 60 stills and revokes the ones it drops", () => {
  const revoked = [];
  const previous = URL.revokeObjectURL;
  URL.revokeObjectURL = (value) => { revoked.push(String(value)); };
  try {
    resetVideoFrames();
    revoked.length = 0;
    rememberVideoFrame("https://cdn.example/clips/a.mp4", "blob:keep");
    rememberVideoFrame("https://cdn.example/clips/a.mp4", "blob:keep");
    assert.deepEqual(revoked, []);
    rememberVideoFrame("https://cdn.example/clips/a.mp4", "blob:next");
    assert.deepEqual(revoked, ["blob:keep"]);
    resetVideoFrames();
    assert.deepEqual(revoked, ["blob:keep", "blob:next"]);
    revoked.length = 0;
    for (let i = 1; i <= 60; i += 1) {
      rememberVideoFrame(`https://cdn.example/clips/${i}.mp4`, `blob:frame-${i}`);
    }
    assert.equal(revoked.length, 0);
    assert.equal(cachedVideoFrame("https://cdn.example/clips/1.mp4"), "blob:frame-1");
    rememberVideoFrame("https://cdn.example/clips/61.mp4", "blob:frame-61");
    assert.deepEqual(revoked, ["blob:frame-2"]);
    assert.equal(cachedVideoFrame("https://cdn.example/clips/1.mp4"), "blob:frame-1");
    assert.equal(cachedVideoFrame("https://cdn.example/clips/2.mp4"), "");
    resetVideoFrames();
    assert.equal(cachedVideoFrame("https://cdn.example/clips/61.mp4"), "");
    assert.equal(revoked.filter((url) => url === "blob:frame-2").length, 1);
    assert.equal(revoked.filter((url) => url === "blob:frame-1").length, 1);
    assert.equal(revoked.length, 61);
  } finally {
    try { resetVideoFrames(); } finally { URL.revokeObjectURL = previous; }
  }
});

test("an on-screen poster is not revoked", () => {
  const revoked = [];
  const previousRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (value) => { revoked.push(String(value)); };
  const previousDoc = globalThis.document;
  const videos = [];
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector !== "video[poster]") return [];
      return videos.filter((video) => video.isConnected !== false && (video.getAttribute("poster") || video.poster));
    },
  };
  const clip = (name) => `https://cdn.example/clips/${name}.mp4`;
  const shown = "blob:frame-1";
  function connectedVideo() {
    const video = {
      isConnected: true,
      preload: "",
      dataset: {},
      style: {},
      _poster: "",
      set poster(value) { this._poster = value || ""; },
      get poster() { return this._poster; },
      getAttribute(name) {
        if (name === "poster") return this._poster || null;
        if (name === "src") return null;
        return null;
      },
      removeAttribute() {},
      addEventListener() {},
    };
    videos.push(video);
    return video;
  }
  try {
    resetVideoFrames();
    revoked.length = 0;
    rememberVideoFrame(clip("1"), shown);
    const video = connectedVideo();
    bindVideoPoster(video, clip("1"), null);
    assert.equal(video.poster, shown);
    for (let i = 2; i <= 60; i += 1) {
      rememberVideoFrame(clip(String(i)), `blob:frame-${i}`);
    }
    rememberVideoFrame(clip("61"), "blob:frame-61");
    assert.equal(revoked.includes(shown), false);
    assert.deepEqual(revoked, ["blob:frame-2"]);
    assert.equal(cachedVideoFrame(clip("1")), shown);
    resetVideoFrames();
    assert.equal(revoked.includes(shown), false);
    assert.equal(cachedVideoFrame(clip("1")), shown);
    assert.equal(cachedVideoFrame(clip("61")), "");
    video.isConnected = false;
    resetVideoFrames();
    assert.equal(revoked.filter((url) => url === shown).length, 1);
    assert.equal(cachedVideoFrame(clip("1")), "");
  } finally {
    try { resetVideoFrames(); } finally {
      URL.revokeObjectURL = previousRevoke;
      if (previousDoc === undefined) delete globalThis.document;
      else globalThis.document = previousDoc;
    }
  }
});

test("an e2ee thumbnail is inside the sealed payload and absent from the outer message", () => {
  const thumb = "data:image/jpeg;base64,AAAA";
  const packed = packSealedThumb("hello", "https://cdn.example/markers/12-ab.mp4", thumb);
  assert.match(packed, /data:image\/jpeg;base64,AAAA/);
  assert.equal(unpackSealedThumb(packed).poster, thumb);
  assert.equal(unpackSealedThumb("\u001echat1\n" + JSON.stringify({ t: "hi", i: "https://cdn.example/a.jpg" })).poster, "");
  const outer = JSON.stringify({ encryptedMessage: { ciphertext: "c2VhbGVk" } });
  assert.equal(outer.includes(thumb), false);
  assert.equal(sealedThumbHidden(outer, thumb), true);
  assert.equal(typeof e2eeWireBytes(packed), "number");
  assert.ok(e2eeWireBytes(packed) > thumb.length);
  const upload = readFileSync(new URL("../uploadmedia.js", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../chatimage.js", import.meta.url), "utf8");
  assert.match(upload, /Sealed thumbs never become a public poster/);
  assert.match(chat, /packSealedThumb/);
  const encrypted = readFileSync(new URL("../encryptedtopicchat.js", import.meta.url), "utf8");
  assert.doesNotMatch(encrypted, /x-poster-for/i);
  const saveAt = encrypted.indexOf("async function saveE2eeChatEdit");
  const save = encrypted.slice(saveAt, encrypted.indexOf("const e2eeChatEditCancel", saveAt));
  const dropped = save.indexOf("droppedThumb = true");
  assert.ok(dropped !== -1);
  const notice = "toast.info('Thumbnail too big for this message, sent without it')";
  assert.ok(save.indexOf(notice, dropped) !== -1);
  const tooLong = save.indexOf("toast.error(HCS_TOO_LONG)");
  assert.ok(tooLong !== -1 && tooLong < save.indexOf(notice));
});

function posterVideo(src) {
  const listeners = {};
  const played = [];
  const video = {
    preload: "",
    dataset: src ? { src } : {},
    paused: true,
    readyState: 0,
    isConnected: true,
    style: {},
    failOnce: false,
    classList: {
      names: new Set(),
      add(name) { this.names.add(name); },
      contains(name) { return this.names.has(name); },
    },
    _src: "",
    _poster: "",
    set poster(value) { this._poster = value || ""; },
    get poster() { return this._poster; },
    set src(value) { this._src = value || ""; },
    get src() { return this._src; },
    getAttribute(name) {
      if (name === "src") return this._src || null;
      if (name === "poster") return this._poster || null;
      return null;
    },
    removeAttribute(name) {
      if (name === "src") this._src = "";
      if (name === "poster") this._poster = "";
    },
    addEventListener(type, fn, capture) {
      const key = type + (capture === true ? ":c" : "");
      if (!listeners[key]) listeners[key] = [];
      listeners[key].push(fn);
    },
    play() {
      played.push(this.getAttribute("src"));
      if (!this.getAttribute("src")) return Promise.reject(new Error("no src"));
      if (this.failOnce) {
        this.failOnce = false;
        return Promise.reject(new Error("blocked"));
      }
      this.paused = false;
      return Promise.resolve();
    },
  };
  return { video, listeners, played };
}

test("a poster or loadeddata clears the centred placeholder", () => {
  resetVideoFrames();
  const clip = "https://cdn.example/clips/face.mp4";
  const posted = posterVideo("");
  bindVideoPoster(posted.video, clip, { poster: "blob:still" });
  assert.equal(posted.video.poster, "blob:still");
  assert.equal(posted.video.classList.contains("has-poster"), true);
  assert.equal(posted.video.dataset.controlsWanted, undefined);
  const waiting = posterVideo("");
  bindVideoPoster(waiting.video, clip, { posterOff: true });
  assert.equal(waiting.video.classList.contains("has-poster"), false);
  waiting.video.readyState = 2;
  waiting.listeners.loadeddata[0]();
  assert.equal(waiting.video.classList.contains("has-poster"), true);
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /video\.has-poster:not\(\[src\]\)::-webkit-media-controls-overlay-enclosure,\s*video\.has-poster:not\(\[src\]\)::-webkit-media-controls-overlay-play-button \{\s*display: none !important;/);
});

test("a poster hides native controls until the play button starts the file", async () => {
  const previousDoc = globalThis.document;
  const previousFrame = globalThis.requestAnimationFrame;
  let queued = null;
  globalThis.requestAnimationFrame = (fn) => {
    queued = fn;
    return 1;
  };
  globalThis.document = {
    createElement() {
      return {
        type: "",
        className: "",
        hidden: false,
        setAttribute() {},
        addEventListener(type, fn) { this["on" + type] = fn; },
      };
    },
  };
  const parent = {
    children: [],
    appendChild(node) { this.children.push(node); },
    querySelector(sel) {
      if (sel !== ":scope > .video-play") return null;
      return this.children.find((node) => node.className === "video-play") || null;
    },
  };
  const src = "https://cdn.example/clips/face.mp4";
  const { video, played } = posterVideo(src);
  video.controls = true;
  video.parentElement = parent;
  video.isConnected = true;
  try {
    resetVideoFrames();
    bindVideoPoster(video, src, { poster: "blob:still" });
    assert.equal(video.dataset.controlsWanted, "1");
    assert.equal(video.controls, false);
    video.controls = true;
    assert.equal(typeof queued, "function");
    queued();
    assert.equal(video.controls, false);
    const btn = parent.querySelector(":scope > .video-play");
    assert.ok(btn);
    assert.equal(btn.hidden, false);
    assert.match(btn.innerHTML, /class="video-play-glass"/);
    assert.match(btn.innerHTML, /d="M9 6\.2v11\.6l9\.2-5\.8z"/);
    assert.match(btn.innerHTML, /fill="#22D3EE"/);
    btn.onclick({ preventDefault() {}, stopPropagation() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(video.getAttribute("src"), src);
    assert.equal(video.paused, false);
    assert.equal(video.controls, true);
    assert.equal(btn.hidden, true);
    assert.deepEqual(played, [src]);
  } finally {
    resetVideoFrames();
    if (previousDoc === undefined) delete globalThis.document;
    else globalThis.document = previousDoc;
    if (previousFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousFrame;
  }
});

test("a popup tap, key, and play event set src before play and catch errors", async () => {
  resetVideoFrames();
  const src = "https://cdn.example/clips/popup.mp4";
  const { video, listeners, played } = posterVideo(src);
  bindVideoPoster(video, src, { posterOff: true });
  assert.equal(video.getAttribute("src"), null);
  listeners["pointerdown:c"][0]({ type: "pointerdown" });
  assert.equal(video.getAttribute("src"), src);
  assert.deepEqual(played, []);
  video._src = "";
  listeners["keydown:c"][0]({ type: "keydown", key: "a" });
  assert.equal(video.getAttribute("src"), null);
  listeners["keydown:c"][0]({ type: "keydown", key: "Enter" });
  assert.equal(video.getAttribute("src"), src);
  listeners.keyup[0]({ type: "keyup", key: "a" });
  assert.deepEqual(played, []);
  listeners.keyup[0]({ type: "keyup", key: " " });
  assert.deepEqual(played, [src]);
  assert.equal(video.paused, false);
  video.paused = true;
  video._src = "";
  listeners.play[0]();
  assert.equal(played.at(-1), src);
  assert.equal(video.paused, false);
  video.paused = true;
  video._src = "";
  video.failOnce = true;
  listeners["pointerdown:c"][0]({ type: "pointerdown" });
  listeners.click[0]({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(played.at(-1), src);
  const afterCatch = played.length;
  video.paused = true;
  listeners.click[0]({ type: "click" });
  assert.equal(played.length, afterCatch);
  video.failOnce = true;
  await assert.rejects(video.play(), /blocked/);
  const held = posterVideo(src);
  bindVideoPoster(held.video, src, { posterOff: true, holdSrc: true });
  assert.equal(held.listeners["pointerdown:c"], undefined);
  assert.equal(held.listeners.keydown, undefined);
  held.video.play();
  assert.deepEqual(held.played, [src]);
});

test("the first two visible videos grab a frame on render and never upload it", async () => {
  const previousDoc = globalThis.document;
  const previousIO = globalThis.IntersectionObserver;
  const previousWindow = globalThis.window;
  const previousFrame = globalThis.requestAnimationFrame;
  const previousFetch = globalThis.fetch;
  const uploads = [];
  const captures = [];
  const pages = [];
  globalThis.fetch = (url) => {
    uploads.push(String(url));
    return Promise.reject(new Error("upload"));
  };
  globalThis.window = { innerWidth: 360, innerHeight: 740 };
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };
  delete globalThis.IntersectionObserver;
  function makeGrabVideo() {
    return {
      muted: false,
      playsInline: false,
      preload: "",
      duration: 2,
      videoWidth: 1000,
      videoHeight: 400,
      currentTime: 0,
      onloadeddata: null,
      onerror: null,
      _src: "",
      _crossOrigin: "",
      set crossOrigin(value) { this._crossOrigin = value; },
      get crossOrigin() { return this._crossOrigin; },
      set src(value) { this._src = value; },
      addEventListener(type, fn) {
        if (type === "seeked") queueMicrotask(fn);
      },
      removeEventListener() {},
      removeAttribute() {},
      load() {},
      release() {
        if (typeof this.onloadeddata === "function") this.onloadeddata();
      },
    };
  }
  globalThis.document = {
    createElement(tag) {
      if (tag === "video") {
        const video = makeGrabVideo();
        captures.push(video);
        return video;
      }
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() { return { drawImage() {} }; },
          toBlob(cb) { cb(new Blob(["jpeg"], { type: "image/jpeg" })); },
        };
      }
      return {};
    },
    querySelectorAll() { return pages.filter((video) => video.isConnected && video.getAttribute("poster")); },
  };
  const clip = (name) => `https://cdn.example/clips/${name}.mp4`;
  const mount = (name) => {
    const video = {
      preload: "",
      dataset: {},
      isConnected: true,
      style: {},
      _poster: "",
      _src: "",
      set poster(value) { this._poster = value || ""; },
      get poster() { return this._poster; },
      set src(value) { this._src = value || ""; },
      get src() { return this._src; },
      getAttribute(name) {
        if (name === "poster") return this._poster || null;
        if (name === "src") return this._src || null;
        return null;
      },
      removeAttribute(name) {
        if (name === "poster") this._poster = "";
        if (name === "src") this._src = "";
      },
      addEventListener() {},
      getBoundingClientRect() {
        return { top: 10, left: 10, right: 300, bottom: 200, width: 290, height: 190 };
      },
    };
    pages.push(video);
    bindVideoPoster(video, clip(name), null);
    return video;
  };
  try {
    resetVideoFrames();
    const first = mount("a");
    const second = mount("b");
    const third = mount("c");
    assert.deepEqual(captures.map((video) => video._src), [clip("a"), clip("b")]);
    assert.equal(third.poster, "");
    captures[0].release();
    captures[1].release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(first.poster, /^blob:/);
    assert.match(second.poster, /^blob:/);
    assert.equal(third.poster, "");
    assert.deepEqual(uploads, []);
    const source = readFileSync(new URL("../videoposter.js", import.meta.url), "utf8");
    const pumpAt = source.indexOf("function pumpFrameGrabs(");
    const pump = source.slice(pumpAt, source.indexOf("function videoShown(", pumpAt));
    assert.equal(/postFile|posterPlan|\/api\/upload|rememberPosterEdit/.test(pump), false);
    assert.match(pump, /URL\.createObjectURL/);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetVideoFrames();
    if (previousDoc === undefined) delete globalThis.document;
    else globalThis.document = previousDoc;
    if (previousIO === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = previousIO;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousFrame;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("a holder play glass reuses the conic ring and the existing pause", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const at = css.indexOf("/* Holder ring on the shared play glass.");
  assert.ok(at !== -1);
  const block = css.slice(at, css.indexOf("html.feed-app .polygon-cover-play {", at));
  assert.match(block, /:is\(\.early-holder-popup, \.early-holder-card\) :is\(\.video-play-glass, \.polygon-cover-play-glass\)/);
  assert.match(block, /\.toolbar-group-messages:has\(\.early-hashinal\) :is\(\.video-play-glass, \.polygon-cover-play-glass\)/);
  assert.match(block, /conic-gradient\(from var\(--eh-angle\), #f6e27a, #ff4ad6, #e879f9, #7c3aed, #f6e27a\)/);
  assert.match(block, /background-origin: border-box;/);
  assert.match(block, /background-clip: padding-box, border-box;/);
  assert.match(block, /rgba\(255, 74, 214, 0\.45\)/);
  assert.equal(block.includes("34, 211, 238"), false);
  assert.match(block, /animation: early-hashinal-angle 4s linear infinite;/);
  assert.match(block, /fill: #f6e27a;/);
  assert.match(block, /animation-duration: 8s;/);
  assert.equal(block.includes("animation: none"), false);
  assert.equal(/\bwidth:|\bheight:|\bborder-width:/.test(block), false);
  const sharedAt = css.indexOf(":is(.polygon-cover-play-glass, .video-play-glass) {");
  const shared = css.slice(sharedAt, css.indexOf(":is(.polygon-cover-play-icon, .video-play-icon)", sharedAt));
  assert.match(shared, /#22D3EE/);
  assert.match(shared, /rgba\(34, 211, 238, 0\.45\)/);
  const pauseAt = css.indexOf("The feed covers the map");
  const pause = css.slice(pauseAt, css.indexOf("animation-play-state: paused !important;", pauseAt));
  assert.match(pause, /html\.feed-app \.maplibregl-map \.maplibregl-popup\.early-holder-popup \.video-play-glass/);
  assert.match(pause, /html\.eh-hidden \.maplibregl-map \.maplibregl-popup\.early-holder-popup \.video-play-glass/);
  assert.match(pause, /html\.eh-hidden \.maplibregl-map \.maplibregl-popup\.early-holder-popup \.polygon-cover-play-glass/);
  assert.match(pause, /html\.eh-hidden \.toolbar-group-messages:has\(\.early-hashinal\) :is\(\.video-play-glass, \.polygon-cover-play-glass\)/);
  assert.match(pause, /\.eh-off :is\(\.video-play-glass, \.polygon-cover-play-glass\)/);
  assert.equal(pause.includes("#feed-column .video-play-glass"), false);
  assert.equal(pause.includes("html.eh-hidden .feed-card"), false);
});
