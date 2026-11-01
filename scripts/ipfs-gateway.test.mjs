// IPFS images start on the first gateway. Known bad hosts are rewritten there.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { advanceIpfsImage, armIpfsAttempt, clearIpfsAttempt, IPFS_ATTEMPT_MS, preferGateway } from "../ipfsimage.js";

const CID = "Qm" + "a".repeat(44);
const CIDV1 = "bafy" + "a".repeat(48);
const FIRST = "https://ipfs.filebase.io/ipfs/" + CID;
const ORDER = [
  "ipfs.filebase.io",
  "gateway.pinata.cloud",
  "4everland.io",
  "ipfs.io",
  "dweb.link",
];

function fakeImg(src) {
  const img = {
    dataset: {},
    currentSrc: "",
    src,
    getAttribute(name) {
      return name === "src" ? img.src : null;
    },
  };
  return img;
}

function hostsFrom(src) {
  const img = fakeImg(src);
  const hosts = [];
  while (advanceIpfsImage(img)) hosts.push(new URL(img.src).host);
  return hosts;
}

test("gateways are tried in order and the redirecting hosts are gone", () => {
  const hosts = hostsFrom("https://example.com/ipfs/" + CID + "/a.png");
  assert.deepEqual(hosts, ORDER);
  assert.equal(hosts.includes("w3s.link"), false);
  assert.equal(hosts.includes("nftstorage.link"), false);
  const img = fakeImg("https://w3s.link/ipfs/" + CID + "/a.png");
  assert.equal(advanceIpfsImage(img), true);
  assert.equal(img.src, "https://ipfs.filebase.io/ipfs/" + CID + "/a.png");
});

test("recognised IPFS urls are rewritten to the first gateway", () => {
  const cases = [
    "ipfs://" + CID,
    "ipfs://" + CID + "/pic.png",
    "https://ipfs.io/ipfs/" + CID,
    "https://dweb.link/ipfs/" + CID + "/pic.png",
    "https://w3s.link/ipfs/" + CID,
    "https://nftstorage.link/ipfs/" + CID + "/pic.png",
    "https://gateway.lighthouse.storage/ipfs/" + CID,
    "https://" + CIDV1 + ".ipfs.w3s.link/pic.png",
  ];
  assert.equal(preferGateway(cases[0]), FIRST);
  assert.equal(preferGateway(cases[1]), FIRST + "/pic.png");
  assert.equal(preferGateway(cases[2]), FIRST);
  assert.equal(preferGateway(cases[3]), FIRST + "/pic.png");
  assert.equal(preferGateway(cases[4]), FIRST);
  assert.equal(preferGateway(cases[5]), FIRST + "/pic.png");
  assert.equal(preferGateway(cases[6]), FIRST);
  assert.equal(preferGateway(cases[7]), "https://ipfs.filebase.io/ipfs/" + CIDV1 + "/pic.png");

  assert.equal(preferGateway("https://gateway.pinata.cloud/ipfs/" + CID), "");
  assert.equal(preferGateway("https://ipfs.filebase.io/ipfs/" + CID), "");
  assert.equal(preferGateway("https://4everland.io/ipfs/" + CID + "/a.png"), "");
  assert.equal(preferGateway("https://kiloscribe.com/api/inscription-cdn/0.0.4819119"), "");
  assert.equal(preferGateway(""), "");
});

test("a canvas image is pointed at the first gateway before it loads", () => {
  const source = fs.readFileSync(new URL("../polygons.js", import.meta.url), "utf8");
  const start = source.indexOf("function createResizedImage");
  assert.notEqual(start, -1);
  let depth = 0;
  let started = false;
  let end = start;
  for (; end < source.length; end++) {
    const ch = source[end];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) {
        end += 1;
        break;
      }
    }
  }
  const body = source.slice(start, end);
  assert.equal(body.includes("img.src = preferGateway(imageUrl) || imageUrl;"), true);
  const onerror = body.indexOf("img.onerror");
  const advance = body.indexOf("advanceIpfsImage(img)", onerror);
  const fallbackAssign = body.indexOf("img.src = fallbackUrl", onerror);
  assert.ok(onerror !== -1 && advance !== -1 && advance < fallbackAssign);
  assert.match(body, /if \(advanceIpfsImage\(img\)\) return;/);
  assert.match(source, /const COVER_FALLBACK = "https:\/\/kiloscribe.com\/api\/inscription-cdn\/0\.0\.4819119"/);
  const onload = body.indexOf("img.onload");
  const clearOnLoad = body.indexOf("clearIpfsAttempt(img)", onload);
  const clearOnError = body.indexOf("clearIpfsAttempt(img)", onerror);
  const arm = body.indexOf("armIpfsAttempt(img)", fallbackAssign);
  assert.ok(onload !== -1 && clearOnLoad !== -1 && clearOnLoad < onerror);
  assert.ok(clearOnError !== -1 && clearOnError < advance);
  assert.ok(arm !== -1);
});

test("a gateway that is still loading steps on after 4 seconds", () => {
  assert.equal(IPFS_ATTEMPT_MS, 4000);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const stalled = fakeImg(FIRST + "/a.png");
    stalled.complete = false;
    armIpfsAttempt(stalled);
    mock.timers.tick(IPFS_ATTEMPT_MS - 1);
    assert.equal(new URL(stalled.src).host, "ipfs.filebase.io");
    mock.timers.tick(1);
    assert.equal(new URL(stalled.src).host, "gateway.pinata.cloud");

    const loaded = fakeImg(FIRST + "/b.png");
    loaded.complete = false;
    armIpfsAttempt(loaded);
    loaded.complete = true;
    clearIpfsAttempt(loaded);
    mock.timers.tick(IPFS_ATTEMPT_MS);
    assert.equal(new URL(loaded.src).host, "ipfs.filebase.io");

    const failed = fakeImg(FIRST + "/c.png");
    failed.complete = false;
    armIpfsAttempt(failed);
    clearIpfsAttempt(failed);
    mock.timers.tick(IPFS_ATTEMPT_MS);
    assert.equal(new URL(failed.src).host, "ipfs.filebase.io");

    const canvas = fakeImg(FIRST + "/d.png");
    canvas.complete = false;
    canvas.dataset.canvasImage = "1";
    let errors = 0;
    canvas.onerror = () => {
      errors += 1;
      clearIpfsAttempt(canvas);
      advanceIpfsImage(canvas);
    };
    armIpfsAttempt(canvas);
    mock.timers.tick(IPFS_ATTEMPT_MS);
    assert.equal(errors, 1);
    assert.equal(new URL(canvas.src).host, "gateway.pinata.cloud");
  } finally {
    mock.timers.reset();
  }
});
