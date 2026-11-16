// X post links in user text. The parser is shared: the client imports it
// to find links in a post, and the server checks the same rule before it
// asks X's oEmbed service about a post.
//
// Only http(s) links to x.com or twitter.com (also www. and mobile.)
// whose path names one post count:
//   /<user>/status/<id>, /i/web/status/<id>, /i/status/<id>
// A trailing /photo/N or /video/N, the query, and the hash are ignored.
// A link with a user name or password, a port, another host, or any other
// path (a profile, a list, a search) is not a post link.
// The canonical form is https://x.com/<user>/status/<id>, or
// https://x.com/i/status/<id> when the link names no user.
//
// The server never passes X's HTML on. GET /api/x-embed answers with plain
// text fields only; the browser fills its own card with textContent.

export const X_OEMBED = "https://publish.twitter.com/oembed";
export const X_EMBED_HIT_MS = 24 * 60 * 60 * 1000;
export const X_EMBED_MISS_MS = 15 * 60 * 1000;
export const X_EMBED_CACHE_MAX = 2000;
export const X_EMBED_TIMEOUT_MS = 8000;
export const X_EMBED_UA = "hedera-map-app/1.0 (x-post-card)";
// Post text past this is cut. A post is 280 characters; a long post on a
// paid account can be far longer, and the card shows a few lines.
export const X_EMBED_TEXT_MAX = 1200;

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);
const X_USER = /^[A-Za-z0-9_]{1,15}$/;
// Post ids are positive 64-bit numbers: at most 20 digits, no leading 0.
const X_ID = /^[1-9]\d{0,19}$/;
const X_MEDIA_INDEX = /^\d{1,2}$/;

// Path segments, or null when the path has an empty segment in the middle
// ("//"). One trailing slash is fine.
function pathParts(pathname) {
  const parts = String(pathname || "").split("/").slice(1);
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  if (parts.some((part) => part === "")) return null;
  return parts;
}

// The part after the id: nothing, or one /photo/N or /video/N.
function restIsMedia(rest) {
  if (rest.length === 0) return true;
  if (rest.length !== 2) return false;
  const kind = rest[0].toLowerCase();
  return (kind === "photo" || kind === "video") && X_MEDIA_INDEX.test(rest[1]);
}

// { url, user, id } for a post link, or null.
export function parseXStatusUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  // new URL drops the scheme's own default port, so any port left is odd.
  if (url.port) return null;
  if (!X_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = pathParts(url.pathname);
  if (!parts || parts.length < 3) return null;
  const first = parts[0].toLowerCase();
  let user = "";
  let id = "";
  let rest = [];
  if (first === "i" && parts[1].toLowerCase() === "web" && parts.length >= 4 && parts[2].toLowerCase() === "status") {
    id = parts[3];
    rest = parts.slice(4);
  } else if (first === "i" && parts[1].toLowerCase() === "status") {
    id = parts[2];
    rest = parts.slice(3);
  } else if (parts[1].toLowerCase() === "status" && X_USER.test(parts[0]) && first !== "i") {
    user = parts[0];
    id = parts[2];
    rest = parts.slice(3);
  } else {
    return null;
  }
  if (!X_ID.test(id) || !restIsMedia(rest)) return null;
  const canonical = user
    ? `https://x.com/${user}/status/${id}`
    : `https://x.com/i/status/${id}`;
  return { url: canonical, user, id };
}

// The canonical link, or "".
export function xStatusUrl(value) {
  const hit = parseXStatusUrl(value);
  return hit ? hit.url : "";
}

