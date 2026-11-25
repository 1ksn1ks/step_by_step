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
    parentNode: null,
    style: {
      props: {},
      setProperty(name, value) { this.props[name] = String(value); },
    },
    setAttribute(name, value) { node.attrs[name] = String(value); },
    replaceChildren(...kids) {
      for (const kid of node.children) kid.parentNode = null;
      node.children = kids;
      for (const kid of kids) kid.parentNode = node;
    },
    appendChild(kid) {
      node.children.push(kid);
      kid.parentNode = node;
      return kid;
    },
    insertBefore(kid, before) {
      const at = node.children.indexOf(before);
      node.children.splice(at < 0 ? node.children.length : at, 0, kid);
      kid.parentNode = node;
      return kid;
    },
    remove() {
      const parent = node.parentNode;
      if (!parent) return;
      parent.children = parent.children.filter((kid) => kid !== node);
      node.parentNode = null;
    },
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
    // profileface.js profileUsername: "" when the account has no name.
    names: {},
    profileUsername: (id) => env.names[id] || "",
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
    const { document, DEFAULT_PIC, avatarSrc, profilePicUrl, profileUsername, pictureElement, mountPicture, paintProfileAvatar } = env;
    let walletBtn = env.walletBtn;
    let walletFace = null;
    let walletCopy = null;
    let walletName = null;
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
  return { api, button, connect, calls, names: env.names };
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
  const [face, copy] = button.children;
  assert.equal(face.className, "onboard-wallet-face");
  assert.equal(copy.className, "onboard-wallet-copy");
  // No name: the id alone, whole.
  assert.equal(copy.children.length, 1);
  const [id] = copy.children;
  assert.equal(id.className, "onboard-wallet-id");
  assert.equal(id.textContent, "0.0.4819119");
  assert.equal(id.style.props["--wallet-id-chars"], "11");
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
  assert.equal(button.children[1], copy);
  assert.equal(copy.children[0], id);
  assert.equal(calls.pictures.length, 1);
  assert.equal(calls.mounts.length, 2);

  // Another account, then a disconnect.
  api.play("0.0.77");
  api.paintIntroWallet();
  assert.equal(id.textContent, "0.0.77");
  assert.equal(id.style.props["--wallet-id-chars"], "6");
  assert.equal(button.attrs["aria-label"], "Wallet 0.0.77");
  api.play(null);
  api.paintIntroWallet();
  assert.equal(button.classList.contains("is-connected"), false);
  assert.equal(button.attrs["aria-label"], "Connect wallet");
  assert.equal(button.children[0].textContent, "Connect");
});

test("a profile name sits over the full id; without one the id stands alone", () => {
  const { api, button, names } = harness({ account: "0.0.9779355" });
  names["0.0.9779355"] = "Bonic";
  api.paintIntroWallet();
  const copy = button.children[1];
  assert.deepEqual(copy.children.map((kid) => kid.className), ["onboard-wallet-name", "onboard-wallet-id"]);
  const [name, id] = copy.children;
  assert.equal(name.textContent, "Bonic");
  assert.equal(id.textContent, "0.0.9779355", "the whole id, not the tail");
  assert.equal(button.attrs["aria-label"], "Wallet Bonic 0.0.9779355");

  // A new name (profiles-loaded) updates the same node.
  names["0.0.9779355"] = "Bonic B";
  api.paintIntroWallet();
  assert.equal(copy.children[0], name);
  assert.equal(name.textContent, "Bonic B");
  assert.equal(button.attrs["aria-label"], "Wallet Bonic B 0.0.9779355");

  // The name gone: no empty node and no "Anonymous", just the id.
  delete names["0.0.9779355"];
  api.paintIntroWallet();
  assert.deepEqual(copy.children.map((kid) => kid.className), ["onboard-wallet-id"]);
  assert.equal(copy.children[0], id);
  assert.equal(button.attrs["aria-label"], "Wallet 0.0.9779355");
  const texts = [];
  const walk = (node) => { texts.push(node.textContent); node.children.forEach(walk); };
  walk(button);
  assert.equal(texts.some((text) => /Anonymous/.test(text)), false);

  // And back, still above the id.
  names["0.0.9779355"] = "Bonic";
  api.paintIntroWallet();
  assert.deepEqual(copy.children.map((kid) => kid.className), ["onboard-wallet-name", "onboard-wallet-id"]);
  // The name comes from profileUsername, never profileDisplayName.
  const paint = fn(page, "paintIntroWallet");
  assert.match(paint, /profileUsername\(id\)/);
  assert.equal(paint.includes("profileDisplayName"), false);
  assert.match(page, /import \{ DEFAULT_PIC, profilePicUrl, profileUsername \} from '\.\/profileface\.js';/);
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
  // "Connect" keeps its one clipped line.
  assert.match(rule(".onboard-wallet-text"), /text-overflow: ellipsis;/);
  assert.match(rule(".onboard-wallet-text"), /white-space: nowrap;/);
});

