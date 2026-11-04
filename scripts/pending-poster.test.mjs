// Poster follow-ups stay with the account that uploaded the video.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPendingPosters, POSTER_WAIT_MS } from "../server/pendingposters.js";

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

test("the upload route checks the poster account and sweeps with the upload limits", () => {
  const src = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(src, /notePendingPoster\(key, account\)/);
  assert.match(src, /posterFollowUpLive\(posterKey, account\)/);
  assert.match(src, /consumePendingPoster\(posterKey, account\)/);
  assert.match(src, /restorePendingPoster\(posterKey, account\)/);
  assert.match(src, /posterHolds\.sweep\(now\)/);
  assert.match(src, /error: "Bad poster"/);
});