// A link in running text: http(s):// and the characters a URL can hold.
// It cannot start in the middle of a word ("foohttps://...").
const LINK = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
// Sentence punctuation right after a link is not part of it.
const LINK_TAIL = /[.,;:!?'"*)\]]+$/;

// Every post link in the text, in order, with where it sits. One post
// linked twice is listed twice; xStatusUrlsIn lists it once.
// [{ index, raw, url, user, id }]: raw is the text as written (the part
// an anchor covers), url the canonical link.
export function xStatusMatches(text) {
  const source = String(text == null ? "" : text);
  const found = [];
  if (!/https?:\/\//i.test(source)) return found;
  for (const match of source.matchAll(LINK)) {
    const before = match.index > 0 ? source[match.index - 1] : "";
    if (before && /[\p{L}\p{N}_]/u.test(before)) continue;
    const raw = match[0].replace(LINK_TAIL, "");
    const hit = parseXStatusUrl(raw);
    if (!hit) continue;
    found.push({ index: match.index, raw, ...hit });
  }
  return found;
}

// The canonical post links in a body, each post once (by its id, so
// x.com/a/status/1 and twitter.com/i/status/1 are one post).
export function xStatusUrlsIn(text) {
  const urls = [];
  const seen = new Set();
  for (const hit of xStatusMatches(text)) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    urls.push(hit.url);
  }
  return urls;
}

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

function codePoint(n) {
  if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff) return "�";
  if (n >= 0xd800 && n <= 0xdfff) return "�";
  return String.fromCodePoint(n);
}

