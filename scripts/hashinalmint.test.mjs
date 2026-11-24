// Runs the Hashinal mint checks in their own process. That process mocks
// the wallet inscriber and the token mint, which Node only allows behind a flag.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("hashinal mint inscribes the file and metadata, then mints one NFT", () => {
  const runner = fileURLToPath(new URL("./hashinalmint.runner.mjs", import.meta.url));
  const root = fileURLToPath(new URL("..", import.meta.url));
  const child = spawnSync(process.execPath, [
    "--experimental-test-module-mocks",
    "--test",
    runner,
  ], { encoding: "utf8", cwd: root });
  assert.equal(child.status, 0, `${child.stdout || ""}\n${child.stderr || ""}`);
});
