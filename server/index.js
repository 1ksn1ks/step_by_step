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
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { S3Client, PutObjectCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { appIcon, APP_ICONS } from "./appicon.js";
import { profileTopicAction } from "./profiletopic.js";
import { hashtagsIn } from "../hashtag.js";
import { resolvedUploadSeconds, uploadObjectKey } from "../mediaduration.js";
import { startBackupSchedule } from "./backup.js";

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
// One global topic for person follows. The body names the followee.
// The mirror payer is the follower.
const FOLLOW_TOPIC = "0.0.10923187";

function envPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

// Upload caps. Defaults match the previous fixed limits: 30 files an hour
// and 500 MB a day for one account, 60 files an hour for one IP.
const UPLOAD_PER_HOUR = envPositiveInt("UPLOAD_RATE_LIMIT_ACCOUNT", 30);
const UPLOAD_PER_IP_HOUR = envPositiveInt("UPLOAD_RATE_LIMIT_IP", 60);
const UPLOAD_BYTES_PER_DAY = envPositiveInt("UPLOAD_DAILY_MB_ACCOUNT", 500) * 1024 * 1024;
// How many upload bodies may sit in memory at once. Extra requests get
// 503 and Retry-After instead of growing without a bound.
const UPLOAD_MAX_CONCURRENT = envPositiveInt("UPLOAD_MAX_CONCURRENT", 4);
// One address cannot fill every slot by trickling a few bodies.
const UPLOAD_MAX_CONCURRENT_PER_IP = envPositiveInt("UPLOAD_MAX_CONCURRENT_PER_IP", 2);
// A body that stops sending is dropped instead of holding its slot.
const UPLOAD_BODY_TIMEOUT_MS = envPositiveInt("UPLOAD_BODY_TIMEOUT_MS", 30000);
// Requests to /api/upload from one IP each minute, before Turnstile.
const UPLOAD_REQUESTS_PER_MIN = envPositiveInt("UPLOAD_REQUESTS_PER_MIN", 30);
// Writes and mirror polls that are open to any visitor.
const PUBLIC_POST_RATE_LIMIT = envPositiveInt("PUBLIC_POST_RATE_LIMIT", 60);
// Wallet-signed upload auth stays off until this is exactly "1".
const REQUIRE_UPLOAD_AUTH = process.env.REQUIRE_UPLOAD_AUTH === "1";
const UPLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;
const UPLOAD_NONCE_TTL_MS = 5 * 60 * 1000;

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
  -- One integer per post. created is the message's ISO time, the same
  -- value the phone already has. Not rebuilt from Hedera: wiping this
  -- file resets the counts.
  CREATE TABLE IF NOT EXISTS popup_views (
    topic_id TEXT NOT NULL,
    created  TEXT NOT NULL,
    views    INTEGER NOT NULL,
    PRIMARY KEY (topic_id, created)
  );
  -- A post removed by its author. created is the original message ISO time.
  CREATE TABLE IF NOT EXISTS deleted_posts (
    topic_id TEXT NOT NULL,
    created  TEXT NOT NULL,
    payer    TEXT NOT NULL,
    PRIMARY KEY (topic_id, created, payer)
  );
  -- One row per hashtag on a marker or polygon. tag is lowercase.
  -- created is the post ISO time, the same key a delete already uses.
  CREATE TABLE IF NOT EXISTS hashtags (
    tag      TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    seq      INTEGER NOT NULL,
    kind     TEXT NOT NULL,
    title    TEXT NOT NULL,
    msg      TEXT NOT NULL,
    payer    TEXT NOT NULL,
    created  TEXT NOT NULL,
    lng      REAL,
    lat      REAL,
    number   TEXT NOT NULL,
    PRIMARY KEY (tag, topic_id, seq, kind)
  );
  CREATE TABLE IF NOT EXISTS user_follows (
    follower TEXT NOT NULL,
    followee TEXT NOT NULL,
    PRIMARY KEY (follower, followee)
  );
  CREATE INDEX IF NOT EXISTS messages_payer ON messages(payer);
`);
// Migrations: columns added after earlier deployments created the tables
// (CREATE TABLE IF NOT EXISTS won't add a column to an existing one).
for (const migration of [
  "ALTER TABLE topics ADD COLUMN memo TEXT",
  "ALTER TABLE live_markers ADD COLUMN number TEXT",
  "ALTER TABLE user_settings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE user_settings ADD COLUMN topic TEXT",
]) {
  try {
    db.exec(migration);
  } catch {
    /* column already there */
  }
}
db.exec("CREATE INDEX IF NOT EXISTS user_settings_revision ON user_settings(revision)");
// /api/post looks one message up by (topic, ISO time). ts is stored at
// nanosecond precision while the key only carries milliseconds, so the
// index narrows the scan to a 1ms window that JS verifies exactly.
db.exec("CREATE INDEX IF NOT EXISTS messages_ts ON messages(topic_id, ts)");
db.exec("CREATE INDEX IF NOT EXISTS hashtags_tag ON hashtags(tag, created)");
db.exec(`
  CREATE TABLE IF NOT EXISTS topic_follows (
    topic_id   TEXT NOT NULL,
    account_id TEXT NOT NULL,
    PRIMARY KEY (topic_id, account_id)
  );
  -- One row per account that currently shares a post. stamp is the locale
  -- string the phone sent (old shares). created is the post's ISO time
  -- (new shares), so a count does not depend on the browser timezone.
  CREATE TABLE IF NOT EXISTS shares (
    topic_id TEXT NOT NULL,
    stamp    TEXT NOT NULL,
    payer    TEXT NOT NULL,
    created  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (topic_id, stamp, payer)
  );
  CREATE INDEX IF NOT EXISTS shares_created ON shares(topic_id, created);
`);
db.exec("CREATE INDEX IF NOT EXISTS topic_follows_account ON topic_follows(account_id)");
// settings_generation stays for the life of this database file. A new file
// (a rebuilt cache) gets a new id so phones drop their copy and take the
// directory again. settings_revision counts writes, not message time.
{
  const hasGeneration = db.prepare("SELECT value FROM meta WHERE key = 'settings_generation'").get();
  if (!hasGeneration) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('settings_generation', ?)").run(crypto.randomUUID());
  }
  const hasRevision = db.prepare("SELECT value FROM meta WHERE key = 'settings_revision'").get();
  if (!hasRevision) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('settings_revision', '0')").run();
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
  insertHashtag: db.prepare(`
    INSERT OR REPLACE INTO hashtags
      (tag, topic_id, seq, kind, title, msg, payer, created, lng, lat, number)
    VALUES
      (@tag, @topicId, @seq, @kind, @title, @msg, @payer, @created, @lng, @lat, @number)
  `),
  searchHashtags: db.prepare(`
    SELECT kind, topic_id AS topicId, title, msg, payer, created, lng, lat, number
    FROM hashtags
    WHERE tag = ?
      AND NOT EXISTS (
        SELECT 1 FROM deleted_posts d
        WHERE d.topic_id = hashtags.topic_id
          AND d.created = hashtags.created
          AND d.payer = hashtags.payer
      )
    ORDER BY created DESC
    LIMIT 20
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
    INSERT INTO user_settings (account_id, username, updated_at, revision) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at, revision = excluded.revision
  `),
  settingPic: db.prepare(`
    INSERT INTO user_settings (account_id, profile_pic, updated_at, revision) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET profile_pic = excluded.profile_pic, updated_at = excluded.updated_at, revision = excluded.revision
  `),
  settingClick: db.prepare(`
    INSERT INTO user_settings (account_id, click2url, updated_at, revision) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET click2url = excluded.click2url, updated_at = excluded.updated_at, revision = excluded.revision
  `),
  settingBio: db.prepare(`
    INSERT INTO user_settings (account_id, bio, updated_at, revision) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET bio = excluded.bio, updated_at = excluded.updated_at, revision = excluded.revision
  `),
  settingTopic: db.prepare(`
    INSERT INTO user_settings (account_id, topic, updated_at, revision) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET topic = excluded.topic, updated_at = excluded.updated_at, revision = excluded.revision
  `),
  clearTopic: db.prepare(
    "UPDATE user_settings SET topic = '', updated_at = ?, revision = ? WHERE account_id = ? AND topic IS NOT NULL AND topic != ''"
  ),
  followTopic: db.prepare(
    "INSERT OR IGNORE INTO topic_follows (topic_id, account_id) VALUES (?, ?)"
  ),
  unfollowTopic: db.prepare(
    "DELETE FROM topic_follows WHERE topic_id = ? AND account_id = ?"
  ),
  countFollowers: db.prepare(
    "SELECT COUNT(*) AS n FROM topic_follows WHERE topic_id = ?"
  ),
  getFollow: db.prepare(
    "SELECT account_id FROM topic_follows WHERE topic_id = ? AND account_id = ?"
  ),
  followUser: db.prepare(
    "INSERT OR IGNORE INTO user_follows (follower, followee) VALUES (?, ?)"
  ),
  unfollowUser: db.prepare(
    "DELETE FROM user_follows WHERE follower = ? AND followee = ?"
  ),
  countUserFollowers: db.prepare(
    "SELECT COUNT(*) AS n FROM user_follows WHERE followee = ?"
  ),
  getUserFollow: db.prepare(
    "SELECT follower FROM user_follows WHERE follower = ? AND followee = ?"
  ),
  listUserFollowing: db.prepare(
    "SELECT followee FROM user_follows WHERE follower = ? ORDER BY followee"
  ),
  listUserFollowingDetail: db.prepare(`
    SELECT u.followee AS id,
           COALESCE(s.username, '') AS username,
           COALESCE(s.profile_pic, '') AS avatar
    FROM user_follows u
    LEFT JOIN user_settings s ON s.account_id = u.followee
    WHERE u.follower = ?
    ORDER BY u.followee
    LIMIT 500
  `),
  listTopicFollowing: db.prepare(
    "SELECT topic_id FROM topic_follows WHERE account_id = ? ORDER BY topic_id LIMIT 500"
  ),
  followingFeed: db.prepare(`
    SELECT topic_id, seq, ts, payer, body FROM messages
    WHERE payer IN (SELECT followee FROM user_follows WHERE follower = ?)
    ORDER BY ts DESC, seq DESC
    LIMIT ?
  `),
  getUserSetting: db.prepare("SELECT * FROM user_settings WHERE account_id = ?"),
  bumpSettingsRevision: db.prepare(
    "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'settings_revision'"
  ),
  readSettingsRevision: db.prepare(
    "SELECT CAST(value AS INTEGER) AS revision FROM meta WHERE key = 'settings_revision'"
  ),
  readSettingsGeneration: db.prepare(
    "SELECT value AS generation FROM meta WHERE key = 'settings_generation'"
  ),
  setSettingsRevision: db.prepare(
    "UPDATE user_settings SET revision = ? WHERE account_id = ?"
  ),
  listUserSettings: db.prepare("SELECT * FROM user_settings ORDER BY updated_at DESC"),
  settingsSince: db.prepare(
    "SELECT * FROM user_settings WHERE revision > ? ORDER BY revision ASC"
  ),
  // live-marker derived views — PK-prefix lookups only.
  // marker_index upserts: a re-upload of the same cord+number must win,
  // because the app renders the NEWEST message per number.
  insertMarkerIndex: db.prepare(`
    INSERT INTO marker_index (topic_id, cord, number, created) VALUES (?, ?, ?, ?)
    ON CONFLICT(topic_id, cord, number) DO UPDATE SET created = excluded.created
  `),
  markerIndexByCreated: db.prepare(
    "SELECT cord, number, created FROM marker_index WHERE topic_id = ? AND created = ?"
  ),
  markerIndexByNumber: db.prepare(
    "SELECT cord, number, created FROM marker_index WHERE topic_id = ? AND number = ?"
  ),
  deleteMarkerIndexByCreated: db.prepare(
    "DELETE FROM marker_index WHERE topic_id = ? AND created = ?"
  ),
  deleteMarkerIndexByNumber: db.prepare(
    "DELETE FROM marker_index WHERE topic_id = ? AND number = ?"
  ),
  deleteLiveAt: db.prepare(
    "DELETE FROM live_markers WHERE topic = ? AND cord = ? AND payer = ?"
  ),
  deleteLiveByNumber: db.prepare(
    "DELETE FROM live_markers WHERE topic = ? AND number = ? AND payer = ?"
  ),
  insertDeletedPost: db.prepare(
    "INSERT OR IGNORE INTO deleted_posts (topic_id, created, payer) VALUES (?, ?, ?)"
  ),
  isDeletedPost: db.prepare(
    "SELECT 1 AS n FROM deleted_posts WHERE topic_id = ? AND created = ? AND payer = ?"
  ),
  // Legacy polygon deletes name a number. Polygons are not in marker_index,
  // so the original message is found on this payer's rows.
  polygonBodiesByPayer: db.prepare(
    "SELECT body, ts FROM messages WHERE topic_id = ? AND payer = ? AND body LIKE '%numberOfPolygon%'"
  ),
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
  deleteReaction: db.prepare(
    "DELETE FROM reactions WHERE topic_id = ? AND target_key = ? AND payer = ?"
  ),
  insertComment: db.prepare(`
    INSERT OR IGNORE INTO comments (topic_id, target_key, created, payer, text, parent_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listComments: db.prepare(
    "SELECT created, payer, text, parent_id FROM comments WHERE topic_id = ? AND target_key = ? ORDER BY created ASC"
  ),
  // One row per post. The insert adds the first view; a repeat adds one.
  bumpPopupView: db.prepare(`
    INSERT INTO popup_views (topic_id, created, views) VALUES (?, ?, 1)
    ON CONFLICT(topic_id, created) DO UPDATE SET views = popup_views.views + 1
    RETURNING views
  `),
  getPopupView: db.prepare(
    "SELECT views FROM popup_views WHERE topic_id = ? AND created = ?"
  ),
  listPopupViews: db.prepare(
    "SELECT created, views FROM popup_views WHERE topic_id = ?"
  ),
  // 1ms window around a known ISO time (see messages_ts index above)
  msgsInWindow: db.prepare(
    "SELECT seq, ts, payer, body FROM messages WHERE topic_id = ? AND ts >= ? AND ts < ? ORDER BY seq ASC"
  ),
  getReaction: db.prepare(
    "SELECT kind FROM reactions WHERE topic_id = ? AND target_key = ? AND payer = ?"
  ),
  // A repeat share from the same account replaces its row. An empty created
  // must not wipe an ISO a newer message already stored.
  upsertShare: db.prepare(`
    INSERT INTO shares (topic_id, stamp, payer, created) VALUES (?, ?, ?, ?)
    ON CONFLICT(topic_id, stamp, payer) DO UPDATE SET
      created = CASE WHEN excluded.created != '' THEN excluded.created ELSE shares.created END
  `),
  deleteShareStamp: db.prepare(
    "DELETE FROM shares WHERE topic_id = ? AND stamp = ? AND payer = ?"
  ),
  deleteShareCreated: db.prepare(
    "DELETE FROM shares WHERE topic_id = ? AND payer = ? AND created = ? AND created != ''"
  ),
  countShares: db.prepare(`
    SELECT COUNT(DISTINCT payer) AS n FROM shares
    WHERE topic_id = ? AND (created = ? OR stamp = ?)
  `),
  myShare: db.prepare(`
    SELECT 1 AS hit FROM shares
    WHERE topic_id = ? AND payer = ? AND (created = ? OR stamp = ?)
    LIMIT 1
  `),
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

// Profile-data topics are mixed (the bio topic also carries the linked topic),
// so extract ONLY the relevant field per account. storePage feeds rows
// oldest→newest, so the last valid value for each field wins.
// A repeat of the same value does not move the revision, so a phone that
// already has this card is not told to download it again.
function saveSetting(statement, accountId, column, value, tsMs) {
  if (typeof value !== "string" || value.length === 0) return;
  const row = q.getUserSetting.get(accountId);
  if (row && row[column] === value) return;
  q.bumpSettingsRevision.run();
  const revision = q.readSettingsRevision.get().revision;
  statement.run(accountId, value, tsMs, revision);
}

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
    if (d.username && d.username.length < 20) saveSetting(q.settingUsername, payer, "username", d.username, tsMs);
  } else if (kind === "pic") {
    if (d.urls && d.urls.length > 0) saveSetting(q.settingPic, payer, "profile_pic", d.urls[0], tsMs);
  } else if (kind === "click") {
    if (d.click2url && d.click2url.length > 0) saveSetting(q.settingClick, payer, "click2url", d.click2url[0], tsMs);
  } else if (kind === "bio") {
    // Profiles submit topic_bio as a one-item list. Older messages used a string.
    const bio = Array.isArray(d.topic_bio) ? d.topic_bio[0] : d.topic_bio;
    if (typeof bio === "string" && bio.length > 0 && bio.length < 256) saveSetting(q.settingBio, payer, "bio", bio, tsMs);
    // Connect saves profileTopic. Remove sends clearProfileTopic and does not
    // write a topic id. A bio-only message leaves the link alone. Old
    // topic2pic messages are still read.
    const link = profileTopicAction(d);
    if (link && link.action === "set") saveSetting(q.settingTopic, payer, "topic", link.topic, tsMs);
    else if (link && link.action === "clear") clearTopicSetting(payer, tsMs);
  }
}

