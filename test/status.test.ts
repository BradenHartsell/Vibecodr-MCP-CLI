import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runStatusCommand } from "../src/commands/status.js";
import { InstallManifestStore } from "../src/storage/install-manifest.js";

test("status --show-installs distinguishes configured, missing, and external managed installs", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibecodr-status-"));
  const manifestPath = join(root, "installs.json");
  const presentPath = join(root, "present.json");
  const missingPath = join(root, "missing.json");
  await mkdir(root, { recursive: true });
  await writeFile(presentPath, "{}", "utf8");

  const previousManifestPath = process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"];
  process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"] = manifestPath;
  try {
    const manifest = new InstallManifestStore();
    await manifest.save({
      version: 1,
      installs: [
        {
          client: "cursor",
          scope: "project",
          name: "vibecodr",
          location: presentPath,
          method: "file",
          serverUrl: "https://openai.vibecodr.space/mcp",
          installedAt: new Date().toISOString()
        },
        {
          client: "windsurf",
          scope: "user",
          name: "vibecodr",
          location: missingPath,
          method: "file",
          serverUrl: "https://openai.vibecodr.space/mcp",
          installedAt: new Date().toISOString()
        },
        {
          client: "codex",
          scope: "user",
          name: "vibecodr",
          location: "codex mcp add",
          method: "cli",
          serverUrl: "https://openai.vibecodr.space/mcp",
          installedAt: new Date().toISOString()
        }
      ]
    });

    let payload: Record<string, unknown> | undefined;
    const humanLines: string[] = [];
    await runStatusCommand(["--show-installs"], {
      globalOptions: {
        profile: "default",
        json: false,
        verbose: false,
        nonInteractive: false
      },
      output: {
        success(value: Record<string, unknown>, lines: string[]) {
          payload = value;
          humanLines.push(...lines);
        }
      },
      tokenManager: {
        resolveProfile: async () => ({
          profileName: "default",
          profile: {
            serverUrl: "https://openai.vibecodr.space/mcp",
            browserMode: "print",
            registrationMode: "auto",
            defaultInstallScope: "user",
            logLevel: "normal"
          },
          serverUrl: "https://openai.vibecodr.space/mcp"
        }),
        getSession: async () => undefined,
        sessionState: () => "none"
      },
      configStore: {} as never,
      secretStore: {} as never,
      runtimeClient: {} as never
    } as never);

    const installs = (payload?.["installs"] as Array<{ status: string }>) || [];
    assert.deepEqual(installs.map((install) => install.status), ["configured", "missing", "external"]);
    assert.ok(humanLines.some((line) => line.includes("[configured]")));
    assert.ok(humanLines.some((line) => line.includes("[missing]")));
    assert.ok(humanLines.some((line) => line.includes("[external]")));
  } finally {
    if (previousManifestPath === undefined) {
      delete process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"];
    } else {
      process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"] = previousManifestPath;
    }
  }
});
