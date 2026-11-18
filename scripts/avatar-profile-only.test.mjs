// /api/avatar.webp makes thumbnails of profile pictures only (server/avatar.js,
// createProfileSources, wired in server/index.js): every account's current
// picture and the default avatar, however the page spells the link. Any
// other source is a 404 before R2 or the network is touched; the page reads
// it as "this picture only" and draws the link itself.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import sharp from "sharp";

import { avatarRouteAnswerDown, avatarSource } from "../avatarsrc.js";
import { DEFAULT_AVATAR } from "../hashinalurl.js";
import { avatarKey, avatarRoute, clearAvatarCache, createProfileSources, getAvatarThumb } from "../server/avatar.js";

const png = await sharp({ create: { width: 48, height: 48, channels: 3, background: { r: 200, g: 10, b: 10 } } }).png().toBuffer();
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function readFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  for (let end = source.indexOf("{", start); end < source.length; end++) {
    if (source[end] === "{") depth += 1;
    else if (source[end] === "}" && --depth === 0) return source.slice(start, end + 1);
  }
  throw new Error(`no end for ${name}`);
}

// An R2 bucket in a Map that records every command it is sent.
function fakeR2() {
  const objects = new Map();
  const sent = [];
  return {
    objects,
    sent,
    async send(command) {
      const kind = command.constructor.name;
      sent.push(kind);
      const { Key } = command.input;
      if (kind === "PutObjectCommand") {
        objects.set(Key, Buffer.from(command.input.Body));
        return {};
      }
      const body = objects.get(Key);
      if (!body) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      if (kind === "HeadObjectCommand") return { ContentLength: body.length };
      return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
    },
  };
}

async function serve(app) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const TOPIC = "0.0.4840719";
const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

test("a profile picture matches however the page spells it, and stays while any account shows it", () => {
  const sources = createProfileSources([DEFAULT_AVATAR]);
  assert.equal(sources.has(avatarSource(DEFAULT_AVATAR)), true, "the default avatar");
  assert.equal(sources.has("hcs://1/0.0.4819119"), true);

  sources.add(`hcs://1/${TOPIC}`);
  for (const link of [`hcs://1/${TOPIC}`, `https://kiloscribe.com/api/inscription-cdn/${TOPIC}`, `/api/hcs1/${TOPIC}`, `https://app.test/api/hcs1/${TOPIC}`]) {
    assert.equal(sources.has(avatarSource(link)), true, link);
  }
  sources.add(`https://ipfs.io/ipfs/${CID}/me.png`);
  assert.equal(sources.has(avatarSource(`https://gateway.pinata.cloud/ipfs/${CID}/me.png`)), true, "any gateway");
  assert.equal(sources.has(avatarSource("https://cdn.example/a.png#face")), false);

  // Two accounts show one picture: it stays until neither does.
  const shared = "https://cdn.example/shared.png";
  sources.replace("", shared);
  sources.replace("", shared);
  sources.replace(shared, "https://cdn.example/next.png");
  assert.equal(sources.has(avatarSource(shared)), true, "the other account still shows it");
  sources.replace(shared, "https://cdn.example/other.png");
  assert.equal(sources.has(avatarSource(shared)), false);
  assert.equal(sources.has(avatarSource("https://cdn.example/next.png")), true);

  // The default avatar stays allowed when an account that showed it moves on.
  sources.add(DEFAULT_AVATAR);
  sources.replace(DEFAULT_AVATAR, "https://cdn.example/mine.png");
  assert.equal(sources.has(avatarSource(DEFAULT_AVATAR)), true);

  // Links no thumbnail is made of are not counted.
  const size = sources.size;
  for (const link of ["javascript:alert(1)", "https://cdn.example/clip.mp4", "", null]) sources.add(link);
  assert.equal(sources.size, size);
  assert.equal(sources.has(undefined), false);
});

