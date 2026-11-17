// postimages.js — up to four pictures on one marker or polygon post.
//
// The post format does not change: `image` was always an array. A post
// carries up to POST_IMAGE_MAX still pictures, or one video (a GIF becomes
// a video on upload, gifvideo.js). Old posts hold one entry, or a bare
// string, and every reader that takes image[0] keeps working: the first
// picture is the cover.
//
// On-chain size, measured with R2 addresses (85 bytes each), a 20-character
// title and no text: a marker with 4 pictures and its 512 cover is 556 B
// public and 823 B sealed; a polygon is 634 B and 927 B. That is one HCS
// message (1024 B). Longer text uses the chunks hcschunks.js already joins.
//
// No DOM and no app state at import, so the feed, the popups, the draw
// form's byte counter and rest.js's submit all read the same rules. The
// draw form's live picture list (postgallery.js) registers itself here,
// so its readers never import the uploader.

import { isVideoUrl } from "./mediaurl.js";
import { resolveHashinalSrc } from "./hashinalurl.js";
import { r2PublicBase } from "./r2public.js";

export const POST_IMAGE_MAX = 4;
// The original file the picker hands over, before compression.
export const POST_IMAGE_ORIGINAL_MAX = 10 * 1024 * 1024;
// What one compressed picture may weigh on its way to R2.
export const POST_IMAGE_UPLOAD_MAX = 2 * 1024 * 1024;
export const POST_IMAGE_EDGE = 2048;
export const POST_IMAGE_QUALITY = 0.8;
export const POST_STILL_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

export const POST_MEDIA_MIX = "A post can have up to 4 images, or one video or GIF";
export const POST_IMAGES_FULL = "4/4 images. Remove one to add another.";
export const POST_IMAGES_BUSY = "Wait for the images to finish uploading";

const SHOWN = /^(https?|ipfs):\/\//i;

function entries(image) {
  if (Array.isArray(image)) return image;
  return image == null ? [] : [image];
}

// The pictures a post shows, in order, at most four. A post whose first
// entry is a video is a video post, so it has no gallery. A video later in
// the list (never written by this app) is skipped, as is anything that is
// not an http(s) or ipfs address. A Hashinal link (hcs://1/<id>,
// Kiloscribe) reads from our route first (hashinalurl.js).
export function galleryImages(image) {
  const out = [];
  for (const entry of entries(image)) {
    if (typeof entry !== "string") continue;
    const url = resolveHashinalSrc(entry.trim());
    if (!url || !SHOWN.test(url)) continue;
    if (isVideoUrl(url)) {
      if (!out.length) return [];
      continue;
    }
    out.push(url);
    if (out.length === POST_IMAGE_MAX) break;
  }
  return out;
}

// What a picked file is for the post's media slot.
export function pickKind(file) {
  const type = String((file && file.type) || "").toLowerCase();
  if (POST_STILL_TYPES.includes(type)) return "still";
  if (type === "image/gif" || type.startsWith("video/")) return "motion";
  return "other";
}

// --- The draw form's live list ---------------------------------------
// postgallery.js registers { images(), pending(), count(), cover(anchor) }
// for "marker" and "polygon".
const drafts = new Map();

export function registerPostDraft(kind, api) {
  if (kind && api) drafts.set(kind, api);
}

function draft(kind) {
  const api = drafts.get(kind);
  return api && api.count() > 0 ? api : null;
}

export function draftImageCount(kind) {
  const api = draft(kind);
  return api ? api.count() : 0;
}

// Pictures still compressing or uploading. Submit waits for zero.
export function draftPending(kind) {
  const api = draft(kind);
  return api ? api.pending() : 0;
}

// The `image` array the post sends: the uploaded pictures in their order,
// or the single field (a video, or no media) exactly as before.
export function postImageArray(kind, single) {
  const api = draft(kind);
  if (api) {
    const list = api.images();
    if (list.length) return list;
  }
  return [single == null ? "" : String(single)];
}

// A stand-in of a real R2 address's length for a picture still on its way,
// so the byte counter shows the size the post will have.
export function placeholderMediaUrl(ext = "webp") {
  const base = r2PublicBase() || "https://pub-00000000000000000000000000000000.r2.dev";
  return `${base}/markers/0000000000000-000000.${ext}`;
}

// The byte counter's copy of postImageArray: a picture still uploading
// counts as a full address.
export function wireImageArray(kind, single) {
  const api = draft(kind);
  if (!api) return postImageArray(kind, single);
  const done = api.images();
  const pending = api.pending();
  const list = done.slice();
  for (let i = 0; i < pending; i += 1) list.push(placeholderMediaUrl());
  return list.length ? list : postImageArray(kind, single);
}

// The cover the counter counts: the picked one, else the 512 copy of the
// first picture that submit will make.
export function wireCover(kind, cover) {
  const picked = cover == null ? "" : String(cover);
  if (picked || !draft(kind)) return picked;
  return placeholderMediaUrl("jpg");
}

// Submit: the picked cover, else a 512 copy of the first picture (made and
// uploaded once per first picture), else "".
export async function postCover(kind, cover, anchor) {
  const picked = cover == null ? "" : String(cover);
  if (picked) return picked;
  const api = draft(kind);
  if (!api) return "";
  return (await api.cover(anchor)) || "";
}
