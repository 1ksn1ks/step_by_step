// Hashinal warm-up. The mirror is mocked. Nothing here opens a socket.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";

import {
  HCS1_NEW_REBUILD_PER_IP_HOUR,
  HCS1_R2_DAILY_IP_MB,
  HCS1_R2_DAILY_TOTAL_MB,
  HCS1_R2_WARM_SHARE,
  clearHcs1Cache,
  getHcs1File,
  hcs1MissPending,
} from "../server/hcs1.js";
import {
  HCS1_BODY_TOPIC_SQL,
  HCS1_WARM_INTERVAL_MS,
  HCS1_WARM_LIST_CAP,
  HCS1_WARM_MISS_MS,
  HCS1_WARM_PER_TICK,
  collectKnownHcs1Topics,
  hcs1WarmListState,
  readHcs1BodyTopics,
  resetHcs1BodyTopics,
  resetHcs1WarmSkips,
  runHcs1WarmTick,
  setHcs1WarmListCap,
  startHcs1Warm,
} from "../server/hcs1warm.js";

const MIRROR = "https://mirror.test";

function inscribed(bytes, mime) {
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const text = `data:${mime};base64,` + zlib.zstdCompressSync(bytes).toString("base64");
  const chunks = [];
  for (let o = 0, at = 0; at < text.length; o += 1, at += 180) chunks.push({ o, c: text.slice(at, at + 180) });
  return { memo: `${hash}:zstd:base64`, chunks };
}

// Tracks how many fetches are in flight, so a tick that fans out fails.
function mirrorOf(topics) {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const fetchJson = async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    calls.push(url);
    try {
      const id = /topics\/(0\.0\.\d+)/.exec(url)[1];
      const topic = topics[id];
      if (!topic) return { topic_id: id, memo: "" };
      if (url.includes("/messages")) {
        return {
          messages: topic.chunks.map((part, i) => ({
            message: Buffer.from(JSON.stringify(part)).toString("base64"),
            sequence_number: i + 1,
          })),
          links: { next: null },
        };
      }
      return { topic_id: id, memo: topic.memo };
    } finally {
      active -= 1;
    }
  };
  return {
    fetchJson,
    calls,
    get maxActive() {
      return maxActive;
    },
  };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async send(command) {
      const { Key } = command.input;
      const kind = command.constructor.name;
      if (kind === "PutObjectCommand") {
        objects.set(Key, { ...command.input, Body: Buffer.from(command.input.Body) });
        return {};
      }
      const object = objects.get(Key);
      if (!object) {
        const err = new Error("not found");
        err.name = "NotFound";
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      if (kind === "HeadObjectCommand") return { ContentLength: object.Body.length, Metadata: object.Metadata || {} };
      if (kind === "GetObjectCommand") {
        const body = Readable.from([object.Body]);
        body.transformToByteArray = async () => new Uint8Array(object.Body);
        return { Body: body };
      }
      throw new Error(`unexpected command ${kind}`);
    },
  };
}

function asked(calls, id) {
  return calls.filter((url) => url.includes(`/topics/${id}`)).length;
}

test("the new-rebuild default is 300 per IP per hour", () => {
  if (!process.env.HCS1_NEW_REBUILD_PER_IP_HOUR) assert.equal(HCS1_NEW_REBUILD_PER_IP_HOUR, 300);
  if (!process.env.HCS1_WARM_INTERVAL_MS) assert.equal(HCS1_WARM_INTERVAL_MS, 10 * 60 * 1000);
  if (!process.env.HCS1_WARM_PER_TICK) assert.equal(HCS1_WARM_PER_TICK, 20);
  if (!process.env.HCS1_WARM_MISS_MS) assert.equal(HCS1_WARM_MISS_MS, 24 * 60 * 60 * 1000);
  if (!process.env.HCS1_R2_WARM_SHARE) assert.equal(HCS1_R2_WARM_SHARE, 0.5);
});

test("known topics come from urls the server already holds", () => {
  const ids = collectKnownHcs1Topics([
    "hcs://1/0.0.7",
    "https://kiloscribe.com/api/inscription-cdn/0.0.8?x=1",
    "/api/hcs1/0.0.9",
    {
      marker: { data: { image: ["hcs://1/0.0.7"], coverimage: ["https://kiloscribe.com/api/inscription-cdn/0.0.10"] } },
      polygon: { data: { coverimage: ["https://example.com/api/hcs1/0.0.11"] } },
      data: { urls: ["hcs://1/0.0.12"] },
    },
    { token_id: "0.0.999", serial: 1, created_timestamp: "1.000000000" },
    { owners: { "0.0.4": 4 } },
    "hcs://1/not-a-topic",
    "hcs://1/0.0.13extra",
  ]);
  assert.deepEqual(ids, ["0.0.7", "0.0.8", "0.0.9", "0.0.10", "0.0.11", "0.0.12"]);
});