test("a source that is not a profile's picture is a 404 before R2 or the network is touched, and not remembered", async () => {
  clearAvatarCache();
  const sources = createProfileSources([DEFAULT_AVATAR]);
  const r2 = fakeR2();
  const asked = [];
  const fetchSource = async (url) => {
    asked.push(url);
    return png;
  };
  const opts = { fetchSource, s3: r2, bucket: "b", isProfileSource: sources.has };
  const stranger = "https://random.example/anything.png";
  for (let i = 0; i < 3; i += 1) {
    const refused = await getAvatarThumb(stranger, opts);
    assert.deepEqual([refused.ok, refused.status, refused.error], [false, 404, "not a profile picture"]);
  }
  assert.deepEqual(asked, [], "never fetched");
  assert.deepEqual(r2.sent, [], "R2 never asked or written");

  // The SSRF guard still answers first.
  assert.equal((await getAvatarThumb("http://127.0.0.1/a.png", opts)).status, 403);
  assert.equal((await getAvatarThumb("http://169.254.169.254/latest/meta-data", opts)).status, 403);
  assert.equal((await getAvatarThumb("ftp://cdn.example/a.png", opts)).status, 400);

  // Once it is someone's picture it is made at once: the refusal was not kept.
  sources.add(stranger);
  const made = await getAvatarThumb(stranger, opts);
  assert.deepEqual([made.ok, made.from], [true, "built"]);
  assert.deepEqual(asked, [stranger]);
  assert.equal(r2.objects.has(avatarKey(avatarSource(stranger))), true);

  // The account moves to another picture: the one in memory is still
  // served, nothing new is made; after a restart it is refused again.
  sources.remove(stranger);
  assert.equal((await getAvatarThumb(stranger, opts)).from, "memory");
  clearAvatarCache();
  assert.equal((await getAvatarThumb(stranger, opts)).status, 404);
  assert.deepEqual(asked, [stranger]);
  clearAvatarCache();
});

test("the route answers the refusal as its own 404, which the page reads as this picture only", async () => {
  clearAvatarCache();
  assert.throws(() => avatarRoute({}), /isProfileSource/, "never mounted without the check");
  const app = express();
  app.get("/api/avatar.webp", avatarRoute({ fetchSource: async () => assert.fail("fetched"), isProfileSource: createProfileSources().has }));
  const { base, close } = await serve(app);
  try {
    const res = await fetch(`${base}/api/avatar.webp?src=${encodeURIComponent("https://random.example/a.png")}&v=1`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "private, max-age=60");
    const body = await res.json();
    assert.deepEqual(body, { ok: false, error: "not a profile picture" });
    assert.equal(avatarRouteAnswerDown(res.status, res.headers.get("content-type"), body), false, "not a route outage");
  } finally {
    await close();
  }
});

test("server/index.js makes thumbnails of profile pictures only, kept in step with user_settings", () => {
  const index = read("../server/index.js");
  assert.match(index, /const profileSources = createProfileSources\(\[DEFAULT_AVATAR\]\);/);
  assert.match(index, /SELECT profile_pic FROM user_settings WHERE profile_pic IS NOT NULL AND profile_pic != ''/);
  assert.match(index, /isProfileSource: profileSources\.has,\s*seen: avatarSeen,\s*\}\)\);/);
  // The one place a profile picture is written updates it, and it exists
  // before the startup backfill writes any.
  assert.match(readFn(index, "saveSetting"), /statement\.run\(accountId, value, tsMs, revision\);\s*if \(column === "profile_pic"\) profileSources\.replace\(row \? row\.profile_pic : "", value\);/);
  assert.equal((index.match(/profile_pic = excluded\.profile_pic/g) || []).length, 1, "one statement writes profile_pic");
  assert.equal((index.match(/saveSetting\(q\.settingPic,/g) || []).length, 1);
  assert.ok(index.indexOf("const profileSources =") < index.indexOf("\nbackfillUserSettings();"));
});
