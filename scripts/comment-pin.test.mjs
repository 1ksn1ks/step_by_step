// Author-picked NFT collections that pin holder comments. No DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearAutoplayState } from "../coverautoplay.js";
import {
  COMMENT_PIN_MAX,
  HOLDER_MS,
  HOLDER_RETRY_MS,
  cachedHolder,
  cachedPinned,
  clearCommentPinState,
  collectionName,
  collectionNames,
  commentPinFor,
  commentPinPayers,
  commentPinText,
  lookupHolders,
  normalizePins,
  parsePinInput,
  pinTopLevel,
  planCommentPinEdit,
  rememberCommentPin,
  setCommentPinIO,
  validatePinToken,
  validatePinTokens,
  whenCollectionName,
} from "../commentpin.js";

const NAME_MS = 60 * 60 * 1000;
const POST = "2026-01-02T00:00:00.000Z";
const STAMP = "1/2/2026, 00:00";
const LATER = "2026-01-04T00:00:00.000Z";
const NEWEST = "2026-01-05T00:00:00.000Z";
const OLDER = "2026-01-03T00:00:00.000Z";

function okBody(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get() { return null; } },
    json: async () => body,
  };
}

function nftInfo(name) {
  return okBody({ type: "NON_FUNGIBLE_UNIQUE", name, deleted: false });
}

function node(payer, created, replies = []) {
  return { payer, created, replies, text: payer };
}

