// X post cards: the shared link parser, finding links in text, oEmbed HTML
// to plain text, the cached server lookup and its route, the browser's
// request cache, and how the pages are wired.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import {
  X_EMBED_HIT_MS,
  X_EMBED_MISS_MS,
  X_EMBED_UA,
  createXEmbedLookup,
  decodeEntities,
  oembedHtmlToText,
  parseXStatusUrl,
  xEmbedBody,
  xEmbedRoute,
  xHandleFromUrl,
  xStatusMatches,
  xStatusUrl,
  xStatusUrlsIn,
} from "../server/xembed.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// What publish.twitter.com/oembed answers (omit_script=1).
const OEMBED = {
  url: "https://twitter.com/jack/status/20",
  author_name: "jack",
  author_url: "https://twitter.com/jack",
  html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://twitter.com/jack/status/20?ref_src=twsrc%5Etfw">March 21, 2006</a></blockquote>\n',
  width: 550,
  height: null,
  type: "rich",
  cache_age: "3153600000",
  provider_name: "Twitter",
  provider_url: "https://twitter.com",
  version: "1.0",
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("post links on x.com and twitter.com are accepted and made canonical", () => {
  const cases = [
    ["https://x.com/jack/status/20", "https://x.com/jack/status/20"],
    ["https://twitter.com/jack/status/20", "https://x.com/jack/status/20"],
    ["https://www.x.com/jack/status/20", "https://x.com/jack/status/20"],
    ["https://www.twitter.com/jack/status/20", "https://x.com/jack/status/20"],
    ["https://mobile.twitter.com/jack/status/20", "https://x.com/jack/status/20"],
    ["https://mobile.x.com/jack/status/20", "https://x.com/jack/status/20"],
    // http becomes https.
    ["http://twitter.com/jack/status/20", "https://x.com/jack/status/20"],
    // Query and hash are ignored.
    ["https://x.com/jack/status/20?s=20&t=abc", "https://x.com/jack/status/20"],
    ["https://x.com/jack/status/20#reply", "https://x.com/jack/status/20"],
    // A trailing /photo/N or /video/N names the same post.
    ["https://x.com/jack/status/20/photo/1", "https://x.com/jack/status/20"],
    ["https://twitter.com/jack/status/20/video/2?s=46", "https://x.com/jack/status/20"],
    ["https://x.com/jack/status/20/", "https://x.com/jack/status/20"],
    // No user in the path.
    ["https://x.com/i/web/status/1790000000000000000", "https://x.com/i/status/1790000000000000000"],
    ["https://twitter.com/i/status/1790000000000000000", "https://x.com/i/status/1790000000000000000"],
    // Case of the host and the fixed words does not matter.
    ["HTTPS://X.COM/Jack_99/Status/20", "https://x.com/Jack_99/status/20"],
    ["  https://x.com/jack/status/20  ", "https://x.com/jack/status/20"],
    ["https://x.com:443/jack/status/20", "https://x.com/jack/status/20"],
  ];
  for (const [input, want] of cases) assert.equal(xStatusUrl(input), want, input);
  assert.deepEqual(parseXStatusUrl("https://twitter.com/jack/status/20/photo/1"), {
    url: "https://x.com/jack/status/20",
    user: "jack",
    id: "20",
  });
  assert.deepEqual(parseXStatusUrl("https://x.com/i/web/status/42"), {
    url: "https://x.com/i/status/42",
    user: "",
    id: "42",
  });
});

test("other hosts, credentials, odd ports and non-post paths are rejected", () => {
  const bad = [
    "",
    null,
    undefined,
    42,
    "x.com/jack/status/20",
    "//x.com/jack/status/20",
    "ftp://x.com/jack/status/20",
    "javascript:alert(1)//x.com/jack/status/20",
    "https://x.co/jack/status/20",
    "https://nitter.net/jack/status/20",
    "https://evilx.com/jack/status/20",
    "https://x.com.evil.com/jack/status/20",
    "https://twitter.com.evil/jack/status/20",
    "https://api.x.com/jack/status/20",
    "https://x.com./jack/status/20",
    // Credentials, either way round.
    "https://user:pass@x.com/jack/status/20",
    "https://user@x.com/jack/status/20",
    "https://x.com@evil.com/jack/status/20",
    "https://x.com:8443/jack/status/20",
    "http://x.com:443/jack/status/20",
    // Profiles and other pages.
    "https://x.com/jack",
    "https://x.com/jack/",
    "https://twitter.com/jack/likes",
    "https://x.com/jack/status",
    "https://x.com/jack/status/",
    "https://x.com/jack/status/abc",
    "https://x.com/jack/status/020",
    "https://x.com/jack/status/123456789012345678901",
    "https://x.com/jack/status/20/likes",
    "https://x.com/jack/status/20/photo",
    "https://x.com/jack/status/20/photo/1/2",
    "https://x.com/jack/statuses/20",
    "https://x.com/i/lists/20",
    "https://x.com/i/web/20",
    "https://x.com/search?q=status/20",
    "https://x.com/hashtag/status",
    "https://x.com//jack/status/20",
    "https://x.com/this_name_is_too_long/status/20",
    "https://x.com/ja-ck/status/20",
    "https://x.com/jack/status/20 extra",
  ];
  for (const input of bad) assert.equal(xStatusUrl(input), "", String(input));
});

test("xStatusUrlsIn finds post links in a body, each post once", () => {
  const body = [
    "Look at this https://x.com/jack/status/20, and again",
    "(https://twitter.com/jack/status/20?s=20) and",
    "https://x.com/i/status/20 plus https://mobile.twitter.com/someone/status/1790000000000000000/photo/1.",
    "Not these: https://x.com/jack https://example.com/a/status/9 foohttps://x.com/a/status/7",
  ].join("\n");
  assert.deepEqual(xStatusUrlsIn(body), [
    "https://x.com/jack/status/20",
    "https://x.com/someone/status/1790000000000000000",
  ]);
  assert.deepEqual(xStatusUrlsIn(""), []);
  assert.deepEqual(xStatusUrlsIn(null), []);
  assert.deepEqual(xStatusUrlsIn("no links #here 0.0.123"), []);
  assert.deepEqual(xStatusUrlsIn("https://x.com/a/status/1!https://x.com/b/status/2"), []);
  assert.deepEqual(xStatusUrlsIn("end https://x.com/a/status/1?"), ["https://x.com/a/status/1"]);
});

test("xStatusMatches says where each link sits and what text an anchor covers", () => {
  const text = "a https://x.com/jack/status/20. b http://twitter.com/jack/status/20/photo/1)";
  const hits = xStatusMatches(text);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((hit) => [hit.index, hit.raw, hit.url]), [
    [2, "https://x.com/jack/status/20", "https://x.com/jack/status/20"],
    [34, "http://twitter.com/jack/status/20/photo/1", "https://x.com/jack/status/20"],
  ]);
  for (const hit of hits) assert.equal(text.slice(hit.index, hit.index + hit.raw.length), hit.raw);
});

