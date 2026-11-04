// Device GIF geometry, progress, and the media-URL resolver. No browser and no network.
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyImageUrl,
  contentTypeVerdict,
  gifMagic,
  readGifCache,
  resetGifCache,
  resolveMediaUrl,
  writeGifCache,
  posterTargetKey,
} from "../mediaurl.js";
import { presentImage } from "../loopmedia.js";
import {
  GIF_BROWSER_ERROR,
  conversionRatio,
  frameBox,
  gifDurationReject,
  mapGifProgress,
  pickRecorderMime,
  recorderFallback,
  storedType,
} from "../gifvideo.js";

test("cover roles centre-crop to an even edge of at most 512", () => {
  assert.deepEqual(frameBox(1000, 400, "cover"), {
    width: 400, height: 400, sx: 300, sy: 0, sw: 400, sh: 400,
  });
  assert.deepEqual(frameBox(2000, 1000, "avatar"), {
    width: 512, height: 512, sx: 500, sy: 0, sw: 1000, sh: 1000,
  });
  assert.deepEqual(frameBox(513, 513, "polygon-cover"), {
    width: 512, height: 512, sx: 0, sy: 0, sw: 513, sh: 513,
  });
  const narrow = frameBox(31, 45, "cover");
  assert.equal(narrow.width, 30);
  assert.equal(narrow.height, 30);
  assert.equal(narrow.sx, 0);
  assert.equal(narrow.sy, 7);
  assert.equal(narrow.sw, 31);
  assert.equal(narrow.sh, 31);
  assert.equal(narrow.width % 2, 0);
  assert.equal(narrow.height % 2, 0);
});

test("media keeps its size and only evens each side", () => {
  assert.deepEqual(frameBox(101, 51, "media"), {
    width: 100, height: 50, sx: 0, sy: 0, sw: 101, sh: 51,
  });
  const odd = frameBox(3, 5, "media");
  assert.equal(odd.width, 2);
  assert.equal(odd.height, 4);
  assert.equal(odd.sx, 0);
  assert.equal(odd.sy, 0);
  assert.equal(odd.sw, 3);
  assert.equal(odd.sh, 5);
  assert.notEqual(frameBox(800, 200, "media").width, frameBox(800, 200, "cover").width);
});

test("conversion fills 0–70 and the upload fills 70–100", () => {
  assert.equal(mapGifProgress("convert", 0), 0);
  assert.equal(mapGifProgress("convert", 0.5), 35);
  assert.equal(mapGifProgress("convert", 1), 70);
  assert.equal(mapGifProgress("convert", 2), 70);
  assert.equal(mapGifProgress("upload", 0), 70);
  assert.equal(mapGifProgress("upload", 0.5), 85);
  assert.equal(mapGifProgress("upload", 1), 100);
  assert.equal(mapGifProgress("upload", -1), 70);
  assert.equal(conversionRatio(1, 2, 0, 1000), 0.5);
  assert.equal(conversionRatio(0, 2, 800, 1000), 0.8);
  assert.equal(conversionRatio(3, 2, 5000, 1000), 1);
  assert.equal(conversionRatio(0, 0, 0, 0), 0);
});

test("an unsupported recorder refuses the upload and never stores a gif", () => {
  assert.equal(recorderFallback(false, "video/mp4"), GIF_BROWSER_ERROR);
  assert.equal(recorderFallback(true, ""), GIF_BROWSER_ERROR);
  assert.equal(recorderFallback(true, "image/gif"), GIF_BROWSER_ERROR);
  assert.equal(recorderFallback(true, "video/webm"), "");
  assert.equal(pickRecorderMime(() => false), "");
  assert.equal(pickRecorderMime((type) => type === "video/webm;codecs=vp8"), "video/webm;codecs=vp8");
  assert.equal(
    pickRecorderMime((type) => type === "video/mp4" || type === "video/webm;codecs=vp9"),
    "video/mp4",
  );
  assert.deepEqual(storedType("video/mp4;codecs=avc1.42E01E"), { type: "video/mp4", ext: ".mp4" });
  assert.deepEqual(storedType("video/webm;codecs=vp9"), { type: "video/webm", ext: ".webm" });
  assert.equal(storedType("image/gif"), null);
  assert.equal(storedType("video/mp4").ext === ".gif", false);
});

test("only a polygon cover longer than 30 seconds is rejected", () => {
  assert.equal(gifDurationReject("polygon-cover", 31), "Cover video max 30 seconds");
  assert.equal(gifDurationReject("polygon-cover", 30), "");
  assert.equal(gifDurationReject("polygon-cover", 30.5), "");
  assert.equal(gifDurationReject("media", 31), "");
  assert.equal(gifDurationReject("cover", 90), "");
  assert.equal(gifDurationReject("avatar", 90), "");
});

