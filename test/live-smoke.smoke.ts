import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { OFFICIAL_CLIENT_METADATA_URL } from "../src/auth/official-client.js";

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn("node", ["--import", "tsx", "src/bin/vibecodr-mcp.ts", ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function capturePrintedAuthorizationUrl(): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("node", ["--import", "tsx", "src/bin/vibecodr-mcp.ts", "login", "--browser", "print", "--timeout-sec", "30"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let settled = false;
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const match = stdout.match(/https:\/\/\S+/);
      if (!settled && match?.[0]) {
        settled = true;
        child.kill();
        resolve(match[0]);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!settled) {
        reject(new Error(`login did not print an authorization URL. exit=${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    });
  });
}

test("live smoke prints the official first-party auth URL without extra env bootstrap", { timeout: 30_000 }, async () => {
  const authorizationUrl = await capturePrintedAuthorizationUrl();
  const parsed = new URL(authorizationUrl);
  assert.equal(parsed.searchParams.get("client_id"), OFFICIAL_CLIENT_METADATA_URL);
  assert.ok(parsed.searchParams.get("resource")?.startsWith("https://openai.vibecodr.space/mcp"));
});

test("live smoke lists public Vibecodr tools", { timeout: 30_000 }, async () => {
  const result = await runCli(["tools", "--json", "--non-interactive"]);
  assert.equal(result.code, 0, `tools failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout) as { toolCount?: number; tools?: Array<{ name?: string }> };
  assert.ok((payload.toolCount || 0) > 0);
  assert.ok(payload.tools?.some((tool) => tool.name === "get_vibecodr_platform_overview"));
});

test("live smoke calls the public platform overview tool", { timeout: 30_000 }, async () => {
  const result = await runCli(["call", "get_vibecodr_platform_overview", "--json", "--non-interactive"]);
  assert.equal(result.code, 0, `call failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout) as {
    tool?: string;
    result?: { structuredContent?: Record<string, unknown> };
  };
  assert.equal(payload.tool, "get_vibecodr_platform_overview");
  assert.equal(typeof payload.result?.structuredContent, "object");
});
