// Following is accounts plus topics. No reply stays on an en dash.
// A real 0 is painted only when the lists came back empty.
// The feed profile no longer repeats the account id in its own row.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const stub = (source) => "data:text/javascript," + encodeURIComponent(source);
registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL || "";
    if (!parent.includes("/profilestats.js")) return next(specifier, context);
    if (specifier === "./msgbackend.js") {
      return {
        url: stub(
          "export const BACKEND_URL = 'https://backend.test';\n" +
          "export function fetchFollowing(account) {\n" +
          "  const job = { account };\n" +
          "  job.done = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });\n" +
          "  globalThis.__followJobs.push(job);\n" +
          "  return job.done;\n" +
          "}\n",
        ),
        shortCircuit: true,
      };
    }
    if (specifier === "./followtopic.js") {
      return {
        url: stub(
          "export function cachedPersonFollow() { return globalThis.__knownFollow || null; }\n" +
          "export function readPersonFollow() { return Promise.resolve(globalThis.__readFollow || null); }\n",
        ),
        shortCircuit: true,
      };
    }
    if (specifier === "./earlyhashinal.js") {
      return { url: stub("export function earlyHashinalNumber() { return 0; }\n"), shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function element() {
  const names = new Set();
  const attrs = {};
  return {
    className: "",
    textContent: "",
    isConnected: true,
    dataset: {},
    children: [],
    attrs,
    // As in a browser: the title property is the title attribute.
    get title() { return this.getAttribute("title") || ""; },
    set title(value) { this.setAttribute("title", value); },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    removeAttribute(name) { delete attrs[name]; },
    classList: {
      toggle(name, on) {
        const next = on === undefined ? !names.has(name) : !!on;
        if (next) names.add(name);
        else names.delete(name);
      },
      contains(name) { return names.has(name); },
    },
    append(...kids) {
      for (const kid of kids) this.children.push(kid);
    },
    replaceChildren() { this.children = []; },
  };
}

function browser() {
  const doc = new EventTarget();
  doc.createElement = () => element();
  globalThis.document = doc;
  globalThis.__followJobs = [];
  globalThis.__knownFollow = null;
  globalThis.__readFollow = null;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ received: "1.50" }) });
  return doc;
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function stat(root, index) {
  return root.children[index];
}

function labelOf(node) {
  return node.children.find((kid) => kid.className === "profile-stat-label").textContent;
}

function numOf(node) {
  return node.children.find((kid) => kid.className === "profile-stat-num").textContent;
}

test("Following counts accounts and topics, and a stale reply does not land", async () => {
  browser();
  const { paintProfileStats } = await import("../profilestats.js");
  const el = element();
  paintProfileStats(el, "0.0.55");
  assert.deepEqual(el.children.map(labelOf), ["Followers", "Following", "Received"]);
  assert.equal(numOf(stat(el, 1)), "\u2013");
  assert.equal(stat(el, 1).classList.contains("is-zero"), true);
  assert.equal(stat(el, 1).className, "profile-stat");
  assert.equal(globalThis.__followJobs[0].account, "0.0.55");

  const first = globalThis.__followJobs[0];
  paintProfileStats(el, "0.0.55");
  assert.equal(numOf(stat(el, 1)), "\u2013");
  first.resolve({ accounts: [{ id: "0.0.1" }, { id: "0.0.2" }], topics: [{ id: "0.0.9" }] });
  await settle();
  assert.equal(numOf(stat(el, 1)), "\u2013");
  assert.equal(stat(el, 1).classList.contains("is-zero"), true);

  globalThis.__followJobs[1].resolve(null);
  await settle();
  assert.equal(numOf(stat(el, 1)), "\u2013");

  paintProfileStats(el, "0.0.55");
  globalThis.__followJobs.at(-1).resolve({
    accounts: [{ id: "0.0.1" }],
    topics: [{ id: "0.0.8" }, { id: "0.0.9" }],
  });
  await settle();
  assert.equal(numOf(stat(el, 0)), "0");
  assert.equal(numOf(stat(el, 1)), "3");
  assert.equal(stat(el, 1).classList.contains("is-zero"), false);
  assert.equal(numOf(stat(el, 2)), "1.50");
  assert.equal(el.dataset.style, "glass");

  const gone = element();
  paintProfileStats(gone, "0.0.77");
  gone.isConnected = false;
  globalThis.__followJobs.at(-1).resolve({ accounts: [{}], topics: [{}] });
  await settle();
  assert.equal(numOf(stat(gone, 1)), "\u2013");
});

test("Following shows an en dash when fetchFollowing returns null or rejects, and 0 when the lists are empty", async () => {
  browser();
  const { paintProfileStats } = await import("../profilestats.js");

  const missed = element();
  paintProfileStats(missed, "0.0.81");
  globalThis.__followJobs.at(-1).resolve(null);
  await settle();
  assert.equal(numOf(stat(missed, 1)), "\u2013");
  assert.equal(stat(missed, 1).classList.contains("is-zero"), true);
  assert.equal(numOf(stat(missed, 0)), "0");
  assert.equal(numOf(stat(missed, 2)), "1.50");

  const broken = element();
  paintProfileStats(broken, "0.0.82");
  globalThis.__followJobs.at(-1).reject(new Error("offline"));
  await settle();
  assert.equal(numOf(stat(broken, 1)), "\u2013");
  assert.equal(stat(broken, 1).classList.contains("is-zero"), true);

  const empty = element();
  paintProfileStats(empty, "0.0.83");
  globalThis.__followJobs.at(-1).resolve({ accounts: [], topics: [] });
  await settle();
  assert.equal(numOf(stat(empty, 1)), "0");
  assert.equal(stat(empty, 1).classList.contains("is-zero"), true);
});

