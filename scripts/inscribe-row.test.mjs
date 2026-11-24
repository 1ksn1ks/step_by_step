// The map Toolbar's Inscribe row: its place in the list, its dressing (an
// action, so no chevron), and the tap → picker → wallet → runInscribe order.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INSCRIBE_ACCEPT, INSCRIBE_CONNECT_CLASS, bindInscribeRow } from "../inscriberow.js";

// The working copy has CRLF line ends.
function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const html = read("../index.html");
const layout = read("../feedlayout.js");

function fn(src, name) {
  const at = src.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.ok(at >= 0, name);
  const brace = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1).replace(/^export /, "");
    }
  }
  throw new Error(`no end for ${name}`);
}

// The top-level keys of `const NAME = { ... };`.
function objectKeys(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, name);
  const body = src.slice(start, src.indexOf("\n};", start));
  return [...body.matchAll(/^  '?([A-Za-z_][\w-]*)'?:/gm)].map((m) => m[1]);
}

const ROWS = [
  ["Edit_Profile", "Edit", "Picture, name and bio"],
  ["Load_Everything", "Load", "Open a topic or account"],
  ["Draw_Marker_Polygon", "Draw", "Place a marker or polygon"],
  ["Inscribe_Hashinal", "Inscribe", "Inscribe a Hashinal on Hedera"],
  ["Mint_Token", "Mint", "Create a token or NFT on Hedera"],
  ["Create_New_Topic", "Create", "New topic or keys"],
  ["Domain", "Domain", "Name and renew a domain"],
  ["NFT-utility", "NFT Utility", "Models, markers and chat rules"],
  ["Change_Memo", "Update Topic", "Bio, name, memo and fee"],
  ["Stack_topic_IDs", "Stack topic IDs", "Topics that open together"],
  ["Set_Initial_XYZ", "Set initial XYZ", "Where a topic opens on the map"],
];

test("Inscribe sits right after Draw in the map Toolbar; the other rows are as they were", () => {
  const start = html.indexOf('<div id="toolbar" class="toolbar set-group"');
  const toolbar = html.slice(start, html.indexOf("\n      </div>", start));
  const rows = [...toolbar.matchAll(/<div class="toolbar-column set-nav" id="([^"]+)"><span class="set-nav-copy"><span class="set-nav-label">([^<]+)<\/span><span class="set-nav-desc">([^<]+)<\/span><\/span><\/div>/g)]
    .map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows, ROWS);
  assert.equal(html.split('id="Inscribe_Hashinal"').length - 1, 1);
  // Not on the feed's bar.
  const feedAt = html.indexOf('id="feed-toolbar"');
  if (feedAt >= 0) assert.equal(html.slice(feedAt, feedAt + 4000).includes("Inscribe"), false);
  // The drawer's Toolbar item stays map only, and the row opens no page.
  assert.match(layout, /\{ label: 'Toolbar', icon: TOOLS_ICON, mode: 'map', run: \(\) => openDrawerPanel\('toolbar'\) \}/);
  assert.equal(objectKeys(layout, "NAV_PANELS").includes("Inscribe_Hashinal"), false);
  const children = layout.slice(layout.indexOf("const DRAWER_CHILDREN = {"), layout.indexOf("\n};", layout.indexOf("const DRAWER_CHILDREN = {")));
  assert.equal(children.includes("Inscribe"), false);
  assert.equal(read("../cssLogic.js").includes("Inscribe_Hashinal"), false);
});

test("its icon is a 24-unit stroke like its neighbours', and only it has no panel", () => {
  const icons = objectKeys(layout, "NAV_ICONS");
  const panels = objectKeys(layout, "NAV_PANELS");
  assert.ok(icons.includes("Inscribe_Hashinal"));
  assert.deepEqual(icons.filter((id) => !panels.includes(id)), ["Inscribe_Hashinal"]);
  const at = layout.indexOf("  Inscribe_Hashinal: [");
  const icon = layout.slice(at, layout.indexOf("\n  ],", at));
  const coords = [...icon.matchAll(/d: '([^']+)'/g)].flatMap((m) => m[1].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  assert.ok(coords.length > 0 && coords.every((n) => n >= -24 && n <= 24));
  assert.equal(icon.includes("stroke-width"), false, "svgIcon sets stroke 2 for every row");
});

// dressNavRows from feedlayout.js on two stand-in rows.
function dressed() {
  const els = {};
  const make = (id) => {
    const el = {
      id,
      dataset: {},
      children: [],
      attrs: {},
      listeners: {},
      classList: { add() {} },
      tabIndex: -1,
      firstChild: null,
      querySelector: (sel) => el.children.find((c) => sel === "." + c.className) || null,
      setAttribute(k, v) { el.attrs[k] = v; },
      addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); },
      insertBefore(child) { el.children.unshift(child); },
      appendChild(child) { el.children.push(child); },
    };
    els[id] = el;
    return el;
  };
  make("Draw_Marker_Polygon");
  make("Inscribe_Hashinal");
  const document = {
    getElementById: (id) => els[id] || null,
    createElement: () => ({ className: "", children: [], appendChild(c) { this.children.push(c); } }),
  };
  const run = new Function("document", "NAV_ICONS", "NAV_PANELS", "svgIcon", "chevronIcon", `${fn(layout, "dressNavRows")}\ndressNavRows();`);
  run(
    document,
    { Draw_Marker_Polygon: [["path", {}]], Inscribe_Hashinal: [["path", {}]] },
    { Draw_Marker_Polygon: "draw-column" },
    () => ({ svg: true }),
    () => ({ chevron: true }),
  );
  return els;
}

