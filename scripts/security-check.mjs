// Starts a throwaway API with dummy storage credentials and checks the
// upload guards. The real server/.env is not overwritten: values already
// in this process win, and dotenv does not replace them.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { runHashinalTests } from "./hashinals-test.mjs";
import { runFollowCountTests } from "./followcount-test.mjs";
import { runHcsChunkTests } from "./hcschunks-test.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT, "server");
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const HISTORY_TOPIC = "0.0.4242424242";
const SUBMIT_TOPIC = "0.0.808080808";
const HISTORY_COUNT = 2500;
const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });

if (process.env.SECURITY_CLIENT === "1") {
  const code = await runClientCheck();
  process.exit(code);
}

const failures = [];

function pass(name) {
  console.log(`PASS ${name}`);
}

function fail(name, detail) {
  const line = detail ? `${name}: ${detail}` : name;
  failures.push(line);
  console.error(`FAIL ${line}`);
}

function nodeInfo(bin) {
  try {
    const version = execFileSync(bin, ["-p", "process.versions.node"], { encoding: "utf8" }).trim();
    const parts = version.split(".");
    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
    return { bin, version, major, minor };
  } catch {
    return null;
  }
}

function nodeIs2216(info) {
  return info.major > 22 || (info.major === 22 && info.minor >= 16);
}

function findServerNode() {
  const candidates = new Set();
  const add = (bin) => {
    if (bin && fs.existsSync(bin)) candidates.add(path.resolve(bin));
  };
  add(process.execPath);
  add("C:\\Program Files\\nodejs\\node.exe");
  try {
    const listed = execFileSync("where.exe", ["node"], { encoding: "utf8" });
    for (const line of listed.split(/\r?\n/)) add(line.trim());
  } catch {
    /* where.exe can miss a portable node */
  }
  const homes = [process.env.NVM_HOME, process.env.FNM_DIR, process.env.NVS_HOME].filter(Boolean);
  for (const home of homes) {
    if (!fs.existsSync(home)) continue;
    for (const entry of fs.readdirSync(home)) {
      if (!/^v?\d+/.test(entry)) continue;
      add(path.join(home, entry, "node.exe"));
      add(path.join(home, entry, "installation", "node.exe"));
    }
  }
  const exec = path.resolve(process.execPath);
  let current = null;
  let best = null;
  for (const bin of candidates) {
    const info = nodeInfo(bin);
    if (!info || !nodeIs2216(info)) continue;
    if (path.resolve(bin) === exec) current = info;
    if (!best || info.major > best.major || (info.major === best.major && info.minor > best.minor)) best = info;
  }
  if (current) return current;
  if (best) return best;
  throw new Error("Node >= 22.16 is required to start the security server");
}

function declaredNodeOk(value) {
  const match = /^>=(\d+)\.(\d+)/.exec(String(value || "").trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 16);
}

function checkDeclaredNode() {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const serverPkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, "package.json"), "utf8"));
  const rootEngine = rootPkg.engines && rootPkg.engines.node;
  const serverEngine = serverPkg.engines && serverPkg.engines.node;
  if (declaredNodeOk(rootEngine) && declaredNodeOk(serverEngine)) {
    pass("engines require Node 22.16 or newer");
  } else {
    fail("engines require Node 22.16 or newer", `${rootEngine} / ${serverEngine}`);
  }
  const nvmrc = fs.readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim();
  const nvm = /^v?(\d+)\.(\d+)/.exec(nvmrc);
  if (nvm && (Number(nvm[1]) > 22 || (Number(nvm[1]) === 22 && Number(nvm[2]) >= 16))) {
    pass(`.nvmrc ${nvmrc} is 22.16 or newer`);
  } else {
    fail(".nvmrc is 22.16 or newer", nvmrc);
  }
}

function freePort(start, end = start + 20) {
  return new Promise((resolve, reject) => {
    if (start > end) {
      reject(new Error("no free port"));
      return;
    }
    const server = net.createServer();
    server.once("error", () => {
      resolve(freePort(start + 1, end));
    });
    server.listen(start, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function request(port, method, reqPath, { headers = {}, body = null, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: reqPath,
        headers,
        agent,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, text, headers: res.headers });
        });
      }
    );
    const timer = setTimeout(() => {
      req.destroy(new Error(`timeout ${method} ${reqPath}`));
    }, timeout);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on("close", () => clearTimeout(timer));
    if (body == null) req.end();
    else req.end(body);
  });
}

