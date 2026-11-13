// The one-time Swap warning. A small document stands in for the page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ensureSwapAck } from "../swapwarning.js";

const KEY = "swap-warning-v1";
const PARAS = [
  "Hedera Globe doesn't endorse, review or recommend any token, creator or trade.",
  "Swaps run on SaucerSwap through your own wallet. We never hold your funds.",
  "You're responsible for checking that what you do here is legal where you live.",
];

function memoryStore(seed) {
  const data = { ...(seed || {}) };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
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
  const store = opts.store || memoryStore();
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

test("the first Swap tap shows the warning and I understand opens the sheet", async () => {
  const env = install({ reduced: true });
  try {
    const opener = openerFor(env.doc);
    let sheets = 0;
    const first = ensureSwapAck(opener).then((ok) => {
      if (ok) sheets += 1;
      return ok;
    });
    const window = overlays(env.doc);
    assert.equal(window.length, 1);
    assert.equal(sheets, 0);
    assert.equal(env.store.getItem(KEY), null);
    const dialog = window[0];
    assert.equal(dialog.attrs.role, "dialog");
    assert.equal(dialog.attrs["aria-modal"], "true");
    assert.equal(dialog.attrs["aria-labelledby"], "swap-warning-title");
    assert.equal(byText(env.doc, "Before you swap").className, "onboard-title");
    assert.equal(byText(env.doc, "Before you swap").id, "swap-warning-title");
    const bodies = [];
    walk(dialog, (node) => {
      if (node.className === "onboard-body") bodies.push(node.textContent);
    });
    assert.deepEqual(bodies, PARAS);
    assert.equal(byText(env.doc, "Not now").className, "onboard-prev");
    assert.equal(byText(env.doc, "I understand").className, "onboard-next");
    assert.equal(env.doc.activeElement, byText(env.doc, "I understand"));

    click(env.doc, "I understand");
    assert.equal(await first, true);
    assert.equal(sheets, 1);
    assert.equal(overlays(env.doc).length, 0);
    assert.equal(opener.focused, 1);
    const saved = env.store.getItem(KEY);
    assert.match(saved, /^\d+$/);
    assert.ok(Math.abs(Date.now() - Number(saved)) < 5000);

    const again = await ensureSwapAck(opener);
    assert.equal(again, true);
    assert.equal(overlays(env.doc).length, 0);
    if (again) sheets += 1;
    assert.equal(sheets, 2);
  } finally {
    env.restore();
  }
});

test("Not now, Escape, and the scrim open nothing and save nothing", async () => {
  for (const how of ["button", "escape", "scrim"]) {
    const env = install({ reduced: true });
    try {
      const opener = openerFor(env.doc);
      let sheets = 0;
      const pending = ensureSwapAck(opener).then((ok) => {
        if (ok) sheets += 1;
        return ok;
      });
      assert.equal(overlays(env.doc).length, 1);
      assert.equal(sheets, 0);
      if (how === "button") click(env.doc, "Not now");
      else if (how === "escape") {
        const event = env.doc.dispatchKey("Escape");
        assert.equal(event.defaulted, true);
      } else {
        let scrim = null;
        walk(env.doc.body, (node) => {
          if (node.className === "onboard-scrim") scrim = node;
        });
        for (const fn of scrim.listeners.click) fn({ stopPropagation() {}, preventDefault() {} });
      }
      assert.equal(await pending, false);
      assert.equal(sheets, 0);
      assert.equal(env.store.getItem(KEY), null);
      assert.equal(overlays(env.doc).length, 0);
      assert.equal(opener.focused, 1);
    } finally {
      env.restore();
    }
  }
});

test("a second tap while the warning is open reuses the pending promise", async () => {
  const env = install({ reduced: true });
  try {
    const opener = openerFor(env.doc);
    const first = ensureSwapAck(opener);
    const second = ensureSwapAck(openerFor(env.doc));
    assert.equal(first, second);
    assert.equal(overlays(env.doc).length, 1);
    click(env.doc, "Not now");
    assert.equal(await first, false);
    assert.equal(await second, false);
    assert.equal(env.store.getItem(KEY), null);
  } finally {
    env.restore();
  }
});

test("a blocked localStorage shows the warning on every tap", async () => {
  const env = install({
    reduced: true,
    store: {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    },
  });
  try {
    const opener = openerFor(env.doc);
    const first = ensureSwapAck(opener);
    assert.equal(overlays(env.doc).length, 1);
    click(env.doc, "I understand");
    assert.equal(await first, true);
    const second = ensureSwapAck(opener);
    assert.equal(overlays(env.doc).length, 1);
    click(env.doc, "Not now");
    assert.equal(await second, false);
  } finally {
    env.restore();
  }
});

test("Tab stays inside the warning and focus returns to the button", async () => {
  const env = install({ reduced: true });
  try {
    const opener = openerFor(env.doc);
    const pending = ensureSwapAck(opener);
    const accept = byText(env.doc, "I understand");
    const notNow = byText(env.doc, "Not now");
    assert.equal(env.doc.activeElement, accept);
    const tab = env.doc.dispatchKey("Tab");
    assert.equal(tab.defaulted, true);
    assert.equal(env.doc.activeElement, notNow);
    const shift = env.doc.dispatchKey("Tab", { shiftKey: true });
    assert.equal(shift.defaulted, true);
    assert.equal(env.doc.activeElement, accept);
    click(env.doc, "Not now");
    assert.equal(await pending, false);
    assert.equal(opener.focused, 1);
  } finally {
    env.restore();
  }
});

test("the warning uses the intro animation unless motion is reduced", async () => {
  const env = install({ reduced: false });
  try {
    const opener = openerFor(env.doc);
    const pending = ensureSwapAck(opener);
    assert.ok(env.doc.animated >= 2);
    click(env.doc, "Not now");
    const dialog = overlays(env.doc)[0];
    assert.equal(dialog.style.transition, "opacity 0.25s ease-out");
    assert.equal(dialog.style.opacity, "0");
    assert.equal(dialog.style.pointerEvents, "none");
    let card = null;
    walk(dialog, (node) => {
      if (node.className === "onboard-card") card = node;
    });
    assert.equal(card.style.animation, "none");
    assert.equal(await pending, false);
    assert.equal(overlays(env.doc).length, 0);
    assert.equal(env.store.getItem(KEY), null);
  } finally {
    env.restore();
  }
});

test("Swap and Buy wait for the warning, and the intro classes are reused", () => {
  const src = fs.readFileSync(new URL("../swapwarning.js", import.meta.url), "utf8");
  const menu = fs.readFileSync(new URL("../postmenu.js", import.meta.url), "utf8");
  const clan = fs.readFileSync(new URL("../clantag.js", import.meta.url), "utf8");
  assert.equal(src.includes("px"), false);
  assert.equal(src.includes("onboarding.js"), true);
  assert.equal(src.includes("from \"./swapsheet.js\""), false);
  assert.equal(src.includes("from './swapsheet.js'"), false);
  assert.match(src, /ACK_KEY = "swap-warning-v1"/);
  assert.equal(src.includes("open-source code"), false);
  assert.match(src, /doesn't endorse, review or recommend any token, creator or trade\./);
  assert.match(src, /Swaps run on SaucerSwap through your own wallet\. We never hold your funds\./);
  assert.match(src, /className = "onboard-overlay"/);
  assert.match(src, /className = "onboard-scrim"/);
  assert.match(src, /className = "onboard-card"/);
  assert.match(src, /className = "onboard-title"/);
  assert.match(src, /className = "onboard-body"/);
  assert.match(src, /className = "onboard-nav"/);
  assert.match(src, /className = "onboard-next"/);
  assert.match(src, /className = "onboard-prev"/);
  assert.match(src, /translate\(-50%, -50%\) scale\(0\.9\)/);
  assert.match(src, /duration: 250, easing: "ease-out"/);
  assert.match(src, /duration: 300, easing: "cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)"/);
  assert.match(src, /opacity 0\.25s ease-out/);
  assert.match(src, /setTimeout\(remove, 300\)/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /if \(pending\) return pending/);

  const open = menu.slice(menu.indexOf("async function openSwapItem"), menu.indexOf("pick(swapItem"));
  const ackAt = open.indexOf("await ensureSwapAck(swapItem)");
  const sheetAt = open.indexOf("openSwapSheet(");
  assert.ok(ackAt > 0 && sheetAt > ackAt);
  assert.match(open, /if \(!\(await ensureSwapAck\(swapItem\)\)\) return/);
  assert.equal(open.split("openSwapSheet(").length - 1, 1);

  const build = clan.slice(clan.indexOf("function buildCard"), clan.indexOf("function openCard"));
  const buyAck = build.indexOf("await ensureSwapAck(buy)");
  const buySheet = build.indexOf("openSheet(details)");
  assert.ok(buyAck > 0 && buySheet > buyAck);
  assert.match(build, /if \(await ensureSwapAck\(buy\)\) await openSheet\(details\)/);
});
