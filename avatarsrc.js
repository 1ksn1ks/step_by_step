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
// What failed is remembered, so a redraw never asks for it again:
// - A thumbnail that failed: its source, for AVATAR_FAIL_MS (as long as the
//   server remembers a miss). avatarSrc hands out the original instead,
//   and a draw of the thumbnail address paints the original (avatarDraw).
// - An original that failed too: its source, as long. A draw then loads
//   nothing and goes straight to the element's own error path, the
//   default avatar (loopmedia.js).
// - The route: AVATAR_ROUTE_FAILS different thumbnails failing within
//   AVATAR_ROUTE_WINDOW_MS make one check, the last of them fetched once
//   (an error answer comes from the browser cache). An answer that is not
//   our route's own miss (a network error, 429, 5xx, a page instead of a
//   picture: the route is missing or down) turns thumbnails off for
//   AVATAR_ROUTE_OFF_MS, originals everywhere. Then one check again before
//   they come back.
//
// No DOM at import: the server reads avatarSource from here too.

import { hashinalTopicOf, resolveHashinalSrc } from "./hashinalurl.js";
import { ipfsCanonical } from "./ipfsimage.js";
import { isVideoUrl } from "./mediaurl.js";

export const AVATAR_PATH = "/api/avatar.webp";
export const AVATAR_VERSION = "1";
export const AVATAR_SOURCE_MAX = 2048;
export const AVATAR_FAIL_MS = 10 * 60 * 1000;
export const AVATAR_ROUTE_FAILS = 3;
export const AVATAR_ROUTE_WINDOW_MS = 60 * 1000;
export const AVATAR_ROUTE_OFF_MS = 5 * 60 * 1000;
const ORIGINALS_MAX = 2000;
const FAILED_MAX = 2000;

// Thumbnail address -> the link it was made from, so a failed thumbnail
// falls back to exactly what the page would have drawn.
const originals = new Map();

// What failed, by source -> until (see the top of this file).
const failedThumbs = new Map();
const deadOriginals = new Map();
const route = { off: false, until: 0, checking: 0, sample: "", streak: new Map() };
let routeToken = 0;
let clock = () => Date.now();
let routeCheck = fetchRouteCheck;

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

function thumbFor(source) {
  return `${origin()}${AVATAR_PATH}?src=${encodeURIComponent(source)}&v=${AVATAR_VERSION}`;
}

// The thumbnail address of a picture whatever failed, or url itself when
// it is not one to make a thumbnail of: the file this phone keeps
// (picturecache.js), so an outage never empties that cache. Drawing uses
// avatarSrc.
export function avatarThumbSrc(url) {
  if (typeof url !== "string") return url;
  if (isAvatarThumb(url)) return url;
  const source = avatarSource(url);
  if (!source) return url;
  if (/^https?:/i.test(source)) {
    const here = origin();
    if (here && new URL(source).origin === here) return url;
  }
  const thumb = thumbFor(source);
  if (!originals.has(thumb)) {
    originals.set(thumb, url.trim());
    if (originals.size > ORIGINALS_MAX) originals.delete(originals.keys().next().value);
  }
  return thumb;
}

