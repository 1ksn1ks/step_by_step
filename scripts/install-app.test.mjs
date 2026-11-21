// What the page installs (installapp.js): a community link links its
// community's manifest from the start, the install screen points it at a
// choice, Chrome's old install dialog is never used for a new manifest,
// iPhone gets the title, icon and URL it saves, and an installed app keeps
// the manifest it was installed with. Each case loads the module fresh in a
// small fake browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const IN_APP = `${IPHONE} Instagram 300.0`;

class FakeTag {
  constructor(attrs) { this.attrs = { ...attrs }; }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
}

let loads = 0;
async function load({ href = "https://onlyonhbar.com/", ua = ANDROID, standalone = false, saved = null, chromium = true } = {}) {
  const head = {
    manifest: new FakeTag({ rel: "manifest", href: "/manifest.webmanifest" }),
    apple: new FakeTag({ rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" }),
    title: new FakeTag({ name: "apple-mobile-web-app-title", content: "Web3Globe" }),
  };
  const store = new Map();
  if (saved) store.set("meritocracy-install-manifests", JSON.stringify(saved));
  const replaced = [];
  const ready = [];
  const win = new EventTarget();
  win.location = new URL(href);
  if (chromium) win.onbeforeinstallprompt = null;
  win.matchMedia = (query) => ({ matches: standalone && query.includes("standalone") });
  win.navigator = { userAgent: ua, platform: /iPhone/.test(ua) ? "iPhone" : "Linux", maxTouchPoints: 5 };
  win.addEventListener("install-prompt-ready", () => ready.push(head.manifest.getAttribute("href")));
  globalThis.window = win;
  Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true, writable: true });
  globalThis.document = {
    querySelector(selector) {
      if (selector === 'link[rel="manifest"]') return head.manifest;
      if (selector === 'link[rel="apple-touch-icon"]') return head.apple;
      if (selector === 'meta[name="apple-mobile-web-app-title"]') return head.title;
      return null;
    },
  };
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.history = {
    state: { layer: "feed" },
    replaceState(state, _title, url) {
      replaced.push([state, url]);
      win.location = new URL(url, win.location.href);
    },
  };
  loads += 1;
  const mod = await import(`../installapp.js?case=${loads}`);
  const offer = (outcome = "accepted") => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => ({ outcome });
    win.dispatchEvent(event);
    return event;
  };
  return { mod, head, store, replaced, ready, win, offer, href: () => head.manifest.getAttribute("href") };
}

test("the default page at / installs exactly as before", async () => {
  for (const href of ["https://onlyonhbar.com/", "https://onlyonhbar.com/0.0.9609912", "https://onlyonhbar.com/?topic=0.0.9609912", "https://onlyonhbar.com/a%20b"]) {
    const page = await load({ href });
    assert.equal(page.href(), "/manifest.webmanifest", href);
    assert.equal(page.head.title.getAttribute("content"), "Web3Globe", href);
    assert.equal(page.head.apple.getAttribute("href"), "/icons/apple-touch-icon.png", href);
  }
});

test("a community link links that community's manifest from the start, so the browser's own Install makes it", async () => {
  const zagreb = await load({ href: "https://onlyonhbar.com/Zagreb?x=1" });
  assert.equal(zagreb.href(), "/manifest.webmanifest?start=zagreb");
  assert.equal(zagreb.head.title.getAttribute("content"), "Web3Globe · zagreb");
  const older = await load({ href: "https://onlyonhbar.com/?topic=0.0.77" });
  assert.equal(older.href(), "/manifest.webmanifest?start=0.0.77");
  // Linked before any dialog: nothing to wait for.
  assert.equal(zagreb.mod.installPromptPending(), false);
  assert.equal(zagreb.replaced.length, 0, "the address is not touched on load");
});

test("a new choice drops Chrome's dialog for the old manifest and waits for the new one", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = await load();
  const first = page.offer();
  assert.equal(first.defaultPrevented, true);
  assert.equal(page.mod.canPromptInstall(), true);

  page.mod.pointInstall({ start: "zagreb", label: "Zagreb Club", icon: "pic", title: "Zagreb Club", appleIcon: "/icons/community/zagreb/k/apple-touch-icon.png" });
  assert.equal(page.href(), "/manifest.webmanifest?start=zagreb&n=Zagreb+Club&icon=pic");
  assert.equal(page.mod.canPromptInstall(), false, "the old dialog would install the old app");
  assert.equal(page.mod.installPromptPending(), true);
  assert.equal(page.head.title.getAttribute("content"), "Zagreb Club");
  assert.equal(page.head.apple.getAttribute("href"), "/icons/community/zagreb/k/apple-touch-icon.png");
  assert.equal(await page.mod.runInstallPrompt(), false, "nothing to open yet");

  page.offer();
  assert.equal(page.mod.canPromptInstall(), true);
  assert.equal(page.mod.installPromptPending(), false);

  // The same choice again changes nothing and keeps the dialog.
  page.mod.pointInstall({ start: "zagreb", label: "Zagreb Club", icon: "pic" });
  assert.equal(page.mod.canPromptInstall(), true);

  // Back to the default; Chrome says nothing (that app is installed, say).
  page.mod.pointInstall({});
  assert.equal(page.href(), "/manifest.webmanifest");
  assert.equal(page.head.title.getAttribute("content"), "Web3Globe");
  assert.equal(page.head.apple.getAttribute("href"), "/icons/apple-touch-icon.png");
  assert.equal(page.mod.installPromptPending(), true);
  const before = page.ready.length;
  t.mock.timers.tick(6000);
  assert.equal(page.mod.installPromptPending(), false);
  assert.equal(page.ready.length, before + 1, "the screen is told to stop waiting");
});

