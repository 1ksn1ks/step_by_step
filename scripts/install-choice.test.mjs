// Start in is a text field. A typed name, Enter, and a Following pick all
// ask /api/install-target. An unknown name or a failed retry leaves Install
// on the last community that resolved. A 404 or {ok:false} is cached; any
// other failure is asked again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// The real suggestion module opens WalletConnect through the picker. This
// screen only needs the two functions it wires: record the spec, and let a
// click stand in for a pick (the picker writes the field, then submit runs).
const suggestStub = "data:text/javascript," + encodeURIComponent(
  "export function attachFollowSuggest(input, opts) {\n" +
  "  globalThis.__installSuggest = { input, kinds: opts.kinds.slice(), submit: opts.submit };\n" +
  "}\n" +
  "export function bindPickButton(button, input) {\n" +
  "  button.addEventListener('click', () => {\n" +
  "    const spec = globalThis.__installSuggest;\n" +
  "    if (spec && spec.input === input && spec.submit) spec.submit();\n" +
  "  });\n" +
  "}\n",
);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL && context.parentURL.includes("/installchoice.js") && specifier === "./followsuggest.js") {
      return { url: suggestStub, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let loads = 0;

function element(tag) {
  return {
    tag,
    className: "",
    textContent: "",
    hidden: false,
    value: "",
    type: "",
    name: "",
    src: "",
    alt: "",
    width: 0,
    height: 0,
    decoding: "",
    checked: false,
    spellcheck: false,
    autocomplete: "",
    maxLength: 0,
    enterKeyHint: "",
    placeholder: "",
    id: "",
    blurred: false,
    children: [],
    parent: null,
    listeners: {},
    setAttribute(name, value) { this[name] = value; },
    append(...kids) {
      for (const kid of kids) {
        kid.parent = this;
        this.children.push(kid);
      }
    },
    appendChild(kid) {
      kid.parent = this;
      this.children.push(kid);
      return kid;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    blur() { this.blurred = true; },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((kid) => kid !== this);
      this.parent = null;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        if (node.tag === sel) out.push(node);
        for (const kid of node.children || []) walk(kid);
      };
      for (const kid of this.children) walk(kid);
      return out;
    },
  };
}

function browser(href) {
  const win = new EventTarget();
  win.location = new URL(href);
  win.matchMedia = () => ({ matches: false });
  win.navigator = { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", platform: "Linux", maxTouchPoints: 0 };
  globalThis.window = win;
  Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true, writable: true });
  globalThis.document = {
    createElement: element,
    querySelector() { return null; },
    getElementById() { return null; },
    addEventListener() {},
    readyState: "complete",
  };
  globalThis.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
  globalThis.history = { state: {}, replaceState() {} };
  return win;
}

function http(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function load() {
  loads += 1;
  return import(`../installchoice.js?case=${loads}`);
}

function fields(box) {
  const inputs = box.querySelectorAll("input").filter((node) => node.type === "text");
  return {
    start: inputs[0],
    name: inputs[1],
    hint: box.querySelectorAll("p")[0],
    button: box.querySelectorAll("button")[0],
  };
}

function type(start, value) {
  start.value = value;
  start.listeners.input();
}

test("a 404 or ok:false is unknown and stays cached, and any other failure is asked again", async () => {
  browser("https://onlyonhbar.com/");
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const start = new URL(url, "https://onlyonhbar.com").searchParams.get("start");
    if (start === "missing") return http(404, { ok: false, error: "unknown community" });
    if (start === "denied") return http(200, { ok: false });
    if (start === "down") return http(503, { ok: false, error: "busy" });
    if (start === "blip") throw new Error("network");
    if (start === "bad") return { status: 200, ok: true, json: async () => { throw new Error("bad json"); } };
    return http(200, { ok: true, start, name: start, label: "Web3Globe · " + start });
  };
  const { installTarget } = await load();

  assert.equal(await installTarget("missing"), null);
  assert.equal(await installTarget("missing"), null);
  assert.equal(calls.filter((url) => url.includes("start=missing")).length, 1);

  assert.equal(await installTarget("denied"), null);
  assert.equal(calls.filter((url) => url.includes("start=denied")).length, 1);

  assert.deepEqual(await installTarget("down"), { retry: true });
  assert.deepEqual(await installTarget("down"), { retry: true });
  assert.equal(calls.filter((url) => url.includes("start=down")).length, 2);

  assert.deepEqual(await installTarget("blip"), { retry: true });
  assert.deepEqual(await installTarget("blip"), { retry: true });
  assert.equal(calls.filter((url) => url.includes("start=blip")).length, 2);

  assert.deepEqual(await installTarget("bad"), { retry: true });
  const zagreb = await installTarget("zagreb");
  assert.equal(zagreb.ok, true);
  assert.equal(zagreb.label, "Web3Globe · zagreb");
});