function postUpload(port, { type = "image/png", body = "x", token = "" } = {}) {
  const buf = Buffer.from(body);
  const headers = {
    "content-type": type,
    "content-length": String(buf.length),
  };
  if (token) headers["cf-turnstile-response"] = token;
  return request(port, "POST", "/api/upload", { headers, body: buf, timeout: 15000 });
}

function postOversize(port) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/upload",
        agent,
        headers: {
          "content-type": "image/png",
          "content-length": String(20 * 1024 * 1024 + 1),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          req.destroy();
          done(null, { status: res.statusCode, json, text });
        });
      }
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(new Error("timeout oversize upload"));
    }, 8000);
    req.on("error", (err) => {
      if (settled) return;
      clearTimeout(timer);
      done(err);
    });
    req.on("close", () => clearTimeout(timer));
    req.write("x");
  });
}

function dummyEnv(port, dataDir, extra = {}) {
  return {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    R2_ACCOUNT_ID: "dummyaccountid1234",
    R2_ACCESS_KEY_ID: "dummy-access-key",
    R2_SECRET_ACCESS_KEY: "dummy-secret-key",
    R2_BUCKET: "dummy-bucket",
    R2_PUBLIC_BASE_URL: "https://example.invalid/media",
    TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
    METERED_API_KEY: "",
    METERED_TURN_URL: "",
    REQUIRE_UPLOAD_AUTH: "",
    UPLOAD_TOKEN_SECRET: "",
    TRUST_CF_IP: "",
    EARLY_HASHINALS: "0",
    ...extra,
  };
}

function spawnServer(nodeBin, port, dataDir, extra = {}) {
  const child = spawn(nodeBin, ["boot.js"], {
    cwd: SERVER_DIR,
    env: dummyEnv(port, dataDir, extra),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  const take = (chunk) => {
    log += chunk.toString();
    if (log.length > 20000) log = log.slice(-12000);
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  child.log = () => log;
  return child;
}

async function waitForHealth(port, child) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (child.exitCode != null) {
      throw new Error(`server exited ${child.exitCode}\n${child.log()}`);
    }
    try {
      const res = await request(port, "GET", "/api/health", { timeout: 1000 });
      if (res.status === 200 && res.json && res.json.ok === true) return res;
    } catch {
      /* still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`health check timed out\n${child.log()}`);
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode != null) {
      resolve();
      return;
    }
    const finish = () => resolve();
    child.once("exit", finish);
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      if (child.exitCode == null && child.pid) {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
          /* the process already left */
        }
      }
      child.removeListener("exit", finish);
      resolve();
    }, 2500);
  });
}

function removeDir(dir) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
}

function insertHistory(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "data.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  const insert = db.prepare(
    "INSERT INTO messages (topic_id, seq, ts, payer, body) VALUES (?, ?, ?, ?, ?)"
  );
  db.exec("BEGIN");
  for (let seq = 1; seq <= HISTORY_COUNT; seq += 1) {
    insert.run(HISTORY_TOPIC, seq, String(1_700_000_000 + seq), "0.0.2", `{"n":${seq}}`);
  }
  db.prepare(
    "INSERT INTO topics (topic_id, last_seq, backfilled, last_active, memo) VALUES (?, ?, 1, ?, '')"
  ).run(HISTORY_TOPIC, HISTORY_COUNT, Date.now());
  db.exec("COMMIT");
  db.close();
}

function sequencesOf(messages) {
  return (messages || [])
    .map((message) => Number(message && message.sequence_number))
    .filter((seq) => seq > 0);
}