test("a tick warms only topics that are not cached, at most perTick, one at a time", async () => {
  clearHcs1Cache();
  const topics = {};
  for (const id of ["0.0.41", "0.0.42", "0.0.43", "0.0.44"]) {
    topics[id] = inscribed(Buffer.from(`file-${id}`), "text/plain");
  }
  const mirror = mirrorOf(topics);
  const opts = { mirrorFetch: mirror.fetchJson, mirror: MIRROR, now: () => 5_000 };
  await getHcs1File("0.0.41", opts);
  const afterCache = mirror.calls.length;
  assert.ok(afterCache > 0);

  const lines = [];
  const summary = await runHcs1WarmTick({
    ...opts,
    collect: () => ["0.0.41", "0.0.42", "0.0.43", "0.0.44"],
    perTick: 2,
    log: (line) => lines.push(line),
  });

  assert.equal(summary.warmed, 2);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed, 0);
  assert.equal(asked(mirror.calls.slice(afterCache), "0.0.41"), 0);
  assert.ok(asked(mirror.calls, "0.0.42") > 0);
  assert.ok(asked(mirror.calls, "0.0.43") > 0);
  assert.equal(asked(mirror.calls, "0.0.44"), 0);
  assert.equal(mirror.maxActive, 1);
  assert.deepEqual(lines, ["hcs1 warm: warmed 2, skipped 1, failed 0"]);
  clearHcs1Cache();
});

test("a tick stops when the rebuild slots are full", async () => {
  clearHcs1Cache();
  const topics = {
    "0.0.21": inscribed(Buffer.from("held"), "text/plain"),
    "0.0.22": inscribed(Buffer.from("next"), "text/plain"),
  };
  let release;
  const block = new Promise((resolve) => { release = resolve; });
  let entered;
  const enteredP = new Promise((resolve) => { entered = resolve; });
  const calls = [];
  const mirrorFetch = async (url) => {
    calls.push(url);
    if (url.includes("/topics/0.0.21") && !url.includes("/messages")) {
      entered();
      await block;
    }
    const id = /topics\/(0\.0\.\d+)/.exec(url)[1];
    const topic = topics[id];
    if (url.includes("/messages")) {
      return {
        messages: topic.chunks.map((part, i) => ({
          message: Buffer.from(JSON.stringify(part)).toString("base64"),
          sequence_number: i + 1,
        })),
        links: { next: null },
      };
    }
    return { topic_id: id, memo: topic.memo };
  };
  const pending = getHcs1File("0.0.21", {
    mirrorFetch,
    mirror: MIRROR,
    maxRebuilds: 1,
    now: () => 5_000,
  });
  try {
    await enteredP;
    const summary = await runHcs1WarmTick({
      collect: () => ["0.0.22"],
      mirrorFetch,
      mirror: MIRROR,
      maxRebuilds: 1,
      now: () => 5_000,
      log() {},
    });
    assert.equal(summary.warmed, 0);
    assert.equal(summary.failed, 0);
    assert.equal(calls.some((url) => url.includes("/topics/0.0.22")), false);
  } finally {
    release();
    await pending;
    clearHcs1Cache();
  }
});

test("a warm rebuild does not spend a visitor IP's new-rebuild cap", async () => {
  clearHcs1Cache();
  const topics = {};
  for (const id of ["0.0.32", "0.0.33", "0.0.34"]) {
    topics[id] = inscribed(Buffer.from(`file-${id}`), "text/plain");
  }
  const mirror = mirrorOf(topics);
  const now = () => 8_000;
  const limits = { newRebuildMax: 1, newRebuildWindowMs: 60_000, now, mirrorFetch: mirror.fetchJson, mirror: MIRROR };
  const summary = await runHcs1WarmTick({
    ...limits,
    collect: () => ["0.0.32"],
    log() {},
  });
  assert.equal(summary.warmed, 1);
  const visitor = await getHcs1File("0.0.33", { ...limits, ip: "203.0.113.9" });
  assert.equal(visitor.ok, true);
  const over = await getHcs1File("0.0.34", { ...limits, ip: "203.0.113.9" });
  assert.equal(over.status, 429);
  clearHcs1Cache();
});

