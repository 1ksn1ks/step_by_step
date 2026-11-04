// Polygon cover autoplay. No DOM and no map. Save-Data, battery, and motion
// stay in front of the topic NFT rule.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  AUTOPLAY_HOLD_MS,
  AUTOPLAY_HOLD_RETRY_MS,
  COVER_LOW_BATTERY,
  COVER_RELEASE_MS,
  cachedHold,
  clearAutoplayState,
  coverBatteryIsLow,
  coverHoldSrc,
  coverIdsToRelease,
  coverScreenScore,
  coverShouldRelease,
  holdQueriesFor,
  lookupHolds,
  MIRROR_HOLD_LIMIT,
  mirrorHoldUrl,
  pickAutoplayCover,
  readUniqueNft,
  rememberHold,
  rememberTopicAutoplay,
  shouldAutoplayCover,
  tokenIsUniqueNft,
} from "../coverautoplay.js";
import { autoplayConfigMessage, currentAutoplayNft } from "../loadcurrenttopic.js";
import { siblingPosterUrl } from "../mediaurl.js";

const open = { saveData: false, lowBattery: false, reducedMotion: false };

test("cover autoplay stays off without a topic token and a cached hold", () => {
  clearAutoplayState();
  const polygon = { nft: true, topic: "allow", topicId: "0.0.1", payer: "0.0.2", autoplayNft: "0.0.9" };
  assert.equal(shouldAutoplayCover(polygon, open), false);
  assert.equal(shouldAutoplayCover({ payer: "0.0.2" }, open), false);
  assert.equal(shouldAutoplayCover(null, null), false);
  assert.equal(shouldAutoplayCover(undefined, undefined), false);
});

test("Save-Data, low battery, and reduced motion always refuse autoplay", () => {
  clearAutoplayState();
  rememberTopicAutoplay("0.0.1", "0.0.9");
  rememberHold("0.0.2", "0.0.9", true, 0);
  const polygon = { topicId: "0.0.1", payer: "0.0.2" };
  assert.equal(shouldAutoplayCover(polygon, { ...open, saveData: true }, 0), false);
  assert.equal(shouldAutoplayCover(polygon, { ...open, lowBattery: true }, 0), false);
  assert.equal(shouldAutoplayCover(polygon, { ...open, reducedMotion: true }, 0), false);
  assert.equal(shouldAutoplayCover(polygon, { saveData: true, lowBattery: true, reducedMotion: true }, 0), false);
  assert.equal(shouldAutoplayCover(polygon, open, 0), true);
});

test("the autoplay hook checks Save-Data, battery, and motion before the rule", () => {
  const source = fs.readFileSync(new URL("../coverautoplay.js", import.meta.url), "utf8");
  const start = source.indexOf("export function shouldAutoplayCover");
  const end = source.indexOf("export function", start + 10);
  const body = source.slice(start, end);
  const save = body.indexOf("view.saveData");
  const battery = body.indexOf("view.lowBattery");
  const motion = body.indexOf("view.reducedMotion");
  const rule = body.indexOf("return cachedHold");
  assert.ok(save !== -1 && battery !== -1 && motion !== -1 && rule !== -1);
  assert.ok(save < battery && battery < motion && motion < rule);
  assert.equal(body.includes("view.wallet"), false);
  assert.equal(body.includes("view.account"), false);
});

