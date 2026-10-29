import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FEED_VIEW_KEEP_MS,
  ensureFeedViewTables,
  feedViewCounts,
  prepareFeedViews,
  pruneExpiredFeedViews,
  storeFeedViews,
} from "../server/feedviews.js";

const POST = "m:0.0.1:0.0.2:2019-01-01T00:00:00.000Z:1";

function tempDb() {
  const file = path.join(os.tmpdir(), `feed-views-${process.pid}-${Math.random().toString(16).slice(2)}.db`);
  const db = new DatabaseSync(file);
  return {
    db,
    close() {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    },
  };
}

test("feed view total stays the same after the 90-day prune", () => {
  const { db, close } = tempDb();
  try {
    ensureFeedViewTables(db);
    const q = prepareFeedViews(db);
    const old = Date.now() - FEED_VIEW_KEEP_MS - 1000;
    storeFeedViews(db, q, "0.0.9", [POST], old);
    storeFeedViews(db, q, "0.0.9", [POST], old);
    storeFeedViews(db, q, "00000000-0000-4000-8000-000000000001", [POST], Date.now());

    assert.equal(feedViewCounts(db, [POST])[POST], 2);
    pruneExpiredFeedViews(q);
    assert.equal(feedViewCounts(db, [POST])[POST], 2);
    assert.equal(Number(db.prepare("SELECT total FROM feed_view_totals WHERE post_id = ?").get(POST).total), 2);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM feed_views WHERE post_id = ?").get(POST).n), 1);
  } finally {
    close();
  }
});

test("an empty totals table is filled from existing viewer rows once", () => {
  const { db, close } = tempDb();
  try {
    db.exec(`
      CREATE TABLE feed_views (
        post_id TEXT NOT NULL,
        viewer TEXT NOT NULL,
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (post_id, viewer)
      );
    `);
    const old = Date.now() - FEED_VIEW_KEEP_MS - 1000;
    const insert = db.prepare("INSERT INTO feed_views (post_id, viewer, seen_at) VALUES (?, ?, ?)");
    insert.run(POST, "0.0.1", old);
    insert.run(POST, "0.0.2", Date.now());

    ensureFeedViewTables(db);
    assert.equal(feedViewCounts(db, [POST])[POST], 2);
    ensureFeedViewTables(db);
    assert.equal(feedViewCounts(db, [POST])[POST], 2);

    pruneExpiredFeedViews(prepareFeedViews(db));
    assert.equal(feedViewCounts(db, [POST])[POST], 2);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM feed_views").get().n), 1);
  } finally {
    close();
  }
});