test("interval 0 does not schedule a tick", () => {
  let timers = 0;
  let fetches = 0;
  const started = startHcs1Warm({
    intervalMs: 0,
    collect: () => ["0.0.1"],
    mirrorFetch: () => { fetches += 1; throw new Error("network"); },
    setInterval: () => { timers += 1; return { unref() {} }; },
  });
  assert.equal(timers, 0);
  assert.equal(fetches, 0);
  started.stop();

  if (!process.env.HCS1_WARM_INTERVAL_MS) {
    let delay = 0;
    let unrefed = false;
    const running = startHcs1Warm({
      collect: () => [],
      setInterval: (fn, ms) => {
        delay = ms;
        return { unref() { unrefed = true; } };
      },
      clearInterval() {},
    });
    assert.equal(delay, 10 * 60 * 1000);
    assert.equal(unrefed, true);
    running.stop();
  }
});

test("a failed topic is remembered and skipped on the next tick", async () => {
  clearHcs1Cache();
  const mirror = mirrorOf({});
  const now = () => 9_000;
  const once = await runHcs1WarmTick({
    collect: () => ["0.0.77"],
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    now,
    log() {},
  });
  assert.equal(once.failed, 1);
  assert.equal(once.warmed, 0);
  assert.equal(hcs1MissPending("0.0.77", now), true);
  const calls = mirror.calls.length;
  assert.ok(calls > 0);
  const again = await runHcs1WarmTick({
    collect: () => ["0.0.77"],
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    now,
    log() {},
  });
  assert.equal(again.skipped, 1);
  assert.equal(again.failed, 0);
  assert.equal(again.warmed, 0);
  assert.equal(mirror.calls.length, calls);
  clearHcs1Cache();
});

test("a file already in R2 is not rebuilt, and a full daily budget still serves", async () => {
  clearHcs1Cache();
  const topics = {
    "0.0.61": inscribed(Buffer.from("stored"), "image/png"),
    "0.0.62": inscribed(Buffer.from("fresh"), "image/png"),
  };
  const mirror = mirrorOf(topics);
  const r2 = fakeR2();
  r2.objects.set("hcs1/0.0.61", { Body: Buffer.from("stored"), Metadata: { sha256: "ab".repeat(32), mime: "image/png" } });
  const summary = await runHcs1WarmTick({
    collect: () => ["0.0.61", "0.0.62"],
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    s3: r2,
    bucket: "media",
    r2DailyTotalBytes: 0,
    now: () => 5_000,
    log() {},
  });
  assert.equal(summary.skipped, 1);
  assert.equal(summary.warmed, 1);
  assert.equal(asked(mirror.calls, "0.0.61"), 0);
  assert.ok(asked(mirror.calls, "0.0.62") > 0);
  assert.equal(r2.objects.has("hcs1/0.0.62"), false);
  clearHcs1Cache();
});

test("warm stores past 50 MB and stops at half the daily total, and a visitor still stops at 50 MB", async () => {
  clearHcs1Cache();
  const each = 8 * 1024 * 1024;
  const warmBudget = HCS1_R2_DAILY_TOTAL_MB * 1024 * 1024 * HCS1_R2_WARM_SHARE;
  const warmFit = Math.floor(warmBudget / each);
  const visitorBudget = HCS1_R2_DAILY_IP_MB * 1024 * 1024;
  const visitorFit = Math.floor(visitorBudget / each);
  assert.ok(warmFit > visitorFit);
  assert.ok(warmFit * each <= warmBudget);
  assert.ok((warmFit + 1) * each > warmBudget);
  const warmIds = Array.from({ length: warmFit + 2 }, (_, i) => `0.0.${1001 + i}`);
  const visitorIds = Array.from({ length: visitorFit + 1 }, (_, i) => `0.0.${1101 + i}`);
  const topics = {};
  for (const id of [...warmIds, ...visitorIds]) topics[id] = inscribed(Buffer.alloc(each), "image/png");
  const mirror = mirrorOf(topics);
  const r2 = fakeR2();
  const now = () => 12_000;
  const summary = await runHcs1WarmTick({
    collect: () => warmIds,
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    s3: r2,
    bucket: "media",
    now,
    perTick: warmIds.length,
    log() {},
  });
  assert.equal(summary.warmed, warmFit + 1);
  assert.equal(summary.failed, 0);
  for (let i = 0; i < warmFit; i += 1) assert.equal(r2.objects.has(`hcs1/${warmIds[i]}`), true);
  assert.equal(r2.objects.has(`hcs1/${warmIds[warmFit]}`), false);
  assert.equal(asked(mirror.calls, warmIds[warmFit + 1]), 0);

  let visitorStored = 0;
  for (const id of visitorIds) {
    const file = await getHcs1File(id, {
      mirrorFetch: mirror.fetchJson,
      mirror: MIRROR,
      s3: r2,
      bucket: "media",
      ip: "203.0.113.50",
      now,
    });
    assert.equal(file.ok, true);
    if (r2.objects.has(`hcs1/${id}`)) visitorStored += 1;
  }
  assert.equal(visitorStored, visitorFit);
  assert.equal(r2.objects.has(`hcs1/${visitorIds[visitorFit]}`), false);
  const storedBytes = (warmFit + visitorFit) * each;
  assert.ok(storedBytes <= HCS1_R2_DAILY_TOTAL_MB * 1024 * 1024);
  clearHcs1Cache();
});