async function checkHistory(port) {
  const capped = await request(
    port,
    "GET",
    `/api/messages?topic=${HISTORY_TOPIC}&limit=20000`,
    { timeout: 8000 }
  );
  const cappedSeq = sequencesOf(capped.json && capped.json.messages);
  const cappedOk =
    capped.status === 200 &&
    capped.json &&
    capped.json.ready === true &&
    cappedSeq.length === 1000 &&
    cappedSeq[0] === HISTORY_COUNT - 999 &&
    cappedSeq[cappedSeq.length - 1] === HISTORY_COUNT;
  if (cappedOk) pass("history limit=20000 returns 1000");
  else fail("history limit=20000 returns 1000", `status ${capped.status} count ${cappedSeq.length} first ${cappedSeq[0]} last ${cappedSeq.at(-1)}`);

  const older = await request(
    port,
    "GET",
    `/api/messages?topic=${HISTORY_TOPIC}&limit=1000&before_seq=${HISTORY_COUNT - 999}`,
    { timeout: 8000 }
  );
  const olderSeq = sequencesOf(older.json && older.json.messages);
  const olderOk =
    older.status === 200 &&
    olderSeq.length === 1000 &&
    olderSeq[0] === HISTORY_COUNT - 1999 &&
    olderSeq.at(-1) === HISTORY_COUNT - 1000;
  if (olderOk) pass("history before_seq returns the next older page");
  else fail("history before_seq returns the next older page", `count ${olderSeq.length} first ${olderSeq[0]} last ${olderSeq.at(-1)}`);

  const tail = await request(
    port,
    "GET",
    `/api/messages?topic=${HISTORY_TOPIC}&limit=1000&before_seq=${HISTORY_COUNT - 1999}`,
    { timeout: 8000 }
  );
  const tailSeq = sequencesOf(tail.json && tail.json.messages);
  const tailOk = tail.status === 200 && tailSeq.length === 500 && tailSeq[0] === 1 && tailSeq.at(-1) === 500;
  if (tailOk) pass("history last page is shorter than 1000");
  else fail("history last page is shorter than 1000", `count ${tailSeq.length} first ${tailSeq[0]} last ${tailSeq.at(-1)}`);
}

function writeClientLoader(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "hooks.mjs"),
    [
      "export async function resolve(specifier, context, nextResolve) {",
      "  const relative = specifier.startsWith('./') || specifier.startsWith('../');",
      "  if (relative && !/\\.[mc]?js$/.test(specifier)) {",
      "    return nextResolve(specifier + '.js', context);",
      "  }",
      "  return nextResolve(specifier, context);",
      "}",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(dir, "register.mjs"),
    [
      'import { register } from "node:module";',
      "register(new URL('./hooks.mjs', import.meta.url).href, { parentURL: import.meta.url });",
      "",
    ].join("\n")
  );
}