test("a browser without install dialogs never waits", async () => {
  const page = await load({ ua: IPHONE, chromium: false });
  page.mod.pointInstall({ start: "zagreb" });
  assert.equal(page.href(), "/manifest.webmanifest?start=zagreb");
  assert.equal(page.mod.installPromptPending(), false);
});

test("iPhone saves the page it is on: the address becomes the choice's own link", async () => {
  const phone = await load({ href: "https://onlyonhbar.com/?topic=0.0.77#x", ua: IPHONE, chromium: false });
  phone.mod.keepUrlForInstall("0.0.77");
  assert.deepEqual(phone.replaced, [[{ layer: "feed" }, "/0.0.77"]], "the history state is kept");
  phone.mod.keepUrlForInstall("0.0.77");
  assert.equal(phone.replaced.length, 1, "already there");
  phone.mod.keepUrlForInstall("");
  assert.deepEqual(phone.replaced.at(-1), [{ layer: "feed" }, "/"]);
  phone.mod.keepUrlForInstall("klub-žuto");
  assert.deepEqual(phone.replaced.at(-1), [{ layer: "feed" }, "/klub-%C5%BEuto"]);
  const android = await load({ href: "https://onlyonhbar.com/?topic=0.0.77" });
  android.mod.keepUrlForInstall("zagreb");
  assert.deepEqual(android.replaced, [], "Chrome installs the manifest's start_url");
});

test("an installed app keeps the manifest it was installed with, so its name is not taken back", async () => {
  const page = await load({ href: "https://onlyonhbar.com/zagreb" });
  page.mod.pointInstall({ start: "zagreb", label: "Club", icon: "pic" });
  page.offer("accepted");
  assert.equal(await page.mod.runInstallPrompt(), true);
  const saved = JSON.parse(page.store.get("meritocracy-install-manifests"));
  assert.deepEqual(saved, { "/zagreb": "/manifest.webmanifest?start=zagreb&n=Club&icon=pic" });

  // The browser's own Install (menu, address bar) is remembered too.
  const own = await load({ href: "https://onlyonhbar.com/" });
  own.mod.pointInstall({ label: "My map" });
  own.win.dispatchEvent(new Event("appinstalled"));
  assert.deepEqual(JSON.parse(own.store.get("meritocracy-install-manifests")), { "/": "/manifest.webmanifest?n=My+map" });

  const app = await load({ href: "https://onlyonhbar.com/zagreb", standalone: true, saved });
  assert.equal(app.href(), "/manifest.webmanifest?start=zagreb&n=Club&icon=pic");
  const home = await load({ href: "https://onlyonhbar.com/", standalone: true, saved: { "/": "/manifest.webmanifest?n=My+map" } });
  assert.equal(home.href(), "/manifest.webmanifest?n=My+map");
  // Only a manifest of this site; and a browser tab ignores it.
  const odd = await load({ href: "https://onlyonhbar.com/zagreb", standalone: true, saved: { "/zagreb": "https://evil.example/m.json" } });
  assert.equal(odd.href(), "/manifest.webmanifest?start=zagreb");
  const tab = await load({ href: "https://onlyonhbar.com/zagreb", saved });
  assert.equal(tab.href(), "/manifest.webmanifest?start=zagreb");
});

test("the install screen asks for a start only where this browser can install", async () => {
  const cases = [[ANDROID, undefined], [IPHONE, undefined], [IN_APP, false], [FIREFOX, false]];
  for (const [ua, choose] of cases) {
    const page = await load({ ua, chromium: ua === ANDROID });
    assert.equal(page.mod.installSteps().choose, choose, ua);
  }
});

test("the install screen shows Start in above the steps and waits, greyed, for a new dialog", () => {
  const onboarding = read("../onboarding.js");
  assert.match(onboarding, /if \(slide\.install && guide\.choose !== false\) \{\s*if \(!installChoice\) installChoice = createInstallChoice\(\);\s*rowsEl\.appendChild\(installChoice\);\s*\}\s*renderGuide\(guide\);/);
  assert.match(onboarding, /const waiting = !prompt && installPromptPending\(\);/);
  assert.match(onboarding, /installBtn\.disabled = waiting;/);
  assert.match(onboarding, /installBtn\.textContent = waiting \? 'Getting ready…' : 'Install';/);
  const choice = read("../installchoice.js");
  // Each change points the install at the choice; on iPhone the address too.
  assert.match(choice, /pointInstall\(\{\s*start: current\.start,\s*label: typed && typed !== current\.label \? typed : '',\s*icon: usePicture \? ICON_PIC : '',/);
  assert.match(choice, /keepUrlForInstall\(current\.start\);/);
  // Start in: this link, typed or picked from topics you follow.
  assert.match(choice, /startInput\.placeholder = 'Web3Globe';\s*startInput\.value = linkStart;\s*choose\(linkStart\);/);
  assert.match(choice, /attachFollowSuggest\(startInput, \{\s*kinds: \['topics'\],\s*submit: submitStart,?\s*\}\);\s*bindPickButton\(pickBtn, startInput\);/);
  assert.doesNotMatch(choice, /addFollowed|install-choice-select|fetchFollowing/);
  assert.match(choice, /\/api\/install-target\?start=/);
  assert.match(choice, /input\.maxLength = LABEL_MAX;/);
});
