// Background pre-warm for Hashinal (HCS-1) files the server already knows
// about. It never asks the mirror which topics exist. collect() returns
// topic ids (collectKnownHcs1Topics pulls them out of values already in
// memory or in the local cache). Each tick rebuilds at most perTick of
// the ones that are not already in memory, R2, in flight, or a recent
// miss, one at a time, as IP "warm" so a visitor's hourly rebuild budget
// is untouched. A topic confirmed in R2 stays in knownStored and is not
// headed again this process. A 404, 413, or 422 stays in permanentMiss
// until HCS1_WARM_MISS_MS (default 24 hours); 429, 502, and 503 do not.
// A full rebuild slot (HCS1_MAX_REBUILDS) ends the tick. The rebuild
// itself still applies the byte cap, the message cap, the miss cache,
// and the daily R2 budgets.
//
// HCS1_WARM_INTERVAL_MS defaults to 10 minutes. 0 disables the timer.
// HCS1_WARM_PER_TICK defaults to 20.
// HCS1_WARM_MISS_MS defaults to 24 hours.

import {
  HCS1_MAX_REBUILDS,
  getHcs1File,
  hcs1InFlight,
  hcs1MemoryHas,
  hcs1MissPending,
  hcs1ObjectInR2,
  hcs1RebuildsFull,
  isHcs1TopicId,
} from "./hcs1.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PER_TICK = 20;
const BODY_PAGE = 2000;

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const HCS1_WARM_INTERVAL_MS = envNumber("HCS1_WARM_INTERVAL_MS", TEN_MINUTES_MS);
export const HCS1_WARM_PER_TICK = envNumber("HCS1_WARM_PER_TICK", DEFAULT_PER_TICK);
export const HCS1_WARM_MISS_MS = envNumber("HCS1_WARM_MISS_MS", DAY_MS);

// Topic ids this process has confirmed in R2. Each one is headed at most once.
const knownStored = new Set();
// Topic id → earliest time a 404, 413, or 422 may be tried again.
const permanentMiss = new Map();
// Message-body scan. Ids already found stay; each read continues after the last rowid.
const knownBodyIds = new Set();
let lastBodyRowid = 0;

// The id has to end. A longer token that merely starts with 0.0.N is not one.
const ID_END = "(?![0-9A-Za-z])";
const HCS1_URLS = [
  new RegExp(`hcs://1/(0\\.0\\.\\d+)${ID_END}`, "gi"),
  new RegExp(`kiloscribe\\.com/api/inscription-cdn/(0\\.0\\.\\d+)${ID_END}`, "gi"),
  new RegExp(`/api/hcs1/(0\\.0\\.\\d+)${ID_END}`, "gi"),
];

function takeTopics(text, add) {
  if (typeof text !== "string" || !text || text.length > 1_000_000) return;
  for (const pattern of HCS1_URLS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) add(match[1]);
  }
}

