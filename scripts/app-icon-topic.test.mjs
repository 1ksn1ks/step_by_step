// The App icon card lives in Update topic, under the key card, and follows
// #update-topic-target. rest.js and cssLogic.js touch the whole page, so
// their functions are read from the source and run against stand-ins.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminsFromMemo, currentAppIcon, isTopicId } from "../loadcurrenttopic.js";

// The working copy has CRLF line ends.
function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const html = read("../index.html");
const rest = read("../rest.js");
const css = read("../style.css");

// The whole `function name(...) { ... }` text (async or not).
function fn(src, name) {
  const at = src.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(at >= 0, name);
  const brace = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`no end for ${name}`);
}

// <div> nesting from the end of `open` up to `at`: 0 means a direct child.
function depthBetween(open, at) {
  const part = html.slice(html.indexOf(">", open) + 1, at);
  return (part.match(/<div\b/g) || []).length - (part.match(/<\/div>/g) || []).length;
}

test("the card sits in Update topic right after the key card, its own section", () => {
  const card = html.indexOf('<div class="cover-autoplay-field" id="app-icon-field">');
  const container = html.indexOf('<div id="memo-column-container">');
  const key = html.indexOf('<div class="memo-key-card">');
  const bio = html.indexOf('<div id="update-bio-from-memo"');
  assert.ok(card > 0 && container > 0 && key > container && card > key && bio > card);
  assert.equal(html.split('id="app-icon-field"').length - 1, 1);
  // A direct child of the container, so not inside the key card.
  assert.equal(depthBetween(container, card), 0);
  assert.match(html.slice(key, card), /<button id="pin-publickkey-load"[^>]*>[^<]*<\/button>\n\s*<\/div>\n\s*(?:<!--[^>]*-->\n\s*)?$/);
  // Gone from the NFT page's Polygons part; the Autoplay card stays there.
  const polygons = html.indexOf('<div id="polygons-from-nft-utility"');
  const help = html.indexOf('<div id="edit-topic-rules-help-overlay"');
  assert.ok(polygons > 0 && help > polygons);
  const nft = html.slice(polygons, help);
  assert.equal(nft.includes("app-icon"), false);
  assert.ok(nft.includes('id="cover-autoplay-field"'));
  // Same ids and children.
  const end = html.indexOf('<div id="update-bio-from-memo"', card);
  const block = html.slice(card, end);
  for (const id of ["app-icon-preview", "app-icon-preview-img", "app-icon-preview-fallback", "submit-button-upload-app-icon", "submit-button-clear-app-icon", "app-icon-file"]) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
    assert.ok(block.includes(`id="${id}"`), id);
  }
  assert.match(block, /<label class="cover-autoplay-label" for="app-icon-file">App icon<\/label>/);
  assert.match(block, />Profile picture<\/span>/);
  assert.match(block, />Upload image<\/button>/);
  assert.match(block, />Use profile picture<\/button>/);
});

test("the Update Topic help says what App icon is", () => {
  const start = html.indexOf('<div id="edit-topic-rules-help-overlay"');
  const help = html.slice(start, html.indexOf("</ul>", start));
  assert.equal((help.match(/<li><b>App icon<\/b>/g) || []).length, 1);
});

function targetHarness(value, domains = []) {
  const document = { getElementById: (id) => (id === "update-topic-target" && value !== null ? { value } : null) };
  return new Function("document", "loadedDomains", `${fn(rest, "updateTopicTargetId")}\nreturn updateTopicTargetId;`)(document, domains);
}

test("Update topic's target resolves a domain like the NFT field does", () => {
  const domains = [{ domain: "globe.hbar", lastMessage: { topic: "0.0.4242" } }, { domain: "empty.hbar" }];
  assert.equal(targetHarness("0.0.77", domains)(), "0.0.77");
  assert.equal(targetHarness("  0.0.77\n", domains)(), "0.0.77");
  assert.equal(targetHarness("Globe.HBAR", domains)(), "0.0.4242");
  assert.equal(targetHarness("empty.hbar", domains)(), "empty.hbar");
  assert.equal(targetHarness("", domains)(), "");
  assert.equal(targetHarness(null, domains)(), "");
  // utilityTopicId still reads the NFT field, for the NFT rules.
  assert.match(fn(rest, "utilityTopicId"), /getElementById\("input-field-topic-id-for-utility"\)/);
  assert.match(rest, /async function sendUtilityRules\(rules, topicId = utilityTopicId\(\)\)/);
});

