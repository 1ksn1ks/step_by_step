// Sealed stills wait until the bubble is near the encrypted list.
// Two decrypts run at once. The play glass stays busy until the video
// decrypts, and a failure puts that glass back with Can't decrypt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function element(tag) {
  const node = {
    tag,
    nodeType: 1,
    className: "",
    attrs: {},
    children: [],
    parentNode: null,
    isConnected: false,
    hidden: false,
    disabled: false,
    innerHTML: "",
    textContent: "",
    type: "",
    alt: "",
    src: "",
    playsInline: false,
    controls: false,
    listeners: {},
  };
  node.classList = {
    add(name) {
      const set = new Set(node.className.split(/\s+/).filter(Boolean));
      set.add(name);
      node.className = [...set].join(" ");
    },
    remove(name) {
      node.className = node.className.split(/\s+/).filter((token) => token && token !== name).join(" ");
    },
    contains(name) {
      return node.className.split(/\s+/).includes(name);
    },
  };
  node.setAttribute = (name, value) => { node.attrs[name] = String(value); };
  node.getAttribute = (name) => (Object.prototype.hasOwnProperty.call(node.attrs, name) ? node.attrs[name] : null);
  node.removeAttribute = (name) => { delete node.attrs[name]; };
  node.addEventListener = (type, fn) => {
    (node.listeners[type] = node.listeners[type] || []).push(fn);
  };
  node.appendChild = (child) => {
    child.parentNode = node;
    child.isConnected = node.isConnected;
    node.children.push(child);
    return child;
  };
  node.insertAdjacentElement = (where, child) => {
    if (where !== "afterend" || !node.parentNode) return null;
    const kids = node.parentNode.children;
    const at = kids.indexOf(node);
    child.parentNode = node.parentNode;
    child.isConnected = node.parentNode.isConnected;
    kids.splice(at + 1, 0, child);
    return child;
  };
  node.remove = () => {
    const parent = node.parentNode;
    if (!parent) return;
    const at = parent.children.indexOf(node);
    if (at >= 0) parent.children.splice(at, 1);
    node.parentNode = null;
    node.isConnected = false;
  };
  node.replaceWith = (child) => {
    const parent = node.parentNode;
    if (!parent) return;
    const at = parent.children.indexOf(node);
    child.parentNode = parent;
    child.isConnected = parent.isConnected;
    parent.children.splice(at, 1, child);
    node.parentNode = null;
    node.isConnected = false;
  };
  Object.defineProperty(node, "nextElementSibling", {
    get() {
      if (!node.parentNode) return null;
      const kids = node.parentNode.children;
      return kids[kids.indexOf(node) + 1] || null;
    },
  });
  node.querySelectorAll = () => {
    const out = [];
    const walk = (current) => {
      for (const child of current.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(node);
    return out;
  };
  node.play = () => Promise.resolve();
  node.click = () => {
    const event = { preventDefault() {}, stopPropagation() {} };
    for (const fn of node.listeners.click || []) fn(event);
  };
  return node;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("sealed stills wait for the list, and the play glass reports decrypt", async () => {
  const previous = {
    document: globalThis.document,
    IntersectionObserver: globalThis.IntersectionObserver,
    MutationObserver: globalThis.MutationObserver,
    Worker: globalThis.Worker,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const watches = [];
  const mutations = [];
  const list = element("div");
  list.isConnected = true;
  class IO {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = [];
      this.unobserved = [];
      watches.push(this);
    }
    observe(target) { this.observed.push(target); }
    unobserve(target) { this.unobserved.push(target); }
    disconnect() {}
    enter(target) { this.callback([{ target, isIntersecting: true }]); }
  }
  class MO {
    constructor(callback) {
      this.callback = callback;
      mutations.push(this);
    }
    observe() {}
    disconnect() {}
  }
  class FakeWorker {
    constructor() {
      this.sent = [];
      FakeWorker.latest = this;
    }
    postMessage(data) { this.sent.push(data); }
  }
  globalThis.document = {
    getElementById(id) {
      return id === "messages-from-encrypted-chat" ? list : null;
    },
    createElement(tag) { return element(tag); },
  };
  globalThis.IntersectionObserver = IO;
  globalThis.MutationObserver = MO;
  globalThis.Worker = FakeWorker;
  URL.createObjectURL = () => "blob:sealed";
  URL.revokeObjectURL = () => {};
  try {
    const { mountSealedMedia } = await import("../e2eechatview.js");
    const source = readFileSync(new URL("../e2eechatview.js", import.meta.url), "utf8");
    assert.match(source, /rootMargin: "50dvh"/);
    assert.match(source, /const DECRYPT_LIMIT = 2/);
    const still = (name) => ({
      fileKey: `key-${name}`,
      header: `header-${name}`,
      url: `https://cdn.example/${name}.bin`,
      mime: "image/jpeg",
    });
    const hosts = [];
    const mountStill = (name) => {
      const host = element("div");
      list.appendChild(host);
      hosts.push(host);
      mountSealedMedia(host, still(name));
      return host;
    };
    mountStill("far");
    assert.equal(watches.length, 1);
    assert.equal(watches[0].options.root, list);
    assert.equal(watches[0].options.rootMargin, "50dvh");
    assert.equal(watches[0].options.threshold, 0);
    assert.equal(FakeWorker.latest, undefined);
    const near = [mountStill("a"), mountStill("b"), mountStill("c")];
    assert.equal(FakeWorker.latest, undefined);
    const boxes = () => watches[0].observed;
    watches[0].enter(boxes()[1]);
    watches[0].enter(boxes()[2]);
    watches[0].enter(boxes()[3]);
    const worker = FakeWorker.latest;
    assert.equal(worker.sent.length, 2);
    assert.equal(watches[0].unobserved.length, 3);
    worker.onmessage({ data: { id: worker.sent[0].id, ok: true, blob: new Blob(["a"]) } });
    await flush();
    assert.equal(worker.sent.length, 3);
    assert.equal(near[0].children.find((child) => child.className === "chat-sealed").children[0].src, "blob:sealed");
    worker.onmessage({ data: { id: worker.sent[1].id, ok: true, blob: new Blob(["b"]) } });
    worker.onmessage({ data: { id: worker.sent[2].id, ok: true, blob: new Blob(["c"]) } });
    await flush();
    const gone = mountStill("gone");
    const parked = worker.sent.length;
    mutations[0].callback([{ removedNodes: [gone] }]);
    watches[0].enter(watches[0].observed.at(-1));
    assert.equal(worker.sent.length, parked);

    const videoHost = element("div");
    list.appendChild(videoHost);
    mountSealedMedia(videoHost, {
      fileKey: "video-key",
      header: "video-header",
      url: "https://cdn.example/clip.bin",
      mime: "video/mp4",
    });
    const box = videoHost.children.find((child) => child.className === "chat-sealed");
    const button = box.children.find((child) => child.tag === "button");
    assert.match(button.innerHTML, /class="video-play-glass"/);
    assert.equal(button.getAttribute("aria-busy"), null);
    const before = worker.sent.length;
    button.click();
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.classList.contains("is-busy"), true);
    assert.equal(button.disabled, true);
    assert.match(button.innerHTML, /class="video-play-glass"/);
    assert.equal(worker.sent.length, before + 1);
    worker.onmessage({ data: { id: worker.sent.at(-1).id, ok: false } });
    await flush();
    assert.equal(button.getAttribute("aria-busy"), null);
    assert.equal(button.classList.contains("is-busy"), false);
    assert.equal(button.disabled, false);
    assert.equal(button.hidden, false);
    assert.equal(button.getAttribute("aria-label"), "Play");
    assert.match(button.innerHTML, /class="video-play-glass"/);
    const fail = box.nextElementSibling;
    assert.equal(fail.className, "chat-sealed-fail");
    assert.equal(fail.textContent, "Can't decrypt");

    button.click();
    assert.equal(box.nextElementSibling, null);
    assert.equal(button.getAttribute("aria-busy"), "true");
    worker.onmessage({ data: { id: worker.sent.at(-1).id, ok: true, blob: new Blob(["v"]) } });
    await flush();
    assert.equal(button.hidden, true);
    assert.equal(button.getAttribute("aria-busy"), null);
    assert.equal(box.children.some((child) => child.tag === "video" && child.src === "blob:sealed"), true);
  } finally {
    if (previous.document === undefined) delete globalThis.document;
    else globalThis.document = previous.document;
    if (previous.IntersectionObserver === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = previous.IntersectionObserver;
    if (previous.MutationObserver === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = previous.MutationObserver;
    if (previous.Worker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previous.Worker;
    URL.createObjectURL = previous.createObjectURL;
    URL.revokeObjectURL = previous.revokeObjectURL;
  }
});