function installMemoryIdb(topicId) {
  const databases = new Map();
  globalThis.indexedDB = {
    open(name, version) {
      const request = {};
      let database = databases.get(name);
      const upgrade = !database || database.version < version;
      if (!database) {
        database = { version: 0, stores: new Map() };
        databases.set(name, database);
      }
      database.objectStoreNames = {
        contains(storeName) {
          return database.stores.has(storeName);
        },
      };
      database.createObjectStore = (storeName) => {
        const records = new Map();
        database.stores.set(storeName, records);
        return { createIndex() {} };
      };
      database.transaction = (names) => makeTransaction(database, names);
      queueMicrotask(() => {
        request.result = database;
        if (upgrade) {
          database.version = version;
          if (request.onupgradeneeded) request.onupgradeneeded();
          seedHistory(database, topicId);
        }
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };
  globalThis.__securityClearIdb = () => {
    for (const database of databases.values()) {
      for (const records of database.stores.values()) records.clear();
    }
  };
}

function seedHistory(database, topicId) {
  const messages = database.stores.get("messages");
  const topics = database.stores.get("topics");
  if (!messages || !topics) return;
  const newest = HISTORY_COUNT;
  const oldest = newest - 999;
  for (let seq = oldest; seq <= newest; seq += 1) {
    messages.set(topicId + "\u0000" + seq, {
      key: topicId + "\u0000" + seq,
      topicId,
      sequence_number: seq,
      message: { sequence_number: seq, payer: "0.0.2", n: seq },
    });
  }
  topics.set(topicId, { topicId, lastSeq: newest, updatedAt: Date.now() });
}

function makeTransaction(database) {
  const tx = {};
  const jobs = [];
  tx.objectStore = (name) => {
    const records = database.stores.get(name);
    const store = {
      get(key) {
        const req = {};
        jobs.push(() => {
          req.result = records ? records.get(key) : undefined;
          if (req.onsuccess) req.onsuccess();
        });
        return req;
      },
      put(value) {
        if (!records) return;
        const key = value.key != null ? value.key : value.topicId;
        records.set(key, value);
      },
      index(indexName) {
        return {
          getAll(value) {
            const req = {};
            jobs.push(() => {
              req.result = records
                ? [...records.values()].filter((row) => row[indexName] === value)
                : [];
              if (req.onsuccess) req.onsuccess();
            });
            return req;
          },
        };
      },
    };
    return store;
  };
  queueMicrotask(() => {
    for (const job of jobs) job();
    if (tx.oncomplete) tx.oncomplete();
  });
  return tx;
}

async function runClientCheck() {
  const base = process.env.SECURITY_BASE;
  const topicId = process.env.SECURITY_TOPIC || HISTORY_TOPIC;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/")) return nativeFetch(base + input, init);
    return nativeFetch(input, init);
  };
  installMemoryIdb(topicId);
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, "topicdata.js")).href);
    const saved = await mod.getTopicData(topicId, { limit: 20000, force: true });
    const savedSeq = sequencesOf(saved.messages);
    const savedOk =
      saved.viaBackend === true &&
      !saved.error &&
      savedSeq.length === HISTORY_COUNT &&
      savedSeq[0] === 1 &&
      savedSeq.at(-1) === HISTORY_COUNT;
    if (!savedOk) {
      console.error(
        `FAIL client pages older than a saved newest page: count ${savedSeq.length} first ${savedSeq[0]} last ${savedSeq.at(-1)} error ${saved.error || ""}`
      );
      return 1;
    }
    console.log("PASS client pages older than a saved newest page");

    globalThis.__securityClearIdb();
    const fresh = await mod.getTopicData(topicId, { limit: 20000, force: true });
    const freshSeq = sequencesOf(fresh.messages);
    const freshOk =
      fresh.viaBackend === true &&
      !fresh.error &&
      freshSeq.length === HISTORY_COUNT &&
      freshSeq[0] === 1 &&
      freshSeq.at(-1) === HISTORY_COUNT;
    if (!freshOk) {
      console.error(
        `FAIL client pages a full history in chunks of 1000: count ${freshSeq.length} first ${freshSeq[0]} last ${freshSeq.at(-1)} error ${fresh.error || ""}`
      );
      return 1;
    }
    console.log("PASS client pages a full history in chunks of 1000");
    return 0;
  } catch (err) {
    console.error(`FAIL client history import: ${err && err.stack ? err.stack : err}`);
    return 1;
  }
}

async function checkClient(nodeBin, port) {
  const loaderDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbs-loader-"));
  writeClientLoader(loaderDir);
  const child = spawn(
    nodeBin,
    ["--import", pathToFileURL(path.join(loaderDir, "register.mjs")).href, fileURLToPath(import.meta.url)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        SECURITY_CLIENT: "1",
        SECURITY_BASE: `http://127.0.0.1:${port}`,
        SECURITY_TOPIC: HISTORY_TOPIC,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      resolve("timeout");
    }, 30000);
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
  removeDir(loaderDir);
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("PASS ")) pass(line.slice(5));
    else if (line.startsWith("FAIL ")) fail(line.slice(5));
    else console.log(line);
  }
  if (code !== 0) fail("client history process", `exit ${code}`);
}

async function checkMarkers(port) {
  const topic = HISTORY_TOPIC;
  const tooLongTitle = await request(port, "POST", "/api/marker", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic, cord: "179.11,-89.11", title: "t".repeat(121), msg: "ok" }),
  });
  if (tooLongTitle.status === 400 && tooLongTitle.json && tooLongTitle.json.error === "title is too long") {
    pass("marker title over 120 is 400");
  } else fail("marker title over 120 is 400", `${tooLongTitle.status} ${tooLongTitle.text}`);

  const tooLongMsg = await request(port, "POST", "/api/marker", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic, cord: "179.12,-89.12", title: "ok", msg: "m".repeat(2001) }),
  });
  if (tooLongMsg.status === 400 && tooLongMsg.json && tooLongMsg.json.error === "message is too long") {
    pass("marker message over 2000 is 400");
  } else fail("marker message over 2000 is 400", `${tooLongMsg.status} ${tooLongMsg.text}`);

  const ok = await request(port, "POST", "/api/marker", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic,
      cord: "179.13,-89.13",
      title: "t".repeat(120),
      msg: "m".repeat(2000),
    }),
  });
  if (ok.status === 200 && ok.json && ok.json.ok === true) pass("marker title 120 and message 2000 are accepted");
  else fail("marker title 120 and message 2000 are accepted", `${ok.status} ${ok.text}`);
}