// Unique HCS-1 topic ids already written into values the server holds:
// profile pictures, post images, covers, model links, marker images, and
// the early-hashinals list once that list is loaded. Strings are scanned
// for hcs://1/<id>, a Kiloscribe inscription-cdn/<id> URL, or this server's
// /api/hcs1/<id>. An NFT token id or an account id on its own is not a file
// topic and is left out. Nothing here is fetched.
export function collectKnownHcs1Topics(input) {
  const ids = [];
  const seen = new Set();
  const visiting = new WeakSet();
  const add = (id) => {
    if (!isHcs1TopicId(id) || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  const walk = (value, depth) => {
    if (value == null || depth > 12) return;
    if (typeof value === "string") {
      takeTopics(value, add);
      return;
    }
    if (typeof value !== "object") return;
    if (visiting.has(value)) return;
    visiting.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const key of Object.keys(value)) walk(value[key], depth + 1);
  };
  walk(input, 0);
  return ids;
}

// Rows of messages that can hold an HCS-1 URL, strictly after the bound rowid.
export const HCS1_BODY_TOPIC_SQL = `
  SELECT rowid, body AS v FROM messages
  WHERE rowid > ?
    AND (
      instr(body, 'hcs://1/') > 0
      OR instr(body, 'inscription-cdn/') > 0
      OR instr(body, '/api/hcs1/') > 0
    )
  ORDER BY rowid
  LIMIT ${BODY_PAGE}
`;

// One page of new message bodies. The returned set is every id collected so
// far, including ones from earlier pages. Tests call resetHcs1BodyTopics.
export function readHcs1BodyTopics(query) {
  const rows = query.all(lastBodyRowid);
  for (const row of rows) {
    const rowid = Number(row && row.rowid);
    if (rowid > lastBodyRowid) lastBodyRowid = rowid;
    takeTopics(row && row.v, (id) => knownBodyIds.add(id));
  }
  return knownBodyIds;
}

export function resetHcs1BodyTopics() {
  knownBodyIds.clear();
  lastBodyRowid = 0;
}

function topicIds(collected) {
  const ids = [];
  const seen = new Set();
  const list = Array.isArray(collected) ? collected : [];
  for (const item of list) {
    if (typeof item !== "string" || !isHcs1TopicId(item) || seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

function fileOptions(options) {
  return {
    mirrorFetch: options.mirrorFetch,
    s3: options.s3 || null,
    bucket: options.bucket || "",
    mirror: options.mirror,
    maxBytes: options.maxBytes,
    maxMessages: options.maxMessages,
    maxRebuilds: options.maxRebuilds,
    storeTypes: options.storeTypes,
    pageTimeoutMs: options.pageTimeoutMs,
    now: options.now,
    newRebuildMax: options.newRebuildMax,
    newRebuildWindowMs: options.newRebuildWindowMs,
    // Left unset, ip "warm" takes HCS1_R2_WARM_SHARE of the daily total
    // (default half) as its per-IP write budget. A caller can still pass one.
    r2DailyIpBytes: options.r2DailyIpBytes,
    r2DailyTotalBytes: options.r2DailyTotalBytes,
    r2DayMs: options.r2DayMs,
    ip: "warm",
  };
}

function positiveOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// One pass. Never throws. Logs one summary line.
export async function runHcs1WarmTick(options = {}) {
  const log = typeof options.log === "function" ? options.log : (line) => console.log(line);
  const perTick = positiveOr(options.perTick, HCS1_WARM_PER_TICK);
  const now = options.now || Date.now;
  const maxRebuilds = options.maxRebuilds;
  let warmed = 0;
  let skipped = 0;
  let failed = 0;
  try {
    const collected = typeof options.collect === "function" ? await options.collect() : options.topics;
    const topics = topicIds(collected);
    const opts = fileOptions(options);
    let started = 0;
    for (const topicId of topics) {
      if (started >= perTick) break;
      if (knownStored.has(topicId)) {
        skipped += 1;
        continue;
      }
      const retryAt = permanentMiss.get(topicId);
      if (retryAt != null && now() < retryAt) {
        skipped += 1;
        continue;
      }
      if (hcs1MemoryHas(topicId) || hcs1MissPending(topicId, now) || hcs1InFlight(topicId)) {
        skipped += 1;
        continue;
      }
      if (opts.s3 && opts.bucket) {
        const stored = await hcs1ObjectInR2(topicId, opts);
        if (stored) {
          knownStored.add(topicId);
          skipped += 1;
          continue;
        }
      }
      // A visitor is already using every rebuild slot. Leave the rest of
      // this list for the next tick. A 503 is not a miss.
      if (hcs1RebuildsFull(maxRebuilds == null ? HCS1_MAX_REBUILDS : maxRebuilds)) break;
      started += 1;
      let result;
      try {
        result = await getHcs1File(topicId, opts);
      } catch {
        failed += 1;
        continue;
      }
      if (result && result.status === 503) break;
      if (result && result.status === 429) break;
      if (result && result.ok && result.source === "mirror") {
        warmed += 1;
        // Built, but R2 would not keep it. Further files this tick would
        // be rebuilt and then dropped the same way.
        if (!result.r2Skipped) knownStored.add(topicId);
        if (result.r2Skipped) break;
      } else if (result && result.ok) {
        if (result.source === "r2") knownStored.add(topicId);
        skipped += 1;
      } else {
        failed += 1;
        const status = result && result.status;
        if (status === 404 || status === 413 || status === 422) {
          permanentMiss.set(topicId, now() + HCS1_WARM_MISS_MS);
        }
      }
    }
  } catch {
    // Discovery or a tick failure stays in this function.
  }
  try {
    log(`hcs1 warm: warmed ${warmed}, skipped ${skipped}, failed ${failed}`);
  } catch {
    // A log must not take the process down.
  }
  return { warmed, skipped, failed };
}

// After the server is listening. intervalMs 0 (or HCS1_WARM_INTERVAL_MS=0)
// does not schedule a tick. The timer is unref'd so it does not keep the
// process up on its own, and a tick that is still running is not started
// again.
export function startHcs1Warm(options = {}) {
  const intervalMs = Object.prototype.hasOwnProperty.call(options, "intervalMs")
    ? positiveOr(options.intervalMs, HCS1_WARM_INTERVAL_MS)
    : HCS1_WARM_INTERVAL_MS;
  const setIntervalImpl = options.setInterval || setInterval;
  const clearIntervalImpl = options.clearInterval || clearInterval;
  if (!(intervalMs > 0)) return { stop() {} };
  let running = false;
  const handle = setIntervalImpl(() => {
    if (running) return;
    running = true;
    runHcs1WarmTick(options).then(
      () => { running = false; },
      () => { running = false; },
    );
  }, intervalMs);
  if (handle && typeof handle.unref === "function") handle.unref();
  return {
    stop() {
      clearIntervalImpl(handle);
    },
  };
}
