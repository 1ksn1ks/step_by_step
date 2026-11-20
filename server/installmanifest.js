// A manifest per community, so an app installed from /zagreb opens Zagreb
// (installtarget.js has the rules both sides share).
//
// GET /manifest.webmanifest?start=<start>&n=<name>&icon=pic
//   With none of the three it is the static file, untouched (next()).
//   start: a topic id this server knows (the default topic, or one in its
//   topics table, which every topic the app opens is put in) or a live
//   name on the registry (domainregistry.js). The app's id and start_url
//   are /<start>, scope /, so each community is an app of its own. An
//   unknown or malformed start is the default app (id "/"), so installing
//   from a bad link still installs something that works.
//   n: the name under the icon, cleaned (cleanLabel); short_name from it.
//   Without n, "Web3Globe · <community>".
//   icon=pic: the community's picture, else the app icon. The picture is
//   never a link from the request: it is the profile picture of the
//   name's owner, else of an account that linked the topic (its admins
//   first), and it is drawn through the avatar pipeline (avatar.js: only a
//   profile's picture, every fetch guarded and limited, its thumbnail kept
//   in R2).
// GET /icons/community/<start>/<key>/<file>: that picture as an install
//   icon (COMMUNITY_ICONS), key naming the picture, so the URL changes
//   with it and the PNG is served immutable. Kept in memory.
// GET /api/install-target?start=<start>: what the install screen shows for
//   a start (its name, default label, picture), 404 when unknown.

import { createHash } from "node:crypto";
import sharp from "sharp";
import { linkableDomains } from "../domainregistry.js";
import {
  APP_NAME,
  DEFAULT_TOPIC,
  ICON_PIC,
  cleanStart,
  defaultLabel,
  hasManifestQuery,
  isDefaultStart,
  isTopicId,
  readManifestQuery,
  shortLabel,
  startPath,
} from "../installtarget.js";

export const COMMUNITY_ICONS = Object.freeze({
  "icon-192.png": { size: 192, purpose: "any" },
  "icon-512.png": { size: 512, purpose: "any" },
  "icon-512-maskable.png": { size: 512, purpose: "maskable" },
  "apple-touch-icon.png": { size: 180, purpose: "" },
});
// What a transparent part of a picture sits on, the app's background.
export const ICON_BACKGROUND = "#0a0a0a";
export const ICON_CACHE_ENTRIES = 300;
export const ICON_CACHE_CONTROL = "public, max-age=31536000, immutable";
// A name can lapse without a new message: the registry is read again at
// least this often, and whenever its topic has new messages.
export const REGISTRY_TTL_MS = 60 * 1000;
const PICTURE_KEY = /^[0-9a-f]{24}$/;
const MANIFEST_ICONS = ["icon-192.png", "icon-512.png", "icon-512-maskable.png"];

export function pictureKey(source) {
  return createHash("sha256").update(`community-icon:v1:${source}`).digest("hex").slice(0, 24);
}

export function communityIconPath(start, key, file) {
  return `/icons/community/${encodeURIComponent(start || DEFAULT_TOPIC)}/${key}/${file}`;
}

// The live names. readMessages() returns the registry topic's messages
// (as the app reads them); version() changes when that topic has new ones.
export function createRegistry({ readMessages, version = () => 0, now = Date.now, ttlMs = REGISTRY_TTL_MS }) {
  let cache = null;
  return {
    lookup(name) {
      const at = now();
      const current = version();
      if (!cache || cache.version !== current || at - cache.at >= ttlMs) {
        const names = new Map();
        for (const entry of linkableDomains(readMessages(), at / 1000)) names.set(entry.domain, entry.lastMessage);
        cache = { version: current, at, names };
      }
      return cache.names.get(name) || null;
    },
  };
}