async function checkUploads(port) {
  const empty = await postUpload(port, { body: "" });
  if (empty.status === 400) pass("empty upload is 400");
  else fail("empty upload is 400", `${empty.status} ${empty.text}`);

  const oversize = await postOversize(port);
  if (oversize.status === 413) pass("oversize upload is 413");
  else fail("oversize upload is 413", `${oversize.status} ${oversize.text}`);

  const html = await postUpload(port, { body: "<html>not a png</html>", token: "XXXX.DUMMY.TOKEN.XXXX" });
  if (html.status === 415) pass("HTML sent as .png is 415");
  else fail("HTML sent as .png is 415", `${html.status} ${html.text}`);

  for (let n = 2; n <= 30; n += 1) {
    const missing = await postUpload(port, { body: "x" });
    if (missing.status !== 403) {
      fail("missing Turnstile token is 403", `request ${n} returned ${missing.status} ${missing.text}`);
      return;
    }
  }
  pass("missing Turnstile token is 403");

  const limited = await postUpload(port, { body: "x" });
  if (limited.status === 429) pass("31st /api/upload is 429");
  else fail("31st /api/upload is 429", `${limited.status} ${limited.text}`);
}

async function checkSubmit(port) {
  const body = Buffer.from(JSON.stringify({ topic: SUBMIT_TOPIC, body: "hi", payer: "0.0.2" }));
  for (let n = 1; n <= 60; n += 1) {
    const res = await request(port, "POST", "/api/submit", {
      headers: { "content-type": "application/json", "content-length": String(body.length) },
      body,
    });
    if (res.status !== 200) {
      fail("61st /api/submit is 429", `request ${n} returned ${res.status} ${res.text}`);
      return;
    }
  }
  const limited = await request(port, "POST", "/api/submit", {
    headers: { "content-type": "application/json", "content-length": String(body.length) },
    body,
  });
  if (limited.status === 429) pass("61st /api/submit is 429");
  else fail("61st /api/submit is 429", `${limited.status} ${limited.text}`);
}

async function checkTurn(port) {
  const turn = await request(port, "GET", "/api/turn");
  const graceful =
    turn.status === 503 &&
    turn.json &&
    turn.json.ok === false &&
    Array.isArray(turn.json.iceServers);
  if (graceful) pass("/api/turn without METERED keys is 503");
  else fail("/api/turn without METERED keys is 503", `${turn.status} ${turn.text}`);

  const health = await request(port, "GET", "/api/health");
  if (health.status === 200 && health.json && health.json.ok === true) pass("server still up after /api/turn");
  else fail("server still up after /api/turn", `${health.status} ${health.text}`);
}