test("connected, the chip stacks a bold name over a muted id that is never clipped", () => {
  const connected = rule(".onboard-wallet.is-connected");
  assert.match(connected, /white-space: normal;/);
  assert.match(connected, /align-items: center;/);
  assert.equal(/max-width|min-height/.test(connected), false, "the cap and min-height stay the base rule's");
  const copy = rule(".onboard-wallet-copy");
  assert.match(copy, /display: flex;/);
  assert.match(copy, /flex-direction: column;/);
  assert.match(copy, /min-width: 0;/);
  assert.match(copy, /gap: 0\.2em;/);
  const name = rule(".onboard-wallet-name");
  for (const line of ["color: #fff;", "font-weight: 700;", "white-space: nowrap;", "text-overflow: ellipsis;", "overflow: hidden;"]) {
    assert.ok(name.includes(line), line);
  }
  const id = rule(".onboard-wallet-id");
  assert.match(id, /color: rgba\(255, 255, 255, 0\.55\);/);
  assert.match(id, /font-weight: 500;/);
  assert.match(id, /white-space: nowrap;/);
  // Never clipped: no rtl, no ellipsis, no hidden overflow anywhere it is styled.
  for (const at of [...css.matchAll(/\.onboard-wallet-id[^{]*\{[^}]*\}/g)].map((m) => m[0])) {
    assert.equal(/direction:|text-overflow|overflow:/.test(at), false, at);
  }
  // It shrinks to fit the cap instead: smaller than the name at most.
  assert.match(id, /font-size: min\(0\.7em, calc\(\(var\(--wallet-cap, 100vh\) - 6vh\) \/ \(var\(--wallet-id-chars, 13\) \* 0\.6\)\)\);/);
  assert.match(name, /font-size: 0\.8em;/);
});

test("the chip's room matches its cap: 40% / 50% less 12.8vh, and 46% / 50% less 6vh on the install page", () => {
  // The % read the card's padding box: its content (100cqi) plus 3vh a side.
  const card = rule(".onboard-card");
  assert.match(card, /padding: 4vh 3vh 3vh;/);
  assert.equal(card.includes("container-type"), false, "the shared card (swap, inscribe) is no container");
  assert.match(rule("#onboard-overlay .onboard-card"), /container-type: inline-size;/);
  assert.match(rule(".onboard-wallet"), /max-width: min\(40%, calc\(50% - 12\.8vh\)\);/);
  assert.match(rule(".onboard-wallet.is-connected"), /--wallet-cap: min\(calc\(40cqi \+ 2\.4vh\), calc\(50cqi - 9\.8vh\)\);/);
  const guide = rule(".onboard-card.is-guide > .onboard-wallet.is-connected");
  assert.match(guide, /max-width: min\(46%, calc\(50% - 6vh\)\);/);
  assert.match(guide, /--wallet-cap: min\(calc\(46cqi \+ 2\.76vh\), calc\(50cqi - 3vh\)\);/);
  // 40% of (100cqi + 6vh) = 40cqi + 2.4vh, 50% of it less 12.8vh = 50cqi - 9.8vh;
  // 46% = 46cqi + 2.76vh, 50% less 6vh = 50cqi - 3vh.
  const pct = (p, vh) => [p, (p * 6) / 100 - vh];
  assert.deepEqual(pct(40, 0), [40, 2.4]);
  assert.deepEqual(pct(50, 12.8).map((n) => +n.toFixed(2)), [50, -9.8]);
  assert.deepEqual(pct(46, 0).map((n) => +n.toFixed(2)), [46, 2.76]);
  assert.deepEqual(pct(50, 6), [50, -3]);
  // The 6vh the id's room leaves out: border 0.2vh a side, padding 0.5vh
  // + 1vh, the 3.4vh picture and the 0.5vh gap (5.8vh, with 0.2vh to spare).
  assert.match(rule(".onboard-wallet.is-connected"), /padding: 0\.5vh 1vh 0\.5vh 0\.5vh;/);
  assert.match(rule(".onboard-wallet.is-connected"), /gap: 0\.5vh;/);
  assert.match(rule(".onboard-wallet-face"), /width: 3\.4vh;/);
  assert.match(rule(".onboard-wallet"), /border: 0\.2vh solid/);
});

