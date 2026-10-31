// Following picker state. No network and no DOM.
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  FOLLOWING_CACHE_MS,
  FOLLOWING_RETRY_MS,
  createFollowingStore,
  followingCountText,
  followingEmptyText,
  seeAllQuery,
} from "../followingstate.js";

const WALLET = "0.0.9779355";
const FOLLOWEE = "0.0.981180";

function list(ids) {
  return {
    accounts: ids.map((id) => ({ id, username: id })),
    topics: [],
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function testNullIsOfflineNotEmpty() {
  let calls = 0;
  let now = 1_000_000;
  const store = createFollowingStore({
    getAccount: () => WALLET,
    now: () => now,
    delay: () => Promise.resolve(),
    fetchFollowing: async () => {
      calls += 1;
      return null;
    },
  });
  const data = await store.ensureData(true);
  assert.equal(data, null);
  assert.equal(calls, 2);
  assert.equal(store.followingStatus(), "offline");
  assert.equal(store.getData(), null);
  assert.equal(followingEmptyText("offline", 0, 0), "Couldn't load who you follow. Tap to retry");
  assert.notEqual(followingEmptyText("offline", 0, 0), "Not following anyone yet");
  assert.equal(followingCountText("offline", 0), "");
  const again = await store.ensureData(false);
  assert.equal(again, null);
  assert.equal(calls, 2);
  assert.equal(store.followingStatus(), "offline");
  now += FOLLOWING_CACHE_MS;
  assert.notEqual(store.followingStatus(), "offline");
  assert.notEqual(store.followingStatus(), "ready");
}

async function testNoWalletIsNowallet() {
  let calls = 0;
  const store = createFollowingStore({
    getAccount: () => null,
    fetchFollowing: async () => {
      calls += 1;
      return list([FOLLOWEE]);
    },
  });
  const data = await store.ensureData(true);
  assert.equal(data, null);
  assert.equal(calls, 0);
  assert.equal(store.followingStatus(), "nowallet");
  assert.equal(store.getData(), null);
  assert.equal(followingEmptyText("nowallet", 0, 0), "Connect your wallet to see who you follow");
  assert.equal(followingCountText("nowallet", 0), "");
  assert.equal(followingEmptyText("loading", 0, 0), "Loading");
  assert.equal(followingCountText("loading", 0), "");
}

async function testRetryOnceOnNull() {
  let calls = 0;
  const waits = [];
  const store = createFollowingStore({
    getAccount: () => WALLET,
    delay: (ms) => {
      waits.push(ms);
      assert.equal(store.followingStatus(), "loading");
      return Promise.resolve();
    },
    fetchFollowing: async () => {
      calls += 1;
      if (calls === 1) return null;
      return list([FOLLOWEE]);
    },
  });
  const data = await store.ensureData(true);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [FOLLOWING_RETRY_MS]);
  assert.equal(store.followingStatus(), "ready");
  assert.equal(data.accounts[0].id, FOLLOWEE);
  assert.equal(store.getData().accounts[0].id, FOLLOWEE);
  store.clearFollowingFailure();
  assert.equal(store.followingStatus(), "ready");
}

async function testRetryThenClearFailure() {
  let calls = 0;
  let fail = true;
  const store = createFollowingStore({
    getAccount: () => WALLET,
    delay: () => Promise.resolve(),
    fetchFollowing: async () => {
      calls += 1;
      if (fail) return null;
      return list([FOLLOWEE]);
    },
  });
  assert.equal(await store.ensureData(true), null);
  assert.equal(calls, 2);
  assert.equal(store.followingStatus(), "offline");
  store.clearFollowingFailure();
  assert.notEqual(store.followingStatus(), "offline");
  fail = false;
  const data = await store.ensureData(true);
  assert.equal(calls, 3);
  assert.equal(store.followingStatus(), "ready");
  assert.equal(data.accounts.length, 1);
  const emptyStore = createFollowingStore({
    getAccount: () => WALLET,
    fetchFollowing: async () => ({ accounts: [], topics: [] }),
  });
  const empty = await emptyStore.ensureData(true);
  assert.equal(emptyStore.followingStatus(), "ready");
  assert.equal(emptyStore.getData().accounts.length, 0);
  assert.deepEqual(empty, { accounts: [], topics: [] });
  assert.equal(followingEmptyText("ready", 0, 0), "Not following anyone yet");
  assert.equal(followingCountText("ready", 0), "0 following");
}

async function testRefreshAfterSettle() {
  let phase = "old";
  const updates = [];
  const store = createFollowingStore({
    getAccount: () => WALLET,
    delay: () => Promise.resolve(),
    onUpdated: () => updates.push(store.getData()),
    fetchFollowing: async () => {
      if (phase === "fail") return null;
      if (phase === "new") return list(["0.0.1", FOLLOWEE]);
      return list(["0.0.1"]);
    },
  });
  await store.ensureData(true);
  assert.equal(store.getData().accounts.length, 1);

  const immediate = store.refreshFollowing();
  await immediate;
  assert.equal(store.followingStatus(), "ready");
  assert.equal(store.getData().accounts.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].accounts.length, 1);

  async function settleFollow() {
    phase = "new";
    return true;
  }
  await settleFollow();
  await store.refreshFollowing();
  assert.equal(store.followingStatus(), "ready");
  assert.equal(store.getData().accounts.length, 2);
  assert.equal(store.getData().accounts[1].id, FOLLOWEE);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].accounts[1].id, FOLLOWEE);

  phase = "fail";
  await store.refreshFollowing();
  assert.equal(store.followingStatus(), "offline");
  assert.equal(store.getData(), null);
  assert.equal(updates[updates.length - 1], null);
}

