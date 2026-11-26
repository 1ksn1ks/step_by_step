// Full screen for every 18 KB box (fieldexpand.js, mounted by bytecap.js):
// the button shows once there is text; expanding keeps the same element,
// its text, caret and focus; the cap and the live counter keep working;
// a send, Back, Escape, the button or a closing page collapse it; one box
// at a time, chat composers included. A small DOM is faked below (the
// real bytecap.js and fieldexpand.js run on it).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- A small DOM ---------------------------------------------------------
class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.key = init.key;
    this.isComposing = false;
    this.defaultPrevented = false;
    this.stopped = false;
    this.stoppedNow = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; this.stoppedNow = true; }
}
globalThis.Event = FakeEvent;

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach((n) => this.set.add(n)); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name); else this.set.delete(name);
    return on;
  }
}

let doc = null;

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this.listeners = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.attrs = {};
    this.id = "";
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.isContentEditable = false;
    this.rect = { top: 0, left: 0, width: 0, height: 0 };
    this.offsetTop = 0;
    this.offsetLeft = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.clientTop = 0;
    this.clientLeft = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 0;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.disabled = false;
    this.computed = {};
    this.innerHTML = "";
    const props = {};
    const priorities = {};
    this.style = {
      props,
      priorities,
      setProperty(name, value, priority = "") {
        props[name] = String(value);
        priorities[name] = String(priority || "");
      },
      removeProperty(name) { delete props[name]; delete priorities[name]; },
      getPropertyValue(name) { return props[name] || ""; },
      getPropertyPriority(name) { return priorities[name] || ""; },
    };
  }
  get isConnected() {
    let el = this;
    while (el.parentElement) el = el.parentElement;
    return el === doc.documentElement;
  }
  get nextSibling() {
    const list = this.parentElement ? this.parentElement.children : [];
    return list[list.indexOf(this) + 1] || null;
  }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  appendChild(node) { this.insertBefore(node, null); return node; }
  insertBefore(node, ref) {
    if (node.parentElement) {
      // As in a browser: moving the focused field (or a box that holds it)
      // takes the focus away, and a textarea's caret with it.
      const focused = doc && doc.activeElement;
      if (focused && focused !== doc.body && node.contains(focused)) {
        doc.activeElement = doc.body;
        if (focused.tagName === "TEXTAREA") focused.selectionStart = focused.selectionEnd = focused.value.length;
      }
      node.remove();
    }
    node.parentElement = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(node); else this.children.splice(at, 0, node);
    return node;
  }
  after(node) { this.parentElement.insertBefore(node, this.nextSibling); }
  before(node) { this.parentElement.insertBefore(node, this); }
  remove() {
    if (!this.parentElement) return;
    const list = this.parentElement.children;
    list.splice(list.indexOf(this), 1);
    this.parentElement = null;
  }
  contains(node) {
    for (let el = node; el; el = el.parentElement) if (el === this) return true;
    return false;
  }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  set title(value) { this.attrs.title = value; }
  get title() { return this.attrs.title || ""; }
  addEventListener(type, fn, options) {
    const capture = options === true || !!(options && options.capture);
    this.listeners.push({ type, fn, capture });
  }
  removeEventListener(type, fn, options) {
    const capture = options === true || !!(options && options.capture);
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  dispatchEvent(event) {
    const path = [];
    for (let el = this.parentElement; el; el = el.parentElement) path.unshift(el);
    const run = (el, capture) => {
      for (const l of el.listeners.slice()) {
        if (l.type !== event.type || l.capture !== capture) continue;
        l.fn(event);
        if (event.stoppedNow) return;
      }
    };
    for (const el of path) {
      run(el, true);
      if (event.stopped) return !event.defaultPrevented;
    }
    run(this, true);
    if (!event.stoppedNow) run(this, false);
    if (event.bubbles && !event.stopped) {
      for (const el of path.slice().reverse()) {
        run(el, false);
        if (event.stopped) break;
      }
    }
    return !event.defaultPrevented;
  }
  getBoundingClientRect() {
    const r = this.rect;
    return { top: r.top, left: r.left, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height };
  }
  getClientRects() {
    for (let el = this; el; el = el.parentElement) if (el.hidden) return [];
    return this.isConnected ? [this.getBoundingClientRect()] : [];
  }
  matches() { return false; }
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}

