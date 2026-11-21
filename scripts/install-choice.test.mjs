// A blip on /api/install-target must not drop the install onto the default
// community. A 404 or {ok:false} still does.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// createInstallChoice loads the wallet module only to read the account.
// The real one opens a WalletConnect session, so the test answers with none.
const web3Stub = "data:text/javascript," + encodeURIComponent("export const connectedAccount = null;\n");
const toastStub = "data:text/javascript," + encodeURIComponent(
  "export const toast = { info(msg) { globalThis.__installToasts.push(['info', msg]); }, error(msg) { globalThis.__installToasts.push(['error', msg]); } };\n",
);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL && context.parentURL.includes("/installchoice.js")) {
      if (specifier === "./web3.js") return { url: web3Stub, shortCircuit: true };
      if (specifier === "./toast.js") return { url: toastStub, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

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

test("a blip keeps the community selected and tries once more, and a real unknown falls back", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  browser("https://onlyonhbar.com/zagreb");
  const calls = [];
  let mode = "blip";
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (!text.includes("/api/install-target")) return http(200, {});
    const start = new URL(text, "https://onlyonhbar.com").searchParams.get("start");
    calls.push(start);
    if (mode === "blip" && start === "zagreb") throw new Error("network");
    if (mode === "again" && start === "split") throw new Error("network");
    if (mode === "missing" && start === "gone") return http(404, { ok: false });
    return http(200, {
      ok: true,
      start: start || "",
      name: start || "Web3Globe",
      label: start ? "Web3Globe · " + start : "Web3Globe",
      picture: null,
    });
  };
  globalThis.__installToasts = [];
  const { createInstallChoice } = await load();
  const box = createInstallChoice();
  const select = box.querySelectorAll("select")[0];
  await settle();
  assert.deepEqual(calls, ["zagreb"]);
  assert.equal(select.value, "zagreb");
  assert.equal(box.hidden, true);
  assert.equal(select.querySelectorAll("option").some((option) => option.value === "zagreb"), true);
  assert.deepEqual(globalThis.__installToasts, [["info", "Couldn't reach the server, trying again…"]]);

  mode = "ok";
  t.mock.timers.tick(2999);
  assert.deepEqual(calls, ["zagreb"]);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(calls, ["zagreb", "zagreb"]);
  assert.equal(box.hidden, false);
  assert.equal(select.value, "zagreb");

  const split = element("option");
  split.value = "split";
  split.textContent = "split";
  select.appendChild(split);
  mode = "again";
  select.value = "split";
  select.listeners.change();
  await settle();
  assert.equal(select.value, "split");
  assert.equal(box.hidden, false);
  assert.equal(select.querySelectorAll("option").some((option) => option.value === "split"), true);
  assert.deepEqual(globalThis.__installToasts.at(-1), ["info", "Couldn't reach the server, trying again…"]);
  t.mock.timers.tick(3000);
  await settle();
  assert.deepEqual(calls.filter((start) => start === "split"), ["split", "split"]);
  t.mock.timers.tick(3000);
  await settle();
  assert.equal(calls.filter((start) => start === "split").length, 2);
  assert.equal(select.value, "zagreb");
  assert.deepEqual(globalThis.__installToasts.at(-1), ["error", "Couldn't load that community. Install stays on Web3Globe · zagreb."]);

  const gone = element("option");
  gone.value = "gone";
  gone.textContent = "gone";
  select.appendChild(gone);
  mode = "missing";
  select.value = "gone";
  select.listeners.change();
  await settle();
  assert.equal(select.querySelectorAll("option").some((option) => option.value === "gone"), false);
  assert.equal(select.querySelectorAll("option").some((option) => option.value === "zagreb"), true);
  assert.equal(select.value, "");
  assert.equal(calls.at(-1), "");
});
