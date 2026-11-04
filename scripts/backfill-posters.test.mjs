// The backfill poster key is the sibling still posterSrc already requests.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { posterTargetKey, siblingPosterUrl } from "../mediaurl.js";
import { posterSrc } from "../videoposter.js";
import {
  CONCURRENCY,
  FIRST_BYTES,
  JPEG_QUALITY,
  MJPEG_QSCALE,
  applyAllowlist,
  backfillOne,
  classifyKeys,
  formatCounts,
  frameArgs,
  invokedDirectly,
  listMarkerKeys,
  loadPublicVideos,
  posterKeyFor,
  publicVideoAllowlist,
  r2Config,
  readFirstBytes,
  runBackfill,
  runPool,
  videoContainerKind,
  videoKeyFromUrl,
} from "../server/scripts/backfill-posters.mjs";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function fakeMp4() {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(32, 0);
  buf.write("ftyp", 4, "latin1");
  buf.write("isom", 8, "latin1");
  return buf;
}

function fakeWebm() {
  const buf = Buffer.alloc(32);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(buf, 0);
  buf.write("webm", 8, "latin1");
  return buf;
}

function missing() {
  const err = new Error("no");
  err.name = "NotFound";
  err.$metadata = { httpStatusCode: 404 };
  return err;
}

test("a marker video maps to the sibling still posterSrc already requests", () => {
  const mp4 = "markers/1700000000000-ab12cd.mp4";
  const webm = "markers/1700000000000-ab12cd-d12.webm";
  assert.equal(posterKeyFor(mp4), "markers/1700000000000-ab12cd.poster.jpg");
  assert.equal(posterKeyFor(webm), "markers/1700000000000-ab12cd-d12.poster.jpg");
  assert.equal(posterKeyFor("markers/1700000000000-AB12.MP4"), "markers/1700000000000-AB12.poster.jpg");
  assert.equal(siblingPosterUrl(`https://cdn.example/${mp4}`), `https://cdn.example/${posterKeyFor(mp4)}`);
  assert.equal(posterSrc(`https://cdn.example/${mp4}`), `https://cdn.example/${posterKeyFor(mp4)}`);
  assert.equal(posterSrc(`https://pub-243.r2.dev/${webm}`), `https://pub-243.r2.dev/${posterKeyFor(webm)}`);
  assert.equal(
    posterTargetKey("https://cdn.example", `https://cdn.example/${mp4}`),
    posterKeyFor(mp4),
  );
  assert.equal(
    siblingPosterUrl("https://cdn.example/media/markers/1-ab.mp4"),
    "https://cdn.example/media/markers/1-ab.poster.jpg",
  );
  assert.equal(posterKeyFor("markers/1-ab.mp4"), "markers/1-ab.poster.jpg");
  assert.equal(
    posterTargetKey("https://cdn.example/media", "https://cdn.example/media/markers/1-ab.mp4"),
    "markers/1-ab.poster.jpg",
  );
  for (const key of [
    "markers/1-ab.gif",
    "markers/1-ab.mov",
    "markers/1-ab.m4v",
    "markers/1-ab.poster.jpg",
    "markers/../secret.mp4",
    "markers/%2e%2e/secret.mp4",
    "backups/tok/db-2026-01-01.sqlite.gz.enc",
    "wall-images/uuid.png",
    "",
    "not a key",
  ]) {
    assert.equal(posterKeyFor(key), "", key);
  }
});

test("counts skip posters, non-videos, and encrypted names", () => {
  const { counts, pending } = classifyKeys([
    "markers/1700000000000-ab12cd.mp4",
    "markers/1700000000000-ab12cd.poster.jpg",
    "markers/1700000000000-zz99-d12.webm",
    "markers/1-ab.gif",
    "markers/1-ab.mov",
    "backups/tok/db-2026-01-01.sqlite.gz.enc",
    "",
  ]);
  assert.equal(counts.objects, 6);
  assert.equal(counts.videos, 2);
  assert.equal(counts.already, 1);
  assert.equal(counts.skipped, 4);
  assert.equal(counts.pending, 1);
  assert.deepEqual(pending, [{
    videoKey: "markers/1700000000000-zz99-d12.webm",
    posterKey: "markers/1700000000000-zz99-d12.poster.jpg",
  }]);
  assert.deepEqual(Object.keys(pending[0]).sort(), ["posterKey", "videoKey"]);
  assert.equal(formatCounts(counts).includes("uploaded"), false);
  assert.match(formatCounts({ ...counts, uploaded: 0, encrypted: 1, failed: 0 }), /encrypted 1/);
});

test("only an mp4 or webm container is a public video", () => {
  assert.equal(videoContainerKind(fakeMp4()), "mp4");
  assert.equal(videoContainerKind(fakeWebm()), "webm");
  assert.equal(videoContainerKind(Buffer.from("encrypted-e2ee-blob")), "");
  assert.equal(videoContainerKind(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), "");
  assert.equal(videoContainerKind(Buffer.alloc(4)), "");
  assert.equal(videoContainerKind(null), "");
});

