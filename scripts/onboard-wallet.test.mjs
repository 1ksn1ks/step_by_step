// The intro's wallet button (onboarding.js). onboarding.js imports the map,
// so its functions are read from the source and run against small stand-ins,
// the way onboard-keyboard.test.mjs runs onboardCardLift.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// style.css has CRLF line ends in the working copy.
function source(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const page = source("../onboarding.js");
const css = source("../style.css");

// The whole `function name(...) { ... }` text.
function fn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const brace = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`no end for ${name}`);
}

// The CSS rule block that starts with this selector line.
function rule(selector) {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf("}", at) + 1);
}

function fakeNode(tag) {
  const node = {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    children: [],
    attrs: {},
    setAttribute(name, value) { node.attrs[name] = String(value); },
    replaceChildren(...kids) { node.children = kids; },
  };
  node.classList = {
    toggle(name, on) {
      const list = node.className.split(" ").filter(Boolean).filter((c) => c !== name);
      if (on) list.push(name);
      node.className = list.join(" ");
    },
    contains(name) { return node.className.split(" ").includes(name); },
  };
  return node;
}

// introAccount, connectFromIntro and paintIntroWallet with fakes for the
// page, web3.js's connectedAccount and the drawer's picture helpers.
function harness(options = {}) {
  const calls = { pictures: [], mounts: [], rings: [], picUrls: [] };
  const connect = options.noButton ? null : {
    skipOverlayClose: false,
    clicks: 0,
    seenSkip: [],
    click() {
      this.clicks += 1;
      this.seenSkip.push(this.skipOverlayClose);
      if (options.clickThrows) throw new Error("click failed");
    },
  };
  const document = {
    getElementById(id) { return id === "connect-wallet-btn" ? connect : null; },
    createElement: fakeNode,
  };
  const button = fakeNode("button");
  button.className = "onboard-wallet";
  const env = {
    document,
    walletBtn: button,
    DEFAULT_PIC: "/default.png",
    avatarSrc: (url) => `avatar:${url}`,
    profilePicUrl: (id) => {
      calls.picUrls.push(id);
      return `/pic/${id}`;
    },
    pictureElement: (url, opts) => {
      calls.pictures.push({ url, opts });
      const img = fakeNode("img");
      img.className = opts.className;
      return img;
    },
    mountPicture: (el, url, opts) => {
      calls.mounts.push({ el, url, opts });
      return el;
    },
    paintProfileAvatar: (el, id) => calls.rings.push({ el, id }),
  };
  const body = `
    let connectedAccount = env.connectedAccount;
    const { document, DEFAULT_PIC, avatarSrc, profilePicUrl, pictureElement, mountPicture, paintProfileAvatar } = env;
    let walletBtn = env.walletBtn;
    let walletFace = null;
    let walletId = null;
    ${fn(page, "introAccount")}
    ${fn(page, "connectFromIntro")}
    ${fn(page, "paintIntroWallet")}
    return {
      introAccount,
      connectFromIntro,
      paintIntroWallet,
      play(account) { connectedAccount = account; },
      drop() { walletBtn = null; },
    };
  `;
  env.connectedAccount = options.account === undefined ? null : options.account;
  const api = new Function("env", body)(env);
  return { api, button, connect, calls };
}

test("the account comes from connectedAccount when it is an account id", () => {
  const { api } = harness();
  for (const [value, want] of [
    ["0.0.4819119", "0.0.4819119"],
    [" 0.0.12 ", "0.0.12"],
    [null, ""],
    ["", ""],
    ["Not connected", ""],
    ["Connected ✓", ""],
    ["None", ""],
    ["0.0.x", ""],
    [`0.0.${"1".repeat(40)}`, ""],
  ]) {
    api.play(value);
    assert.equal(api.introAccount(), want, String(value));
  }
});

test("Connect clicks the hidden Connect with skipOverlayClose, then resets it", () => {
  const { api, connect } = harness();
  api.connectFromIntro();
  assert.equal(connect.clicks, 1);
  assert.deepEqual(connect.seenSkip, [true]);
  assert.equal(connect.skipOverlayClose, false);
  // A second tap clicks again: web3.js's connectFlight reopens the sheet.
  api.connectFromIntro();
  assert.equal(connect.clicks, 2);
  assert.deepEqual(connect.seenSkip, [true, true]);
  assert.equal(connect.skipOverlayClose, false);
});

