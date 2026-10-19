// Remembers one upload token per account. A later upload reuses it until it
// is near expiry, the wallet changes (different key), or the server rejects
// it. DOM-free so the retry rules can be tested without a browser.

const GRANT_SKEW_MS = 15000;
export const UPLOAD_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export function grantKey(account) {
  return `upload-grant:${account}`;
}

export function readGrant(storage, account, now = Date.now()) {
  if (!account || !storage) return null;
  let raw;
  try {
    raw = storage.getItem(grantKey(account));
  } catch {
    return null;
  }
  if (!raw) return null;
  let grant;
  try {
    grant = JSON.parse(raw);
  } catch {
    clearGrant(storage, account);
    return null;
  }
  if (
    !grant ||
    grant.account !== account ||
    typeof grant.token !== "string" ||
    grant.token.length === 0 ||
    typeof grant.exp !== "number" ||
    !Number.isFinite(grant.exp) ||
    grant.exp <= now + GRANT_SKEW_MS
  ) {
    clearGrant(storage, account);
    return null;
  }
  return { account: grant.account, token: grant.token, exp: grant.exp };
}

export function writeGrant(storage, grant) {
  if (!storage || !grant || !grant.account || typeof grant.token !== "string") return;
  try {
    storage.setItem(grantKey(grant.account), JSON.stringify({
      account: grant.account,
      token: grant.token,
      exp: grant.exp,
    }));
  } catch {
    // The caller still holds the token for this send.
  }
}

export function clearGrant(storage, account) {
  if (!storage || !account) return;
  try {
    storage.removeItem(grantKey(account));
  } catch {
    // Nothing left to drop.
  }
}

// Prefer the server's absolute exp. Fall back to expiresIn, then 24 hours.
export function rememberGrant(storage, account, auth, now = Date.now()) {
  let exp = Number(auth && auth.exp);
  if (!Number.isFinite(exp) || exp <= now) {
    const expiresIn = Number(auth && auth.expiresIn);
    exp = Number.isFinite(expiresIn) && expiresIn > 0
      ? now + expiresIn * 1000
      : now + UPLOAD_GRANT_TTL_MS;
  }
  const grant = { account, token: String(auth.token), exp };
  writeGrant(storage, grant);
  return grant;
}

async function takeSigned(storage, sign) {
  const grant = await sign();
  if (!grant || typeof grant.token !== "string" || typeof grant.account !== "string") {
    throw new Error("Upload failed, please try again");
  }
  writeGrant(storage, grant);
  return grant;
}

// Sends with a stored token when one is still live. On 401, signs once
// more and sends that upload one more time. A second 401 stops.
export async function withUploadAuth({ account, storage, sign, send }) {
  let grant = readGrant(storage, account);
  if (!grant) grant = await takeSigned(storage, sign);
  try {
    return await send(grant.token);
  } catch (err) {
    if (!err || err.status !== 401) throw err;
    clearGrant(storage, grant.account || account);
    const fresh = await takeSigned(storage, sign);
    try {
      return await send(fresh.token);
    } catch (again) {
      if (again && again.status === 401) clearGrant(storage, fresh.account || account);
      throw again;
    }
  }
}
