// Topic message backend — Phase 1
// A cache + fan-out layer in front of the Hedera mirror node.
//
//   app "tracks" a topic when a chat panel loads it
//   this server polls the mirror (ONE poller per active topic, whatever
//   how many users are viewing it) and stores messages in SQLite
//   the app reads from this API (fast, local) and falls back to the
//   mirror itself when this server is offline or hasn't backfilled yet
//
// The mirror node is the SOURCE OF TRUTH — this DB is a disposable cache:
// delete data.db any time and it re-backfills from the mirror.
// Floods are absorbed here (one server connection chews through them);
// user phones never paginate the mirror for history anymore.

import "dotenv/config";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { S3Client, PutObjectCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { appIcon, APP_ICONS } from "./appicon.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const MIRROR = "https://mainnet.mirrornode.hedera.com";
const POLL_MS = 3000;              // scheduler heartbeat; per-topic deadlines decide real polls
const BASE_INTERVAL_MS = 3000;     // adaptive: interval while a topic is active
const MAX_INTERVAL_MS = 60000;     // adaptive: cap for quiet topics (2x backoff)
const MAX_TRACKED = 100;           // most-recently-active topics the poller follows
const MAX_PAGES_PER_TICK = 20;     // per-topic page cap per poll (catch-up bursts)
const PER_TOPIC_CAP = 100000;      // rows kept per topic (flood guard)
const TRACK_TTL_MS = 5 * 60 * 1000; // polling stops when nobody viewed it for 5 min
const PENDING_TTL_MS = 10 * 60 * 1000; // unconfirmed pending sends expire after 10 min
let MIN_MIRROR_INTERVAL_MS = 100;  // global spacing: ~10 req/s to the mirror; doubles on 429
const LIVE_TTL_MS = 24 * 60 * 60 * 1000; // live markers drop 24h after their last upload
const GEO_GRID = 0.1;                     // deg — reverse-geocode cache cell (~11km)
const NOMINATIM = "https://nominatim.openstreetmap.org";
const GEO_UA = "hedera-map-app/1.0 (live-marker reverse-geocode)";
// The timezone the phones display timestamps in. Marker like-keys are
// timezone-formatted strings (existing app design), so the backend must
// format in the SAME zone or its counts won't match the chat view.
const APP_TZ = "Europe/Zagreb";
// The four profile-data topics. They feed the user_settings view, so the
// poller keeps them warm at all times (even if the app never opens them).
const PROFILE_TOPICS = {
  "0.0.9609904": "username",
  "0.0.9609881": "pic",
  "0.0.9752486": "click",
  "0.0.9759201": "bio",
};

// ── SQLite (one file, disposable cache) ────────────────────────────────
// DATA_DIR is the persistent disk on Railway. Mount a volume at /data and
// set DATA_DIR=/data. Locally the file stays next to this script.
const DATA_DIR = process.env.DATA_DIR || __dirname;
let db;
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "data.db"));
} catch (err) {
  console.error(`cannot open database at ${DATA_DIR}: ${err.message}`);
  if (err.code === "EACCES" || err.code === "EPERM") {
    console.error("The volume is not writable. Set RAILWAY_RUN_UID=0 on the Railway service and redeploy.");
  }
  process.exit(1);
}
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    topic_id TEXT NOT NULL,
    seq      INTEGER NOT NULL,
    ts       TEXT NOT NULL,
    payer    TEXT NOT NULL,
    body     TEXT NOT NULL,
    PRIMARY KEY (topic_id, seq)
  );
  CREATE TABLE IF NOT EXISTS topics (
    topic_id    TEXT PRIMARY KEY,
    last_seq    INTEGER NOT NULL DEFAULT 0,
    backfilled  INTEGER NOT NULL DEFAULT 0,
    last_active REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pending (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id     TEXT NOT NULL,
    body         TEXT NOT NULL,
    payer        TEXT NOT NULL,
    submitted_at REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS live_markers (
    topic     TEXT NOT NULL,
    cord      TEXT NOT NULL,
    geokey    TEXT NOT NULL,
    lng       REAL NOT NULL,
    lat       REAL NOT NULL,
    country   TEXT,
    title     TEXT,
    image     TEXT,
    msg       TEXT,
    payer     TEXT,
    last_seen REAL NOT NULL,
    PRIMARY KEY (topic, cord)
  );
  CREATE TABLE IF NOT EXISTS geo_cache (
    geokey  TEXT PRIMARY KEY,
    country TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    account_id  TEXT PRIMARY KEY,
    username    TEXT,
    profile_pic TEXT,
    click2url   TEXT,
    bio         TEXT,
    updated_at  REAL
  );
  -- Derived views for the live-marker popups (maintained in storePage,
  -- never scanned per request — all lookups hit the PKs below):
  -- which original message a live marker is (topic + cord + number)
  CREATE TABLE IF NOT EXISTS marker_index (
    topic_id TEXT NOT NULL,
    cord     TEXT NOT NULL,
    number   TEXT NOT NULL,
    created  TEXT NOT NULL,
    PRIMARY KEY (topic_id, cord, number)
  );
  -- per-payer latest reaction; target_key is the EXACT string the app
  -- stores in like/dislike messages (locale-formatted for markers,
  -- ISO for comments); counts = GROUP BY on the PK prefix
  CREATE TABLE IF NOT EXISTS reactions (
    topic_id   TEXT NOT NULL,
    target_key TEXT NOT NULL,
    payer      TEXT NOT NULL,
    kind       TEXT NOT NULL,
    PRIMARY KEY (topic_id, target_key, payer)
  );
  -- comments (parent_id NULL) and replies (parent_id = the ISO created
  -- of the comment/reply being answered); PK prefix finds a target's set
  CREATE TABLE IF NOT EXISTS comments (
    topic_id   TEXT NOT NULL,
    target_key TEXT NOT NULL,
    created    TEXT NOT NULL,
    payer      TEXT NOT NULL,
    text       TEXT NOT NULL,
    parent_id  TEXT,
    PRIMARY KEY (topic_id, target_key, created, payer)
  );
  -- small key/value flags (e.g. "derived views were backfilled once")
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
// Migrations: columns added after earlier deployments created the tables
// (CREATE TABLE IF NOT EXISTS won't add a column to an existing one).
for (const migration of [
  "ALTER TABLE topics ADD COLUMN memo TEXT",
  "ALTER TABLE live_markers ADD COLUMN number TEXT",
]) {
  try {
    db.exec(migration);
  } catch {
    /* column already there */
  }
}

const q = {
  getTopic: db.prepare("SELECT * FROM topics WHERE topic_id = ?"),
  upsertTopic: db.prepare(`
    INSERT INTO topics (topic_id, last_active) VALUES (?, ?)
    ON CONFLICT(topic_id) DO UPDATE SET last_active = excluded.last_active
  `),
  setLastSeq: db.prepare("UPDATE topics SET last_seq = ? WHERE topic_id = ?"),
  setBackfilled: db.prepare("UPDATE topics SET backfilled = 1 WHERE topic_id = ?"),
  setMemo: db.prepare("UPDATE topics SET memo = ? WHERE topic_id = ?"),
  listTopics: db.prepare("SELECT * FROM topics ORDER BY last_active DESC"),
  // newest first — for resolving the latest valid changeName
  topicMessagesDesc: db.prepare(
    "SELECT payer, body FROM messages WHERE topic_id = ? ORDER BY seq DESC"
  ),
  insertMsg: db.prepare(`
    INSERT OR IGNORE INTO messages (topic_id, seq, ts, payer, body)
    VALUES (?, ?, ?, ?, ?)
  `),
  countTopic: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE topic_id = ?"),
  dropOld: db.prepare(`
    DELETE FROM messages
    WHERE topic_id = ? AND seq < (
      SELECT seq FROM messages WHERE topic_id = ?
      ORDER BY seq DESC LIMIT 1 OFFSET ?
    )
  `),
  // history page: newest `limit` rows below before_seq (0 = no bound)
  latest: db.prepare(`
    SELECT * FROM messages
    WHERE topic_id = ? AND (? = 0 OR seq < ?)
    ORDER BY seq DESC LIMIT ?
  `),
  // live tail: rows newer than after_seq, oldest first
  newer: db.prepare(`
    SELECT * FROM messages
    WHERE topic_id = ? AND seq > ?
    ORDER BY seq ASC LIMIT ?
  `),
  // pending sends: instant fan-out until the mirror confirms them
  insertPending: db.prepare(`
    INSERT INTO pending (topic_id, body, payer, submitted_at)
    VALUES (?, ?, ?, ?)
  `),
  listPending: db.prepare("SELECT * FROM pending WHERE topic_id = ?"),
  getPending: db.prepare("SELECT * FROM pending WHERE id = ?"),
  delPending: db.prepare("DELETE FROM pending WHERE id = ?"),
  listStalePending: db.prepare("SELECT * FROM pending WHERE submitted_at < ?"),
  recentBodies: db.prepare(`
    SELECT payer, body FROM messages
    WHERE topic_id = ?
    ORDER BY seq DESC LIMIT ?
  `),
  // live markers (24h view) — one row per topic+cord; a re-upload of the
  // same marker refreshes last_seen (it stays live). COALESCE keeps a
  // country an earlier row already resolved.
  upsertLive: db.prepare(`
    INSERT INTO live_markers (topic, cord, geokey, lng, lat, country, title, image, msg, payer, number, last_seen)
    VALUES (@topic, @cord, @geokey, @lng, @lat, @country, @title, @image, @msg, @payer, @number, @last_seen)
    ON CONFLICT(topic, cord) DO UPDATE SET
      lng = excluded.lng,
      lat = excluded.lat,
      geokey = excluded.geokey,
      country = COALESCE(excluded.country, live_markers.country),
      title = excluded.title,
      image = excluded.image,
      msg = excluded.msg,
      payer = excluded.payer,
      number = COALESCE(excluded.number, live_markers.number),
      -- app reports and backend discovery both upsert the same row; the
      -- timer only moves forward (a re-upload has a newer ts anyway)
      last_seen = MAX(excluded.last_seen, live_markers.last_seen)
  `),
  listLiveByCountry: db.prepare(`
    SELECT * FROM live_markers
    WHERE LOWER(country) = LOWER(?) AND last_seen > ?
    ORDER BY last_seen DESC
  `),
  deleteStaleLive: db.prepare("DELETE FROM live_markers WHERE last_seen < ?"),
  liveByGeokey: db.prepare("UPDATE live_markers SET country = ? WHERE geokey = ?"),
  getGeoCache: db.prepare("SELECT country FROM geo_cache WHERE geokey = ?"),
  setGeoCache: db.prepare(`
    INSERT INTO geo_cache (geokey, country) VALUES (?, ?)
    ON CONFLICT(geokey) DO UPDATE SET country = excluded.country
  `),
  // per-account settings — one row per user, latest valid value per field.
  // Each statement upserts ONLY its own column, so the other settings a
  // user has are left untouched.
  settingUsername: db.prepare(`
    INSERT INTO user_settings (account_id, username, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at
  `),
  settingPic: db.prepare(`
    INSERT INTO user_settings (account_id, profile_pic, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET profile_pic = excluded.profile_pic, updated_at = excluded.updated_at
  `),
  settingClick: db.prepare(`
    INSERT INTO user_settings (account_id, click2url, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET click2url = excluded.click2url, updated_at = excluded.updated_at
  `),
  settingBio: db.prepare(`
    INSERT INTO user_settings (account_id, bio, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET bio = excluded.bio, updated_at = excluded.updated_at
  `),
  listUserSettings: db.prepare("SELECT * FROM user_settings ORDER BY updated_at DESC"),
  // live-marker derived views — PK-prefix lookups only.
  // marker_index upserts: a re-upload of the same cord+number must win,
  // because the app renders the NEWEST message per number.
  insertMarkerIndex: db.prepare(`
    INSERT INTO marker_index (topic_id, cord, number, created) VALUES (?, ?, ?, ?)
    ON CONFLICT(topic_id, cord, number) DO UPDATE SET created = excluded.created
  `),
  getMarkerIndex: db.prepare(
    "SELECT created FROM marker_index WHERE topic_id = ? AND cord = ? AND number = ?"
  ),
  // fallback when the live row predates number tracking: any number at
  // this cord, most recent upload wins
  latestMarkerIndexByCord: db.prepare(
    "SELECT number, created FROM marker_index WHERE topic_id = ? AND cord = ? ORDER BY created DESC LIMIT 1"
  ),
  countMarkerIndex: db.prepare(
    "SELECT COUNT(*) AS n FROM marker_index WHERE topic_id = ?"
  ),
  upsertReaction: db.prepare(`
    INSERT INTO reactions (topic_id, target_key, payer, kind) VALUES (?, ?, ?, ?)
    ON CONFLICT(topic_id, target_key, payer) DO UPDATE SET kind = excluded.kind
  `),
  insertComment: db.prepare(`
    INSERT OR IGNORE INTO comments (topic_id, target_key, created, payer, text, parent_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listComments: db.prepare(
    "SELECT created, payer, text, parent_id FROM comments WHERE topic_id = ? AND target_key = ? ORDER BY created ASC"
  ),
};

// Exactly the shape the app's getMessages() produces
function toAppMessage(row) {
  let body;
  try {
    body = JSON.parse(row.body);
  } catch {
    body = row.body;
  }
  const base = body && typeof body === "object" ? body : {};
  return {
    ...base,
    payer: row.payer,
    created: new Date(Number(row.ts) * 1000).toISOString(),
    consensus_timestamp: row.ts,
    sequence_number: row.seq,
  };
}

// ── Mirror access: globally spaced, backs off on 429 ───────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastMirrorAt = 0;
async function mirrorFetch(url) {
  const wait = lastMirrorAt + MIN_MIRROR_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastMirrorAt = Date.now();
  const res = await fetch(url);
  if (res.status === 429) {
    const e = new Error("mirror 429");
    e.rateLimited = true;
    throw e;
  }
  if (!res.ok) throw new Error("mirror HTTP " + res.status);
  return res.json();
}

function enforceCap(topicId) {
  const { n } = q.countTopic.get(topicId);
  if (n > PER_TOPIC_CAP) q.dropOld.run(topicId, topicId, PER_TOPIC_CAP);
}

// A pending row in the exact shape /api/messages serves (provisional
// negative seq, pending flag) — used for both the API and the stream.
const pendingToAppMessage = (p) => {
  let body;
  try {
    body = JSON.parse(p.body);
  } catch {
    body = p.body;
  }
  const base = body && typeof body === "object" ? body : {};
  return {
    ...base,
    payer: p.payer,
    created: new Date(p.submitted_at).toISOString(),
    consensus_timestamp: 0,
    sequence_number: -p.id,
    pending: true,
    _pendingId: p.id,
  };
};

// Profile-data topics are mixed (e.g. the bio topic also carries topic2pic),
// so extract ONLY the relevant field per account. storePage feeds rows
// oldest→newest, so the last valid value for each field wins.
function extractUserSettings(topicId, payer, body, tsMs) {
  if (!(topicId in PROFILE_TOPICS)) return;
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return;
  }
  const d = data && typeof data === "object" && data.data ? data.data : {};
  const kind = PROFILE_TOPICS[topicId];
  if (kind === "username") {
    if (d.username && d.username.length < 20) q.settingUsername.run(payer, d.username, tsMs);
  } else if (kind === "pic") {
    if (d.urls && d.urls.length > 0) q.settingPic.run(payer, d.urls[0], tsMs);
  } else if (kind === "click") {
    if (d.click2url && d.click2url.length > 0) q.settingClick.run(payer, d.click2url[0], tsMs);
  } else if (kind === "bio") {
    // Profiles submit topic_bio as a one-item list. Older messages used a string.
    const bio = Array.isArray(d.topic_bio) ? d.topic_bio[0] : d.topic_bio;
    if (typeof bio === "string" && bio.length > 0 && bio.length < 256) q.settingBio.run(payer, bio, tsMs);
  }
}

// One-time startup: if user_settings is empty but the profile topics already
// have cached messages (stored before this feature existed), rebuild the view
// from the local cache — no mirror requests needed.
function backfillUserSettings() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM user_settings").get();
  if (n > 0) return; // already populated
  for (const topicId of Object.keys(PROFILE_TOPICS)) {
    const rows = db
      .prepare("SELECT payer, body, ts FROM messages WHERE topic_id = ? ORDER BY seq ASC")
      .all(topicId);
    for (const r of rows) {
      extractUserSettings(topicId, r.payer, r.body, Number(r.ts) * 1000);
    }
  }
}
backfillUserSettings();

// ── Live-marker derived views (marker_index / reactions / comments) ─────
// The app keys marker likes by a timezone-formatted timestamp string and
// comment likes by the comment's ISO created — the backend reproduces the
// EXACT same expressions (same locale options, APP_TZ) so its counts match
// what the chat view computes on the phone.
function formatMarkerKey(createdISO) {
  return new Date(createdISO).toLocaleString("en-US", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: APP_TZ,
  });
}

// Same per-message work as extractUserSettings, but for the marker view:
// index marker messages, keep per-payer latest reactions, store comments
// and replies. storePage feeds rows oldest→newest.
function extractTopicIndex(topicId, payer, body, tsMs) {
  let d;
  try {
    d = JSON.parse(body);
  } catch {
    return;
  }
  if (!d || typeof d !== "object") return;
  const created = new Date(tsMs).toISOString();

  const m = d.marker && d.marker.data;
  if (m && typeof m.cord === "string" && Number.isInteger(Number(m.numberOfMarker))) {
    q.insertMarkerIndex.run(topicId, m.cord, String(m.numberOfMarker), created);
    // Self-heal the 24h view: ANY marker message the backend sees becomes
    // live (last_seen = upload time, MAX keeps it from regressing). The app's
    // upload report stays a fast path, but a lost report can no longer hide
    // a marker from its country. Only the last 24h matter — older markers
    // would be stale garbage and would burn reverse-geocodes.
    if (tsMs > Date.now() - LIVE_TTL_MS) {
      const parts = m.cord.split(",").map((s) => Number(s.trim()));
      if (parts.length === 2 && parts.every((n) => isFinite(n))) {
      const [lng, lat] = parts;
      const geokey = geoKeyFor(lng, lat);
      const cached = (q.getGeoCache.get(geokey) || {}).country || null;
      q.upsertLive.run({
        topic: topicId,
        cord: m.cord,
        geokey,
        lng,
        lat,
        country: cached,
        title: m.title || null,
        image: (m.image && m.image[0]) || null,
        msg: m.msg || null,
        payer,
        number: String(m.numberOfMarker),
        last_seen: tsMs,
      });
        if (!cached) geoQueue.add(geokey);
      }
    }
  }
  if (d.likeMarker && d.likeMarker.timestamp && payer) {
    q.upsertReaction.run(topicId, String(d.likeMarker.timestamp), payer, "like");
  } else if (d.dislikeMarker && d.dislikeMarker.timestamp && payer) {
    q.upsertReaction.run(topicId, String(d.dislikeMarker.timestamp), payer, "dislike");
  }
  if (d.commentMarker && d.commentMarker.timestamp && payer) {
    q.insertComment.run(
      topicId, String(d.commentMarker.timestamp), created, payer,
      String(d.commentMarker.text || "").slice(0, 300), null
    );
  }
  if (d.replyMarker && d.replyMarker.parentId && payer) {
    q.insertComment.run(
      topicId, String(d.replyMarker.parentId), created, payer,
      String(d.replyMarker.text || "").slice(0, 300), String(d.replyMarker.parentId)
    );
  }
}

// One-time startup: rebuild the derived views from cached messages stored
// before this feature existed (same pattern as backfillUserSettings). A meta
// flag marks completion — clearing the flag (or data.db) re-runs it.
function backfillDerived() {
  const flag = db.prepare("SELECT value FROM meta WHERE key = 'derived_backfilled'").get();
  if (flag) return;
  for (const t of q.listTopics.all()) {
    const rows = db
      .prepare("SELECT payer, body, ts FROM messages WHERE topic_id = ? ORDER BY seq ASC")
      .all(t.topic_id);
    for (const r of rows) {
      extractTopicIndex(t.topic_id, r.payer, r.body, Number(r.ts) * 1000);
    }
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('derived_backfilled', '1')")
    .run();
}
// Note: called below, after the geo section (it queues reverse-geocodes).

// Full reaction picture for one marker: its like/dislike counts plus the
// comment tree (with per-comment counts and nested replies). Every lookup
// is a PK-prefix query; the one IN-list query covers all comment keys.
function markerReactions(topicId, createdISO) {
  const markerKey = formatMarkerKey(createdISO);
  const rows = q.listComments.all(topicId, markerKey);
  const nodes = [];
  const build = (parentKey, depth) => {
    if (depth > 50) return [];
    return q.listComments.all(topicId, parentKey)
      .filter((c) => c.parent_id === parentKey)
      .map((c) => {
        nodes.push(c);
        return { ...c, replies: build(c.created, depth + 1) };
      });
  };
  const tree = rows
    .filter((c) => c.parent_id === null)
    .map((c) => {
      nodes.push(c);
      return { ...c, replies: build(c.created, 1) };
    });
  const counts = new Map();
  const keys = [...new Set([markerKey, ...nodes.map((c) => c.created)])];
  // better-sqlite3 has no IN-list expansion: build one ? per key (the
  // statement cache absorbs the few distinct list sizes)
  if (keys.length > 0) {
    const ph = keys.map(() => "?").join(",");
    for (const row of db
      .prepare(
        `SELECT target_key, kind, COUNT(*) AS n
         FROM reactions
         WHERE topic_id = ? AND target_key IN (${ph})
         GROUP BY target_key, kind`
      )
      .all(topicId, ...keys)) {
      counts.set(row.target_key + "|" + row.kind, row.n);
    }
  }
  const decorate = (n) => {
    n.likeCount = counts.get(n.created + "|like") || 0;
    n.dislikeCount = counts.get(n.created + "|dislike") || 0;
    for (const r of n.replies) decorate(r);
  };
  for (const n of tree) decorate(n);
  return {
    likeCount: counts.get(markerKey + "|like") || 0,
    dislikeCount: counts.get(markerKey + "|dislike") || 0,
    comments: tree,
  };
}

// Store one page of mirror messages; returns the stored rows so pending
// sends can be confirmed against them. Every stored row is also pushed to
// the topic's live stream subscribers. Profile-topic rows also update the
// per-account user_settings view.
const storePage = (topicId, msgs) => {
  const stored = [];
  const transaction = (fn) => (...args) => {
    db.exec("BEGIN");
    try {
      const result = fn(...args);
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };
  transaction((rows) => {
    for (const m of rows) {
      let body;
      try {
        body = JSON.stringify(JSON.parse(Buffer.from(m.message, "base64").toString("utf-8")));
      } catch {
        continue; // non-JSON message — the app's getMessages skips these too
      }
      q.insertMsg.run(topicId, m.sequence_number, m.consensus_timestamp, m.payer_account_id, body);
      try {
        extractUserSettings(topicId, m.payer_account_id, body, Number(m.consensus_timestamp) * 1000);
      } catch (err) {
        console.error("user settings skipped", topicId, m.sequence_number, err.message);
      }
      extractTopicIndex(topicId, m.payer_account_id, body, Number(m.consensus_timestamp) * 1000);
      stored.push({ payer: m.payer_account_id, body, seq: m.sequence_number, ts: m.consensus_timestamp });
    }
  })(msgs);
  for (const r of stored) {
    let parsed;
    try {
      parsed = JSON.parse(r.body);
    } catch {
      parsed = {};
    }
    broadcast(topicId, {
      type: "message",
      message: {
        ...(parsed && typeof parsed === "object" ? parsed : {}),
        payer: r.payer,
        created: new Date(Number(r.ts) * 1000).toISOString(),
        consensus_timestamp: r.ts,
        sequence_number: r.seq,
      },
    });
  }
  return stored;
};

// The mirror now shows a message this app previously submitted (same topic,
// payer and body) → it's confirmed: drop the pending row and tell the
// live stream. Also covers a submit that landed AFTER the mirror row was
// already polled in.
function tryConfirmPending(topicId) {
  const pend = q.listPending.all(topicId);
  if (!pend.length) return;
  const seen = new Set(
    q.recentBodies.all(topicId, 1000).map((r) => r.payer + "|" + r.body)
  );
  for (const p of pend) {
    if (seen.has(p.payer + "|" + p.body)) {
      q.delPending.run(p.id);
      broadcast(topicId, { type: "confirmed", message: pendingToAppMessage(p) });
    }
  }
}

// One poll for a topic: drain every NEW page (seq > last_seq) up to the cap.
// Quiet topic = 1 request. Flood/catch-up = a burst of pages, spread by the
// global mirror spacing; if the cap is hit mid-drain the next poll continues.
// Returns the number of new rows (drives the adaptive interval).
async function pollTopic(topicId) {
  const t = q.getTopic.get(topicId);
  if (!t) return 0;
  const startedAtHead = t.last_seq === 0; // this is a (first) backfill
  let url = t.last_seq > 0
    ? `${MIRROR}/api/v1/topics/${topicId}/messages?limit=100&order=asc&sequencenumber=gt:${t.last_seq}`
    : `${MIRROR}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
  let pages = 0;
  let newRows = 0;
  while (url && pages < MAX_PAGES_PER_TICK) {
    let data;
    try {
      data = await mirrorFetch(url);
    } catch (err) {
      if (err.rateLimited) MIN_MIRROR_INTERVAL_MS = Math.min(1000, MIN_MIRROR_INTERVAL_MS * 2);
      return newRows; // stop this tick; resume next tick from the same last_seq
    }
    MIN_MIRROR_INTERVAL_MS = 100; // a success resets the backoff
    const msgs = data.messages || [];
    if (msgs.length === 0) {
      if (startedAtHead) q.setBackfilled.run(topicId); // empty topic
      return newRows;
    }
    newRows += storePage(topicId, msgs).length;
    tryConfirmPending(topicId);
    q.setLastSeq.run(Math.max(...msgs.map((m) => m.sequence_number)), topicId);
    pages++;
    if (msgs.length < 100) {
      if (startedAtHead) q.setBackfilled.run(topicId); // reached the head of history
      enforceCap(topicId);
      return newRows;
    }
    url = data.links && data.links.next ? `${MIRROR}${data.links.next}` : null;
  }
  enforceCap(topicId);
  return newRows;
}

// Unconfirmed pending sends expire after PENDING_TTL_MS (the transaction
// was dropped or never landed on the mirror) — the stream is told too, so
// viewers drop the ⏳ bubble.
setInterval(() => {
  const stale = q.listStalePending.all(Date.now() - PENDING_TTL_MS);
  for (const p of stale) {
    q.delPending.run(p.id);
    broadcast(p.topic_id, { type: "expired", message: pendingToAppMessage(p) });
  }
}, 60 * 1000);

// Live markers drop 24h after their last upload (the topic history keeps
// them — this only clears the 24h search view).
setInterval(() => {
  q.deleteStaleLive.run(Date.now() - LIVE_TTL_MS);
}, 10 * 60 * 1000);

// ── Poller loop ─────────────────────────────────────────────────────────
// Mirror load = active topics × 1 req/3s, independent of user count.
// Adaptive (scale ladder rung 1): every EMPTY poll doubles a topic's
// interval up to 60s, any NEW row resets it to 3s — quiet topics cost one
// mirror request per minute instead of twenty. Backfill keeps the 3s pace.
// TTL: a topic nobody has viewed for 5 min stops being polled (its rows
// remain — the API still serves the cache until it's re-tracked).
let ticking = false;
const topicState = new Map(); // topic_id -> { interval, nextCheckAt }
setInterval(async () => {
  if (ticking) return; // previous tick still draining a catch-up — skip
  ticking = true;
  try {
    const now = Date.now();
    // Profile-data topics always stay warm (they feed user_settings), so
    // refresh their last_active every tick to keep them out of TTL eviction.
    for (const id of Object.keys(PROFILE_TOPICS)) q.upsertTopic.run(id, now);
    const active = q.listTopics
      .all()
      .filter((t) => now - t.last_active <= TRACK_TTL_MS)
      .slice(0, MAX_TRACKED); // LRU eviction beyond the cap
    const activeIds = new Set(active.map((t) => t.topic_id));
    for (const id of [...topicState.keys()]) {
      if (!activeIds.has(id)) topicState.delete(id);
    }
    for (const t of active) {
      const st = topicState.get(t.topic_id) ||
        { interval: BASE_INTERVAL_MS, nextCheckAt: 0 };
      topicState.set(t.topic_id, st);
      if (Date.now() < st.nextCheckAt) continue; // not due yet
      const newRows = await pollTopic(t.topic_id);
      st.interval = newRows > 0
        ? BASE_INTERVAL_MS
        : Math.min(st.interval * 2, MAX_INTERVAL_MS);
      st.nextCheckAt = Date.now() + st.interval;
    }
  } finally {
    ticking = false;
  }
}, POLL_MS);

// ── Live markers: country via Nominatim reverse-geocode ────────────────
// Markers are reported by the app with lng/lat only. Each is rounded to a
// GEO_GRID cell; the resolved country is cached by that cell, so many
// markers in one neighbourhood cost a single reverse-geocode. The queue is
// paced to Nominatim's ~1 request/second policy.
const geoQueue = new Set(); // geokeys awaiting a reverse-geocode
let geoBusy = false;

function geoKeyFor(lng, lat) {
  return Math.round(lng / GEO_GRID) + ":" + Math.round(lat / GEO_GRID);
}

async function resolveCountry(lng, lat) {
  try {
    // accept-language=en: country names in English so they match the
    // app's search results (also forced to English) regardless of locale.
    const res = await fetch(
      `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=en`,
      { headers: { "User-Agent": GEO_UA, Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data && data.address && data.address.country) || null;
  } catch {
    return null;
  }
}

async function geoWorker() {
  if (geoBusy) return;
  geoBusy = true;
  while (geoQueue.size > 0) {
    const geokey = geoQueue.values().next().value;
    geoQueue.delete(geokey);
    const [glng, glat] = geokey.split(":").map(Number); // cell corner
    let country = (q.getGeoCache.get(geokey) || {}).country || null;
    if (!country) {
      country = await resolveCountry(glng * GEO_GRID, glat * GEO_GRID);
      await sleep(1000); // Nominatim policy: ~1 request/second
    }
    if (country) {
      q.setGeoCache.run(geokey, country);
      q.liveByGeokey.run(country, geokey);
    }
    // no country (ocean / API hiccup) → row stays unresolved; a later
    // report for the same cell re-queues it and retries
  }
  geoBusy = false;
}

// One-time derived-view backfill (needs the geo section above, since
// marker discovery queues reverse-geocodes).
backfillDerived();

// Discovered markers (storePage) queue geokeys without a /api/marker kick —
// a periodic sweep keeps the queue draining.
setInterval(() => {
  if (geoQueue.size > 0) geoWorker();
}, 5000);

// ── API ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── R2 media storage ────────────────────────────────────────────────────
// Marker images/videos live on Cloudflare R2 (S3 API). The phone's bytes
// stream straight into the bucket — nothing touches this disk. The
// credentials come from server/.env (gitignored); nothing is ever logged.
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const r2 =
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  R2_BUCKET
    ? new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
        // The new SDK defaults to WHEN_SUPPORTED, which would CRC32-hash the
        // body — impossible for a flowing stream ("Unable to calculate hash
        // for flowing readable stream"). PutObject needs no checksum.
        requestChecksumCalculation: "WHEN_REQUIRED",
      })
    : null;

// The app reads covers cross-origin into canvases (gif decode, video →
// canvas blit for the animated polygon covers) — without CORS the canvas
// taints and every read throws. CORS is a BUCKET-level setting in S3/R2
// (a CORS field on PutObject is silently ignored), so apply it on every
// start — idempotent.
if (r2) {
  r2
    .send(
      new PutBucketCorsCommand({
        Bucket: R2_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ["*"],
              AllowedMethods: ["GET"],
              AllowedHeaders: ["*"],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      })
    )
    .then(() => console.log("R2 bucket CORS ensured"))
    .catch((err) => console.error("R2 CORS setup failed:", err.message));
}

const R2_MIME_EXT = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const R2_MAX_VIDEO = 100 * 1024 * 1024;
const R2_MAX_IMAGE = 20 * 1024 * 1024;

// The phone's file goes straight into R2 (buffered in memory while in
// flight — capped below, nothing on disk); the response's url is the public
// r2.pub link the marker's Image URL field stores. A Buffer body sidesteps
// the SDK's stream-signing limits (flowing streams can't be hashed / need
// Content-Length, and R2 resets the connection either way).
app.post("/api/upload", (req, res) => {
  if (!r2) return res.status(503).json({ ok: false, error: "R2 not configured — set R2_* in server/.env" });
  const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const ext = R2_MIME_EXT[type];
  if (!ext) return res.status(415).json({ ok: false, error: "Unsupported type — images and videos only" });
  const isVideo = type.startsWith("video/");
  const max = isVideo ? R2_MAX_VIDEO : R2_MAX_IMAGE;
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > max) {
    req.resume();
    return res.status(413).json({ ok: false, error: `Too big — ${isVideo ? "100 MB video" : "20 MB image"} max` });
  }
  const chunks = [];
  let received = 0;
  let over = false;
  req.on("data", (chunk) => {
    if (over) return;
    received += chunk.length;
    if (received > max) {
      // Crossed the cap mid-upload — send the 413, then drop the client.
      over = true;
      res.status(413).json({ ok: false, error: `Too big — ${isVideo ? "100 MB video" : "20 MB image"} max` });
      res.on("finish", () => req.destroy());
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (over) return;
    const key = `markers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    r2
      .send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: Buffer.concat(chunks),
          ContentType: type,
          // CORS comes from the bucket-level rule set at startup above —
          // per-object CORS on PutObject does not exist in S3/R2.
        })
      )
      .then(() => {
        res.json({ ok: true, url: `${R2_PUBLIC_BASE}/${key}`, type });
      })
      .catch((err) => {
        console.error("R2 upload failed:", err.message);
        res.status(502).json({ ok: false, error: "R2 upload failed" });
      });
  });
  req.on("error", () => {
    if (!res.headersSent && !over) res.status(400).json({ ok: false, error: "upload aborted" });
  });
});

const isTopicId = (s) => typeof s === "string" && /^\d+\.\d+\.\d+$/.test(s);

// app: "people are viewing this topic now" (chat panel Load)
app.post("/api/track", (req, res) => {
  const topic = req.body && req.body.topic;
  if (!isTopicId(topic)) return res.status(400).json({ ok: false, error: "bad topic" });
  q.upsertTopic.run(topic, Date.now());
  res.json({ ok: true });
});

// app: "I just sent this message" (after the wallet confirms) → stored as
// PENDING so every viewer sees it instantly; the poller — or a mirror row
// that was already stored — confirms it. Unconfirmed rows expire in 10 min.
app.post("/api/submit", (req, res) => {
  const { topic, body, payer } = req.body || {};
  if (!isTopicId(topic) || typeof body !== "string" || !body || !isTopicId(payer)) {
    return res.status(400).json({ ok: false, error: "bad submit" });
  }
  let norm = body;
  try {
    norm = JSON.stringify(JSON.parse(body)); // same normalization as the mirror path
  } catch {
    /* not JSON — keep raw */
  }
  const info = q.insertPending.run(topic, norm, payer, Date.now());
  q.upsertTopic.run(topic, Date.now()); // sending = activity
  broadcast(topic, { type: "pending", message: pendingToAppMessage(q.getPending.get(info.lastInsertRowid)) });
  tryConfirmPending(topic); // the mirror row may already be stored
  res.json({ ok: true });
});

// Topic memo (the "0.0.x" entries are the topic admins) — one mirror
// request per topic, cached in topics.memo. null = never fetched (retry
// later); "" = fetched, genuinely empty.
const memoFetching = new Set();
async function fetchTopicMemo(topicId) {
  const t = q.getTopic.get(topicId);
  if (!t || t.memo !== null || memoFetching.has(topicId)) return;
  memoFetching.add(topicId);
  try {
    const data = await mirrorFetch(`${MIRROR}/api/v1/topics/${topicId}`);
    q.setMemo.run(typeof data.memo === "string" ? data.memo : "", topicId);
  } catch {
    /* keep memo null — the next call retries */
  } finally {
    memoFetching.delete(topicId);
  }
}

// Same rule the app uses for its regular popups: the newest changeName
// message whose payer is a topic admin (or anyone, if the memo lists none).
function getTopicName(topicId) {
  const t = q.getTopic.get(topicId);
  if (!t) return "";
  const admins = String(t.memo || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("0.0."));
  for (const r of q.topicMessagesDesc.all(topicId)) {
    let body;
    try {
      body = JSON.parse(r.body);
    } catch {
      continue;
    }
    if (
      body &&
      body.changeName &&
      (admins.length === 0 || admins.includes(r.payer))
    ) {
      return body.changeName;
    }
  }
  return "";
}

// app: "a marker was just uploaded" → kept LIVE for 24h (re-upload of the
// same topic+cord refreshes it), tagged with its country for the
// search → local view. Topic history is untouched (separate table).
app.post("/api/marker", (req, res) => {
  const { topic, cord, title, image, msg, payer, number } = req.body || {};
  if (!isTopicId(topic) || typeof cord !== "string") {
    return res.status(400).json({ ok: false, error: "bad marker" });
  }
  const parts = cord.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 2 || parts.some((n) => !isFinite(n))) {
    return res.status(400).json({ ok: false, error: "bad cord" });
  }
  const [lng, lat] = parts;
  const geokey = geoKeyFor(lng, lat);
  const cached = (q.getGeoCache.get(geokey) || {}).country || null;
  q.upsertLive.run({
    topic, cord, geokey, lng, lat,
    country: cached,
    title: title || null,
    image: image || null,
    msg: msg || null,
    payer: payer || null,
    number: Number.isInteger(Number(number)) ? String(number) : null,
    last_seen: Date.now(),
  });
  // Track the topic so its messages (and the changeName inside them) are
  // cached — the /api/local view can then attach the topic name.
  q.upsertTopic.run(topic, Date.now());
  fetchTopicMemo(topic);
  if (!cached) geoQueue.add(geokey);
  geoWorker();
  res.json({ ok: true });
});

// app: "show live markers in this country" (geographic search). Only the
// 24h view — a marker here is still in its topic history regardless.
app.get("/api/local", (req, res) => {
  const country = String(req.query.country || "").trim();
  if (!country) return res.json({ ok: true, markers: [] });
  const rows = q.listLiveByCountry.all(country, Date.now() - LIVE_TTL_MS);
  // Resolve each distinct topic's name (empty while the topic is still
  // backfilling) and keep the topic warm so the poller finishes the job.
  const names = new Map();
  for (const r of rows) {
    q.upsertTopic.run(r.topic, Date.now());
    if (!names.has(r.topic)) {
      names.set(r.topic, getTopicName(r.topic));
      fetchTopicMemo(r.topic);
    }
  }
  res.json({
    ok: true,
    markers: rows.map((r) => {
      // The original message: exact (topic, cord, number) first, then the
      // most recent upload at that cord (rows predating number tracking).
      // Empty while the topic is still backfilling.
      const idx =
        (r.number ? q.getMarkerIndex.get(r.topic, r.cord, r.number) : null) ||
        q.latestMarkerIndexByCord.get(r.topic, r.cord) ||
        null;
      const reactions = idx ? markerReactions(r.topic, idx.created) : null;
      return {
        lng: r.lng,
        lat: r.lat,
        title: r.title || "",
        image: r.image || "",
        msg: r.msg || "",
        topic: r.topic,
        payer: r.payer || "",
        lastSeen: r.last_seen,
        topicName: names.get(r.topic) || "",
        number: r.number || (idx && idx.number) || "",
        created: idx ? idx.created : "",
        likeCount: reactions ? reactions.likeCount : 0,
        dislikeCount: reactions ? reactions.dislikeCount : 0,
        comments: reactions ? reactions.comments : [],
      };
    }),
  });
});

// app: "give me the current per-account settings" — one row per user
// (latest valid username / profile pic / click2url / bio). `ready` is true
// only once all four profile topics are backfilled, so the app never trusts
// a half-built table.
app.get("/api/user-settings", (req, res) => {
  const ready = Object.keys(PROFILE_TOPICS).every((id) => {
    const t = q.getTopic.get(id);
    return t && t.backfilled === 1;
  });
  const rows = q.listUserSettings.all();
  res.json({
    ready,
    settings: rows.map((r) => ({
      accountId: r.account_id,
      username: r.username || "",
      profilePic: r.profile_pic || "",
      click2url: r.click2url || "",
      bio: r.bio || "",
      updatedAt: r.updated_at || 0,
    })),
  });
});

// app: history (latest N below before_seq) or live tail (rows after after_seq)
app.get("/api/messages", (req, res) => {
  const topic = req.query.topic;
  if (!isTopicId(topic)) return res.json({ ready: false, messages: [] });
  const limit = Math.min(50000, Math.max(1, Number(req.query.limit) || 100));
  const before = Math.max(0, Number(req.query.before_seq) || 0);
  const after = Math.max(0, Number(req.query.after_seq) || 0);
  const row = q.getTopic.get(topic);
  const ready = !!(row && row.backfilled === 1);
  if (row) q.upsertTopic.run(topic, Date.now()); // a view = activity (keeps the poller warm)
  const rows = after > 0
    ? q.newer.all(topic, after, limit)
    : q.latest.all(topic, before, before, limit).reverse();

  // Pending sends: appended after the confirmed history (instant fan-out).
  // sequence_number is provisional (-row id): unique, and it can never
  // collide with a real mirror seq.
  const pend = q.listPending
    .all(topic)
    .filter((p) => Date.now() - p.submitted_at < PENDING_TTL_MS);

  res.json({ ready, messages: [...rows.map(toAppMessage), ...pend.map(pendingToAppMessage)] });
});

// ── Live stream (SSE) ──────────────────────────────────────────────────
// One connection per app (GET /api/stream?topics=a,b,c): the server pushes
// an event the moment anything happens on a subscribed topic — a new mirror
// row ("message"), a send reported as pending ("pending"), a confirmation
// ("confirmed"), or a pending expiry ("expired"). Clients never poll;
// EventSource reconnects by itself after a drop.
const subscribers = new Map(); // topic_id -> Set<ServerResponse>
const resTopics = new Map();    // ServerResponse -> Set<topic_id>

function sseWrite(res, payload) {
  try {
    res.write(payload);
  } catch {
    /* client went away */
  }
}

function broadcast(topicId, event) {
  const set = subscribers.get(topicId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify({ topic: topicId, ...event })}\n\n`;
  for (const res of set) sseWrite(res, payload);
}

app.get("/api/stream", (req, res) => {
  const topics = String(req.query.topics || "")
    .split(",")
    .map((t) => t.trim())
    .filter(isTopicId);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // reverse proxies must not buffer the stream
  });
  res.write("retry: 2000\n\n"); // client reconnect delay (ms)
  const myTopics = new Set(topics);
  resTopics.set(res, myTopics);
  for (const t of myTopics) {
    if (!subscribers.has(t)) subscribers.set(t, new Set());
    subscribers.get(t).add(res);
  }
  req.on("close", () => {
    resTopics.delete(res);
    for (const t of myTopics) {
      const set = subscribers.get(t);
      if (set) {
        set.delete(res);
        if (set.size === 0) subscribers.delete(t);
      }
    }
  });
});

// Keep idle streams alive through proxies and phone power-saving
setInterval(() => {
  for (const set of subscribers.values()) {
    for (const res of set) sseWrite(res, ": ping\n\n");
  }
}, 25000);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, tracked: q.listTopics.all().length, mirror: MIRROR, streams: resTopics.size });
});

// Drawn on request from the moon photo and the live 1mhbar.com wall.
// Registered before dist so a baked PNG in public/ is only the fallback.
app.get(Object.keys(APP_ICONS).map((name) => "/icons/" + name), appIcon);

// Production: one process serves the built map and the API on the same
// origin. /api routes above win. Local `npm run dev` still uses Vite.
const distDir = path.join(__dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, {
    setHeaders(res, filePath) {
      const base = path.basename(filePath);
      if (base === "sw.js") {
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Service-Worker-Allowed", "/");
      } else if (base === "manifest.webmanifest") {
        res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
      }
    }
  }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

app.listen(PORT, "0.0.0.0", () => {
  const serving = fs.existsSync(distDir) ? ", serving dist" : "";
  console.log(`topic backend on :${PORT} (mirror: ${MIRROR})${serving}`);
});