function makeDocument() {
  const root = new FakeElement("html");
  const body = new FakeElement("body");
  root.appendChild(body);
  const listeners = [];
  return {
    documentElement: root,
    body,
    activeElement: body,
    listeners,
    createElement: (tag) => new FakeElement(tag),
    getElementById(id) {
      const walk = (el) => {
        if (el.id === id) return el;
        for (const child of el.children) {
          const hit = walk(child);
          if (hit) return hit;
        }
        return null;
      };
      return walk(root);
    },
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn) {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
}

doc = makeDocument();
globalThis.document = doc;
const frames = [];
const resizeObservers = [];
const mutationObservers = [];
const layers = { defined: new Map(), open: [], log: [] };
globalThis.window = {
  innerWidth: 390,
  innerHeight: 844,
  visualViewport: null,
  addEventListener() {},
  removeEventListener() {},
  getSelection: () => null,
  defineLayer(name, handlers) { layers.defined.set(name, handlers); },
  layerOpened(name) { layers.open.push(name); layers.log.push(["opened", name]); },
  layerClosedByUI(name) {
    const at = layers.open.lastIndexOf(name);
    if (at >= 0) layers.open.splice(at, 1);
    layers.log.push(["closed", name]);
  },
  layerIsOpen: (name) => layers.open.includes(name),
};
globalThis.getComputedStyle = (el, pseudo) => ({
  position: "static",
  transform: "none",
  translate: "none",
  scale: "none",
  rotate: "none",
  perspective: "none",
  filter: "none",
  backdropFilter: "none",
  contain: "none",
  containerType: "normal",
  willChange: "auto",
  contentVisibility: "visible",
  overflowX: "visible",
  overflowY: "visible",
  marginTop: "0px",
  marginRight: "0px",
  marginBottom: "0px",
  marginLeft: "0px",
  ...el.computed,
  ...(pseudo && el.pseudo ? el.pseudo[pseudo] : {}),
});
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
globalThis.ResizeObserver = class {
  constructor(fn) { this.fn = fn; this.targets = []; resizeObservers.push(this); }
  observe(el) { this.targets.push(el); }
  unobserve(el) { this.targets = this.targets.filter((t) => t !== el); }
  disconnect() { this.targets = []; }
};
globalThis.MutationObserver = class {
  constructor(fn) { this.fn = fn; this.targets = []; mutationObservers.push(this); }
  observe(el) { this.targets.push(el); }
  disconnect() { this.targets = []; }
};
const flushFrames = () => { while (frames.length) frames.shift()(); };
const counterChanged = (counter) => {
  for (const o of mutationObservers) if (o.targets.includes(counter)) o.fn([]);
};
const pageResized = (el) => {
  for (const o of resizeObservers) if (o.targets.includes(el)) o.fn([]);
};

const { capMessageField, capMessageEditor } = await import("../bytecap.js");
const {
  claimExpanded,
  collapseExpandedFields,
  fieldExpandOf,
  mountFieldExpand,
} = await import("../fieldexpand.js");
const host = () => doc.getElementById("field-full");
const hostPart = (cls) => {
  // The fake keeps className and classList apart; a browser keeps them one.
  const has = (el) => el.classList.contains(cls) || String(el.className || "").split(/\s+/).includes(cls);
  const walk = (el) => {
    if (has(el)) return el;
    for (const child of el.children) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return host() ? walk(host()) : null;
};

const MAX = 18 * 1024;
const bytes = (text) => new TextEncoder().encode(text).length;

function el(tag, props = {}, ...kids) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") value.split(/\s+/).filter(Boolean).forEach((c) => node.classList.add(c));
    else if (key === "data") Object.assign(node.dataset, value);
    else if (key === "rect") node.rect = value;
    else node[key] = value;
  }
  node.append(...kids);
  return node;
}

// A drawer page: header, body, then the Swap bio box with its Save.
function swapBioPage() {
  const field = el("textarea", { id: "bio-" + Math.random(), rect: { top: 300, left: 16, width: 320, height: 80 }, offsetTop: 0, offsetLeft: 0, offsetWidth: 320, offsetHeight: 80 });
  // Its own line under the field, 6px in from each side.
  const counter = el("div", { class: "swap-bio-count hcs-byte-counter", textContent: "0 B / 18 KB", offsetTop: 88, offsetHeight: 14, offsetLeft: 6, offsetWidth: 340 });
  counter.computed = { fontSize: "12px" };
  const fieldWrap = el("div", { class: "swap-bio-field", clientWidth: 352 }, field, counter);
  const save = el("button", { data: { expandSend: "" } });
  const box = el("div", { data: { expandBox: "", expandTitle: "Swap bio" }, rect: { top: 290, left: 8, width: 352, height: 140 }, offsetHeight: 140 }, fieldWrap, save);
  const scroller = el("div", { class: "feed-menu-page-body", scrollTop: 120, scrollHeight: 2000, clientHeight: 700 }, box);
  const header = el("div", { class: "feed-menu-page-bar", rect: { top: 20, left: 0, width: 390, height: 56 } });
  const page = el("div", { class: "feed-menu-page", rect: { top: 20, left: 0, width: 390, height: 824 } }, header, scroller);
  page.computed = { containerType: "inline-size" };
  doc.body.appendChild(page);
  const paints = [];
  capMessageField(field, () => bytes(field.value));
  // The page's own counter (a plain listener, after the cap's capture one).
  field.addEventListener("input", () => {
    counter.textContent = `${bytes(field.value)} B / 18 KB`;
    paints.push(bytes(field.value));
  });
  const sent = [];
  save.addEventListener("click", () => sent.push(field.value));
  return { page, header, scroller, box, fieldWrap, field, counter, save, sent, paints };
}

function type(field, text, { at } = {}) {
  field.dispatchEvent(new FakeEvent("beforeinput"));
  const start = at == null ? field.value.length : at;
  field.value = field.value.slice(0, start) + text + field.value.slice(start);
  field.selectionStart = field.selectionEnd = start + text.length;
  field.dispatchEvent(new FakeEvent("input", { bubbles: true }));
}