// One pass, so "&amp;lt;" becomes the text "&lt;", not "<".
export function decodeEntities(text) {
  return String(text || "").replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,15});/gi, (whole, name) => {
    if (name[0] === "#") {
      const hex = name[1] === "x" || name[1] === "X";
      return codePoint(parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    const hit = NAMED_ENTITIES[name.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

// Elements whose content is never text.
const DROP_BLOCKS = /<(script|style|iframe|frame|frameset|object|embed|noscript|template|svg|math|textarea|title)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const TAG = /<\/?[A-Za-z!?][^<>]*>?/g;

function stripTags(html) {
  let out = String(html || "");
  // Repeat until nothing changes, so a tag rebuilt out of the pieces of
  // two ("<scr<script>ipt>") is removed too.
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(DROP_BLOCKS, "").replace(TAG, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

// oEmbed's blockquote to the post's text. X's markup is
//   <blockquote><p>post text</p>&mdash; Name (@handle) <a>date</a></blockquote>
// so the first <p> is the post; without one the whole thing is used, cut
// at the em dash that starts the byline. Tags go, <br> is a new line,
// entities are decoded once. Anything that reads as a tag after decoding
// goes too, so no script, iframe or on* attribute reaches a page, even as
// text.
export function oembedHtmlToText(html, max = X_EMBED_TEXT_MAX) {
  let source = String(html || "");
  source = source.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(DROP_BLOCKS, "");
  const para = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/i.exec(source);
  let body = para ? para[1] : source;
  if (!para) body = body.replace(/(?:&mdash;|&#8212;|&#x2014;|—)[\s\S]*$/i, "");
  body = body.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p\s*>\s*<p\b[^>]*>/gi, "\n\n");
  // An on* attribute only lives inside a tag, so it goes with the tag.
  let text = stripTags(decodeEntities(stripTags(body)));
  text = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > max) text = text.slice(0, max - 1).trimEnd() + "…";
  return text;
}

function oneLine(value, max) {
  const text = typeof value === "string"
    ? stripTags(decodeEntities(stripTags(value))).replace(/\s+/g, " ").trim()
    : "";
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

// "jack" from https://twitter.com/jack, or "".
export function xHandleFromUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\//i.test(raw)) return "";
  let url;
  try { url = new URL(raw); } catch { return ""; }
  if (url.username || url.password || url.port) return "";
  if (!X_HOSTS.has(url.hostname.toLowerCase())) return "";
  const parts = pathParts(url.pathname);
  if (!parts || !parts.length) return "";
  // A post link names its author first.
  if (parts.length !== 1 && !(parts.length >= 3 && parts[1].toLowerCase() === "status")) return "";
  const handle = parts[0];
  if (!X_USER.test(handle) || handle.toLowerCase() === "i") return "";
  return handle;
}

// What GET /api/x-embed answers for a post X described. Text fields only:
// there is no html field, and nothing here is markup.
export function xEmbedBody(canonical, data) {
  const row = data && typeof data === "object" ? data : {};
  const parsed = parseXStatusUrl(canonical);
  const authorName = oneLine(row.author_name, 100);
  const authorHandle = xHandleFromUrl(row.author_url)
    || (parsed && parsed.user)
    || xHandleFromUrl(row.url);
  const text = oembedHtmlToText(row.html);
  return {
    ok: true,
    authorName,
    authorHandle,
    text,
    url: parsed ? parsed.url : "",
  };
}

// The lookup behind GET /api/x-embed. A post X described is kept 24 hours;
// a failure (not found, X down, a timeout) is kept 15 minutes, so a post
// linked in many places, or one X will not describe, is asked about once.
// The map is capped: storing again moves a link to the end, and past the
// cap the earliest goes. A hit read moves to the end too. Two asks for one
// link while X is answering share one request.
export function createXEmbedLookup({
  fetchImpl = fetch,
  now = Date.now,
  hitMs = X_EMBED_HIT_MS,
  missMs = X_EMBED_MISS_MS,
  cacheMax = X_EMBED_CACHE_MAX,
  timeoutMs = X_EMBED_TIMEOUT_MS,
  oembed = X_OEMBED,
} = {}) {
  const answers = new Map();
  const flights = new Map();

  function remember(url, status, body) {
    if (answers.has(url)) answers.delete(url);
    answers.set(url, { until: now() + (status === 200 ? hitMs : missMs), status, body });
    while (answers.size > cacheMax) {
      const oldest = answers.keys().next().value;
      if (oldest === undefined) break;
      answers.delete(oldest);
    }
    return { status, body };
  }

  async function load(url) {
    const ask = `${oembed}?url=${encodeURIComponent(url)}&omit_script=1&dnt=true`;
    let response;
    try {
      response = await fetchImpl(ask, {
        headers: { "User-Agent": X_EMBED_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return remember(url, 502, { ok: false, error: "x unavailable" });
    }
    if (!response || !response.ok) {
      const code = response ? response.status : 0;
      // Deleted, private, or never there.
      if (code === 404 || code === 403 || code === 410) return remember(url, 404, { ok: false, error: "not found" });
      return remember(url, 502, { ok: false, error: "x unavailable" });
    }
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!data || typeof data !== "object") return remember(url, 502, { ok: false, error: "x unavailable" });
    const body = xEmbedBody(url, data);
    if (!body.text && !body.authorName) return remember(url, 502, { ok: false, error: "x unavailable" });
    return remember(url, 200, body);
  }

  async function lookup(value) {
    const url = xStatusUrl(value);
    if (!url) return { status: 400, body: { ok: false, error: "not an x post link" } };
    const cached = answers.get(url);
    if (cached && now() < cached.until) {
      answers.delete(url);
      answers.set(url, cached);
      return { status: cached.status, body: cached.body };
    }
    if (cached) answers.delete(url);
    let flight = flights.get(url);
    if (!flight) {
      flight = load(url).finally(() => flights.delete(url));
      flights.set(url, flight);
    }
    return flight;
  }

  return { lookup, size: () => answers.size };
}

// GET /api/x-embed?url=<link>.
export function xEmbedRoute(lookup) {
  return async function xEmbed(req, res) {
    const value = req.query ? req.query.url : "";
    if (typeof value !== "string") {
      return res.status(400).json({ ok: false, error: "not an x post link" });
    }
    try {
      const result = await lookup.lookup(value);
      if (res.headersSent) return;
      res.setHeader("Cache-Control", result.status === 200 ? "public, max-age=3600" : "no-store");
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error("x embed lookup", err && err.message);
      if (!res.headersSent) res.status(502).json({ ok: false, error: "x unavailable" });
    }
  };
}
