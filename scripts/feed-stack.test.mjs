// The feed reads the open topic and the topics stacked on it, by the map's
// stack rule (loadcurrenttopic.js), and pages them as one list in
// consensus order (feedmerge.js). The feed module touches document on
// import, so its wiring is checked from source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentStackedTopics, feedTopics, topicsToLoad } from "../loadcurrenttopic.js";
import {
  FEED_TOPIC_MAX,
  PULL_AT_ONCE,
  STACK_FIRST_MS,
  addPage,
  capTopics,
  cmpMessage,
  feedSource,
  mapLimited,
  needsPull,
  settlesWithin,
  sourcesDone,
  takeAbove,
  takeMerged,
} from "../feedmerge.js";

const add = (topics, payer = "0.0.1") => ({ addTopic: { addTopic: topics }, payer });
const remove = (topics, payer = "0.0.1") => ({ removeTopic: { removeTopic: topics }, payer });

// The map's loop before it moved to topicsToLoad (handleallmessages.js).
function oldMapTopics(topicId, messages, topicAdmin) {
  const topicActions = new Map();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    try {
      let parsedMessage = message;
      if (typeof message === "string") parsedMessage = JSON.parse(message);
      const timestamp = message.consensus_timestamp;
      if (parsedMessage.addTopic && parsedMessage.addTopic.addTopic && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
        const topics = typeof parsedMessage.addTopic.addTopic === "string" ? parsedMessage.addTopic.addTopic.split(",") : [];
        topics.forEach((topic) => topicActions.set(topic, { action: "add", timestamp }));
      }
      if (parsedMessage.removeTopic && parsedMessage.removeTopic.removeTopic && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
        const topics = typeof parsedMessage.removeTopic.removeTopic === "string" ? parsedMessage.removeTopic.removeTopic.split(",") : [];
        topics.forEach((topic) => topicActions.set(topic, { action: "remove", timestamp }));
      }
    } catch {
      /* the old loop logged and went on */
    }
  }
  let ids = Array.from(topicActions.entries())
    .filter(([topic, { action }]) => action === "add" && topic.startsWith("0.0."))
    .map(([topic]) => topic);
  if (ids.length === 0 && String(topicId || "").startsWith("0.0.")) ids = [topicId];
  return ids;
}

test("the shared rule gives the map the same topics as its old loop", () => {
  const cases = [
    { messages: [], admins: [] },
    { messages: [add("0.0.10"), add("0.0.11,0.0.12")], admins: [] },
    { messages: [add("0.0.10"), remove("0.0.10"), add("0.0.11")], admins: [] },
    { messages: [add("0.0.10"), remove("0.0.10"), add("0.0.10")], admins: [] },
    { messages: [add("0.0.10", "0.0.2"), add("0.0.11", "0.0.3")], admins: ["0.0.3"] },
    { messages: [add("0.0.10", "0.0.2")], admins: ["0.0.3"] },
    { messages: [add("bad,0.0.12"), add(["0.0.13"]), { payer: "0.0.1" }], admins: [] },
    { messages: [add("0.0.10"), "not json", JSON.stringify({ addTopic: { addTopic: "0.0.14" } })], admins: [] },
  ];
  for (const { messages, admins } of cases) {
    assert.deepEqual(topicsToLoad("0.0.9", messages, admins), oldMapTopics("0.0.9", messages, admins));
  }
});

test("a removal wins over an older add, and only admins count", () => {
  const messages = [add("0.0.9,0.0.10,0.0.11"), remove("0.0.10"), add("0.0.12", "0.0.99")];
  assert.deepEqual(currentStackedTopics(messages, []), ["0.0.9", "0.0.11", "0.0.12"]);
  assert.deepEqual(currentStackedTopics(messages, ["0.0.1"]), ["0.0.9", "0.0.11"]);
});

test("the feed reads the open topic first, then each stacked topic once", () => {
  // 0.0.9609912 stacks itself, 0.0.9759318 and 0.0.10960230.
  const main = [add("0.0.9609912"), add("0.0.9759318"), add("0.0.10960230", "0.0.10960211")];
  assert.deepEqual(feedTopics("0.0.9609912", main, []), ["0.0.9609912", "0.0.9759318", "0.0.10960230"]);
  // A topic that stacks others but not itself keeps its own posts.
  assert.deepEqual(feedTopics("0.0.5", [add("0.0.6")], []), ["0.0.5", "0.0.6"]);
  // No stacks: only the open topic.
  assert.deepEqual(feedTopics("0.0.5", [], []), ["0.0.5"]);
  // A stack naming the open topic twice, or looping back to it, is read once.
  assert.deepEqual(feedTopics("0.0.5", [add("0.0.5,0.0.6,0.0.5"), add("0.0.6")], []), ["0.0.5", "0.0.6"]);
});