const buttonOf = (field) => fieldExpandOf(field).button;
const tap = (button) => {
  const down = new FakeEvent("pointerdown", { bubbles: true });
  button.dispatchEvent(down);
  button.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  return down;
};

test("the button appears once there is text and hides when the box is empty", () => {
  const { field, counter } = swapBioPage();
  const button = buttonOf(field);
  assert.equal(button.parentElement, field.parentElement);
  assert.equal(button.classList.contains("is-shown"), false);
  type(field, "Hello");
  assert.equal(button.classList.contains("is-shown"), true);
  assert.equal(button.getAttribute("aria-label"), "Full screen");
  // In the counter's row: centred on its line, as far in from the left as
  // the counter is from the right, sized from the counter's font.
  assert.equal(button.style.props["--fx-row-mid"], "95px");
  assert.equal(button.style.props["--fx-row-left"], "6px");
  assert.equal(button.style.props["--fx-row-font"], "12px");
  assert.equal(button.classList.contains("is-rowless"), false);
  // The text keeps its full width: no padding of its own for the button.
  assert.equal(field.classList.contains("has-field-expand"), false);
  field.dispatchEvent(new FakeEvent("beforeinput"));
  field.value = "";
  field.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  assert.equal(button.classList.contains("is-shown"), false);
  // A draft restored from code: no input event, the page repaints the counter.
  field.value = "Saved draft";
  counter.textContent = "11 B / 18 KB";
  counterChanged(counter);
  assert.equal(button.classList.contains("is-shown"), true);
});

test("expanding opens the box as its own page over the app, and closing puts every element back", () => {
  const { scroller, box, field, fieldWrap, counter, save } = swapBioPage();
  type(field, "A long bio\nwith lines");
  field.focus();
  field.setSelectionRange(4, 4);
  const slot = scroller.children.indexOf(box);
  const down = tap(buttonOf(field));
  assert.equal(down.defaultPrevented, true, "the button never takes focus");
  assert.equal(fieldExpandOf(field).expanded, true);
  assert.equal(box.classList.contains("is-expanded"), true);
  // The box is in the full-screen page: a child of <body>, shown, titled.
  const page = host();
  assert.ok(page, "#field-full exists");
  assert.equal(page.parentElement, doc.body);
  assert.equal(page.hidden, false);
  assert.equal(page.attrs.role, "dialog");
  assert.equal(box.parentElement, hostPart("field-full-body"));
  assert.equal(hostPart("field-full-title").textContent, "Swap bio");
  assert.equal(hostPart("feed-chat-bar"), hostPart("field-full-bar"), "the app's page bar");
  assert.ok(hostPart("feed-chat-back"), "with its ←");
  // Its own Save is the header's action: the same element, moved.
  assert.equal(save.parentElement, hostPart("field-full-actions"));
  assert.equal(page.classList.contains("has-actions"), true);
  // Only the box moved: inside it, nothing did.
  assert.equal(field.parentElement, fieldWrap);
  assert.equal(counter.parentElement, fieldWrap);
  assert.equal(buttonOf(field).parentElement, fieldWrap, "the button stays in the counter's row");
  assert.equal(fieldWrap.classList.contains("field-expand-path"), true);
  // A placeholder of the box's height holds its place in the page.
  const placeholder = scroller.children[slot];
  assert.equal(placeholder.className, "field-expand-placeholder");
  assert.equal(placeholder.style.height, "140px");
  // The move took the focus and the caret; both are back.
  assert.equal(field.value, "A long bio\nwith lines");
  assert.equal(doc.activeElement, field);
  assert.deepEqual([field.selectionStart, field.selectionEnd], [4, 4]);
  assert.equal(buttonOf(field).getAttribute("aria-label"), "Exit full screen");
  assert.deepEqual(layers.open, ["fieldfull"]);
  assert.equal(box.dataset.kbSkip, undefined, "keyboardlayout.js pins #field-full itself");
  field.setSelectionRange(7, 9);
  collapseExpandedFields();
  // Every element back where it was, the page closed, focus and caret kept.
  assert.equal(scroller.children[slot], box);
  assert.equal(scroller.children.some((c) => c.className === "field-expand-placeholder"), false);
  assert.equal(box.children[box.children.length - 1], save, "Save is back after the field");
  assert.equal(page.hidden, true);
  assert.equal(page.classList.contains("has-actions"), false);
  assert.equal(doc.activeElement, field);
  assert.deepEqual([field.selectionStart, field.selectionEnd], [7, 9]);
  assert.equal(fieldWrap.classList.contains("field-expand-path"), false);
});

test("a tap in the full-screen page stays there, the backdrop included", () => {
  const { field } = swapBioPage();
  type(field, "Text");
  tap(buttonOf(field));
  let documentSawIt = 0;
  const seen = () => { documentSawIt += 1; };
  doc.body.addEventListener("click", seen);
  doc.body.addEventListener("pointerdown", seen);
  field.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  field.dispatchEvent(new FakeEvent("pointerdown", { bubbles: true }));
  host().dispatchEvent(new FakeEvent("click", { bubbles: true }));
  assert.equal(documentSawIt, 0, "CloseALL and the drawer's outside taps never see it");
  assert.equal(fieldExpandOf(field).expanded, true, "the backdrop does nothing");
  doc.body.removeEventListener("click", seen);
  doc.body.removeEventListener("pointerdown", seen);
  collapseExpandedFields();
});

