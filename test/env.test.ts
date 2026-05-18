import assert from "node:assert/strict";
import test from "node:test";
import { DEPRECATION_OPT_OUT_ENV, ENV_ALIAS_MAP, reconcileEnv } from "../src/core/env.js";

interface CapturedStream { written: string[] }

function captureStream(): { stream: { write(chunk: string): boolean }; captured: CapturedStream } {
  const captured: CapturedStream = { written: [] };
  return {
    stream: {
      write(chunk: string): boolean {
        captured.written.push(chunk);
        return true;
      }
    },
    captured
  };
}

test("reconcileEnv propagates canonical to legacy names", () => {
  const env: NodeJS.ProcessEnv = { VIBECDR_CONFIG_DIR: "C:/dir" };
  const { stream, captured } = captureStream();
  reconcileEnv({ env, stream, warned: new Set() });
  assert.equal(env["VC_TOOLS_CONFIG_DIR"], "C:/dir");
  assert.equal(env["VIBECDR_MCP_CONFIG_PATH"], "C:/dir");
  // Canonical set -> no deprecation note.
  assert.equal(captured.written.length, 0);
});

test("reconcileEnv copies legacy values into canonical name + emits one-time note", () => {
  const env: NodeJS.ProcessEnv = { VC_TOOLS_CONFIG_DIR: "C:/legacy" };
  const { stream, captured } = captureStream();
  const warned = new Set<string>();
  reconcileEnv({ env, stream, warned });
  assert.equal(env["VIBECDR_CONFIG_DIR"], "C:/legacy");
  assert.equal(captured.written.length, 1);
  assert.match(captured.written[0]!, /VC_TOOLS_CONFIG_DIR.*back-compat.*VIBECDR_CONFIG_DIR/);
  // Second call with the same legacy var doesn't re-warn.
  reconcileEnv({ env, stream, warned });
  assert.equal(captured.written.length, 1);
});

test("reconcileEnv prefers the first legacy match listed", () => {
  // VC_TOOLS_CONFIG_DIR is listed before VIBECDR_MCP_CONFIG_PATH for VIBECDR_CONFIG_DIR.
  const env: NodeJS.ProcessEnv = {
    VC_TOOLS_CONFIG_DIR: "C:/vc",
    VIBECDR_MCP_CONFIG_PATH: "C:/mcp"
  };
  const { stream, captured } = captureStream();
  reconcileEnv({ env, stream, warned: new Set() });
  assert.equal(env["VIBECDR_CONFIG_DIR"], "C:/vc");
  // Only one note fires (the first match wins; the second legacy name is intentionally
  // left alone so users can mix and match during the transition).
  assert.equal(captured.written.length, 1);
  assert.match(captured.written[0]!, /VC_TOOLS_CONFIG_DIR/);
});

test("reconcileEnv ignores empty-string env values", () => {
  const env: NodeJS.ProcessEnv = { VC_TOOLS_CONFIG_DIR: "" };
  const { stream, captured } = captureStream();
  reconcileEnv({ env, stream, warned: new Set() });
  assert.equal(env["VIBECDR_CONFIG_DIR"], undefined);
  assert.equal(captured.written.length, 0);
});

test("reconcileEnv honors VIBECDR_NO_DEPRECATION_NOTICE=1", () => {
  const env: NodeJS.ProcessEnv = {
    VC_TOOLS_CONFIG_DIR: "C:/legacy",
    [DEPRECATION_OPT_OUT_ENV]: "1"
  };
  const { stream, captured } = captureStream();
  reconcileEnv({ env, stream, warned: new Set() });
  assert.equal(env["VIBECDR_CONFIG_DIR"], "C:/legacy");
  assert.equal(captured.written.length, 0);
});

test("ENV_ALIAS_MAP covers every alias the plan calls out", () => {
  // Plan §3 specifies these aliases must be wired. Lock the map so a future
  // rename or accidental delete shows up in CI.
  const expected = [
    "VC_TOOLS_CONFIG_DIR",
    "VC_TOOLS_CREDENTIAL_STORE",
    "VIBECDR_MCP_CONFIG_PATH",
    "VIBECDR_MCP_CIMD_CLIENT_ID",
    "VIBECDR_MCP_MANUAL_CLIENT_ID",
    "VIBECDR_MCP_INSTALL_MANIFEST_PATH",
    "VIBECDR_MCP_INSECURE_SECRET_STORE_PATH",
    "VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE",
    "VIBECDR_MCP_TEST_AUTH_URL_FILE"
  ].sort();
  const actual = Object.values(ENV_ALIAS_MAP).flat().sort();
  assert.deepEqual(actual, expected);
});
