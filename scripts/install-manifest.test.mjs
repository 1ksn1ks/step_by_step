// A manifest per community (server/installmanifest.js): which starts are
// installed as their own app, what the manifest says, the community's
// picture as install icons, and the routes. The server's tables are
// stubbed; the routes run on a real express app.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import sharp from "sharp";
import {
  COMMUNITY_ICONS,
  ICON_CACHE_CONTROL,
  communityIconPath,
  communityIconRoute,
  communityManifest,
  createCommunities,
  createIconMaker,
  createRegistry,
  installTargetRoute,
  manifestRoute,
  pictureKey,
  renderCommunityIcon,
} from "../server/installmanifest.js";
import { DEFAULT_TOPIC } from "../installtarget.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const BASE = JSON.parse(read("../public/manifest.webmanifest"));

const NOW_S = 3_000_000;
const registryMessages = [
  { sequence_number: 1, payer: "0.0.11", domain: "zagreb", topic: "0.0.500", consensus_timestamp: `${NOW_S - 100}.0` },
  { sequence_number: 2, payer: "0.0.12", domain: "badtopic", topic: "not-a-topic", consensus_timestamp: `${NOW_S - 100}.0` },
  { sequence_number: 3, payer: "0.0.13", domain: "lapsed", topic: "0.0.600", consensus_timestamp: `${NOW_S - 9_000_000}.0` },
];
const PIC_OWNER = "https://pub.example.r2.dev/owner.png";
const PIC_LINKED = "https://pub.example.r2.dev/linked.png";

function makeCommunities({ known = ["0.0.500", "0.0.700"], names = { "0.0.700": "Runners Club" } } = {}) {
  let reads = 0;
  let version = 1;
  let clock = NOW_S * 1000;
  const registry = createRegistry({
    readMessages: () => {
      reads += 1;
      return registryMessages;
    },
    version: () => version,
    now: () => clock,
  });
  const communities = createCommunities({
    registry,
    topicKnown: (topic) => topic === DEFAULT_TOPIC || known.includes(topic),
    topicName: (topic) => names[topic] || "",
    pictureFor: ({ topic, owner }) => {
      if (owner === "0.0.11") return PIC_OWNER;
      if (topic === "0.0.700") return PIC_LINKED;
      return "";
    },
  });
  return {
    communities,
    reads: () => reads,
    bump: () => { version += 1; },
    tick: (ms) => { clock += ms; },
  };
}

test("the registry is read once, then again when its topic changes or a minute passes", () => {
  const c = makeCommunities();
  assert.equal(c.communities.resolve("zagreb").topic, "0.0.500");
  c.communities.resolve("zagreb");
  c.communities.resolve("lapsed");
  assert.equal(c.reads(), 1);
  c.bump();
  c.communities.resolve("zagreb");
  assert.equal(c.reads(), 2);
  c.tick(60 * 1000);
  c.communities.resolve("zagreb");
  assert.equal(c.reads(), 3);
});

test("a start is the default, a known topic or a live registered name; nothing else", () => {
  const { communities } = makeCommunities();
  const def = communities.resolve("");
  assert.deepEqual({ start: def.start, topic: def.topic, label: def.label }, { start: "", topic: DEFAULT_TOPIC, label: "Meritocracy" });
  assert.equal(communities.resolve(DEFAULT_TOPIC).start, "");
  const topic = communities.resolve("0.0.700");
  assert.equal(topic.label, "Meritocracy · Runners Club");
  assert.equal(topic.picture, PIC_LINKED);
  assert.equal(topic.key, pictureKey(PIC_LINKED));
  assert.equal(communities.resolve("0.0.500").label, "Meritocracy · 0.0.500", "a topic with no name shows its id");
  const name = communities.resolve("Zagreb");
  assert.deepEqual(
    { start: name.start, topic: name.topic, label: name.label, picture: name.picture },
    { start: "zagreb", topic: "0.0.500", label: "Meritocracy · zagreb", picture: PIC_OWNER },
  );
  // Unknown topic, unregistered, lapsed, pointing nowhere, malformed.
  for (const start of ["0.0.999", "nowhere", "lapsed", "badtopic", "a/b", "x".repeat(70)]) {
    assert.equal(communities.resolve(start), null, start);
  }
});

