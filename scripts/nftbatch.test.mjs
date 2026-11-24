// Runs the batch-mint checks in their own process. That process mocks the
// token mint and the wallet, which Node only allows behind a flag.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("nft batch mint resumes from local progress without minting a chunk twice", () => {
  const runner = fileURLToPath(new URL("./nftbatch.runner.mjs", import.meta.url));
  const root = fileURLToPath(new URL("..", import.meta.url));
  const child = spawnSync(process.execPath, [
    "--experimental-test-module-mocks",
    "--test",
    runner,
  ], { encoding: "utf8", cwd: root });
  assert.equal(child.status, 0, `${child.stdout || ""}\n${child.stderr || ""}`);
});