test("an explicit warm per-IP budget overrides the half share", async () => {
  clearHcs1Cache();
  const ids = ["0.0.151", "0.0.152", "0.0.153", "0.0.154"];
  const topics = {};
  for (const id of ids) topics[id] = inscribed(Buffer.alloc(1000), "image/png");
  const mirror = mirrorOf(topics);
  const r2 = fakeR2();
  const summary = await runHcs1WarmTick({
    collect: () => ids,
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    s3: r2,
    bucket: "media",
    r2DailyTotalBytes: 10_000,
    r2DailyIpBytes: 2000,
    now: () => 12_500,
    perTick: ids.length,
    log() {},
  });
  assert.equal(summary.warmed, 3);
  assert.equal(r2.objects.has("hcs1/0.0.151"), true);
  assert.equal(r2.objects.has("hcs1/0.0.152"), true);
  assert.equal(r2.objects.has("hcs1/0.0.153"), false);
  assert.ok(asked(mirror.calls, "0.0.153") > 0);
  assert.equal(asked(mirror.calls, "0.0.154"), 0);
  clearHcs1Cache();
});

test("a warm tick stops after a rebuild that R2 would not store", async () => {
  clearHcs1Cache();
  const topics = {
    "0.0.81": inscribed(Buffer.from("one-file"), "image/png"),
    "0.0.82": inscribed(Buffer.from("two-file"), "image/png"),
  };
  const mirror = mirrorOf(topics);
  const r2 = fakeR2();
  const summary = await runHcs1WarmTick({
    collect: () => ["0.0.81", "0.0.82"],
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    s3: r2,
    bucket: "media",
    r2DailyTotalBytes: 0,
    now: () => 13_000,
    log() {},
  });
  assert.equal(summary.warmed, 1);
  assert.equal(summary.failed, 0);
  assert.ok(asked(mirror.calls, "0.0.81") > 0);
  assert.equal(asked(mirror.calls, "0.0.82"), 0);
  assert.equal(r2.objects.has("hcs1/0.0.81"), false);
  clearHcs1Cache();
});

test("a tick that throws while collecting still returns", async () => {
  const lines = [];
  const summary = await runHcs1WarmTick({
    collect() { throw new Error("boom"); },
    mirrorFetch: () => { throw new Error("network"); },
    log: (line) => lines.push(line),
  });
  assert.deepEqual(summary, { warmed: 0, skipped: 0, failed: 0 });
  assert.deepEqual(lines, ["hcs1 warm: warmed 0, skipped 0, failed 0"]);
});

test("a topic already in R2 is headed once across two ticks", async () => {
  clearHcs1Cache();
  const id = "0.0.201";
  const r2 = fakeR2();
  let heads = 0;
  const send = r2.send.bind(r2);
  r2.send = async (command) => {
    if (command.constructor.name === "HeadObjectCommand") heads += 1;
    return send(command);
  };
  r2.objects.set(`hcs1/${id}`, {
    Body: Buffer.from("stored"),
    Metadata: { sha256: "ab".repeat(32), mime: "image/png" },
  });
  const opts = {
    collect: () => [id],
    mirrorFetch: async () => { throw new Error("mirror"); },
    mirror: MIRROR,
    s3: r2,
    bucket: "media",
    now: () => 20_000,
    log() {},
  };
  const first = await runHcs1WarmTick(opts);
  assert.equal(first.skipped, 1);
  assert.equal(first.warmed, 0);
  assert.equal(heads, 1);
  clearHcs1Cache();
  const second = await runHcs1WarmTick(opts);
  assert.equal(second.skipped, 1);
  assert.equal(second.warmed, 0);
  assert.equal(second.failed, 0);
  assert.equal(heads, 1);
  clearHcs1Cache();
});

