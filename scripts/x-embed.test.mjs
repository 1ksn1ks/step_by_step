// X posts in user text: the link parser, finding links in a body, the
// device switch, loading X's widgets.js once, and how the pages are wired.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const store = new Map([["meritocracy-x-embeds", "off"]]);
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
};

const x = await import("../xembed.js");
const { parseXStatusUrl, xStatusMatches, xStatusUrl, xStatusUrlsIn } = x;

// A document and window just big enough for loadXWidgets.
function fakePage() {
  const scripts = [];
  const head = {
    appendChild(el) {
      scripts.push(el);
      el.parentNode = head;
      return el;
    },
  };
  globalThis.document = {
    head,
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        removed: false,
        remove() { this.removed = true; },
      };
    },
    dispatchEvent() { return true; },
    querySelectorAll() { return []; },
  };
  globalThis.window = { addEventListener() {} };
  return scripts;
}

test("post links on x.com and twitter.com are accepted and made canonical", () => {
  const cases = [
    ["https://x.com/jack/status/20", "https://twitter.com/jack/status/20"],
    ["https://twitter.com/jack/status/20", "https://twitter.com/jack/status/20"],
    ["https://www.x.com/jack/status/20", "https://twitter.com/jack/status/20"],
    ["https://www.twitter.com/jack/status/20", "https://twitter.com/jack/status/20"],
    ["https://mobile.twitter.com/jack/status/20", "https://twitter.com/jack/status/20"],
    ["https://mobile.x.com/jack/status/20", "https://twitter.com/jack/status/20"],
    // http becomes https.
    ["http://x.com/jack/status/20", "https://twitter.com/jack/status/20"],
    // Query and hash are ignored.
    ["https://x.com/jack/status/20?s=46&t=abc", "https://twitter.com/jack/status/20"],
    ["https://x.com/jack/status/20#reply", "https://twitter.com/jack/status/20"],
    // A trailing /photo/N or /video/N names the same post.
    ["https://x.com/jack/status/20/photo/1", "https://twitter.com/jack/status/20"],
    ["https://twitter.com/jack/status/20/video/2?s=46", "https://twitter.com/jack/status/20"],
    ["https://x.com/jack/status/20/", "https://twitter.com/jack/status/20"],
    // No user in the path.
    ["https://x.com/i/web/status/1790000000000000000", "https://twitter.com/i/web/status/1790000000000000000"],
    ["https://twitter.com/i/status/1790000000000000000", "https://twitter.com/i/web/status/1790000000000000000"],
    // Case of the host and the fixed words does not matter.
    ["HTTPS://X.COM/Jack_99/Status/20", "https://twitter.com/Jack_99/status/20"],
    ["  https://x.com/jack/status/20  ", "https://twitter.com/jack/status/20"],
    ["https://x.com:443/jack/status/20", "https://twitter.com/jack/status/20"],
  ];
  for (const [input, want] of cases) assert.equal(xStatusUrl(input), want, input);
  assert.deepEqual(parseXStatusUrl("https://x.com/bot/status/1990000000000000001/video/1"), {
    url: "https://twitter.com/bot/status/1990000000000000001",
    user: "bot",
    id: "1990000000000000001",
  });
  assert.deepEqual(parseXStatusUrl("https://x.com/i/web/status/42"), {
    url: "https://twitter.com/i/web/status/42",
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
    "https://platform.twitter.com/jack/status/20",
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
    "https://x.com/i/web/status/20 plus https://mobile.twitter.com/someone/status/1790000000000000000/photo/1.",
    "Not these: https://x.com/jack https://example.com/a/status/9 foohttps://x.com/a/status/7",
  ].join("\n");
  assert.deepEqual(xStatusUrlsIn(body), [
    "https://twitter.com/jack/status/20",
    "https://twitter.com/someone/status/1790000000000000000",
  ]);
  assert.deepEqual(xStatusUrlsIn(""), []);
  assert.deepEqual(xStatusUrlsIn(null), []);
  assert.deepEqual(xStatusUrlsIn("no links #here 0.0.123"), []);
  assert.deepEqual(xStatusUrlsIn("https://x.com/a/status/1!https://x.com/b/status/2"), []);
  assert.deepEqual(xStatusUrlsIn("end https://x.com/a/status/1?"), ["https://twitter.com/a/status/1"]);
  // X's own embed code pasted as text still names the post once.
  const pasted = '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Every driver needs their crew. <a href="https://t.co/abc">pic.twitter.com/abc</a></p>&mdash; Grok Bot (@bot) <a href="https://twitter.com/bot/status/1990000000000000001?ref_src=twsrc%5Etfw">November 16, 2026</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>';
  assert.deepEqual(xStatusUrlsIn(pasted), ["https://twitter.com/bot/status/1990000000000000001"]);
});

test("xStatusMatches says where each link sits and what text an anchor covers", () => {
  const text = "a https://x.com/jack/status/20. b http://twitter.com/jack/status/20/photo/1)";
  const hits = xStatusMatches(text);
  assert.deepEqual(hits.map((hit) => [hit.index, hit.raw, hit.url, hit.id]), [
    [2, "https://x.com/jack/status/20", "https://twitter.com/jack/status/20", "20"],
    [34, "http://twitter.com/jack/status/20/photo/1", "https://twitter.com/jack/status/20", "20"],
  ]);
  for (const hit of hits) assert.equal(text.slice(hit.index, hit.index + hit.raw.length), hit.raw);
});

test("the device switch is meritocracy-x-embeds, on unless stored off", () => {
  assert.equal(x.X_EMBEDS_KEY, "meritocracy-x-embeds");
  assert.equal(x.xEmbedsOn(), false);
  x.setXEmbedsOn(true);
  assert.equal(x.xEmbedsOn(), true);
  assert.equal(store.get("meritocracy-x-embeds"), "on");
});

test("widgets.js is added once, async, and every embed shares its promise", async () => {
  const scripts = fakePage();
  const first = x.loadXWidgets();
  const second = x.loadXWidgets();
  assert.equal(first, second);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "https://platform.twitter.com/widgets.js");
  assert.equal(scripts[0].async, true);
  const twttr = {
    widgets: { createTweet: async () => ({}) },
    ready(fn) { fn(this); },
  };
  window.twttr = twttr;
  scripts[0].onload();
  assert.equal(await first, twttr);
  assert.equal(x.loadXWidgets(), first);
  assert.equal(scripts.length, 1);
  assert.deepEqual({ ...x.X_EMBED_OPTIONS }, { theme: "dark", dnt: true, conversation: "none", align: "center" });
});

