// The new-posts queue behind the feed's pill (feedfresh.js) and its
// wiring in feedlayout.js (the feed module touches document on import,
// so the wiring is checked from source).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cmpFresh, freshTs, orderFresh, sortQueue } from "../feedfresh.js";

const post = (name, ts, extra = {}) => ({ key: name, ts: ts == null ? "" : `${ts}.000000000`, seq: 1, ...extra });
const names = (list) => list.map((p) => p.key);

test("a pending send has no consensus time yet and counts as the newest", () => {
  const pendingMine = post("mine", null, { time: 2_000_000_000_000 });
  assert.equal(freshTs(pendingMine), "2000000000.000000000");
  const list = [post("a", 1_900_000_000), pendingMine];
  list.sort(cmpFresh);
  assert.deepEqual(names(list), ["mine", "a"]);
});

test("the queue stays in time order when a later batch is older", () => {
  // Stacked topic B arrived first, then main topic A with an older post,
  // in front of the drawn feed (x, y).
  const list = [post("A", 101), post("B", 102), post("x", 50), post("y", 40)];
  sortQueue(list, 2);
  assert.deepEqual(names(list), ["B", "A", "x", "y"]);
});

test("merging reaches past the queue only for newer posts under it", () => {
  // Your own post went in under the queue; it is the newest.
  const list = [post("B", 102), post("A", 101), post("mine", 103), post("x", 50), post("y", 40)];
  const reach = orderFresh(list, 2);
  assert.equal(reach, 3);
  assert.deepEqual(names(list), ["mine", "B", "A", "x", "y"]);
  // Nothing newer under the queue: the drawn cards keep their places.
  const plain = [post("B", 102), post("A", 101), post("x", 50)];
  assert.equal(orderFresh(plain, 2), 2);
  assert.deepEqual(names(plain), ["B", "A", "x"]);
  assert.equal(orderFresh([post("x", 1)], 0), 0);
});

test("the feed queues others' posts, lets yours in, and merges in time order", () => {
  const feed = readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(feed, /sortQueue\(list, held\[tab\]\.length\)/);
  assert.match(feed, /list\.filter\(\(post\) => post\.payer === me\)/);
  assert.match(feed, /function placeOwn\(own\)/);
  for (const fn of ["frameReveal", "revealParked", "goToFreshPosts"]) {
    const body = feed.slice(feed.indexOf(`function ${fn}(`), feed.indexOf(`function ${fn}(`) + 900);
    assert.match(body, /mergeQueue\(tab\)/, `${fn} merges in time order`);
  }
  // Hidden under sheets, rebound on reopen, caught up after a drop.
  assert.match(feed, /&& !pillCovered\(\)/);
  assert.match(feed, /for \(const source of sources\) bindStream\(source\.topic\)/);
  assert.match(feed, /streamOnReconnect\(catchUpSoon\)/);
  // Pull to refresh, styled in tokens.
  assert.match(feed, /scroller\.addEventListener\('touchmove'/);
  const pull = css.slice(css.indexOf("#feed-pull {"), css.indexOf("html.kb-open #feed-pull"));
  assert.ok(pull.length > 0);
  assert.doesNotMatch(pull, /\d+px/, "no fixed px in the pull disc");
});
