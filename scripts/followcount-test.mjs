// Follower-count cache. No network and no DOM.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createFollowLoader, followerCountOrNull } from "../followcount.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function testUnknownIsNull() {
  const loader = createFollowLoader({ fetchCount: () => ({ followers: 1, following: false }) });
  assert.equal(loader.cached("0.0.1", ""), null);
  assert.equal(loader.cached("0.0.1", "0.0.2"), null);
  assert.equal(followerCountOrNull(undefined), null);
  assert.equal(followerCountOrNull(null), null);
  assert.equal(followerCountOrNull(Number.NaN), null);
  assert.equal(followerCountOrNull(-1), null);
  assert.equal(followerCountOrNull(Number.POSITIVE_INFINITY), null);
  assert.equal(followerCountOrNull("0"), null);
  assert.equal(followerCountOrNull(0), 0);
}

async function testRealZeroIsStored() {
  let calls = 0;
  const loader = createFollowLoader({
    fetchCount: () => {
      calls += 1;
      return { followers: 0, following: false };
    },
  });
  const data = await loader.load("0.0.9", "0.0.1");
  assert.equal(data.followers, 0);
  assert.equal(data.following, false);
  assert.equal(loader.cached("0.0.9", "0.0.1").followers, 0);
  assert.equal(calls, 1);
}

async function testCacheThenBackgroundRefresh() {
  const gate = deferred();
  let calls = 0;
  const loader = createFollowLoader({
    fetchCount: () => {
      calls += 1;
      if (calls === 1) return { followers: 4, following: true };
      return gate.promise;
    },
  });
  const first = await loader.load("0.0.4", "0.0.8");
  assert.equal(first.followers, 4);
  assert.equal(loader.cached("0.0.4", "0.0.8").followers, 4);
  assert.equal(loader.cached("0.0.4", "0.0.8").following, true);
  const second = loader.load("0.0.4", "0.0.8");
  assert.equal(calls, 2);
  assert.equal(loader.cached("0.0.4", "0.0.8").followers, 4);
  gate.resolve({ followers: 9, following: false });
  const next = await second;
  assert.equal(next.followers, 9);
  assert.equal(next.following, false);
  assert.equal(loader.cached("0.0.4", "0.0.8").followers, 9);
}

async function testParallelLoadSharesOneFlight() {
  const gate = deferred();
  let calls = 0;
  const loader = createFollowLoader({
    fetchCount: () => {
      calls += 1;
      return gate.promise;
    },
  });
  const first = loader.load("0.0.3", "0.0.1");
  const second = loader.load("0.0.3", "0.0.1");
  assert.equal(first, second);
  assert.equal(calls, 1);
  gate.resolve({ followers: 3, following: true });
  const data = await first;
  assert.equal(data.followers, 3);
  assert.equal(data.following, true);
  assert.equal(calls, 1);
  await second;
  assert.equal(calls, 1);
}

async function testRetryOnceThenStore() {
  let calls = 0;
  const loader = createFollowLoader({
    fetchCount: () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return { followers: 6, following: true };
    },
  });
  const data = await loader.load("0.0.6", "");
  assert.equal(calls, 2);
  assert.equal(data.followers, 6);
  assert.equal(loader.cached("0.0.6", "").followers, 6);
  assert.equal(loader.cached("0.0.6", "").following, true);
}

async function testTwoFailuresKeepLastCount() {
  let calls = 0;
  let fail = false;
  const loader = createFollowLoader({
    fetchCount: () => {
      calls += 1;
      if (fail) return null;
      return { followers: 4, following: true };
    },
  });
  await loader.load("0.0.4", "0.0.2");
  fail = true;
  const again = await loader.load("0.0.4", "0.0.2");
  assert.equal(again, null);
  assert.equal(calls, 3);
  const hit = loader.cached("0.0.4", "0.0.2");
  assert.equal(hit.followers, 4);
  assert.equal(hit.following, true);
  assert.equal(loader.remember("0.0.4", "0.0.2", { followers: -1, following: false }), null);
  assert.equal(loader.cached("0.0.4", "0.0.2").followers, 4);
}

async function testTwoFailuresStayEmpty() {
  let calls = 0;
  const loader = createFollowLoader({
    fetchCount: () => {
      calls += 1;
      return null;
    },
  });
  const data = await loader.load("0.0.7", "0.0.1");
  assert.equal(data, null);
  assert.equal(calls, 2);
  assert.equal(loader.cached("0.0.7", "0.0.1"), null);
  assert.equal(loader.remember("0.0.7", "0.0.1", { followers: Number.NaN, following: true }), null);
  assert.equal(loader.cached("0.0.7", "0.0.1"), null);
}

export async function runFollowCountTests() {
  testUnknownIsNull();
  await testRealZeroIsStored();
  await testCacheThenBackgroundRefresh();
  await testParallelLoadSharesOneFlight();
  await testRetryOnceThenStore();
  await testTwoFailuresKeepLastCount();
  await testTwoFailuresStayEmpty();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runFollowCountTests();
  console.log("follower count tests passed");
}