test("oEmbed HTML becomes the post's plain text", () => {
  assert.equal(oembedHtmlToText(OEMBED.html), "just setting up my twttr");
  assert.equal(
    oembedHtmlToText('<blockquote><p>one<br>two<br/>three <a href="https://t.co/x">pic.twitter.com/x</a></p>&mdash; A (@a)</blockquote>'),
    "one\ntwo\nthree pic.twitter.com/x",
  );
  // No <p>: the byline after the em dash is not part of the post.
  assert.equal(oembedHtmlToText("<blockquote>Hello there &mdash; A (@a) <a>May 1</a></blockquote>"), "Hello there");
  assert.equal(oembedHtmlToText(""), "");
  assert.equal(oembedHtmlToText(null), "");
  const long = oembedHtmlToText(`<p>${"a".repeat(5000)}</p>`);
  assert.ok(long.length <= 1200);
  assert.ok(long.endsWith("…"));
});

test("entities decode once", () => {
  assert.equal(
    oembedHtmlToText("<p>Tom &amp; Jerry &lt;3 &quot;hi&quot; it&#39;s &#x1F600; &#8212; &nbsp;ok&hellip;</p>"),
    'Tom & Jerry <3 "hi" it\'s 😀 — ok…',
  );
  // Double-encoded text stays text, decoded one step only.
  assert.equal(oembedHtmlToText("<p>&amp;lt;b&amp;gt;</p>"), "&lt;b&gt;");
  assert.equal(decodeEntities("&unknown; &#0; &#xD800; &#1114112;"), "&unknown; � � �");
});