function clearTopicSetting(accountId, tsMs) {
  const row = q.getUserSetting.get(accountId);
  if (!row || !row.topic) return;
  q.bumpSettingsRevision.run();
  const revision = q.readSettingsRevision.get().revision;
  q.clearTopic.run(tsMs, revision, accountId);
}

function extractFollow(topicId, payer, body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return;
  }
  if (!data || typeof data !== "object" || !isTopicId(payer)) return;
  if (data.follow) q.followTopic.run(topicId, payer);
  else if (data.unfollow) q.unfollowTopic.run(topicId, payer);
}

// Person follows live on one global topic. The body is the followee account.
// The payer is the follower. A repeat of the same pair does not add a row.
function extractUserFollow(payer, body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return;
  }
  if (!data || typeof data !== "object" || !isTopicId(payer)) return;
  if (isTopicId(data.follow)) q.followUser.run(payer, data.follow);
  else if (isTopicId(data.unfollow)) q.unfollowUser.run(payer, data.unfollow);
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

// One-time startup: if user_follows is empty but the follow topic already
// has cached messages, rebuild the pairs from the local cache. Oldest first,
// so a later unfollow wins. Called once isTopicId exists.
function backfillUserFollows() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM user_follows").get();
  if (n > 0) return;
  const rows = db
    .prepare("SELECT payer, body FROM messages WHERE topic_id = ? ORDER BY seq ASC")
    .all(FOLLOW_TOPIC);
  for (const r of rows) extractUserFollow(r.payer, r.body);
}

