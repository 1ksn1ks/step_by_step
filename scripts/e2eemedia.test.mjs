import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POSTER_EMBED_MAX,
  SEALED_CONTENT_TYPE,
  SEALED_MAX,
  STREAM_CHUNK,
  decryptSealedPart,
  decryptStream,
  encryptStream,
  packSealedMedia,
  readSealedMedia,
  sealPosterBytes,
  sealedDownloadCap,
  sealedUploadHeaders,
} from "../e2eemedia.js";

// The upload route's public origin for this file. Fixtures below sit on it.
process.env.R2_PUBLIC_BASE_URL = "https://cdn.example/media";
const MEDIA_ORIGIN = "https://cdn.example/media";
import { SEALED_MAX as SERVER_SEALED_MAX, sealedUploadPlan } from "../server/sealedupload.js";
import { posterTargetKey } from "../mediaurl.js";

function markerBytes(text) {
  return new TextEncoder().encode(text);
}

function indexOfBytes(hay, needle) {
  if (!needle.length || hay.length < needle.length) return -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function roundTrip(plain) {
  const enc = await encryptStream(plain);
  const back = await decryptStream(enc.blob, enc.fileKey, enc.header);
  return { enc, back: await blobBytes(back) };
}

test("secretstream round trip covers empty, exact, and multi-chunk files", async () => {
  const empty = await roundTrip(new Uint8Array(0));
  assert.equal(empty.back.length, 0);
  assert.equal(empty.enc.blob.type, SEALED_CONTENT_TYPE);

  const exact = new Uint8Array(STREAM_CHUNK);
  for (let i = 0; i < exact.length; i += 1) exact[i] = i & 255;
  const exactTrip = await roundTrip(exact);
  assert.deepEqual(exactTrip.back, exact);

  const over = new Uint8Array(STREAM_CHUNK + 1);
  over[0] = 7;
  over[STREAM_CHUNK] = 9;
  const overTrip = await roundTrip(over);
  assert.deepEqual(overTrip.back, over);

  const multi = new Uint8Array((STREAM_CHUNK * 2) + 30);
  for (let i = 0; i < multi.length; i += 97) multi[i] = (i * 3) & 255;
  const multiTrip = await roundTrip(multi);
  assert.deepEqual(multiTrip.back, multi);
});

test("the upload body is ciphertext and the server plan stores no poster", async () => {
  const marker = markerBytes("PLAINTEXT-MARKER-ftyp-SECRET-do-not-store");
  const plain = new Uint8Array((STREAM_CHUNK * 2) + marker.length);
  plain.set(marker, 0);
  plain.set(marker, STREAM_CHUNK);
  plain[4] = 0x66; plain[5] = 0x74; plain[6] = 0x79; plain[7] = 0x70;
  const enc = await encryptStream(plain);
  const body = await blobBytes(enc.blob);
  assert.equal(indexOfBytes(body, marker), -1);
  const headers = sealedUploadHeaders({ account: "0.0.1234", uploadToken: "tok", turnstile: "ts" });
  assert.equal(headers["Content-Type"], SEALED_CONTENT_TYPE);
  assert.equal(headers["X-Sealed"], "1");
  assert.equal(headers["X-Media-Duration"], undefined);
  assert.equal(headers["X-Media-Role"], undefined);
  assert.equal(headers["X-Poster-For"], undefined);
  assert.equal(headers["X-Expect-Poster"], undefined);
  assert.equal(headers["Content-Disposition"], undefined);
  assert.equal(JSON.stringify(headers).includes("ftyp"), false);
  assert.equal(JSON.stringify(headers).includes("video/mp4"), false);

  const plan = sealedUploadPlan({
    contentType: headers["Content-Type"],
    sealed: true,
    bytes: body.length,
    now: 1700000000000,
    nonce: "ab12cd",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.key, "markers/1700000000000-ab12cd");
  assert.equal(plan.key.includes("."), false);
  assert.equal(plan.contentType, SEALED_CONTENT_TYPE);
  assert.equal(plan.poster, false);
  assert.equal(plan.pendingPoster, false);
  assert.equal(plan.posterEdit, false);
  assert.equal(plan.account, undefined);
  assert.equal(JSON.stringify(plan).includes("0.0."), false);
  assert.equal(posterTargetKey("https://cdn.example", `https://cdn.example/${plan.key}`), "");
  assert.equal(SEALED_MAX, SERVER_SEALED_MAX);

  const video = sealedUploadPlan({
    contentType: "video/mp4",
    sealed: true,
    bytes: body.length,
    now: 1,
    nonce: "a",
  });
  assert.equal(video.ok, false);
  assert.equal(video.status, 415);
  const jpeg = sealedUploadPlan({
    contentType: "image/jpeg",
    sealed: true,
    posterFor: "markers/1-a.mp4",
    bytes: 32,
    now: 1,
    nonce: "a",
  });
  assert.equal(jpeg.ok, false);
  assert.equal(jpeg.status, 400);
});

test("a poster is embedded or uploaded only as ciphertext", async () => {
  const marker = markerBytes("POSTER-PLAINTEXT-UNIQUE");
  const plain = new Uint8Array(64);
  plain.set([0xff, 0xd8, 0xff], 0);
  plain.set(marker, 8);

  const embedded = await sealPosterBytes(plain, {
    embedMax: POSTER_EMBED_MAX,
    fits() { return true; },
  });
  assert.equal(embedded.mode, "embed");
  assert.equal(embedded.uploads.length, 0);
  const pad = embedded.poster.b64.length % 4 === 0 ? "" : "=".repeat(4 - (embedded.poster.b64.length % 4));
  const hidden = Uint8Array.from(Buffer.from(embedded.poster.b64 + pad, "base64"));
  assert.equal(indexOfBytes(hidden, marker), -1);
  const opened = await decryptStream(hidden, embedded.poster.fileKey, embedded.poster.header);
  assert.deepEqual(await blobBytes(opened), plain);

  const uploaded = await sealPosterBytes(plain, {
    embedMax: POSTER_EMBED_MAX,
    fits() { return false; },
  });
  assert.equal(uploaded.mode, "upload");
  assert.equal(uploaded.poster.b64, undefined);
  assert.equal(uploaded.uploads.length, 1);
  assert.equal(uploaded.uploads[0].contentType, SEALED_CONTENT_TYPE);
  assert.equal(uploaded.uploads[0].headers["Content-Type"], SEALED_CONTENT_TYPE);
  assert.equal(uploaded.uploads[0].headers["X-Poster-For"], undefined);
  assert.equal(indexOfBytes(uploaded.uploads[0].body, marker), -1);
  assert.equal(indexOfBytes(uploaded.uploads[0].body, new Uint8Array([0xff, 0xd8, 0xff])), -1);

  const packed = packSealedMedia("hello", {
    url: `${MEDIA_ORIGIN}/markers/1700000000000-ab12cd`,
    fileKey: embedded.poster.fileKey,
    header: embedded.poster.header,
    mime: "video/mp4",
    size: 99,
    w: 320,
    h: 180,
    poster: embedded.poster,
    name: "holiday.mp4",
  });
  assert.equal(packed.includes("holiday.mp4"), false);
  assert.equal(packed.includes("PLAINTEXT"), false);
  const read = readSealedMedia(packed);
  assert.equal(read.text, "hello");
  assert.equal(read.media.mime, "video/mp4");
  assert.equal(read.media.w, 320);
  assert.equal(read.media.h, 180);
  assert.equal(read.media.poster.b64, embedded.poster.b64);
  assert.equal(read.media.name, undefined);
  const old = `\u001echat1\n${JSON.stringify({
    t: "old",
    i: "https://cdn.example/markers/1-a.mp4",
    p: "data:image/jpeg,abc",
  })}`;
  assert.equal(readSealedMedia(old), null);
  const missing = readSealedMedia(`\u001echat1\n${JSON.stringify({
    t: "locked",
    m: { url: "https://cdn.example/markers/1700000000000-ab12cd" },
  })}`);
  assert.equal(missing.text, "locked");
  assert.equal(missing.media.fileKey, "");
  assert.equal(missing.media.header, "");
});

test("the sealed client and server never attach a clear poster", () => {
  const client = readFileSync(new URL("../uploadmedia.js", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const start = client.indexOf("async function uploadSealedChatMedia");
  const end = client.indexOf("export async function uploadChatImage");
  const fn = client.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(fn, /encryptStream\(uploadFile\)/);
  assert.match(fn, /postSealedBlob/);
  assert.match(client, /function postSealedBlob[\s\S]*seal: true/);
  assert.doesNotMatch(fn, /uploadToR2|finishPoster|X-Media-Duration|X-Poster-For|X-Expect-Poster|file\.name/);
  assert.match(client, /if \(kind === "e2ee"\) return uploadSealedChatMedia/);
  assert.match(client, /if \(seal\) \{\s*xhr\.setRequestHeader\("X-Sealed", "1"\);/);
  const sealedAt = server.indexOf("if (sealed) {");
  const secondsAt = server.indexOf("const seconds = isVideo");
  const block = server.slice(sealedAt, secondsAt);
  assert.ok(sealedAt > 0 && secondsAt > sealedAt);
  assert.match(block, /sealedUploadPlan/);
  assert.match(block, /ContentType: plan\.contentType/);
  assert.doesNotMatch(block, /notePendingPoster|issuePosterEdit|posterEdit|resolvedUploadSeconds/);
  assert.match(server, /if \(sealed && type !== "application\/octet-stream"\)/);
  assert.match(server, /if \(sealed && posterHeader\)/);
});

describe("sealed media origin", { concurrency: 1 }, () => {
  test("a foreign host is refused before download", async () => {
    const server = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
    const media = readFileSync(new URL("../e2eemedia.js", import.meta.url), "utf8");
    assert.match(server, /const R2_PUBLIC_BASE = r2PublicBase\(\)/);
    assert.match(server, /url: `\$\{R2_PUBLIC_BASE\}\/\$\{plan\.key\}`/);
    assert.match(server, /globalThis\.__R2_PUBLIC_BASE=\$\{JSON\.stringify\(R2_PUBLIC_BASE\)\}/);
    assert.match(media, /r2PublicBase\(\)/);

    const plain = new Uint8Array([4, 5, 6, 7]);
    const enc = await encryptStream(plain);
    const good = `${MEDIA_ORIGIN}/markers/1700000000000-ab12cd`;
    const packed = packSealedMedia("hi", {
      url: good,
      fileKey: enc.fileKey,
      header: enc.header,
      mime: "image/jpeg",
      size: plain.byteLength,
      poster: {
        url: `${MEDIA_ORIGIN}/markers/1700000000000-poster`,
        fileKey: enc.fileKey,
        header: enc.header,
        mime: "image/jpeg",
        size: plain.byteLength,
      },
    });
    const read = readSealedMedia(packed);
    assert.equal(read.media.url, good);
    assert.equal(read.media.poster.url, `${MEDIA_ORIGIN}/markers/1700000000000-poster`);

    const rejectUrl = (url) => {
      const body = packSealedMedia("hi", {
        url,
        fileKey: enc.fileKey,
        header: enc.header,
        mime: "image/jpeg",
        size: plain.byteLength,
      });
      assert.equal(body, "");
    };
    rejectUrl("https://evil.example/media/markers/1-ab");
    rejectUrl("http://cdn.example/media/markers/1-ab");
    rejectUrl("https://cdn.example/markers/1-ab");
    rejectUrl("https://user:pass@cdn.example/media/markers/1-ab");
    rejectUrl("https://cdn.example/media/%2e%2e/secret");

    const foreignPoster = packSealedMedia("hi", {
      url: good,
      fileKey: enc.fileKey,
      header: enc.header,
      mime: "image/jpeg",
      size: plain.byteLength,
      poster: {
        url: "https://evil.example/poster.jpg",
        fileKey: enc.fileKey,
        header: enc.header,
        mime: "image/jpeg",
        size: plain.byteLength,
      },
    });
    assert.equal(readSealedMedia(foreignPoster).media.poster, undefined);

    const cipher = new Uint8Array(await enc.blob.arrayBuffer());
    const calls = [];
    const previous = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        headers: { get() { return null; } },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(cipher);
            controller.close();
          },
        }),
      };
    };
    try {
      await assert.rejects(
        decryptSealedPart({
          url: "https://evil.example/media/markers/1-ab",
          fileKey: enc.fileKey,
          header: enc.header,
          size: plain.byteLength,
        }),
        (err) => err && err.message === "decrypt",
      );
      assert.deepEqual(calls, []);
      const opened = await decryptSealedPart({
        url: good,
        fileKey: enc.fileKey,
        header: enc.header,
        mime: "image/jpeg",
        size: plain.byteLength,
      });
      assert.deepEqual(new Uint8Array(await opened.arrayBuffer()), plain);
      assert.deepEqual(calls, [good]);
    } finally {
      globalThis.fetch = previous;
    }
  });

  test("an oversized body is aborted", async () => {
    const plain = new Uint8Array([1, 2, 3]);
    const enc = await encryptStream(plain);
    const good = `${MEDIA_ORIGIN}/markers/1700000000000-big`;
    const previous = globalThis.fetch;
    try {
      let reads = 0;
      let cancelled = false;
      globalThis.fetch = async () => ({
        ok: true,
        headers: { get(name) { return String(name).toLowerCase() === "content-length" ? String(SEALED_MAX + 1) : null; } },
        body: {
          getReader() {
            reads += 1;
            throw new Error("read");
          },
          cancel() {
            cancelled = true;
            return Promise.resolve();
          },
        },
      });
      await assert.rejects(
        decryptSealedPart({
          url: good,
          fileKey: enc.fileKey,
          header: enc.header,
        }),
        (err) => err && err.message === "decrypt",
      );
      assert.equal(reads, 0);
      assert.equal(cancelled, true);

      const cap = sealedDownloadCap(1);
      assert.ok(cap < SEALED_MAX);
      let streamed = 0;
      cancelled = false;
      const total = cap + 64;
      globalThis.fetch = async () => ({
        ok: true,
        headers: { get() { return null; } },
        body: new ReadableStream({
          pull(controller) {
            if (streamed >= total) {
              controller.close();
              return;
            }
            streamed += 1;
            controller.enqueue(new Uint8Array(1));
          },
          cancel() { cancelled = true; },
        }),
      });
      await assert.rejects(
        decryptSealedPart({
          url: good,
          fileKey: enc.fileKey,
          header: enc.header,
          size: 1,
        }),
        (err) => err && err.message === "decrypt",
      );
      assert.equal(cancelled, true);
      assert.ok(streamed > cap);
      assert.ok(streamed <= cap + 2);
      assert.ok(streamed < total);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
