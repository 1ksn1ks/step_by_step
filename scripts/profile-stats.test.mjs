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
  return {
    className: "",
    textContent: "",
    isConnected: true,
    dataset: {},
    children: [],
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
