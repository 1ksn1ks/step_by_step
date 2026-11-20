// Installing for a community (installtarget.js, domainregistry.js): how a
// link names its community, how a name for the icon is cleaned, the
// manifest URL a choice asks for, and which registry names are live. The
// page and the server import these same functions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APP_NAME,
  DEFAULT_TOPIC,
  LABEL_MAX,
  SHORT_MAX,
  cleanLabel,
  cleanStart,
  defaultLabel,
  hasManifestQuery,
  isDefaultStart,
  manifestHref,
  readManifestQuery,
  shortLabel,
  startFromUrl,
  startPath,
} from "../installtarget.js";
import { DOMAIN_SECONDS, DOMAIN_TOPIC, activeDomains, linkableDomains } from "../domainregistry.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a link names its community by its first path segment, else ?topic=", () => {
  assert.equal(startFromUrl("https://onlyonhbar.com/"), "");
  assert.equal(startFromUrl("https://onlyonhbar.com/zagreb"), "zagreb");
  assert.equal(startFromUrl("https://onlyonhbar.com/zagreb/more?x=1"), "zagreb");
  assert.equal(startFromUrl("https://onlyonhbar.com/0.0.123"), "0.0.123");
  assert.equal(startFromUrl("https://onlyonhbar.com/?topic=0.0.77"), "0.0.77");
  assert.equal(startFromUrl("https://onlyonhbar.com/caf%C3%A9"), "café");
  // The path wins over the older ?topic=.
  assert.equal(startFromUrl("https://onlyonhbar.com/zagreb?topic=0.0.77"), "zagreb");
  // A malformed escape is no start, not a thrown error at startup.
  assert.equal(startFromUrl("https://onlyonhbar.com/%E0%A4%A"), "");
  assert.equal(startFromUrl("not a url"), "");
});

test("a start is a topic id or a name's shape; anything else is nothing", () => {
  assert.equal(cleanStart("0.0.123"), "0.0.123");
  assert.equal(cleanStart(" Zagreb "), "zagreb");
  assert.equal(cleanStart("klub-žuto"), "klub-žuto");
  for (const bad of ["", "a b", "a/b", "a\\b", "a?b", "a#b", "50%", "x‮y", "zero​width", "tab\tx", "0.0.12x", "my0.0.5", "a".repeat(65)]) {
    assert.equal(cleanStart(bad), "", JSON.stringify(bad));
  }
  assert.equal(cleanStart("a".repeat(64)), "a".repeat(64));
  assert.equal(isDefaultStart(""), true);
  assert.equal(isDefaultStart(DEFAULT_TOPIC), true);
  assert.equal(isDefaultStart("zagreb"), false);
  assert.equal(startPath(""), "/");
  assert.equal(startPath(DEFAULT_TOPIC), "/");
  assert.equal(startPath("zagreb"), "/zagreb");
  assert.equal(startPath("klub-žuto"), "/klub-%C5%BEuto");
});

test("the name under the icon is cleaned, capped, and shortened for the launcher", () => {
  assert.equal(defaultLabel(""), "Web3Globe");
  assert.equal(defaultLabel("Zagreb"), "Web3Globe · Zagreb");
  assert.equal(cleanLabel("  My \n\t map  "), "My map");
  assert.equal(cleanLabel("‮evil‬ name​"), "evil name");
  assert.equal(cleanLabel("\u0000\u0007"), "");
  assert.equal(cleanLabel("é"), "é", "NFC");
  const long = cleanLabel("x".repeat(100));
  assert.equal(long.length, LABEL_MAX);
  // Emoji count as one character each and are not cut in half.
  assert.equal(Array.from(cleanLabel("🗺".repeat(50))).length, LABEL_MAX);
  assert.equal(defaultLabel("y".repeat(60)).length, LABEL_MAX);
  // short_name: the name, else the community part, else cut at a word.
  assert.equal(shortLabel("Web3Globe"), "Web3Globe");
  assert.equal(shortLabel("Web3Globe · Zagreb"), "Zagreb");
  assert.equal(shortLabel("Web3Globe · Zagreb Runners Club"), "Zagreb");
  assert.equal(shortLabel("Supercalifragilistic"), "Supercalifra");
  assert.equal(shortLabel(""), APP_NAME);
  for (const label of ["Web3Globe · Zagreb Runners Club", "A".repeat(40), "My long community name"]) {
    assert.ok(Array.from(shortLabel(label)).length <= SHORT_MAX, label);
  }
});

test("a choice asks for its manifest; the default with its own name and the app icon is the plain file", () => {
  assert.equal(manifestHref({}), "/manifest.webmanifest");
  assert.equal(manifestHref({ start: DEFAULT_TOPIC }), "/manifest.webmanifest");
  assert.equal(manifestHref({ start: "zagreb" }), "/manifest.webmanifest?start=zagreb");
  assert.equal(manifestHref({ start: "0.0.5", label: "Runners", icon: "pic" }), "/manifest.webmanifest?start=0.0.5&n=Runners&icon=pic");
  assert.equal(manifestHref({ label: "My map" }), "/manifest.webmanifest?n=My+map");
  assert.equal(manifestHref({ icon: "pic" }), "/manifest.webmanifest?icon=pic");
  // Never anything but the three, cleaned.
  assert.equal(manifestHref({ start: "a/b", label: "‮", icon: "https://evil.example/x.png" }), "/manifest.webmanifest");
});

