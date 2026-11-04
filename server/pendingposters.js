// A device-converted GIF uploads the video, then its first-frame JPEG.
// The poster may follow for two minutes, once, from the same account,
// and only onto that object. exp equal to now is still valid.

export const POSTER_WAIT_MS = 2 * 60 * 1000;

function posterAccount(account) {
  return typeof account === "string" ? account : "";
}

export function createPendingPosters(nowFn = Date.now) {
  const pendingPosters = new Map();
  const owners = new Map();
  const now = () => nowFn();

  function posterKeyFor(videoKey) {
    const posterKey = String(videoKey || "").replace(/\.(mp4|webm)$/i, ".poster.jpg");
    if (!posterKey || posterKey === videoKey) return "";
    return posterKey;
  }

  function rememberKey(posterKey, account) {
    const key = String(posterKey || "");
    const who = posterAccount(account);
    if (!key || !who) return "";
    owners.set(key, who);
    return key;
  }

  function remember(videoKey, account) {
    return rememberKey(posterKeyFor(videoKey), account);
  }

  function owner(posterKey) {
    return owners.get(String(posterKey || "")) || "";
  }

  function hold(posterKey, account) {
    pendingPosters.set(posterKey, {
      exp: now() + POSTER_WAIT_MS,
      account: posterAccount(account),
    });
  }

  function note(videoKey, account) {
    const posterKey = posterKeyFor(videoKey);
    if (!posterKey) return;
    hold(posterKey, account);
  }

  // A later edit may replace the still. Only the account that uploaded the video.
  function arm(posterKey, account) {
    const key = String(posterKey || "");
    const who = posterAccount(account);
    if (!key || !who || owners.get(key) !== who) return false;
    hold(key, who);
    return true;
  }

  function live(key, account) {
    const entry = pendingPosters.get(key);
    const exp = entry && typeof entry.exp === "number" ? entry.exp : 0;
    if (!entry || exp < now()) {
      if (entry) pendingPosters.delete(key);
      return false;
    }
    return entry.account === posterAccount(account);
  }

  function consume(key, account) {
    if (!live(key, account)) return false;
    pendingPosters.delete(key);
    return true;
  }

  // The JPEG put failed after the slot was taken. The same account may retry.
  function restore(posterKey, account) {
    if (!posterKey) return;
    hold(posterKey, account);
  }

  function sweep(at = now()) {
    for (const [key, entry] of pendingPosters) {
      const exp = entry && entry.exp;
      if (typeof exp !== "number" || exp < at) pendingPosters.delete(key);
    }
  }

  function size() {
    return pendingPosters.size;
  }

  return { note, live, consume, restore, sweep, size, remember, rememberKey, owner, arm };
}