test("the 18 KB cap and the live counter keep working while expanded", () => {
  const { box, field, counter, paints } = swapBioPage();
  type(field, "Start ");
  tap(buttonOf(field));
  assert.equal(box.classList.contains("is-expanded"), true);
  type(field, "x".repeat(MAX + 500));
  assert.ok(bytes(field.value) <= MAX, `kept ${bytes(field.value)} bytes`);
  assert.equal(bytes(field.value), MAX, "filled to the limit, not past it");
  assert.equal(counter.textContent, `${MAX} B / 18 KB`);
  assert.ok(paints.every((n) => n <= MAX), "the counter never showed an over-limit value");
  assert.equal(box.classList.contains("is-expanded"), true, "still expanded");
  collapseExpandedFields();
});

test("the header's Save is the page's own: it sends as usual, then closes; a blocked send does not", async () => {
  const { box, field, save, sent, scroller } = swapBioPage();
  type(field, "Bio to save");
  field.focus();
  tap(buttonOf(field));
  assert.equal(save.parentElement, hostPart("field-full-actions"));
  scroller.scrollTop = 900;
  save.classList.add("hcs-send-blocked");
  save.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  await Promise.resolve();
  assert.equal(box.classList.contains("is-expanded"), true, "a send the limit blocked keeps it open");
  save.classList.remove("hcs-send-blocked");
  save.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  assert.deepEqual(sent, ["Bio to save", "Bio to save"], "the page's own send ran with the text");
  await Promise.resolve();
  assert.equal(box.classList.contains("is-expanded"), false);
  assert.equal(save.parentElement, box, "Save is back in its box");
  assert.equal(doc.activeElement, field, "focus comes back, so the keyboard stays");
  assert.equal(scroller.scrollTop, 120, "the page's scroll is back where it was");
  assert.equal(box.parentElement, scroller);
  assert.equal(box.parentElement.children.some((c) => c.className === "field-expand-placeholder"), false);
  assert.equal(layers.open.includes("fieldfull"), false, "its history entry is gone");
});

test("Back, Escape and the button collapse it", () => {
  const { box, field } = swapBioPage();
  type(field, "Text");
  // Back: the history layer's close, which must not step history again.
  tap(buttonOf(field));
  const before = layers.log.length;
  layers.open.splice(layers.open.lastIndexOf("fieldfull"), 1);
  layers.defined.get("fieldfull").close();
  assert.equal(box.classList.contains("is-expanded"), false);
  assert.equal(layers.log.length, before, "Back already consumed the entry");
  // Escape, without reaching the page's own Escape handler.
  tap(buttonOf(field));
  let pageSawEscape = false;
  doc.body.addEventListener("keydown", () => { pageSawEscape = true; });
  field.dispatchEvent(new FakeEvent("keydown", { bubbles: true, key: "Escape" }));
  assert.equal(box.classList.contains("is-expanded"), false);
  assert.equal(pageSawEscape, false);
  // The same button.
  tap(buttonOf(field));
  assert.equal(box.classList.contains("is-expanded"), true);
  tap(buttonOf(field));
  assert.equal(box.classList.contains("is-expanded"), false);
  assert.equal(layers.open.includes("fieldfull"), false);
  // The header's ←, which never takes the focus.
  field.focus();
  tap(buttonOf(field));
  const back = tap(hostPart("field-full-back"));
  assert.equal(back.defaultPrevented, true);
  assert.equal(box.classList.contains("is-expanded"), false);
  assert.equal(doc.activeElement, field);
  assert.equal(layers.open.includes("fieldfull"), false);
});

test("one box at a time, chat composers included", () => {
  const a = swapBioPage();
  const b = swapBioPage();
  type(a.field, "A");
  type(b.field, "B");
  tap(buttonOf(a.field));
  tap(buttonOf(b.field));
  assert.equal(a.box.classList.contains("is-expanded"), false);
  assert.equal(b.box.classList.contains("is-expanded"), true);
  // A chat composer expanding (chatcomposer.js claims the same way).
  let chatOpen = true;
  claimExpanded({ collapse: () => { chatOpen = false; } });
  assert.equal(b.box.classList.contains("is-expanded"), false);
  tap(buttonOf(a.field));
  assert.equal(chatOpen, false, "and a box expanding closes the composer");
  assert.equal(a.box.classList.contains("is-expanded"), true);
  collapseExpandedFields();
  assert.equal(a.box.classList.contains("is-expanded"), false);
});

test("closing the page collapses it first; a page that closed some other way collapses it too", () => {
  const { page, box, field } = swapBioPage();
  type(field, "Text");
  tap(buttonOf(field));
  collapseExpandedFields();
  assert.equal(box.classList.contains("is-expanded"), false);
  assert.deepEqual(layers.log.slice(-1), [["closed", "fieldfull"]], "its entry goes before the page's");
  tap(buttonOf(field));
  page.hidden = true;
  pageResized(page);
  flushFrames();
  assert.equal(box.classList.contains("is-expanded"), false);
  assert.equal(layers.open.includes("fieldfull"), false);
});

