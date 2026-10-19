// Wallet upload grant. HMAC-SHA256 over base64url JSON { accountId, exp }.
// The account id is inside the signed body, so a token cannot be reused
// for a different wallet. exp is an absolute millisecond timestamp.
import crypto from "node:crypto";

export const UPLOAD_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_TOKEN_TTL_SEC = 24 * 60 * 60;

export function uploadSecretOk(secret) {
  return Buffer.byteLength(String(secret || ""), "utf8") >= 32;
}

export function issueUploadToken(accountId, secret, now = Date.now()) {
  const exp = now + UPLOAD_TOKEN_TTL_MS;
  const body = Buffer.from(JSON.stringify({ accountId, exp })).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return { token: `${body}.${mac}`, exp, expiresIn: UPLOAD_TOKEN_TTL_SEC };
}

// Constant-time compare of the HMAC. A wrong length never reaches the compare.
// exp equal to `now` is still valid; only an earlier exp is rejected.
export function accountFromUploadToken(header, secret, now = Date.now()) {
  if (!uploadSecretOk(secret)) return null;
  const token = typeof header === "string" ? header.trim() : "";
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest("base64url"));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || !/^\d+\.\d+\.\d+$/.test(payload.accountId)) return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload.accountId;
}
