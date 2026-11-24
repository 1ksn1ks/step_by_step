// The one media item a public comment or reply may carry: a still image,
// a GIF (sent as a muted clip), or a short video. These are the rules only,
// with no DOM and no upload, so a test reads them as the uploader does
// (uploadmedia.js uploadCommentMedia). Comments are not e2ee: nothing here
// seals a file.
//
// Stills keep the post-picture budget (postimages.js), GIFs the post GIF
// conversion (gifvideo.js), and a video the cover video's length check
// (covervideolimit.js) with a smaller size cap of its own.

import { COVER_VIDEO_MAX_SECONDS, COVER_VIDEO_UNKNOWN_TOAST, coverVideoReject } from './covervideolimit.js';
import {
  POST_IMAGE_EDGE,
  POST_IMAGE_ORIGINAL_MAX,
  POST_IMAGE_QUALITY,
  POST_IMAGE_UPLOAD_MAX,
  POST_STILL_TYPES,
} from './postimages.js';
import { GIF_MAX_BYTES, GIF_MAX_SECONDS, GIF_TOO_BIG } from './gifvideo.js';

export const COMMENT_VIDEO_MAX_SECONDS = COVER_VIDEO_MAX_SECONDS;
export const COMMENT_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const COMMENT_VIDEO_TYPES = Object.freeze(['video/mp4', 'video/webm']);

export const COMMENT_STILL_ORIGINAL_MAX = POST_IMAGE_ORIGINAL_MAX;
export const COMMENT_STILL_UPLOAD_MAX = POST_IMAGE_UPLOAD_MAX;
export const COMMENT_STILL_EDGE = POST_IMAGE_EDGE;
export const COMMENT_STILL_QUALITY = POST_IMAGE_QUALITY;
export const COMMENT_STILL_TYPES = POST_STILL_TYPES;

export const COMMENT_GIF_MAX_BYTES = GIF_MAX_BYTES;
export const COMMENT_GIF_MAX_SECONDS = GIF_MAX_SECONDS;

// For a file input's accept.
export const COMMENT_MEDIA_ACCEPT = [...COMMENT_STILL_TYPES, 'image/gif', ...COMMENT_VIDEO_TYPES].join(',');

export const COMMENT_MEDIA_TYPES_TEXT = 'Only PNG, JPG, WebP, GIF, MP4, WebM';
export const COMMENT_STILL_TOO_BIG = 'Image is over 10 MB';
export const COMMENT_STILL_STILL_BIG = 'Image is still over 2 MB after compression';
export const COMMENT_VIDEO_TOO_BIG = 'Video max 25 MB';
export const COMMENT_VIDEO_TOO_LONG = `Video max ${COMMENT_VIDEO_MAX_SECONDS} seconds`;

function typeOf(file) {
  return String((file && file.type) || '').toLowerCase();
}

function sizeOf(file) {
  const n = Number(file && file.size);
  return Number.isFinite(n) ? n : 0;
}

// "still", "gif", "video", or "" for anything else.
export function commentMediaKind(file) {
  const type = typeOf(file);
  if (COMMENT_STILL_TYPES.includes(type)) return 'still';
  if (type === 'image/gif') return 'gif';
  if (COMMENT_VIDEO_TYPES.includes(type)) return 'video';
  return '';
}

// Before any work: the refusal for this file, or "". A video's length is
// checked once it is read (commentVideoReject).
export function commentMediaReject(file) {
  const kind = commentMediaKind(file);
  if (!kind) return COMMENT_MEDIA_TYPES_TEXT;
  const size = sizeOf(file);
  if (kind === 'still' && size > COMMENT_STILL_ORIGINAL_MAX) return COMMENT_STILL_TOO_BIG;
  if (kind === 'gif' && size > COMMENT_GIF_MAX_BYTES) return GIF_TOO_BIG;
  if (kind === 'video' && size > COMMENT_VIDEO_MAX_BYTES) return COMMENT_VIDEO_TOO_BIG;
  return '';
}

// After compression: a still that is still over the post budget.
export function commentStillReject(file) {
  return sizeOf(file) > COMMENT_STILL_UPLOAD_MAX ? COMMENT_STILL_STILL_BIG : '';
}

// A video's length, read before upload. The cover video's check decides
// (covervideolimit.js): an unread length is refused the same way, and the
// cap is the same 30 seconds, said for a comment.
export function commentVideoReject(seconds) {
  const reason = coverVideoReject(seconds);
  if (!reason) return '';
  if (reason === COVER_VIDEO_UNKNOWN_TOAST) return reason;
  return COMMENT_VIDEO_TOO_LONG;
}
