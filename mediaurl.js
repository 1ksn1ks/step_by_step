// One media address for every renderer. A GIF address is not painted:
// nothing is returned for it, and the server does not convert it.

const GIF_URL = /\.gif(?=$|[?#])/i;
const VIDEO_URL = /\.(mp4|webm|mov|m4v)(?=$|[?#])/i;
const POSTER_KEY = /^markers\/\d+-[a-z0-9]+(?:-d\d+)?\.(mp4|webm)$/i;

export function isGifUrl(url) {
  return typeof url === "string" && GIF_URL.test(url);
}

export function isVideoUrl(url) {
  return typeof url === "string" && VIDEO_URL.test(url);
}

export function resolveMediaUrl(url) {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw || isGifUrl(raw)) return { kind: "image", src: "", poster: "" };
  if (isVideoUrl(raw)) return { kind: "video", src: raw, poster: "" };
  return { kind: "image", src: raw, poster: "" };
}

// The sibling poster object for a video this bucket just stored.
// Anything else (another host, a gif, a path escape) is refused.
export function posterTargetKey(publicBase, videoUrl) {
  const base = String(publicBase || "").replace(/\/+$/, "");
  const raw = typeof videoUrl === "string" ? videoUrl.trim() : "";
  if (!base || !raw) return "";
  let parsed;
  let root;
  try {
    parsed = new URL(raw);
    root = new URL(base);
  } catch {
    return "";
  }
  if (parsed.origin !== root.origin) return "";
  const prefix = root.pathname.replace(/\/+$/, "");
  let path = parsed.pathname;
  try { path = decodeURIComponent(parsed.pathname); } catch { return ""; }
  if (prefix && path !== prefix && !path.startsWith(prefix + "/")) return "";
  const key = path.slice(prefix.length).replace(/^\/+/, "");
  if (!key || key.includes("..") || !POSTER_KEY.test(key)) return "";
  return key.replace(/\.(mp4|webm)$/i, ".poster.jpg");
}