// Which picture a community installs with. chosen is the admin's icon.
// Then the registered name's owner's profile picture, then a memo admin
// who linked the topic (memo order), then any memo admin who has a profile
// picture (memo order), then any other account that linked the topic, in
// the order linked is given. Blank strings are no picture.
export function pickCommunityPicture({ chosen = "", ownerPic = "", admins = [], linked = [], adminPic = () => "" } = {}) {
  const present = (value) => (typeof value === "string" && value ? value : "");
  const icon = present(chosen);
  if (icon) return icon;
  const owner = present(ownerPic);
  if (owner) return owner;
  const order = Array.isArray(admins) ? admins.filter((id) => typeof id === "string" && id) : [];
  const rows = Array.isArray(linked) ? linked : [];
  const linkedPic = new Map();
  for (const row of rows) {
    if (!row || typeof row.account !== "string" || !present(row.pic)) continue;
    if (!linkedPic.has(row.account)) linkedPic.set(row.account, row.pic);
  }
  for (const id of order) {
    if (linkedPic.has(id)) return linkedPic.get(id);
  }
  for (const id of order) {
    let pic = "";
    try {
      pic = present(typeof adminPic === "function" ? adminPic(id) : "");
    } catch {
      pic = "";
    }
    if (pic) return pic;
  }
  const named = new Set(order);
  for (const row of rows) {
    if (!row || named.has(row.account)) continue;
    const pic = present(row.pic);
    if (pic) return pic;
  }
  return "";
}

// What a start opens: { start, topic, name, label, picture, key }, start ''
// for the default; null when it is not a known topic or a live name.
// topicKnown(topic), topicName(topic) and pictureFor({ topic, owner }) come
// from the server's tables. pictureFor applies pickCommunityPicture.
export function createCommunities({ registry, topicKnown, topicName = () => "", pictureFor = () => "" }) {
  function target(start, topic, name, owner) {
    let picture = "";
    try {
      picture = pictureFor({ topic, owner }) || "";
    } catch (err) {
      console.error("community picture", err && err.message);
    }
    return {
      start,
      topic,
      name,
      label: start ? defaultLabel(name || topic) : APP_NAME,
      picture,
      key: picture ? pictureKey(picture) : "",
    };
  }
  return {
    resolve(raw) {
      const typed = String(raw ?? "").trim();
      const start = cleanStart(typed);
      if (typed && !start) return null;
      if (isDefaultStart(start)) return target("", DEFAULT_TOPIC, "", "");
      if (isTopicId(start)) {
        if (!topicKnown(start)) return null;
        return target(start, start, topicName(start) || "", "");
      }
      const entry = registry.lookup(start);
      if (!entry || !isTopicId(entry.topic)) return null;
      return target(start, entry.topic, start, typeof entry.payer === "string" ? entry.payer : "");
    },
  };
}

// The manifest for a community: the default one (base) with this app's
// id, start_url, scope, names and icons. A community app makes no claim on
// the default app (no related_applications), so a page linking it can
// still offer to install it beside that one.
export function communityManifest(base, target, { label = "", icon = "" } = {}) {
  const name = label || target.label;
  const path = startPath(target.start);
  const icons = icon === ICON_PIC && target.key
    ? MANIFEST_ICONS.map((file) => {
      const { size, purpose } = COMMUNITY_ICONS[file];
      return { src: communityIconPath(target.start, target.key, file), sizes: `${size}x${size}`, type: "image/png", purpose };
    })
    : base.icons;
  const manifest = { ...base, id: path, name, short_name: shortLabel(name), start_url: path, scope: "/", icons };
  if (target.start) delete manifest.related_applications;
  return manifest;
}

// A square PNG of the picture: the centre, filling the icon (a maskable
// icon's safe zone is its middle, where a profile's subject is), on the
// app's background where the picture is transparent.
export async function renderCommunityIcon(bytes, file) {
  const spec = COMMUNITY_ICONS[file];
  if (!spec) throw new Error("unknown icon");
  return sharp(bytes, { failOn: "none", animated: false })
    .resize(spec.size, spec.size, { fit: "cover", position: "centre" })
    .flatten({ background: ICON_BACKGROUND })
    .png()
    .toBuffer();
}