test.describe("comment pin", { concurrency: 1 }, () => {
  test("normalizePins cleans an object, a legacy token, and a plain array", () => {
    assert.equal(COMMENT_PIN_MAX, 5);
    assert.deepEqual(
      normalizePins({ tokens: [" 0.0.2 ", "0.0.2", "nope", "0.0.3", "0.0.1"] }),
      ["0.0.2", "0.0.3", "0.0.1"],
    );
    assert.deepEqual(normalizePins({ token: "0.0.8" }), ["0.0.8"]);
    assert.deepEqual(normalizePins(["0.0.4", " 0.0.4", "0.0.5"]), ["0.0.4", "0.0.5"]);
    const six = ["0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5", "0.0.6"];
    assert.deepEqual(normalizePins({ tokens: six }), six.slice(0, 5));
    assert.deepEqual(normalizePins(["abc", "0.0", "1.2.3"]), []);
    for (const junk of [null, undefined, 5, "0.0.1", { a: 1 }, { tokens: "0.0.1" }, { token: 4 }]) {
      assert.deepEqual(normalizePins(junk), [], JSON.stringify(junk));
    }
  });

  test("parsePinInput splits commas and whitespace and reports the rest", () => {
    assert.deepEqual(parsePinInput("0.0.1, 0.0.2"), {
      tokens: ["0.0.1", "0.0.2"], invalid: [], tooMany: false,
    });
    assert.deepEqual(parsePinInput("0.0.1 0.0.2"), {
      tokens: ["0.0.1", "0.0.2"], invalid: [], tooMany: false,
    });
    assert.deepEqual(parsePinInput("0.0.1,  0.0.2\n0.0.3"), {
      tokens: ["0.0.1", "0.0.2", "0.0.3"], invalid: [], tooMany: false,
    });
    assert.deepEqual(parsePinInput("0.0.1, 0.0.1, 0.0.2"), {
      tokens: ["0.0.1", "0.0.2"], invalid: [], tooMany: false,
    });
    assert.deepEqual(parsePinInput("0.0.1, nope, 0.0"), {
      tokens: ["0.0.1"], invalid: ["nope", "0.0"], tooMany: false,
    });
    assert.deepEqual(parsePinInput(""), {
      tokens: [], invalid: [], tooMany: false,
    });
    const many = parsePinInput("0.0.1, 0.0.2 0.0.3,0.0.4 0.0.5, 0.0.6");
    assert.deepEqual(many.tokens, ["0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5"]);
    assert.deepEqual(many.invalid, []);
    assert.equal(many.tooMany, true);
    const copies = parsePinInput("0.0.9 0.0.9, 0.0.9");
    assert.deepEqual(copies.tokens, ["0.0.9"]);
    assert.equal(copies.tooMany, false);
  });

  test("commentPinText names the collections in order", () => {
    assert.equal(commentPinText([], {}), "");
    assert.equal(commentPinText(null), "");
    assert.equal(
      commentPinText(["0.0.1"], { "0.0.1": "Frogs" }),
      "Holders of Frogs shown first",
    );
    assert.equal(
      commentPinText(["0.0.1", "0.0.2", "0.0.3"], { "0.0.1": "Frogs", "0.0.2": "Cats", "0.0.3": "Dogs" }),
      "Holders of Frogs, Cats, Dogs shown first",
    );
    assert.equal(
      commentPinText(["0.0.1", "0.0.2"], { "0.0.2": "Cats" }),
      "Holders of 0.0.1, Cats shown first",
    );
    assert.equal(
      commentPinText(["0.0.1"], { "0.0.1": "   " }),
      "Holders of 0.0.1 shown first",
    );
    const long = "x".repeat(50);
    assert.equal(
      commentPinText(["0.0.1"], { "0.0.1": `  ${long}  ` }),
      `Holders of ${"x".repeat(40)} shown first`,
    );
    assert.equal(
      commentPinText(["0.0.1"], { "0.0.1": "y".repeat(40) }),
      `Holders of ${"y".repeat(40)} shown first`,
    );
  });

  test("pinTopLevel lifts holders and leaves everyone else in place", () => {
    const a = node("a", "2026-01-03T00:00:00.000Z");
    const reply = node("reply", "2026-06-01T00:00:00.000Z");
    const b = node("b", "2026-01-02T00:00:00.000Z", [reply]);
    const c = node("c", "2026-01-01T00:00:00.000Z");
    const newest = [a, b, c];
    const asked = [];
    const lifted = pinTopLevel(newest, (payer) => {
      asked.push(payer);
      return payer === "b" ? true : false;
    });
    assert.deepEqual(lifted.map((item) => item.payer), ["b", "a", "c"]);
    assert.equal(lifted[0].replies, b.replies);
    assert.deepEqual(lifted[0].replies.map((item) => item.payer), ["reply"]);
    assert.deepEqual(asked, ["a", "b", "c"]);
    assert.deepEqual(newest.map((item) => item.payer), ["a", "b", "c"]);
    assert.notEqual(lifted, newest);

    const top = [c, a, b];
    const both = pinTopLevel(top, (payer) => payer === "a" || payer === "b");
    assert.deepEqual(both.map((item) => item.payer), ["a", "b", "c"]);
    assert.deepEqual(top.map((item) => item.payer), ["c", "a", "b"]);

    const mixed = pinTopLevel(newest, (payer) => (payer === "a" ? false : undefined));
    assert.deepEqual(mixed.map((item) => item.payer), ["a", "b", "c"]);
    assert.notEqual(mixed, newest);
    const unknown = pinTopLevel(newest, () => undefined);
    assert.deepEqual(unknown.map((item) => item.payer), ["a", "b", "c"]);
    assert.notEqual(unknown, newest);
  });

  test("commentPinPayers lists top-level payers newest first", () => {
    const rows = [
      node("0.0.1", "2026-01-01T00:00:00.000Z", [
        node("0.0.9", "2026-06-01T00:00:00.000Z"),
      ]),
      node("0.0.1", "2026-03-01T00:00:00.000Z"),
      node("0.0.2", "2026-02-01T00:00:00.000Z"),
      { created: "2026-04-01T00:00:00.000Z" },
    ];
    const before = rows.map((item) => item.payer);
    assert.deepEqual(commentPinPayers(rows), ["0.0.1", "0.0.2"]);
    assert.deepEqual(commentPinPayers(rows, 1), ["0.0.1"]);
    assert.deepEqual(commentPinPayers(rows, 100), ["0.0.1", "0.0.2"]);
    assert.deepEqual(rows.map((item) => item.payer), before);

    const many = Array.from({ length: 35 }, (_, i) => node(
      `0.0.${i + 1}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    ));
    const newestThirty = commentPinPayers(many, 30);
    assert.equal(newestThirty.length, 30);
    assert.equal(newestThirty[0], "0.0.35");
    assert.equal(newestThirty[29], "0.0.6");
    assert.equal(commentPinPayers(many).length, 35);
  });

  test("the holder store pins any listed collection and keeps failures unknown", async () => {
    clearCommentPinState();
    clearAutoplayState();
    let now = 1_000_000;
    const urls = [];
    const script = new Map();
    setCommentPinIO({
      now: () => now,
      fetch: async (url) => {
        urls.push(url);
        const plan = script.get(url) || "empty";
        if (plan === "throw") throw new Error("down");
        if (plan === "bad") throw new Error("bad body");
        if (plan === "500") return okBody({ nfts: [{}] }, 500);
        if (plan === "hold") return okBody({ nfts: [{}] });
        if (plan === "json") {
          return {
            status: 200,
            ok: true,
            headers: { get() { return null; } },
            json: async () => { throw new Error("bad"); },
          };
        }
        return okBody({ nfts: [] });
      },
    });
    const tokenOf = (url) => (url.match(/token\.id=(0\.0\.\d+)/) || [])[1];
    const holdOf = (account, token, kind) => {
      script.set(`https://mainnet.mirrornode.hedera.com/api/v1/accounts/${account}/nfts?token.id=${token}&limit=1`, kind);
    };

    holdOf("0.0.10", "0.0.1", "hold");
    const firstOnly = await lookupHolders(["0.0.10"], ["0.0.1", "0.0.2"]);
    assert.equal(firstOnly, true);
    assert.deepEqual(urls.map(tokenOf), ["0.0.1"]);
    assert.equal(cachedPinned("0.0.10", ["0.0.1", "0.0.2"]), true);
    assert.equal(await lookupHolders(["0.0.10"], ["0.0.1", "0.0.2"]), false);

    urls.length = 0;
    holdOf("0.0.11", "0.0.1", "empty");
    holdOf("0.0.11", "0.0.2", "hold");
    await lookupHolders(["0.0.11"], ["0.0.1", "0.0.2"]);
    assert.deepEqual(urls.map(tokenOf), ["0.0.1", "0.0.2"]);
    assert.equal(cachedHolder("0.0.11", "0.0.1"), false);
    assert.equal(cachedHolder("0.0.11", "0.0.2"), true);
    assert.equal(cachedPinned("0.0.11", ["0.0.1", "0.0.2"]), true);

    urls.length = 0;
    holdOf("0.0.12", "0.0.1", "empty");
    holdOf("0.0.12", "0.0.2", "empty");
    await lookupHolders(["0.0.12"], ["0.0.1", "0.0.2"]);
    assert.equal(cachedPinned("0.0.12", ["0.0.1", "0.0.2"]), false);

    urls.length = 0;
    holdOf("0.0.13", "0.0.1", "throw");
    holdOf("0.0.13", "0.0.2", "hold");
    await lookupHolders(["0.0.13"], ["0.0.1", "0.0.2"]);
    assert.deepEqual(urls.map(tokenOf), ["0.0.1", "0.0.2"]);
    assert.equal(cachedHolder("0.0.13", "0.0.1"), undefined);
    assert.equal(cachedHolder("0.0.13", "0.0.2"), true);
    assert.equal(cachedPinned("0.0.13", ["0.0.1", "0.0.2"]), true);

    holdOf("0.0.14", "0.0.1", "empty");
    holdOf("0.0.14", "0.0.2", "throw");
    await lookupHolders(["0.0.14"], ["0.0.1", "0.0.2"]);
    assert.equal(cachedHolder("0.0.14", "0.0.1"), false);
    assert.equal(cachedHolder("0.0.14", "0.0.2"), undefined);
    assert.equal(cachedPinned("0.0.14", ["0.0.1", "0.0.2"]), undefined);

    holdOf("0.0.15", "0.0.1", "500");
    await lookupHolders(["0.0.15"], ["0.0.1"]);
    assert.equal(cachedHolder("0.0.15", "0.0.1"), undefined);
    holdOf("0.0.16", "0.0.1", "json");
    await lookupHolders(["0.0.16"], ["0.0.1"]);
    assert.equal(cachedHolder("0.0.16", "0.0.1"), undefined);

    const before = urls.length;
    holdOf("0.0.20", "0.0.3", "hold");
    await lookupHolders(["0.0.20"], ["0.0.3"]);
    assert.equal(urls.length, before + 1);
    assert.equal(cachedHolder("0.0.20", "0.0.3"), true);
    now += HOLDER_MS - 1;
    assert.equal(cachedHolder("0.0.20", "0.0.3"), true);
    await lookupHolders(["0.0.20"], ["0.0.3"]);
    assert.equal(urls.length, before + 1);
    now += 1;
    assert.equal(cachedHolder("0.0.20", "0.0.3"), undefined);
    await lookupHolders(["0.0.20"], ["0.0.3"]);
    assert.equal(urls.length, before + 2);
    assert.equal(cachedHolder("0.0.20", "0.0.3"), true);

    const failsAt = urls.length;
    holdOf("0.0.21", "0.0.4", "throw");
    await lookupHolders(["0.0.21"], ["0.0.4"]);
    assert.equal(urls.length, failsAt + 1);
    assert.equal(cachedHolder("0.0.21", "0.0.4"), undefined);
    now += HOLDER_RETRY_MS - 1;
    await lookupHolders(["0.0.21"], ["0.0.4"]);
    assert.equal(urls.length, failsAt + 1);
    now += 1;
    await lookupHolders(["0.0.21"], ["0.0.4"]);
    assert.equal(urls.length, failsAt + 2);
    clearAutoplayState();
  });

  test("one flight per account and token", async () => {
    clearCommentPinState();
    clearAutoplayState();
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    try {
      setCommentPinIO({
        fetch: () => {
          calls += 1;
          return gate.then(() => okBody({ nfts: [{}] }));
        },
      });
      const left = lookupHolders(["0.0.30"], ["0.0.7"]);
      const right = lookupHolders(["0.0.30"], ["0.0.7"]);
      assert.equal(calls, 1);
      release();
      assert.deepEqual(await Promise.all([left, right]), [true, true]);
      assert.equal(calls, 1);
      assert.equal(cachedHolder("0.0.30", "0.0.7"), true);
    } finally {
      release();
      clearAutoplayState();
    }
  });

  test("lookupHolders reads at most 4 accounts at once", async () => {
    clearCommentPinState();
    clearAutoplayState();
    let active = 0;
    let max = 0;
    const gates = [];
    setCommentPinIO({
      fetch: () => {
        active += 1;
        max = Math.max(max, active);
        return new Promise((resolve) => {
          gates.push(() => {
            active -= 1;
            resolve(okBody({ nfts: [] }));
          });
        });
      },
    });
    const accounts = Array.from({ length: 8 }, (_, i) => `0.0.${200 + i}`);
    const pending = lookupHolders(accounts, ["0.0.9"]);
    try {
      assert.equal(gates.length, 4);
      assert.equal(max, 4);
      while (gates.length) {
        gates.shift()();
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
      }
      assert.equal(await pending, true);
      assert.equal(max, 4);
      assert.equal(gates.length, 0);

      // A known hold ends that account only. Later accounts are still read.
      clearCommentPinState();
      const held = new Set(["0.0.201", "0.0.202", "0.0.203", "0.0.204"]);
      const seen = [];
      setCommentPinIO({
        fetch: (url) => {
          const account = (url.match(/accounts\/(0\.0\.\d+)/) || [])[1];
          seen.push(account);
          return okBody({ nfts: held.has(account) ? [{}] : [] });
        },
      });
      await lookupHolders(
        ["0.0.201", "0.0.202", "0.0.203", "0.0.204", "0.0.205", "0.0.206"],
        ["0.0.9"],
      );
      assert.deepEqual(seen, ["0.0.201", "0.0.202", "0.0.203", "0.0.204", "0.0.205", "0.0.206"]);
    } finally {
      while (gates.length) gates.shift()();
      clearAutoplayState();
    }
  });

  test("a 429 waits and then the read is tried again", async () => {
    clearCommentPinState();
    clearAutoplayState();
    let calls = 0;
    setCommentPinIO({
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            status: 429,
            ok: false,
            headers: { get: (name) => (String(name).toLowerCase() === "retry-after" ? "0" : null) },
            json: async () => ({}),
          };
        }
        return okBody({ nfts: [{}] });
      },
    });
    try {
      const changed = await lookupHolders(["0.0.40"], ["0.0.8"]);
      assert.equal(changed, true);
      assert.equal(calls, 2);
      assert.equal(cachedHolder("0.0.40", "0.0.8"), true);
    } finally {
      clearAutoplayState();
    }
  });

  test("collection names cache for an hour and a failed read stores nothing", async () => {
    clearCommentPinState();
    let now = 2_000_000;
    let calls = 0;
    let fail = true;
    setCommentPinIO({
      now: () => now,
      fetch: async () => {
        calls += 1;
        if (fail) throw new Error("down");
        return okBody({ name: "  Cats  " });
      },
    });
    assert.equal(collectionName("0.0.5"), "");
    assert.equal(await whenCollectionName("0.0.5"), "");
    assert.equal(calls, 1);
    fail = false;
    assert.equal(collectionName("0.0.5"), "");
    assert.equal(await whenCollectionName("0.0.5"), "  Cats  ");
    assert.equal(collectionName("0.0.5"), "  Cats  ");
    assert.equal(calls, 2);
    assert.deepEqual(collectionNames(["0.0.5", "nope"]), { "0.0.5": "  Cats  " });
    assert.equal(calls, 2);
    now += NAME_MS;
    assert.equal(collectionName("0.0.5"), "");
    assert.equal(await whenCollectionName("0.0.5"), "  Cats  ");
    assert.equal(calls, 3);
    assert.equal(collectionName("0.0.5"), "  Cats  ");
  });

  test("validatePinToken accepts a unique NFT and refuses the rest", async () => {
    clearCommentPinState();
    let now = 3_000_000;
    setCommentPinIO({ now: () => now, fetch: async () => { throw new Error("unused"); } });
    const nft = await validatePinToken("0.0.9", async () => nftInfo("Frogs"));
    assert.deepEqual(nft, { ok: true, name: "Frogs" });
    assert.equal(collectionName("0.0.9"), "Frogs");
    assert.deepEqual(
      await validatePinToken("0.0.8", async () => okBody({ type: "FUNGIBLE_COMMON", name: "USD" })),
      { ok: false, reason: "Not an NFT collection" },
    );
    assert.deepEqual(
      await validatePinToken("0.0.7", async () => okBody({ type: "NON_FUNGIBLE_UNIQUE", deleted: true, name: "Gone" })),
      { ok: false, reason: "Not an NFT collection" },
    );
    assert.deepEqual(
      await validatePinToken("0.0.6", async () => { throw new Error("net"); }),
      { ok: false, reason: "Could not check the collection" },
    );
    assert.deepEqual(
      await validatePinToken("nope", async () => nftInfo("no")),
      { ok: false, reason: "Could not check the collection" },
    );
  });

  test("validatePinTokens stops at the first bad id and reads at most 3 at once", async () => {
    clearCommentPinState();
    let active = 0;
    let max = 0;
    let fungible = true;
    const gates = new Map();
    const read = (url) => {
      active += 1;
      max = Math.max(max, active);
      const id = url.slice(url.lastIndexOf("/") + 1);
      return new Promise((resolve) => {
        gates.set(id, () => {
          active -= 1;
          if (fungible && id === "0.0.2") resolve(okBody({ type: "FUNGIBLE_COMMON", name: "no" }));
          else resolve(nftInfo(id));
        });
      });
    };
    const pending = validatePinTokens(["0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5"], read);
    assert.equal(gates.size, 3);
    assert.ok(max <= 3);
    gates.get("0.0.2")();
    gates.get("0.0.1")();
    gates.get("0.0.3")();
    assert.deepEqual(await pending, { ok: false, token: "0.0.2", reason: "Not an NFT collection" });
    assert.equal(gates.has("0.0.4"), false);
    assert.equal(gates.has("0.0.5"), false);
    assert.ok(max <= 3);

    active = 0;
    max = 0;
    fungible = false;
    gates.clear();
    const all = validatePinTokens(["0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5", "0.0.6"], read);
    assert.equal(gates.size, 3);
    gates.get("0.0.1")();
    gates.get("0.0.2")();
    gates.get("0.0.3")();
    for (let i = 0; i < 6 && gates.size < 5; i += 1) await Promise.resolve();
    assert.equal(gates.size, 5);
    assert.equal(gates.has("0.0.6"), false);
    gates.get("0.0.4")();
    gates.get("0.0.5")();
    assert.deepEqual(await all, { ok: true });
    assert.ok(max <= 3);
  });

  test("rememberCommentPin keeps the newest pin from the original payer", () => {
    clearCommentPinState();
    const payer = "0.0.100";
    const edit = (pin, extra = {}) => ({
      editMarkerCreated: POST,
      editMarkerTimestamp: STAMP,
      commentPin: pin,
      ...extra,
    });
    assert.equal(rememberCommentPin(payer, edit({ tokens: ["0.0.9"] }), POST), null);
    assert.equal(rememberCommentPin(payer, edit({ tokens: ["0.0.9"] }), "2026-01-01T00:00:00.000Z"), null);
    assert.deepEqual(commentPinFor(payer, POST, STAMP, { tokens: ["0.0.8"] }), ["0.0.8"]);

    const pinOnly = {
      editMarkerCreated: POST,
      editMarkerTimestamp: STAMP,
      commentPin: { tokens: ["0.0.1", "0.0.1", "nope", "0.0.2", "0.0.3", "0.0.4", "0.0.5", "0.0.6"] },
    };
    const stored = rememberCommentPin(payer, pinOnly, LATER);
    assert.deepEqual(stored.tokens, ["0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5"]);
    assert.equal(stored.msg, undefined);
    assert.deepEqual(commentPinFor(payer, POST, STAMP, { tokens: ["0.0.8"] }), stored.tokens);
    const copy = commentPinFor(payer, POST, STAMP);
    copy.push("0.0.9");
    assert.deepEqual(commentPinFor(payer, POST, STAMP), stored.tokens);

    assert.equal(rememberCommentPin(payer, edit({ tokens: ["0.0.3"] }), OLDER), null);
    assert.deepEqual(commentPinFor(payer, POST, STAMP), stored.tokens);

    const other = rememberCommentPin("0.0.999", edit({ tokens: ["0.0.7"] }), NEWEST);
    assert.ok(other);
    assert.deepEqual(commentPinFor(payer, POST, STAMP), stored.tokens);
    assert.deepEqual(commentPinFor("0.0.999", POST, STAMP), ["0.0.7"]);

    const legacy = rememberCommentPin(payer, edit({ token: "0.0.42" }), NEWEST);
    assert.deepEqual(legacy.tokens, ["0.0.42"]);
    assert.deepEqual(commentPinFor(payer, POST, STAMP), ["0.0.42"]);

    for (const bad of [null, "0.0.1", { tokens: "0.0.1" }, { token: 12 }, { other: true }]) {
      assert.equal(rememberCommentPin(payer, edit(bad), "2026-01-06T00:00:00.000Z"), null);
    }
    assert.equal(rememberCommentPin(payer, {
      editMarkerCreated: POST,
      msg: "text only",
    }, "2026-01-06T00:00:00.000Z"), null);
    assert.deepEqual(commentPinFor(payer, POST, STAMP), ["0.0.42"]);

    const cleared = rememberCommentPin(payer, edit({ tokens: [] }), "2026-01-07T00:00:00.000Z");
    assert.deepEqual(cleared.tokens, []);
    assert.deepEqual(commentPinFor(payer, POST, STAMP, { tokens: ["0.0.8"] }), []);

    const polygon = rememberCommentPin(payer, {
      editPolygonCreated: "2026-02-01T00:00:00.000Z",
      editPolygonTimestamp: "poly",
      commentPin: { token: "0.0.15" },
    }, "2026-02-02T00:00:00.000Z");
    assert.deepEqual(polygon.tokens, ["0.0.15"]);
    assert.deepEqual(commentPinFor(payer, "2026-02-01T00:00:00.000Z", "poly"), ["0.0.15"]);

    assert.deepEqual(
      commentPinFor("0.0.50", POST, STAMP, ["0.0.1", "nope", "0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5", "0.0.6"]),
      ["0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5"],
    );
  });

  test("the pin editor is the NFT-utility field, and an empty save clears", () => {
    assert.deepEqual(planCommentPinEdit("0.0.1", false), { ok: false, reason: "owner" });
    assert.deepEqual(planCommentPinEdit("0.0.1, nope", true), { ok: false, reason: "invalid" });
    assert.equal(planCommentPinEdit("0.0.1 0.0.2 0.0.3 0.0.4 0.0.5 0.0.6", true).reason, "many");
    assert.deepEqual(planCommentPinEdit("   ", true), { ok: true, tokens: [] });
    assert.deepEqual(planCommentPinEdit("0.0.4, 0.0.4 0.0.5", true), { ok: true, tokens: ["0.0.4", "0.0.5"] });

    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const html = read("../index.html");
    const rest = read("../rest.js");
    const client = read("../processallmessages.js");
    for (const id of ["comment-pin-marker", "comment-pin-polygon", "popup-settings-comment-pin"]) {
      assert.equal(html.includes(id), false, id);
    }
    assert.match(html, /id="input-field-comment-pin"/);
    assert.match(html, /id="submit-button-comment-pin"/);
    assert.match(html, /Pin top comments/);
    assert.match(html, /Open one of your posts to pin holders/);
    assert.doesNotMatch(rest, /readCreatePin|clearCreatePin|comment-pin-marker|comment-pin-polygon/);
    assert.doesNotMatch(client, /pinDraft|popup-settings-comment-pin|readCreatePin/);
    const save = client.slice(client.indexOf("async function saveUtilityPin"), client.indexOf("const pinSave"));
    assert.match(save, /planCommentPinEdit\(field\.value, true\)/);
    assert.match(save, /pinWalkOwned\(walk\)/);
    assert.match(save, /if \(!field \|\| !owned\) return;/);
    assert.match(save, /Enter collection ids like 0\.0\.123/);
    assert.match(save, /Up to 5 collections/);
    assert.match(save, /validatePinTokens\(plan\.tokens\)/);
    assert.match(save, /\$\{check\.token\}: \$\{check\.reason\}/);
    assert.match(save, /editPayload\(walk, undefined, null, plan\.tokens\)/);
    assert.match(save, /rememberCommentPin\(connectedAccount, sent, sentAt\)/);
    assert.match(save, /applyOpenCommentPin\(walk\)/);
    assert.match(client, /function applyOpenCommentPin\(walk\)/);
    const apply = client.slice(client.indexOf("function applyOpenCommentPin"), client.indexOf("async function saveUtilityPin"));
    assert.match(apply, /section\._applyPin\(\)/);
  });
});