test("ffmpeg takes the first frame, caps the long edge at 512, and uses JPEG quality 80", () => {
  assert.equal(JPEG_QUALITY, 80);
  assert.equal(MJPEG_QSCALE, 3);
  const args = frameArgs("in.mp4", "out.jpg");
  assert.equal(args[args.indexOf("-ss") + 1], "0");
  assert.equal(args[args.indexOf("-frames:v") + 1], "1");
  assert.match(args[args.indexOf("-vf") + 1], /min\(512,iw\).*min\(512,ih\)/);
  assert.equal(args[args.indexOf("-q:v") + 1], "3");
  assert.equal(args.at(-1), "out.jpg");
});

test("a range read keeps only the first few MB", async () => {
  const big = Buffer.alloc(FIRST_BYTES + 50);
  big.writeUInt32BE(32, 0);
  big.write("ftyp", 4, "latin1");
  big.write("isom", 8, "latin1");
  let range = "";
  const got = await readFirstBytes({
    async send(cmd) {
      range = cmd.input.Range;
      assert.equal(cmd.input.Key, "markers/9-range.mp4");
      return { Body: big };
    },
  }, "markers", "markers/9-range.mp4");
  assert.equal(range, `bytes=0-${FIRST_BYTES - 1}`);
  assert.equal(got.length, FIRST_BYTES);
  assert.equal(videoContainerKind(got), "mp4");
});

function allow(keys) {
  return { wanted: new Set(keys), cleared: new Set() };
}

test("dry-run prints plan counts and does not download or upload", async () => {
  let sends = 0;
  const keys = [
    "markers/1700000000000-ab12cd.mp4",
    "markers/1700000000000-ab12cd.poster.jpg",
    "markers/1700000000000-zz99.webm",
  ];
  const outcome = await runBackfill({
    client: { send() { sends += 1; throw new Error("network"); } },
    bucket: "markers",
    keys,
    dryRun: true,
    allowlist: allow(["markers/1700000000000-zz99.webm"]),
    extract() { throw new Error("ffmpeg"); },
  });
  assert.equal(sends, 0);
  assert.equal(outcome.counts.videos, 2);
  assert.equal(outcome.counts.already, 1);
  assert.equal(outcome.counts.unreferenced, 0);
  assert.equal(outcome.counts.cleared, 0);
  assert.equal(outcome.counts.pending, 1);
  assert.equal(Object.hasOwn(outcome.counts, "uploaded"), false);
  const text = formatCounts(outcome.counts);
  assert.match(text, /^objects 3\nvideos 2\nalready 1\nskipped 1\nunreferenced 0\ncleared 0\npending 1\n$/);
  const closed = await runBackfill({
    client: { send() { sends += 1; throw new Error("network"); } },
    bucket: "markers",
    keys,
    dryRun: true,
    extract() { throw new Error("ffmpeg"); },
  });
  assert.equal(sends, 0);
  assert.equal(closed.counts.pending, 0);
  assert.equal(closed.counts.unreferenced, 1);
  assert.match(formatCounts(closed.counts), /unreferenced 1\ncleared 0\npending 0\n$/);
});

test("an existing poster is not downloaded again", async () => {
  const names = [];
  const outcome = await backfillOne({
    async send(cmd) {
      names.push(cmd.constructor.name);
      if (cmd.constructor.name === "HeadObjectCommand") return {};
      throw new Error("should not fetch");
    },
  }, "markers", {
    videoKey: "markers/3-ab.mp4",
    posterKey: "markers/3-ab.poster.jpg",
    referenced: true,
  }, () => { throw new Error("ffmpeg"); });
  assert.equal(outcome, "already");
  assert.deepEqual(names, ["HeadObjectCommand"]);
});

test("a ciphertext blob is not uploaded", async () => {
  const names = [];
  let extracted = 0;
  const outcome = await runBackfill({
    client: {
      async send(cmd) {
        names.push(cmd.constructor.name);
        if (cmd.constructor.name === "HeadObjectCommand") throw missing();
        if (cmd.constructor.name === "GetObjectCommand") {
          assert.equal(cmd.input.Key, "markers/5-cipher.mp4");
          return { Body: Buffer.from("not a video, sealed blob") };
        }
        throw new Error(cmd.constructor.name);
      },
    },
    bucket: "markers",
    keys: ["markers/5-cipher.mp4"],
    dryRun: false,
    allowlist: allow(["markers/5-cipher.mp4"]),
    extract() { extracted += 1; return JPEG; },
  });
  assert.equal(extracted, 0);
  assert.equal(outcome.counts.encrypted, 1);
  assert.equal(outcome.counts.uploaded, 0);
  assert.equal(names.includes("PutObjectCommand"), false);
});