test("autoplay is the topic token plus the creator hold, not the viewer wallet", () => {
  clearAutoplayState();
  rememberTopicAutoplay("0.0.10", "0.0.77");
  rememberHold("0.0.2", "0.0.77", true, 1_000);
  rememberHold("0.0.3", "0.0.77", false, 1_000);
  const holder = { topicId: "0.0.10", payer: "0.0.2" };
  const other = { topicId: "0.0.10", payer: "0.0.3" };
  const viewerHolds = { ...open, wallet: "0.0.2", account: "0.0.2" };
  assert.equal(shouldAutoplayCover(holder, viewerHolds, 1_000), true);
  assert.equal(shouldAutoplayCover(holder, { ...open, wallet: "0.0.9", account: "0.0.9" }, 1_000), true);
  assert.equal(shouldAutoplayCover(other, viewerHolds, 1_000), false);
  assert.equal(shouldAutoplayCover({ topicId: "0.0.11", payer: "0.0.2" }, open, 1_000), false);
  assert.equal(cachedHold("0.0.2", "0.0.77", 1_000 + AUTOPLAY_HOLD_MS - 1), true);
  assert.equal(cachedHold("0.0.2", "0.0.77", 1_000 + AUTOPLAY_HOLD_MS), undefined);
  assert.equal(shouldAutoplayCover(holder, open, 1_000 + AUTOPLAY_HOLD_MS), false);
});

test("a battery at 20% or below and not charging is low", () => {
  assert.equal(COVER_LOW_BATTERY, 0.2);
  assert.equal(coverBatteryIsLow({ level: 0.2, charging: false }), true);
  assert.equal(coverBatteryIsLow({ level: 0.19, charging: false }), true);
  assert.equal(coverBatteryIsLow({ level: 0, charging: false }), true);
  assert.equal(coverBatteryIsLow({ level: 0.2, charging: true }), false);
  assert.equal(coverBatteryIsLow({ level: 0.21, charging: false }), false);
  assert.equal(coverBatteryIsLow(null), false);
  assert.equal(coverBatteryIsLow({}), false);
  assert.equal(coverBatteryIsLow({ level: "low" }), false);
});

test("a paused cover keeps its file on screen and gives it back after 3 seconds away", () => {
  assert.equal(COVER_RELEASE_MS, 3000);
  const onScreen = { hasSrc: true, playing: false, userPaused: true, inView: true };
  assert.equal(coverHoldSrc(onScreen), true);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: true }), true);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: false }), false);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: false, inView: false }), false);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: true, hidden: true }), false);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: true, feed: true }), false);
  assert.equal(coverHoldSrc({ hasSrc: true, playing: true, inView: true, replaced: true }), false);
  assert.equal(coverHoldSrc({ hasSrc: false, playing: true, inView: true }), false);
  assert.equal(coverHoldSrc(null), false);
  assert.equal(coverShouldRelease(0, 2999), false);
  assert.equal(coverShouldRelease(0, 3000), true);
  assert.equal(coverShouldRelease(0, 5000), true);
  assert.equal(coverShouldRelease(null, 3000), false);
  assert.equal(coverShouldRelease(0, "soon"), false);
});

test("starting one cover releases every other", () => {
  assert.deepEqual(coverIdsToRelease(["a", "b", "c"], "b"), ["a", "c"]);
  assert.deepEqual(coverIdsToRelease(["a"], "a"), []);
  assert.deepEqual(coverIdsToRelease(["a", ""], "b"), ["a"]);
  assert.deepEqual(coverIdsToRelease(null, "b"), []);
  assert.deepEqual(coverIdsToRelease(["a"], ""), []);
});

test("a markers video points at its sibling poster and nothing else does", () => {
  assert.equal(
    siblingPosterUrl("https://pub-243.r2.dev/markers/1700000000000-ab12cd.mp4"),
    "https://pub-243.r2.dev/markers/1700000000000-ab12cd.poster.jpg",
  );
  assert.equal(
    siblingPosterUrl("https://pub-243.r2.dev/markers/1700000000000-ab12cd-d12.webm?x=1#t"),
    "https://pub-243.r2.dev/markers/1700000000000-ab12cd-d12.poster.jpg",
  );
  assert.equal(
    siblingPosterUrl("https://example.invalid/media/markers/1-ab.mp4"),
    "https://example.invalid/media/markers/1-ab.poster.jpg",
  );
  assert.equal(siblingPosterUrl("https://pub-243.r2.dev/markers/%2e%2e%2fsecret.mp4"), "");
  assert.equal(siblingPosterUrl("https://pub-243.r2.dev/markers/1-ab.gif"), "");
  assert.equal(siblingPosterUrl("https://pub-243.r2.dev/markers/1-ab.mov"), "");
  assert.equal(siblingPosterUrl("https://cdn.example/ipfs/QmVideo"), "");
  assert.equal(siblingPosterUrl(""), "");
  assert.equal(siblingPosterUrl("not a url"), "");
});