test("the server reads a manifest request back the same way, every part cleaned", () => {
  assert.equal(hasManifestQuery({}), false);
  assert.equal(hasManifestQuery({ other: "1" }), false);
  assert.equal(hasManifestQuery({ start: "zagreb" }), true);
  assert.equal(hasManifestQuery({ icon: "pic" }), true);
  assert.deepEqual(readManifestQuery({ start: "Zagreb", n: " Runners​ ", icon: "pic" }), { start: "zagreb", label: "Runners", icon: "pic" });
  assert.deepEqual(readManifestQuery({ start: DEFAULT_TOPIC }), { start: "", label: "", icon: "" });
  // Repeated keys take the first; objects and strange icons are nothing.
  assert.deepEqual(readManifestQuery({ start: ["0.0.9", "zagreb"], n: { a: 1 }, icon: "https://x" }), { start: "0.0.9", label: "", icon: "" });
  assert.equal(readManifestQuery({ n: "x".repeat(10000) }).label.length, LABEL_MAX);
  const href = manifestHref({ start: "0.0.5", label: "Runners Club", icon: "pic" });
  const query = Object.fromEntries(new URL(href, "https://h").searchParams);
  assert.deepEqual(readManifestQuery(query), { start: "0.0.5", label: "Runners Club", icon: "pic" });
});

// ── The name registry ─────────────────────────────────────────────────
const at = (seconds) => `${seconds}.000000000`;
const msg = (seq, payer, domain, topic, seconds) => ({ sequence_number: seq, payer, domain, topic, consensus_timestamp: at(seconds) });

test("a name stays with its owner while their time runs, and passes on once it lapses", () => {
  const t0 = 1_000_000;
  const messages = [
    msg(1, "0.0.1", "zagreb", "0.0.100", t0),
    // Someone else while the owner's time runs: ignored.
    msg(2, "0.0.2", "zagreb", "0.0.200", t0 + 10),
    // The owner adds time before the lapse: one more period.
    msg(3, "0.0.1", "zagreb", "0.0.101", t0 + 20),
  ];
  let [entry] = activeDomains(messages, t0 + 30);
  assert.equal(entry.lastMessage.topic, "0.0.101");
  assert.equal(entry.addedTime, t0 + 2 * DOMAIN_SECONDS);
  // Lapsed: nothing is live.
  assert.deepEqual(activeDomains(messages, t0 + 2 * DOMAIN_SECONDS + 1), []);
  // After the lapse another payer takes it over.
  const later = [...messages, msg(4, "0.0.2", "zagreb", "0.0.200", t0 + 2 * DOMAIN_SECONDS + 5)];
  [entry] = activeDomains(later, t0 + 2 * DOMAIN_SECONDS + 10);
  assert.equal(entry.lastMessage.payer, "0.0.2");
  assert.equal(entry.lastMessage.topic, "0.0.200");
});

test("a message read twice counts once, and topic-id-shaped names are not links", () => {
  const t0 = 2_000_000;
  const once = [msg(1, "0.0.1", "club", "0.0.300", t0), msg(2, "0.0.1", "club", "0.0.300", t0 + 1)];
  const twice = [...once, ...once.map((m) => ({ ...m })), JSON.stringify(once[0])];
  assert.deepEqual(activeDomains(twice, t0 + 5), activeDomains(once, t0 + 5));
  const named = [msg(1, "0.0.1", "club", "0.0.300", t0), msg(2, "0.0.1", "0.0.300", "0.0.300", t0), { payer: "0.0.1" }, "not json"];
  assert.deepEqual(activeDomains(named, t0 + 5).map((e) => e.domain).sort(), ["0.0.300", "club"]);
  assert.deepEqual(linkableDomains(named, t0 + 5).map((e) => e.domain), ["club"]);
  assert.equal(DOMAIN_TOPIC, "0.0.9606779");
});

test("the page reads links and the registry with these same rules", () => {
  const extract = read("../extracttopic.js");
  assert.match(extract, /import \{ DEFAULT_TOPIC, startFromUrl \} from '\.\/installtarget\.js';/);
  assert.match(extract, /const userInput = startFromUrl\(window\.location\.href\);/);
  const domains = read("../loaddomains.js");
  assert.match(domains, /getMessages\(DOMAIN_TOPIC\)/);
  assert.match(domains, /return linkableDomains\(rawResult\.messages, Date\.now\(\) \/ 1000\);/);
  assert.doesNotMatch(domains, /SECONDS_TO_ADD/);
});
