// Nightly copy of the SQLite cache into the existing R2 bucket.
// A consistent snapshot (node:sqlite backup), gzipped, then AES-256-GCM.
// The object name is backups/<BACKUP_PREFIX>/db-YYYY-MM-DD.sqlite.gz.enc.
// The prefix and the encryption key are never written to the log.
// Both must be set or this does nothing, so a local run with no keys is unchanged.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { DatabaseSync, backup } from "node:sqlite";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const DAY_MS = 24 * 60 * 60 * 1000;
const START_DELAY_MS = 2 * 60 * 1000;
const KEY_NAME = /^db-(\d{4}-\d{2}-\d{2})\.sqlite\.gz\.enc$/;

function positiveInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

export function backupEnabled() {
  return !!(String(process.env.BACKUP_ENCRYPTION_KEY || "").trim() && String(process.env.BACKUP_PREFIX || "").trim());
}

export function encryptionKeyFromHex(hex) {
  const text = String(hex || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(text)) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be 64 hex characters");
  }
  return Buffer.from(text, "hex");
}

export function assertBackupPrefix(prefix) {
  const text = String(prefix || "").trim();
  if (!/^[A-Za-z0-9_-]{16,}$/.test(text)) {
    throw new Error("BACKUP_PREFIX must be a long random token");
  }
  return text;
}

export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function dayNumber(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  return Date.parse(`${date}T00:00:00Z`);
}

export function backupObjectKey(prefix, date) {
  const safe = assertBackupPrefix(prefix);
  if (!Number.isFinite(dayNumber(date))) throw new Error("bad backup date");
  return `backups/${safe}/db-${date}.sqlite.gz.enc`;
}

// Keep the newest BACKUP_KEEP_DAYS dates, including today. A file dated
// before that window is old.
export function backupDateExpired(date, today, keepDays) {
  const file = dayNumber(date);
  const start = dayNumber(today);
  const days = positiveInt(keepDays, 14);
  if (!Number.isFinite(file) || !Number.isFinite(start)) return false;
  return file < start - (days - 1) * DAY_MS;
}

export function backupDateFromKey(objectKey, prefix) {
  const safe = assertBackupPrefix(prefix);
  const lead = `backups/${safe}/`;
  if (!objectKey.startsWith(lead)) return null;
  const match = KEY_NAME.exec(objectKey.slice(lead.length));
  return match ? match[1] : null;
}

function scrub(err) {
  let message = err && err.message ? String(err.message) : "backup failed";
  for (const secret of [process.env.BACKUP_PREFIX, process.env.BACKUP_ENCRYPTION_KEY]) {
    const text = String(secret || "").trim();
    if (text.length >= 8) message = message.split(text).join("[redacted]");
  }
  return message.slice(0, 300);
}

export function r2ClientFromEnv() {
  const account = process.env.R2_ACCOUNT_ID;
  const access = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!account || !access || !secret || !bucket) {
    throw new Error("R2 is not configured");
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: access, secretAccessKey: secret },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return { client, bucket };
}

// Hot snapshot. The destination is a new file. The live database is not copied.
export async function snapshotDatabase(dbPath, destPath) {
  if (!fs.existsSync(dbPath)) throw new Error("database file is missing");
  await fs.promises.rm(destPath, { force: true });
  const source = new DatabaseSync(dbPath, { timeout: 10000 });
  try {
    await backup(source, destPath);
  } finally {
    source.close();
  }
}

// Layout: 12-byte IV, gzipped snapshot encrypted with AES-256-GCM, 16-byte tag.
export async function encryptGzipFile(srcPath, destPath, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const bodyPath = `${destPath}.body`;
  try {
    await pipeline(
      fs.createReadStream(srcPath),
      zlib.createGzip(),
      cipher,
      fs.createWriteStream(bodyPath)
    );
    const tag = cipher.getAuthTag();
    await pipeline(async function* parts() {
      yield iv;
      yield* fs.createReadStream(bodyPath);
      yield tag;
    }, fs.createWriteStream(destPath));
  } finally {
    await fs.promises.rm(bodyPath, { force: true });
  }
}

export async function decryptGunzipFile(srcPath, destPath, key) {
  const stat = await fs.promises.stat(srcPath);
  if (stat.size < IV_LENGTH + TAG_LENGTH + 1) throw new Error("backup file is not valid");
  const fh = await fs.promises.open(srcPath, "r");
  let iv;
  let tag;
  try {
    iv = Buffer.alloc(IV_LENGTH);
    tag = Buffer.alloc(TAG_LENGTH);
    await fh.read(iv, 0, IV_LENGTH, 0);
    await fh.read(tag, 0, TAG_LENGTH, stat.size - TAG_LENGTH);
  } finally {
    await fh.close();
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(srcPath, { start: IV_LENGTH, end: stat.size - TAG_LENGTH - 1 }),
      decipher,
      zlib.createGunzip(),
      fs.createWriteStream(destPath)
    );
  } catch (err) {
    await fs.promises.rm(destPath, { force: true });
    const code = err && err.code ? String(err.code) : "";
    const message = err && err.message ? String(err.message) : "";
    if (
      code.startsWith("ERR_OSSL") ||
      code.startsWith("Z_") ||
      /authenticate|unsupported state|bad decrypt/i.test(message)
    ) {
      throw new Error("backup file is not valid");
    }
    throw err;
  }
}

