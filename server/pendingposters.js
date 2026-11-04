import crypto from "node:crypto";
import { uploadSecretOk } from "./uploadtoken.js";

// A device-converted GIF uploads the video, then its first-frame JPEG.
// The poster may follow for two minutes, once, from the same account,
// and only onto that object. exp equal to now is still valid.
// The uploader account is not written to disk. A later edit proves itself
// with an HMAC over the poster key, the account, and the UTC day it was
// issued, then arms this same hold. The token is "<issuedDay>.<hmac>".
// Nothing about the edit is stored. A day more than 7 behind today, a
// future day, or a malformed token does not match.

export const POSTER_WAIT_MS = 2 * 60 * 1000;
export const POSTER_EDIT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function posterEditDay(now) {
  const at = typeof now === "number" ? now : Number(now);
  if (!Number.isFinite(at)) return null;
  const day = Math.floor(at / DAY_MS);
  if (!Number.isSafeInteger(day) || day < 0) return null;
  return day;
}

function posterEditDigest(posterKey, account, issuedDay, uploadSecret) {
  const key = String(posterKey || "");
  const who = posterAccount(account);
  const day = Number(issuedDay);
  if (!key || !who || !Number.isSafeInteger(day) || day < 0 || !uploadSecretOk(uploadSecret)) return null;
  return crypto.createHmac("sha256", posterEditSecret(uploadSecret))
    .update(`${key}\n${who}\n${day}`)
    .digest();
}

// Stateless. The account is not inside the token. issuedDay is the UTC
// day count, so a later check needs no stored row.
export function issuePosterEdit(videoKey, account, uploadSecret, now = Date.now()) {
  const day = posterEditDay(now);
  if (day == null) return "";
  const digest = posterEditDigest(posterKeyForVideo(videoKey), account, day, uploadSecret);
  return digest ? `${day}.${digest.toString("base64url")}` : "";
}

export function posterEditMatches(posterKey, account, token, uploadSecret, now = Date.now()) {
  const today = posterEditDay(now);
  if (today == null) return false;
  const raw = typeof token === "string" ? token.trim() : "";
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot !== raw.lastIndexOf(".")) return false;
  const dayText = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!/^[0-9]{1,16}$/.test(dayText) || (dayText.length > 1 && dayText.startsWith("0"))) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(mac)) return false;
  const issuedDay = Number(dayText);
  if (!Number.isSafeInteger(issuedDay) || issuedDay > today || today - issuedDay > POSTER_EDIT_DAYS) return false;
  const expected = posterEditDigest(posterKey, account, issuedDay, uploadSecret);
  if (!expected) return false;
  const given = Buffer.from(mac, "base64url");
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
