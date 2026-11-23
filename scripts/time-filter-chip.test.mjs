// The time filter chip (timefilterui.js) on the feed toolbar and the map
// top bar always shows the filter its view really uses: the remembered
// filter (timefilter.js) of the topic that view shows, from the first
// paint on, after every load of the map or the feed, and on every change.
// All looks like every other choice. The chip runs on a small fake DOM;
// the feed and map modules touch the page on import, so their wiring is
// checked from source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const body = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let end = body; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    else if (source[end] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, end + 1);
    }
  }
  assert.fail(`${name} did not close`);
}

// Just enough DOM for the chip: elements are EventTargets with children,
// attributes, a dataset and a class set; focus() moves activeElement.
class FakeElement extends EventTarget {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.hidden = false;
    this.textContent = "";
    this.className = "";
    this.title = "";
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
      toggle: (name, on = !this.classes.has(name)) => {
        if (on) this.classes.add(name);
        else this.classes.delete(name);
        return on;
      },
    };
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  contains(node) { return node === this || this.children.some((child) => child.contains && child.contains(node)); }
  focus() { globalThis.document.activeElement = this; }
}
const fakeDocument = new EventTarget();
fakeDocument.activeElement = null;
fakeDocument.createElement = (tag) => new FakeElement(tag);
fakeDocument.createElementNS = (ns, tag) => new FakeElement(tag);
globalThis.document = fakeDocument;

// No localStorage in node: timefilter.js keeps choices for this visit.
assert.equal(typeof localStorage, "undefined");
const { createTimeChip } = await import("../timefilterui.js");
const { setTimeFilterFor, timeFilterFor, timeRange, inTimeRange } = await import("../timefilter.js");

// The parts of a chip a person sees and hears.
function parts(ui) {
  const [chip, menu] = ui.el.children;
  const label = chip.children[1];
  const items = menu.children;
  return { chip, menu, label, items };
}
function shows(ui) {
  const { chip, label, items } = parts(ui);
  return {
    label: label.textContent,
    spoken: chip.getAttribute("aria-label"),
    checked: items.filter((item) => item.getAttribute("aria-checked") === "true").map((item) => item.dataset.key),
    filter: chip.dataset.filter,
  };
}
const click = (el) => el.dispatchEvent(new Event("click"));
function pick(ui, key) {
  const { chip, items } = parts(ui);
  click(chip);
  click(items.find((item) => item.dataset.key === key));
}

test("a chip shows its topic's remembered filter from its first paint, not All", () => {
  setTimeFilterFor("0.0.101", "week");
  const ui = createTimeChip({ id: "t1", variant: "map", topic: () => "0.0.101" });
  assert.deepEqual(shows(ui), { label: "7d", spoken: "Time: Last 7 days", checked: ["week"], filter: "week" });
  // A topic with nothing remembered is All, and that is what it shows.
  const fresh = createTimeChip({ id: "t2", variant: "feed", topic: () => "0.0.102" });
  assert.deepEqual(shows(fresh), { label: "All", spoken: "Time: All", checked: ["all"], filter: "all" });
});

test("when the view's topic changes, refresh() shows the new topic's filter (coming back to one too)", () => {
  setTimeFilterFor("0.0.201", "today");
  setTimeFilterFor("0.0.202", "month");
  let topic = "0.0.201";
  const ui = createTimeChip({ id: "t3", variant: "map", topic: () => topic });
  assert.equal(shows(ui).label, "24h");
  topic = "0.0.202";
  ui.refresh();
  assert.deepEqual(shows(ui).checked, ["month"]);
  topic = "0.0.203"; // never set: All
  ui.refresh();
  assert.equal(shows(ui).label, "All");
  topic = "0.0.201";
  ui.refresh();
  assert.equal(shows(ui).label, "24h");
});