// Rows saved before revisions existed get a number, oldest first, so a
// phone can ask for everything newer than the number it has stored.
{
  const pending = db.prepare(
    "SELECT account_id FROM user_settings WHERE revision = 0 ORDER BY updated_at ASC, account_id ASC"
  ).all();
  if (pending.length) {
    db.exec("BEGIN");
    try {
      for (const row of pending) {
        q.bumpSettingsRevision.run();
        q.setSettingsRevision.run(q.readSettingsRevision.get().revision, row.account_id);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

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

function postNumber(raw, created) {
  if (raw == null || String(raw).trim() === "") return created;
  if (!Number.isInteger(Number(raw))) return "";
  return String(raw).trim();
}

function pointFromCord(kind, cord) {
  if (typeof cord !== "string") return null;
  if (kind === "marker") {
    const parts = cord.split(",").map((part) => Number(part.trim()));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
    return parts;
  }
  const pairs = [...cord.matchAll(/\[(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\]/g)];
  if (pairs.length < 3) return null;
  let lng = 0;
  let lat = 0;
  for (const pair of pairs) {
    lng += Number(pair[1]);
    lat += Number(pair[2]);
  }
  return [lng / pairs.length, lat / pairs.length];
}

function textField(value) {
  if (Array.isArray(value)) return String(value[0] || "");
  return typeof value === "string" ? value : "";
}

// Title and message only. Comments are not posts, so a # in a comment
// does not enter the search index.
function indexHashtags(topicId, payer, data, tsMs, seq) {
  if (!data || typeof data !== "object" || !payer) return;
  const created = new Date(tsMs).toISOString();
  const drawings = [
    ["marker", data.marker && data.marker.data, "numberOfMarker"],
    ["polygon", data.polygon && data.polygon.data, "numberOfPolygon"],
  ];
  for (const [kind, drawing, numberKey] of drawings) {
    if (!drawing) continue;
    const number = postNumber(drawing[numberKey], created);
    if (!number) continue;
    const title = textField(drawing.title).slice(0, 20);
    const msg = textField(drawing.msg).slice(0, 256);
    const tags = hashtagsIn(`${title} ${msg}`);
    if (!tags.length) continue;
    const point = pointFromCord(kind, drawing.cord);
    if (!point) continue;
    for (const tag of tags) {
      q.insertHashtag.run({
        tag,
        topicId,
        seq: Number(seq) || 0,
        kind,
        title,
        msg,
        payer,
        created,
        lng: point[0],
        lat: point[1],
        number,
      });
    }
  }
}

// Same per-message work as extractUserSettings, but for the marker view:
// index marker messages, keep per-payer latest reactions, store comments
// and replies. storePage feeds rows oldest→newest.
function extractTopicIndex(topicId, payer, body, tsMs, seq) {
  let d;
  try {
    d = JSON.parse(body);
  } catch {
    return;
  }
  if (!d || typeof d !== "object") return;
  indexHashtags(topicId, payer, d, tsMs, seq);
  const created = new Date(tsMs).toISOString();

  const m = d.marker && d.marker.data;
  const rawNumber = m && m.numberOfMarker;
  const missingNumber = rawNumber == null || String(rawNumber).trim() === "";
  const legacyNumber = !missingNumber && Number.isInteger(Number(rawNumber));
  // Older markers are indexed by their number. New markers have no number,
  // so the message time keeps that row unique. A bad number is still skipped.
  if (m && typeof m.cord === "string" && (legacyNumber || missingNumber)) {
    const numberKey = legacyNumber ? String(rawNumber) : created;
    q.insertMarkerIndex.run(topicId, m.cord, numberKey, created);
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
        number: numberKey,
        last_seen: tsMs,
      });
        if (!cached) geoQueue.add(geokey);
      }
    }
  }
  applyContentReactions(topicId, payer, d, created);
  applyShare(topicId, payer, d);
  if (m) applyPostDelete(topicId, payer, m, "marker");
  const polygon = d.polygon && d.polygon.data;
  if (polygon) applyPostDelete(topicId, payer, polygon, "polygon");
}

// Marker and polygon likes, comments, and replies share one table.
// The phone keys both by the same locale timestamp string. One message
// is one reaction: unlike wins over like, and marker wins over polygon
// if a body somehow carries both.
function applyContentReactions(topicId, payer, body, created) {
  if (!payer) return;
  const reactions = [
    ["unlikeMarker", "unlike"],
    ["likeMarker", "like"],
    ["dislikeMarker", "dislike"],
    ["unlikePolygon", "unlike"],
    ["likePolygon", "like"],
    ["dislikePolygon", "dislike"],
  ];
  for (const [field, kind] of reactions) {
    const value = body[field];
    if (!value || !value.timestamp) continue;
    const key = String(value.timestamp);
    if (kind === "unlike") q.deleteReaction.run(topicId, key, payer);
    else q.upsertReaction.run(topicId, key, payer, kind);
    break;
  }
  const comment = (body.commentMarker && body.commentMarker.timestamp && body.commentMarker)
    || (body.commentPolygon && body.commentPolygon.timestamp && body.commentPolygon);
  if (comment) {
    q.insertComment.run(
      topicId, String(comment.timestamp), created, payer,
      String(comment.text || "").slice(0, 300), null
    );
  }
  const reply = (body.replyMarker && body.replyMarker.parentId && body.replyMarker)
    || (body.replyPolygon && body.replyPolygon.parentId && body.replyPolygon);
  if (reply) {
    q.insertComment.run(
      topicId, String(reply.parentId), created, payer,
      String(reply.text || "").slice(0, 300), String(reply.parentId)
    );
  }
}

// sharePost adds this account. unsharePost removes it. The latest message
// wins because storePage walks oldest to newest. created is the post ISO
// when the phone sent one; older messages only have the locale stamp.
function isoCreated(value) {
  if (typeof value !== "string" || value.length > 40) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

// A delete names the original post's time. An older delete names its number.
// The row is dropped from the 24h view and from /api/post.
function applyPostDelete(topicId, payer, data, kind) {
  if (!payer || !data) return;
  const marker = kind !== "polygon";
  const numberKey = marker ? "deleteMarkerNumber" : "deletePolygonNumber";
  const createdKey = marker ? "deleteMarkerCreated" : "deletePolygonCreated";
  const rawNumber = data[numberKey];
  const hasNumber = rawNumber != null && String(rawNumber).trim() !== "";
  // The locale stamp is a phone-side match only. Parsing it here would
  // shift the instant, so the server records the ISO the phone sent.
  const created = isoCreated(data[createdKey]);
  if (!created && !hasNumber) return;

  const mark = (iso) => {
    if (!iso) return;
    q.insertDeletedPost.run(topicId, iso, payer);
    if (!marker) return;
    for (const row of q.markerIndexByCreated.all(topicId, iso)) {
      q.deleteLiveAt.run(topicId, row.cord, payer);
    }
    q.deleteMarkerIndexByCreated.run(topicId, iso);
  };

  if (created) mark(created);
  if (hasNumber && marker) {
    const number = String(rawNumber);
    for (const row of q.markerIndexByNumber.all(topicId, number)) mark(row.created);
    q.deleteLiveByNumber.run(topicId, number, payer);
    q.deleteMarkerIndexByNumber.run(topicId, number);
  }
  if (hasNumber && !marker && !created) {
    for (const row of q.polygonBodiesByPayer.all(topicId, payer)) {
      let body;
      try {
        body = JSON.parse(row.body);
      } catch {
        continue;
      }
      const drawing = body && body.polygon && body.polygon.data;
      if (!drawing || drawing.numberOfPolygon !== rawNumber) continue;
      if (
        drawing.deletePolygonNumber != null ||
        drawing.deletePolygonCreated ||
        drawing.deletePolygonTimestamp
      ) {
        continue;
      }
      mark(new Date(Number(row.ts) * 1000).toISOString());
    }
  }
}

function applyShare(topicId, payer, body) {
  if (!payer) return;
  const dropping = body.unsharePost && body.unsharePost.timestamp;
  const msg = dropping ? body.unsharePost : body.sharePost;
  if (!msg || !msg.timestamp) return;
  const stamp = String(msg.timestamp).slice(0, 80);
  const created = isoCreated(msg.created);
  if (dropping) {
    q.deleteShareStamp.run(topicId, stamp, payer);
    if (created) q.deleteShareCreated.run(topicId, payer, created);
    return;
  }
  q.upsertShare.run(topicId, stamp, payer, created);
}

// One-time startup: rebuild the derived views from cached messages stored
// before this feature existed (same pattern as backfillUserSettings). A meta
// flag marks completion — clearing the flag (or data.db) re-runs it.
function backfillDerived() {
  const flag = db.prepare("SELECT value FROM meta WHERE key = 'derived_backfilled'").get();
  if (flag) return;
  for (const t of q.listTopics.all()) {
    const rows = db
      .prepare("SELECT payer, body, ts, seq FROM messages WHERE topic_id = ? ORDER BY seq ASC")
      .all(t.topic_id);
    for (const r of rows) {
      extractTopicIndex(t.topic_id, r.payer, r.body, Number(r.ts) * 1000, r.seq);
    }
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('derived_backfilled', '1')")
    .run();
}

// Shares and polygon reactions were added after derived_backfilled had
// already run, so that flag will not walk the old rows again. This pass
// only re-reads messages that can carry those keys.
function backfillShares() {
  const flag = db.prepare("SELECT value FROM meta WHERE key = 'shares_backfilled'").get();
  if (flag) return;
  const rows = db.prepare(
    `SELECT topic_id, payer, body, ts, seq FROM messages
     WHERE body LIKE '%sharePost%'
        OR body LIKE '%unsharePost%'
        OR body LIKE '%likePolygon%'
        OR body LIKE '%unlikePolygon%'
        OR body LIKE '%dislikePolygon%'
        OR body LIKE '%commentPolygon%'
        OR body LIKE '%replyPolygon%'
     ORDER BY topic_id ASC, seq ASC`
  ).all();
  for (const r of rows) {
    try {
      extractTopicIndex(r.topic_id, r.payer, r.body, Number(r.ts) * 1000, r.seq);
    } catch (err) {
      console.error("share backfill skipped", r.topic_id, err.message);
    }
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('shares_backfilled', '1')").run();
}

// Deletes written before the time key existed, and new time deletes that
// arrived before this table did, get one walk. Later messages apply themselves.
function backfillDeletes() {
  const flag = db.prepare("SELECT value FROM meta WHERE key = 'deletes_backfilled'").get();
  if (flag) return;
  const rows = db.prepare(
    `SELECT topic_id, payer, body FROM messages
     WHERE body LIKE '%deleteMarker%'
        OR body LIKE '%deletePolygon%'
     ORDER BY topic_id ASC, seq ASC`
  ).all();
  for (const r of rows) {
    try {
      const body = JSON.parse(r.body);
      const marker = body && body.marker && body.marker.data;
      const polygon = body && body.polygon && body.polygon.data;
      if (marker) applyPostDelete(r.topic_id, r.payer, marker, "marker");
      if (polygon) applyPostDelete(r.topic_id, r.payer, polygon, "polygon");
    } catch (err) {
      console.error("delete backfill skipped", r.topic_id, err.message);
    }
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('deletes_backfilled', '1')").run();
}

// Posts written before hashtags existed. Later messages index themselves.
function backfillHashtags() {
  const flag = db.prepare("SELECT value FROM meta WHERE key = 'hashtags_backfilled'").get();
  if (flag) return;
  const rows = db.prepare(
    `SELECT topic_id, seq, payer, body, ts FROM messages
     WHERE body LIKE '%#%'
     ORDER BY topic_id ASC, seq ASC`
  ).all();
  for (const r of rows) {
    try {
      const body = JSON.parse(r.body);
      indexHashtags(r.topic_id, r.payer, body, Number(r.ts) * 1000, r.seq);
    } catch (err) {
      console.error("hashtag backfill skipped", r.topic_id, err.message);
    }
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('hashtags_backfilled', '1')").run();
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

// One account once. created matches new share messages (ISO). stamp matches
// older messages whose locale string is the Zagreb key the likes already use.
function sharePicture(topicId, createdISO, account) {
  const stamp = formatMarkerKey(createdISO);
  const counted = q.countShares.get(topicId, createdISO, stamp);
  const mine = account ? q.myShare.get(topicId, account, createdISO, stamp) : null;
  return {
    shares: counted ? Number(counted.n) || 0 : 0,
    sharedByMe: !!mine,
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
        extractFollow(topicId, m.payer_account_id, body);
        if (topicId === FOLLOW_TOPIC) extractUserFollow(m.payer_account_id, body);
      } catch (err) {
        console.error("user settings skipped", topicId, m.sequence_number, err.message);
      }
      extractTopicIndex(topicId, m.payer_account_id, body, Number(m.consensus_timestamp) * 1000, m.sequence_number);
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

// The interval poller and a post lookup must not walk the same topic at
// once. last_seq would otherwise move backwards between pages.
const pollInflight = new Map();
function pollTopicLocked(topicId) {
  const current = pollInflight.get(topicId);
  if (current) return current;
  const run = pollTopic(topicId).finally(() => {
    if (pollInflight.get(topicId) === run) pollInflight.delete(topicId);
  });
  pollInflight.set(topicId, run);
  return run;
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
    q.upsertTopic.run(FOLLOW_TOPIC, now);
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
      const newRows = await pollTopicLocked(t.topic_id);
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
backfillShares();
backfillDeletes();
backfillHashtags();

// Discovered markers (storePage) queue geokeys without a /api/marker kick —
// a periodic sweep keeps the queue draining.
setInterval(() => {
  if (geoQueue.size > 0) geoWorker();
}, 5000);

// How many reverse-proxy hops may set the client address. Railway in front
// of this process is one hop. 0 keeps the socket address. A client-sent
// forwarding header is never parsed here.
function trustProxySetting() {
  const raw = process.env.TRUST_PROXY;
  if (raw == null || String(raw).trim() === "") return 1;
  const text = String(raw).trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  const n = Number(text);
  if (Number.isInteger(n) && n >= 0) return n;
  return 1;
}

// ── API ─────────────────────────────────────────────────────────────────
const app = express();
app.set("trust proxy", trustProxySetting());
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// About 60 requests a minute for one IP on one path.
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60;
const rateHits = new Map();

// req.ip follows TRUST_PROXY. CF-Connecting-IP is read only when
// TRUST_CF_IP=1, because that header is client-controlled unless the
// edge in front of this process strips it.
function clientIp(req) {
  if (process.env.TRUST_CF_IP === "1") {
    const cf = req.headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.trim()) return cf.trim();
  }
  return req.ip || "unknown";
}

function rateLimit(req, res, next) {
  const now = Date.now();
  if (rateHits.size > 4000) {
    for (const [key, bucket] of rateHits) {
      if (now >= bucket.reset) rateHits.delete(key);
    }
  }
  const key = clientIp(req) + " " + req.path;
  let bucket = rateHits.get(key);
  if (!bucket || now >= bucket.reset) {
    bucket = { reset: now + RATE_WINDOW_MS, count: 0 };
    rateHits.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
    return res.status(429).json({ ok: false, error: "rate limit" });
  }
  next();
}

// Same window as rateLimit, separate counter, so a busy chat poll does not
// eat the follow/hashtag budget and the cap can be set on its own.
const publicHits = new Map();

function publicPostLimit(req, res, next) {
  const now = Date.now();
  if (publicHits.size > 4000) {
    for (const [key, bucket] of publicHits) {
      if (now >= bucket.reset) publicHits.delete(key);
    }
  }
  const key = clientIp(req) + " " + req.path;
  let bucket = publicHits.get(key);
  if (!bucket || now >= bucket.reset) {
    bucket = { reset: now + RATE_WINDOW_MS, count: 0 };
    publicHits.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > PUBLIC_POST_RATE_LIMIT) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
    return res.status(429).json({ ok: false, error: "rate limit" });
  }
  next();
}

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

function r2CorsOrigins() {
  const raw = process.env.R2_CORS_ORIGINS;
  if (raw == null || String(raw).trim() === "") return ["*"];
  const origins = String(raw).split(",").map((part) => part.trim()).filter(Boolean);
  return origins.length ? origins : ["*"];
}

function r2CorsDenied(err) {
  const name = String((err && (err.name || err.Code)) || "");
  const message = String((err && err.message) || "");
  return name === "AccessDenied" || /access denied/i.test(message);
}

// The app reads covers cross-origin into canvases (gif decode, video →
// canvas blit for the animated polygon covers) — without CORS the canvas
// taints and every read throws. CORS is a BUCKET-level setting in S3/R2
// (a CORS field on PutObject is silently ignored), so apply it on every
// start — idempotent. A token that cannot write CORS must not stop the API.
if (r2) {
  r2
    .send(
      new PutBucketCorsCommand({
        Bucket: R2_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: r2CorsOrigins(),
              AllowedMethods: ["GET", "HEAD"],
              AllowedHeaders: ["*"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      })
    )
    .then(() => console.log("R2 bucket CORS ensured"))
    .catch((err) => {
      if (r2CorsDenied(err)) {
        console.warn("R2 CORS was not updated (Access Denied). Set the bucket CORS rule in the Cloudflare dashboard: methods GET and HEAD, AllowedHeaders *, MaxAgeSeconds 3600.");
        return;
      }
      console.error("R2 CORS setup failed:", err.message);
    });
}

// Nightly encrypted snapshot of data.db. No-op unless both backup env vars are set.
startBackupSchedule({
  r2,
  bucket: R2_BUCKET,
  dbPath: path.join(DATA_DIR, "data.db"),
});

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

// In-memory upload caps. Nothing here is written to the database.
// An entry stays for the rest of its day so the byte total still applies
// after the rolling hour has gone quiet.
const UPLOAD_HOUR_MS = 60 * 60 * 1000;
const uploadsByAccount = new Map();
const uploadsByIp = new Map();

function uploadDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function recentUploads(times, now) {
  const cutoff = now - UPLOAD_HOUR_MS;
  let drop = 0;
  while (drop < times.length && times[drop] <= cutoff) drop += 1;
  if (drop > 0) times.splice(0, drop);
  return times.length;
}

function uploadEntry(bucket, key, now) {
  const day = uploadDay(now);
  let entry = bucket.get(key);
  if (!entry) {
    entry = { times: [], day, bytes: 0 };
    bucket.set(key, entry);
    return entry;
  }
  if (entry.day !== day) {
    entry.day = day;
    entry.bytes = 0;
  }
  return entry;
}

// The connected wallet id, when the phone sent one. A missing or
// malformed id is anonymous: the per-IP cap still applies.
function requireAccount(req) {
  const raw = req.headers["x-account"];
  const account = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+\.\d+\.\d+$/.test(account)) return null;
  return account;
}

function takeUploadSlot(req, res, account, declared) {
  const now = Date.now();
  const ipEntry = uploadEntry(uploadsByIp, clientIp(req), now);
  const accountEntry = account ? uploadEntry(uploadsByAccount, account, now) : null;
  const declaredBytes = Number.isFinite(declared) && declared > 0 ? declared : 0;
  const ipOver = recentUploads(ipEntry.times, now) >= UPLOAD_PER_IP_HOUR;
  const accountOver = !!(accountEntry && (
    recentUploads(accountEntry.times, now) >= UPLOAD_PER_HOUR ||
    accountEntry.bytes + declaredBytes > UPLOAD_BYTES_PER_DAY
  ));
  if (ipOver || accountOver) {
    req.resume();
    res.status(429).json({ ok: false, error: "Upload limit reached, try again later" });
    return false;
  }
  ipEntry.times.push(now);
  ipEntry.day = uploadDay(now);
  if (accountEntry) accountEntry.times.push(now);
  return true;
}

function addUploadBytes(account, bytes) {
  if (!account || !(bytes > 0)) return;
  const entry = uploadsByAccount.get(account);
  if (!entry) return;
  const day = uploadDay(Date.now());
  if (entry.day !== day) {
    entry.day = day;
    entry.bytes = 0;
  }
  entry.bytes += bytes;
}

function sweepUploadLimits() {
  const now = Date.now();
  const day = uploadDay(now);
  for (const bucket of [uploadsByAccount, uploadsByIp]) {
    for (const [key, entry] of bucket) {
      recentUploads(entry.times, now);
      if (entry.times.length === 0 && entry.day !== day) bucket.delete(key);
    }
  }
}

setInterval(sweepUploadLimits, UPLOAD_HOUR_MS);

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87 = Buffer.from("GIF87a");
const GIF89 = Buffer.from("GIF89a");
const RIFF = Buffer.from("RIFF");
const WEBP = Buffer.from("WEBP");
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const FTYP = Buffer.from("ftyp");

function hasBytes(buf, sig, offset = 0) {
  if (buf.length < offset + sig.length) return false;
  return buf.subarray(offset, offset + sig.length).equals(sig);
}

// Major brand plus compatible brands inside the first ftyp box.
function isoBrands(buf) {
  if (buf.length < 12 || !hasBytes(buf, FTYP, 4)) return null;
  const size = buf.readUInt32BE(0);
  const end = Math.min(buf.length, size >= 16 ? size : 16, 128);
  const brands = [buf.subarray(8, 12).toString("latin1")];
  for (let i = 16; i + 4 <= end; i += 4) brands.push(buf.subarray(i, i + 4).toString("latin1"));
  return brands;
}

function isQuickTime(brands) {
  return brands.some((brand) => brand === "qt  " || brand === "mov ");
}

// The declared Content-Type has to match the file header. A renamed HTML
// page, or an MP4 labeled as a PNG, never reaches the bucket.
function magicMatches(type, body) {
  if (type === "image/png") return hasBytes(body, PNG_SIG);
  if (type === "image/jpeg") return hasBytes(body, JPEG_SIG);
  if (type === "image/gif") return hasBytes(body, GIF87) || hasBytes(body, GIF89);
  if (type === "image/webp") return hasBytes(body, RIFF) && hasBytes(body, WEBP, 8);
  if (type === "video/webm") {
    if (!hasBytes(body, EBML)) return false;
    return body.subarray(0, Math.min(body.length, 128)).toString("latin1").includes("webm");
  }
  if (type === "video/mp4" || type === "video/quicktime") {
    const brands = isoBrands(body);
    if (!brands) return false;
    const quick = isQuickTime(brands);
    return type === "video/quicktime" ? quick : !quick;
  }
  return false;
}

function tooBigMessage(isVideo) {
  return `Too big — ${isVideo ? "100 MB video" : "20 MB image"} max`;
}

let uploadsInFlight = 0;
const uploadsInFlightByIp = new Map();

function beginUpload(req, res) {
  const ip = clientIp(req) || "unknown";
  const mine = uploadsInFlightByIp.get(ip) || 0;
  if (mine >= UPLOAD_MAX_CONCURRENT_PER_IP || uploadsInFlight >= UPLOAD_MAX_CONCURRENT) {
    res.setHeader("Retry-After", "5");
    res.status(503).json({ ok: false, error: "Too many uploads, try again shortly" });
    return false;
  }
  uploadsInFlight += 1;
  uploadsInFlightByIp.set(ip, mine + 1);
  return ip;
}

function finishUpload(ip) {
  uploadsInFlight = Math.max(0, uploadsInFlight - 1);
  if (!ip) return;
  const mine = (uploadsInFlightByIp.get(ip) || 1) - 1;
  if (mine <= 0) uploadsInFlightByIp.delete(ip);
  else uploadsInFlightByIp.set(ip, mine);
}

// Separate from the hourly upload caps and from the public post limiter.
// A rejected request does not take a concurrency slot or an hourly slot.
const uploadRequestHits = new Map();

function uploadRequestLimited(req, res) {
  const now = Date.now();
  if (uploadRequestHits.size > 4000) {
    for (const [key, bucket] of uploadRequestHits) {
      if (now >= bucket.reset) uploadRequestHits.delete(key);
    }
  }
  const key = clientIp(req) || "unknown";
  let bucket = uploadRequestHits.get(key);
  if (!bucket || now >= bucket.reset) {
    bucket = { reset: now + RATE_WINDOW_MS, count: 0 };
    uploadRequestHits.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > UPLOAD_REQUESTS_PER_MIN) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
    res.status(429).json({ ok: false, error: "rate limit" });
    return true;
  }
  return false;
}

// Off unless TURNSTILE_SECRET_KEY is set. A missing or rejected token is
// 403 and does not use an upload slot. The test secret still requires a token.
async function turnstileOk(req) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  const token = req.headers["cf-turnstile-response"];
  if (typeof token !== "string" || !token.trim()) return false;
  const form = new URLSearchParams({ secret, response: token.trim() });
  const ip = clientIp(req);
  if (ip && ip !== "unknown") form.set("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    return !!(data && data.success === true);
  } catch {
    return false;
  }
}

function readUploadBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    let timer = null;
    const finish = (err, body) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(body);
    };
    const armIdle = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const err = new Error("idle");
        err.code = 408;
        // Leave the socket up so the handler can answer 408. Destroying
        // it here drops the response on the floor.
        finish(err);
      }, UPLOAD_BODY_TIMEOUT_MS);
    };
    armIdle();
    req.on("data", (chunk) => {
      if (settled) return;
      armIdle();
      received += chunk.length;
      if (received > max) {
        const err = new Error("too big");
        err.code = 413;
        req.destroy();
        finish(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(null, Buffer.concat(chunks)));
    req.on("error", () => {
      const err = new Error("aborted");
      err.code = 400;
      finish(err);
    });
  });
}

// The phone's file goes straight into R2 (buffered in memory while in
// flight — capped below, nothing on disk); the response's url is the public
// r2.pub link the marker's Image URL field stores. A Buffer body sidesteps
// the SDK's stream-signing limits (flowing streams can't be hashed / need
// Content-Length, and R2 resets the connection either way).
// Single-use nonces for the wallet signature. The value is the expiry time.
const uploadNonces = new Map();

function sweepUploadNonces(now) {
  for (const [nonce, exp] of uploadNonces) {
    if (exp <= now) uploadNonces.delete(nonce);
  }
}

function issueUploadNonce() {
  const now = Date.now();
  if (uploadNonces.size > 5000) sweepUploadNonces(now);
  if (uploadNonces.size > 5000) return null;
  const nonce = crypto.randomBytes(32).toString("base64url");
  uploadNonces.set(nonce, now + UPLOAD_NONCE_TTL_MS);
  return nonce;
}

function takeUploadNonce(nonce) {
  if (typeof nonce !== "string" || nonce.length < 16 || nonce.length > 200) return false;
  const exp = uploadNonces.get(nonce);
  uploadNonces.delete(nonce);
  return typeof exp === "number" && exp > Date.now();
}

function uploadTokenSecret() {
  return process.env.UPLOAD_TOKEN_SECRET || "";
}

// Fail closed. A missing or short secret must not issue tokens or accept
// uploads while REQUIRE_UPLOAD_AUTH is on.
function uploadAuthConfigured() {
  return Buffer.byteLength(uploadTokenSecret(), "utf8") >= 32;
}

if (REQUIRE_UPLOAD_AUTH && !uploadAuthConfigured()) {
  console.error("REQUIRE_UPLOAD_AUTH is set, but UPLOAD_TOKEN_SECRET must be at least 32 bytes. Refusing to start.");
  process.exit(1);
}

function issueUploadToken(accountId) {
  const exp = Date.now() + UPLOAD_TOKEN_TTL_MS;
  const body = Buffer.from(JSON.stringify({ accountId, exp })).toString("base64url");
  const mac = crypto.createHmac("sha256", uploadTokenSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

// Constant-time compare of the HMAC. A wrong length never reaches the compare.
function accountFromUploadToken(header) {
  if (!uploadAuthConfigured()) return null;
  const secret = uploadTokenSecret();
  const token = typeof header === "string" ? header.trim() : "";
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest("base64url"));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || !/^\d+\.\d+\.\d+$/.test(payload.accountId)) return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload.accountId;
}

function decodeSignature(text) {
  const trimmed = String(text || "").trim();
  const asBase64 = Buffer.from(trimmed, "base64");
  if (asBase64.length === 64) return asBase64;
  if (/^[0-9a-fA-F]{128}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  return null;
}

// A threshold account or a key list is one policy, not a pile of keys that
// any single signature can satisfy. Those stay a 400. Only a single
// ED25519 or ECDSA key on the account can authorize an upload.
function accountKeyProblem(key) {
  if (!key || typeof key !== "object") return "BAD_KEY";
  if (
    key._type === "ProtobufEncoded" ||
    key._type === "KeyList" ||
    key._type === "ThresholdKey" ||
    Array.isArray(key.keys)
  ) {
    return "COMPOUND_KEY";
  }
  if (key._type !== "ED25519" && key._type !== "ECDSA_SECP256K1") return "BAD_KEY";
  if (typeof key.key !== "string") return "BAD_KEY";
  // The mirror returns the raw public key as hex, not base64.
  if (key.key.length === 0 || key.key.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(key.key)) return "BAD_KEY";
  return null;
}

function accountKeyError(code) {
  const err = new Error(
    code === "COMPOUND_KEY"
      ? "Key lists and threshold keys cannot authorize uploads"
      : "This account key cannot authorize uploads"
  );
  err.code = code;
  return err;
}

async function fetchAccountKey(accountId) {
  let data;
  try {
    const response = await fetch(`${MIRROR}/api/v1/accounts/${accountId}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const err = new Error("account lookup failed");
      err.code = "LOOKUP";
      throw err;
    }
    data = await response.json();
  } catch (err) {
    if (err && (err.code === "LOOKUP" || err.code === "COMPOUND_KEY" || err.code === "BAD_KEY")) throw err;
    const wrapped = new Error("account lookup failed");
    wrapped.code = "LOOKUP";
    throw wrapped;
  }
  const problem = accountKeyProblem(data && data.key);
  if (problem) throw accountKeyError(problem);
  return data.key;
}

async function hederaPublicKeyClass() {
  try {
    const { PublicKey } = await import("@hashgraph/sdk");
    return PublicKey;
  } catch {
    const missing = new Error("Hedera SDK is not installed");
    missing.code = "NO_SDK";
    throw missing;
  }
}

function publicKeyFromMirror(PublicKey, key) {
  const raw = Buffer.from(key.key, "hex");
  try {
    return key._type === "ED25519" ? PublicKey.fromBytesED25519(raw) : PublicKey.fromBytesECDSA(raw);
  } catch {
    throw accountKeyError("BAD_KEY");
  }
}

// HIP-820 prefixes the text before the wallet signs it. A wallet that signs
// the nonce on its own still matches the second buffer.
function signedNonceBodies(nonce) {
  return [
    Buffer.from(`\x19Hedera Signed Message:\n${nonce.length}${nonce}`, "utf8"),
    Buffer.from(nonce, "utf8"),
  ];
}

function signatureMatchesKey(pub, nonce, signature) {
  for (const message of signedNonceBodies(nonce)) {
    try {
      if (pub.verify(message, signature)) return true;
    } catch {
      /* this message did not verify */
    }
  }
  return false;
}

function uploadAuthError(res, err) {
  if (err && err.code === "COMPOUND_KEY") {
    return res.status(400).json({ ok: false, error: "Key lists and threshold keys cannot authorize uploads" });
  }
  if (err && err.code === "BAD_KEY") {
    return res.status(400).json({ ok: false, error: "This account key cannot authorize uploads" });
  }
  if (err && err.code === "NO_SDK") {
    console.error("upload auth failed:", err.message);
    return res.status(503).json({ ok: false, error: "Upload auth is not configured" });
  }
  if (!(err && err.code === "LOOKUP")) {
    console.error("upload auth failed:", err && err.message ? err.message : "verify error");
  }
  return res.status(401).json({ ok: false, error: "Upload check failed" });
}

app.get("/api/upload/challenge", publicPostLimit, (req, res) => {
  const nonce = issueUploadNonce();
  if (!nonce) {
    res.setHeader("Retry-After", "30");
    return res.status(503).json({ ok: false, error: "Too many upload checks, try again shortly" });
  }
  res.json({ ok: true, nonce });
});

app.post("/api/upload/auth", publicPostLimit, async (req, res) => {
  if (!uploadAuthConfigured()) {
    return res.status(503).json({ ok: false, error: "Upload auth is not configured" });
  }
  const accountId = req.body && req.body.accountId;
  const nonce = req.body && req.body.nonce;
  const signatureText = req.body && req.body.signature;
  if (typeof accountId !== "string" || !/^\d+\.\d+\.\d+$/.test(accountId)) {
    return res.status(400).json({ ok: false, error: "bad account" });
  }
  const signature = decodeSignature(signatureText);
  if (!signature) return res.status(400).json({ ok: false, error: "bad signature" });
  // Reject a key list before spending the nonce, so that account can retry
  // after the key changes. A bad signature still spends it.
  let pub;
  try {
    const key = await fetchAccountKey(accountId);
    pub = publicKeyFromMirror(await hederaPublicKeyClass(), key);
  } catch (err) {
    return uploadAuthError(res, err);
  }
  if (!takeUploadNonce(nonce)) return res.status(401).json({ ok: false, error: "Upload check expired" });
  if (!signatureMatchesKey(pub, nonce, signature)) {
    return res.status(401).json({ ok: false, error: "Upload check failed" });
  }
  res.json({ ok: true, token: issueUploadToken(accountId), expiresIn: 900 });
});

app.post("/api/upload", async (req, res) => {
  if (!r2) return res.status(503).json({ ok: false, error: "R2 not configured — set R2_* in server/.env" });
  let account = null;
  if (REQUIRE_UPLOAD_AUTH) {
    if (!uploadAuthConfigured()) {
      req.resume();
      return res.status(503).json({ ok: false, error: "Upload auth is not configured" });
    }
    account = accountFromUploadToken(req.headers["x-upload-token"]);
    if (!account) {
      req.resume();
      return res.status(401).json({ ok: false, error: "Upload authorization required" });
    }
  } else {
    account = requireAccount(req);
  }
  const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const ext = R2_MIME_EXT[type];
  if (!ext) return res.status(415).json({ ok: false, error: "Unsupported type — images and videos only" });
  const isVideo = type.startsWith("video/");
  const max = isVideo ? R2_MAX_VIDEO : R2_MAX_IMAGE;
  const lengthHeader = req.headers["content-length"];
  const declared = lengthHeader == null || lengthHeader === "" ? null : Number(lengthHeader);
  if (declared != null && (!Number.isFinite(declared) || declared < 0)) {
    req.resume();
    return res.status(400).json({ ok: false, error: "Bad upload" });
  }
  if (declared === 0) {
    req.resume();
    return res.status(400).json({ ok: false, error: "Empty file" });
  }
  if (declared != null && declared > max) {
    req.resume();
    return res.status(413).json({ ok: false, error: tooBigMessage(isVideo) });
  }
  if (uploadRequestLimited(req, res)) {
    req.resume();
    return;
  }
  if (!(await turnstileOk(req))) {
    req.resume();
    return res.status(403).json({ ok: false, error: "Turnstile check failed" });
  }
  const uploadIp = beginUpload(req, res);
  if (!uploadIp) {
    req.resume();
    return;
  }
  let released = false;
  const releaseSlot = () => {
    if (released) return;
    released = true;
    finishUpload(uploadIp);
  };
  // A dropped connection must free the slot even if the handler is still
  // inside the body read. A finished body keeps the slot until finally.
  req.on("aborted", releaseSlot);
  req.on("close", () => {
    if (req.aborted || !req.complete) releaseSlot();
  });
  try {
    const body = await readUploadBody(req, max);
    if (!body.length) return res.status(400).json({ ok: false, error: "Empty file" });
    if (!magicMatches(type, body)) {
      return res.status(415).json({ ok: false, error: "File contents do not match the declared type" });
    }
    if (!takeUploadSlot(req, res, account, body.length)) return;
    // New videos can carry their length in the object name. Images, and
    // videos with no usable duration, keep the original key shape.
    const seconds = isVideo
      ? resolvedUploadSeconds(ext, req.headers["x-media-duration"], body)
      : null;
    const key = uploadObjectKey(ext, seconds, Date.now(), Math.random().toString(36).slice(2, 8));
    try {
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: body,
          ContentType: type,
          // Each key is markers/<timestamp>-<random><ext> and is never overwritten.
          CacheControl: "public, max-age=31536000, immutable",
          // CORS comes from the bucket-level rule set at startup above —
          // per-object CORS on PutObject does not exist in S3/R2.
        })
      );
    } catch (err) {
      console.error("R2 upload failed:", err.message);
      if (!res.headersSent) res.status(502).json({ ok: false, error: "R2 upload failed" });
      return;
    }
    addUploadBytes(account, body.length);
    res.json({ ok: true, url: `${R2_PUBLIC_BASE}/${key}`, type });
  } catch (err) {
    if (res.headersSent) return;
    if (err && err.code === 413) return res.status(413).json({ ok: false, error: tooBigMessage(isVideo) });
    if (err && err.code === 408) {
      res.status(408).json({ ok: false, error: "Upload timed out" });
      res.on("finish", () => {
        if (!req.destroyed) req.destroy();
      });
      return;
    }
    res.status(400).json({ ok: false, error: "upload aborted" });
  } finally {
    releaseSlot();
  }
});

const isTopicId = (s) => typeof s === "string" && /^\d+\.\d+\.\d+$/.test(s);
backfillUserFollows();

function userFollowState(account, followee) {
  const counted = q.countUserFollowers.get(followee);
  const following = isTopicId(account) ? !!q.getUserFollow.get(account, followee) : false;
  return { ok: true, followers: counted ? Number(counted.n) || 0 : 0, following };
}

// app: "people are viewing this topic now" (chat panel Load)
app.post("/api/track", publicPostLimit, (req, res) => {
  const topic = req.body && req.body.topic;
  if (!isTopicId(topic)) return res.status(400).json({ ok: false, error: "bad topic" });
  q.upsertTopic.run(topic, Date.now());
  res.json({ ok: true });
});

// One view of one post. created is that message's ISO time. inc 1 adds a
// view; inc 0 only reads. The phone adds one the first time that browser
// opens the post. Later opens already have the number on the card.
app.post("/api/popup-view", publicPostLimit, (req, res) => {
  const topic = req.body && req.body.topic;
  const created = req.body && req.body.created;
  const inc = req.body && Number(req.body.inc) === 1 ? 1 : 0;
  if (!isTopicId(topic) || typeof created !== "string" || created.length > 40) {
    return res.status(400).json({ ok: false, error: "bad view" });
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(created)) {
    return res.status(400).json({ ok: false, error: "bad view" });
  }
  const ms = Date.parse(created);
  if (!Number.isFinite(ms) || ms < Date.parse("2019-01-01T00:00:00Z") || ms > Date.now() + 86400000) {
    return res.status(400).json({ ok: false, error: "bad view" });
  }
  if (!inc) {
    const row = q.getPopupView.get(topic, created);
    return res.json({ ok: true, views: row ? row.views : 0 });
  }
  const row = q.bumpPopupView.get(topic, created);
  res.json({ ok: true, views: row ? row.views : 1 });
});

// Topic names resolve from changeName messages (a scan of the topic).
// A name is cached for the process life. An empty name is cached only
// after the topic is fully mirrored and its memo is known, so a lookup
// that ran before the messages existed does not stick as "".
const topicNameCache = new Map();
function topicNameFor(topicId) {
  if (topicNameCache.has(topicId)) return topicNameCache.get(topicId);
  const name = getTopicName(topicId) || "";
  const topic = q.getTopic.get(topicId);
  const settled = topic && topic.backfilled && topic.memo !== null;
  if (name || settled) topicNameCache.set(topicId, name);
  return name;
}

// The message whose ISO time is `created`. ts is nanoseconds; the index
// narrows it to the millisecond the key carries.
function findPostRow(topic, created) {
  const ms = Date.parse(created);
  if (!Number.isFinite(ms)) return null;
  for (const r of q.msgsInWindow.all(
    topic,
    (ms / 1000 - 0.000001).toFixed(9),
    ((ms + 1) / 1000 + 0.000001).toFixed(9)
  )) {
    if (new Date(Number(r.ts) * 1000).toISOString() === created) return r;
  }
  return null;
}

// A shared pin can name a topic this cache has never stored. Pull it from
// the mirror until the post shows up, the topic is caught up, or the tick
// cap is hit. A second lookup waits for the pull already in progress.
const postPulls = new Map();
async function pullUntilPost(topic, created) {
  const running = postPulls.get(topic);
  if (running) {
    await running;
    return findPostRow(topic, created);
  }
  const run = (async () => {
    q.upsertTopic.run(topic, Date.now());
    const memoPromise = fetchTopicMemo(topic);
    let row = findPostRow(topic, created);
    const existing = q.getTopic.get(topic);
    if (!row && !(existing && existing.backfilled)) {
      for (let tick = 0; tick < 15 && !row; tick++) {
        const before = q.getTopic.get(topic);
        const beforeSeq = before ? before.last_seq : 0;
        await pollTopicLocked(topic);
        row = findPostRow(topic, created);
        const after = q.getTopic.get(topic);
        if (!after || after.backfilled || after.last_seq === beforeSeq) break;
      }
    }
    await memoPromise;
    return row;
  })();
  postPulls.set(topic, run);
  try {
    return await run;
  } finally {
    if (postPulls.get(topic) === run) postPulls.delete(topic);
  }
}

// The original post behind a shared pin. The pin carries the topic id and
// the post's ISO time. This rebuilds the card: body, topic name, views,
// hearts, comments, and how many accounts currently share it.
app.get("/api/post", publicPostLimit, async (req, res) => {
  const topic = req.query.topic;
  const created = req.query.created;
  const account = typeof req.query.account === "string" ? req.query.account : "";
  if (
    !isTopicId(topic) ||
    typeof created !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(created)
  ) {
    return res.status(400).json({ ok: false, error: "bad post" });
  }
  const ms = Date.parse(created);
  if (!Number.isFinite(ms)) return res.status(400).json({ ok: false, error: "bad post" });
  try {
    let row = findPostRow(topic, created);
    if (!row) row = await pullUntilPost(topic, created);
    if (!row) return res.json({ ok: true, found: false });
    let d;
    try {
      d = JSON.parse(row.body);
    } catch {
      return res.json({ ok: true, found: false });
    }
    const data = (d.marker && d.marker.data) || (d.polygon && d.polygon.data) || null;
    if (!data) return res.json({ ok: true, found: false });
    if (q.isDeletedPost.get(topic, new Date(created).toISOString(), row.payer)) {
      return res.json({ ok: true, found: false, deleted: true });
    }
    const reactions = markerReactions(topic, created);
    const viewRow = q.getPopupView.get(topic, created);
    const myLike = account ? q.getReaction.get(topic, formatMarkerKey(created), account) : null;
    const picture = sharePicture(topic, created, account);
    // Which comment nodes does this account have liked — one IN query.
    if (account) {
      const ckeys = new Set();
      const collect = (nodes) => {
        for (const n of nodes) {
          ckeys.add(n.created);
          collect(n.replies || []);
        }
      };
      collect(reactions.comments);
      if (ckeys.size > 0) {
        const ph = [...ckeys].map(() => "?").join(",");
        const liked = new Set(
          db
            .prepare(
              `SELECT target_key FROM reactions
               WHERE topic_id = ? AND payer = ? AND kind = 'like' AND target_key IN (${ph})`
            )
            .all(topic, account, ...ckeys)
            .map((r) => r.target_key)
        );
        const mark = (nodes) => {
          for (const n of nodes) {
            n.likedByMe = liked.has(n.created);
            mark(n.replies || []);
          }
        };
        mark(reactions.comments);
      }
    }
    res.json({
      ok: true,
      found: true,
      topic,
      created,
      kind: d.marker ? "marker" : "polygon",
      number: String(
        data.numberOfMarker != null
          ? data.numberOfMarker
          : data.numberOfPolygon != null
            ? data.numberOfPolygon
            : ""
      ),
      title: String(data.title || ""),
      image: data.image,
      coverimage: data.coverimage,
      msg: data.msg,
      payer: row.payer,
      topicName: topicNameFor(topic),
      views: viewRow ? viewRow.views : 0,
      likes: reactions.likeCount,
      likedByMe: !!(myLike && myLike.kind === "like"),
      shares: picture.shares,
      sharedByMe: picture.sharedByMe,
      comments: reactions.comments,
    });
  } catch (err) {
    console.error("post lookup failed", err && err.message);
    if (!res.headersSent) res.json({ ok: true, found: false });
  }
});

// Read the follower count. A follow field in the body is ignored.
// Rows change only when the mirror message is stored (extractFollow).
app.post("/api/topic-follow", publicPostLimit, (req, res) => {
  const topic = req.body && req.body.topic;
  const account = req.body && req.body.account;
  if (!isTopicId(topic)) return res.status(400).json({ ok: false, error: "bad topic" });
  const counted = q.countFollowers.get(topic);
  const following = isTopicId(account) ? !!q.getFollow.get(topic, account) : false;
  res.json({ ok: true, followers: counted ? Number(counted.n) || 0 : 0, following });
});

// Read the person-follower count. A follow field in the body is ignored.
// Rows change only when the mirror message on FOLLOW_TOPIC is stored
// (extractUserFollow).
app.get("/api/user-follow", rateLimit, (req, res) => {
  const followee = req.query.followee;
  if (!isTopicId(followee)) return res.status(400).json({ ok: false, error: "bad account" });
  res.json(userFollowState(req.query.account, followee));
});

app.post("/api/user-follow", rateLimit, (req, res) => {
  const account = req.body && req.body.account;
  const followee = req.body && req.body.followee;
  if (!isTopicId(followee)) return res.status(400).json({ ok: false, error: "bad account" });
  res.json(userFollowState(account, followee));
});

app.get("/api/following", publicPostLimit, (req, res) => {
  const account = req.query.account;
  if (!isTopicId(account)) return res.status(400).json({ ok: false, error: "bad account" });
  const following = q.listUserFollowing.all(account).map((row) => row.followee).slice(0, 500);
  const accounts = q.listUserFollowingDetail.all(account).map((row) => ({
    id: row.id,
    username: row.username || "",
    avatar: row.avatar || "",
  }));
  const topics = q.listTopicFollowing.all(account).map((row) => ({
    id: row.topic_id,
    name: topicNameFor(row.topic_id) || "",
  }));
  res.json({ ok: true, following, accounts, topics });
});

// Newest messages from accounts this person follows. Any tracked topic.
app.get("/api/following-feed", rateLimit, (req, res) => {
  const account = req.query.account;
  if (!isTopicId(account)) return res.status(400).json({ ok: false, error: "bad account" });
  const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 50)));
  const messages = q.followingFeed.all(account, limit).map((row) => ({
    ...toAppMessage(row),
    topic: row.topic_id,
  }));
  res.json({ ok: true, messages });
});

// app: "I just sent this message" (after the wallet confirms) → stored as
// PENDING so every viewer sees it instantly; the poller — or a mirror row
// that was already stored — confirms it. Unconfirmed rows expire in 10 min.
app.post("/api/submit", publicPostLimit, (req, res) => {
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
// The draw form is shorter. These caps stop an oversized API body.
const MARKER_TITLE_MAX = 120;
const MARKER_MSG_MAX = 2000;

function markerTextError(value, max, tooLong) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "bad marker";
  if (value.length > max) return tooLong;
  return null;
}

app.post("/api/marker", publicPostLimit, (req, res) => {
  const { topic, cord, title, image, msg, payer, number } = req.body || {};
  if (!isTopicId(topic) || typeof cord !== "string") {
    return res.status(400).json({ ok: false, error: "bad marker" });
  }
  const titleError = markerTextError(title, MARKER_TITLE_MAX, "title is too long");
  if (titleError) return res.status(400).json({ ok: false, error: titleError });
  const msgError = markerTextError(msg, MARKER_MSG_MAX, "message is too long");
  if (msgError) return res.status(400).json({ ok: false, error: msgError });
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
app.get("/api/local", publicPostLimit, (req, res) => {
  const country = String(req.query.country || "").trim();
  if (!country) return res.json({ ok: true, markers: [] });
  const rows = q.listLiveByCountry.all(country, Date.now() - LIVE_TTL_MS);
  // Resolve each distinct topic's name (empty while the topic is still
  // backfilling) and keep the topic warm so the poller finishes the job.
  const names = new Map();
  const viewMaps = new Map();
  for (const r of rows) {
    q.upsertTopic.run(r.topic, Date.now());
    if (!names.has(r.topic)) {
      names.set(r.topic, getTopicName(r.topic));
      fetchTopicMemo(r.topic);
      const counts = new Map();
      for (const view of q.listPopupViews.all(r.topic)) counts.set(view.created, view.views);
      viewMaps.set(r.topic, counts);
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
        views: idx && idx.created ? ((viewMaps.get(r.topic) || new Map()).get(idx.created) || 0) : 0,
      };
    }),
  });
});

// app: "give me the current per-account settings" — one row per user
// (latest valid username / profile pic / click2url / bio). `ready` is true
// only once all four profile topics are backfilled, so the app never trusts
// a half-built table.
function userSettingPayload(row) {
  return {
    accountId: row.account_id,
    username: row.username || "",
    profilePic: row.profile_pic || "",
    click2url: row.click2url || "",
    bio: row.bio || "",
    topic: row.topic || "",
    updatedAt: row.updated_at || 0,
  };
}

app.get("/api/user-settings", publicPostLimit, (req, res) => {
  const ready = Object.keys(PROFILE_TOPICS).every((id) => {
    const t = q.getTopic.get(id);
    return t && t.backfilled === 1;
  });
  const generation = (q.readSettingsGeneration.get() || {}).generation || "";
  const revision = (q.readSettingsRevision.get() || {}).revision || 0;
  const after = Math.max(0, Math.floor(Number(req.query.after_rev) || 0));
  const clientGen = String(req.query.generation || "");
  // A phone with a different database id, or no saved copy, gets every
  // current card. Otherwise only accounts written after the revision it has.
  const full = clientGen !== generation || !(after > 0);
  const rows = full ? q.listUserSettings.all() : q.settingsSince.all(after);
  res.json({
    ready,
    generation,
    revision,
    settings: rows.map(userSettingPayload),
  });
});

// app: history (latest N below before_seq) or live tail (rows after after_seq)
app.get("/api/messages", publicPostLimit, (req, res) => {
  const topic = req.query.topic;
  if (!isTopicId(topic)) return res.json({ ready: false, messages: [] });
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
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

  // Counts travel with the messages, so a popup can show its number the
  // moment it is built. One row per post that has been opened.
  const views = {};
  for (const view of q.listPopupViews.all(topic)) views[view.created] = view.views;
  res.json({
    ready,
    messages: [...rows.map(toAppMessage), ...pend.map(pendingToAppMessage)],
    views,
  });
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

app.get("/api/stream", publicPostLimit, (req, res) => {
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

app.get("/api/hashtags", rateLimit, (req, res) => {
  const tag = String(req.query.tag || "").trim().toLowerCase().replace(/^#/, "");
  if (!/^[\p{L}_][\p{L}\p{N}_]{0,49}$/u.test(tag)) return res.json({ ok: true, posts: [] });
  res.json({ ok: true, posts: q.searchHashtags.all(tag) });
});

// ICE servers for peer connections. The Metered key stays on the server.
// METERED_TURN_URL is the credentials endpoint without the query string.
app.get("/api/turn", publicPostLimit, async (req, res) => {
  const key = process.env.METERED_API_KEY || "";
  const base = String(process.env.METERED_TURN_URL || "").trim().replace(/\/+$/, "");
  if (!key || !base) return res.status(503).json({ ok: false, iceServers: [] });
  try {
    const response = await fetch(`${base}?apiKey=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.status(502).json({ ok: false, iceServers: [] });
    const data = await response.json();
    const iceServers = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.iceServers) ? data.iceServers : []);
    res.json({ ok: true, iceServers });
  } catch {
    if (!res.headersSent) res.status(502).json({ ok: false, iceServers: [] });
  }
});

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

const server = app.listen(PORT, "0.0.0.0", () => {
  const serving = fs.existsSync(distDir) ? ", serving dist" : "";
  console.log(`topic backend on :${PORT} (mirror: ${MIRROR})${serving}`);
});
// The whole request, including a slow body. headersTimeout must stay above
// requestTimeout or Node closes the socket on the shorter header timer.
server.requestTimeout = 120000;
server.headersTimeout = 121000;