// The address to draw a profile picture from: our thumbnail, or url
// itself when it is not one to make a thumbnail of. While that thumbnail
// cannot be used (it failed, or the route is off), the original link.
// Safe to call twice.
export function avatarSrc(url) {
  const thumb = avatarThumbSrc(url);
  if (typeof thumb !== "string" || !isAvatarThumb(thumb)) return thumb;
  const source = avatarSource(thumb);
  if (!source || thumbUsable(source)) return thumb;
  if (thumb === url) return avatarOriginal(url) || url;
  return resolveHashinalSrc(url.trim());
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

function remember(map, key, until) {
  map.delete(key);
  map.set(key, until);
  if (map.size > FAILED_MAX) map.delete(map.keys().next().value);
}

function stillFailed(map, key) {
  const until = map.get(key);
  if (until === undefined) return false;
  if (clock() < until) return true;
  map.delete(key);
  return false;
}

// true when an answer of the thumbnail route says the route itself is
// missing or down; false for a picture, or for our route's own answer that
// only this one picture cannot be made (400, 403, 404, 413, 415). Our
// error answers are JSON { ok: false, error }; a missing route is not.
export function avatarRouteAnswerDown(status, contentType, body) {
  const type = String(contentType || "");
  if (status >= 200 && status < 300) return !/^image\//i.test(type);
  const ours = /json/i.test(type) && !!body && body.ok === false && typeof body.error === "string";
  if (!ours) return true;
  return status === 429 || status >= 500;
}

// A thumbnail that failed, fetched once and read for what the route said.
async function fetchRouteCheck(thumb) {
  if (typeof fetch !== "function") return false;
  let res;
  try {
    res = await fetch(thumb, { credentials: "same-origin" });
  } catch {
    return true;
  }
  const type = (res.headers && res.headers.get("content-type")) || "";
  let body = null;
  try {
    if (/json/i.test(type)) body = await res.json();
    else if (res.body && typeof res.body.cancel === "function") await res.body.cancel();
  } catch {
    body = null;
  }
  return avatarRouteAnswerDown(res.status, type, body);
}

function checkRoute(thumb) {
  routeToken += 1;
  const token = routeToken;
  route.checking = token;
  if (thumb) route.sample = thumb;
  let verdict;
  try {
    verdict = Promise.resolve(routeCheck(route.sample));
  } catch {
    verdict = Promise.resolve(true);
  }
  verdict.then((down) => down === true, () => true).then((down) => {
    if (route.checking !== token) return;
    route.checking = 0;
    route.streak.clear();
    route.off = down;
    route.until = down ? clock() + AVATAR_ROUTE_OFF_MS : 0;
  });
}

// false while the route is off. Once the pause is over, one check runs;
// thumbnails stay off until it answers.
function thumbsOn() {
  if (!route.off) return true;
  if (clock() >= route.until && !route.checking) checkRoute("");
  return false;
}

function thumbUsable(source) {
  return thumbsOn() && !stillFailed(failedThumbs, source);
}

// A thumbnail did not load (loopmedia.js).
export function avatarThumbFailed(thumb) {
  const source = isAvatarThumb(thumb) ? avatarSource(thumb) : "";
  if (!source) return;
  const at = clock();
  remember(failedThumbs, source, at + AVATAR_FAIL_MS);
  if (route.off || route.checking) return;
  for (const [key, when] of route.streak) {
    if (at - when > AVATAR_ROUTE_WINDOW_MS) route.streak.delete(key);
  }
  route.streak.set(source, at);
  if (route.streak.size >= AVATAR_ROUTE_FAILS) checkRoute(String(thumb).trim());
}

// A thumbnail loaded, from the network or a cache.
export function avatarThumbLoaded(thumb) {
  const source = isAvatarThumb(thumb) ? avatarSource(thumb) : "";
  if (source) failedThumbs.delete(source);
}

// The original drawn for a thumbnail that could not be used did not load
// either (after any gateway or Kiloscribe step).
export function avatarOriginalFailed(url) {
  const source = avatarSource(typeof url === "string" ? url : "");
  if (source) remember(deadOriginals, source, clock() + AVATAR_FAIL_MS);
}

// What a draw of url paints (loopmedia.js, presentImage) when url is a
// profile picture's thumbnail, or a link standing in for a thumbnail that
// cannot be used now; null for anything else, painted as it is.
// { src, source, thumb, dead }: thumb, src is the thumbnail to load; dead,
// the thumbnail and its original both failed: src is "", nothing loads;
// otherwise src is the original.
export function avatarDraw(url) {
  if (typeof url !== "string") return null;
  const text = url.trim();
  if (!text) return null;
  const isThumb = isAvatarThumb(text);
  if (!isThumb && !failedThumbs.size && !route.off) return null;
  const source = avatarSource(text);
  if (!source) return null;
  if (!isThumb && !originals.has(thumbFor(source))) return null;
  if (thumbUsable(source)) return isThumb ? { src: text, source, thumb: true, dead: false } : null;
  if (stillFailed(deadOriginals, source)) return { src: "", source, thumb: false, dead: true };
  const original = isThumb ? avatarOriginal(text) : text;
  return original ? { src: original, source, thumb: false, dead: false } : null;
}

// The route's state (tests, the console).
export function avatarRouteState() {
  return { off: route.off, until: route.until, checking: !!route.checking, failing: route.streak.size };
}

// Forget everything this page remembered (tests). now and checkRoute
// replace the clock and the route check.
export function resetAvatarState({ now, checkRoute: check } = {}) {
  originals.clear();
  failedThumbs.clear();
  deadOriginals.clear();
  route.off = false;
  route.until = 0;
  route.checking = 0;
  route.sample = "";
  route.streak.clear();
  routeToken += 1;
  clock = typeof now === "function" ? now : () => Date.now();
  routeCheck = typeof check === "function" ? check : fetchRouteCheck;
}
