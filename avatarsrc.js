// avatarsrc.js — profile pictures are drawn from a small thumbnail our
// server makes once (server/avatar.js), not from the file the account
// linked, which can be a 4000 px photo or an 800 px GIF:
//
//   GET /api/avatar.webp?src=<source>&v=<AVATAR_VERSION>
//
// avatarSrc(url) is the one call every place that draws a profile picture
// makes. Post media, covers and full-screen views never use it.
//
// <source> is one spelling per picture (avatarSource), so the server makes
// one thumbnail whatever link points at it: a Hashinal is hcs://1/<id>
// (hcs://, a Kiloscribe link, or our /api/hcs1/<id>), an IPFS file is
// ipfs://<cid>/<path> (any gateway), and any other http(s) link is itself.
//
// The path ends in .webp and src is never last, so mediaurl.js reads the
// thumbnail as a still (no GIF check, no skeleton) even when the source's
// own name ends in .gif. v names the recipe: a new one makes new thumbnails.
//
// Left as they are: data: and blob: pictures made on this device, videos
// (a GIF avatar uploaded before is a muted loop and keeps playing), other
// files on this site, and anything that is not an http(s), ipfs or hcs
// link. A thumbnail that fails to load falls back to the original
// (loopmedia.js, avatarOriginal), then to the default avatar.
//
// No DOM at import: the server reads avatarSource from here too.

import { hashinalTopicOf, resolveHashinalSrc } from "./hashinalurl.js";
import { ipfsCanonical } from "./ipfsimage.js";
import { isVideoUrl } from "./mediaurl.js";

export const AVATAR_PATH = "/api/avatar.webp";
export const AVATAR_VERSION = "1";
export const AVATAR_SOURCE_MAX = 2048;
const ORIGINALS_MAX = 2000;

// Thumbnail address -> the link it was made from, so a failed thumbnail
// falls back to exactly what the page would have drawn.
const originals = new Map();

function origin() {
  return typeof location !== "undefined" && location && location.origin && location.origin !== "null"
    ? location.origin
    : "";
}

function parseAny(url) {
  try {
    return new URL(url, "http://avatar.invalid");
  } catch {
    return null;
  }
}

// An address of our thumbnail route (any origin, or relative).
export function isAvatarThumb(url) {
  if (typeof url !== "string" || !url) return false;
  const parsed = parseAny(url.trim());
  return !!(parsed && parsed.pathname === AVATAR_PATH && parsed.searchParams.get("src"));
}

function thumbSource(url) {
  const parsed = parseAny(String(url || "").trim());
  return (parsed && parsed.searchParams.get("src")) || "";
}

// The one spelling of a picture the thumbnail is made from, or "" when
// this link is not one to make a thumbnail of.
export function avatarSource(url) {
  if (typeof url !== "string") return "";
  let text = url.trim();
  if (isAvatarThumb(text)) text = thumbSource(text).trim();
  if (!text || text.length > AVATAR_SOURCE_MAX) return "";
  const topic = hashinalTopicOf(resolveHashinalSrc(text));
  if (topic) return `hcs://1/${topic}`;
  if (isVideoUrl(text)) return "";
  const ipfs = ipfsCanonical(text);
  if (ipfs) return isVideoUrl(ipfs) ? "" : ipfs;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  if (parsed.username || parsed.password) return "";
  parsed.hash = "";
  return parsed.href.length > AVATAR_SOURCE_MAX ? "" : parsed.href;
}

// The address to draw a profile picture from: our thumbnail, or url
// itself when it is not one to make a thumbnail of. Safe to call twice.
export function avatarSrc(url) {
  if (typeof url !== "string") return url;
  if (isAvatarThumb(url)) return url;
  const source = avatarSource(url);
  if (!source) return url;
  if (/^https?:/i.test(source)) {
    const here = origin();
    if (here && new URL(source).origin === here) return url;
  }
  const thumb = `${origin()}${AVATAR_PATH}?src=${encodeURIComponent(source)}&v=${AVATAR_VERSION}`;
  if (!originals.has(thumb)) {
    originals.set(thumb, url.trim());
    if (originals.size > ORIGINALS_MAX) originals.delete(originals.keys().next().value);
  }
  return thumb;
}

// What a thumbnail that failed to load falls back to: the link it was made
// from, or its source read as a link the page can load.
export function avatarOriginal(thumb) {
  if (!isAvatarThumb(thumb)) return "";
  const known = originals.get(String(thumb).trim());
  if (known) return resolveHashinalSrc(known);
  const source = avatarSource(thumbSource(thumb));
  if (!source) return "";
  return source.startsWith("hcs://") ? resolveHashinalSrc(source) : source;
}
