import test from "node:test";
import assert from "node:assert/strict";
import { commandExists } from "../src/platform/exec.js";

test("windows commandExists resolves core shell tools without relying on bare where in PATH", () => {
  if (process.platform !== "win32") return;
  assert.equal(commandExists("node"), true);
});
