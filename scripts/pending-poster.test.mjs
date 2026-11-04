// Poster follow-ups stay with the account that uploaded the video.
// A later edit uses a stateless HMAC. The account is not stored.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createPendingPosters, issuePosterEdit, posterEditMatches, POSTER_EDIT_DAYS, POSTER_WAIT_MS } from "../server/pendingposters.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const DAY_MS = 24 * 60 * 60 * 1000;
const ISSUED = Date.UTC(2026, 0, 15);

function expectedToken(posterKey, account, now = ISSUED) {
  const day = Math.floor(now / DAY_MS);
  const key = crypto.createHmac("sha256", SECRET).update("poster-edit").digest();
  const mac = crypto.createHmac("sha256", key).update(`${posterKey}\n${account}\n${day}`).digest("base64url");
  return `${day}.${mac}`;
}

test("a poster follow-up is only accepted from the uploading account", () => {
  assert.equal(POSTER_WAIT_MS, 2 * 60 * 1000);
  let now = 1_000_000;
  const posters = createPendingPosters(() => now);
  posters.note("markers/1-ab.mp4", "0.0.9");
  posters.note("markers/1-ab.mov", "0.0.9");
  assert.equal(posters.size(), 1);
  assert.equal(posters.live("markers/1-ab.poster.jpg", "0.0.9"), true);
  assert.equal(posters.live("markers/1-ab.poster.jpg", "0.0.8"), false);
  assert.equal(posters.size(), 1);
  assert.equal(posters.consume("markers/1-ab.poster.jpg", "0.0.8"), false);
  assert.equal(posters.consume("markers/1-ab.poster.jpg", "0.0.9"), true);
  assert.equal(posters.consume("markers/1-ab.poster.jpg", "0.0.9"), false);
  assert.equal(posters.size(), 0);
});

test("an anonymous poster follow-up matches only another anonymous upload", () => {
  const posters = createPendingPosters(() => 50);
  posters.note("markers/4-gh.webm", null);
  assert.equal(posters.live("markers/4-gh.poster.jpg", null), true);
  assert.equal(posters.live("markers/4-gh.poster.jpg", ""), true);
  assert.equal(posters.live("markers/4-gh.poster.jpg", "0.0.1"), false);
  assert.equal(posters.consume("markers/4-gh.poster.jpg", "0.0.1"), false);
  assert.equal(posters.consume("markers/4-gh.poster.jpg", null), true);
});

test("a failed poster put keeps the slot for the same account", () => {
  const posters = createPendingPosters(() => 80);
  posters.note("markers/5-ij.mp4", "0.0.7");
  assert.equal(posters.consume("markers/5-ij.poster.jpg", "0.0.7"), true);
  posters.restore("markers/5-ij.poster.jpg", "0.0.7");
  assert.equal(posters.consume("markers/5-ij.poster.jpg", "0.0.2"), false);
  assert.equal(posters.consume("markers/5-ij.poster.jpg", "0.0.7"), true);
});

test("expired poster holds are dropped on the upload sweep", () => {
  let now = 5_000;
  const posters = createPendingPosters(() => now);
  posters.note("markers/2-cd.webm", "0.0.3");
  const first = now;
  now += 10;
  posters.note("markers/3-ef.mp4", "0.0.4");
  now = first + POSTER_WAIT_MS;
  assert.equal(posters.live("markers/2-cd.poster.jpg", "0.0.3"), true);
  now = first + POSTER_WAIT_MS + 1;
  posters.sweep(now);
  assert.equal(posters.live("markers/2-cd.poster.jpg", "0.0.3"), false);
  assert.equal(posters.live("markers/3-ef.poster.jpg", "0.0.4"), true);
  assert.equal(posters.size(), 1);
  now = first + 10 + POSTER_WAIT_MS + 1;
  posters.sweep(now);
  assert.equal(posters.size(), 0);
});

