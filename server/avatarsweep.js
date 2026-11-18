// Profile picture thumbnails nobody asked for in AVATAR_SWEEP_UNUSED_MS are
// deleted from R2 (avatars/v<n>/, server/avatar.js). One is made again the
// next time it is asked for.
//
// A sweep, not an R2 lifecycle rule: a lifecycle rule only knows when an
// object was uploaded, so it would also delete thumbnails asked for every
// day. Here each thumbnail answered writes its time (createAvatarSeen, at
// most once per AVATAR_SEEN_EVERY_MS per thumbnail, in the avatar_seen
// table of server/index.js), and a key is deleted once the latest of its
// last request, its upload, and the time this server began counting
// (since) is older than AVATAR_SWEEP_UNUSED_MS. So nothing is deleted
// before the counting has run that long, after a first start or a wiped
// database.
//
// Only keys of a thumbnail's own shape under AVATAR_SWEEP_PREFIX are ever
// listed or deleted; uploads (markers/) and anything else in the bucket
// are never touched. First run AVATAR_SWEEP_START_MS after start, then every
// AVATAR_SWEEP_EVERY_MS, one at a time.
//
// The browser keeps a thumbnail for a year, so "asked for" is a phone that
// had not drawn it yet.

import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { AVATAR_VERSION } from "../avatarsrc.js";

export const AVATAR_SWEEP_UNUSED_MS = 90 * 24 * 60 * 60 * 1000;
export const AVATAR_SEEN_EVERY_MS = 24 * 60 * 60 * 1000;
export const AVATAR_SWEEP_START_MS = 5 * 60 * 1000;
export const AVATAR_SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
export const AVATAR_SWEEP_PREFIX = `avatars/v${AVATAR_VERSION}/`;
const SEEN_MEMORY_MAX = 20000;

// avatarKey's shape (server/avatar.js), nothing else.
export function isAvatarThumbKey(key) {
  return typeof key === "string" && key.startsWith(AVATAR_SWEEP_PREFIX) && /^avatars\/v\d+\/[0-9a-f]{64}\.webp$/.test(key);
}

// The keys to delete. objects: [{ key, modifiedMs }] as listed; lastSeen(key):
// its last request in ms, or nothing; since: when counting began. Without
// a usable since nothing is deleted.
export function planAvatarSweep(objects, lastSeen, { now, since, unusedMs = AVATAR_SWEEP_UNUSED_MS } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(since)) return [];
  const cutoff = now - unusedMs;
  if (since > cutoff) return [];
  const doomed = [];
  for (const item of objects || []) {
    if (!item || !isAvatarThumbKey(item.key)) continue;
    const seen = Number(lastSeen(item.key)) || 0;
    const modified = Number(item.modifiedMs) || 0;
    if (Math.max(seen, modified, since) < cutoff) doomed.push(item.key);
  }
  return doomed;
}

// seen(key) for getAvatarThumb: write(key, at) at most once per everyMs
// per thumbnail. Remembered in memory (a restart writes each once more).
export function createAvatarSeen({ write, now = Date.now, everyMs = AVATAR_SEEN_EVERY_MS } = {}) {
  const written = new Map();
  return function seen(key) {
    if (!isAvatarThumbKey(key)) return;
    const at = now();
    const last = written.get(key);
    if (last !== undefined && at - last < everyMs) return;
    write(key, at);
    written.delete(key);
    written.set(key, at);
    if (written.size > SEEN_MEMORY_MAX) written.delete(written.keys().next().value);
  };
}

// Every thumbnail under the prefix, page by page.
export async function listAvatarThumbs(s3, bucket, prefix = AVATAR_SWEEP_PREFIX) {
  const objects = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const item of page.Contents || []) {
      if (!isAvatarThumbKey(item.Key)) continue;
      objects.push({ key: item.Key, modifiedMs: item.LastModified ? new Date(item.LastModified).getTime() : 0 });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

export async function deleteAvatarThumb(s3, bucket, key) {
  if (!isAvatarThumbKey(key)) throw new Error("not a thumbnail key");
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// One sweep. deps: list(), remove(key), lastSeen(key), since, and
// forgetBefore(cutoff), which drops request times older than the cutoff
// (their thumbnails were just deleted, or are gone).
export async function runAvatarSweep({
  list,
  remove,
  lastSeen,
  forgetBefore = null,
  since,
  now = Date.now,
  unusedMs = AVATAR_SWEEP_UNUSED_MS,
  log = (line) => console.log(line),
}) {
  const at = now();
  const objects = await list();
  const doomed = planAvatarSweep(objects, lastSeen, { now: at, since, unusedMs });
  let deleted = 0;
  let failed = 0;
  for (const key of doomed) {
    try {
      await remove(key);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  if (typeof forgetBefore === "function" && since <= at - unusedMs) forgetBefore(at - unusedMs);
  log(`avatar sweep: ${objects.length} thumbnails, deleted ${deleted}` + (failed ? `, ${failed} failed` : ""));
  return { listed: objects.length, deleted, failed };
}

// Production: first sweep startMs after start, then every everyMs. A sweep
// still running is not started again; a failed one is logged.
export function startAvatarSweep(deps, { startMs = AVATAR_SWEEP_START_MS, everyMs = AVATAR_SWEEP_EVERY_MS } = {}) {
  let running = false;
  const once = async () => {
    if (running) return;
    running = true;
    try {
      await runAvatarSweep(deps);
    } catch (err) {
      console.error("avatar sweep failed:", err && err.message);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(once, startMs);
  const every = setInterval(once, everyMs);
  if (typeof first.unref === "function") first.unref();
  if (typeof every.unref === "function") every.unref();
  return { once, stop: () => { clearTimeout(first); clearInterval(every); } };
}