test("a click that throws still resets skipOverlayClose, and no button is a no-op", () => {
  const broken = harness({ clickThrows: true });
  assert.throws(() => broken.api.connectFromIntro(), /click failed/);
  assert.equal(broken.connect.skipOverlayClose, false);
  const missing = harness({ noButton: true });
  assert.doesNotThrow(() => missing.api.connectFromIntro());
});

test("disconnected the button says Connect, connected it is the picture and id", () => {
  const { api, button, calls } = harness();
  api.paintIntroWallet();
  assert.equal(button.className, "onboard-wallet");
  assert.equal(button.attrs["aria-label"], "Connect wallet");
  assert.equal(button.children.length, 1);
  assert.equal(button.children[0].className, "onboard-wallet-text");
  assert.equal(button.children[0].textContent, "Connect");

  api.play("0.0.4819119");
  api.paintIntroWallet();
  assert.equal(button.classList.contains("is-connected"), true);
  assert.equal(button.attrs["aria-label"], "Wallet 0.0.4819119");
  assert.equal(button.children.length, 2);
  const [face, id] = button.children;
  assert.equal(face.className, "onboard-wallet-face");
  assert.equal(id.className, "onboard-wallet-id");
  assert.equal(id.textContent, "0.0.4819119");
  // The drawer account row's source: profilePicUrl through avatarSrc,
  // the default picture as fallback, and the early-hashinal ring.
  assert.deepEqual(calls.pictures.map((p) => p.url), ["avatar:/default.png"]);
  assert.equal(calls.pictures[0].opts.fallback, "/default.png");
  assert.equal(calls.pictures[0].opts.alt, "");
  assert.deepEqual(calls.picUrls, ["0.0.4819119"]);
  assert.equal(calls.mounts.at(-1).url, "avatar:/pic/0.0.4819119");
  assert.equal(calls.mounts.at(-1).opts.fallback, "/default.png");
  assert.deepEqual(calls.rings.map((r) => r.id), ["0.0.4819119"]);

  // profiles-loaded: the same chip, the picture painted again.
  api.paintIntroWallet();
  assert.equal(button.children[0], face);
  assert.equal(button.children[1], id);
  assert.equal(calls.pictures.length, 1);
  assert.equal(calls.mounts.length, 2);

  // Another account, then a disconnect.
  api.play("0.0.77");
  api.paintIntroWallet();
  assert.equal(id.textContent, "0.0.77");
  assert.equal(button.attrs["aria-label"], "Wallet 0.0.77");
  api.play(null);
  api.paintIntroWallet();
  assert.equal(button.classList.contains("is-connected"), false);
  assert.equal(button.attrs["aria-label"], "Connect wallet");
  assert.equal(button.children[0].textContent, "Connect");
});

test("a paint after the intro closed does nothing", () => {
  const { api, button } = harness();
  api.drop();
  assert.doesNotThrow(() => api.paintIntroWallet());
  assert.equal(button.children.length, 0);
});