test("a pick sets the filter of the chip's topic, and every chip on that topic follows", () => {
  const feed = createTimeChip({ id: "t4", variant: "feed", topic: () => "0.0.301" });
  const map = createTimeChip({ id: "t5", variant: "map", topic: () => "0.0.301" });
  const other = createTimeChip({ id: "t6", variant: "map", topic: () => "0.0.302" });
  pick(map, "today");
  assert.equal(timeFilterFor("0.0.301"), "today");
  assert.equal(shows(map).label, "24h");
  assert.equal(shows(feed).label, "24h", "the feed's chip without a refresh");
  assert.equal(shows(other).label, "All", "another topic keeps its own");
  assert.equal(parts(map).menu.hidden, true, "the pick closes the menu");
  // Back to All: shown, checked and stored the same way.
  pick(feed, "all");
  assert.equal(timeFilterFor("0.0.301"), "all");
  assert.deepEqual(shows(map), { label: "All", spoken: "Time: All", checked: ["all"], filter: "all" });
  // A change made anywhere else (another chip, another module) repaints it.
  setTimeFilterFor("0.0.302", "week");
  assert.equal(shows(other).label, "7d");
});

test("opening the menu checks the topic's filter even if a repaint was missed", () => {
  setTimeFilterFor("0.0.401", "month");
  let topic = "0.0.402";
  const ui = createTimeChip({ id: "t7", variant: "feed", topic: () => topic });
  assert.equal(shows(ui).label, "All");
  topic = "0.0.401"; // no refresh()
  click(parts(ui).chip);
  assert.equal(parts(ui).menu.hidden, false);
  assert.deepEqual(shows(ui).checked, ["month"]);
  assert.equal(shows(ui).label, "30d");
  assert.equal(document.activeElement, parts(ui).items.find((item) => item.dataset.key === "month"));
});

test("All is drawn like every other choice: no state of its own on the chip", () => {
  const looks = [];
  for (const key of ["all", "today", "week", "month"]) {
    setTimeFilterFor("0.0.501", key);
    const ui = createTimeChip({ id: `t8-${key}`, variant: "map", topic: () => "0.0.501" });
    const { chip, label } = parts(ui);
    assert.ok(label.textContent.length > 0, `${key} has a name`);
    looks.push(`${chip.className}|${[...chip.classes].join(" ")}|${label.className}`);
  }
  assert.equal(new Set(looks).size, 1, looks.join(" / "));
  assert.equal(looks[0], "time-filter-chip||time-filter-label");
});

test("no topic yet: the chip shows All and a pick stores nothing", () => {
  const ui = createTimeChip({ id: "t9", variant: "feed", topic: () => "" });
  assert.equal(shows(ui).label, "All");
  pick(ui, "today");
  assert.equal(timeFilterFor(""), "all");
  assert.equal(shows(ui).label, "All");
});

// ── The map's topic (handleallmessages.js) ────────────────────────────
const hm = read("../handleallmessages.js");

test("each map load names its topic, and mapTopic() is the one the map shows", () => {
  const api = new Function(`
    let mapApplied = null;
    const mapTopicListeners = new Set();
    ${fnSource(hm, "mapTopic")}
    ${fnSource(hm, "onMapTopic")}
    ${fnSource(hm, "applyMapTopic")}
    return { mapTopic, onMapTopic, applyMapTopic, applied: () => mapApplied };
  `)();
  assert.equal(api.mapTopic(), "");
  const heard = [];
  const off = api.onMapTopic((topic) => heard.push(topic));
  const offBroken = api.onMapTopic(() => { throw new Error("one listener failing"); });
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args[0]);
  try {
    api.applyMapTopic("0.0.7", "week");
    api.applyMapTopic("0.0.8", "all");
  } finally {
    console.warn = warn;
    offBroken();
  }
  assert.deepEqual(warned, ["map topic listener failed", "map topic listener failed"]);
  assert.deepEqual(heard, ["0.0.7", "0.0.8"]);
  assert.equal(api.mapTopic(), "0.0.8");
  assert.deepEqual(api.applied(), { topic: "0.0.8", key: "all" });
  off();
  api.applyMapTopic("0.0.9", "today");
  assert.deepEqual(heard, ["0.0.7", "0.0.8"]);
});