test("a cover video does not take a src until play, except the one frame grab", () => {
  const source = fs.readFileSync(new URL("../polygons.js", import.meta.url), "utf8");
  assert.match(source, /shouldAutoplayCover\(cov\.polygon/);
  assert.match(source, /siblingPosterUrl\(url\)/);
  assert.match(source, /coverHoldSrc\(state\)/);
  assert.match(source, /coverShouldRelease\(cov\.releaseSince/);
  assert.match(source, /coverIdsToRelease\(busy, cov\.sourceId\)/);
  assert.equal(source.includes("preload = 'auto'"), false);
  assert.equal(source.includes('preload = "auto"'), false);

  const grabAt = source.indexOf("function grabCoverFrame");
  const playAt = source.indexOf("function playCover");
  const registerAt = source.indexOf("function registerCover");
  assert.ok(grabAt !== -1 && playAt !== -1 && registerAt !== -1 && grabAt < playAt);
  const grab = source.slice(grabAt, playAt);
  const play = source.slice(playAt, registerAt);
  const register = source.slice(registerAt, source.indexOf("function ensurePump", registerAt));
  const scheduleAt = source.indexOf("function scheduleVisPass");
  assert.ok(scheduleAt !== -1 && scheduleAt < registerAt);
  const schedule = source.slice(scheduleAt, registerAt);
  assert.match(schedule, /if \(visPassFrame\) return;/);
  assert.match(schedule, /requestAnimationFrame/);
  assert.match(schedule, /visPass\(\)/);
  assert.match(register, /scheduleVisPass\(\)/);
  assert.equal(register.includes("visPass()"), false);
  assert.match(grab, /preload = 'metadata'/);
  assert.match(grab, /currentTime = 0/);
  assert.match(grab, /removeAttribute\('src'\)/);
  assert.match(grab, /drawImage\(video, 0, 0, 512, 512\)/);
  assert.equal(play.includes("video.src = cov.url"), true);
  assert.equal(register.includes("video.src"), false);
  assert.match(source, /className = 'polygon-cover-play'/);
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const ruleAt = css.indexOf(".polygon-cover-play {");
  assert.ok(ruleAt !== -1);
  const rule = css.slice(ruleAt, css.indexOf(".polygon-cover-play[hidden]", ruleAt));
  assert.match(rule, /max\(44px, calc\(var\(--fu\) \* 3\.6\)\)/);
  assert.match(rule, /#22D3EE/);
  assert.match(rule, /--fu:/);
  assert.match(rule, /--ui-label:/);
  assert.match(rule, /--ui-small:/);
  assert.equal(/\d+px/.test(rule.replaceAll("44px", "")), false);
  const fieldAt = css.indexOf(".cover-autoplay-field {");
  const fieldEnd = css.indexOf("/* Early holder hover card.", fieldAt);
  assert.ok(fieldAt !== -1 && fieldEnd !== -1);
  const field = css.slice(fieldAt, fieldEnd);
  assert.match(field, /Autoplay polygon videos for creators holding|cover-autoplay-label/);
  assert.match(field, /--fu:/);
  assert.match(field, /--ui-label:/);
  assert.match(field, /--ui-small:/);
  assert.match(field, /#22D3EE/);
  assert.equal(/\d+px/.test(field), false);
});

test("the latest valid admin autoplay message wins, and a clear beats an older set", () => {
  const admins = ["0.0.2"];
  const set = JSON.parse(autoplayConfigMessage("0.0.50"));
  const cleared = JSON.parse(autoplayConfigMessage(""));
  assert.deepEqual(set, { autoplayNft: "0.0.50" });
  assert.deepEqual(cleared, { autoplayNft: "" });
  assert.equal(autoplayConfigMessage("hbar"), "");
  assert.equal(autoplayConfigMessage("0.0.50 "), '{"autoplayNft":"0.0.50"}');
  const messages = [
    { payer: "0.0.2", autoplayNft: "0.0.11" },
    { payer: "0.0.9", autoplayNft: "0.0.22" },
    { payer: "0.0.2", changeName: "Keep" },
    { payer: "0.0.2", ...set },
    { payer: "0.0.2", autoplayNft: "not-a-token" },
    { payer: "0.0.8", ...cleared },
  ];
  assert.equal(currentAutoplayNft(messages, admins), "0.0.50");
  messages.push({ payer: "0.0.2", autoplayNft: "" });
  assert.equal(currentAutoplayNft(messages, admins), "");
  messages.push({ payer: "0.0.2", autoplayNft: "0.0.60" });
  assert.equal(currentAutoplayNft(messages, admins), "0.0.60");
  assert.equal(currentAutoplayNft(messages, []), "0.0.60");
  assert.equal(currentAutoplayNft([{ payer: "0.0.4", autoplayNft: "0.0.1" }], []), "0.0.1");
  assert.equal(currentAutoplayNft([{ payer: "0.0.4", autoplayNft: "0.0.1" }], ["0.0.2"]), "");
  assert.equal(currentAutoplayNft(null, admins), "");
});

test("holder lookups are batched per creator and token and cached for 10 minutes", async () => {
  clearAutoplayState();
  rememberTopicAutoplay("0.0.10", "0.0.77");
  rememberTopicAutoplay("0.0.12", "");
  const onScreen = [
    { topicId: "0.0.10", payer: "0.0.2" },
    { topicId: "0.0.10", payer: "0.0.2" },
    { topicId: "0.0.10", payer: "0.0.3" },
    { topicId: "0.0.12", payer: "0.0.4" },
    { payer: "0.0.2" },
  ];
  assert.deepEqual(holdQueriesFor(onScreen, 5_000), [
    { account: "0.0.2", token: "0.0.77" },
    { account: "0.0.3", token: "0.0.77" },
  ]);
  const urls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = lookupHolds(holdQueriesFor(onScreen, 5_000), (url) => {
    urls.push(url);
    return gate.then(() => ({
      ok: true,
      json: async () => ({ nfts: url.includes("/accounts/0.0.2/") ? [{ token_id: "0.0.77" }] : [] }),
    }));
  }, 5_000);
  const again = lookupHolds([{ account: "0.0.2", token: "0.0.77" }], () => {
    throw new Error("duplicate");
  }, 5_000);
  release();
  await pending;
  await again;
  assert.deepEqual(urls, [
    mirrorHoldUrl("0.0.2", "0.0.77"),
    mirrorHoldUrl("0.0.3", "0.0.77"),
  ]);
  assert.equal(urls[0].includes("/accounts/0.0.2/nfts?token.id=0.0.77"), true);
  assert.equal(shouldAutoplayCover({ topicId: "0.0.10", payer: "0.0.2" }, open, 5_000), true);
  assert.equal(shouldAutoplayCover({ topicId: "0.0.10", payer: "0.0.3" }, open, 5_000), false);
  assert.deepEqual(holdQueriesFor(onScreen, 5_000), []);
  assert.equal(cachedHold("0.0.3", "0.0.77", 5_000 + AUTOPLAY_HOLD_MS - 1), false);
  assert.equal(holdQueriesFor(onScreen, 5_000 + AUTOPLAY_HOLD_MS).length, 2);
});

test("a failed holder lookup is not treated as a hold and retries later", async () => {
  clearAutoplayState();
  rememberTopicAutoplay("0.0.10", "0.0.77");
  let calls = 0;
  await lookupHolds([{ account: "0.0.2", token: "0.0.77" }], async () => {
    calls += 1;
    return { ok: false, status: 500, json: async () => ({}) };
  }, 10);
  assert.equal(cachedHold("0.0.2", "0.0.77", 10), null);
  assert.equal(shouldAutoplayCover({ topicId: "0.0.10", payer: "0.0.2" }, open, 10), false);
  assert.deepEqual(holdQueriesFor([{ topicId: "0.0.10", payer: "0.0.2" }], 10 + AUTOPLAY_HOLD_RETRY_MS - 1), []);
  assert.equal(holdQueriesFor([{ topicId: "0.0.10", payer: "0.0.2" }], 10 + AUTOPLAY_HOLD_RETRY_MS).length, 1);
  assert.equal(calls, 1);
});

function holdQueryList(count) {
  const queries = [];
  for (let i = 1; i <= count; i++) queries.push({ account: `0.0.${i}`, token: "0.0.77" });
  return queries;
}

function mirrorOk(nfts) {
  return { ok: true, json: async () => ({ nfts }) };
}

test("holder lookups keep four mirror reads in flight", async () => {
  clearAutoplayState();
  assert.equal(MIRROR_HOLD_LIMIT, 4);
  let active = 0;
  let maxActive = 0;
  let started = 0;
  const releasers = [];
  const pending = lookupHolds(holdQueryList(6), () => {
    active += 1;
    started += 1;
    if (active > maxActive) maxActive = active;
    return new Promise((resolve) => {
      releasers.push(() => {
        active -= 1;
        resolve(mirrorOk([]));
      });
    });
  }, 1);
  assert.equal(started, MIRROR_HOLD_LIMIT);
  assert.equal(maxActive, MIRROR_HOLD_LIMIT);
  while (started < 6) {
    releasers.shift()();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(active <= MIRROR_HOLD_LIMIT, true);
  }
  assert.equal(started, 6);
  assert.equal(maxActive, MIRROR_HOLD_LIMIT);
  while (releasers.length) releasers.shift()();
  await pending;
  assert.equal(cachedHold("0.0.6", "0.0.77", 1), false);
});

test("a 429 waits out Retry-After and retries instead of caching a miss", async () => {
  clearAutoplayState();
  rememberTopicAutoplay("0.0.10", "0.0.77");
  let calls = 0;
  let secondStarted = false;
  const pending = lookupHolds([
    { account: "0.0.2", token: "0.0.77" },
    { account: "0.0.3", token: "0.0.77" },
    { account: "0.0.4", token: "0.0.77" },
    { account: "0.0.5", token: "0.0.77" },
    { account: "0.0.6", token: "0.0.77" },
  ], (url) => {
    calls += 1;
    if (url.includes("/accounts/0.0.6/")) secondStarted = true;
    if (url.includes("/accounts/0.0.2/") && calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: (name) => (String(name).toLowerCase() === "retry-after" ? "0.05" : null) },
      };
    }
    return Promise.resolve(mirrorOk([]));
  }, 20);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(secondStarted, false);
  await pending;
  assert.equal(secondStarted, true);
  assert.equal(cachedHold("0.0.2", "0.0.77", 20), false);
  assert.equal(shouldAutoplayCover({ topicId: "0.0.10", payer: "0.0.2" }, open, 20), false);
  clearAutoplayState();
  rememberTopicAutoplay("0.0.10", "0.0.77");
  let retried = 0;
  await lookupHolds([{ account: "0.0.2", token: "0.0.77" }], async () => {
    retried += 1;
    if (retried === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => "0" },
      };
    }
    return mirrorOk([{ token_id: "0.0.77" }]);
  }, 30);
  assert.equal(retried, 2);
  assert.equal(cachedHold("0.0.2", "0.0.77", 30), true);
  assert.equal(shouldAutoplayCover({ topicId: "0.0.10", payer: "0.0.2" }, open, 30), true);
});