test("build adds the button next to the ✕ and paints it; close takes it all back", () => {
  const build = fn(page, "build");
  const skipAt = build.indexOf("card.appendChild(skip);");
  const walletAt = build.indexOf("walletBtn = document.createElement('button');");
  const appendAt = build.indexOf("card.appendChild(walletBtn);");
  const contentAt = build.indexOf("const content = document.createElement('div');");
  assert.ok(skipAt > 0 && walletAt > skipAt && appendAt > walletAt && contentAt > appendAt);
  const click = build.slice(walletAt, appendAt);
  assert.match(click, /walletBtn\.type = 'button';/);
  assert.match(click, /walletBtn\.className = 'onboard-wallet';/);
  assert.match(click, /e\.stopPropagation\(\);\s*if \(introAccount\(\)\) return;\s*connectFromIntro\(\);/);
  // Opened: the html class, the listeners, the first paint.
  assert.match(build, /document\.documentElement\.classList\.add\('intro-open'\);\s*bindIntroWallet\(\);\s*paintIntroWallet\(\);/);

  const close = fn(page, "closeOnboarding");
  assert.match(close, /unbindIntroWallet\(\);/);
  assert.match(close, /document\.documentElement\.classList\.remove\('intro-open'\);/);
  assert.ok(close.indexOf("unbindIntroWallet();") < close.indexOf("overlay = null;"));
  const unbind = fn(page, "unbindIntroWallet");
  assert.match(unbind, /removeEventListener\('wallet-account-changed', paintIntroWallet\)/);
  assert.match(unbind, /removeEventListener\('profiles-loaded', paintIntroWallet\)/);
  const bind = fn(page, "bindIntroWallet");
  assert.match(bind, /addEventListener\('wallet-account-changed', paintIntroWallet\)/);
  assert.match(bind, /addEventListener\('profiles-loaded', paintIntroWallet\)/);

  // The existing connect flow only; nothing that moves the intro.
  assert.equal(page.includes("openDrawerConnect"), false);
  assert.equal(page.includes("dAppConnector"), false);
  assert.match(page, /import \{ connectedAccount \} from '\.\/web3\.js';/);
  const paint = fn(page, "paintIntroWallet");
  assert.doesNotMatch(paint, /slideIndex|renderSlide|closeOnboarding|installChoice/);
  assert.doesNotMatch(fn(page, "connectFromIntro"), /slideIndex|renderSlide|closeOnboarding/);
  // The swap and inscribe cards share the card classes, not this button.
  assert.equal(source("../swapwarning.js").includes("onboard-wallet"), false);
  assert.equal(source("../hcs1inscribenotice.js").includes("onboard-wallet"), false);
});

test("the button wears the ✕'s look top left, and the ✕ is unchanged", () => {
  assert.equal(rule(".onboard-skip"), `.onboard-skip {
    position: absolute;
    top: 0.6vh;
    right: 0.6vh;
    min-width: 5vh;
    min-height: 5vh;
    padding: 0.5vh 1vh;
    background: rgba(255, 255, 255, 0.08);
    border: 0.2vh solid rgba(34, 211, 238, 0.6);
    box-shadow: 0 0 1vh rgba(34, 211, 238, 0.5),
                inset 0 0 0.6vh rgba(34, 211, 238, 0.25);
    border-radius: 50%;
    color: white;
    font-size: 2.4vh;
    line-height: 1;
    cursor: pointer;
    opacity: 0.8;
    animation: overlayXGlow 2s ease-in-out infinite;
  }`);
  const wallet = rule(".onboard-wallet");
  for (const line of [
    "position: absolute;",
    "top: 0.6vh;",
    "left: 0.6vh;",
    "min-height: 5vh;",
    "max-width: min(40%, calc(50% - 12.8vh));",
    "padding: 0.5vh 1.2vh;",
    "background: rgba(255, 255, 255, 0.08);",
    "border: 0.2vh solid rgba(34, 211, 238, 0.6);",
    "border-radius: 999em;",
    "opacity: 0.8;",
    "animation: overlayXGlow 2s ease-in-out infinite;",
    "font-size: clamp(1.4vh, calc(11.4vw - 3.4vh), 2.4vh);",
  ]) {
    assert.ok(wallet.includes(line), line);
  }
  assert.equal(wallet.includes("right:"), false);
  const start = css.indexOf("/* The intro's wallet button");
  const end = css.indexOf(".onboard-icon {", start);
  assert.ok(start > 0 && end > start);
  const block = css.slice(start, end);
  assert.equal(/\dpx/.test(block), false);
  assert.match(block, /\.onboard-wallet-text,\s*\.onboard-wallet-id \{[^}]*text-overflow: ellipsis;/);
  assert.match(block, /\.onboard-wallet-id \{\s*direction: rtl;/);
});

test("the wallet sheet sits above the intro only while it is open", () => {
  const lifted = rule("html.intro-open wcm-modal,\nhtml.intro-open w3m-modal,\nhtml.intro-open appkit-modal");
  assert.match(lifted, /position: relative;/);
  assert.match(lifted, /z-index: 9100;/);
  assert.match(lifted, /--wcm-z-index: 9100;/);
  assert.equal(rule("html.feed-app wcm-modal,\nhtml.feed-app w3m-modal,\nhtml.feed-app appkit-modal"), `html.feed-app wcm-modal,
html.feed-app w3m-modal,
html.feed-app appkit-modal {
  position: relative;
  z-index: 9100;
}`);
  // Above the intro (9000), below the toasts (10000).
  assert.match(rule(".onboard-overlay"), /z-index: 9000;/);
});