test("dressNavRows gives Inscribe its icon and keys but no chevron or panel", () => {
  const { Draw_Marker_Polygon: draw, Inscribe_Hashinal: inscribe } = dressed();
  assert.deepEqual(draw.children.map((c) => c.className), ["set-nav-icon", "set-nav-chev"]);
  assert.equal(draw.dataset.panel, "draw-column");
  assert.deepEqual(inscribe.children.map((c) => c.className), ["set-nav-icon"]);
  assert.equal(inscribe.dataset.panel, undefined);
  for (const row of [draw, inscribe]) {
    assert.equal(row.attrs.role, "button");
    assert.equal(row.tabIndex, 0);
    assert.equal((row.listeners.keydown || []).length, 1);
  }
  // Enter and Space click the row, the same as a tap.
  let clicked = 0;
  inscribe.click = () => { clicked += 1; };
  for (const key of ["Enter", " ", "a"]) inscribe.listeners.keydown[0]({ key, repeat: false, preventDefault() {} });
  assert.equal(clicked, 2);
});

// --- bindInscribeRow with stand-ins ----------------------------------------
function fakeEl(tag, log) {
  const el = {
    tagName: tag.toUpperCase(),
    attrs: {},
    listeners: {},
    files: null,
    value: "",
    clicks: 0,
    setAttribute(k, v) { el.attrs[k] = String(v); },
    addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); },
    removeEventListener(t, f) { el.listeners[t] = (el.listeners[t] || []).filter((x) => x !== f); },
    click() { el.clicks += 1; log.push("picker"); },
  };
  return el;
}

// Runs a click's listeners on el; true when one of them stopped it.
function fire(el, type = "click") {
  let stopped = false;
  for (const f of [...(el.listeners[type] || [])]) f({ stopPropagation() { stopped = true; } });
  return stopped;
}

function harness({ wallet = "ok", walletThrows = false } = {}) {
  const log = [];
  const classes = new Set();
  const doc = {
    card: false,
    body: { kids: [], appendChild(el) { this.kids.push(el); el.parentNode = this; return el; } },
    documentElement: {
      classList: {
        add(c) { classes.add(c); log.push(`add:${c}`); },
        remove(c) { classes.delete(c); log.push(`remove:${c}`); },
        contains: (c) => classes.has(c),
      },
    },
    createElement: (tag) => fakeEl(tag, log),
    querySelector: (sel) => (doc.card && sel.includes("inscribe-notice-title") && sel.includes("inscribe-overcap-title") ? {} : null),
    getElementById: (id) => (id === "connect-wallet-btn" ? connect : null),
  };
  const connect = fakeEl("button", log);
  const row = fakeEl("div", log);
  const runs = [];
  const connectStops = [];
  let walletGate = null;
  const deps = {
    ensureWallet: async () => {
      log.push("wallet");
      // ensureWallet clicks the hidden Connect: does that click bubble?
      connectStops.push(fire(connect));
      if (walletGate) await walletGate;
      if (walletThrows) throw new Error("no sheet");
      return wallet;
    },
    runInscribe: (file, options) => {
      log.push("run");
      runs.push({ file, options });
      return Promise.resolve(null);
    },
  };
  const input = bindInscribeRow({ row, doc, ...deps });
  const tap = () => {
    let stopped = false;
    for (const f of row.listeners.click) f({ stopPropagation() { stopped = true; } });
    return stopped;
  };
  const pick = (file) => {
    input.files = file ? [file] : [];
    input.value = file ? "C:\\fakepath\\" + file.name : "";
    return input.listeners.change[0]();
  };
  return { log, doc, row, input, connect, connectStops, runs, tap, pick, classes, hold(p) { walletGate = p; } };
}

const FILE = { name: "art.png", type: "image/png", size: 1000 };

test("the hidden input takes the files Hashinals can be, off screen and out of tab order", () => {
  const h = harness();
  assert.equal(h.input.type, "file");
  assert.equal(h.input.accept, INSCRIBE_ACCEPT);
  assert.equal(INSCRIBE_ACCEPT, "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.glb,.gltf,model/gltf-binary,model/gltf+json");
  assert.equal(h.input.hidden, true);
  assert.equal(h.input.tabIndex, -1);
  assert.equal(h.doc.body.kids[0], h.input);
  assert.equal(bindInscribeRow({ row: null, doc: h.doc, ensureWallet() {}, runInscribe() {} }), null);
  assert.equal(bindInscribeRow({ row: h.row, doc: h.doc, runInscribe() {} }), null);
});

