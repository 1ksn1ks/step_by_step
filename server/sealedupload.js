// What a sealed chat upload is allowed to become in the bucket.
// Ciphertext only: no extension, no poster, no duration, and no account,
// uploader, or topic on the object. The daily byte cap stays in memory
// in the route and does not record this key.
import { uploadObjectKey } from "../mediaduration.js";

export const SEALED_CONTENT_TYPE = "application/octet-stream";
export const SEALED_SLACK = 1024 * 1024;
export const SEALED_MAX = (100 * 1024 * 1024) + SEALED_SLACK;

export function sealedUploadPlan({ contentType, sealed, posterFor, bytes, now, nonce }) {
  if (!sealed) return null;
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (posterFor) return { ok: false, status: 400, error: "Bad poster" };
  if (type !== SEALED_CONTENT_TYPE) {
    return { ok: false, status: 415, error: "Unsupported type — images and videos only" };
  }
  if (!(bytes > 0)) return { ok: false, status: 400, error: "Empty file" };
  if (bytes > SEALED_MAX) return { ok: false, status: 413, error: "Too big — 100 MB video max" };
  const key = uploadObjectKey("", null, now, nonce);
  return {
    ok: true,
    key,
    contentType: SEALED_CONTENT_TYPE,
    poster: false,
    pendingPoster: false,
    posterEdit: false,
    cacheControl: "public, max-age=31536000, immutable",
  };
}
