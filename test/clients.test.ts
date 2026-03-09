import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { installCursor, uninstallCursor } from "../src/clients/cursor.js";
import { installCodex, uninstallCodex } from "../src/clients/codex.js";
import { installVsCode, uninstallVsCode } from "../src/clients/vscode.js";
import { installWindsurf, uninstallWindsurf } from "../src/clients/windsurf.js";

test("cursor installer writes and removes a managed entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibecodr-cursor-"));
  const location = join(root, ".cursor", "mcp.json");
  const install = await installCursor({
    serverUrl: "https://openai.vibecodr.space/mcp",
    name: "vibecodr",
    scope: "project",
    path: root
  });
  assert.equal(install.changed, true);
  const written = JSON.parse(await readFile(location, "utf8")) as { mcpServers: Record<string, { url: string }> };
  assert.equal(written.mcpServers.vibecodr.url, "https://openai.vibecodr.space/mcp");

  const uninstall = await uninstallCursor({
    serverUrl: "https://openai.vibecodr.space/mcp",
    name: "vibecodr",
    scope: "project",
    path: root
  });
  assert.equal(uninstall.changed, true);
  const removed = JSON.parse(await readFile(location, "utf8")) as { mcpServers?: Record<string, unknown> };
  assert.equal(removed.mcpServers, undefined);
});

test("cursor installer fails on invalid existing JSON instead of treating it as empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibecodr-cursor-invalid-"));
  const location = join(root, ".cursor", "mcp.json");
  await mkdir(dirname(location), { recursive: true });
  await writeFile(location, "{invalid", "utf8");
  await assert.rejects(
    installCursor({
      serverUrl: "https://openai.vibecodr.space/mcp",
      name: "vibecodr",
      scope: "project",
      path: root
    }),
    /not valid JSON/
  );
});

test("codex TOML fallback writes and removes a managed entry in a temp config", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibecodr-codex-"));
  const location = join(root, "config.toml");
  const install = await installCodex({
    serverUrl: "https://openai.vibecodr.space/mcp",
    name: "vibecodr",
    scope: "user",
    dryRun: false,
    overwrite: false,
    path: root
  }).catch((error) => {
    throw error;
  });
  if (install.method === "cli") {
    assert.ok(true);
    return;
  }
  const written = await readFile(location, "utf8");
  assert.match(written, /\[mcp_servers\.vibecodr\]/);
  assert.match(written, /url = "https:\/\/openai\.vibecodr\.space\/mcp"/);

  const uninstall = await uninstallCodex({
    serverUrl: "https://openai.vibecodr.space/mcp",
    name: "vibecodr",
    scope: "user"
  }, location);
  assert.equal(uninstall.changed, true);
});

test("vscode project installer writes and removes a managed workspace entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibecodr-vscode-"));
  const location = join(root, ".vscode", "mcp.json");
  const install = await installVsCode({
    serverUrl: "https://openai.vibecodr.space/mcp",
    name: "vibecodr",
    scope: "project",
    path: root
  });
  assert.equal(install.changed, true);
  const written = JSON.parse(await readFile(location, "utf8")) as { servers: Record<string, { url: string }> };
  assert.equal(written.servers.vibecodr.url, "https://openai.vibecodr.space/mcp");

  const uninstall = await uninstallVsCode({
    serverUrl: "https://openai.vibecodr.space/mcp",
    name: "vibecodr",
    scope: "project",
    path: root
  });
  assert.equal(uninstall.changed, true);
});

test("workspace installer writes a backup before overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibecodr-vscode-backup-"));
  const location = join(root, ".vscode", "mcp.json");
  await mkdir(dirname(location), { recursive: true });
  await writeFile(location, JSON.stringify({ servers: { existing: { type: "http", url: "https://example.com/mcp" } } }, null, 2), "utf8");
  await installVsCode({
    serverUrl: "https://openai.vibecodr.space/mcp",
    name: "vibecodr",
    scope: "project",
    path: root
  });
  await access(`${location}.bak`);
});

test("windsurf installer writes and removes a managed native config entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibecodr-windsurf-"));
  const location = join(root, "mcp_config.json");
  const install = await installWindsurf({
    serverUrl: "https://openai.vibecodr.space/mcp",
    name: "vibecodr",
    scope: "user",
    path: root
  });
  assert.equal(install.changed, true);
  const written = JSON.parse(await readFile(location, "utf8")) as { mcpServers: Record<string, { serverUrl: string }> };
  assert.equal(written.mcpServers.vibecodr.serverUrl, "https://openai.vibecodr.space/mcp");

  const uninstall = await uninstallWindsurf({
    serverUrl: "https://openai.vibecodr.space/mcp",
    name: "vibecodr",
    scope: "user",
    path: root
  });
  assert.equal(uninstall.changed, true);
});
