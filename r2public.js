// Public origin of uploaded media. server/index.js assigns R2_PUBLIC_BASE
// from this function (R2_PUBLIC_BASE_URL, trailing slashes removed). The
// upload route returns `${R2_PUBLIC_BASE}/${key}`. The page receives that
// same string as globalThis.__R2_PUBLIC_BASE before any module runs.
export function r2PublicBase() {
  const fromEnv = envBase();
  if (fromEnv) return fromEnv;
  return pageBase();
}

function envBase() {
  try {
    if (typeof process === "undefined" || !process.env) return "";
    return String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function pageBase() {
  if (typeof globalThis === "undefined") return "";
  const value = globalThis.__R2_PUBLIC_BASE;
  if (typeof value !== "string" || !value) return "";
  return value.replace(/\/+$/, "");
}

const APP_ICON_EXT = /\.(?:jpe?g|png|webp)$/i;
// What the upload route names a comment's media (server/index.js
// R2_MIME_EXT): a still, a GIF, or a video.
const MEDIA_EXT = /\.(?:jpe?g|png|webp|gif|mp4|webm|mov)$/i;
// A converted GIF is its mp4 or webm plus this flag (mediaurl.js withGifClip).
const GIF_CLIP_QUERY = "?gif=1";

// The public R2 origin (R2_PUBLIC_BASE), a path under it, and a name that
// ext accepts. A hash, a user, another host, or a path that climbs out is
// not; a query is not either, except the GIF clip flag where allowed. An
// empty base accepts nothing.
function isOwnR2File(url, base, ext, gifClip) {
  const root = String(base || "").trim().replace(/\/+$/, "");
  if (!root || typeof url !== "string") return false;
  const text = url.trim();
  if (!text || text.length > 2048 || text.includes("\\")) return false;
  let image;
  let home;
  try {
    image = new URL(text);
    home = new URL(root);
  } catch {
    return false;
  }
  if (image.origin !== home.origin) return false;
  if (image.username || image.password || image.hash) return false;
  if (image.search && !(gifClip && image.search === GIF_CLIP_QUERY)) return false;
  let path;
  try {
    path = decodeURIComponent(image.pathname);
  } catch {
    return false;
  }
  const homePath = home.pathname.replace(/\/+$/, "");
  if (homePath) {
    if (!path.startsWith(`${homePath}/`)) return false;
  } else if (!path.startsWith("/")) {
    return false;
  }
  const rest = path.slice(homePath.length + 1);
  if (!rest || rest.split("/").some((part) => !part || part === "." || part === "..")) return false;
  return ext.test(rest);
}

// An image this app uploaded: the public R2 origin (R2_PUBLIC_BASE), a path
// under it, and a JPG, PNG or WebP name. A query, a hash, a user, another
// host, or a path that climbs out is not. An empty base accepts nothing.
export function isOwnR2Image(url, base = r2PublicBase()) {
  return isOwnR2File(url, base, APP_ICON_EXT, false);
}

// A comment's media this app uploaded: the same origin and path rules, with
// a still, GIF or video name, and no query but a GIF clip's ?gif=1.
export function isOwnR2Media(url, base = r2PublicBase()) {
  return isOwnR2File(url, base, MEDIA_EXT, true);
}