test("a gif address is not rendered and other media stays put", () => {
  assert.deepEqual(resolveMediaUrl("https://pub-abc.r2.dev/markers/a.gif?x=1#y"), {
    kind: "image", src: "", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://cdn.r2.pub/old.gif"), {
    kind: "image", src: "", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://ipfs.io/ipfs/bafy.gif"), {
    kind: "image", src: "", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://example.com/anim.GIF"), {
    kind: "image", src: "", poster: "",
  });
  assert.equal(resolveMediaUrl("https://ipfs.io/ipfs/bafy.gif").src.includes("/api/media/gif"), false);
  assert.deepEqual(resolveMediaUrl("https://pub-abc.r2.dev/a.jpg"), {
    kind: "image", src: "https://pub-abc.r2.dev/a.jpg", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://example.com/clip.mp4"), {
    kind: "video", src: "https://example.com/clip.mp4", poster: "",
  });
  assert.deepEqual(resolveMediaUrl("https://example.com/clip.webm"), {
    kind: "video", src: "https://example.com/clip.webm", poster: "",
  });
  assert.deepEqual(resolveMediaUrl(""), { kind: "image", src: "", poster: "" });
});

function memStore() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("gif magic is GIF87a or GIF89a and nothing else", () => {
  const bytes = (text) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
  assert.equal(gifMagic(bytes("GIF87a")), true);
  assert.equal(gifMagic(bytes("GIF89a")), true);
  assert.equal(gifMagic(bytes("GIF89aXXXX")), true);
  assert.equal(gifMagic(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), false);
  assert.equal(gifMagic(Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00])), false);
  assert.equal(gifMagic(bytes("GIF89")), false);
  assert.equal(gifMagic(bytes("GIF87b")), false);
  assert.equal(gifMagic(null), false);
  assert.equal(gifMagic(new ArrayBuffer(0)), false);
  assert.equal(contentTypeVerdict("image/gif; charset=binary"), "gif");
  assert.equal(contentTypeVerdict("image/png"), "other");
  assert.equal(contentTypeVerdict("application/octet-stream"), "unknown");
  assert.equal(contentTypeVerdict(""), "unknown");
});

test("the gif answer is cached in memory and localStorage", () => {
  resetGifCache();
  const url = "https://cdn.example/ipfs/QmCacheGif";
  const box = memStore();
  assert.equal(readGifCache(url, box), null);
  writeGifCache(url, true, box);
  assert.equal(readGifCache(url, box), true);
  resetGifCache();
  assert.equal(readGifCache(url, box), true);
  assert.equal(JSON.parse(box.getItem("sbs-gif-sniff"))[url], 1);
  writeGifCache(url, false, box);
  assert.equal(readGifCache(url, box), false);
  resetGifCache();
  assert.equal(readGifCache(url, box), false);
  assert.equal(JSON.parse(box.getItem("sbs-gif-sniff"))[url], 0);
  let reads = 0;
  const memoryBox = {
    getItem() {
      reads += 1;
      return JSON.stringify({ "https://cdn.example/mem": 0 });
    },
    setItem() { throw new Error("full"); },
  };
  writeGifCache("https://cdn.example/mem", true, memoryBox);
  reads = 0;
  assert.equal(readGifCache("https://cdn.example/mem", memoryBox), true);
  assert.equal(reads, 0);
  resetGifCache();
});

test("an extensionless gif is sniffed by content-type, else by a ranged read", async () => {
  resetGifCache();
  const gif = Uint8Array.from("GIF89aXXXX", (ch) => ch.charCodeAt(0));
  const url = "https://massive-crimson-bass.myfilebase.com/ipfs/QmVWR33Rk8VLTd5CpQYBsNiRdXQY1eSTFGUR5bCew5R9x7";
  const box = memStore();
  let calls = 0;
  const ranged = async (_url, init) => {
    calls += 1;
    assert.equal(init.headers.Range, "bytes=0-5");
    return new Response(gif, { status: 206, headers: { "content-type": "application/octet-stream" } });
  };
  assert.equal(await classifyImageUrl(url, { fetch: ranged, storage: box }), true);
  assert.equal(await classifyImageUrl(url, { fetch: ranged, storage: box }), true);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(box.getItem("sbs-gif-sniff"))[url], 1);

  resetGifCache();
  const typed = "https://cdn.example/ipfs/QmTypedGif";
  let typedCalls = 0;
  assert.equal(await classifyImageUrl(typed, {
    fetch: async () => {
      typedCalls += 1;
      return new Response(new Uint8Array(), { status: 200, headers: { "content-type": "image/gif" } });
    },
    storage: box,
  }), true);
  assert.equal(typedCalls, 1);

  resetGifCache();
  let pngCalls = 0;
  assert.equal(await classifyImageUrl("https://kiloscribe.com/api/inscription-cdn/0.0.4819119", {
    fetch: () => {
      pngCalls += 1;
      return new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    },
    storage: box,
  }), false);
  assert.equal(pngCalls, 1);

  resetGifCache();
  let skipped = 0;
  assert.equal(await classifyImageUrl("https://cdn.example/photo.JPG?x=1", {
    fetch: () => { skipped += 1; },
    storage: box,
  }), false);
  assert.equal(await classifyImageUrl("https://cdn.example/old.gif", {
    fetch: () => { skipped += 1; },
    storage: box,
  }), true);
  assert.equal(skipped, 0);

  resetGifCache();
  const fallen = "https://cdn.example/ipfs/QmFallback";
  const older = Uint8Array.from("GIF87aYYYY", (ch) => ch.charCodeAt(0));
  const fetches = [];
  assert.equal(await classifyImageUrl(fallen, {
    fetch: async (_url, init) => {
      fetches.push(init && init.headers && init.headers.Range ? "range" : "full");
      if (init && init.headers && init.headers.Range) throw new Error("range refused");
      return new Response(older, { status: 200, headers: { "content-type": "application/octet-stream" } });
    },
    storage: box,
  }), true);
  assert.deepEqual(fetches, ["range", "full"]);

  resetGifCache();
  const down = "https://cdn.example/ipfs/QmDown";
  assert.equal(await classifyImageUrl(down, {
    fetch: async () => { throw new Error("offline"); },
    storage: box,
  }), null);
  assert.equal(readGifCache(down, box), null);
  resetGifCache();
});