test("a 413 is not retried on the next tick", async () => {
  clearHcs1Cache();
  const id = "0.0.301";
  const topics = { [id]: inscribed(Buffer.from("too-many"), "image/png") };
  const mirror = mirrorOf(topics);
  const now = () => 30_000;
  const opts = {
    collect: () => [id],
    mirrorFetch: mirror.fetchJson,
    mirror: MIRROR,
    maxMessages: 0,
    now,
    log() {},
  };
  const first = await runHcs1WarmTick(opts);
  assert.equal(first.failed, 1);
  assert.equal(first.warmed, 0);
  assert.ok(asked(mirror.calls, id) > 0);
  const calls = mirror.calls.length;
  clearHcs1Cache();
  const second = await runHcs1WarmTick(opts);
  assert.equal(second.skipped, 1);
  assert.equal(second.failed, 0);
  assert.equal(second.warmed, 0);
  assert.equal(mirror.calls.length, calls);
  clearHcs1Cache();
});

test("the bodies query reads only new rows", () => {
  resetHcs1BodyTopics();
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE messages (
        topic_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        ts TEXT NOT NULL,
        payer TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (topic_id, seq)
      )
    `);
    const insert = db.prepare(
      "INSERT INTO messages (topic_id, seq, ts, payer, body) VALUES ('chat', ?, 't', 'payer', ?)",
    );
    insert.run(1, "hello");
    insert.run(2, "see hcs://1/0.0.401");
    const stmt = db.prepare(HCS1_BODY_TOPIC_SQL);
    const bounds = [];
    const pages = [];
    const query = {
      all(cursor) {
        bounds.push(cursor);
        const rows = stmt.all(cursor);
        pages.push(rows.map((row) => row.rowid));
        return rows;
      },
    };
    const first = [...readHcs1BodyTopics(query)];
    assert.deepEqual(bounds, [0]);
    assert.deepEqual(first, ["0.0.401"]);
    assert.equal(pages[0].length, 1);
    insert.run(3, "and https://kiloscribe.com/api/inscription-cdn/0.0.402");
    const second = [...readHcs1BodyTopics(query)];
    assert.deepEqual(bounds, [0, pages[0][0]]);
    assert.notEqual(bounds[1], 0);
    assert.deepEqual(pages[1], [pages[0][0] + 1]);
    assert.deepEqual(second, ["0.0.401", "0.0.402"]);
    assert.deepEqual(collectKnownHcs1Topics(second.map((id) => `hcs://1/${id}`)), second);

    resetHcs1BodyTopics();
    const bulk = new DatabaseSync(":memory:");
    try {
      bulk.exec(`
        CREATE TABLE messages (
          topic_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          ts TEXT NOT NULL,
          payer TEXT NOT NULL,
          body TEXT NOT NULL,
          PRIMARY KEY (topic_id, seq)
        )
      `);
      const add = bulk.prepare(
        "INSERT INTO messages (topic_id, seq, ts, payer, body) VALUES ('bulk', ?, 't', 'payer', ?)",
      );
      for (let i = 0; i < 2001; i += 1) add.run(i, `hcs://1/0.0.${600000 + i}`);
      const bulkStmt = bulk.prepare(HCS1_BODY_TOPIC_SQL);
      const bulkBounds = [];
      const bulkQuery = {
        all(cursor) {
          bulkBounds.push(cursor);
          return bulkStmt.all(cursor);
        },
      };
      const page = [...readHcs1BodyTopics(bulkQuery)];
      const cut = bulk.prepare("SELECT rowid AS id FROM messages ORDER BY rowid LIMIT 1 OFFSET 1999").get();
      assert.deepEqual(bulkBounds, [0, cut.id]);
      assert.notEqual(bulkBounds[1], 0);
      assert.equal(page.length, 2001);
      assert.equal(page[0], "0.0.600000");
      assert.equal(page[1999], "0.0.601999");
      assert.equal(page[2000], "0.0.602000");
    } finally {
      bulk.close();
    }
  } finally {
    resetHcs1BodyTopics();
    db.close();
  }
});

function messagesDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE messages (
      topic_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL,
      payer TEXT NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (topic_id, seq)
    )
  `);
  return db;
}

function quietTick(extra) {
  return { mirror: MIRROR, log() {}, ...extra };
}

test("an expired miss is pruned and retried in the same tick", async () => {
  clearHcs1Cache();
  resetHcs1WarmSkips();
  const kept = "0.0.311";
  const gone = "0.0.312";
  const mirror = mirrorOf({});
  let clock = 40_000;
  const base = quietTick({
    mirrorFetch: mirror.fetchJson,
    now: () => clock,
    perTick: 5,
  });
  const first = await runHcs1WarmTick({ ...base, collect: () => [kept, gone] });
  assert.equal(first.failed, 2);
  assert.deepEqual(hcs1WarmListState().missed, [kept, gone]);
  const calls = mirror.calls.length;
  clock = 40_000 + HCS1_WARM_MISS_MS - 1;
  clearHcs1Cache();
  const early = await runHcs1WarmTick({ ...base, collect: () => [kept] });
  assert.equal(early.skipped, 1);
  assert.equal(early.failed, 0);
  assert.equal(mirror.calls.length, calls);
  assert.deepEqual(hcs1WarmListState().missed, [kept, gone]);
  clock = 40_000 + HCS1_WARM_MISS_MS;
  clearHcs1Cache();
  const retried = await runHcs1WarmTick({ ...base, collect: () => [kept] });
  assert.equal(retried.failed, 1);
  assert.equal(retried.skipped, 0);
  assert.ok(mirror.calls.length > calls);
  assert.deepEqual(hcs1WarmListState().missed, [kept]);
  clearHcs1Cache();
  resetHcs1WarmSkips();
});

test("a stored topic is headed again only after the miss window", async () => {
  clearHcs1Cache();
  resetHcs1WarmSkips();
  const id = "0.0.211";
  const r2 = fakeR2();
  let heads = 0;
  let mirrorCalls = 0;
  const send = r2.send.bind(r2);
  r2.send = async (command) => {
    if (command.constructor.name === "HeadObjectCommand") heads += 1;
    return send(command);
  };
  r2.objects.set(`hcs1/${id}`, {
    Body: Buffer.from("stored"),
    Metadata: { sha256: "ab".repeat(32), mime: "image/png" },
  });
  let clock = 50_000;
  const opts = quietTick({
    collect: () => [id],
    mirrorFetch: async () => {
      mirrorCalls += 1;
      throw new Error("mirror");
    },
    mirror: MIRROR,
    s3: r2,
    bucket: "media",
    now: () => clock,
  });
  const first = await runHcs1WarmTick(opts);
  assert.equal(first.skipped, 1);
  assert.equal(first.warmed, 0);
  assert.equal(heads, 1);
  assert.equal(mirrorCalls, 0);
  clock = 50_000 + HCS1_WARM_MISS_MS - 1;
  clearHcs1Cache();
  const early = await runHcs1WarmTick(opts);
  assert.equal(early.skipped, 1);
  assert.equal(heads, 1);
  assert.equal(mirrorCalls, 0);
  clock = 50_000 + HCS1_WARM_MISS_MS;
  clearHcs1Cache();
  const again = await runHcs1WarmTick(opts);
  assert.equal(again.skipped, 1);
  assert.equal(again.warmed, 0);
  assert.equal(again.failed, 0);
  assert.equal(heads, 2);
  assert.equal(mirrorCalls, 0);
  assert.deepEqual(hcs1WarmListState().stored, [id]);
  clearHcs1Cache();
  const held = await runHcs1WarmTick(opts);
  assert.equal(held.skipped, 1);
  assert.equal(heads, 2);
  clearHcs1Cache();
  resetHcs1WarmSkips();
});

test("a stored topic missing from R2 after the window is warmed again", async () => {
  clearHcs1Cache();
  resetHcs1WarmSkips();
  const id = "0.0.212";
  const topics = { [id]: inscribed(Buffer.from("came-back"), "image/png") };
  const mirror = mirrorOf(topics);
  const r2 = fakeR2();
  let heads = 0;
  const send = r2.send.bind(r2);
  r2.send = async (command) => {
    if (command.constructor.name === "HeadObjectCommand") heads += 1;
    return send(command);
  };
  r2.objects.set(`hcs1/${id}`, {
    Body: Buffer.from("stored"),
    Metadata: { sha256: "ab".repeat(32), mime: "image/png" },
  });
  let clock = 60_000;
  const opts = quietTick({
    collect: () => [id],
    mirrorFetch: mirror.fetchJson,
    s3: r2,
    bucket: "media",
    now: () => clock,
  });
  const first = await runHcs1WarmTick(opts);
  assert.equal(first.skipped, 1);
  assert.equal(heads, 1);
  assert.equal(asked(mirror.calls, id), 0);
  r2.objects.delete(`hcs1/${id}`);
  clock = 60_000 + HCS1_WARM_MISS_MS;
  clearHcs1Cache();
  const again = await runHcs1WarmTick(opts);
  assert.equal(again.warmed, 1);
  assert.equal(again.failed, 0);
  assert.ok(heads > 1);
  assert.ok(asked(mirror.calls, id) > 0);
  assert.equal(r2.objects.has(`hcs1/${id}`), true);
  assert.deepEqual(hcs1WarmListState().stored, [id]);
  const after = heads;
  clearHcs1Cache();
  const held = await runHcs1WarmTick(opts);
  assert.equal(held.skipped, 1);
  assert.equal(held.warmed, 0);
  assert.equal(heads, after);
  clearHcs1Cache();
  resetHcs1WarmSkips();
});

test("skip lists evict the oldest entry and keep a refreshed one", async () => {
  clearHcs1Cache();
  resetHcs1WarmSkips();
  resetHcs1BodyTopics();
  setHcs1WarmListCap(3);
  try {
    assert.equal(HCS1_WARM_LIST_CAP, 20_000);
    const storedIds = ["0.0.701", "0.0.702", "0.0.703", "0.0.704", "0.0.705"];
    const r2 = fakeR2();
    for (const id of storedIds) {
      r2.objects.set(`hcs1/${id}`, {
        Body: Buffer.from("stored"),
        Metadata: { sha256: "ab".repeat(32), mime: "image/png" },
      });
    }
    let clock = 70_000;
    const head = (id) => runHcs1WarmTick(quietTick({
      collect: () => [id],
      mirrorFetch: async () => { throw new Error("mirror"); },
      s3: r2,
      bucket: "media",
      now: () => clock,
    }));
    await head("0.0.701");
    clock += 1;
    await head("0.0.702");
    clock += 1;
    await head("0.0.703");
    clock += 1;
    await head("0.0.704");
    assert.deepEqual(hcs1WarmListState().stored, ["0.0.702", "0.0.703", "0.0.704"]);
    const refreshedAt = clock + HCS1_WARM_MISS_MS;
    clock = refreshedAt;
    clearHcs1Cache();
    await head("0.0.702");
    assert.deepEqual(hcs1WarmListState().stored, ["0.0.703", "0.0.704", "0.0.702"]);
    clock += 1;
    clearHcs1Cache();
    await head("0.0.705");
    assert.deepEqual(hcs1WarmListState().stored, ["0.0.704", "0.0.702", "0.0.705"]);

    resetHcs1WarmSkips();
    clearHcs1Cache();
    const missIds = ["0.0.711", "0.0.712", "0.0.713", "0.0.714"];
    const mirror = mirrorOf({});
    clock = 80_000;
    const miss = (ids) => runHcs1WarmTick(quietTick({
      collect: () => ids,
      mirrorFetch: mirror.fetchJson,
      now: () => clock,
      perTick: ids.length,
    }));
    await miss(["0.0.711"]);
    clock = 80_010;
    await miss(["0.0.712"]);
    clock = 80_020;
    await miss(["0.0.713"]);
    clock = 80_000 + HCS1_WARM_MISS_MS;
    clearHcs1Cache();
    await miss(["0.0.711", "0.0.714"]);
    assert.deepEqual(hcs1WarmListState().missed, ["0.0.713", "0.0.711", "0.0.714"]);

    resetHcs1WarmSkips();
    resetHcs1BodyTopics();
    clearHcs1Cache();
    r2.objects.set("hcs1/0.0.721", {
      Body: Buffer.from("stored"),
      Metadata: { sha256: "cd".repeat(32), mime: "image/png" },
    });
    clock = 90_000;
    await runHcs1WarmTick(quietTick({
      collect: () => ["0.0.721"],
      mirrorFetch: async () => { throw new Error("mirror"); },
      s3: r2,
      bucket: "media",
      now: () => clock,
    }));
    const db = messagesDb();
    try {
      const add = db.prepare(
        "INSERT INTO messages (topic_id, seq, ts, payer, body) VALUES ('body', ?, 't', 'payer', ?)",
      );
      const bodies = ["0.0.722", "0.0.721", "0.0.723", "0.0.724"];
      bodies.forEach((id, seq) => add.run(seq + 1, `hcs://1/${id}`));
      const stmt = db.prepare(HCS1_BODY_TOPIC_SQL);
      const bounds = [];
      const query = {
        all(cursor) {
          bounds.push(cursor);
          return stmt.all(cursor);
        },
      };
      const found = [...readHcs1BodyTopics(query)];
      assert.deepEqual(found, ["0.0.722", "0.0.723", "0.0.724"]);
      const cursor = hcs1WarmListState().lastBodyRowid;
      const fourth = db.prepare("SELECT rowid AS id FROM messages ORDER BY rowid LIMIT 1 OFFSET 3").get();
      assert.equal(cursor, fourth.id);
      assert.notEqual(cursor, 0);
      assert.equal(hcs1WarmListState().stored.includes("0.0.721"), true);
      const again = [...readHcs1BodyTopics(query)];
      assert.deepEqual(again, found);
      assert.deepEqual(bounds, [0, cursor]);
      assert.equal(hcs1WarmListState().lastBodyRowid, cursor);
    } finally {
      db.close();
    }

    resetHcs1WarmSkips();
    resetHcs1BodyTopics();
    const fresh = messagesDb();
    try {
      const add = fresh.prepare(
        "INSERT INTO messages (topic_id, seq, ts, payer, body) VALUES ('fresh', ?, 't', 'payer', ?)",
      );
      ["0.0.731", "0.0.732", "0.0.733", "0.0.731", "0.0.734"].forEach((id, seq) => {
        add.run(seq + 1, `hcs://1/${id}`);
      });
      const stmt = fresh.prepare(HCS1_BODY_TOPIC_SQL);
      const found = [...readHcs1BodyTopics({ all: (cursor) => stmt.all(cursor) })];
      assert.deepEqual(found, ["0.0.733", "0.0.731", "0.0.734"]);
      const cursor = hcs1WarmListState().lastBodyRowid;
      const next = [...readHcs1BodyTopics({ all: (bound) => stmt.all(bound) })];
      assert.deepEqual(next, found);
      assert.equal(hcs1WarmListState().lastBodyRowid, cursor);
    } finally {
      fresh.close();
    }
  } finally {
    setHcs1WarmListCap(HCS1_WARM_LIST_CAP);
    resetHcs1WarmSkips();
    resetHcs1BodyTopics();
    clearHcs1Cache();
  }
});

