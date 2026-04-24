import * as TOML from "@iarna/toml";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { codexConfigPath } from "../platform/paths.js";
import { requireScope, writeTextFileAtomic, type InstallRequest, type UninstallRequest } from "./base.js";
import type { InstallResult } from "../types/install.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { commandExists, runCommand } from "../platform/exec.js";

type CodexConfig = TOML.JsonMap & {
  mcp_servers?: Record<string, { url?: string; command?: string; args?: string[] }>;
};

async function readCodexConfig(path: string): Promise<CodexConfig> {
  try {
    const raw = await readFile(path, "utf8");
    try {
      return TOML.parse(raw) as CodexConfig;
    } catch (error) {
      throw new CliError("install.config_parse", `Existing Codex config at ${path} is not valid TOML.`, EXIT_CODES.installConflict, {
        cause: error,
        nextStep: "Repair the existing Codex config before retrying."
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function resolvedCodexConfigPath(request: { path?: string | undefined }): string {
  return request.path ? join(request.path, "config.toml") : codexConfigPath();
}

export async function installCodex(request: InstallRequest): Promise<InstallResult> {
  requireScope(request.scope, ["user"]);
  if (!request.dryRun && !request.path && commandExists("codex")) {
    try {
      await runCommand("codex", ["mcp", "add", request.name, "--url", request.serverUrl]);
      return {
        client: "codex",
        scope: request.scope,
        name: request.name,
        method: "cli",
        changed: true,
        location: "codex mcp add",
        managed: true,
        nextStep: "Codex is configured. Codex will handle its own OAuth flow on first protected use."
      };
    } catch {
      // fall through to TOML merge
    }
  }

  const location = resolvedCodexConfigPath(request);
  const current = await readCodexConfig(location);
  const servers = (current.mcp_servers || {}) as Record<string, { url?: string }>;
  const existing = servers[request.name];
  if (existing?.url && existing.url !== request.serverUrl && !request.overwrite) {
    throw new CliError("install.conflict", `Codex already has an MCP entry named ${request.name} with a different URL.`, EXIT_CODES.installConflict, {
      nextStep: "Retry with --overwrite or choose a different --name."
    });
  }
  const next = {
    ...current,
    mcp_servers: {
      ...servers,
      [request.name]: {
        url: request.serverUrl
      }
    }
  } as unknown as CodexConfig;
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (!request.dryRun && changed) {
    await writeTextFileAtomic(location, TOML.stringify(next as TOML.JsonMap));
  }
  return {
    client: "codex",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed,
    location,
    managed: true,
    nextStep: "Codex is configured. Codex will handle its own OAuth flow on first protected use."
  };
}

export async function uninstallCodex(request: UninstallRequest, managedLocation?: string): Promise<InstallResult> {
  requireScope(request.scope, ["user"]);
  if (!request.dryRun && !request.path && !managedLocation && commandExists("codex")) {
    try {
      await runCommand("codex", ["mcp", "remove", request.name]);
      return {
        client: "codex",
        scope: request.scope,
        name: request.name,
        method: "cli",
        changed: true,
        location: "codex mcp remove",
        managed: true,
        nextStep: "Codex config was updated. Codex-owned auth state is unchanged."
      };
    } catch {
      // fall through to file removal
    }
  }
  const location = managedLocation && managedLocation !== "codex mcp add" ? managedLocation : resolvedCodexConfigPath(request);
  const current = await readCodexConfig(location);
  const servers = { ...(current.mcp_servers || {}) } as Record<string, { url?: string }>;
  if (!servers[request.name]) {
    return {
      client: "codex",
      scope: request.scope,
      name: request.name,
      method: "file",
      changed: false,
      location,
      managed: true,
      nextStep: "No managed Codex entry was present."
    };
  }
  delete servers[request.name];
  const next = {
    ...current,
    mcp_servers: Object.keys(servers).length ? servers : undefined
  } as unknown as CodexConfig;
  if (!request.dryRun) {
    await writeTextFileAtomic(location, TOML.stringify(next as TOML.JsonMap));
  }
  return {
    client: "codex",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed: true,
    location,
    managed: true,
    nextStep: "Codex config was updated. Codex-owned auth state is unchanged."
  };
}