test("on a narrow portrait card the picture stacks above the name and the whole id", () => {
  const open = "@media (orientation: portrait) {\n    @container (width < calc(31.6vh + 8em)) {";
  const at = css.indexOf(open);
  assert.ok(at > 0, "portrait only, and only while the card is narrow");
  const block = css.slice(at, css.indexOf("\n  }\n", at) + 4);
  assert.equal(/\dpx/.test(block), false);
  // Only the connected chip, and not on the install page.
  const selectors = [...block.matchAll(/^\s*([^{}\n]+) \{$/gm)].map((m) => m[1].trim()).filter((s) => !s.startsWith("@"));
  assert.deepEqual(selectors, [
    ".onboard-card:not(.is-guide) > .onboard-wallet.is-connected",
    ".onboard-card:not(.is-guide) > .onboard-wallet.is-connected .onboard-wallet-copy",
    ".onboard-card:not(.is-guide) > .onboard-wallet.is-connected .onboard-wallet-id",
  ]);
  const chip = rule(".onboard-card:not(.is-guide) > .onboard-wallet.is-connected");
  assert.match(chip, /flex-direction: column;/);
  assert.match(chip, /padding: 0\.6vh;/);
  assert.match(chip, /border-radius: 2vh;/, "the card's corners: a pill's round ends would cut the text");
  assert.equal(/max-width|min-height|--wallet-cap/.test(chip), false, "the same cap and min-height");
  assert.match(rule(".onboard-card:not(.is-guide) > .onboard-wallet.is-connected .onboard-wallet-copy"), /align-items: center;/);
  // The id's room is now the chip's whole width inside the cap: 0.2vh of
  // border and 0.6vh of padding a side.
  assert.match(
    rule(".onboard-card:not(.is-guide) > .onboard-wallet.is-connected .onboard-wallet-id"),
    /font-size: min\(0\.7em, calc\(\(var\(--wallet-cap, 100vh\) - 1\.6vh\) \/ \(var\(--wallet-id-chars, 13\) \* 0\.6\)\)\);/,
  );
  assert.equal(+(0.2 * 2 + 0.6 * 2).toFixed(2), 1.6);
});

test("the stacking threshold: beside the picture the id would get under 4em", () => {
  // Beside the picture the id's room is the cap less 6vh:
  // (50% of the padding box - 12.8vh) - 6vh = 50cqi + 3vh - 18.8vh = 50cqi - 15.8vh.
  // Under 4em when the content (100cqi) is under 31.6vh + 8em.
  const stacks = ({ content, vh, em, portrait }) => portrait && content < 31.6 * vh + 8 * em;
  const room = ({ content, vh }) => content / 2 - 15.8 * vh;
  // The intro card on the screens it was checked on (content px, 1vh px, card em px).
  const screens = {
    phone: { content: 335.4, vh: 8.44, em: 16, portrait: true },
    iphoneSE: { content: 323, vh: 6.67, em: 16, portrait: true },
    phoneLandscape: { content: 249.6, vh: 3.9, em: 16, portrait: false },
    pcLandscape: { content: 691.2, vh: 10.8, em: 16, portrait: false },
    portraitMonitor: { content: 928.8, vh: 19.2, em: 16, portrait: true },
  };
  const stacked = Object.entries(screens).filter(([, s]) => stacks(s)).map(([name]) => name);
  assert.deepEqual(stacked, ["phone", "iphoneSE"]);
  for (const [name, s] of Object.entries(screens)) {
    assert.equal(room(s) < 4 * s.em, stacks(s) || !s.portrait && room(s) < 4 * s.em, name);
  }
  // Stacked on the phone, the 11-character id gets about 11px.
  const phone = screens.phone;
  const cap = phone.content / 2 + 3 * phone.vh - 12.8 * phone.vh;
  const idPx = Math.min(0.7 * 15.76, (cap - 1.6 * phone.vh) / (11 * 0.6));
  assert.ok(idPx > 10.5 && idPx < 11.1, String(idPx));
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

test("the chip shows on the first page only: hidden elsewhere, its box kept so nothing moves", () => {
  const page = source("../onboarding.js");
  // renderSlide sets the class from slideIndex, beside .is-guide.
  const render = fn(page, "renderSlide");
  assert.match(render, /const card = overlay\.querySelector\('\.onboard-card'\);\s*card\.classList\.toggle\('is-guide', !!guide\);[\s\S]{0,200}?card\.classList\.toggle\('is-wallet-slide', slideIndex === 0\);/);
  // Nothing else sets it: only a slide change does.
  assert.equal(page.split("is-wallet-slide").length - 1, 1);
  assert.equal(render.split("is-wallet-slide").length - 1, 1);
  // The paint still knows nothing of the slides.
  assert.doesNotMatch(fn(page, "paintIntroWallet"), /slideIndex|renderSlide|is-wallet-slide/);
  // Hidden, not removed: the chip is absolute, so the icon, title, steps,
  // dots and nav stay where they are; no px.
  const hide = rule(".onboard-card:not(.is-wallet-slide) > .onboard-wallet");
  assert.equal(hide, `.onboard-card:not(.is-wallet-slide) > .onboard-wallet {
    visibility: hidden;
    pointer-events: none;
  }`);
  assert.match(rule(".onboard-wallet"), /^\.onboard-wallet \{\n    position: absolute;/);
  assert.doesNotMatch(hide, /display|px/);
  // The connected chip's own rules are as they were.
  assert.ok(css.includes(".onboard-card:not(.is-guide) > .onboard-wallet.is-connected {"));
});
