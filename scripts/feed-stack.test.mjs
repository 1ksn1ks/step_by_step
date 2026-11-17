// The feed reads the open topic and the topics stacked on it, by the map's
// stack rule (loadcurrenttopic.js), and pages them as one list in
// consensus order (feedmerge.js). The feed module touches document on
// import, so its wiring is checked from source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentStackedTopics, feedTopics, topicsToLoad } from "../loadcurrenttopic.js";
import { addPage, cmpMessage, feedSource, needsPull, sourcesDone, takeMerged } from "../feedmerge.js";

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