// Messages for a topic, oldest first, at the given consensus seconds.
function topicRows(topic, seconds) {
  return seconds.map((s, i) => ({
    topic,
    sequence_number: i + 1,
    consensus_timestamp: `${s}.000000000`,
  }));
}

// A page the way fetchPage gives it: newest first, below the cursor.
function fakeFetch(all, size, pulls) {
  return (topic, cursor) => {
    pulls.push(topic);
    const rows = all[topic].filter((m) => !cursor || m.sequence_number < cursor.seq);
    const page = rows.slice(-size).reverse();
    return { messages: page, done: rows.length <= size };
  };
}

function pageAll(all, size) {
  const sources = Object.keys(all).map(feedSource);
  const pulls = [];
  const fetchPage = fakeFetch(all, size, pulls);
  const pages = [];
  for (let guard = 0; guard < 100 && !sourcesDone(sources); guard++) {
    for (const source of sources.filter(needsPull)) addPage(source, fetchPage(source.topic, source.cursor));
    pages.push(takeMerged(sources).map((row) => row.message));
  }
  return { pages, pulls, sources };
}

test("pages of several topics come out as one list in consensus order", () => {
  const all = {
    "0.0.1": topicRows("0.0.1", [10, 20, 30, 40, 50, 60, 70, 80, 90]),
    "0.0.2": topicRows("0.0.2", [15, 55, 95]),
    "0.0.3": topicRows("0.0.3", [1, 2, 3]),
  };
  const { pages } = pageAll(all, 2);
  const shown = pages.flat();
  const expected = Object.values(all).flat().sort((a, b) => cmpMessage(b, a));
  assert.deepEqual(shown, expected);
  assert.equal(new Set(shown).size, shown.length, "no message twice");
  for (const page of pages) assert.ok(page.length > 0, "every page shows something");
});

test("only a topic whose fetched rows have all been shown is fetched again", () => {
  const all = {
    "0.0.1": topicRows("0.0.1", [10, 20, 30, 40, 50, 60]),
    "0.0.2": topicRows("0.0.2", [1, 2]),
  };
  const { pulls } = pageAll(all, 2);
  // Both once for the first page, then the busy topic alone until it is
  // read down to the quiet one's rows; 0.0.2 was done after one page.
  assert.deepEqual(pulls, ["0.0.1", "0.0.2", "0.0.1", "0.0.1"]);
});

test("nothing shows until every topic still being read has a first page", () => {
  const a = feedSource("0.0.1");
  const b = feedSource("0.0.2");
  addPage(a, { messages: topicRows("0.0.1", [10, 20]).reverse(), done: false });
  assert.deepEqual(takeMerged([a, b]), []);
  addPage(b, { messages: [], done: true });
  assert.equal(takeMerged([a, b]).length, 2);
});

test("a topic that returns its last row again is done", () => {
  const source = feedSource("0.0.1");
  const page = { messages: topicRows("0.0.1", [5]), done: false };
  assert.equal(addPage(source, page), true);
  takeMerged([source]);
  assert.equal(addPage(source, page), false);
  assert.equal(source.done, true);
  assert.equal(source.high, 1);
});