test("a verified poster edit arms the follow-up for that account", () => {
  const posters = createPendingPosters(() => 10);
  assert.equal(posters.arm("", "0.0.1"), false);
  assert.equal(posters.arm("markers/9-zz.poster.jpg", ""), false);
  assert.equal(posters.arm("markers/9-zz.poster.jpg", null), false);
  assert.equal(posters.arm("markers/9-zz.poster.jpg", "0.0.1"), true);
  assert.equal(posters.live("markers/9-zz.poster.jpg", "0.0.2"), false);
  assert.equal(posters.size(), 1);
  assert.equal(posters.live("markers/9-zz.poster.jpg", "0.0.1"), true);
  assert.equal(posters.consume("markers/9-zz.poster.jpg", "0.0.2"), false);
  assert.equal(posters.consume("markers/9-zz.poster.jpg", "0.0.1"), true);
  assert.equal(posters.size(), 0);
});

test("a poster edit token is an HMAC of the poster key, account, and issued day", () => {
  const posterKey = "markers/9-zz.poster.jpg";
  const token = issuePosterEdit("markers/9-zz.mp4", "0.0.1", SECRET, ISSUED);
  assert.equal(POSTER_EDIT_DAYS, 7);
  assert.equal(token, expectedToken(posterKey, "0.0.1"));
  assert.match(token, /^\d+\.[A-Za-z0-9_-]+$/);
  assert.equal(issuePosterEdit("markers/9-zz.webm", "0.0.1", SECRET, ISSUED), expectedToken("markers/9-zz.poster.jpg", "0.0.1"));
  assert.equal(posterEditMatches(posterKey, "0.0.1", token, SECRET, ISSUED), true);
  assert.equal(posterEditMatches(posterKey, "0.0.1", `  ${token}  `, SECRET, ISSUED), true);
  assert.equal(posterEditMatches(posterKey, "0.0.2", token, SECRET, ISSUED), false);
  assert.equal(posterEditMatches("markers/8-yy.poster.jpg", "0.0.1", token, SECRET, ISSUED), false);
  assert.equal(posterEditMatches(posterKey, "0.0.1", token.slice(0, -1), SECRET, ISSUED), false);
  assert.equal(posterEditMatches(posterKey, "0.0.1", `${token}a`, SECRET, ISSUED), false);
  assert.equal(posterEditMatches(posterKey, "0.0.1", "", SECRET, ISSUED), false);
  assert.equal(posterEditMatches(posterKey, "0.0.1", token, SECRET + "x", ISSUED), false);
  const mac = token.slice(token.indexOf(".") + 1);
  const day = Number(token.slice(0, token.indexOf(".")));
  assert.equal(posterEditMatches(posterKey, "0.0.1", `${day - 1}.${mac}`, SECRET, ISSUED), false);
  assert.equal(issuePosterEdit("markers/9-zz.mov", "0.0.1", SECRET, ISSUED), "");
  assert.equal(issuePosterEdit("markers/9-zz.mp4", "", SECRET, ISSUED), "");
  assert.equal(issuePosterEdit("markers/9-zz.mp4", null, SECRET, ISSUED), "");
  assert.equal(issuePosterEdit("markers/9-zz.mp4", "0.0.1", "short", ISSUED), "");
  assert.equal(issuePosterEdit("markers/9-zz.mp4", "0.0.1", SECRET, Number.NaN), "");
  assert.equal(token.includes("0.0.1"), false);
  const posters = readFileSync(new URL("../server/pendingposters.js", import.meta.url), "utf8");
  assert.match(posters, /timingSafeEqual\(given, expected\)/);
  assert.doesNotMatch(posters, /owners/);
});