test("repeated 429s give up after four tries and are not a hold", async () => {
  clearAutoplayState();
  rememberTopicAutoplay("0.0.10", "0.0.77");
  let calls = 0;
  await lookupHolds([{ account: "0.0.2", token: "0.0.77" }], async () => {
    calls += 1;
    return { ok: false, status: 429, headers: { get: () => "0" } };
  }, 40);
  assert.equal(calls, 4);
  assert.equal(cachedHold("0.0.2", "0.0.77", 40), null);
  assert.equal(shouldAutoplayCover({ topicId: "0.0.10", payer: "0.0.2" }, open, 40), false);
  assert.deepEqual(holdQueriesFor([{ topicId: "0.0.10", payer: "0.0.2" }], 40 + AUTOPLAY_HOLD_RETRY_MS - 1), []);
});

test("only a live NON_FUNGIBLE_UNIQUE token can be saved", async () => {
  assert.equal(tokenIsUniqueNft({ type: "NON_FUNGIBLE_UNIQUE" }), true);
  assert.equal(tokenIsUniqueNft({ type: "NON_FUNGIBLE_UNIQUE", deleted: true }), false);
  assert.equal(tokenIsUniqueNft({ type: "FUNGIBLE_COMMON" }), false);
  assert.equal(tokenIsUniqueNft(null), false);
  const seen = [];
  const unique = await readUniqueNft("0.0.77", async (url) => {
    seen.push(url);
    return { ok: true, json: async () => ({ type: "NON_FUNGIBLE_UNIQUE", deleted: false }) };
  });
  const fungible = await readUniqueNft("0.0.78", async () => ({
    ok: true,
    json: async () => ({ type: "FUNGIBLE_COMMON" }),
  }));
  assert.equal(unique, true);
  assert.equal(fungible, false);
  assert.equal(await readUniqueNft("nope", async () => { throw new Error("skip"); }), false);
  assert.equal(seen[0].endsWith("/api/v1/tokens/0.0.77"), true);
});

