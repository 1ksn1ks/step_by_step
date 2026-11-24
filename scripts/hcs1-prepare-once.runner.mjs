// A run and its Resume prepare the picture once and send those same bytes.
// The wallet and the picture compressor are stood in for. No network.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const compressed = [];
mock.module("../imagecompress.js", {
  exports: {
    compressPostImage: async (file) => {
      const bytes = new Uint8Array([compressed.length + 1, 4, 5, 6, 7, 8]);
      compressed.push(bytes);
      const name = String((file && file.name) || "pic").replace(/\.[a-z0-9]+$/i, "");
      return new File([bytes], `${name}.webp`, { type: "image/webp" });
    },
  },
});

const submitted = [];
let failFirst = true;

class TopicCreateTransaction {
  setTopicMemo() { return this; }
  setSubmitKey() { return this; }
  async freezeWithSigner() { return this; }
  async sign() {}
  async executeWithSigner() { return this; }
  async getReceiptWithSigner() {
    return { topicId: { toString: () => "0.0.77" } };
  }
}

class TopicMessageSubmitTransaction {
  setTopicId() { return this; }
  setMessage(message) {
    this.message = message;
    return this;
  }
  getRequiredChunks() { return 1; }
  async freezeWithSigner() { return this; }
  async sign() {}
  async executeWithSigner() {
    submitted.push(this.message);
    if (failFirst) {
      failFirst = false;
      throw new Error("stopped");
    }
    return this;
  }
  async getReceiptWithSigner() { return {}; }
}

let nextKey = 0;
mock.module("@hashgraph/sdk", {
  exports: {
    TopicCreateTransaction,
    TopicMessageSubmitTransaction,
    PrivateKey: {
      async generateED25519Async() {
        nextKey += 1;
        const id = nextKey;
        return { id, publicKey: { toString: () => `pub-${id}` } };
      },
    },
  },
});

mock.module("../web3.js", {
  exports: {
    signer: { account: "0.0.1001" },
  },
});

function element(doc, tag) {
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
    classList: { add() {}, remove() {} },
  };
  Object.defineProperty(el, "parentElement", { get() { return el.parentNode; } });
  el.setAttribute = (name, value) => { el.attrs[name] = String(value); };
  el.getAttribute = (name) => (Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null);
  el.addEventListener = (type, fn) => {
    (el.listeners[type] = el.listeners[type] || []).push(fn);
  };
  el.appendChild = (child) => {
    child.parentNode = el;
    el.children.push(child);
    if (el.isConnected) child.isConnected = true;
    return child;
  };
  el.append = (...kids) => { for (const kid of kids) el.appendChild(kid); };
  el.remove = () => {
    const parent = el.parentNode;
    if (!parent) return;
    const at = parent.children.indexOf(el);
    if (at >= 0) parent.children.splice(at, 1);
    el.parentNode = null;
  };
  el.focus = () => { doc.activeElement = el; };
  el.animate = () => {};
  return el;
}

function installDocument() {
  const listeners = [];
  const doc = {
    createElement(tag) { return element(doc, tag); },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    removeEventListener(type, fn) {
      const at = listeners.findIndex((item) => item.type === type && item.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    activeElement: null,
  };
  const body = element(doc, "body");
  body.isConnected = true;
  doc.body = body;
  doc.getElementById = (id) => {
    let found = null;
    const walk = (node) => {
      if (node.id === id) found = node;
      for (const child of node.children || []) walk(child);
    };
    walk(body);
    return found;
  };
  globalThis.document = doc;
  globalThis.window = {
    matchMedia() { return { matches: true }; },
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  return doc;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function byText(doc, text) {
  let hit = null;
  walk(doc.body, (node) => {
    if (node.textContent === text) hit = node;
  });
  return hit;
}

function click(node) {
  assert.ok(node);
  for (const fn of node.listeners.click || []) fn({ stopPropagation() {}, preventDefault() {} });
}

test("a run and its resume prepare the file once and send the same bytes", async () => {
  installDocument();
  const { buildHcs1Inscription } = await import("../hcs1inscribe.js");
  const { runInscribe } = await import("../hcs1inscribenotice.js");
  const file = new File([new Uint8Array([1, 2, 3, 4])], "pic.png", { type: "image/png" });
  const run = runInscribe(file);
  for (let i = 0; i < 20 && !byText(document, "Inscribe"); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  click(byText(document, "Inscribe"));
  assert.equal(await run, null);
  assert.equal(compressed.length, 1);

  const resume = byText(document, "Resume");
  click(resume.parentElement);
  for (let i = 0; i < 20 && submitted.length < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const built = await buildHcs1Inscription(compressed[0], "image/webp");
  const sha = crypto.createHash("sha256").update(compressed[0]).digest("hex");
  assert.equal(compressed.length, 1);
  assert.equal(built.messages.length, 1);
  assert.equal(built.sha256, sha);
  assert.deepEqual(submitted, [built.messages[0], built.messages[0]]);
});