test("a widgets.js that fails to load is removed and not retried at once", async () => {
  const scripts = fakePage();
  const fresh = await import("../xembed.js?load-fails");
  const first = fresh.loadXWidgets();
  scripts[0].onerror();
  await assert.rejects(first);
  assert.equal(scripts[0].removed, true);
  await assert.rejects(fresh.loadXWidgets());
  assert.equal(scripts.length, 1);
});

test("pages are wired to xembed.js, and only xembed.js loads X's script", () => {
  const client = read("../xembed.js");
  const code = (src) => src.replace(/^\s*\/\/.*$/gm, "");
  // Placeholders are built node by node; X's own script fills them.
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(code(client)), false);
  assert.match(client, /twttr\.widgets\.createTweet\(card\.dataset\.xId, frame, \{ \.\.\.X_EMBED_OPTIONS \}\)/);
  assert.match(client, /new IntersectionObserver\(onSeen, \{ root, rootMargin: NEAR_MARGIN, threshold: 0 \}\)/);
  assert.match(client, /link\.rel = 'noopener noreferrer'/);
  assert.match(client, /link\.target = '_blank'/);
  assert.match(client, /'Show post from X'/);
  assert.match(client, /return embedsOn && !dataSaverOn\(\);/);

  for (const rel of ["../feedlayout.js", "../processallmessages.js", "../popuptext.js", "../chatimage.js", "../swapsheet.js", "../handleallmessages.js", "../loadBio4PIC.js", "../index.html", "../server/index.js"]) {
    assert.equal(/widgets\.js|platform\.twitter\.com|createTweet/.test(read(rel)), false, rel);
  }
  // No server route: the browser asks X itself.
  assert.equal(existsSync(new URL("../server/xembed.js", import.meta.url)), false);
  assert.equal(read("../server/index.js").includes("x-embed"), false);

  const feed = read("../feedlayout.js");
  const media = feed.slice(feed.indexOf("const mediaSection = settingsSection('Media');"), feed.indexOf("function resizeFeedMedia"));
  assert.ok(media.indexOf("settingsSwitch('Show X posts', xEmbedsOn, setXEmbedsOn)") > media.indexOf("settingsSwitch('Data saver'"));
  assert.match(media, /writeFeedSetting\(FEED_SETTING\.data, on \? 'on' : 'off'\);\s*syncFeedVideos\(\);\s*\/\/[^\n]*\n\s*refreshXEmbeds\(\);/);
  // buildCard: after the text is placed; the title stays a plain pill.
  const build = feed.slice(feed.indexOf("function buildCard(post)"), feed.indexOf("function clampPending"));
  assert.match(build, /card\.appendChild\(text\);\s*\}\s*\/\/[^\n]*\n\s*if \(text\) paintXEmbeds\(text\);/);
  const title = feed.slice(feed.indexOf("function feedTitle"), feed.indexOf("function buildCard(post)"));
  assert.equal(title.includes("paintXEmbeds"), false);
  assert.match(feed.slice(feed.indexOf("function patchFeedCardsForEdit")), /paintHashtags\(text, msg\);\s*\/\/[^\n]*\n\s*paintXEmbeds\(text\);/);
  assert.match(feed, /fillTopicIds\(profileBio, text, 'feed-profile-topic'\);\s*\}\s*paintXEmbeds\(profileBio\);/);

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
  assert.match(corners, /<button type="button" id="popup-x-embeds" class="feed-settings-switch mb-switch-row" role="switch" aria-checked="true"><span>Show X posts<\/span><span class="feed-settings-switch-ui" aria-hidden="true"><\/span><\/button>\s*<\/div>/);

  // Sized from the page's own units: no new px in these rules.
  const css = read("../style.css");
  const rules = css.slice(css.indexOf("/* ── X posts (xembed.js)"));
  assert.ok(rules.length > 100);
  assert.equal(/\d(\.\d+)?px/.test(rules), false);
  assert.match(rules, /\.x-embed-frame iframe \{\s*max-width: 100% !important;/);
  assert.match(rules, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(rules, /:where\(\.x-embed-list, \.x-embed-list \*\) \{\s*touch-action: pan-y;/);
});