test("the App icon admin check and the send use Update topic's target", () => {
  for (const name of ["maySetAppIcon", "sendAppIcon"]) {
    const body = fn(rest, name);
    assert.match(body, /const topicId = updateTopicTargetId\(\);/, name);
    assert.equal(body.includes("utilityTopicId"), false, name);
  }
  assert.match(fn(rest, "maySetAppIcon"), /Only this topic's memo admins can set its app icon\./);
});

// previewAppIconForTarget with stand-ins for the network and the card.
function previewHarness({ target, busy = false, messages = {}, memos = {}, fail = false, loaded = [], loadedTopic = "" }) {
  const shown = [];
  const reads = [];
  const gates = new Map();
  const env = {
    shown,
    reads,
    infos: [],
    target,
    busy,
    loaded,
    loadedTopic,
    // A read waits here until the test lets it go, so two can overlap.
    gate(id) {
      let open;
      const p = new Promise((resolve) => { open = resolve; });
      gates.set(id, open);
      return p;
    },
    release(id) { const open = gates.get(id); if (open) open(); },
    gated: new Set(),
  };
  const api = new Function("env", "isTopicId", "currentAppIcon", "adminsFromMemo", `
    let appIconBusy = env.busy;
    let appIconTopic = "";
    let appIconReadSeq = 0;
    const appIconPreviewCache = new Map();
    const APP_ICON_CACHE_MAX = 20;
    const allLoadedMessages = env.loaded || [];
    const mapTopic = () => env.loadedTopic || "";
    const updateTopicTargetId = () => env.target;
    const showAppIconPreview = (src) => env.shown.push(src);
    const isOwnR2Image = (url) => url.startsWith("https://r2.test/");
    const getMessages = async (id) => {
      env.reads.push(id);
      if (env.gated.has(id)) await env.gate(id);
      if (${fail}) throw new Error("offline");
      return { messages: ${JSON.stringify(messages)}[id] || [] };
    };
    const getTopicInfo = async (id) => {
      env.infos.push(id);
      return { memo: ${JSON.stringify(memos)}[id] || "" };
    };
    ${fn(rest, "loadedAppIconMessages")}
    ${fn(rest, "rememberAppIconPreview")}
    ${fn(rest, "previewAppIconForTarget")}
    return {
      run: previewAppIconForTarget,
      setBusy(on) { appIconBusy = on; },
    };
  `)(env, isTopicId, currentAppIcon, adminsFromMemo);
  return { api, env };
}

const ICON = "https://r2.test/markers/icon.png";
const MESSAGES = {
  "0.0.10": [{ payer: "0.0.2", appIcon: ICON }],
  "0.0.11": [{ payer: "0.0.2", changeName: "x" }],
  "0.0.12": [{ payer: "0.0.9", appIcon: ICON }],
};
const MEMOS = { "0.0.10": "0.0.2", "0.0.11": "0.0.2", "0.0.12": "0.0.2" };

test("an empty or invalid target shows Profile picture without reading anything", async () => {
  for (const target of ["", "not a topic", "globe.hbar", "0.0.x"]) {
    const { api, env } = previewHarness({ target, messages: MESSAGES, memos: MEMOS });
    await api.run();
    assert.deepEqual(env.shown, [""], target);
    assert.deepEqual(env.reads, [], target);
  }
});

test("a topic shows its admins' current icon, the same read as Load Topic Rules", async () => {
  const set = previewHarness({ target: "0.0.10", messages: MESSAGES, memos: MEMOS });
  await set.api.run();
  assert.deepEqual(set.env.reads, ["0.0.10"]);
  // Profile picture while it reads a new topic, then the icon.
  assert.deepEqual(set.env.shown, ["", ICON]);
  const none = previewHarness({ target: "0.0.11", messages: MESSAGES, memos: MEMOS });
  await none.api.run();
  assert.deepEqual(none.env.shown, ["", ""]);
  // A non-admin's icon does not count.
  const stranger = previewHarness({ target: "0.0.12", messages: MESSAGES, memos: MEMOS });
  await stranger.api.run();
  assert.deepEqual(stranger.env.shown, ["", ""]);
  const offline = previewHarness({ target: "0.0.10", messages: MESSAGES, memos: MEMOS, fail: true });
  await offline.api.run();
  assert.deepEqual(offline.env.shown, ["", ""]);
});

test("the same topic again keeps its picture and does not read again; a slower old read never wins", async () => {
  const { api, env } = previewHarness({ target: "0.0.10", messages: MESSAGES, memos: MEMOS });
  await api.run();
  await api.run();
  assert.deepEqual(env.reads, ["0.0.10"]);
  assert.deepEqual(env.infos, ["0.0.10"]);
  assert.deepEqual(env.shown, ["", ICON, ICON], "no flash back to Profile picture");

  const race = previewHarness({ target: "0.0.10", messages: MESSAGES, memos: MEMOS });
  race.env.gated.add("0.0.10");
  const slow = race.api.run();
  race.env.target = "0.0.11";
  await race.api.run();
  race.env.release("0.0.10");
  await slow;
  assert.deepEqual(race.env.shown, ["", "", ""], "0.0.10's icon never shows over 0.0.11");
});

test("the topic the map has open uses its loaded messages", async () => {
  const loaded = previewHarness({
    target: "0.0.10",
    messages: MESSAGES,
    memos: MEMOS,
    loadedTopic: "0.0.10",
    loaded: [{ topicId: "0.0.10", uniqueMessages: { messages: MESSAGES["0.0.10"] } }],
  });
  await loaded.api.run();
  assert.deepEqual(loaded.env.reads, []);
  assert.deepEqual(loaded.env.infos, ["0.0.10"]);
  assert.deepEqual(loaded.env.shown, ["", ICON]);
  await loaded.api.run();
  assert.deepEqual(loaded.env.reads, []);
  assert.deepEqual(loaded.env.infos, ["0.0.10"]);

  const other = previewHarness({
    target: "0.0.10",
    messages: MESSAGES,
    memos: MEMOS,
    loadedTopic: "0.0.11",
    loaded: [{ topicId: "0.0.10", uniqueMessages: { messages: MESSAGES["0.0.10"] } }],
  });
  await other.api.run();
  assert.deepEqual(other.env.reads, ["0.0.10"]);
});

test("the icon cache keeps 20 topics and drops the oldest", async () => {
  const { api, env } = previewHarness({ target: "0.0.3000", messages: MESSAGES, memos: MEMOS });
  const ids = Array.from({ length: 21 }, (_, i) => `0.0.${3000 + i}`);
  for (const id of ids) {
    env.target = id;
    await api.run();
  }
  assert.equal(env.reads.length, 21);
  env.target = ids[20];
  await api.run();
  assert.equal(env.reads.length, 21);
  env.target = ids[0];
  await api.run();
  assert.equal(env.reads.length, 22);
});

test("a successful set drops that topic's cached icon", () => {
  const send = fn(rest, "sendAppIcon");
  const sentAt = send.indexOf("await sendMessage(topicId, appIconConfigMessage(raw));");
  const dropAt = send.indexOf("appIconPreviewCache.delete(topicId);");
  assert.ok(sentAt > 0 && dropAt > sentAt);
  assert.ok(dropAt < send.indexOf("return true;"));
  const clear = rest.slice(
    rest.indexOf('getElementById("submit-button-clear-app-icon").addEventListener'),
    rest.indexOf("submit-button-remove-rules-for-polygons"),
  );
  assert.match(clear, /const sent = await sendAppIcon\(""\);/);
});

test("an upload in progress keeps its preview", async () => {
  const { api, env } = previewHarness({ target: "0.0.10", busy: true, messages: MESSAGES, memos: MEMOS });
  await api.run();
  assert.deepEqual(env.shown, []);
  const invalid = previewHarness({ target: "", busy: true });
  await invalid.api.run();
  assert.deepEqual(invalid.env.shown, []);
});

test("the preview follows the target: open (prefill), typing and change, debounced", () => {
  assert.match(rest, /const previewAppIconSoon = debounce\(previewAppIconForTarget, \d+\);/);
  const wire = rest.slice(rest.indexOf("const previewAppIconSoon"), rest.indexOf("const previewAppIconSoon") + 400);
  assert.match(wire, /getElementById\("update-topic-target"\)/);
  assert.match(wire, /addEventListener\("input", previewAppIconSoon\)/);
  assert.match(wire, /addEventListener\("change", previewAppIconSoon\)/);
  const logic = read("../cssLogic.js");
  const prefill = fn(logic, "prefillUpdateTopicTarget");
  assert.match(prefill, /syncUpdateTopicTarget\(\);\s*\n\s*(?:\/\/[^\n]*\n\s*)*field\.dispatchEvent\(new Event\("change"\)\);/);
  // The NFT page's Load Topic Rules flow still paints from its own read.
  const load = rest.slice(rest.indexOf('getElementById("load-topic-rules-for-utility")'), rest.indexOf('getElementById("load-topic-rules-for-utility")') + 6000);
  assert.match(load, /const appIcon = currentAppIcon\(messages, adminsFromMemo\(memo\), \(url\) => isOwnR2Image\(url\)\);/);
  assert.match(load, /showAppIconPreview\(appIcon\);/);
});

test("uploads from Update topic mount their check inside Update topic", () => {
  const src = read("../uploadmedia.js");
  const sheetFor = new Function(`${fn(src, "sheetFor")}\nreturn sheetFor;`)();
  let asked = "";
  const anchor = { closest(selector) { asked = selector; return "sheet"; } };
  assert.equal(sheetFor(anchor), "sheet");
  const list = asked.split(",").map((s) => s.trim());
  for (const id of ["#draw-column", "#Edit_Profile-column", "#topic-chat-container", "#encrypted-chat-container", "#utility-column", "#memo-column"]) {
    assert.ok(list.includes(id), id);
  }
  assert.equal(sheetFor(null), null);
});

test("the card wears Update topic's section glass and keeps its tile and buttons", () => {
  // The label rule now covers both pages.
  assert.match(css, /#utility-column-container label\.cover-autoplay-label,\n#memo-column-container label\.cover-autoplay-label \{/);
  // One of the page's section cards (same glass, radius, gap and padding).
  const at = css.indexOf("#memo-column #memo-column-container > #app-icon-field {\n  display: flex !important;");
  const list = css.slice(css.lastIndexOf("}", at), at);
  assert.ok(at > 0, "joined the section card rule");
  assert.match(list, /#memo-column #memo-column-container > \.memo-key-card:has\(/);
  const rule = css.slice(at, css.indexOf("}", at));
  for (const line of ["background: rgba(255, 255, 255, 0.06);", "border-radius: var(--ui-card-radius);", "gap: var(--ui-gap);", "margin: 0 0 var(--ui-gap);", "border: 0;", "box-shadow: none;"]) {
    assert.ok(rule.includes(line), line);
  }
  // The page's type scale, no NFT frame or blur, the page's button size.
  const startOwn = css.indexOf("/* App icon: the NFT card's markup");
  const endOwn = css.indexOf("#memo-column #memo-column-container :is(#update-bio-from-memo", startOwn);
  assert.ok(startOwn > 0 && endOwn > startOwn);
  const own = css.slice(startOwn, endOwn);
  assert.match(own, /--fu: inherit;/);
  assert.match(own, /--ui-label: inherit;/);
  assert.match(own, /--ui-small: inherit;/);
  assert.match(own, /backdrop-filter: none;/);
  assert.match(own, /:is\(\.cover-autoplay-save, \.cover-autoplay-clear\) \{\n  min-height: var\(--ui-btn-h\);\n  border-radius: var\(--ui-radius\);/);
  assert.equal(/\dpx/.test(own), false);
  // The tile and the pair's colours are the NFT card's, untouched.
  assert.match(css, /\.app-icon-preview \{[^}]*width: calc\(var\(--fu\) \* 6\.4\);/);
  assert.match(css, /\.cover-autoplay-save \{\n  border: 0;\n  background: #22D3EE;/);
  assert.match(css, /\.cover-autoplay-clear \{\n  border: solid #22D3EE;/);
});