test("the map load takes its topic and filter through applyMapTopic, and can be told the topic", () => {
  const load = fnSource(hm, "handleAllMessages");
  assert.match(load, /const filterKey = timeFilterFor\(topicId\);\s*const range = timeRange\(filterKey\);\s*applyMapTopic\(topicId, filterKey\);/);
  assert.doesNotMatch(load, /mapApplied =/);
  assert.equal(hm.match(/mapApplied = \{/g).length, 1, "only applyMapTopic sets it");
  assert.match(fnSource(hm, "applyMapTopic"), /mapApplied = \{ topic, key \};/);
  // A topic string wins over #input-field; anything else (no argument) reads the field.
  assert.match(load, /const userInput = \(typeof topic === "string" && topic \? topic : document\.getElementById\("input-field"\)\.value\)\.toLowerCase\(\);/);
  assert.match(hm, /export async function handleAllMessages\(topic, opts = \{\}\)/);
});

// The real load body and the real applyInitialXYZ (setinitialxyz.js), on a
// stub map, mirror and page. The topic has a saved start view, so a load
// that goes to it calls map.flyTo.
const xyz = read("../setinitialxyz.js");
function mapLoad() {
  const log = [];
  const run = new Function("log", "timeFilterFor", "timeRange", "inTimeRange", `
    const console = { error: (...args) => log.push(["error", String(args[0])]), warn: () => {} };
    const fields = {
      "input-field": { value: "0.0.42" },
      "loaded-topics": { value: "" },
      "loaded-topics-list": { innerHTML: "" },
    };
    const document = { getElementById: (id) => fields[id] || null };
    const window = { __topicsReady: true, dispatchEvent: (event) => log.push(["event", event.type]) };
    const map = {
      getStyle: () => ({ layers: [], sources: {} }),
      removeLayer() {}, removeSource() {},
      flyTo: (options) => log.push(["flyTo", options.center, options.zoom]),
    };
    const toast = { loaded: (text) => log.push(["toast", text]) };
    const loadedDomains = [];
    const initialTopicId = "0.0.1";
    const allLoadedMessages = [];
    const geojson = { features: [] };
    const polygons = [];
    const index = { load: (features) => log.push(["clusters", features.length]) };
    let storedMarkers = [];
    let storedPolygons = [];
    let existingMarkers = [];
    let globalLoadedTopicIdsWithNames = [];
    let globalTopicBios = {};
    const newStoredMarkers = (list) => { storedMarkers = list; };
    const newStoredPolygons = (list) => { storedPolygons = list; };
    const newExistingMarkers = (list) => { existingMarkers = list; };
    const newGlobalLoadedTopicIdsWithNames = (list) => { globalLoadedTopicIdsWithNames = list; };
    const newGlobalTopicBios = (bios) => { globalTopicBios = bios; };
    const newActiveMarkerPopups = () => {};
    const newActivePolygonPopups = () => {};
    const isHederaAccount = async () => false;
    const restoreLoadedTopics = () => {};
    const adjustTextareaHeight = () => {};
    const renderLoadedTopics = () => log.push(["rows", globalLoadedTopicIdsWithNames.slice()]);
    const getTopicInfo = async (id) => { log.push(["topic", id]); return { memo: "0.0.5,Zagreb" }; };
    const applyMapTopic = (id, key) => log.push(["mapTopic", id, key]);
    const beginMapDraw = () => 1;
    const mapDrawCurrent = () => true;
    const getMessages = async () => ({
      messages: [{ payer: "0.0.5", setInitialXYZ: { lng: 15.9, lat: 45.8, zoom: 7 } }],
    });
    const topicsToLoad = (id) => [id];
    const topicsInRange = async (list) => list;
    const PULL_AT_ONCE = 3;
    const STACK_FIRST_MS = 0;
    const mapLimited = async (list, limit, job) => { for (const item of list) await job(item); };
    const settlesWithin = async () => true;
    const processTopicMessages = async () => {
      const marker = { created: new Date().toISOString() };
      geojson.features.push(marker);
      return { topicGeojsonFeatures: [marker], topicPolygons: [], loadedTopicName: "Zagreb" };
    };
    const addPolygonWithImageFill = () => {};
    const updateClusters = () => log.push(["updateClusters"]);
    const openedFromPlaceLink = () => false;
    const cancelAnimateMapTo = () => {};
    ${fnSource(hm, "nameRow")}
    ${fnSource(hm, "sortTopicRows")}
    ${fnSource(xyz, "applyInitialXYZ")}
    async ${fnSource(hm, "handleAllMessages")}
    return async (...args) => {
      const rows = await handleAllMessages(...args);
      return { rows, markers: storedMarkers.flat().length };
    };
  `)(log, timeFilterFor, timeRange, inTimeRange);
  return { run, log };
}

test("a plain map load still flies to the topic's saved start view", async () => {
  const { run, log } = mapLoad();
  const out = await run();
  assert.deepEqual(log.filter(([kind]) => kind === "flyTo"), [["flyTo", [15.9, 45.8], 7]]);
  assert.deepEqual(log.find(([kind]) => kind === "topic"), ["topic", "0.0.42"], "no topic: the field's");
  assert.deepEqual(out, { rows: ["0.0.42 - Zagreb"], markers: 1 });
  assert.equal(log.filter(([kind]) => kind === "error").length, 0, JSON.stringify(log));
});

test("a time filter reload (keepView) leaves the camera where it is and does the rest of the load", async () => {
  const plain = mapLoad();
  await plain.run("0.0.42");
  const kept = mapLoad();
  const out = await kept.run("0.0.42", { keepView: true });
  assert.equal(kept.log.filter(([kind]) => kind === "flyTo").length, 0, "no map.flyTo");
  // Everything else is the same load: topic, filter, clusters, rows, toast.
  assert.deepEqual(kept.log, plain.log.filter(([kind]) => kind !== "flyTo"));
  assert.ok(kept.log.some(([kind]) => kind === "clusters"));
  assert.ok(kept.log.some(([kind, text]) => kind === "toast" && text === "Topic loaded"));
  assert.deepEqual(out, { rows: ["0.0.42 - Zagreb"], markers: 1 });
  // The covered-map reload passes no topic: it still reads #input-field.
  const field = mapLoad();
  await field.run(undefined, { keepView: true });
  assert.deepEqual(field.log.find(([kind]) => kind === "topic"), ["topic", "0.0.42"]);
  assert.equal(field.log.filter(([kind]) => kind === "flyTo").length, 0);
});

test("only the start-view fly depends on keepView", () => {
  const load = fnSource(hm, "handleAllMessages");
  assert.equal(load.match(/keepView/g).length, 1);
  assert.match(load, /if \(!opts \|\| !opts\.keepView\) applyInitialXYZ\(result\.messages, topicAdmin\);/);
  assert.equal(load.match(/applyInitialXYZ\(/g).length, 1);
});

// ── The feed and the map bar (feedlayout.js) ──────────────────────────
const feed = read("../feedlayout.js");

test("the feed's chip follows the feed's topic and the map's chip the map's", () => {
  assert.match(feed, /const feedTimeChip = createTimeChip\(\{\s*id: 'feed-time-filter',\s*variant: 'feed',\s*topic: feedChipTopic,\s*\}\);/);
  assert.match(feed, /const mapTimeChip = createTimeChip\(\{\s*id: 'map-time-filter',\s*variant: 'map',\s*topic: mapChipTopic,\s*\}\);\s*onMapTopic\(\(\) => mapTimeChip\.refresh\(\)\);/);
  assert.doesNotMatch(feed, /onPick/);
  assert.match(fnSource(feed, "feedChipTopic"), /return loadedTopic \|\| topicNow\(\);/);
  assert.match(fnSource(feed, "mapChipTopic"), /return mapTopic\(\) \|\| topicNow\(\);/);
  // The chip paints at creation, so what it reads must exist by then.
  assert.ok(feed.indexOf("let loadedTopic = '';") < feed.indexOf("const feedTimeChip = createTimeChip("));
  assert.equal(feed.match(/let loadedTopic\b/g).length, 1);
  // A feed load (new topic, or the filter changed) and the feed opening repaint both.
  assert.match(fnSource(feed, "paintTimeChips"), /feedTimeChip\.refresh\(\);\s*mapTimeChip\.refresh\(\);/);
  const reset = fnSource(feed, "resetFeed");
  assert.ok(reset.indexOf("loadedTopic = topic;") < reset.indexOf("paintTimeChips();"));
  assert.match(fnSource(feed, "ensureTopic"), /paintTimeChips\(\);/);
});

test("a new filter reloads the view that shows that topic, the map with its own topic", () => {
  const at = feed.indexOf("onTimeFilter(({ topic }) => {");
  assert.ok(at > 0);
  const handler = feed.slice(at, feed.indexOf("\n});", at));
  assert.match(handler, /feedOn\(\) && !root\.classList\.contains\('is-peek'\) && topic === loadedTopic\) reloadFeed\(topic\);/);
  assert.match(handler, /!document\.documentElement\.classList\.contains\('feed-app'\) && topic === mapChipTopic\(\)\) handleAllMessages\(topic, \{ keepView: true \}\);/);
  // Not the field: it can hold a topic that was not loaded.
  assert.doesNotMatch(handler, /topicNow\(\)/);
  // A filter changed under the feed reloads the map when it comes back, in place.
  assert.match(fnSource(feed, "syncCover"), /if \(mapFilterStale\(\)\) handleAllMessages\(undefined, \{ keepView: true \}\);/);
});