test("a tap opens the picker in the same call and stops there", () => {
  const h = harness();
  const stopped = h.tap();
  // Synchronously: nothing awaited between the tap and the picker.
  assert.equal(h.input.clicks, 1);
  assert.equal(stopped, true);
  assert.deepEqual(h.log, ["picker"]);
  assert.deepEqual(h.runs, []);
  // The picker's own click must not reach the document's CloseALL either.
  assert.equal(fire(h.input), true);
});

test("the wallet step's Connect click does not bubble, and only during that step", async () => {
  const h = harness();
  h.tap();
  assert.equal(fire(h.connect), false, "before: Connect is left alone");
  await h.pick(FILE);
  assert.deepEqual(h.connectStops, [true]);
  assert.equal(fire(h.connect), false, "after: the listener is gone");
  for (const outcome of ["cancel", "fail"]) {
    const c = harness({ wallet: outcome });
    c.tap();
    await c.pick(FILE);
    assert.deepEqual(c.connectStops, [true], outcome);
    assert.equal(fire(c.connect), false, outcome);
  }
});

test("a picked file goes through the wallet first, then runInscribe with the row", async () => {
  const h = harness();
  h.tap();
  await h.pick(FILE);
  assert.deepEqual(h.log, ["picker", `add:${INSCRIBE_CONNECT_CLASS}`, "wallet", `remove:${INSCRIBE_CONNECT_CLASS}`, "run"]);
  assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0].file, FILE);
  assert.deepEqual(Object.keys(h.runs[0].options), ["returnTo"], "no hbarUsd: USD only");
  assert.equal(h.runs[0].options.returnTo, h.row);
  assert.equal(h.input.value, "", "the same file can be picked again");
  assert.equal(h.classes.has(INSCRIBE_CONNECT_CLASS), false);
});

test("a cancelled picker, wallet, or a failed wallet runs nothing", async () => {
  const none = harness();
  none.tap();
  for (const f of none.input.listeners.cancel || []) f();
  await none.pick(null);
  assert.deepEqual(none.log, ["picker"]);
  for (const outcome of ["cancel", "fail"]) {
    const h = harness({ wallet: outcome });
    h.tap();
    await h.pick(FILE);
    assert.deepEqual(h.runs, [], outcome);
    assert.equal(h.classes.has(INSCRIBE_CONNECT_CLASS), false, outcome);
    assert.equal(h.input.value, "");
  }
  const broken = harness({ walletThrows: true });
  broken.tap();
  await broken.pick(FILE);
  assert.deepEqual(broken.runs, []);
  assert.equal(broken.classes.has(INSCRIBE_CONNECT_CLASS), false);
  // Afterwards a tap opens the picker again.
  broken.tap();
  assert.equal(broken.input.clicks, 2);
});

test("no second picker while a file is on its way to its card, or while a card is open", async () => {
  const h = harness();
  let letGo;
  h.hold(new Promise((resolve) => { letGo = resolve; }));
  h.tap();
  const first = h.pick(FILE);
  h.tap();
  assert.equal(h.input.clicks, 1, "wallet step still running");
  await h.pick({ name: "second.png" });
  letGo();
  await first;
  assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0].file, FILE);
  // A card is up: a tap opens nothing.
  h.doc.card = true;
  h.tap();
  assert.equal(h.input.clicks, 1);
  h.doc.card = false;
  h.tap();
  assert.equal(h.input.clicks, 2);
});

test("ensureWallet is feedlayout.js's, exported unchanged, and the row is wired after it loads", () => {
  assert.match(layout, /\nexport function ensureWallet\(\) \{\n  if \(walletNow\(\)\) return Promise\.resolve\('ok'\);/);
  assert.match(fn(layout, "ensureWallet"), /connect\.skipOverlayClose = true;/);
  const button = read("../inscribebutton.js");
  assert.match(button, /import \{ ensureWallet \} from "\.\/feedlayout\.js";/);
  assert.match(button, /import \{ runInscribe \} from "\.\/hcs1inscribenotice\.js";/);
  assert.match(button, /row: document\.getElementById\("Inscribe_Hashinal"\)/);
  const main = read("../main.js");
  const feedAt = main.indexOf("import './feedlayout.js'");
  const rowAt = main.indexOf("import './inscribebutton.js'");
  assert.ok(feedAt > 0 && rowAt > feedAt, "imported after feedlayout.js, so the load order is unchanged");
  // The wallet sheet clears the map drawer only during this step.
  const css = read("../style.css");
  assert.match(css, /html\.inscribe-connect wcm-modal,\nhtml\.inscribe-connect w3m-modal,\nhtml\.inscribe-connect appkit-modal \{\n  position: relative;\n  z-index: 9100;\n  --wcm-z-index: 9100;\n\}/);
});