test("Draw's text: a contenteditable that mirrors into a field; its Submit buttons go to the header and back", async () => {
  const editor = el("div", { class: "draw-popup-text", isContentEditable: true, offsetWidth: 330, offsetHeight: 120, rect: { top: 400, left: 20, width: 330, height: 120 } });
  editor.attrs.contenteditable = "true";
  editor.attrs["aria-label"] = "Message";
  // Inside the bubble's bottom right, 16px in.
  const counter = el("div", { class: "draw-byte-counter hcs-byte-counter", offsetTop: 108, offsetHeight: 10, offsetLeft: 250, offsetWidth: 84 });
  const wrap = el("div", { class: "draw-text-wrap", data: { expandTitle: "Message" }, rect: { top: 400, left: 20, width: 350, height: 130 }, offsetHeight: 130, clientWidth: 350 }, editor, counter);
  const mirror = el("textarea", { hidden: true });
  const submit = el("button", { data: { expandSend: "" } });
  const encrypted = el("button", { data: { expandSend: "" } });
  const submitRow = el("div", { class: "draw-submit-row", data: { expandFooter: "" }, rect: { top: 760, left: 0, width: 390, height: 60 } }, submit, encrypted);
  const scroll = el("div", { class: "draw-form-scroll" }, wrap);
  const editorPage = el("div", { class: "draw-popup-editor" }, scroll, submitRow, mirror);
  const drawColumn = el("div", { id: "draw-column" }, editorPage);
  const bar = el("div", { class: "feed-chat-bar", rect: { top: 0, left: 0, width: 390, height: 60 } });
  const feedChat = el("div", { id: "feed-chat", rect: { top: 0, left: 0, width: 390, height: 844 } }, bar, drawColumn);
  doc.body.appendChild(feedChat);
  // drawpreview.js: the editor writes its text into the mirror.
  editor.addEventListener("input", () => {
    mirror.value = editor.textContent;
    counter.textContent = `${bytes(mirror.value)} B / 18 KB`;
  });
  capMessageEditor(editor, mirror, () => bytes(mirror.value), () => {});
  const ctl = fieldExpandOf(editor);
  assert.ok(ctl, "a capped editor gets the button too");
  assert.equal(ctl.button.classList.contains("is-shown"), false);
  editor.textContent = "A post";
  editor.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  assert.equal(ctl.button.classList.contains("is-shown"), true);
  assert.equal(ctl.button.style.props["--fx-row-mid"], "113px");
  assert.equal(ctl.button.style.props["--fx-row-left"], "16px", "mirrors the counter's 16px from the right");
  tap(ctl.button);
  assert.equal(wrap.classList.contains("is-expanded"), true);
  assert.equal(wrap.parentElement, hostPart("field-full-body"));
  assert.equal(hostPart("field-full-title").textContent, "Message");
  // Both Submit buttons, the same elements, in the header in their order.
  assert.deepEqual(hostPart("field-full-actions").children, [submit, encrypted]);
  assert.equal(submitRow.children.length, 2, "a marker holds each one's place");
  // The mirror field still follows the editor while it is out.
  editor.textContent = "A post, longer";
  editor.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  assert.equal(mirror.value, "A post, longer");
  assert.equal(counter.textContent, `${bytes("A post, longer")} B / 18 KB`);
  submit.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  await Promise.resolve();
  assert.equal(wrap.classList.contains("is-expanded"), false, "Submit collapses it");
  assert.deepEqual(submitRow.children, [submit, encrypted], "both back in the Submit row, markers gone");
  assert.equal(wrap.parentElement, scroll);
  assert.equal(editor.textContent, "A post, longer");
});

test("a box with no counter gets a small row of its own for the button", () => {
  const field = el("textarea", { rect: { top: 0, left: 0, width: 300, height: 80 } });
  const holder = el("div", { rect: { top: 0, left: 0, width: 300, height: 90 } }, field);
  doc.body.appendChild(holder);
  capMessageField(field, () => bytes(field.value));
  type(field, "Text");
  assert.equal(buttonOf(field).classList.contains("is-rowless"), true);
  assert.equal(buttonOf(field).style.props["--fx-row-mid"], undefined);
});

