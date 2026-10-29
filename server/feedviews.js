// One row per person per feed card. Rows in feed_views older than 90 days
// are deleted. feed_view_totals is the count and is never pruned.
// Not on-chain, and not popup_views: that counter has no viewer and counts
// map-popup opens.

export const FEED_VIEW_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export function ensureFeedViewTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_views (
      post_id TEXT NOT NULL,
      viewer  TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, viewer)
    );
    CREATE INDEX IF NOT EXISTS feed_views_seen_at ON feed_views(seen_at);
    CREATE TABLE IF NOT EXISTS feed_view_totals (
      post_id TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0
    );
  `);
  const row = db.prepare("SELECT COUNT(*) AS n FROM feed_view_totals").get();
  if (!Number(row.n)) {
    db.exec(`
      INSERT INTO feed_view_totals (post_id, total)
      SELECT post_id, COUNT(*) FROM feed_views GROUP BY post_id
    `);
  }
}

export function prepareFeedViews(db) {
  return {
    insertFeedView: db.prepare(
      "INSERT OR IGNORE INTO feed_views (post_id, viewer, seen_at) VALUES (?, ?, ?)"
    ),
    bumpFeedViewTotal: db.prepare(`
      INSERT INTO feed_view_totals (post_id, total) VALUES (?, 1)
      ON CONFLICT(post_id) DO UPDATE SET total = total + 1
    `),
    pruneFeedViews: db.prepare("DELETE FROM feed_views WHERE seen_at < ?"),
  };
}

// A new viewer row (changes === 1) adds one to that post's total.
// A repeat pair is ignored and does not change the total.
export function storeFeedViews(db, q, viewer, ids, now = Date.now()) {
  db.exec("BEGIN");
  try {
    for (const id of ids) {
      const result = q.insertFeedView.run(id, viewer, now);
      if (Number(result.changes) === 1) q.bumpFeedViewTotal.run(id);
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already closed */ }
    throw err;
  }
}

export function feedViewCounts(db, ids) {
  const counts = {};
  for (const id of ids) counts[id] = 0;
  if (!ids.length) return counts;
  const marks = ids.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT post_id, total FROM feed_view_totals WHERE post_id IN (${marks})`
  ).all(...ids);
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(counts, row.post_id)) {
      counts[row.post_id] = Number(row.total) || 0;
    }
  }
  return counts;
}

// Deletes expired viewer rows only. feed_view_totals is left alone.
export function pruneExpiredFeedViews(q, now = Date.now()) {
  q.pruneFeedViews.run(now - FEED_VIEW_KEEP_MS);
}