function fakeImg() {
  const attrs = new Map();
  const classes = new Set();
  return {
    dataset: {},
    classList: {
      add: (...names) => { for (const name of names) classes.add(name); },
      remove: (...names) => { for (const name of names) classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    getAttribute: (key) => (attrs.has(key) ? attrs.get(key) : null),
    setAttribute: (key, value) => attrs.set(key, String(value)),
    removeAttribute: (key) => attrs.delete(key),
    previousElementSibling: null,
    parentNode: null,
    isConnected: false,
    closest: () => null,
    get src() { return attrs.get("src") || ""; },
    set src(value) { attrs.set("src", String(value)); },
  };
}

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("a null gif check paints the image and is not cached", async () => {
  resetGifCache();
  const url = "https://cdn.example/files/unchecked-null";
  let calls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("offline");
  };
  try {
    const img = fakeImg();
    presentImage(img, url);
    assert.equal(img.classList.contains("is-media-pending"), true);
    assert.equal(img.getAttribute("src"), null);
    await nextTurn();
    assert.equal(img.classList.contains("is-media-pending"), false);
    assert.equal(img.getAttribute("src"), url);
    assert.equal(readGifCache(url), null);
    const afterFirst = calls;
    assert.ok(afterFirst >= 1);
    presentImage(img, url);
    await nextTurn();
    assert.ok(calls > afterFirst);
    assert.equal(readGifCache(url), null);
    assert.equal(img.classList.contains("is-media-pending"), false);
    assert.equal(img.getAttribute("src"), url);
  } finally {
    globalThis.fetch = previous;
    resetGifCache();
  }
});

test("a gif check that takes longer than 4 seconds is null and is not cached", { timeout: 8000 }, async () => {
  resetGifCache();
  const url = "https://cdn.example/files/slow-host";
  const box = memStore();
  const started = Date.now();
  const found = await classifyImageUrl(url, {
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      const signal = init && init.signal;
      if (!signal) return;
      if (signal.aborted) reject(new Error("aborted"));
      else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    storage: box,
  });
  const elapsed = Date.now() - started;
  assert.equal(found, null);
  assert.equal(readGifCache(url, box), null);
  assert.ok(elapsed >= 3500 && elapsed < 7000, String(elapsed));
  resetGifCache();
});

test("a poster is stored only beside our own mp4 or webm", () => {
  const base = "https://pub-243.r2.dev";
  assert.equal(
    posterTargetKey(base, "https://pub-243.r2.dev/markers/1700000000000-ab12cd.mp4"),
    "markers/1700000000000-ab12cd.poster.jpg",
  );
  assert.equal(
    posterTargetKey(base, "https://pub-243.r2.dev/markers/1700000000000-ab12cd-d12.webm?x=1"),
    "markers/1700000000000-ab12cd-d12.poster.jpg",
  );
  assert.equal(posterTargetKey(base, "https://evil.example/markers/1-ab.mp4"), "");
  assert.equal(posterTargetKey(base, "https://pub-243.r2.dev/markers/%2e%2e%2fsecret.mp4"), "");
  assert.equal(posterTargetKey(base, "https://pub-243.r2.dev/markers/1-ab.gif"), "");
  assert.equal(posterTargetKey(base, "https://pub-243.r2.dev/markers/1-ab.mov"), "");
  assert.equal(posterTargetKey("", "https://pub-243.r2.dev/markers/1-ab.mp4"), "");
});