test("a community's manifest is its own app: id and start_url its path, scope /, its names", () => {
  const { communities } = makeCommunities();
  const zagreb = communityManifest(BASE, communities.resolve("zagreb"));
  assert.equal(zagreb.id, "/zagreb");
  assert.equal(zagreb.start_url, "/zagreb");
  assert.equal(zagreb.scope, "/");
  assert.equal(zagreb.name, "Meritocracy · zagreb");
  assert.equal(zagreb.short_name, "zagreb");
  assert.equal(zagreb.display, BASE.display);
  assert.deepEqual(zagreb.icons, BASE.icons, "the app icon unless the picture is asked for");
  assert.equal("related_applications" in zagreb, false, "no claim on the default app");
  assert.deepEqual(Object.keys(zagreb).slice(0, 2), ["id", "name"]);

  const custom = communityManifest(BASE, communities.resolve("0.0.700"), { label: "Runners", icon: "pic" });
  assert.equal(custom.id, "/0.0.700");
  assert.equal(custom.name, "Runners");
  assert.equal(custom.short_name, "Runners");
  const key = pictureKey(PIC_LINKED);
  assert.deepEqual(custom.icons, [
    { src: `/icons/community/0.0.700/${key}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `/icons/community/0.0.700/${key}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: `/icons/community/0.0.700/${key}/icon-512-maskable.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]);
  // Asking for a picture the community does not have is the app icon.
  assert.deepEqual(communityManifest(BASE, communities.resolve("0.0.500"), { icon: "pic" }).icons, BASE.icons);
  // The default with its own name stays the default app.
  const mine = communityManifest(BASE, communities.resolve(""), { label: "My map" });
  assert.equal(mine.id, "/");
  assert.equal(mine.start_url, "/");
  assert.equal(mine.name, "My map");
  assert.deepEqual(mine.related_applications, BASE.related_applications);
});

async function solidPng(size, color) {
  return sharp({ create: { width: size, height: size, channels: 4, background: color } }).png().toBuffer();
}

test("an icon is the picture's centre filling the square, opaque, at each size", async () => {
  const transparent = await solidPng(384, { r: 255, g: 0, b: 0, alpha: 0 });
  for (const [file, { size }] of Object.entries(COMMUNITY_ICONS)) {
    const png = await renderCommunityIcon(transparent, file);
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, "png", file);
    assert.equal(meta.width, size, file);
    assert.equal(meta.height, size, file);
    assert.equal(meta.hasAlpha, false, `${file} is flattened`);
    const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([...data.subarray(0, 3)], [10, 10, 10], "on the app's background");
  }
  await assert.rejects(renderCommunityIcon(transparent, "evil.png"));
});

function app({ communities, getThumb }) {
  const server = express();
  const icons = createIconMaker({ getThumb });
  server.get("/manifest.webmanifest", manifestRoute({ readBase: () => BASE, communities }));
  server.get("/manifest.webmanifest", (req, res) => res.type("application/manifest+json").send("STATIC"));
  server.get("/api/install-target", installTargetRoute({ communities }));
  server.get("/icons/community/:start/:key/:file", communityIconRoute({ communities, icons }));
  return { server, icons };
}

async function listen(server) {
  const http = await new Promise((resolve) => {
    const s = server.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${http.address().port}`;
  return { base, close: () => new Promise((resolve) => http.close(resolve)) };
}

test("the manifest route: the plain file untouched, a community's own, a bad start the default app", async (t) => {
  const { communities } = makeCommunities();
  const { server } = app({ communities, getThumb: async () => ({ ok: false, status: 404 }) });
  const { base, close } = await listen(server);
  t.after(close);
  const plain = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(await plain.text(), "STATIC");

  const res = await fetch(`${base}/manifest.webmanifest?start=zagreb&n=%E2%80%AEZagreb%20Club%E2%80%8B&icon=pic`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^application\/manifest\+json/);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  const zagreb = await res.json();
  assert.equal(zagreb.id, "/zagreb");
  assert.equal(zagreb.name, "Zagreb Club", "bidi and zero-width marks are gone");
  assert.equal(zagreb.icons[0].src, communityIconPath("zagreb", pictureKey(PIC_OWNER), "icon-192.png"));

  for (const query of ["start=nowhere", "start=0.0.999", "start=a%2Fb", "start=lapsed&icon=pic"]) {
    const fallback = await (await fetch(`${base}/manifest.webmanifest?${query}`)).json();
    assert.equal(fallback.id, "/", query);
    assert.equal(fallback.start_url, "/", query);
    assert.deepEqual(fallback.icons, BASE.icons, query);
  }
});

test("install-target says what a start opens, and 404 for one it does not know", async (t) => {
  const { communities } = makeCommunities();
  const { server } = app({ communities, getThumb: async () => ({ ok: false, status: 404 }) });
  const { base, close } = await listen(server);
  t.after(close);
  const zagreb = await (await fetch(`${base}/api/install-target?start=zagreb`)).json();
  const key = pictureKey(PIC_OWNER);
  assert.deepEqual(zagreb, {
    ok: true,
    start: "zagreb",
    topic: "0.0.500",
    name: "zagreb",
    label: "Meritocracy · zagreb",
    path: "/zagreb",
    picture: {
      key,
      icon: `/icons/community/zagreb/${key}/icon-192.png`,
      apple: `/icons/community/zagreb/${key}/apple-touch-icon.png`,
    },
  });
  const def = await (await fetch(`${base}/api/install-target`)).json();
  assert.deepEqual({ start: def.start, label: def.label, path: def.path, picture: def.picture }, { start: "", label: "Meritocracy", path: "/", picture: null });
  const unknown = await fetch(`${base}/api/install-target?start=nowhere`);
  assert.equal(unknown.status, 404);
});

test("community icons: drawn from the profile picture's thumbnail, kept, immutable, and only for its current picture", async (t) => {
  const { communities } = makeCommunities();
  const thumb = await solidPng(384, { r: 200, g: 40, b: 40, alpha: 1 });
  const asked = [];
  const { server, icons } = app({
    communities,
    getThumb: async (source, { ip }) => {
      asked.push([source, typeof ip]);
      return { ok: true, status: 200, bytes: thumb };
    },
  });
  const { base, close } = await listen(server);
  t.after(close);
  const key = pictureKey(PIC_OWNER);
  const url = `${base}${communityIconPath("zagreb", key, "icon-512-maskable.png")}`;
  const [one, two] = await Promise.all([fetch(url), fetch(url)]);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.equal(one.headers.get("content-type"), "image/png");
  assert.equal(one.headers.get("cache-control"), ICON_CACHE_CONTROL);
  const meta = await sharp(Buffer.from(await one.arrayBuffer())).metadata();
  assert.equal(meta.width, 512);
  assert.deepEqual(asked, [[PIC_OWNER, "string"]], "one picture read for two requests, by the server's choice of source");
  await fetch(url);
  assert.equal(asked.length, 1, "kept in memory");
  assert.equal(icons.size, 1);
  const again = await fetch(url, { headers: { "If-None-Match": one.headers.get("etag") } });
  assert.equal(again.status, 304);

  // Wrong file, malformed key, an old key, a community without a picture, unknown.
  for (const path of [
    `/icons/community/zagreb/${key}/evil.png`,
    `/icons/community/zagreb/xyz/icon-192.png`,
    `/icons/community/zagreb/${pictureKey("https://old.example/pic.png")}/icon-192.png`,
    `/icons/community/0.0.500/${key}/icon-192.png`,
    `/icons/community/nowhere/${key}/icon-192.png`,
  ]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get("cache-control"), "no-store", path);
  }
  assert.equal(asked.length, 1);
});

test("a picture the avatar pipeline cannot draw is its error, not cached", async (t) => {
  const { communities } = makeCommunities();
  let calls = 0;
  const { server } = app({
    communities,
    getThumb: async () => {
      calls += 1;
      return { ok: false, status: 503, error: "busy", retryAfter: 10 };
    },
  });
  const { base, close } = await listen(server);
  t.after(close);
  const url = `${base}${communityIconPath("0.0.700", pictureKey(PIC_LINKED), "icon-192.png")}`;
  const res = await fetch(url);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "10");
  assert.equal(res.headers.get("cache-control"), "no-store");
  await fetch(url);
  assert.equal(calls, 2);
});

test("the server wires it up: the registry kept warm, the routes before the static files, a profile's picture only", () => {
  const index = read("../server/index.js");
  assert.match(index, /q\.upsertTopic\.run\(DOMAIN_TOPIC, now\);/);
  const routes = index.indexOf('app.get(\n  "/manifest.webmanifest",');
  const statics = index.indexOf("app.use(express.static(distDir");
  assert.ok(routes > 0 && statics > routes, "the community manifest comes before dist");
  assert.match(index, /\(req, res, next\) => \(hasManifestQuery\(req\.query\) \? publicPostLimit\(req, res, next\) : next\(\)\)/);
  assert.match(index, /app\.get\("\/api\/install-target", publicPostLimit, installTargetRoute\(\{ communities \}\)\);/);
  assert.match(index, /app\.get\("\/icons\/community\/:start\/:key\/:file", avatarLimit, communityIconRoute/);
  assert.match(index, /isProfileSource: profileSources\.has,\s*seen: avatarSeen,\s*\}\),\s*\}\);/);
  assert.match(index, /const allowed = \(pic\) => typeof pic === "string" && profileSources\.has\(avatarSource\(pic\)\);/);
  // Dev proxies the same requests to the backend; the plain manifest stays Vite's.
  const vite = read("../vite.config.js");
  assert.match(vite, /bypass: \(req\) => \(String\(req\.url \|\| ''\)\.includes\('\?'\) \? undefined : req\.url\)/);
  assert.equal(vite.split("...communityInstallProxy,").length - 1, 2);
});
