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
  assert.doesNotMatch(readFileSync(new URL("../encryptedtopicchat.js", import.meta.url), "utf8"), /x-poster-for/i);
});
