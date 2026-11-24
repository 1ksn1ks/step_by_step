// The cards before a Hashinal inscription. A small document stands in for
// the page, the same one as swap-warning.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// toast.js sets window.toast when it loads.
globalThis.window = globalThis.window || {};
const {
  confirmInscribe,
  inscribeCostText,
  inscribeTxText,
  runInscribe,
  showInscribeOverCap,
} = await import("../hcs1inscribenotice.js");

const GITHUB = "https://github.com/1ksn1ks/step_by_step/blob/main/hcs1inscribe.js";
const FEES = "You pay only Hedera network fees. Web3Globe charges nothing.";
const TIP = "Turn on auto-approval in HashPack first, or you'll confirm every transaction.";

function memoryStore() {
  const data = {};
  return {
    writes: 0,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      this.writes += 1;
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

function createDocument() {
  let active = null;
  const listeners = [];
  const doc = {
    animated: 0,
    lookups: [],
    getElementById(id) {
      doc.lookups.push(id);
      return null;
    },
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        className: "",
        id: "",
        type: "",
        textContent: "",
        disabled: false,
        isConnected: false,
        style: {},
        children: [],
        parentNode: null,
        attrs: {},
        listeners: {},
      };
      el.setAttribute = (name, value) => {
        el.attrs[name] = String(value);
      };
      el.getAttribute = (name) => (Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null);
      el.addEventListener = (type, fn) => {
        (el.listeners[type] = el.listeners[type] || []).push(fn);
      };
      el.appendChild = (child) => {
        child.parentNode = el;
        el.children.push(child);
        const mark = (node, on) => {
          node.isConnected = on;
          for (const kid of node.children) mark(kid, on);
        };
        if (el.isConnected) mark(child, true);
        return child;
      };
      el.append = (...kids) => {
        for (const kid of kids) el.appendChild(kid);
      };
      el.remove = () => {
        const parent = el.parentNode;
        if (!parent) return;
        const at = parent.children.indexOf(el);
        if (at >= 0) parent.children.splice(at, 1);
        el.parentNode = null;
        const mark = (node) => {
          node.isConnected = false;
          for (const kid of node.children) mark(kid);
        };
        mark(el);
      };
      el.focus = () => {
        active = el;
      };
      el.animate = () => {
        doc.animated += 1;
      };
      return el;
    },
    addEventListener(type, fn) {
      listeners.push({ type, fn });
    },
    removeEventListener(type, fn) {
      const at = listeners.findIndex((item) => item.type === type && item.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    keyListeners() {
      return listeners.filter((item) => item.type === "keydown").length;
    },
    dispatchKey(key, extra) {
      const event = {
        key,
        shiftKey: !!(extra && extra.shiftKey),
        defaulted: false,
        preventDefault() { event.defaulted = true; },
        stopPropagation() {},
      };
      for (const item of [...listeners]) {
        if (item.type === "keydown") item.fn(event);
      }
      return event;
    },
  };
  Object.defineProperty(doc, "activeElement", {
    get() { return active; },
    set(value) { active = value; },
  });
  const body = doc.createElement("body");
  body.isConnected = true;
  doc.body = body;
  return doc;
}

function install(options) {
  const opts = options || {};
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
  };
  const doc = createDocument();
  const store = memoryStore();
  globalThis.document = doc;
  globalThis.window = {
    matchMedia(query) {
      return { matches: !!(opts.reduced !== false && String(query).includes("reduce")) };
    },
  };
  globalThis.localStorage = store;
  return {
    doc,
    store,
    restore() {
      globalThis.document = prev.document;
      globalThis.window = prev.window;
      globalThis.localStorage = prev.localStorage;
    },
  };
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function overlays(doc) {
  const found = [];
  walk(doc.body, (node) => {
    if (node.className === "onboard-overlay") found.push(node);
  });
  return found;
}

function byClass(root, className) {
  const found = [];
  walk(root, (node) => {
    if (String(node.className).split(" ").includes(className)) found.push(node);
  });
  return found;
}

function byText(doc, text) {
  let hit = null;
  walk(doc.body, (node) => {
    if (node.textContent === text) hit = node;
  });
  return hit;
}

function click(doc, text) {
  const node = byText(doc, text);
  assert.ok(node, text);
  for (const fn of node.listeners.click || []) fn({ stopPropagation() {}, preventDefault() {} });
  return node;
}

function rowsOf(root) {
  return byClass(root, "onboard-row").map((row) => [row.children[0].textContent, row.children[1].textContent]);
}

function openerFor(doc) {
  return {
    isConnected: true,
    disabled: false,
    focused: 0,
    focus() {
      this.focused += 1;
      doc.activeElement = this;
    },
  };
}

const INFO = {
  name: "sunset.webp",
  mime: "image/webp",
  bytes: new Uint8Array(1536 * 1024),
  txCount: 13,
  usd: 0.0196,
};

test("the card shows on every call and saves nothing", async () => {
  const env = install({ reduced: true });
  try {
    const opener = openerFor(env.doc);
    const first = confirmInscribe({ ...INFO, returnTo: opener });
    assert.equal(overlays(env.doc).length, 1);
    const dialog = overlays(env.doc)[0];
    assert.equal(dialog.attrs.role, "dialog");
    assert.equal(dialog.attrs["aria-modal"], "true");
    assert.equal(dialog.attrs["aria-labelledby"], "inscribe-notice-title");
    assert.equal(byText(env.doc, "Before you inscribe").className, "onboard-title");
    assert.equal(byText(env.doc, "Before you inscribe").id, "inscribe-notice-title");
    assert.equal(byClass(dialog, "onboard-scrim").length, 1);
    assert.equal(byClass(dialog, "onboard-card").length, 1);
    assert.equal(byClass(dialog, "onboard-nav").length, 1);
    assert.deepEqual(rowsOf(dialog), [
      ["File", "sunset.webp, 1.5 MB"],
      ["Type", "image/webp"],
      ["Transactions", "1 topic + 12 chunks = 13 transactions; each is its own transaction your wallet pays"],
      ["Estimated cost", "≈ $0.0196"],
    ]);
    const bodies = byClass(dialog, "onboard-body").map((node) => node.textContent);
    assert.deepEqual(bodies, [FEES, TIP]);
    assert.equal(byText(env.doc, "Not now").className, "onboard-prev");
    assert.equal(byText(env.doc, "Inscribe").className, "onboard-next");
    assert.equal(env.doc.activeElement, byText(env.doc, "Inscribe"));

    click(env.doc, "Inscribe");
    assert.equal(await first, true);
    assert.equal(overlays(env.doc).length, 0);
    assert.equal(opener.focused, 1);

    // A second file, a second card: no acknowledgement is kept.
    const second = confirmInscribe({ ...INFO, name: "next.webp" });
    assert.equal(overlays(env.doc).length, 1);
    assert.equal(rowsOf(overlays(env.doc)[0])[0][1], "next.webp, 1.5 MB");
    click(env.doc, "Inscribe");
    assert.equal(await second, true);
    const third = confirmInscribe(INFO);
    assert.equal(overlays(env.doc).length, 1);
    click(env.doc, "Not now");
    assert.equal(await third, false);
    assert.equal(env.store.writes, 0);
  } finally {
    env.restore();
  }
});

test("Not now, Escape and the scrim return false", async () => {
  for (const how of ["button", "escape", "scrim"]) {
    const env = install({ reduced: true });
    try {
      const opener = openerFor(env.doc);
      const pending = confirmInscribe({ ...INFO, returnTo: opener });
      assert.equal(overlays(env.doc).length, 1);
      if (how === "button") click(env.doc, "Not now");
      else if (how === "escape") {
        const event = env.doc.dispatchKey("Escape");
        assert.equal(event.defaulted, true);
      } else {
        const scrim = byClass(env.doc.body, "onboard-scrim")[0];
        for (const fn of scrim.listeners.click) fn({ stopPropagation() {}, preventDefault() {} });
      }
      assert.equal(await pending, false, how);
      assert.equal(overlays(env.doc).length, 0);
      assert.equal(opener.focused, 1);
      assert.equal(env.doc.keyListeners(), 0);
    } finally {
      env.restore();
    }
  }
});

test("Inscribe returns true", async () => {
  const env = install({ reduced: true });
  try {
    const pending = confirmInscribe(INFO);
    click(env.doc, "Inscribe");
    assert.equal(await pending, true);
    assert.equal(overlays(env.doc).length, 0);
  } finally {
    env.restore();
  }
});

test("a second call while a card is up is false and leaves that card", async () => {
  const env = install({ reduced: true });
  try {
    const first = confirmInscribe(INFO);
    assert.equal(await confirmInscribe({ ...INFO, name: "other.png" }), false);
    assert.equal(await showInscribeOverCap(INFO), false);
    assert.equal(overlays(env.doc).length, 1);
    assert.equal(rowsOf(overlays(env.doc)[0])[0][1], "sunset.webp, 1.5 MB");
    click(env.doc, "Inscribe");
    assert.equal(await first, true);
  } finally {
    env.restore();
  }
});

test("a downscaled picture says so, and a price per HBAR adds HBAR", async () => {
  const env = install({ reduced: true });
  try {
    const pending = confirmInscribe({ ...INFO, resized: true, usd: 0.0108, txCount: 2, hbarUsd: 0.09 });
    const rows = rowsOf(overlays(env.doc)[0]);
    assert.equal(rows[0][1], "sunset.webp, 1.5 MB, resized to 2048 px");
    assert.equal(rows[2][1], "1 topic + 1 chunk = 2 transactions; each is its own transaction your wallet pays");
    assert.equal(rows[3][1], "≈ 0.12 HBAR ($0.0108)");
    click(env.doc, "Not now");
    assert.equal(await pending, false);
  } finally {
    env.restore();
  }
  assert.equal(inscribeCostText(0.018), "≈ $0.018");
  assert.equal(inscribeCostText(1.77), "≈ $1.77");
  assert.equal(inscribeCostText(0.0108, 0), "≈ $0.0108");
  assert.equal(inscribeCostText(0.0108, NaN), "≈ $0.0108");
  assert.equal(inscribeCostText(undefined), "Unknown");
  assert.equal(inscribeTxText(1801), "1 topic + 1800 chunks = 1801 transactions; each is its own transaction your wallet pays");
});

test("the over-cap card shows the size against 2 MB and the GitHub link", async () => {
  const env = install({ reduced: true });
  try {
    const opener = openerFor(env.doc);
    const pending = showInscribeOverCap({
      name: "clip.mp4",
      mime: "video/mp4",
      bytes: new Uint8Array(2 * 1024 * 1024 + 1),
      overCap: true,
      returnTo: opener,
    });
    const dialog = overlays(env.doc)[0];
    assert.ok(dialog);
    assert.equal(dialog.attrs.role, "dialog");
    assert.equal(dialog.attrs["aria-modal"], "true");
    assert.equal(dialog.attrs["aria-labelledby"], "inscribe-overcap-title");
    assert.equal(byText(env.doc, "File too big").className, "onboard-title");
    // Just over the cap reads above it, never "2 MB".
    assert.deepEqual(rowsOf(dialog), [["File", "clip.mp4, 2.1 MB"], ["Limit", "2 MB"]]);
    const link = byText(env.doc, "Inscribe the full file yourself");
    assert.equal(link.tagName, "A");
    assert.equal(link.href, GITHUB);
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener");
    assert.equal(link.parentNode.className, "onboard-body");
    const buttons = [];
    walk(dialog, (node) => {
      if (node.tagName === "BUTTON") buttons.push(node.textContent);
    });
    assert.deepEqual(buttons, ["Not now"]);
    assert.equal(byText(env.doc, "Not now").className, "onboard-prev");
    assert.equal(env.doc.activeElement, byText(env.doc, "Not now"));

    // Tab goes between the link and Not now only.
    const tab = env.doc.dispatchKey("Tab");
    assert.equal(tab.defaulted, true);
    assert.equal(env.doc.activeElement, link);
    const shift = env.doc.dispatchKey("Tab", { shiftKey: true });
    assert.equal(shift.defaulted, true);
    assert.equal(env.doc.activeElement, byText(env.doc, "Not now"));

    click(env.doc, "Not now");
    assert.equal(await pending, false);
    assert.equal(overlays(env.doc).length, 0);
    assert.equal(opener.focused, 1);
  } finally {
    env.restore();
  }
});

test("Tab stays inside the confirm card", async () => {
  const env = install({ reduced: true });
  try {
    const pending = confirmInscribe(INFO);
    const accept = byText(env.doc, "Inscribe");
    const notNow = byText(env.doc, "Not now");
    assert.equal(env.doc.activeElement, accept);
    assert.equal(env.doc.dispatchKey("Tab").defaulted, true);
    assert.equal(env.doc.activeElement, notNow);
    assert.equal(env.doc.dispatchKey("Tab", { shiftKey: true }).defaulted, true);
    assert.equal(env.doc.activeElement, accept);
    click(env.doc, "Not now");
    assert.equal(await pending, false);
  } finally {
    env.restore();
  }
});

test("reduced motion opens and closes at once", async () => {
  for (const open of [() => confirmInscribe(INFO), () => showInscribeOverCap({ ...INFO, overCap: true })]) {
    const env = install({ reduced: true });
    try {
      const pending = open();
      assert.equal(env.doc.animated, 0);
      const dialog = overlays(env.doc)[0];
      click(env.doc, "Not now");
      // Gone in the same tick: no fade, no 300 ms wait.
      assert.equal(overlays(env.doc).length, 0);
      assert.equal(dialog.style.transition, undefined);
      assert.equal(dialog.style.opacity, undefined);
      assert.equal(await pending, false);
    } finally {
      env.restore();
    }
  }
});

test("without reduced motion the card uses the intro animation", async () => {
  const env = install({ reduced: false });
  try {
    const pending = confirmInscribe(INFO);
    assert.ok(env.doc.animated >= 2);
    click(env.doc, "Inscribe");
    const dialog = overlays(env.doc)[0];
    assert.ok(dialog, "still up while it fades");
    assert.equal(dialog.style.transition, "opacity 0.25s ease-out");
    assert.equal(dialog.style.opacity, "0");
    assert.equal(dialog.style.pointerEvents, "none");
    assert.equal(byClass(dialog, "onboard-card")[0].style.animation, "none");
    assert.equal(await pending, true);
    assert.equal(overlays(env.doc).length, 0);
  } finally {
    env.restore();
  }
});

test("runInscribe stops at the over-cap card, and Not now sends nothing", async () => {
  const env = install({ reduced: true });
  try {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.bin", { type: "application/octet-stream" });
    const run = runInscribe(big);
    assert.equal(runInscribe(big), run);
    while (!overlays(env.doc).length) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(byText(env.doc, "File too big"));
    assert.equal(byText(env.doc, "Inscribe the full file yourself").href, GITHUB);
    click(env.doc, "Not now");
    assert.equal(await run, null);
    assert.equal(env.doc.lookups.includes("toast-container"), false);

    const small = new File([new TextEncoder().encode("hello hashinal")], "note.txt", { type: "text/plain" });
    const declined = runInscribe(small);
    while (!overlays(env.doc).length) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(byText(env.doc, "Before you inscribe"));
    const rows = rowsOf(overlays(env.doc)[0]);
    assert.deepEqual(rows[0], ["File", "note.txt, 14 bytes"]);
    assert.deepEqual(rows[1], ["Type", "text/plain"]);
    assert.match(rows[2][1], /^1 topic \+ 1 chunk = 2 transactions; /);
    assert.deepEqual(rows[3], ["Estimated cost", "≈ $0.0108"]);
    click(env.doc, "Not now");
    // No toast means the wallet step was never reached: it starts with one.
    assert.equal(await declined, null);
    assert.equal(env.doc.lookups.includes("toast-container"), false);
  } finally {
    env.restore();
  }
});

test("the cards reuse the intro classes and the flow calls the wallet module", () => {
  const src = fs.readFileSync(new URL("../hcs1inscribenotice.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.equal(/\dpx/.test(src), false);
  assert.equal(src.includes("localStorage"), false);
  assert.equal(src.includes("onboarding.js"), true);
  assert.match(src, /className = "onboard-overlay"/);
  assert.match(src, /className = "onboard-scrim"/);
  assert.match(src, /className = "onboard-card inscribe-notice"/);
  assert.match(src, /className = "onboard-title"/);
  assert.match(src, /className = "onboard-body"/);
  assert.match(src, /className = "onboard-nav"/);
  assert.match(src, /"onboard-next", "Inscribe"/);
  assert.match(src, /"onboard-prev", "Not now"/);
  assert.match(src, /translate\(-50%, -50%\) scale\(0\.9\)/);
  assert.match(src, /duration: 250, easing: "ease-out"/);
  assert.match(src, /duration: 300, easing: "cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)"/);
  assert.match(src, /opacity 0\.25s ease-out/);
  assert.match(src, /setTimeout\(remove, 300\)/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /import \{ inscribePrepared, prepareInscribeFile \} from "\.\/hcs1inscribewallet\.js"/);
  assert.match(src, /link\.rel = "noopener"/);

  // prepare, then the over-cap card or the confirm card, then the wallet.
  const flow = src.slice(src.indexOf("async function runFlow"), src.indexOf("export function runInscribe"));
  const prepareAt = flow.indexOf("await prepareInscribeFile(file)");
  const capAt = flow.indexOf("if (prepared.overCap)");
  const overAt = flow.indexOf("await showInscribeOverCap(info)");
  const confirmAt = flow.indexOf("if (!(await confirmInscribe(info))) return null");
  const startAt = flow.indexOf("inscribeWith(prepared");
  assert.ok(prepareAt > 0 && capAt > prepareAt && overAt > capAt && confirmAt > overAt && startAt > confirmAt);
  assert.deepEqual(flow.match(/prepareInscribeFile/g), ["prepareInscribeFile"]);
  assert.equal(flow.indexOf("startInscribe"), -1);

  const run = src.slice(src.indexOf("async function inscribeWith"), src.indexOf("async function runFlow"));
  assert.match(run, /toast\.hold\(`Inscribing \$\{sent \+ 1\} of \$\{chunks\}`\)/);
  assert.match(run, /await inscribePrepared\(prepared, \{/);
  assert.equal(run.indexOf("prepareInscribeFile"), -1);
  assert.equal(run.indexOf("startInscribe"), -1);
  assert.match(run, /Stopped at \$\{sentCount\(next\)\} of \$\{chunks\}\. Tap to resume/);
  assert.match(run, /stay: true/);
  assert.match(run, /inscribeWith\(prepared, chunks, next\)/);
  assert.match(run, /toast\.success\("Inscribed", \{ action: hcsLink\(result\)/);
  assert.match(src, /link\.textContent = result\.hrl/);
  assert.match(src, /link\.href = hashinalUrl\(result\.topicId\)/);

  const start = css.indexOf("/* The inscribe cards");
  const last = css.indexOf(".inscribe-notice a:focus-visible", start);
  assert.ok(start > 0 && last > start);
  const block = css.slice(start, css.indexOf("}", last) + 1);
  assert.match(block, /\.inscribe-notice \.onboard-row-note \{\s*overflow-wrap: anywhere;/);
  assert.equal(/\dpx/.test(block), false);
});