test("a real topic load still goes to the start view: the other callers pass no keepView", () => {
  assert.equal(feed.match(/handleAllMessages\(/g).length, 3);
  assert.match(feed, /loaded = await handleAllMessages\(\);/);
  const web3 = read("../web3.js");
  assert.equal(web3.match(/handleAllMessages\(\)/g).length, 2);
  assert.match(read("../confirmnft.js"), /await handleAllMessages\(\);/);
  assert.match(read("../rest.js"), /debounce\(handleAllMessages\(\), 10000\);/);
  for (const file of ["../web3.js", "../confirmnft.js", "../rest.js"]) {
    assert.doesNotMatch(read(file), /keepView/, file);
  }
});

// ── The look (style.css) ──────────────────────────────────────────────
const css = read("../style.css");

test("All looks like the other choices, and the map shows its name too", () => {
  const at = css.indexOf("/* ── Time filter (timefilter.js, timefilterui.js)");
  const end = css.indexOf(".time-filter-menu {", at);
  assert.ok(at > 0 && end > at);
  const block = css.slice(at, end);
  assert.doesNotMatch(block, /is-on/);
  assert.doesNotMatch(block, /time-filter-label \{\s*display: none/);
  const chip = block.slice(block.indexOf(".time-filter-chip {"), block.indexOf("}", block.indexOf(".time-filter-chip {")));
  assert.match(chip, /border: 0\.0625rem solid #22D3EE;/);
  assert.match(chip, /background: rgba\(8, 51, 68, 0\.6\);/);
  assert.match(chip, /color: #22D3EE;/);
  const map = block.slice(block.indexOf("#map-topbar .time-filter.is-map .time-filter-chip {"));
  assert.doesNotMatch(map.slice(0, map.indexOf("}")), /transparent/);
});

test("the menu stays one line wide for the longest label and its check", () => {
  const menuAt = css.indexOf(".time-filter-menu {");
  const menu = css.slice(menuAt, css.indexOf("}", menuAt));
  assert.match(menu, /width:\s*max-content/);
  assert.match(menu, /min-width:\s*100%/);
  assert.match(menu, /max-width:[^;]*vw/);
  const itemAt = css.indexOf(".time-filter-item {");
  const item = css.slice(itemAt, css.indexOf("}", itemAt));
  assert.match(item, /white-space:\s*nowrap/);
  const mark = css.slice(css.indexOf(".time-filter-item::after {"), css.indexOf(".time-filter-item[aria-checked=\"true\"] {"));
  assert.match(mark, /content:\s*"✓"/);
  assert.match(mark, /visibility:\s*hidden/);
  const on = css.slice(css.indexOf(".time-filter-item[aria-checked=\"true\"]::after {"));
  assert.match(on.slice(0, on.indexOf("}")), /visibility:\s*visible/);
  assert.doesNotMatch(on.slice(0, on.indexOf("}")), /content:/);
});