test("typing a start, an unknown name, and a pick leave Install on the last good community", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const win = browser("https://onlyonhbar.com/zagreb");
  const calls = [];
  const pointed = [];
  const down = new Set(["zagreb"]);
  const missing = new Set();
  win.addEventListener("install-prompt-ready", () => pointed.push(true));
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (!text.includes("/api/install-target")) return http(200, {});
    const start = new URL(text, "https://onlyonhbar.com").searchParams.get("start");
    calls.push(start);
    if (down.has(start)) throw new Error("network");
    if (missing.has(start)) return http(404, { ok: false });
    const name = start === "zagreb" ? "Zagreb Club" : (start || "Web3Globe");
    return http(200, {
      ok: true,
      start: start || "",
      name,
      label: start ? "Web3Globe · " + start : "Web3Globe",
      picture: null,
    });
  };
  const { createInstallChoice } = await load();
  const box = createInstallChoice();
  const { start, name, hint, button } = fields(box);
  assert.equal(start.value, "zagreb");
  assert.equal(start.placeholder, "Web3Globe");
  assert.equal(start.className.includes("install-choice-input"), true);
  assert.equal(button.className, "follow-pick-btn");
  assert.equal(button.textContent, "👥");
  assert.equal(button["aria-label"], "Choose from following");
  assert.deepEqual(globalThis.__installSuggest.kinds, ["topics"]);
  assert.equal(box.hidden, true);

  await settle();
  assert.deepEqual(calls, ["zagreb"]);
  assert.equal(start.value, "zagreb");
  assert.equal(hint.hidden, false);
  assert.equal(hint.textContent, "Couldn't reach the server, trying again…");
  assert.equal(box.hidden, false);
  assert.equal(pointed.length, 0);

  down.delete("zagreb");
  t.mock.timers.tick(2999);
  assert.deepEqual(calls, ["zagreb"]);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(calls, ["zagreb", "zagreb"]);
  assert.equal(start.value, "Zagreb Club");
  assert.equal(start.placeholder, "Web3Globe");
  assert.equal(name.value, "Web3Globe · zagreb");
  assert.equal(name.placeholder, "Web3Globe · zagreb");
  assert.equal(hint.hidden, true);
  assert.equal(box.hidden, false);
  assert.equal(pointed.length, 1);

  down.add("split");
  type(start, "split");
  t.mock.timers.tick(400);
  await settle();
  assert.equal(start.value, "split");
  assert.equal(hint.textContent, "Couldn't reach the server, trying again…");
  assert.equal(name.value, "Web3Globe · zagreb");
  t.mock.timers.tick(3000);
  await settle();
  assert.deepEqual(calls.filter((item) => item === "split"), ["split", "split"]);
  t.mock.timers.tick(3000);
  await settle();
  assert.equal(calls.filter((item) => item === "split").length, 2);
  assert.equal(start.value, "split");
  assert.equal(hint.textContent, "Couldn't load that community. Install stays on Web3Globe · zagreb");
  assert.equal(name.value, "Web3Globe · zagreb");
  assert.equal(pointed.length, 1);

  down.add("osijek");
  type(start, "osijek");
  t.mock.timers.tick(400);
  await settle();
  assert.deepEqual(calls.filter((item) => item === "osijek"), ["osijek"]);
  type(start, "nope nope");
  t.mock.timers.tick(400);
  assert.equal(hint.textContent, "Not a valid community name");
  t.mock.timers.tick(3000);
  await settle();
  assert.deepEqual(calls.filter((item) => item === "osijek"), ["osijek"]);
  assert.equal(start.value, "nope nope");
  assert.equal(name.value, "Web3Globe · zagreb");
  assert.equal(pointed.length, 1);

  missing.add("gone");
  type(start, "Gone");
  t.mock.timers.tick(400);
  await settle();
  assert.equal(calls.at(-1), "gone");
  assert.equal(start.value, "Gone");
  assert.equal(hint.textContent, "No community called Gone, Install stays on Web3Globe · zagreb");
  assert.equal(name.value, "Web3Globe · zagreb");
  assert.equal(calls.includes(""), false);
  assert.equal(pointed.length, 1);

  type(start, "");
  t.mock.timers.tick(400);
  await settle();
  assert.equal(calls.at(-1), "");
  assert.equal(start.value, "");
  assert.equal(start.placeholder, "Web3Globe");
  assert.equal(name.value, "Web3Globe");
  assert.equal(hint.hidden, true);
  assert.equal(pointed.length, 2);

  start.value = "0.0.55";
  button.listeners.click();
  await settle();
  assert.equal(calls.at(-1), "0.0.55");
  assert.equal(start.value, "0.0.55");
  assert.equal(name.value, "Web3Globe · 0.0.55");
  assert.equal(hint.hidden, true);
  assert.equal(pointed.length, 3);

  start.value = "rijeka";
  start.listeners.keydown({ key: "Enter", defaultPrevented: false });
  await settle();
  assert.equal(start.blurred, true);
  assert.equal(calls.at(-1), "rijeka");
  assert.equal(start.value, "rijeka");
  assert.equal(name.value, "Web3Globe · rijeka");

  start.value = "pula";
  start.listeners.change();
  await settle();
  assert.equal(calls.at(-1), "pula");
  assert.equal(start.value, "pula");
  assert.equal(name.value, "Web3Globe · pula");
  assert.equal(pointed.length, 5);
});

test("the suggestion list and the Following picker open above the install intro", () => {
  const css = read("../style.css");
  const suggest = css.match(/\.follow-suggest \{[^}]*z-index:\s*(\d+)/);
  const picker = css.match(/\.picker-sheet \{[^}]*z-index:\s*(\d+)/);
  const intro = css.match(/\.onboard-overlay \{[^}]*z-index:\s*(\d+)/);
  assert.ok(suggest && picker && intro);
  assert.ok(Number(suggest[1]) > Number(intro[1]));
  assert.ok(Number(picker[1]) > Number(intro[1]));
  const startAt = css.indexOf(".install-choice-start {");
  const iconsAt = css.indexOf(".install-choice-icons {", startAt);
  assert.ok(startAt >= 0 && iconsAt > startAt);
  assert.equal(css.slice(startAt, iconsAt).includes("px"), false);
  assert.match(read("../followsuggest.js"), /export function bindPickButton\(button, input\)/);
  assert.match(read("../installchoice.js"), /class="install-choice-input install-choice-start-input"|install-choice-input install-choice-start-input/);
});