test("a body catch-up reads 20,000 rows and continues without rewinding", () => {
  resetHcs1BodyTopics();
  resetHcs1WarmSkips();
  setHcs1WarmListCap(HCS1_WARM_LIST_CAP);
  const db = messagesDb();
  try {
    const total = 20_003;
    const add = db.prepare(
      "INSERT INTO messages (topic_id, seq, ts, payer, body) VALUES ('catch', ?, 't', 'payer', ?)",
    );
    db.exec("BEGIN");
    for (let i = 0; i < total; i += 1) add.run(i, `hcs://1/0.0.${800000 + i}`);
    db.exec("COMMIT");
    const stmt = db.prepare(HCS1_BODY_TOPIC_SQL);
    const bounds = [];
    const query = {
      all(cursor) {
        bounds.push(cursor);
        return stmt.all(cursor);
      },
    };
    const first = [...readHcs1BodyTopics(query)];
    const page9 = db.prepare("SELECT rowid AS id FROM messages ORDER BY rowid LIMIT 1 OFFSET 17999").get();
    const cut = db.prepare("SELECT rowid AS id FROM messages ORDER BY rowid LIMIT 1 OFFSET 19999").get();
    assert.equal(bounds.length, 10);
    assert.equal(bounds[0], 0);
    assert.equal(bounds[9], page9.id);
    assert.equal(first.length, 20_000);
    assert.equal(first[0], "0.0.800000");
    assert.equal(first[19_999], "0.0.819999");
    assert.equal(hcs1WarmListState().lastBodyRowid, cut.id);
    const second = [...readHcs1BodyTopics(query)];
    const end = db.prepare("SELECT rowid AS id FROM messages ORDER BY rowid LIMIT 1 OFFSET 20002").get();
    assert.equal(bounds.length, 11);
    assert.equal(bounds[10], cut.id);
    assert.equal(hcs1WarmListState().lastBodyRowid, end.id);
    assert.equal(second.length, 20_000);
    assert.equal(second.includes("0.0.800000"), false);
    assert.equal(second.includes("0.0.800002"), false);
    assert.equal(second[0], "0.0.800003");
    assert.equal(second[19_999], "0.0.820002");
    const cursor = hcs1WarmListState().lastBodyRowid;
    const third = [...readHcs1BodyTopics(query)];
    assert.equal(bounds.length, 12);
    assert.equal(bounds[11], cursor);
    assert.equal(hcs1WarmListState().lastBodyRowid, cursor);
    assert.equal(third.length, 20_000);
    assert.equal(third[0], "0.0.800003");
  } finally {
    resetHcs1BodyTopics();
    resetHcs1WarmSkips();
    db.close();
  }
});