test("the button stands under the clear ×: its column, its face, one gap below; the counter row when two do not fit", () => {
  const { fieldWrap, field } = swapBioPage();
  fieldWrap.rect = { top: 300, left: 16, width: 352, height: 110 };
  fieldWrap.offsetWidth = 352;
  // fieldclear.js's ×: a 40 x 44 hit box, its round 24px face on the first line.
  const clear = el("button", { class: "field-clear", rect: { top: 302, left: 296, width: 40, height: 44 }, clientWidth: 40, clientHeight: 44 });
  clear.computed = { borderTopWidth: "0px", backgroundColor: "rgba(0, 0, 0, 0)", color: "rgba(255, 255, 255, 0.85)" };
  clear.pseudo = { "::before": { width: "24px", left: "20px", top: "22px", backgroundColor: "rgba(255, 255, 255, 0.12)" }, "::after": { width: "12px" } };
  field.after(clear);
  const button = buttonOf(field);
  // The box's --ui-gap, resolved (style.css carries it in scroll-margin-top).
  button.computed = { scrollMarginTop: "8px" };
  type(field, "Hello");
  flushFrames();
  const props = button.style.props;
  assert.equal(button.classList.contains("is-stacked"), true);
  // Centred on the face (x 300), 24px like it, its bottom (36) + 8 below.
  assert.equal(props["--fx-stack-left"], "288px");
  assert.equal(props["--fx-stack-top"], "44px");
  assert.equal(props["--fx-stack-size"], "24px");
  assert.equal(props["--fx-face-bg"], "rgba(255, 255, 255, 0.12)");
  assert.equal(props["--fx-face-color"], "rgba(255, 255, 255, 0.85)");
  assert.equal(props["--fx-glyph"], "12px");
  // Too short for two: back in the counter's row.
  field.offsetHeight = 60;
  pageResized(field);
  assert.equal(button.classList.contains("is-stacked"), false);
  assert.equal(props["--fx-row-left"], "6px");
  // A chip × (Swap bio's): the chip itself is the face.
  field.offsetHeight = 160;
  clear.rect = { top: 302, left: 292, width: 44, height: 44 };
  clear.computed = { borderTopWidth: "1px", borderTopColor: "rgba(255, 255, 255, 0.22)", backgroundColor: "rgba(255, 255, 255, 0.08)", color: "rgba(255, 255, 255, 0.85)" };
  pageResized(field);
  assert.equal(button.classList.contains("is-stacked"), true);
  assert.equal(props["--fx-stack-left"], "276px");
  assert.equal(props["--fx-stack-top"], "54px");
  assert.equal(props["--fx-stack-size"], "44px");
  assert.equal(props["--fx-face-border"], "1px solid rgba(255, 255, 255, 0.22)");
  // Full screen: an emptied text hides the ×; the way out stays where it was.
  tap(button);
  flushFrames();
  assert.equal(fieldExpandOf(field).expanded, true);
  clear.hidden = true;
  field.value = "";
  field.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  flushFrames();
  assert.equal(button.classList.contains("is-shown"), true);
  assert.equal(button.classList.contains("is-stacked"), true);
  assert.equal(props["--fx-stack-top"], "54px");
  assert.equal(props["--fx-stack-left"], "276px");
  fieldExpandOf(field).collapse();
  flushFrames();
  assert.equal(button.classList.contains("is-shown"), false);
});

test("a comment textarea in a data-expand-box moves Send into the page header and puts it back", () => {
  const field = el("textarea", {
    rect: { top: 700, left: 16, width: 280, height: 44 },
    offsetWidth: 280,
    offsetHeight: 44,
  });
  const send = el("button", { data: { expandSend: "" }, textContent: "Send" });
  const row = el("div", { class: "comments-input-row" }, field, send);
  const box = el("div", {
    class: "comments-compose",
    data: { expandBox: "", expandTitle: "Comment" },
    rect: { top: 680, left: 8, width: 360, height: 96 },
    offsetHeight: 96,
  }, row);
  const bar = el("div", { class: "feed-comments-bar", rect: { top: 0, left: 0, width: 390, height: 56 } });
  const page = el("div", { class: "comments-modal" }, bar, box);
  doc.body.appendChild(page);
  field.value = "A comment";
  assert.equal(mountFieldExpand(field), fieldExpandOf(field));
  assert.equal(buttonOf(field).classList.contains("is-shown"), true);
  const home = page.children.indexOf(box);
  tap(buttonOf(field));
  try {
    assert.equal(fieldExpandOf(field).expanded, true);
    assert.equal(box.parentElement, hostPart("field-full-body"));
    assert.equal(send.parentElement, hostPart("field-full-actions"));
    assert.equal(hostPart("field-full-title").textContent, "Comment");
    assert.equal(host().classList.contains("has-actions"), true);
    assert.equal(field.parentElement, row);
  } finally {
    collapseExpandedFields();
  }
  assert.equal(page.children[home], box);
  assert.equal(send.parentElement, row);
  assert.equal(fieldExpandOf(field).expanded, false);
});

// The comment composer with an auto-growing textarea: its input listener,
// like adjustTextareaHeight, clears the inline height and writes the
// field's scrollHeight back. Its scrollHeight is the page's while the box
// is in #field-full and one line's at home. Every run is logged: where the
// field was, the inline height it found, and the one it wrote.
function growingComposer({ height = "44px", priority = "" } = {}) {
  const field = el("textarea", {
    rect: { top: 700, left: 16, width: 280, height: 44 },
    offsetWidth: 280,
    offsetHeight: 44,
  });
  const send = el("button", { data: { expandSend: "" }, textContent: "Send" });
  const row = el("div", { class: "comments-input-row" }, field, send);
  const box = el("div", {
    class: "comments-compose",
    data: { expandBox: "", expandTitle: "Comment" },
    rect: { top: 680, left: 8, width: 360, height: 96 },
    offsetHeight: 96,
  }, row);
  const page = el("div", { class: "comments-modal" }, box);
  doc.body.appendChild(page);
  if (height) field.style.setProperty("height", height, priority);
  const home = () => box.parentElement === page && field.parentElement === row;
  Object.defineProperty(field, "scrollHeight", { get: () => (home() ? 44 : 700), configurable: true });
  const runs = [];
  field.addEventListener("input", () => {
    const found = field.style.getPropertyValue("height");
    const foundPriority = field.style.getPropertyPriority("height");
    field.style.setProperty("height", "");
    field.style.setProperty("height", `${field.scrollHeight}px`);
    runs.push({ home: home(), found, foundPriority, wrote: field.style.getPropertyValue("height") });
  });
  field.value = "A comment";
  mountFieldExpand(field);
  return { field, send, row, box, page, runs, home };
}

