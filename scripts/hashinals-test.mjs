// Early-Hashinal list and owner-map checks. Fetch is injected, so this
// does not call tier.bot or the mirror.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_MIRROR,
  buildEarlyList,
  collectInscriptions,
  createEarlyHashinals,
  inscriptionStamp,
  ownerMapFor,
  timestampsMatch,
  verifyInscriptions,
} from "../server/hashinals.js";

function json(body, status = 200, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        const key = Object.keys(headers).find((item) => item.toLowerCase() === String(name).toLowerCase());
        return key == null ? null : headers[key];
      },
    },
    json: async () => body,
    text: async () => JSON.stringify(body ?? ""),
  };
}

function row(n, extra = {}) {
  return {
    inscription_number: n,
    ht_id: "0.0.4848409",
    sn: n + 1,
    created_timestamp: "1709654845.655672003",
    ...extra,
  };
}

function record(number, tokenId, serial) {
  return {
    number,
    token_id: tokenId,
    serial,
    created_timestamp: "10.000000001",
  };
}

async function testStopsAt999() {
  const urls = [];
  let tierHits = 0;
  const list = await collectInscriptions({
    sleep: async () => {},
    fetch: async (url) => {
      urls.push(url);
      tierHits += 1;
      if (tierHits === 1) {
        const page = [];
        for (let n = 0; n < 100; n += 1) page.push(row(n));
        return json(page);
      }
      if (tierHits === 2) return json([row(998), row(999), row(1000), row(1001)]);
      throw new Error("inscription crawl asked for another page");
    },
  });
  assert.equal(urls.length, 2);
  const first = new URL(urls[0]);
  const second = new URL(urls[1]);
  assert.equal(first.searchParams.get("sort"), "asc");
  assert.equal(first.searchParams.get("limit"), "100");
  assert.equal(first.searchParams.get("inscriptionNumber"), null);
  assert.equal(second.searchParams.get("inscriptionNumber"), "99");
  const numbers = list.map((item) => item.number);
  assert.equal(numbers[0], 1);
  assert.equal(numbers[99], 100);
  assert.ok(numbers.includes(999));
  assert.ok(numbers.includes(1000));
  assert.equal(numbers.includes(1001), false);
  assert.equal(numbers.includes(1002), false);
  assert.equal(numbers.length, 102);

  const builtUrls = [];
  const built = await buildEarlyList({
    sleep: async () => {},
    mirror: DEFAULT_MIRROR,
    fetch: async (url) => {
      builtUrls.push(url);
      if (url.includes("tier.bot")) return json([row(998), row(999), row(1000)]);
      return json({ deleted: false, created_timestamp: "1709654845.655672003" });
    },
  });
  assert.deepEqual(built.map((item) => item.number), [999, 1000]);
  assert.equal(builtUrls.filter((url) => url.includes("tier.bot")).length, 1);
  assert.equal(builtUrls.filter((url) => url.includes("/nfts/")).length, 2);
  assert.equal(builtUrls.some((url) => url.includes("/nfts/1001")), false);
}

async function testTimestampMismatchDropped() {
  const stamp = inscriptionStamp({
    ts_raw: { low: 601154755, high: 398060038, unsigned: false },
    created_timestamp: 1709654845655672000,
  });
  assert.equal(stamp, "1709654845.655672003");
  assert.equal(timestampsMatch(stamp, "1709654845.655672003"), true);
  assert.equal(timestampsMatch("1709654845655672000", "1709654845.655672003"), false);

  const kept = await verifyInscriptions(
    [record(1, "0.0.1", 1), record(2, "0.0.1", 2), record(3, "0.0.1", 3), record(4, "0.0.1", 4)],
    {
      mirror: DEFAULT_MIRROR,
      sleep: async () => {},
      fetch: async (url) => {
        if (url.endsWith("/nfts/1")) return json({ deleted: false, created_timestamp: "10.000000002" });
        if (url.endsWith("/nfts/2")) return json({ deleted: true, created_timestamp: "10.000000001" });
        if (url.endsWith("/nfts/3")) return json("", 404);
        return json({ deleted: false, created_timestamp: "10.000000001" });
      },
    }
  );
  assert.deepEqual(kept.map((item) => item.number), [4]);

  await assert.rejects(
    () => verifyInscriptions([record(5, "0.0.1", 5)], {
      mirror: DEFAULT_MIRROR,
      sleep: async () => {},
      fetch: async () => json("nope", 500),
    }),
    (err) => err && err.status === 500
  );
}

async function testTreasuryAndDeletedSkipped() {
  let active = 0;
  let maxActive = 0;
  const owners = await ownerMapFor(
    [
      record(1, "0.0.7", 1),
      record(2, "0.0.7", 2),
      record(3, "0.0.7", 3),
      record(4, "0.0.7", 4),
    ],
    {
      mirror: DEFAULT_MIRROR,
      sleep: async () => {},
      fetch: async (url) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        if (!url.includes("/nfts")) return json({ treasury_account_id: "0.0.9" });
        return json({
          nfts: [
            { serial_number: 1, account_id: "0.0.9", deleted: false },
            { serial_number: 2, account_id: "0.0.3", deleted: true },
            { serial_number: 3, account_id: null, deleted: false },
            { serial_number: 4, account_id: "0.0.4", deleted: false },
          ],
          links: { next: null },
        });
      },
    }
  );
  assert.deepEqual(owners, { "0.0.4": 4 });
  assert.equal(maxActive, 1);
}