// The stat's name for a screen reader: role, aria-label and title on the
// stat, its visible parts hidden from it while it has one.
function a11y(node) {
  return {
    role: node.getAttribute("role"),
    label: node.getAttribute("aria-label"),
    title: node.getAttribute("title"),
    hidden: node.children.map((kid) => kid.getAttribute("aria-hidden")),
  };
}

test("each stat is one image named by its exact count, like postcounts.js; an en dash has no name", async () => {
  const doc = browser();
  const { paintProfileStats } = await import("../profilestats.js");
  const el = element();
  paintProfileStats(el, "0.0.55");
  // Before any reply: 0 followers, Following unknown, nothing received.
  assert.deepEqual(a11y(stat(el, 0)), { role: "img", label: "0 followers", title: "0 followers", hidden: ["true", "true"] });
  assert.deepEqual(a11y(stat(el, 1)), { role: null, label: null, title: null, hidden: [null, null] });
  assert.deepEqual(a11y(stat(el, 2)), { role: "img", label: "Received 0.00 HBAR", title: "Received 0.00 HBAR", hidden: ["true", "true", "true"] });
  // The old name on the number is gone.
  assert.equal(stat(el, 0).children[0].getAttribute("aria-label"), null);

  globalThis.__followJobs.at(-1).resolve({ accounts: [{ id: "0.0.1" }], topics: [{ id: "0.0.8" }, { id: "0.0.9" }] });
  await settle();
  assert.deepEqual(a11y(stat(el, 0)), { role: "img", label: "0 followers", title: "0 followers", hidden: ["true", "true"] });
  assert.deepEqual(a11y(stat(el, 1)), { role: "img", label: "3 following", title: "3 following", hidden: ["true", "true"] });
  assert.deepEqual(a11y(stat(el, 2)), { role: "img", label: "Received 1.50 HBAR", title: "Received 1.50 HBAR", hidden: ["true", "true", "true"] });
  // What shows is as it was.
  assert.deepEqual(el.children.map(labelOf), ["Followers", "Following", "Received"]);
  assert.deepEqual(el.children.map(numOf), ["0", "3", "1.50"]);

  // One follower, then 1234: the short count shows, the exact one is read.
  globalThis.__knownFollow = { followers: 1 };
  const one = element();
  paintProfileStats(one, "0.0.56");
  assert.equal(numOf(stat(one, 0)), "1");
  assert.equal(a11y(stat(one, 0)).label, "1 follower");
  assert.equal(a11y(stat(one, 0)).title, "1 follower");
  doc.dispatchEvent(new CustomEvent("profile-follow-count", { detail: { account: "0.0.56", followers: 1234 } }));
  assert.equal(numOf(stat(one, 0)), "1.2k");
  assert.deepEqual(a11y(stat(one, 0)), { role: "img", label: "1234 followers", title: "1234 followers", hidden: ["true", "true"] });

  // Following: 1 and 1234 take no plural s; a lost reply goes back to the
  // en dash and drops the name with the count.
  const few = element();
  paintProfileStats(few, "0.0.57");
  globalThis.__followJobs.at(-1).resolve({ accounts: [{ id: "0.0.1" }], topics: [] });
  await settle();
  assert.equal(a11y(stat(few, 1)).label, "1 following");
  const many = element();
  paintProfileStats(many, "0.0.58");
  globalThis.__followJobs.at(-1).resolve({ accounts: Array.from({ length: 1234 }, (_, i) => ({ id: `0.0.${i}` })), topics: [] });
  await settle();
  assert.equal(numOf(stat(many, 1)), "1.2k");
  assert.deepEqual(a11y(stat(many, 1)), { role: "img", label: "1234 following", title: "1234 following", hidden: ["true", "true"] });
  const lost = element();
  paintProfileStats(lost, "0.0.59");
  globalThis.__followJobs.at(-1).reject(new Error("offline"));
  await settle();
  assert.equal(numOf(stat(lost, 1)), "–");
  assert.deepEqual(a11y(stat(lost, 1)), { role: null, label: null, title: null, hidden: [null, null] });

  // Received follows its amount.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ received: "1234.5" }) });
  const rich = element();
  paintProfileStats(rich, "0.0.60");
  await settle();
  assert.equal(numOf(stat(rich, 2)), "1.2k");
  assert.equal(a11y(stat(rich, 2)).label, "Received 1234.50 HBAR");
  globalThis.__knownFollow = null;
});

test("the feed profile keeps Link and Topic and drops the Account row", () => {
  const feed = read("../feedlayout.js");
  const start = feed.indexOf("function fillProfileSections");
  const end = feed.indexOf("function paintFeedProfile");
  const body = feed.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(body.includes("profileField('Account'"), false);
  assert.match(body, /profileField\('Link'/);
  assert.match(body, /profileField\('Topic'/);
  assert.match(feed, /profileHandle\.href = 'https:\/\/explore\.hashpack\.app\/'/);
  const css = read("../style.css");
  const from = css.indexOf(".profile-stats {");
  const to = css.indexOf("#feed-profile .feed-profile-bio");
  const rule = css.slice(from, to);
  assert.equal(rule.includes("px"), false);
  assert.equal(rule.includes("cqi"), false);
  assert.match(rule, /justify-content:\s*space-evenly/);
  assert.match(rule, /font-size:\s*clamp\(1\.8dvh,\s*4\.6dvw,\s*2\.8dvh\)/);
});