test("a textarea typed in while expanded gets its row height back and one input event at home after it closes", () => {
  const { field, send, row, box, page, runs, home } = growingComposer({ height: "44px", priority: "important" });
  tap(buttonOf(field));
  assert.equal(fieldExpandOf(field).expanded, true);
  // The whole message deleted in the page: the listener writes the page's height.
  field.value = "";
  field.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  assert.deepEqual(runs.at(-1), { home: false, found: "44px", foundPriority: "important", wrote: "700px" });
  const before = runs.length;
  // The header's ←.
  tap(hostPart("field-full-back"));
  assert.equal(fieldExpandOf(field).expanded, false);
  assert.equal(box.parentElement, page);
  assert.equal(field.parentElement, row);
  assert.equal(send.parentElement, row);
  // One input event, with the box home and the row height already back.
  assert.equal(runs.length, before + 1);
  assert.deepEqual(runs.at(-1), { home: true, found: "44px", foundPriority: "important", wrote: "44px" });
  // What the field's own listener measured in its row, not the page's height.
  assert.equal(field.style.getPropertyValue("height"), "44px");
  assert.ok(home());

  // Typed in with no inline height before it opened: removed, then fitted.
  const fresh = growingComposer({ height: "" });
  tap(buttonOf(fresh.field));
  fresh.field.value = "Another";
  fresh.field.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  assert.equal(fresh.field.style.getPropertyValue("height"), "700px");
  const count = fresh.runs.length;
  collapseExpandedFields();
  assert.equal(fresh.runs.length, count + 1);
  assert.deepEqual(fresh.runs.at(-1), { home: true, found: "", foundPriority: "", wrote: "44px" });
});

test("opened and closed without typing: no extra input event, the inline height untouched; Escape and collapseExpandedFields() refit too", () => {
  const quiet = growingComposer({ height: "52px" });
  const writes = [];
  const { setProperty, removeProperty } = quiet.field.style;
  quiet.field.style.setProperty = (...args) => { writes.push(["set", ...args]); return setProperty(...args); };
  quiet.field.style.removeProperty = (...args) => { writes.push(["remove", ...args]); return removeProperty(...args); };
  tap(buttonOf(quiet.field));
  assert.equal(fieldExpandOf(quiet.field).expanded, true);
  tap(hostPart("field-full-back"));
  assert.equal(fieldExpandOf(quiet.field).expanded, false);
  assert.equal(quiet.runs.length, 0);
  assert.deepEqual(writes, []);
  assert.equal(quiet.field.style.getPropertyValue("height"), "52px");

  // Typed in, then Escape.
  const esc = growingComposer();
  tap(buttonOf(esc.field));
  esc.field.value = "Shorter";
  esc.field.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  const count = esc.runs.length;
  esc.field.dispatchEvent(new FakeEvent("keydown", { bubbles: true, key: "Escape" }));
  assert.equal(fieldExpandOf(esc.field).expanded, false);
  assert.equal(esc.runs.length, count + 1);
  assert.equal(esc.runs.at(-1).home, true);
  assert.equal(esc.field.style.getPropertyValue("height"), "44px");

  // Typed in, then closed from code (another page, a send).
  const code = growingComposer();
  tap(buttonOf(code.field));
  code.field.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  const before = code.runs.length;
  collapseExpandedFields();
  assert.equal(code.runs.length, before + 1);
  assert.equal(code.runs.at(-1).home, true);
  // Opened again and closed untouched: nothing more.
  tap(buttonOf(code.field));
  collapseExpandedFields();
  assert.equal(code.runs.length, before + 1);
});

test("a contenteditable (Draw's text with its mirror) gets no input event when it closes", () => {
  const editor = el("div", { class: "draw-popup-text", isContentEditable: true, offsetWidth: 330, offsetHeight: 120, rect: { top: 400, left: 20, width: 330, height: 120 }, textContent: "Draft" });
  editor.attrs.contenteditable = "true";
  const mirror = el("textarea", { hidden: true, value: "Draft" });
  const box = el("div", { class: "draw-text-wrap", data: { expandBox: "", expandTitle: "Message" }, rect: { top: 400, left: 20, width: 350, height: 130 }, offsetHeight: 130, clientWidth: 350 }, editor);
  const page = el("div", { class: "draw-popup-editor" }, box, mirror);
  doc.body.appendChild(page);
  mountFieldExpand(editor, { mirror });
  const seen = [];
  editor.addEventListener("input", () => seen.push("editor"));
  mirror.addEventListener("input", () => seen.push("mirror"));
  fieldExpandOf(editor).expand();
  assert.equal(fieldExpandOf(editor).expanded, true);
  editor.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  const count = seen.length;
  collapseExpandedFields();
  assert.equal(fieldExpandOf(editor).expanded, false);
  assert.equal(box.parentElement, page);
  assert.equal(seen.length, count);
});