async function testLowestNumberWins() {
  const owners = await ownerMapFor(
    [record(5, "0.0.7", 1), record(2, "0.0.8", 7), record(9, "0.0.8", 8)],
    {
      mirror: DEFAULT_MIRROR,
      sleep: async () => {},
      fetch: async (url) => {
        if (url.endsWith("/api/v1/tokens/0.0.7")) return json({ treasury_account_id: "0.0.90" });
        if (url.endsWith("/api/v1/tokens/0.0.8")) return json({ treasury_account_id: "0.0.91" });
        if (url.includes("/tokens/0.0.7/nfts")) {
          return json({
            nfts: [{ serial_number: 1, account_id: "0.0.5", deleted: false }],
            links: { next: null },
          });
        }
        return json({
          nfts: [
            { serial_number: 7, account_id: "0.0.5", deleted: false },
            { serial_number: 8, account_id: "0.0.6", deleted: false },
          ],
          links: { next: null },
        });
      },
    }
  );
  assert.deepEqual(owners, { "0.0.5": 2, "0.0.6": 9 });
}

async function testFailedRefreshKeepsMap() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbs-hashinals-"));
  const list = [record(4, "0.0.7", 1), record(8, "0.0.7", 2)];
  let mode = "fail";
  let nftPages = 0;
  try {
    fs.writeFileSync(path.join(dir, "early-hashinals.json"), JSON.stringify(list));
    fs.writeFileSync(path.join(dir, "early-hashinal-owners.json"), JSON.stringify({
      owners: { "0.0.4": 4 },
      updatedAt: 50,
    }));
    const svc = createEarlyHashinals({
      dataDir: dir,
      now: () => 111,
      sleep: async () => {},
      mirror: DEFAULT_MIRROR,
      fetch: async (url) => {
        if (url.endsWith("/api/v1/tokens/0.0.7")) return json({ treasury_account_id: "0.0.9" });
        if (mode === "ok") {
          return json({
            nfts: [
              { serial_number: 1, account_id: "0.0.5", deleted: false },
              { serial_number: 2, account_id: "0.0.5", deleted: false },
            ],
            links: { next: null },
          });
        }
        nftPages += 1;
        if (nftPages >= 2) throw new Error("mirror down");
        return json({
          nfts: [{ serial_number: 1, account_id: "0.0.8", deleted: false }],
          links: { next: "/api/v1/tokens/0.0.7/nfts?limit=100&serialnumber=gt:1" },
        });
      },
    });
    svc.load();
    assert.deepEqual(svc.snapshot(), { owners: { "0.0.4": 4 }, updatedAt: 50 });
    await assert.rejects(() => svc.refreshOwners(), /mirror down/);
    assert.equal(svc.inflight, null);
    assert.deepEqual(svc.snapshot(), { owners: { "0.0.4": 4 }, updatedAt: 50 });
    mode = "ok";
    nftPages = 0;
    await svc.refreshOwners();
    assert.deepEqual(svc.snapshot().owners, { "0.0.5": 4 });
    assert.equal(svc.snapshot().updatedAt, 111);
    assert.equal(svc.inflight, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testListFileSkipsRebuild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbs-hashinals-"));
  try {
    const stored = [record(7, "0.0.3", 9)];
    fs.writeFileSync(path.join(dir, "early-hashinals.json"), JSON.stringify(stored));
    let calls = 0;
    const ready = createEarlyHashinals({
      dataDir: dir,
      fetch: async () => {
        calls += 1;
        throw new Error("should not rebuild a valid list");
      },
    });
    ready.load();
    const loaded = await ready.ensureList();
    assert.equal(calls, 0);
    assert.deepEqual(loaded, stored);

    fs.writeFileSync(path.join(dir, "early-hashinals.json"), "{");
    const again = createEarlyHashinals({
      dataDir: dir,
      sleep: async () => {},
      mirror: DEFAULT_MIRROR,
      fetch: async (url) => {
        calls += 1;
        if (url.includes("tier.bot")) return json([row(4)]);
        return json({ deleted: false, created_timestamp: "1709654845.655672003" });
      },
    });
    again.load();
    const rebuilt = await again.ensureList();
    assert.equal(rebuilt.length, 1);
    assert.equal(rebuilt[0].number, 5);
    assert.ok(calls > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testBackoffOn429() {
  const waits = [];
  let hits = 0;
  const list = await collectInscriptions({
    sleep: async (ms) => {
      waits.push(ms);
    },
    fetch: async () => {
      hits += 1;
      if (hits === 1) return json("", 429, { "retry-after": "0" });
      return json([row(999)]);
    },
  });
  assert.deepEqual(waits, [0]);
  assert.deepEqual(list.map((item) => item.number), [1000]);
}

export async function runHashinalTests() {
  await testStopsAt999();
  await testTimestampMismatchDropped();
  await testTreasuryAndDeletedSkipped();
  await testFailedRefreshKeepsMap();
  await testLowestNumberWins();
  await testListFileSkipsRebuild();
  await testBackoffOn429();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runHashinalTests();
  console.log("early hashinal tests passed");
}
