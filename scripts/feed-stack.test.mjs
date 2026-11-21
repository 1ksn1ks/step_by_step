// The feed and the map read the open topic and the topics stacked on it by
// one rule (loadcurrenttopic.js: at most 12, newest adds first, ids cleaned,
// one level deep), three at a time with a time limit per topic, and the
// feed pages them as one list in consensus order (feedmerge.js). A time
// filter (timefilter.js) narrows both to the last 24 hours, 7 days or 30 days.
// The feed and map modules touch document on import, so their wiring is
// checked from source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STACK_MAX,
  activeStack,
  addTopicMessage,
  changeNameMessage,
  cleanTopicIds,
  currentStackedTopics,
  feedTopics,
  isMonthKey,
  monthKey,
  monthPlan,
  monthTopicName,
  removeTopicMessage,
  topicsToLoad,
} from "../loadcurrenttopic.js";
import {
  TIME_FILTERS,
  consensusAt,
  consensusFrom,
  inTimeRange,
  isStale,
  onTimeFilter,
  setTimeFilterFor,
  timeFilterFor,
  timeRange,
} from "../timefilter.js";
import {
  PULL_AT_ONCE,
  STACK_FIRST_MS,
  addPage,
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

test("the shared rule keeps the old loop's stacked topics, with the open topic first and never twice", () => {
  const cases = [
    { messages: [], admins: [] },
    { messages: [add("0.0.10"), add("0.0.11,0.0.12")], admins: [] },
    { messages: [add("0.0.10"), remove("0.0.10"), add("0.0.11")], admins: [] },
    { messages: [add("0.0.10"), remove("0.0.10"), add("0.0.10")], admins: [] },
    { messages: [add("0.0.10", "0.0.2"), add("0.0.11", "0.0.3")], admins: ["0.0.3"] },
    { messages: [add("0.0.10", "0.0.2")], admins: ["0.0.3"] },
    { messages: [add("bad,0.0.12"), add(["0.0.13"]), { payer: "0.0.1" }], admins: [] },
    { messages: [add("0.0.10"), "not json", JSON.stringify({ addTopic: { addTopic: "0.0.14" } })], admins: [] },
    { messages: [add("0.0.9,0.0.10")], admins: [] },
  ];
  for (const { messages, admins } of cases) {
    const now = topicsToLoad("0.0.9", messages, admins);
    const old = oldMapTopics("0.0.9", messages, admins).filter((id) => id !== "0.0.9");
    assert.equal(now[0], "0.0.9", "the open topic always comes first");
    assert.deepEqual([...now.slice(1)].sort(), [...old].sort(), "the same stacked topics");
    assert.equal(new Set(now).size, now.length);
  }
});

test("a removal wins over an older add, newer adds come first, and only admins count", () => {
  const messages = [add("0.0.9,0.0.10,0.0.11"), remove("0.0.10"), add("0.0.12", "0.0.99")];
  assert.deepEqual(currentStackedTopics(messages, []), ["0.0.12", "0.0.9", "0.0.11"]);
  assert.deepEqual(currentStackedTopics(messages, ["0.0.1"]), ["0.0.9", "0.0.11"]);
});

test("the feed and the map read the open topic first, then each stacked topic once", () => {
  // 0.0.9609912 stacks itself, 0.0.9759318 and 0.0.10960230 (the newest add).
  const main = [add("0.0.9609912"), add("0.0.9759318"), add("0.0.10960230", "0.0.10960211")];
  assert.deepEqual(feedTopics("0.0.9609912", main, []), ["0.0.9609912", "0.0.10960230", "0.0.9759318"]);
  assert.deepEqual(topicsToLoad("0.0.9609912", main, []), feedTopics("0.0.9609912", main, []));
  // A topic that stacks others but not itself keeps its own posts.
  assert.deepEqual(feedTopics("0.0.5", [add("0.0.6")], []), ["0.0.5", "0.0.6"]);
  // No stacks: only the open topic.
  assert.deepEqual(feedTopics("0.0.5", [], []), ["0.0.5"]);
  // A stack naming the open topic, or naming a topic twice, reads each once.
  assert.deepEqual(feedTopics("0.0.5", [add("0.0.5,0.0.6,0.0.5"), add("0.0.6")], []), ["0.0.5", "0.0.6"]);
});

test("a topic reads at most 12 stacked topics: the 12 added most recently, after removals", () => {
  assert.equal(STACK_MAX, 12);
  const ids = Array.from({ length: 15 }, (_, i) => `0.0.${100 + i}`);
  const messages = ids.map((id) => add(id));
  const stacked = currentStackedTopics(messages, [], "0.0.5");
  assert.equal(stacked.length, STACK_MAX);
  assert.deepEqual(stacked, ids.slice(3).reverse(), "newest adds, newest first");
  assert.deepEqual(topicsToLoad("0.0.5", messages, []), ["0.0.5", ...ids.slice(3).reverse()]);
  // Removing one of the twelve lets the next most recent back in.
  const removed = [...messages, remove("0.0.114")];
  assert.deepEqual(currentStackedTopics(removed, [], "0.0.5"), ids.slice(2, 14).reverse());
  // Adding an old id again makes it the newest.
  const readded = [...messages, add("0.0.100")];
  assert.equal(currentStackedTopics(readded, [], "0.0.5")[0], "0.0.100");
  // One message with hundreds of ids is still twelve reads.
  const flood = [add(Array.from({ length: 300 }, (_, i) => `0.0.${1000 + i}`).join(","))];
  assert.equal(topicsToLoad("0.0.5", flood, []).length, 1 + STACK_MAX);
  // Everything stacked stays listed for the admin tools (uncapped).
  assert.equal(activeStack(messages, [], "0.0.5").length, 15);
});

test("stacked ids are trimmed, checked, deduplicated, and a topic never stacks itself", () => {
  assert.deepEqual(cleanTopicIds(" 0.0.6 ,0.0.7,0.0.6, 0.0.8 "), ["0.0.6", "0.0.7", "0.0.8"]);
  assert.deepEqual(cleanTopicIds("0.0.5,0.0.6", "0.0.5"), ["0.0.6"]);
  for (const bad of ["0.0.", "0.0.12abc", "1.0.12", "0.0.-1", "0.0.1.2", "javascript:0.0.1", "", " , ,"]) {
    assert.deepEqual(cleanTopicIds(bad), [], bad);
  }
  // Only the message's comma string names topics.
  assert.deepEqual(cleanTopicIds(["0.0.6"]), []);
  assert.deepEqual(cleanTopicIds({ id: "0.0.6" }), []);
  const messages = [add(" 0.0.6 ,0.0.6"), add("0.0.5"), add("0.0.12abc, 0.0.7"), remove(" 0.0.7 ")];
  assert.deepEqual(topicsToLoad("0.0.5", messages, []), ["0.0.5", "0.0.6"]);
  // The tools send the same clean shape.
  assert.equal(addTopicMessage(["0.0.6", "0.0.7"]), '{"addTopic":{"addTopic":"0.0.6,0.0.7"}}');
  assert.equal(removeTopicMessage(["0.0.6"]), '{"removeTopic":{"removeTopic":"0.0.6"}}');
  assert.equal(changeNameMessage("News 2026 - 2026-12"), '{"changeName":"News 2026 - 2026-12"}');
  const rest = readFileSync(new URL("../rest.js", import.meta.url), "utf8");
  assert.match(rest, /addTopicMessage\(stackTopicAddTopic\)/);
  assert.match(rest, /removeTopicMessage\(stackTopicRemoveTopic\)/);
  assert.equal(rest.split('cleanTopicIds(document.getElementById("stack-topic-add-remove-topic").value').length - 1, 2);
});

test("stacks are read one level deep: a stacked topic's own stacks are never followed", () => {
  // A stacks B; B stacks C and loops back to A.
  const ofA = [add("0.0.11")];
  const ofB = [add("0.0.12,0.0.10")];
  assert.deepEqual(topicsToLoad("0.0.10", ofA, []), ["0.0.10", "0.0.11"]);
  // Only the open topic's messages go in; nothing reads B's list.
  assert.deepEqual(topicsToLoad("0.0.11", ofB, []), ["0.0.11", "0.0.12", "0.0.10"]);
  // Every reader passes the open topic's own messages, never a stacked one's.
  const map = readFileSync(new URL("../handleallmessages.js", import.meta.url), "utf8");
  const stack = readFileSync(new URL("../topicstack.js", import.meta.url), "utf8");
  const pic = readFileSync(new URL("../loadTOPIC4PIC.js", import.meta.url), "utf8");
  assert.equal(map.split("topicsToLoad(").length - 1, 1);
  assert.match(map, /topicsToLoad\(topicId, result\.messages, topicAdmin\)/);
  assert.equal(stack.split("feedTopics(").length - 1, 1);
  assert.match(stack, /feedTopics\(topicId, data && data\.messages, adminsFromMemo\(info\.memo\)\)/);
  // The profile's topic list uses the same helper, not its own copy.
  assert.match(pic, /currentStackedTopics\(result\.messages, topicAdmin, topicIdStr\)/);
  assert.doesNotMatch(pic, /topicActions|parsedMessage\.addTopic/);
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
  assert.match(feed, /readFeedTopics\(loadedTopic, \{ range: feedRange \}\)/);
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

test("the feed's cap is the shared rule's: the open topic and 12 stacked", () => {
  const stacked = Array.from({ length: 30 }, (_, i) => `0.0.${100 + i}`);
  const topics = feedTopics("0.0.5", [add(stacked.join(","))], []);
  assert.equal(topics.length, 1 + STACK_MAX);
  assert.equal(topics[0], "0.0.5");
  const stack = readFileSync(new URL("../topicstack.js", import.meta.url), "utf8");
  const merge = readFileSync(new URL("../feedmerge.js", import.meta.url), "utf8");
  assert.doesNotMatch(stack, /capTopics|FEED_TOPIC_MAX/);
  assert.doesNotMatch(merge, /capTopics|FEED_TOPIC_MAX/);
});

test("the feed pages through the queue, times every first page, and lets late topics join", () => {
  const feed = readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  // No fetch over every topic at once, for pages or for the catch-up.
  assert.doesNotMatch(feed, /Promise\.all\(sources\.filter\(needsPull\)/);
  assert.doesNotMatch(feed, /Promise\.all\(live\.map/);
  assert.match(feed, /await mapLimited\(sources\.filter\(needsPull\), PULL_AT_ONCE, \(source\) => pullSource\(source, gen\)\);/);
  assert.match(feed, /await mapLimited\(live, PULL_AT_ONCE, \(source\) => newerRows\(source\.topic, catchUpFrom\(source\)\)\);/);
  // Every topic's first page is timed, the open one's too.
  assert.match(feed, /const timed = !source\.cursor;/);
  assert.match(feed, /if \(!timed \|\| await settlesWithin\(job, STACK_FIRST_MS\)\) \{/);
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
  assert.match(feed, /stackJob = null;\s*lateJobs\.clear\(\);\s*lateLanded\.clear\(\);\s*skipped\.clear\(\);/);
});

test("one failing topic never blanks the feed: it sits out that page and is asked again", () => {
  const feed = readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  const pull = feed.slice(feed.indexOf("async function pullSource("), feed.indexOf("// Late topics that came in join the feed."));
  assert.match(pull, /catch \(error\) \{[\s\S]*pageFailures\.push\(error\);\s*source\.late = true;\s*skipped\.add\(source\);/);
  // It rejoins after the page is shown, not while the merge is running.
  assert.match(feed, /function afterPaging\(\) \{\s*joinLate\(\);\s*releaseSkipped\(\);/);
  // Only a page with nothing to show fails.
  assert.match(feed, /if \(!rows\.length && pageFailures\.length\) throw pageFailures\[0\];/);

  // The merge shows the others while a failed topic sits out.
  const a = feedSource("0.0.1");
  const failed = feedSource("0.0.2");
  addPage(a, { messages: topicRows("0.0.1", [10, 20]).reverse(), done: true });
  assert.deepEqual(takeMerged([a, failed]), [], "a topic that has not answered holds the page");
  failed.late = true;
  assert.equal(takeMerged([a, failed]).length, 2, "sitting out, it does not");
  failed.late = false;
  assert.equal(needsPull(failed), true, "and the next page asks it again");
});

test("the map reads its topics three at a time, gives each about 6 s, and one failure drops only that topic", () => {
  const map = readFileSync(new URL("../handleallmessages.js", import.meta.url), "utf8");
  const pic = readFileSync(new URL("../loadTOPIC4PIC.js", import.meta.url), "utf8");
  const draw = readFileSync(new URL("../processallmessages.js", import.meta.url), "utf8");
  // No topic after topic (the old for…await), no Promise.all over them all.
  assert.doesNotMatch(map, /for \(const topicId of loadedTopicsIds\)/);
  assert.match(map, /await mapLimited\(loadedTopicsIds, PULL_AT_ONCE, async \(stackedId\) => \{/);
  assert.match(map, /if \(await settlesWithin\(job, STACK_FIRST_MS\)\) \{/);
  // A failure is that topic's alone.
  assert.match(map, /processTopicMessages\(stackedId, \{ token: drawToken \}\)\.catch\(\(error\) => \{[\s\S]*?return null;/);
  // A late topic joins when it lands, unless a newer load has begun.
  assert.match(map, /job\.then\(\(out\) => \{\s*if \(!mapDrawCurrent\(drawToken\) \|\| !out\) return;/);
  assert.match(draw, /if \(timed && !mapDrawCurrent\(state\.token\)\) return;/);
  assert.match(draw, /const publishState = \{ markers: 0, polys: 0, token: ctx\.token \};/);
  // The profile's stack list: names three at a time, a slow one by its id.
  assert.match(pic, /await mapLimited\(loadedTopicsIds, PULL_AT_ONCE, async \(stackedId\) => \{/);
  assert.match(pic, /if \(!\(await settlesWithin\(job, STACK_FIRST_MS\)\)\) return stackedId;/);
  assert.doesNotMatch(pic, /for \(const topicId of loadedTopicsIds\)/);
});

// --- Time filters: All, Last 24h, Last 7 days, Last 30 days -----------------

// Local time is the person's: each case runs in a named zone.
function inZone(zone, fn) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const DAY_MS = 24 * 60 * 60 * 1000;

test("last 24h, 7 days and 30 days end now, and the keys stay today, week and month", () => {
  assert.deepEqual(TIME_FILTERS.map((f) => [f.key, f.label, f.short]), [
    ["all", "All", "All"],
    ["today", "Last 24h", "24h"],
    ["week", "Last 7 days", "7d"],
    ["month", "Last 30 days", "30d"],
  ]);
  for (const zone of ["Europe/Belgrade", "America/New_York", "Asia/Tokyo", "UTC"]) {
    inZone(zone, () => {
      const now = new Date(2026, 10, 17, 15, 30);
      const t = now.getTime();
      assert.equal(timeRange("all", now), null, zone);
      assert.deepEqual(timeRange("today", now), { from: t - DAY_MS, to: t }, zone);
      assert.deepEqual(timeRange("week", now), { from: t - 7 * DAY_MS, to: t }, zone);
      assert.deepEqual(timeRange("month", now), { from: t - 30 * DAY_MS, to: t }, zone);
    });
  }
});

test("a rolling window keeps its length across a clock change", () => {
  inZone("Europe/Belgrade", () => {
    // Clocks went back on Sunday 25 Oct 2026. The window is still 24 hours.
    const day = timeRange("today", new Date(2026, 9, 25, 12));
    assert.equal(day.to - day.from, DAY_MS);
    const week = timeRange("week", new Date(2026, 9, 25, 12));
    assert.equal(week.to - week.from, 7 * DAY_MS);
  });
  inZone("America/New_York", () => {
    // Clocks went forward on Sunday 8 Mar 2026.
    const day = timeRange("today", new Date(2026, 2, 8, 12));
    assert.equal(day.to - day.from, DAY_MS);
    const month = timeRange("month", new Date(2026, 2, 8, 12));
    assert.equal(month.to - month.from, 30 * DAY_MS);
  });
});

test("a range the feed or the map kept is measured when it is used", async () => {
  const range = timeRange("today");
  const start = range.from;
  const at = Date.now();
  assert.equal(range.to, Infinity, "a window that ends now has no end limit");
  assert.equal(timeRange("week").to, Infinity);
  assert.equal(timeRange("month").to, Infinity);
  assert.ok(Math.abs(at - start - DAY_MS) < 50);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(range.to, Infinity);
  assert.ok(range.from > start, "the start moves with the clock");
  assert.equal(inTimeRange(Date.now() + 60_000, range), true, "a post a little after this clock is still in");
  assert.equal(inTimeRange(at + 10, range), true, "a post that arrives after the range was taken is still in");
  assert.equal(inTimeRange(start - 1, range), false);
});

test("posts are matched by consensus timestamp, and range reads ask the mirror from the range start", () => {
  const range = { from: Date.UTC(2026, 10, 17), to: Date.UTC(2026, 10, 18) };
  const at = (ms) => consensusAt(ms);
  assert.equal(consensusAt(Date.UTC(2026, 10, 17)), "1794873600.000000000");
  assert.equal(consensusAt(1794873600123), "1794873600.123000000");
  assert.equal(consensusFrom(range), "1794873600.000000000");
  assert.equal(consensusFrom(null), "");
  assert.equal(inTimeRange(at(range.from), range), true, "the first instant is in");
  assert.equal(inTimeRange(at(range.from - 1), range), false);
  assert.equal(inTimeRange(at(range.to - 1), range), true);
  assert.equal(inTimeRange(at(range.to), range), false, "the end is out");
  // ISO dates and Dates (map drawings carry these) are read the same way.
  assert.equal(inTimeRange("2026-11-17T09:00:00.000Z", range), true);
  assert.equal(inTimeRange(new Date("2026-11-16T23:59:59.999Z"), range), false);
  // All lets everything in, and an unreadable time is never hidden.
  assert.equal(inTimeRange(at(0), null), true);
  assert.equal(inTimeRange("not a time", range), true);
  const feed = readFileSync(new URL("../feedlayout.js", import.meta.url), "utf8");
  assert.match(feed, /if \(since\) url \+= `&timestamp=gte:\$\{encodeURIComponent\(since\)\}`;/);
  assert.match(feed, /feedSince = consensusFrom\(feedRange\);/);
  assert.match(feed, /page = await fetchPage\(source\.topic, source\.cursor, feedSince\);/);
  // The backend fallback stops at the first page that reaches past the start.
  assert.match(feed, /if \(since && cmpTs\(confirmed\[0\]\.consensus_timestamp, since\) < 0\) \{\s*short = true;\s*break;/);
  const draw = readFileSync(new URL("../processallmessages.js", import.meta.url), "utf8");
  assert.match(draw, /inTimeRange\(drawing && drawing\.created, mapDrawRange\)/);
});

test("the filter is remembered per topic, and the feed and the map hear the change", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const heard = [];
  const off = onTimeFilter((event) => heard.push(event));
  assert.equal(timeFilterFor("0.0.5", storage), "all");
  setTimeFilterFor("0.0.5", "today", storage);
  setTimeFilterFor("0.0.6", "month", storage);
  assert.equal(timeFilterFor("0.0.5", storage), "today");
  assert.equal(timeFilterFor("0.0.6", storage), "month");
  assert.equal(timeFilterFor("0.0.7", storage), "all");
  setTimeFilterFor("0.0.5", "today", storage);
  setTimeFilterFor("0.0.5", "nonsense", storage);
  assert.deepEqual(heard, [{ topic: "0.0.5", key: "today" }, { topic: "0.0.6", key: "month" }], "only real changes are told");
  setTimeFilterFor("0.0.5", "all", storage);
  assert.equal(JSON.parse(store.get("time-filter-v1"))["0.0.5"], undefined, "All is stored by forgetting");
  off();
  // A store that refuses writes (private mode) still keeps it for the visit.
  const refusing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  setTimeFilterFor("0.0.5", "week", refusing);
  assert.equal(timeFilterFor("0.0.5", refusing), "week");
});

test("a stacked topic whose newest message is older than the range is not read", () => {
  inZone("Europe/Belgrade", () => {
    const today = timeRange("today", new Date(2026, 10, 17, 9));
    const thisMonth = consensusAt(local(2026, 11, 17, 8));
    const lastMonth = consensusAt(local(2026, 10, 30, 22));
    assert.equal(isStale(lastMonth, today), true);
    assert.equal(isStale(thisMonth, today), false);
    assert.equal(isStale("", today), false, "unknown is read");
    assert.equal(isStale(lastMonth, null), false, "All reads everything");
    // A year topic with twelve months: the last 24h reads the open topic and the current month.
    const months = Array.from({ length: 12 }, (_, i) => ({ id: `0.0.${200 + i}`, latest: consensusAt(local(2026, i + 1, 28)) }));
    months[10].latest = thisMonth; // November, still being posted to
    months[11].latest = ""; // December: never read on this device
    const kept = months.filter((m) => !isStale(m.latest, today)).map((m) => m.id);
    assert.deepEqual(kept, ["0.0.210", "0.0.211"]);
  });
  const stack = readFileSync(new URL("../topicstack.js", import.meta.url), "utf8");
  assert.match(stack, /topics\.filter\(\(topic, i\) => topic === topicId \|\| !isStale\(latest\[i\], range\)\)/);
  assert.match(stack, /cachedLatestTs\(topic\)/);
  const map = readFileSync(new URL("../handleallmessages.js", import.meta.url), "utf8");
  assert.match(map, /loadedTopicsIds = await topicsInRange\(topicsToLoad\(topicId, result\.messages, topicAdmin\), range\);/);
  assert.match(map, /mapLimited\(topics, PULL_AT_ONCE, \(topic\) => latestTopicTs\(topic\)\.catch\(\(\) => ''\)\)/);
  // The phone's topic cache keeps each topic's newest time with its sequence.
  const cache = readFileSync(new URL("../topiccache.js", import.meta.url), "utf8");
  assert.match(cache, /topics\.put\(\{ topicId, lastSeq, lastTs, updatedAt: Date\.now\(\) \}\);/);
});

// --- Start new month --------------------------------------------------------

test("a new month is named after the year topic, and a full stack gives up its oldest", () => {
  inZone("Europe/Belgrade", () => {
    assert.equal(monthKey(new Date(2026, 11, 1)), "2026-12");
    assert.equal(monthKey(new Date(2027, 0, 31, 23, 59)), "2027-01");
  });
  assert.equal(isMonthKey("2026-12"), true);
  for (const bad of ["2026-13", "2026-00", "26-12", "2026-1", ""]) assert.equal(isMonthKey(bad), false, bad);
  assert.equal(monthTopicName("News 2026", "2026-12"), "News 2026 - 2026-12");
  assert.equal(monthTopicName("  News   2026 ", "2026-12"), "News 2026 - 2026-12");
  assert.equal(monthTopicName("", "2026-12"), "2026-12");
  // Twelve stacked (newest first): the one added longest ago comes off.
  const twelve = Array.from({ length: 12 }, (_, i) => `0.0.${300 - i}`);
  assert.deepEqual(monthPlan(twelve), { remove: "0.0.289" });
  assert.deepEqual(monthPlan(twelve.slice(0, 11)), { remove: "" });
  assert.deepEqual(monthPlan([]), { remove: "" });
});

test("Start new month is for admins only and stacks before it removes", () => {
  const flow = readFileSync(new URL("../monthstack.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  // The same rule every stack message is read by: memo admins, or anyone
  // when the memo lists none. Checked before anything is created.
  assert.match(flow, /if \(admins\.length && !admins\.includes\(connectedAccount\)\) \{/);
  const order = ["createTopic({ memo })", "changeNameMessage(name)", "addTopicMessage([monthTopic])", "removeTopicMessage([remove])"]
    .map((call) => flow.indexOf(call));
  assert.ok(order.every((at) => at > 0), "every step uses the existing message code");
  assert.deepEqual([...order].sort((x, y) => x - y), order, "create, name, stack, then remove");
  // Nothing is sent before Confirm.
  assert.match(flow, /confirmBtn\.addEventListener\('click', \(event\) => \{\s*event\.stopPropagation\(\);\s*confirmPlan\(\);/);
  assert.match(html, /id="stack-month-start"/);
  assert.match(html, /id="stack-month-confirm"/);
  assert.match(read("../main.js"), /import '\.\/monthstack\.js'/);
});

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