async function checkRefuse(nodeBin) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbs-refuse-"));
  const port = await freePort(8798);
  const child = spawnServer(nodeBin, port, dataDir, {
    REQUIRE_UPLOAD_AUTH: "1",
    UPLOAD_TOKEN_SECRET: "",
  });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 8000);
    child.once("exit", (status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
  let listening = false;
  try {
    const health = await request(port, "GET", "/api/health", { timeout: 500 });
    listening = health.status === 200;
  } catch {
    listening = false;
  }
  await stopChild(child);
  removeDir(dataDir);
  const log = child.log();
  if (code === 1 && !listening && log.includes("Refusing to start")) {
    pass("short upload secret refuses to start");
  } else {
    fail("short upload secret refuses to start", `exit ${code} listening ${listening} log ${log.slice(-500)}`);
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function authDenied() {
  const err = new Error("Upload failed, please try again");
  err.status = 401;
  return err;
}

function freshGrant(account, token) {
  return { account, token, exp: Date.now() + 60_000 };
}

async function checkUploadGrantUnit() {
  const { readGrant, writeGrant, rememberGrant, withUploadAuth } = await import(
    pathToFileURL(path.join(ROOT, "uploadgrant.js")).href
  );
  const { issueUploadToken, accountFromUploadToken, UPLOAD_TOKEN_TTL_MS, UPLOAD_TOKEN_TTL_SEC } = await import(
    pathToFileURL(path.join(SERVER_DIR, "uploadtoken.js")).href
  );
  const secret = "upload-token-test-secret-32b-min";
  const now = 1_800_000_000_000;
  const issued = issueUploadToken("0.0.42", secret, now);
  const live = accountFromUploadToken(issued.token, secret, issued.exp) === "0.0.42";
  const ended = accountFromUploadToken(issued.token, secret, issued.exp + 1) === null;
  const ttl = issued.expiresIn === UPLOAD_TOKEN_TTL_SEC && issued.exp === now + UPLOAD_TOKEN_TTL_MS;
  if (live && ended && ttl) pass("upload token lasts 24 hours and expires on the next millisecond");
  else fail("upload token lasts 24 hours and expires on the next millisecond", `live ${live} ended ${ended} ttl ${ttl}`);

  const flipped = issued.token.slice(0, -1) + (issued.token.endsWith("a") ? "b" : "a");
  const bound = accountFromUploadToken(issued.token, secret, now) === "0.0.42";
  const tampered = accountFromUploadToken(flipped, secret, now) === null;
  const unbound = accountFromUploadToken(issueUploadToken("not-an-account", secret, now).token, secret, now) === null;
  const shortSecret = accountFromUploadToken(issued.token, "short", now) === null;
  if (bound && tampered && unbound && shortSecret) pass("upload token is bound to the account");
  else fail("upload token is bound to the account", `bound ${bound} tampered ${tampered} unbound ${unbound}`);

  const remembered = rememberGrant(memoryStorage(), "0.0.5", { token: "server-token", exp: now + UPLOAD_TOKEN_TTL_MS, expiresIn: 10 }, now);
  const fallback = rememberGrant(memoryStorage(), "0.0.5", { token: "fallback-token", exp: now - 1, expiresIn: UPLOAD_TOKEN_TTL_SEC }, now);
  if (remembered.exp === now + UPLOAD_TOKEN_TTL_MS && fallback.exp === now + UPLOAD_TOKEN_TTL_SEC * 1000) {
    pass("client keeps the server expiry");
  } else fail("client keeps the server expiry", `remembered ${remembered.exp} fallback ${fallback.exp}`);

  const reuseStore = memoryStorage();
  let signs = 0;
  let sent = "";
  writeGrant(reuseStore, freshGrant("0.0.1", "stored-token"));
  const reused = await withUploadAuth({
    account: "0.0.1",
    storage: reuseStore,
    sign: async () => {
      signs += 1;
      return freshGrant("0.0.1", "new-token");
    },
    send: async (token) => {
      sent = token;
      return "ok";
    },
  });
  if (reused === "ok" && signs === 0 && sent === "stored-token") pass("stored upload token is reused without a new signature");
  else fail("stored upload token is reused without a new signature", `signs ${signs} sent ${sent}`);

  const expiredStore = memoryStorage();
  signs = 0;
  sent = "";
  writeGrant(expiredStore, { account: "0.0.1", token: "old-token", exp: Date.now() - 1000 });
  await withUploadAuth({
    account: "0.0.1",
    storage: expiredStore,
    sign: async () => {
      signs += 1;
      return freshGrant("0.0.1", "renewed-token");
    },
    send: async (token) => {
      sent = token;
      return "ok";
    },
  });
  const near = memoryStorage();
  writeGrant(near, { account: "0.0.1", token: "soon-token", exp: Date.now() + 15000 });
  let nearSigns = 0;
  await withUploadAuth({
    account: "0.0.1",
    storage: near,
    sign: async () => {
      nearSigns += 1;
      return freshGrant("0.0.1", "near-new");
    },
    send: async () => "ok",
  });
  const boundary = memoryStorage();
  const clock = 5_000_000;
  writeGrant(boundary, { account: "0.0.1", token: "edge-token", exp: clock + 15000 });
  const skewExpired = readGrant(boundary, "0.0.1", clock) === null;
  writeGrant(boundary, { account: "0.0.1", token: "edge-token", exp: clock + 15001 });
  const skewLive = readGrant(boundary, "0.0.1", clock);
  const renewed = readGrant(expiredStore, "0.0.1");
  if (
    signs === 1 &&
    sent === "renewed-token" &&
    nearSigns === 1 &&
    skewExpired &&
    skewLive &&
    skewLive.token === "edge-token" &&
    renewed &&
    renewed.token === "renewed-token"
  ) {
    pass("expired upload token asks for one new signature");
  } else {
    fail("expired upload token asks for one new signature", `signs ${signs} near ${nearSigns} skew ${skewExpired} sent ${sent}`);
  }

  const retryStore = memoryStorage();
  signs = 0;
  let sends = 0;
  writeGrant(retryStore, freshGrant("0.0.7", "rejected-token"));
  const retried = await withUploadAuth({
    account: "0.0.7",
    storage: retryStore,
    sign: async () => {
      signs += 1;
      return freshGrant("0.0.7", "signed-token");
    },
    send: async (token) => {
      sends += 1;
      if (sends === 1) throw authDenied();
      return token;
    },
  });
  if (retried === "signed-token" && signs === 1 && sends === 2) pass("a 401 retries the upload once with a new signature");
  else fail("a 401 retries the upload once with a new signature", `signs ${signs} sends ${sends} retried ${retried}`);

  const stopStore = memoryStorage();
  signs = 0;
  sends = 0;
  writeGrant(stopStore, freshGrant("0.0.7", "rejected-token"));
  let stopped = false;
  try {
    await withUploadAuth({
      account: "0.0.7",
      storage: stopStore,
      sign: async () => {
        signs += 1;
        return freshGrant("0.0.7", "signed-once");
      },
      send: async () => {
        sends += 1;
        throw authDenied();
      },
    });
  } catch (err) {
    stopped = !!(err && err.status === 401);
  }
  const cleared = readGrant(stopStore, "0.0.7") === null;
  if (stopped && signs === 1 && sends === 2 && cleared) pass("a second 401 does not sign again");
  else fail("a second 401 does not sign again", `stopped ${stopped} signs ${signs} sends ${sends} cleared ${cleared}`);

  const missingStore = memoryStorage();
  signs = 0;
  sends = 0;
  try {
    await withUploadAuth({
      account: "0.0.8",
      storage: missingStore,
      sign: async () => {
        signs += 1;
        return freshGrant("0.0.8", `signed-${signs}`);
      },
      send: async () => {
        sends += 1;
        throw authDenied();
      },
    });
  } catch {
    /* the second 401 is the stop */
  }
  if (signs === 2 && sends === 2) pass("a missing token signs once and retries a 401 once");
  else fail("a missing token signs once and retries a 401 once", `signs ${signs} sends ${sends}`);

  const split = memoryStorage();
  writeGrant(split, freshGrant("0.0.1", "account-a"));
  signs = 0;
  sent = "";
  await withUploadAuth({
    account: "0.0.2",
    storage: split,
    sign: async () => {
      signs += 1;
      return freshGrant("0.0.2", "account-b");
    },
    send: async (token) => {
      sent = token;
      return "ok";
    },
  });
  const kept = readGrant(split, "0.0.1");
  if (signs === 1 && sent === "account-b" && kept && kept.token === "account-a") {
    pass("another account does not reuse the upload token");
  } else fail("another account does not reuse the upload token", `signs ${signs} sent ${sent}`);
}

function postAuthedUpload(port, token) {
  const buf = Buffer.from("x");
  const headers = {
    "content-type": "image/png",
    "content-length": String(buf.length),
  };
  if (token) headers["x-upload-token"] = token;
  return request(port, "POST", "/api/upload", { headers, body: buf, timeout: 15000 });
}

async function checkUploadTokenHttp(nodeBin) {
  const { issueUploadToken, UPLOAD_TOKEN_TTL_MS } = await import(
    pathToFileURL(path.join(SERVER_DIR, "uploadtoken.js")).href
  );
  const secret = "upload-token-test-secret-32b-min";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbs-upload-auth-"));
  const port = await freePort(8810);
  const child = spawnServer(nodeBin, port, dataDir, {
    REQUIRE_UPLOAD_AUTH: "1",
    UPLOAD_TOKEN_SECRET: secret,
    TURNSTILE_SECRET_KEY: "",
  });
  try {
    await waitForHealth(port, child);
    const fresh = issueUploadToken("0.0.123", secret);
    const first = await postAuthedUpload(port, fresh.token);
    const second = await postAuthedUpload(port, fresh.token);
    if (first.status === 415 && second.status === 415) pass("the same upload token is accepted twice");
    else fail("the same upload token is accepted twice", `${first.status} then ${second.status}`);

    const expired = issueUploadToken("0.0.123", secret, Date.now() - UPLOAD_TOKEN_TTL_MS - 5000);
    const stale = await postAuthedUpload(port, expired.token);
    const missing = await postAuthedUpload(port);
    const flipped = fresh.token.slice(0, -1) + (fresh.token.endsWith("a") ? "b" : "a");
    const bad = await postAuthedUpload(port, flipped);
    if (stale.status === 401 && missing.status === 401 && bad.status === 401) {
      pass("expired, missing, and tampered upload tokens are 401");
    } else {
      fail("expired, missing, and tampered upload tokens are 401", `${stale.status} ${missing.status} ${bad.status}`);
    }
  } catch (err) {
    const log = child.log();
    fail("upload token http", `${err && err.message ? err.message : err} ${log.slice(-400)}`);
  } finally {
    await stopChild(child);
    removeDir(dataDir);
  }
}

async function checkUploadAuth(nodeBin) {
  try {
    await checkUploadGrantUnit();
  } catch (err) {
    fail("upload grant unit", err && err.stack ? err.stack : String(err));
  }
  await checkUploadTokenHttp(nodeBin);
}

async function main() {
  try {
    await runHashinalTests();
    pass("early hashinal list and owners");
  } catch (err) {
    fail("early hashinal list and owners", err && err.stack ? err.stack : String(err));
  }
  try {
    await runFollowCountTests();
    pass("follower count cache");
  } catch (err) {
    fail("follower count cache", err && err.stack ? err.stack : String(err));
  }
  try {
    await runHcsChunkTests();
    pass("hcs chunk join");
  } catch (err) {
    fail("hcs chunk join", err && err.stack ? err.stack : String(err));
  }
  checkDeclaredNode();
  const serverNode = findServerNode();
  pass(`node ${serverNode.version} is 22.16 or newer`);
  console.log(`security server node ${serverNode.version} (${serverNode.bin})`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbs-security-"));
  const port = await freePort(8799);
  const child = spawnServer(serverNode.bin, port, dataDir);
  const refuse = checkRefuse(serverNode.bin);
  try {
    await waitForHealth(port, child);
    pass("server started");
    const early = await request(port, "GET", "/api/early-hashinals");
    const earlyCache = String((early.headers && early.headers["cache-control"]) || "");
    if (
      early.status === 200
      && early.json
      && early.json.owners
      && typeof early.json.owners === "object"
      && !Array.isArray(early.json.owners)
      && early.json.updatedAt == null
      && earlyCache.includes("max-age=300")
    ) {
      pass("early hashinals snapshot");
    } else {
      fail("early hashinals snapshot", `${early.status} ${earlyCache} ${early.text}`);
    }
    insertHistory(dataDir);
    await checkHistory(port);
    await checkClient(serverNode.bin, port);
    await checkMarkers(port);
    await checkUploads(port);
    await checkSubmit(port);
    await checkTurn(port);
  } catch (err) {
    fail("security run", err && err.stack ? err.stack : String(err));
  } finally {
    await stopChild(child);
    removeDir(dataDir);
  }
  await refuse;
  await checkUploadAuth(serverNode.bin);
  agent.destroy();
  if (failures.length) {
    console.error(`\n${failures.length} security check(s) failed`);
    process.exit(1);
  }
  console.log("\nsecurity checks passed");
}

await main();