test("a clear video is stored only at the sibling poster key", async () => {
  const mp4 = fakeMp4();
  const puts = [];
  const outcome = await runBackfill({
    client: {
      async send(cmd) {
        if (cmd.constructor.name === "HeadObjectCommand") throw missing();
        if (cmd.constructor.name === "GetObjectCommand") return { Body: mp4 };
        if (cmd.constructor.name === "PutObjectCommand") {
          puts.push(cmd.input);
          return {};
        }
        throw new Error(cmd.constructor.name);
      },
    },
    bucket: "markers",
    keys: ["markers/1700000000000-ab12cd.mp4"],
    dryRun: false,
    allowlist: allow(["markers/1700000000000-ab12cd.mp4"]),
    extract(bytes) {
      assert.equal(bytes.equals(mp4), true);
      return JPEG;
    },
  });
  assert.equal(outcome.counts.uploaded, 1);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].Key, "markers/1700000000000-ab12cd.poster.jpg");
  assert.equal(puts[0].Bucket, "markers");
  assert.equal(puts[0].ContentType, "image/jpeg");
  assert.equal(puts[0].CacheControl, "public, max-age=31536000, immutable");
  assert.equal(puts[0].Metadata, undefined);
  assert.equal(JSON.stringify(puts[0]).includes("0.0."), false);
  assert.ok(puts[0].Body.equals(JPEG));
});

test("two videos are processed at a time", async () => {
  assert.equal(CONCURRENCY, 2);
  let current = 0;
  let max = 0;
  const keys = [1, 2, 3, 4].map((n) => `markers/100-a${n}.mp4`);
  await runBackfill({
    client: {
      async send(cmd) {
        if (cmd.constructor.name === "HeadObjectCommand") throw missing();
        if (cmd.constructor.name === "GetObjectCommand") return { Body: fakeMp4() };
        if (cmd.constructor.name === "PutObjectCommand") return {};
        throw new Error(cmd.constructor.name);
      },
    },
    bucket: "markers",
    keys,
    dryRun: false,
    allowlist: allow(keys),
    async extract() {
      current += 1;
      max = Math.max(max, current);
      await new Promise((resolve) => setTimeout(resolve, 30));
      current -= 1;
      return JPEG;
    },
  });
  assert.equal(max, 2);
});

test("listing walks only the markers prefix", async () => {
  const pages = [
    {
      Contents: [{ Key: "markers/1-ab.mp4" }, {}],
      IsTruncated: true,
      NextContinuationToken: "t2",
    },
    { Contents: [{ Key: "markers/1-ab.poster.jpg" }], IsTruncated: false },
  ];
  const seen = [];
  const keys = await listMarkerKeys({
    async send(cmd) {
      seen.push(cmd.input);
      return pages.shift();
    },
  }, "markers");
  assert.deepEqual(keys, ["markers/1-ab.mp4", "markers/1-ab.poster.jpg"]);
  assert.equal(seen[0].Prefix, "markers/");
  assert.equal(seen[0].Bucket, "markers");
  assert.equal(seen[1].ContinuationToken, "t2");
});

test("the pool never runs more than its limit", async () => {
  let current = 0;
  let max = 0;
  await runPool([1, 2, 3, 4, 5], 2, async () => {
    current += 1;
    max = Math.max(max, current);
    await new Promise((resolve) => setTimeout(resolve, 15));
    current -= 1;
  });
  assert.equal(max, 2);
});

test("an extensionless sealed object is not selected for a poster", () => {
  const listed = classifyKeys([
    "markers/1700000000000-ab12cd",
    "markers/1700000000000-ab12cd.mp4",
    "markers/9-zz.poster.jpg",
  ]);
  assert.equal(listed.counts.skipped, 2);
  assert.equal(listed.counts.videos, 1);
  assert.equal(listed.pending.length, 1);
  assert.equal(listed.pending[0].videoKey, "markers/1700000000000-ab12cd.mp4");
  assert.equal(posterKeyFor("markers/1700000000000-ab12cd"), "");
});

