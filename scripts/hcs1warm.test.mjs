// Hashinal warm-up. The mirror is mocked. Nothing here opens a socket.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { Readable } from "node:stream";

import {
  HCS1_NEW_REBUILD_PER_IP_HOUR,
  clearHcs1Cache,
  getHcs1File,
  hcs1MissPending,
} from "../server/hcs1.js";
import {
  HCS1_WARM_INTERVAL_MS,
  HCS1_WARM_PER_TICK,
  collectKnownHcs1Topics,
  runHcs1WarmTick,
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

test("warm stores past 50 MB under the shared total, and a visitor still stops at 50 MB", async () => {
  clearHcs1Cache();
  const each = 8 * 1024 * 1024;
  const warmIds = ["0.0.101", "0.0.102", "0.0.103", "0.0.104", "0.0.105", "0.0.106", "0.0.107"];
  const visitorIds = ["0.0.111", "0.0.112", "0.0.113", "0.0.114", "0.0.115", "0.0.116", "0.0.117"];
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
  assert.equal(summary.warmed, warmIds.length);
  assert.equal(summary.failed, 0);
  for (const id of warmIds) assert.equal(r2.objects.has(`hcs1/${id}`), true);

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
  assert.equal(visitorStored, 6);
  assert.equal(r2.objects.has("hcs1/0.0.117"), false);
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
