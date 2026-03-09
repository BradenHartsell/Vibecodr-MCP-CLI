import test from "node:test";
import assert from "node:assert/strict";
import { browserOpenCommandForCurrentPlatform } from "../src/platform/browser.js";

test("windows browser launcher uses rundll32 protocol handler", () => {
  if (process.platform !== "win32") return;
  const originalSystemRoot = process.env.SystemRoot;
  try {
    process.env.SystemRoot = "C:\\Windows";
    const launcher = browserOpenCommandForCurrentPlatform();
    assert.ok(launcher);
    assert.equal(launcher?.command, "C:\\Windows\\System32\\rundll32.exe");
    assert.deepEqual(launcher?.args, ["url.dll,FileProtocolHandler"]);
  } finally {
    if (originalSystemRoot === undefined) {
      delete process.env.SystemRoot;
    } else {
      process.env.SystemRoot = originalSystemRoot;
    }
  }
});
