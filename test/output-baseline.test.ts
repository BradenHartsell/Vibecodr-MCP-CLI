// §14 output-baseline regression contract. Runs each vc-tools-side command
// through the mocked dispatcher (runWithMockApi from test/legacy/helpers.ts)
// with canonical mock responses, filters volatile fields the server stamps
// on every reply (requestId, traceId, timestamp, version, etc.), and
// asserts the resulting JSON matches a committed fixture under
// test/fixtures/output-baseline/ byte-for-byte after the filter.
//
// To deliberately re-derive the fixtures (e.g. after a documented adapter-
// shape change), set VIBECDR_REGENERATE_BASELINE_FIXTURES=1 and re-run the
// test; it writes the current output to disk instead of asserting. Commit
// the regenerated fixtures and the test resumes its drift-guard role.
//
// Scope: this version covers the read-only / dry-run command set that
// doesn't require device-code login or interactive prompts. Commands that
// need a live auth flow (start, login --credential, work follow live) are
// covered separately by cli.behavior.test.ts and live-smoke.smoke.ts; the
// baseline contract here is the subset useful as a JSON-shape drift guard.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { meRoute, runWithMockApi } from "./legacy/helpers.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "output-baseline");
const REGENERATE = process.env["VIBECDR_REGENERATE_BASELINE_FIXTURES"] === "1";

const VOLATILE_KEYS = new Set([
  "requestId",
  "traceId",
  "timestamp",
  "createdAt",
  "updatedAt",
  "version"
]);

function filterVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(filterVolatile);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = filterVolatile(sub);
    }
    return out;
  }
  return value;
}

interface BaselineCase {
  name: string;
  argv: string[];
  routes?: import("./legacy/helpers.js").MockRoute[];
  // Some commands need state seeded before the run (e.g. a stored credential).
  // The setup callback gets the config dir runWithMockApi creates and can
  // write files into it.
  configDir?: string;
}

async function assertOrWriteFixture(name: string, actual: unknown): Promise<void> {
  await mkdir(fixturesDir, { recursive: true });
  const fixturePath = path.join(fixturesDir, name);
  const serialized = JSON.stringify(actual, null, 2) + "\n";
  if (REGENERATE || !existsSync(fixturePath)) {
    await writeFile(fixturePath, serialized, "utf8");
    return;
  }
  const expected = await readFile(fixturePath, "utf8");
  assert.equal(serialized, expected, `output drift for ${name} -- re-run with VIBECDR_REGENERATE_BASELINE_FIXTURES=1 to update if the new shape is intentional`);
}

test("baseline: plans --json", async () => {
  const result = await runWithMockApi(["--json", "plans"]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-plans.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: plans --details --json", async () => {
  const result = await runWithMockApi(["--json", "plans", "--details"]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-plans-details.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: inspect --json (goal coverage)", async () => {
  const result = await runWithMockApi(["--json", "inspect"]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-inspect.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: dashboard --json", async () => {
  const result = await runWithMockApi(["--json", "dashboard"]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-dashboard.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

// doctor --json is intentionally NOT in the baseline contract: its output
// includes node version + tmp config-dir path which aren't byte-portable
// across machines. cli.behavior.test.ts already exercises doctor under
// several conditions; the shape stability of its checks[] array is covered
// there.

test("baseline: whoami --json (with mocked /v1/me + seeded credential)", async () => {
  const token = "vct_test_grant_token_1234567890";
  const result = await runWithMockApi(
    ["--json", "--token", token, "whoami"],
    [meRoute(), { method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } }]
  );
  try {
    assert.equal(result.code, 0, `whoami failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-whoami.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: usage --json (with mocked /v1/me + /v1/usage)", async () => {
  const token = "vct_test_grant_token_1234567890";
  const result = await runWithMockApi(
    ["--json", "--token", token, "usage"],
    [
      meRoute(),
      {
        method: "GET",
        path: "/v1/usage",
        response: {
          plan: "Pro",
          monthlyCredits: { total: 3000, used: 12, remaining: 2988 },
          dailyCredits: { total: 400, used: 4, remaining: 396 },
          concurrentRuns: { limit: 5, active: 0 }
        }
      }
    ]
  );
  try {
    assert.equal(result.code, 0, `usage failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-usage.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: connect --client codex --print --json", async () => {
  const token = "vct_test_grant_token_1234567890";
  const result = await runWithMockApi(
    ["--json", "--token", token, "connect", "--client", "codex", "--print"],
    [meRoute(), { method: "GET", path: "/v1/mcp/connection", response: { client: "codex", url: "https://tools.vibecodr.space/mcp" } }]
  );
  try {
    assert.equal(result.code, 0, `connect failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-connect-codex.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: agent connect --client codex --print --json (legacy spelling)", async () => {
  const token = "vct_test_grant_token_1234567890";
  const result = await runWithMockApi(
    ["--json", "--token", token, "agent", "connect", "--client", "codex", "--print"],
    [meRoute(), { method: "GET", path: "/v1/mcp/connection", response: { client: "codex", url: "https://tools.vibecodr.space/mcp" } }]
  );
  try {
    assert.equal(result.code, 0, `agent connect failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-agent-connect-codex.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});
