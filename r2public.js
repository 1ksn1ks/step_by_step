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
