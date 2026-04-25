import test from "node:test";
import assert from "node:assert/strict";
import { browserOpenCommandForCurrentPlatform, openExternalUrl } from "../src/platform/browser.js";

test("windows browser launcher uses rundll32 protocol handler", () => {
  if (process.platform !== "win32") return;
  const originalSystemRoot = process.env["SystemRoot"];
  try {
    process.env["SystemRoot"] = "C:\\Windows";
    const launcher = browserOpenCommandForCurrentPlatform();
    assert.ok(launcher);
    assert.equal(launcher?.command, "C:\\Windows\\System32\\rundll32.exe");
    assert.deepEqual(launcher?.args, ["url.dll,FileProtocolHandler"]);
  } finally {
    if (originalSystemRoot === undefined) {
      delete process.env["SystemRoot"];
    } else {
      process.env["SystemRoot"] = originalSystemRoot;
    }
  }
});

test("browser launcher refuses non-web URL schemes before invoking the OS handler", async () => {
  await assert.rejects(
    openExternalUrl("file:///C:/Windows/System32/calc.exe"),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.match((error as Error).message, /unsupported URL scheme file:/);
      return true;
    }
  );
});

test("browser launcher refuses malformed URLs before invoking the OS handler", async () => {
  await assert.rejects(
    openExternalUrl("not a url"),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.match((error as Error).message, /invalid browser URL/);
      return true;
    }
  );
});