// Icons by picture and file, the newest ICON_CACHE_ENTRIES in memory; two
// requests for one share the work. getThumb(source, { ip }) is the avatar
// pipeline's thumbnail ({ ok, status, bytes } or { ok: false, status,
// error, retryAfter }).
export function createIconMaker({ getThumb, maxEntries = ICON_CACHE_ENTRIES }) {
  const memory = new Map();
  const flights = new Map();
  async function draw(source, id, file, ip) {
    const thumb = await getThumb(source, { ip });
    if (!thumb || !thumb.ok) return thumb || { ok: false, status: 502, error: "picture unavailable" };
    const png = await renderCommunityIcon(thumb.bytes, file);
    const made = { ok: true, status: 200, png, etag: `"${id.replace("/", "-")}"` };
    memory.set(id, made);
    while (memory.size > maxEntries) memory.delete(memory.keys().next().value);
    return made;
  }
  return {
    async make(source, key, file, { ip = "" } = {}) {
      const id = `${key}/${file}`;
      const hit = memory.get(id);
      if (hit) {
        memory.delete(id);
        memory.set(id, hit);
        return hit;
      }
      let flight = flights.get(id);
      if (!flight) {
        flight = draw(source, id, file, ip).finally(() => flights.delete(id));
        flights.set(id, flight);
      }
      return flight;
    },
    get size() {
      return memory.size;
    },
  };
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export function manifestRoute({ readBase, communities }) {
  return function communityManifestRoute(req, res, next) {
    if (!hasManifestQuery(req.query)) return next();
    let body;
    try {
      const choice = readManifestQuery(req.query);
      const target = communities.resolve(choice.start) || communities.resolve("");
      body = communityManifest(readBase(), target, choice);
    } catch (err) {
      console.error("community manifest", err && err.message);
      return next();
    }
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(JSON.stringify(body, null, 2));
  };
}

export function installTargetRoute({ communities }) {
  return function installTarget(req, res) {
    const raw = req.query && typeof req.query.start === "string" ? req.query.start : "";
    const target = communities.resolve(raw);
    res.setHeader("Cache-Control", "no-cache");
    if (!target) return res.status(404).json({ ok: false, error: "unknown community" });
    return res.json({
      ok: true,
      start: target.start,
      topic: target.topic,
      name: target.name,
      label: target.label,
      path: startPath(target.start),
      picture: target.key
        ? {
          key: target.key,
          icon: communityIconPath(target.start, target.key, "icon-192.png"),
          apple: communityIconPath(target.start, target.key, "apple-touch-icon.png"),
        }
        : null,
    });
  };
}

export function communityIconRoute({ communities, icons, clientIp = (req) => req.ip }) {
  return async function communityIcon(req, res) {
    const { start = "", key = "", file = "" } = req.params || {};
    if (!Object.hasOwn(COMMUNITY_ICONS, file) || !PICTURE_KEY.test(key)) {
      noStore(res);
      return res.status(404).end();
    }
    const target = communities.resolve(start === DEFAULT_TOPIC ? "" : start);
    // An old key: the community's picture changed since (the new manifest
    // names the new one).
    if (!target || target.key !== key) {
      noStore(res);
      return res.status(404).end();
    }
    let icon;
    try {
      icon = await icons.make(target.picture, key, file, { ip: clientIp(req) });
    } catch (err) {
      console.error("community icon", err && err.message);
      icon = { ok: false, status: 502, error: "icon unavailable" };
    }
    if (res.headersSent) return undefined;
    if (!icon.ok) {
      if (icon.retryAfter) res.setHeader("Retry-After", String(icon.retryAfter));
      noStore(res);
      return res.status(icon.status || 502).end();
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", ICON_CACHE_CONTROL);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("ETag", icon.etag);
    if (req.headers && req.headers["if-none-match"] === icon.etag) return res.status(304).end();
    return res.send(icon.png);
  };
}