test("the feed is wired to the shared rule and pages every topic", () => {
  const feed = readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const map = readFileSync(new URL("../handleallmessages.js", import.meta.url), "utf8");
  const stack = readFileSync(new URL("../topicstack.js", import.meta.url), "utf8");
  assert.match(map, /topicsToLoad\(topicId, result\.messages, topicAdmin\)/);
  assert.doesNotMatch(map, /parsedMessage\.addTopic/);
  assert.match(stack, /feedTopics\(topicId/);
  assert.match(feed, /readFeedTopics\(loadedTopic\)/);
  assert.match(feed, /takeMerged\(sources\)/);
  // Posts carry their own topic; nothing builds one from the open topic.
  assert.doesNotMatch(feed, /topicId: loadedTopic/);
  assert.doesNotMatch(feed, /`[mpc]:\$\{loadedTopic\}/);
  // The open topic's chat stays its own.
  assert.match(feed, /topic === loadedTopic \? chatPost\(message, topic\) : null/);
});

// --- Light on phones: the queue, the time limit and the cap ---------------

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, bad) => {
    resolve = ok;
    reject = bad;
  });
  return { promise, resolve, reject };
}

// Lets every pending promise callback run.
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the queue fetches at most three topics at a time, in stack order", async () => {
  assert.equal(PULL_AT_ONCE, 3);
  const topics = ["0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5", "0.0.6", "0.0.7"];
  const gates = new Map(topics.map((topic) => [topic, deferred()]));
  const started = [];
  let running = 0;
  let peak = 0;
  const job = mapLimited(topics, PULL_AT_ONCE, async (topic) => {
    started.push(topic);
    running += 1;
    peak = Math.max(peak, running);
    try {
      return await gates.get(topic).promise;
    } finally {
      running -= 1;
    }
  });
  await settle();
  assert.deepEqual(started, ["0.0.1", "0.0.2", "0.0.3"]);
  // A slow first topic does not hold the others back: the next one takes
  // the place that came free.
  gates.get("0.0.2").resolve("page 2");
  await settle();
  assert.deepEqual(started, ["0.0.1", "0.0.2", "0.0.3", "0.0.4"]);
  for (const topic of ["0.0.3", "0.0.4", "0.0.5", "0.0.6", "0.0.7", "0.0.1"]) {
    gates.get(topic).resolve(`page ${topic.slice(4)}`);
    await settle();
  }
  // Results come back in topic order, whatever order they finished in.
  assert.deepEqual(await job, topics.map((topic) => `page ${topic.slice(4)}`));
  assert.equal(peak, PULL_AT_ONCE);
  assert.equal(started.length, topics.length);
  assert.deepEqual(await mapLimited([], PULL_AT_ONCE, () => assert.fail("nothing to run")), []);
});

test("after a failed topic the queue starts nothing new, lets the running ones finish, then fails the page", async () => {
  const started = [];
  const finished = [];
  const job = mapLimited(["0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5"], PULL_AT_ONCE, async (topic) => {
    started.push(topic);
    if (topic === "0.0.2") throw new Error("0.0.2 failed");
    await settle();
    finished.push(topic);
    return topic;
  });
  await assert.rejects(job, /0\.0\.2 failed/);
  assert.deepEqual(started, ["0.0.1", "0.0.2", "0.0.3"]);
  assert.deepEqual(finished.sort(), ["0.0.1", "0.0.3"]);
});

test("a stacked topic's first page gets about 6 s", async (t) => {
  assert.equal(STACK_FIRST_MS, 6000);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // In time, either way: a page, or an error the page still reports.
  const quick = deferred();
  const inTime = settlesWithin(quick.promise, STACK_FIRST_MS);
  t.mock.timers.tick(STACK_FIRST_MS - 1);
  quick.resolve({ messages: [] });
  assert.equal(await inTime, true);
  assert.equal(await settlesWithin(Promise.reject(new Error("mirror HTTP 500")), STACK_FIRST_MS), true);
  // Too slow: the page goes on. The fetch itself is not stopped.
  const slow = deferred();
  const late = settlesWithin(slow.promise, STACK_FIRST_MS);
  t.mock.timers.tick(STACK_FIRST_MS);
  assert.equal(await late, false);
  slow.resolve({ messages: [] });
  assert.equal(await slow.promise.then(() => "still landed"), "still landed");
});

test("past the limit the page shows the topics that answered, and the late one joins in order", () => {
  const all = {
    "0.0.1": topicRows("0.0.1", [10, 20, 30, 40, 50, 60, 70, 80]),
    "0.0.2": topicRows("0.0.2", [15, 35, 55, 75]),
    "0.0.3": topicRows("0.0.3", [5, 25, 45, 65, 85]),
  };
  const pulls = [];
  const fetchPage = fakeFetch(all, 3, pulls);
  const sources = Object.keys(all).map(feedSource);
  const late = sources[2];

  // 0.0.3 missed its time limit: it is not fetched again while it loads,
  // and it does not hold the page back.
  late.late = true;
  assert.equal(needsPull(late), false);
  for (const source of sources.filter(needsPull)) addPage(source, fetchPage(source.topic, source.cursor));
  const first = takeMerged(sources).map((row) => row.message);
  assert.deepEqual(first.map((m) => `${m.topic} ${m.consensus_timestamp}`), [
    "0.0.1 80.000000000",
    "0.0.2 75.000000000",
    "0.0.1 70.000000000",
    "0.0.1 60.000000000",
  ]);
  const shownTo = first[first.length - 1].consensus_timestamp;

  // Its page comes in while it is still late: it stays out of the merge.
  addPage(late, fetchPage(late.topic, late.cursor));
  assert.equal(takeMerged(sources).length, 0);

  // Joining: the rows newer than the oldest one shown belong among the
  // shown rows (they go in through the new-posts queue, sorted there)...
  late.late = false;
  const above = takeAbove(late, shownTo).map((row) => row.message);
  assert.deepEqual(above.map((m) => m.consensus_timestamp), ["85.000000000", "65.000000000"]);
  // ...and the rest joins the next pages, which stay in consensus order.
  const rest = [];
  for (let guard = 0; guard < 50 && !sourcesDone(sources); guard++) {
    for (const source of sources.filter(needsPull)) addPage(source, fetchPage(source.topic, source.cursor));
    rest.push(...takeMerged(sources).map((row) => row.message));
  }
  assert.deepEqual(rest, [...rest].sort((x, y) => cmpMessage(y, x)), "pages newest first");
  assert.ok(rest.every((m) => cmpMessage(m, first[first.length - 1]) < 0), "nothing on a later page is newer than what is shown");
  // Everything is shown once, and the top of the feed, once the queue is
  // merged, is what waiting for every topic would have shown.
  const everything = Object.values(all).flat();
  const seen = [...first, ...above, ...rest];
  assert.equal(seen.length, everything.length);
  assert.equal(new Set(seen).size, seen.length);
  const top = [...first, ...above].sort((x, y) => cmpMessage(y, x));
  const waited = everything.filter((m) => cmpMessage(m, first[first.length - 1]) >= 0).sort((x, y) => cmpMessage(y, x));
  assert.deepEqual(top, waited);
});

test("a late topic that comes in before anything was shown simply joins the merge", () => {
  const source = feedSource("0.0.3");
  addPage(source, { messages: topicRows("0.0.3", [5, 25]).reverse(), done: true });
  assert.deepEqual(takeAbove(source, null), []);
  assert.equal(source.rows.length, 2);
});

test("the feed reads at most 20 topics, the open one first", () => {
  assert.equal(FEED_TOPIC_MAX, 20);
  const stacked = Array.from({ length: 30 }, (_, i) => `0.0.${100 + i}`);
  const topics = feedTopics("0.0.5", [add(stacked.join(","))], []);
  assert.equal(topics.length, 31);
  const capped = capTopics(topics, "0.0.5");
  assert.equal(capped.length, FEED_TOPIC_MAX);
  assert.equal(capped[0], "0.0.5");
  assert.deepEqual(capped.slice(1), stacked.slice(0, FEED_TOPIC_MAX - 1), "the first stacked topics, in stack order");
  // The open topic stays first even if a list names it later, and once.
  assert.deepEqual(capTopics(["0.0.7", "0.0.5", "0.0.7"], "0.0.5"), ["0.0.5", "0.0.7"]);
  // A short stack is read as it is.
  assert.deepEqual(capTopics(["0.0.5", "0.0.6"], "0.0.5"), ["0.0.5", "0.0.6"]);
  const stack = readFileSync(new URL("../topicstack.js", import.meta.url), "utf8");
  assert.match(stack, /const topics = capTopics\(all, topicId, FEED_TOPIC_MAX\);/);
});

test("the feed pages through the queue, times only stacked first pages, and lets late topics join", () => {
  const feed = readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  // No fetch over every topic at once, for pages or for the catch-up.
  assert.doesNotMatch(feed, /Promise\.all\(sources\.filter\(needsPull\)/);
  assert.doesNotMatch(feed, /Promise\.all\(live\.map/);
  assert.match(feed, /await mapLimited\(sources\.filter\(needsPull\), PULL_AT_ONCE, \(source\) => pullSource\(source, gen\)\);/);
  assert.match(feed, /await mapLimited\(live, PULL_AT_ONCE, \(source\) => newerRows\(source\.topic, catchUpFrom\(source\)\)\);/);
  // The open topic always waits; a stacked topic's first page is timed.
  assert.match(feed, /const timed = source\.topic !== loadedTopic && !source\.cursor;/);
  assert.match(feed, /if \(!timed \|\| await settlesWithin\(job, STACK_FIRST_MS\)\) return job;/);
  // It joins once the page being read is shown, not in the middle of it.
  assert.match(feed, /if \(!paging\) joinLate\(\);/);
  assert.match(feed, /function afterPaging\(\) \{\s*joinLate\(\);/);
  // Its rows newer than the screen go through the new-posts queue, which
  // sorts them into time order, even at the top.
  assert.match(feed, /early\.push\(\.\.\.takeAbove\(source, cursor\.ts\)\)/);
  assert.match(feed, /if \(made\.length\) prependBatch\(made, true\);/);
  assert.match(feed, /if \(!batch\.length \|\| \(!late && tabIsAtTop\(tab\)\)\) return false;/);
  assert.match(feed, /if \(late\) revealParked\(\);/);
  // A page with nothing else to show waits for the late topics.
  assert.match(feed, /if \(!rows\.length && lateJobs\.size\) \{\s*await Promise\.all\(\[\.\.\.lateJobs\]\);/);
  // A new open topic forgets the old one's late topics.
  assert.match(feed, /stackJob = null;\s*lateJobs\.clear\(\);\s*lateLanded\.clear\(\);/);
});
