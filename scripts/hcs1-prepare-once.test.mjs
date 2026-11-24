// Runs the prepare-once check in its own process. That process mocks the
// picture compressor and the wallet, which Node only allows behind a flag.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("a run and its resume prepare the file once and send the same bytes", () => {
  const runner = fileURLToPath(new URL("./hcs1-prepare-once.runner.mjs", import.meta.url));
  const root = fileURLToPath(new URL("..", import.meta.url));
  const child = spawnSync(process.execPath, [
    "--experimental-test-module-mocks",
    "--test",
    runner,
  ], { encoding: "utf8", cwd: root });
  assert.equal(child.status, 0, `${child.stdout || ""}\n${child.stderr || ""}`);
});
