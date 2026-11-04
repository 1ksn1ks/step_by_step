import crypto from "node:crypto";
import { uploadSecretOk } from "./uploadtoken.js";

// A device-converted GIF uploads the video, then its first-frame JPEG.
// The poster may follow for two minutes, once, from the same account,
// and only onto that object. exp equal to now is still valid.
// The uploader account is not written to disk. A later edit proves itself
// with an HMAC over the poster key and the account, then arms this same hold.

export const POSTER_WAIT_MS = 2 * 60 * 1000;

function posterAccount(account) {
  return typeof account === "string" ? account : "";
}

export function posterKeyForVideo(videoKey) {
  const posterKey = String(videoKey || "").replace(/\.(mp4|webm)$/i, ".poster.jpg");
  if (!posterKey || posterKey === videoKey) return "";
  return posterKey;
}

// Separate from the upload-token key so one secret cannot mint the other.
function posterEditSecret(uploadSecret) {
  return crypto.createHmac("sha256", String(uploadSecret)).update("poster-edit").digest();
}

function posterEditDigest(posterKey, account, uploadSecret) {
  const key = String(posterKey || "");
  const who = posterAccount(account);
  if (!key || !who || !uploadSecretOk(uploadSecret)) return null;
  return crypto.createHmac("sha256", posterEditSecret(uploadSecret))
    .update(`${key}\n${who}`)
    .digest();
}

// Stateless. The token is the HMAC only, so the account is not inside it.
export function issuePosterEdit(videoKey, account, uploadSecret) {
  const digest = posterEditDigest(posterKeyForVideo(videoKey), account, uploadSecret);
  return digest ? digest.toString("base64url") : "";
}

export function posterEditMatches(posterKey, account, token, uploadSecret) {
  const expected = posterEditDigest(posterKey, account, uploadSecret);
  if (!expected) return false;
  const raw = typeof token === "string" ? token.trim() : "";
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return false;
  const given = Buffer.from(raw, "base64url");
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

export function createPendingPosters(nowFn = Date.now) {
  const pendingPosters = new Map();
  const now = () => nowFn();

  function hold(posterKey, account) {
    pendingPosters.set(posterKey, {
      exp: now() + POSTER_WAIT_MS,
      account: posterAccount(account),
    });
  }

  function note(videoKey, account) {
    const posterKey = posterKeyForVideo(videoKey);
    if (!posterKey) return;
    hold(posterKey, account);
  }

  // The route already checked the poster-edit HMAC for this account.
  function arm(posterKey, account) {
    const key = String(posterKey || "");
    const who = posterAccount(account);
    if (!key || !who) return false;
    hold(key, who);
    return true;
  }

  function live(key, account) {
    const entry = pendingPosters.get(key);
    const exp = entry && typeof entry.exp === "number" ? entry.exp : 0;
    if (!entry || exp < now()) {
      if (entry) pendingPosters.delete(key);
      return false;
    }
    return entry.account === posterAccount(account);
  }

  function consume(key, account) {
    if (!live(key, account)) return false;
    pendingPosters.delete(key);
    return true;
  }

  // The JPEG put failed after the slot was taken. The same account may retry.
  function restore(posterKey, account) {
    if (!posterKey) return;
    hold(posterKey, account);
  }

  function sweep(at = now()) {
    for (const [key, entry] of pendingPosters) {
      const exp = entry && entry.exp;
      if (typeof exp !== "number" || exp < at) pendingPosters.delete(key);
    }
  }

  function size() {
    return pendingPosters.size;
  }

  return { note, live, consume, restore, sweep, size, arm };
}
