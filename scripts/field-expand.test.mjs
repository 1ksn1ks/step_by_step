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
    this.style = {
      props,
      setProperty(name, value) { props[name] = String(value); },
      removeProperty(name) { delete props[name]; },
      getPropertyValue(name) { return props[name] || ""; },
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
    if (node.parentElement) node.remove();
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
globalThis.getComputedStyle = (el) => ({
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
});
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
globalThis.ResizeObserver = class {
  constructor(fn) { this.fn = fn; this.targets = []; resizeObservers.push(this); }
  observe(el) { this.targets.push(el); }
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
  expandFrame,
  fieldExpandOf,
  mountFieldExpand,
} = await import("../fieldexpand.js");

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
  const counter = el("div", { class: "swap-bio-count hcs-byte-counter", textContent: "0 B / 18 KB" });
  const fieldWrap = el("div", { class: "swap-bio-field", clientWidth: 352 }, field, counter);
  const save = el("button", { data: { expandSend: "" } });
  const box = el("div", { data: { expandBox: "" }, rect: { top: 290, left: 8, width: 352, height: 140 }, offsetHeight: 140 }, fieldWrap, save);
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
  assert.equal(button.parentElement, field.parentElement, "it sits in the field's corner");
  assert.equal(button.classList.contains("is-shown"), false);
  type(field, "Hello");
  assert.equal(button.classList.contains("is-shown"), true);
  assert.equal(button.getAttribute("aria-label"), "Full screen");
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

test("expanding keeps the same element, its text, caret and focus, and covers the page below its header", () => {
  const { page, box, field, fieldWrap } = swapBioPage();
  type(field, "A long bio\nwith lines");
  field.focus();
  field.setSelectionRange(4, 4);
  const parent = field.parentElement;
  const down = tap(buttonOf(field));
  assert.equal(down.defaultPrevented, true, "the button never takes focus");
  assert.equal(fieldExpandOf(field).expanded, true);
  assert.equal(box.classList.contains("is-expanded"), true);
  assert.equal(field.parentElement, parent, "the field is not moved");
  assert.equal(field.value, "A long bio\nwith lines");
  assert.deepEqual([field.selectionStart, field.selectionEnd], [4, 4]);
  assert.equal(doc.activeElement, field);
  assert.equal(fieldWrap.classList.contains("field-expand-path"), true);
  // A placeholder of the box's height keeps the page's layout.
  const placeholder = box.parentElement.children[box.parentElement.children.indexOf(box) - 1];
  assert.equal(placeholder.className, "field-expand-placeholder");
  assert.equal(placeholder.style.height, "140px");
  // Below the header (top 20 + 56), the page's width, to its bottom; in
  // the page's coordinates (it is a size container at top 20).
  assert.deepEqual(expandFrame(box), { top: 76, left: 0, width: 390, height: 768 });
  assert.equal(box.style.props["--fx-top"], "56px");
  assert.equal(box.style.props["--fx-left"], "0px");
  assert.equal(box.style.props["--fx-width"], "390px");
  assert.equal(box.style.props["--fx-height"], "768px");
  assert.equal(box.dataset.kbSkip, "1", "keyboardlayout.js pins the page, not the box");
  assert.equal(buttonOf(field).getAttribute("aria-label"), "Exit full screen");
  assert.deepEqual(layers.open, ["fieldfull"]);
  void page;
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

test("a send from full screen sends as usual, then collapses; a blocked send does not", async () => {
  const { box, field, save, sent, scroller } = swapBioPage();
  type(field, "Bio to save");
  field.focus();
  tap(buttonOf(field));
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
  assert.equal(doc.activeElement, field, "focus stays, so the keyboard does too");
  assert.equal(scroller.scrollTop, 120, "the page's scroll is back where it was");
  assert.equal(box.parentElement.children.some((c) => c.className === "field-expand-placeholder"), false);
  assert.equal(layers.open.includes("fieldfull"), false, "its history entry is gone");
  assert.equal(box.dataset.kbSkip, undefined);
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

test("Draw's text: a contenteditable that mirrors into a field, above the Submit row", async () => {
  const editor = el("div", { class: "draw-popup-text", isContentEditable: true, offsetWidth: 330, offsetHeight: 120, rect: { top: 400, left: 20, width: 330, height: 120 } });
  editor.attrs.contenteditable = "true";
  const counter = el("div", { class: "draw-byte-counter hcs-byte-counter" });
  const wrap = el("div", { class: "draw-text-wrap", rect: { top: 400, left: 20, width: 350, height: 130 }, offsetHeight: 130, clientWidth: 350 }, editor, counter);
  const mirror = el("textarea", { hidden: true });
  const submit = el("button", { data: { expandSend: "" } });
  const submitRow = el("div", { class: "draw-submit-row", data: { expandFooter: "" }, rect: { top: 760, left: 0, width: 390, height: 60 } }, submit);
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
  tap(ctl.button);
  assert.equal(wrap.classList.contains("is-expanded"), true);
  // The #feed-chat page (it has the header), above the Submit row.
  assert.deepEqual(expandFrame(wrap), { top: 60, left: 0, width: 390, height: 700 });
  submit.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  await Promise.resolve();
  assert.equal(wrap.classList.contains("is-expanded"), false, "Submit collapses it");
  assert.equal(editor.textContent, "A post");
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

test("hooked in once in bytecap.js, marked in the pages, and skipped by the keyboard pin", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const cap = read("../bytecap.js");
  assert.match(cap, /import \{ mountFieldExpand \} from '\.\/fieldexpand\.js';/);
  assert.match(cap, /mountFieldExpand\(field\);\r?\n\}/);
  assert.match(cap, /mountFieldExpand\(editor, \{ mirror: field \}\);\r?\n\}/);
  const html = read("../index.html");
  assert.match(html, /id="popup-settings-editbox" data-expand-box/);
  assert.match(html, /id="popup-settings-edit-save" class="toolbar-column-btns" data-expand-send/);
  assert.match(html, /id="edit-profile-swap-bio" data-expand-box/);
  assert.match(html, /id="button_for_swap_bio" type="button" data-expand-send/);
  assert.equal((html.match(/class="draw-submit-row" data-expand-footer/g) || []).length, 2);
  assert.equal((html.match(/id="submit-button-Create_(encrypted-)?(Marker|Polygon)" class="toolbar-column-btns" data-expand-send/g) || []).length, 4);
  assert.match(read("../keyboardlayout.js"), /if \(node\.dataset && node\.dataset\.kbSkip === '1'\) pos = '';/);
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
  const css = read("../style.css");
  const block = css.slice(css.indexOf("/* Full screen for every 18 KB box"), css.indexOf("/* Pick on the map from the Draw form"));
  assert.ok(block.length > 500);
  assert.deepEqual(block.replace(/var\(--fx-field-(top|right), 0px\)/g, "").match(/\d+(\.\d+)?px/g), null);
});