test("single-line fields, titles and chat composers get no button", () => {
  const input = el("input");
  const holder = el("div", {}, input);
  doc.body.appendChild(holder);
  capMessageField(input, () => 0);
  assert.equal(fieldExpandOf(input), null);
  assert.equal(holder.children.length, 1);
  const chatField = el("textarea");
  const compose = el("div", { class: "chat-compose" }, el("div", { class: "chat-compose-row" }, chatField));
  doc.body.appendChild(compose);
  capMessageField(chatField, () => 0);
  assert.equal(fieldExpandOf(chatField), null, "the composers keep their own fullscreen");
  assert.equal(mountFieldExpand(el("div")), null, "not a text box");
});

test("hooked in once in bytecap.js, marked and titled in the pages, and pinned above the keyboard", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const cap = read("../bytecap.js");
  assert.match(cap, /import \{ mountFieldExpand \} from '\.\/fieldexpand\.js';/);
  assert.match(cap, /mountFieldExpand\(field\);\r?\n\}/);
  assert.match(cap, /mountFieldExpand\(editor, \{ mirror: field \}\);\r?\n\}/);
  const html = read("../index.html");
  assert.match(html, /id="popup-settings-editbox" data-expand-box data-expand-title="Edit post"/);
  assert.match(html, /id="popup-settings-edit-save" class="toolbar-column-btns" data-expand-send/);
  assert.match(html, /id="edit-profile-swap-bio" data-expand-box data-expand-title="Swap bio"/);
  assert.match(html, /id="button_for_swap_bio" type="button" data-expand-send/);
  assert.equal((html.match(/class="draw-text-wrap" data-expand-title="Message"/g) || []).length, 2);
  assert.equal((html.match(/class="draw-submit-row" data-expand-footer/g) || []).length, 2);
  assert.equal((html.match(/id="submit-button-Create_(encrypted-)?(Marker|Polygon)" class="toolbar-column-btns" data-expand-send/g) || []).length, 4);
  // keyboardlayout.js pins the nearest fixed ancestor of the focused field:
  // #field-full is one.
  assert.match(read("../keyboardlayout.js"), /if \(pos === 'fixed'\) return node;/);
  // Pages that close collapse it first.
  assert.match(read("../chatcomposer.js"), /export function collapseComposers\(\) \{[\s\S]*?collapseExpandedFields\(\);/);
  assert.match(read("../processallmessages.js"), /function closePopupSettings\(\) \{\s*\/\/[^\n]*\n\s*collapseExpandedFields\(\);/);
  const feed = read("../feedlayout.js");
  for (const name of ["drawerBack", "drawerPageClose", "dropDrawerHistory"]) {
    const start = feed.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    assert.match(feed.slice(start, start + 260), /collapseExpandedFields\(\);/, name);
  }
  // No fixed px in its styles: only the measured offsets are px.
  const css = read("../style.css").replace(/\r\n/g, "\n");
  const block = css.slice(css.indexOf("/* Full screen for every 18 KB box"), css.indexOf("/* Pick on the map from the Draw form"));
  assert.ok(block.length > 500);
  assert.deepEqual(block.replace(/var\(--fx-row-(mid|left), 0px\)/g, "").match(/\d+(\.\d+)?px/g), null);
  // A page over the whole app; its bar is the app's page bar.
  assert.match(block, /\.field-full \{[^}]*position: fixed;[^}]*inset: 0;[^}]*z-index: 9050;/);
  assert.match(block, /@media \(orientation: landscape\) \{\s*html\.feed-app \.field-full \{[^}]*\}\s*\.field-full \{[^}]*background: rgba\(0, 0, 0, 0\.55\);/);
  // Outside #feed-layout, it brings the feed column width its feed-mode bar reads.
  assert.match(block, /html\.feed-app \.field-full \{\s*--feed-col-width: 100dvw;/);
  assert.match(block, /\.field-full-panel \{\s*width: min\(100%, 46rem\);/);
  const title = css.indexOf(") :is(.feed-chat-title, .feed-settings-title, .feed-comments-title)");
  assert.match(css.slice(css.lastIndexOf(":is(", title), title), /\.field-full-bar/);
  assert.match(css, /\.picker-sheet,\n\.field-full \{\n {2}--ui-label:/);
  // The text keeps its full width: the old corner insets and paddings are gone.
  assert.doesNotMatch(css, /has-field-expand/);
  assert.doesNotMatch(css, /--fx-inset|--fx-field-(top|right)/);
  assert.doesNotMatch(css, /\.swap-bio-field > \.field-expand-btn/);
  assert.match(block, /\.field-expand-btn\.is-stacked \{[^}]*top: var\(--fx-stack-top, 0\);[^}]*left: var\(--fx-stack-left, 0\);[^}]*width: var\(--fx-stack-size/);
});