test("script, iframe and on* attributes never survive", () => {
  const nasty = [
    '<blockquote><p>hi<script>alert(1)</script> there</p></blockquote>',
    '<p>hi <img src=x onerror="alert(1)"> there</p>',
    '<p>hi <iframe src="https://evil.example/" onload="alert(1)"></iframe>there</p>',
    '<p>hi <a href="javascript:alert(1)" onclick="alert(1)">link</a></p>',
    '<p>hi <scr<script>ipt>alert(1)</script> there</p>',
    '<p>hi &lt;script&gt;alert(1)&lt;/script&gt; there</p>',
    '<p>hi &lt;img src=x onerror=alert(1)&gt; there</p>',
    '<p>hi <svg onload="alert(1)"><script>alert(1)</script></svg></p>',
    '<p>hi <!-- <script>alert(1)</script> --> there</p>',
    '<p>hi <script>alert(1)',
    '<p>hi <style>body{}</style><object data="x"></object><embed src="x"></p>',
  ];
  for (const html of nasty) {
    const text = oembedHtmlToText(html);
    for (const bad of ["<script", "</script", "<iframe", "<img", "<svg", "<object", "<embed", "<style", "onerror", "onload", "onclick", "javascript:"]) {
      assert.equal(text.toLowerCase().includes(bad), false, `${bad} from ${html} -> ${text}`);
    }
    assert.equal(/[<>]/.test(text) && /<[a-z/!]/i.test(text), false, text);
  }
  assert.equal(oembedHtmlToText('<p>hi <img src=x onerror="alert(1)"> there</p>'), "hi there");
});

test("the answer has text fields only, and the handle comes from X or the link", () => {
  const body = xEmbedBody("https://x.com/jack/status/20", OEMBED);
  assert.deepEqual(body, {
    ok: true,
    authorName: "jack",
    authorHandle: "jack",
    text: "just setting up my twttr",
    url: "https://x.com/jack/status/20",
  });
  assert.deepEqual(Object.keys(body).sort(), ["authorHandle", "authorName", "ok", "text", "url"]);
  assert.equal("html" in body, false);
  // No author_url: the link's own user.
  assert.equal(xEmbedBody("https://x.com/Someone/status/9", { author_name: "S", html: "<p>x</p>" }).authorHandle, "Someone");
  // An /i/status/ link: X's own url names the author.
  assert.equal(xEmbedBody("https://x.com/i/status/9", { author_name: "S", url: "https://twitter.com/sam/status/9", html: "<p>x</p>" }).authorHandle, "sam");
  // A name with markup is plain text.
  assert.equal(xEmbedBody("https://x.com/a/status/1", { author_name: '<b onclick="x()">Bob</b> &amp; co', html: "" }).authorName, "Bob & co");
  assert.equal(xHandleFromUrl("https://twitter.com/jack"), "jack");
  assert.equal(xHandleFromUrl("https://evil.example/jack"), "");
  assert.equal(xHandleFromUrl("https://x.com/jack/likes"), "");
  assert.equal(xHandleFromUrl("https://x.com/i"), "");
});