test("a poster edit token older than 7 days, in the future, or malformed is rejected", () => {
  const posterKey = "markers/9-zz.poster.jpg";
  const token = issuePosterEdit("markers/9-zz.mp4", "0.0.1", SECRET, ISSUED);
  assert.equal(posterEditMatches(posterKey, "0.0.1", token, SECRET, ISSUED + 7 * DAY_MS), true);
  assert.equal(posterEditMatches(posterKey, "0.0.1", token, SECRET, ISSUED + 8 * DAY_MS - 1), true);
  assert.equal(posterEditMatches(posterKey, "0.0.1", token, SECRET, ISSUED + 8 * DAY_MS), false);
  const future = issuePosterEdit("markers/9-zz.mp4", "0.0.1", SECRET, ISSUED + 2 * DAY_MS);
  assert.equal(posterEditMatches(posterKey, "0.0.1", future, SECRET, ISSUED), false);
  assert.equal(posterEditMatches(posterKey, "0.0.1", future, SECRET, ISSUED + 2 * DAY_MS), true);
  for (const bad of [
    token.slice(token.indexOf(".") + 1),
    token.replace(".", ""),
    `${token}.extra`,
    `.${token.slice(token.indexOf(".") + 1)}`,
    `0${token}`,
    token.slice(0, token.indexOf(".")) + ".",
    "-1.abcd",
    "nope",
    "12 3.abcd",
  ]) {
    assert.equal(posterEditMatches(posterKey, "0.0.1", bad, SECRET, ISSUED), false, bad);
  }
  assert.equal(posterEditMatches(posterKey, "0.0.1", token, SECRET, Number.NaN), false);
});

test("the upload route checks the poster token and sweeps with the upload limits", () => {
  const src = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../uploadmedia.js", import.meta.url), "utf8");
  assert.match(src, /DROP TABLE IF EXISTS video_owners/);
  assert.doesNotMatch(src, /CREATE TABLE IF NOT EXISTS video_owners/);
  assert.doesNotMatch(src, /INSERT INTO video_owners/);
  assert.doesNotMatch(src, /SELECT poster_key, account FROM video_owners/);
  assert.match(src, /notePendingPoster\(key, account\)/);
  assert.match(src, /posterFollowUpLive\(posterKey, account\)/);
  assert.match(src, /consumePendingPoster\(posterKey, account\)/);
  assert.match(src, /restorePendingPoster\(posterKey, account\)/);
  assert.match(src, /posterHolds\.sweep\(now\)/);
  assert.match(src, /posterHolds\.arm\(posterKey, account\)/);
  assert.match(src, /issuePosterEdit\(key, account, uploadTokenSecret\(\)\)/);
  assert.match(src, /posterEditMatches\(posterKey, account, posterEdit, uploadTokenSecret\(\)\)/);
  assert.match(src, /x-poster-edit/);
  assert.match(src, /x-sealed/);
  assert.match(src, /uploaded\.posterEdit = posterEdit/);
  assert.doesNotMatch(src, /posterHolds\.remember/);
  assert.doesNotMatch(src, /posterHolds\.owner/);
  assert.match(src, /app\.post\("\/api\/upload\/poster"/);
  assert.match(src, /x-poster-clear/);
  assert.match(src, /error: "Bad poster"/);
  assert.match(client, /X-Poster-Edit/);
  assert.match(client, /const edit = posterEditFor\(videoUrl\);\r?\n\s+if \(edit\) xhr\.setRequestHeader\("X-Poster-Edit", edit\)/);
  assert.doesNotMatch(client, /issuedDay|posterEditDay/);
  assert.match(client, /X-Poster-For/);
  assert.match(client, /X-Poster-Clear/);
  assert.match(client, /X-Expect-Poster/);
  assert.match(client, /X-Sealed/);
  assert.match(client, /localStorage\.setItem\(POSTER_EDIT_STORE, JSON\.stringify\(map\)\)/);
  assert.match(client, /xhr\.response\.posterEdit/);
  assert.match(client, /if \(!seal && typeof xhr\.response\.posterEdit === "string"\) rememberPosterEdit/);
  assert.match(client, /const POSTER_EDIT_MAX = 50/);
  assert.match(client, /const POSTER_EDIT_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(client, /\{ t: edit, at: now \}/);
  assert.match(client, /localStorage\.removeItem\(POSTER_EDIT_STORE\)/);
  assert.match(client, /getElementById\("account-id"\)/);
  assert.match(client, /if \(left\) clearPosterEdits\(\)/);
});