test("the most visible eligible cover is the one that may play", () => {
  const rows = [
    { id: "sliver", eligible: true, score: 20 },
    { id: "wide", eligible: true, score: 800 },
    { id: "off", eligible: false, score: 9000 },
    { id: "none", eligible: true, score: 0 },
  ];
  assert.equal(pickAutoplayCover(rows), "wide");
  assert.equal(pickAutoplayCover(rows, "sliver"), "wide");
  assert.equal(pickAutoplayCover([
    { id: "a", eligible: true, score: 40 },
    { id: "b", eligible: true, score: 40 },
  ], "b"), "b");
  assert.equal(pickAutoplayCover([]), null);
  assert.equal(coverScreenScore({ centerInside: true }, { w: 100, h: 40 }), 4000);
  assert.equal(coverScreenScore({ minX: -10, minY: 0, maxX: 30, maxY: 20 }, { w: 100, h: 40 }), 600);
  assert.equal(coverScreenScore({ minX: 200, minY: 0, maxX: 240, maxY: 20 }, { w: 100, h: 40 }), 0);
});

test("topic load stores the autoplay token before drawings are published", () => {
  const source = fs.readFileSync(new URL("../processallmessages.js", import.meta.url), "utf8");
  const calls = source.split("rememberTopicAutoplay(topicId, currentAutoplayNft(messages, topicAdmin))").length - 1;
  assert.equal(calls, 3);
  const pushes = source.split("topicPolygons.push({").length - 1;
  assert.equal(pushes, 3);
  assert.equal(source.split("topicId: topicId,").length - 1 >= 3, true);
  const polygons = fs.readFileSync(new URL("../polygons.js", import.meta.url), "utf8");
  assert.match(polygons, /pickAutoplayCover\(rows, currentId\)/);
  assert.match(polygons, /holdQueriesFor\(onScreen\)/);
  assert.match(polygons, /playCover\(cov, true\)/);
  const rest = fs.readFileSync(new URL("../rest.js", import.meta.url), "utf8");
  assert.match(rest, /autoplayConfigMessage\(tokenId\)/);
  assert.match(rest, /readUniqueNft\(tokenId\)/);
  assert.match(rest, /sendMessage\(topicId, message\)/);
});