test("the lookup asks oEmbed once and keeps hits a day, misses 15 minutes", async () => {
  let clock = 1_000_000;
  const asked = [];
  const answers = new Map([
    ["https://x.com/jack/status/20", () => jsonResponse(200, OEMBED)],
    ["https://x.com/gone/status/1", () => jsonResponse(404, { error: "nope" })],
    ["https://x.com/down/status/1", () => { throw new Error("timeout"); }],
    ["https://x.com/odd/status/1", () => jsonResponse(500, {})],
    ["https://x.com/junk/status/1", () => new Response("not json", { status: 200 })],
  ]);
  const lookup = createXEmbedLookup({
    now: () => clock,
    async fetchImpl(url, init) {
      asked.push({ url, init });
      const target = new URL(url).searchParams.get("url");
      return answers.get(target)();
    },
  });

  const hit = await lookup.lookup("http://twitter.com/jack/status/20/photo/1?s=20");
  assert.equal(hit.status, 200);
  assert.equal(hit.body.text, "just setting up my twttr");
  assert.equal(asked.length, 1);
  assert.equal(
    asked[0].url,
    "https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20&omit_script=1&dnt=true",
  );
  assert.equal(asked[0].init.headers["User-Agent"], X_EMBED_UA);
  assert.ok(asked[0].init.signal instanceof AbortSignal);

  // Another form of the same link is the same cache entry.
  assert.equal((await lookup.lookup("https://www.x.com/jack/status/20")).status, 200);
  assert.equal(asked.length, 1);

  assert.equal((await lookup.lookup("https://x.com/gone/status/1")).status, 404);
  assert.equal((await lookup.lookup("https://x.com/down/status/1")).status, 502);
  assert.equal((await lookup.lookup("https://x.com/odd/status/1")).status, 502);
  assert.equal((await lookup.lookup("https://x.com/junk/status/1")).status, 502);
  assert.equal(asked.length, 5);
  // Misses are cached too.
  assert.equal((await lookup.lookup("https://x.com/gone/status/1")).status, 404);
  assert.equal((await lookup.lookup("https://x.com/down/status/1")).status, 502);
  assert.equal(asked.length, 5);

  // Past 15 minutes the misses are asked again; the hit is still kept.
  clock += X_EMBED_MISS_MS + 1;
  await lookup.lookup("https://x.com/gone/status/1");
  await lookup.lookup("https://x.com/jack/status/20");
  assert.equal(asked.length, 6);
  // Past a day the hit is asked again.
  clock += X_EMBED_HIT_MS;
  await lookup.lookup("https://x.com/jack/status/20");
  assert.equal(asked.length, 7);

  // Not a post link: 400, and oEmbed is not asked.
  assert.equal((await lookup.lookup("https://x.com/jack")).status, 400);
  assert.equal((await lookup.lookup("https://evil.example/a/status/1")).status, 400);
  assert.equal(asked.length, 7);
});

test("the lookup shares one request per link and caps its map", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const lookup = createXEmbedLookup({
    cacheMax: 3,
    async fetchImpl(url) {
      calls += 1;
      const target = new URL(url).searchParams.get("url");
      if (target.endsWith("/status/20")) await gate;
      return jsonResponse(200, { ...OEMBED, url: target });
    },
  });
  const both = Promise.all([
    lookup.lookup("https://x.com/jack/status/20"),
    lookup.lookup("https://twitter.com/jack/status/20"),
  ]);
  release();
  const [a, b] = await both;
  assert.equal(calls, 1);
  assert.deepEqual(a, b);

  for (const id of [1, 2, 3]) await lookup.lookup(`https://x.com/a/status/${id}`);
  assert.equal(lookup.size(), 3);
  assert.equal(calls, 4);
  // A read moves a link to the end, so the next store drops the oldest
  // other one.
  await lookup.lookup("https://x.com/a/status/1");
  await lookup.lookup("https://x.com/a/status/4");
  assert.equal(calls, 5);
  await lookup.lookup("https://x.com/a/status/1");
  assert.equal(calls, 5);
  await lookup.lookup("https://x.com/a/status/2");
  assert.equal(calls, 6);
});