async function testNewerRefreshPublishes() {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const updates = [];
  const store = createFollowingStore({
    getAccount: () => WALLET,
    onUpdated: () => updates.push(store.followingStatus()),
    fetchFollowing: () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    },
  });
  const stale = store.refreshFollowing();
  const current = store.refreshFollowing();
  first.resolve(list(["0.0.9"]));
  await stale;
  assert.equal(updates.length, 0);
  assert.equal(store.getData(), null);
  second.resolve(list([FOLLOWEE]));
  await current;
  assert.deepEqual(updates, ["ready"]);
  assert.equal(store.getData().accounts[0].id, FOLLOWEE);
}

function testSeeAllIgnoresAccountId() {
  assert.equal(seeAllQuery("0.0.981180"), "");
  assert.equal(seeAllQuery("  0.0.10923187  "), "");
  assert.equal(seeAllQuery("ada"), "ada");
  assert.equal(seeAllQuery("0.0.981180 extra"), "0.0.981180 extra");
  assert.equal(seeAllQuery(""), "");
  assert.equal(seeAllQuery(null), "");
}

function testFollowTopicRefreshesAfterSettle() {
  const source = fs.readFileSync(new URL("../followtopic.js", import.meta.url), "utf8");
  const send = source.indexOf("refreshFollowing();");
  const wait = source.indexOf("await settleFollow(", send);
  const again = source.indexOf("refreshFollowing();", wait);
  assert.notEqual(send, -1);
  assert.ok(wait > send);
  assert.ok(again > wait);
  const follow = fs.readFileSync(new URL("../followsuggest.js", import.meta.url), "utf8");
  assert.match(follow, /export function followingStatus\(/);
  assert.match(follow, /createFollowingStore\(/);
  assert.match(follow, /seeAllQuery\(/);
  const picker = fs.readFileSync(new URL("../picker.js", import.meta.url), "utf8");
  assert.match(picker, /followingStatus\(/);
  assert.match(picker, /FOLLOWING_UPDATED/);
  assert.match(picker, /clearFollowingFailure\(/);
  assert.match(picker, /followingEmptyText\('loading'/);
}

export async function runPickerStateTests() {
  await testNullIsOfflineNotEmpty();
  await testNoWalletIsNowallet();
  await testRetryOnceOnNull();
  await testRetryThenClearFailure();
  await testRefreshAfterSettle();
  await testNewerRefreshPublishes();
  testSeeAllIgnoresAccountId();
  testFollowTopicRefreshesAfterSettle();
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const underTest = !!process.env.NODE_TEST_CONTEXT;
if (!underTest && direct) {
  await runPickerStateTests();
  console.log("picker state tests passed");
}

if (underTest) {
  const { default: test } = await import("node:test");
  test("null fetch is offline, not an empty follow list", testNullIsOfflineNotEmpty);
  test("no wallet is nowallet", testNoWalletIsNowallet);
  test("a null fetch retries once", testRetryOnceOnNull);
  test("clearing a failure allows another fetch", testRetryThenClearFailure);
  test("refresh after settle stores the confirmed list", testRefreshAfterSettle);
  test("a newer refresh is the one that publishes", testNewerRefreshPublishes);
  test("see all ignores a pasted account id", testSeeAllIgnoresAccountId);
  test("followtopic refreshes again after settleFollow", testFollowTopicRefreshesAfterSettle);
}