test("a plaintext E2EE chat mp4 is skipped", async () => {
  const e2ee = "markers/1700000000000-e2eechat.mp4";
  const kept = "markers/1700000000000-public.mp4";
  const dropped = "markers/1700000000000-cleared.mp4";
  const cover = "markers/1700000000000-cover.mp4";
  const e2eeUrl = `https://cdn.example/${e2ee}`;
  const clearedTs = "1700000003.000000000";
  const clearedIso = new Date(Number(clearedTs) * 1000).toISOString();
  const rows = [
    {
      topic_id: "0.0.9001",
      ts: "1700000000.000000000",
      body: JSON.stringify({
        encryptedMessage: { ciphertext: `sealed plain mp4 ${e2eeUrl}` },
      }),
    },
    {
      topic_id: "0.0.9001",
      ts: "1700000001.000000000",
      body: `\u001echat1\n${JSON.stringify({ t: "clip", i: e2eeUrl })}`,
    },
    {
      topic_id: "0.0.9002",
      ts: "1700000002.000000000",
      body: JSON.stringify({
        userMessage: "public",
        image: `https://cdn.example/${kept}`,
      }),
    },
    {
      topic_id: "0.0.9002",
      ts: clearedTs,
      body: JSON.stringify({
        marker: { data: { image: [`https://cdn.example/${dropped}`], msg: "show" } },
      }),
    },
    {
      topic_id: "0.0.9002",
      ts: "1700000004.000000000",
      body: JSON.stringify({
        marker: { data: { msg: "show", posterOff: true, editMarkerCreated: clearedIso } },
      }),
    },
    {
      topic_id: "0.0.9003",
      ts: "1700000005.000000000",
      body: JSON.stringify({
        polygon: { data: { coverimage: [`https://cdn.example/${cover}`] } },
      }),
    },
  ];
  assert.equal(videoKeyFromUrl(e2eeUrl), e2ee);
  const allowlist = publicVideoAllowlist(rows);
  assert.equal(allowlist.wanted.has(e2ee), false);
  assert.equal(allowlist.cleared.has(e2ee), false);
  assert.equal(allowlist.wanted.has(kept), true);
  assert.equal(allowlist.wanted.has(cover), true);
  assert.equal(allowlist.wanted.has(dropped), false);
  assert.equal(allowlist.cleared.has(dropped), true);
  assert.equal([...allowlist.wanted, ...allowlist.cleared].join(" ").includes("0.0."), false);
  assert.deepEqual(Object.keys(allowlist).sort(), ["cleared", "wanted"]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbs-poster-allow-"));
  try {
    const dbPath = path.join(dir, "data.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE messages (
      topic_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL,
      payer TEXT NOT NULL,
      body TEXT NOT NULL
    )`);
    const insert = db.prepare(
      "INSERT INTO messages (topic_id, seq, ts, payer, body) VALUES (?, ?, ?, ?, ?)",
    );
    rows.forEach((row, index) => insert.run(row.topic_id, index, row.ts, "0.0.999999", row.body));
    db.close();
    const loaded = loadPublicVideos(dbPath);
    assert.equal(loaded.ok, true);
    assert.deepEqual([...loaded.wanted].sort(), [...allowlist.wanted].sort());
    assert.deepEqual([...loaded.cleared].sort(), [...allowlist.cleared].sort());
    assert.equal([...loaded.wanted, ...loaded.cleared].join(" ").includes("0.0.999999"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(loadPublicVideos(path.join(dir, "missing.db")).ok, false);

  let sends = 0;
  const outcome = await runBackfill({
    client: { send() { sends += 1; throw new Error("network"); } },
    bucket: "markers",
    keys: [e2ee, kept, dropped, cover, "markers/1700000000000-sealed"],
    dryRun: true,
    allowlist,
    extract() { throw new Error("ffmpeg"); },
  });
  assert.equal(sends, 0);
  assert.equal(outcome.counts.unreferenced, 1);
  assert.equal(outcome.counts.cleared, 1);
  assert.equal(outcome.counts.pending, 2);
  assert.equal(outcome.counts.skipped, 1);
  assert.deepEqual(outcome.pending.map((job) => job.videoKey), [cover, kept]);
  assert.equal(outcome.pending.every((job) => job.referenced === true), true);
  assert.match(formatCounts(outcome.counts), /unreferenced 1\ncleared 1\npending 2\n/);
  const planned = applyAllowlist(classifyKeys([e2ee]), allowlist);
  assert.equal(planned.pending.length, 0);
  assert.equal(planned.counts.unreferenced, 1);

  let fetched = 0;
  const direct = await backfillOne({
    async send() {
      fetched += 1;
      throw new Error("no");
    },
  }, "markers", {
    videoKey: e2ee,
    posterKey: posterKeyFor(e2ee),
  }, () => { throw new Error("ffmpeg"); });
  assert.equal(direct, "unreferenced");
  assert.equal(fetched, 0);
});

test("the npm script points at the backfill and a missing R2 config does not connect", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["backfill:posters"], "node server/scripts/backfill-posters.mjs");
  assert.equal(r2Config({}), null);
  assert.equal(r2Config({ R2_BUCKET: "markers" }), null);
  const scriptUrl = new URL("../server/scripts/backfill-posters.mjs", import.meta.url).href;
  assert.equal(invokedDirectly(["node", fileURLToPath(scriptUrl)], scriptUrl), true);
  assert.equal(invokedDirectly(["node", fileURLToPath(import.meta.url)], scriptUrl), false);
});