async function objectExists(client, bucket, objectKey) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    return true;
  } catch (err) {
    const status = err && err.$metadata && err.$metadata.httpStatusCode;
    const name = err && err.name ? err.name : "";
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
    throw err;
  }
}

async function putFile(client, bucket, objectKey, filePath) {
  const size = (await fs.promises.stat(filePath)).size;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: fs.createReadStream(filePath),
    ContentLength: size,
    ContentType: "application/octet-stream",
  }));
}

async function listKeys(client, bucket, prefix) {
  const found = [];
  let token;
  const lead = `backups/${prefix}/`;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: lead,
      ContinuationToken: token,
    }));
    for (const item of page.Contents || []) {
      if (item && item.Key) found.push(item.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return found;
}

export async function pruneOldBackups(client, bucket, prefix, keepDays, today) {
  const safe = assertBackupPrefix(prefix);
  const keys = await listKeys(client, bucket, safe);
  let removed = 0;
  for (const objectKey of keys) {
    const date = backupDateFromKey(objectKey, safe);
    if (!date || !backupDateExpired(date, today, keepDays)) continue;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    removed += 1;
  }
  return removed;
}

async function downloadObject(client, bucket, objectKey, destPath) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!response.Body) throw new Error("backup download was empty");
  await pipeline(response.Body, fs.createWriteStream(destPath));
}

// Upload today's snapshot when it is not already stored, then drop older days.
// Returns { skipped: true } when the backup env is unset.
export async function runBackup({ r2, bucket, dbPath, now = new Date() } = {}) {
  const keyHex = String(process.env.BACKUP_ENCRYPTION_KEY || "").trim();
  const prefix = String(process.env.BACKUP_PREFIX || "").trim();
  if (!keyHex || !prefix) return { skipped: true };
  if (!r2 || !bucket) throw new Error("R2 is not configured");
  const key = encryptionKeyFromHex(keyHex);
  const safePrefix = assertBackupPrefix(prefix);
  const keepDays = positiveInt(process.env.BACKUP_KEEP_DAYS, 14);
  const date = utcDay(now);
  const objectKey = backupObjectKey(safePrefix, date);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sbs-backup-"));
  try {
    const exists = await objectExists(r2, bucket, objectKey);
    if (!exists) {
      const snap = path.join(dir, "snap.sqlite");
      const enc = path.join(dir, "snap.enc");
      await snapshotDatabase(dbPath, snap);
      await encryptGzipFile(snap, enc, key);
      await putFile(r2, bucket, objectKey, enc);
      console.log(`sqlite backup uploaded for ${date}`);
    }
    const removed = await pruneOldBackups(r2, bucket, safePrefix, keepDays, date);
    if (removed > 0) console.log(`old sqlite backups removed: ${removed}`);
    return { skipped: false, uploaded: !exists, date };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

export async function restoreBackup({ r2, bucket, objectKey, destPath, keyHex } = {}) {
  if (!r2 || !bucket) throw new Error("R2 is not configured");
  if (!objectKey || typeof objectKey !== "string") throw new Error("backup key is missing");
  if (!destPath) throw new Error("output path is missing");
  if (fs.existsSync(destPath)) throw new Error("output path already exists");
  const key = encryptionKeyFromHex(keyHex || process.env.BACKUP_ENCRYPTION_KEY);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sbs-restore-"));
  const enc = path.join(dir, "download.enc");
  try {
    await downloadObject(r2, bucket, objectKey, enc);
    await decryptGunzipFile(enc, destPath, key);
  } catch (err) {
    await fs.promises.rm(destPath, { force: true });
    throw err;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

export function startBackupSchedule({ r2, bucket, dbPath } = {}) {
  if (!backupEnabled()) return;
  try {
    encryptionKeyFromHex(process.env.BACKUP_ENCRYPTION_KEY);
    assertBackupPrefix(process.env.BACKUP_PREFIX);
    if (!r2 || !bucket) throw new Error("R2 is not configured");
    if (!dbPath) throw new Error("database file is missing");
  } catch (err) {
    console.warn(`sqlite backup failed: ${scrub(err)}`);
    return;
  }
  const tick = () => {
    runBackup({ r2, bucket, dbPath }).catch((err) => {
      console.warn(`sqlite backup failed: ${scrub(err)}`);
    });
  };
  const first = setTimeout(() => {
    tick();
    const daily = setInterval(tick, DAY_MS);
    if (typeof daily.unref === "function") daily.unref();
  }, START_DELAY_MS);
  if (typeof first.unref === "function") first.unref();
}