test("GET /api/x-embed answers JSON with no html field", async () => {
  const lookup = createXEmbedLookup({
    async fetchImpl(url) {
      const target = new URL(url).searchParams.get("url");
      if (target.includes("/gone/")) return jsonResponse(404, {});
      return jsonResponse(200, {
        ...OEMBED,
        html: '<blockquote><p>hello <script>alert(1)</script><img src=x onerror=alert(1)>world</p>&mdash; jack</blockquote><script src="https://platform.twitter.com/widgets.js"></script>',
      });
    },
  });
  const app = express();
  app.get("/api/x-embed", xEmbedRoute(lookup));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}/api/x-embed`;
    const ok = await fetch(`${base}?url=${encodeURIComponent("https://twitter.com/jack/status/20?s=20")}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type"), /application\/json/);
    const raw = await ok.text();
    assert.equal(/<|html|script|onerror|widgets\.js/i.test(raw), false, raw);
    const body = JSON.parse(raw);
    assert.deepEqual(body, {
      ok: true,
      authorName: "jack",
      authorHandle: "jack",
      text: "hello world",
      url: "https://x.com/jack/status/20",
    });

    const profile = await fetch(`${base}?url=${encodeURIComponent("https://x.com/jack")}`);
    assert.equal(profile.status, 400);
    assert.equal((await profile.json()).ok, false);
    const none = await fetch(base);
    assert.equal(none.status, 400);
    const twice = await fetch(`${base}?url=a&url=b`);
    assert.equal(twice.status, 400);
    const gone = await fetch(`${base}?url=${encodeURIComponent("https://x.com/gone/status/1")}`);
    assert.equal(gone.status, 404);
    assert.deepEqual(Object.keys(await gone.json()).sort(), ["error", "ok"]);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("the route turns a thrown lookup into 502", async () => {
  const app = express();
  app.get("/api/x-embed", xEmbedRoute({ async lookup() { throw new Error("boom"); } }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/x-embed?url=${encodeURIComponent("https://x.com/a/status/1")}`);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { ok: false, error: "x unavailable" });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("the browser asks once per post and reads the shared device switch", async () => {
  const store = new Map([["meritocracy-x-embeds", "off"]]);
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(url);
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (url.includes("gone")) return jsonResponse(404, { ok: false, error: "not found" });
    return jsonResponse(200, {
      ok: true,
      authorName: "jack",
      authorHandle: "jack",
      text: "just setting up my twttr",
      url: "https://evil.example/",
      html: "<script>alert(1)</script>",
    });
  };
  try {
    const client = await import("../xembed.js");
    assert.equal(client.X_EMBEDS_KEY, "meritocracy-x-embeds");
    assert.equal(client.xEmbedsOn(), false);
    client.setXEmbedsOn(true);
    assert.equal(client.xEmbedsOn(), true);
    assert.equal(store.get("meritocracy-x-embeds"), "on");

    const url = "https://x.com/jack/status/20";
    const [a, b] = await Promise.all([client.requestXEmbed(url), client.requestXEmbed(url)]);
    assert.equal(asked.length, 1);
    assert.equal(asked[0], `/api/x-embed?url=${encodeURIComponent(url)}`);
    // Only the card's fields; the link is the one asked about.
    assert.deepEqual(a, { authorName: "jack", authorHandle: "jack", text: "just setting up my twttr", url });
    assert.equal(a, b);
    await client.requestXEmbed(url);
    assert.equal(asked.length, 1);

    assert.equal(await client.requestXEmbed("https://x.com/gone/status/1"), null);
    assert.equal(await client.requestXEmbed("https://x.com/gone/status/1"), null);
    assert.equal(asked.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("pages are wired to the shared parser and never load X's script", () => {
  const client = read("../xembed.js");
  const code = (src) => src.replace(/^\s*\/\/.*$/gm, "");
  assert.match(client, /import \{ xStatusMatches \} from '\.\/server\/xembed\.js'/);
  // The card is built node by node and filled with textContent.
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML|widgets\.js|platform\.twitter\.com/.test(code(client)), false);
  assert.match(client, /rel = 'noopener noreferrer'/);
  assert.match(client, /new IntersectionObserver\(onSeen, \{ root, rootMargin: NEAR_MARGIN, threshold: 0 \}\)/);
  assert.match(client, /'Show post from X'/);
  assert.match(client, /'View on X'/);
  const server = read("../server/xembed.js");
  assert.equal(/widgets\.js/.test(code(server)), false);

  for (const rel of ["../feedlayout.js", "../processallmessages.js", "../popuptext.js", "../chatimage.js", "../swapsheet.js", "../handleallmessages.js", "../loadBio4PIC.js", "../index.html", "../server/index.js"]) {
    assert.equal(/widgets\.js|platform\.twitter\.com/.test(read(rel)), false, rel);
  }

  const index = read("../server/index.js");
  assert.match(index, /app\.get\("\/api\/x-embed", publicPostLimit, xEmbedRoute\(xEmbedLookup\)\)/);
  assert.equal(/helmet|Content-Security-Policy/i.test(index), false);

  const feed = read("../feedlayout.js");
  const media = feed.slice(feed.indexOf("const mediaSection = settingsSection('Media');"), feed.indexOf("function resizeFeedMedia"));
  assert.ok(media.indexOf("settingsSwitch('Show X embeds', xEmbedsOn, setXEmbedsOn)") > media.indexOf("settingsSwitch('Show media full size'"));
  assert.match(media, /writeFeedSetting\(FEED_SETTING\.data, on \? 'on' : 'off'\);\s*syncFeedVideos\(\);\s*\/\/[^\n]*\n\s*refreshXEmbeds\(\);/);
  // buildCard: after the text is placed; the title stays a plain pill.
  const build = feed.slice(feed.indexOf("function buildCard(post)"), feed.indexOf("function clampPending"));
  assert.match(build, /card\.appendChild\(text\);\s*\}\s*\/\/[^\n]*\n\s*if \(text\) paintXEmbeds\(text\);/);
  const title = feed.slice(feed.indexOf("function feedTitle"), feed.indexOf("function buildCard(post)"));
  assert.equal(title.includes("paintXEmbeds"), false);
  assert.match(feed.slice(feed.indexOf("function patchFeedCardsForEdit")), /paintHashtags\(text, msg\);\s*\/\/[^\n]*\n\s*paintXEmbeds\(text\);/);
  assert.match(feed, /fillTopicIds\(profileBio, text, 'feed-profile-topic'\);\s*\}\s*paintXEmbeds\(profileBio\);/);
  assert.equal(feed.includes("'feed-setting-x"), false);

  const popups = read("../processallmessages.js");
  assert.equal(popups.split("paintXEmbeds(msgP, { host: msgDiv });").length - 1, 2);
  assert.match(popups, /bindXEmbedsSwitch\(document\.getElementById\('popup-x-embeds'\)\);/);
  const text = read("../popuptext.js");
  assert.match(text, /paintHashtags\(state\.flow, state\.text\);\s*paintXEmbeds\(bubble, \{ host: state\.host \}\);/);
  assert.match(text, /paintHashtags\(pageText, state\.text\);\s*\/\/[^\n]*\n\s*paintXEmbeds\(pageText, \{ after: pageText\.parentElement \}\);/);
  assert.match(read("../chatimage.js"), /paintXEmbeds\(textEl, \{ after: el\.lastChild \}\);/);
  assert.match(read("../swapsheet.js"), /body\.textContent = text;[\s\S]{0,200}paintXEmbeds\(body,/);
  assert.match(read("../handleallmessages.js"), /row\.after\(bioEl\);\s*paintXEmbeds\(bioEl\);/);
  assert.match(read("../loadBio4PIC.js"), /bioEl\.classList\.toggle\('is-empty', !hasBio\);\s*\/\/[^\n]*\n\s*paintXEmbeds\(bioEl\);/);

  // Settings > Popups: the row under Show media full size.
  const page = read("../index.html");
  const corners = page.slice(page.indexOf('class="mb-card mb-corners-card"'), page.indexOf('class="mb-card mb-color-grid"'));
  assert.ok(corners.indexOf('id="popup-x-embeds"') > corners.indexOf('id="popup-media-wide"'));
  assert.match(corners, /<button type="button" id="popup-x-embeds" class="feed-settings-switch mb-switch-row" role="switch" aria-checked="true"><span>Show X embeds<\/span><span class="feed-settings-switch-ui" aria-hidden="true"><\/span><\/button>\s*<\/div>/);

  // Sized from the page's own units: no new px in the card's rules.
  const css = read("../style.css");
  const cards = css.slice(css.indexOf("/* ── X post cards (xembed.js)"));
  assert.ok(cards.length > 100);
  assert.equal(/\d(\.\d+)?px/.test(cards), false);
  assert.match(cards, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(cards, /:where\(\.x-embed-list, \.x-embed-list \*\) \{\s*touch-action: pan-y;/);
});
