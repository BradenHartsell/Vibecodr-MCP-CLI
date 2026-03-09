import { join } from "node:path";
import { readJsonFile, requireScope, writeTextFileAtomic, type InstallRequest, type UninstallRequest } from "./base.js";
import { windsurfLegacyConfigPath, windsurfUserConfigPath } from "../platform/paths.js";
import type { InstallResult } from "../types/install.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";

type WindsurfConfig = {
  mcpServers?: Record<string, { serverUrl: string }>;
};

export async function installWindsurf(request: InstallRequest): Promise<InstallResult> {
  requireScope(request.scope, ["user"]);
  const location = request.path ? join(request.path, "mcp_config.json") : windsurfUserConfigPath();
  const current = await readJsonFile<WindsurfConfig>(location, {});
  const next: WindsurfConfig = {
    ...current,
    mcpServers: {
      ...(current.mcpServers || {}),
      [request.name]: {
        serverUrl: request.serverUrl
      }
    }
  };
  const existing = current.mcpServers?.[request.name];
  if (existing && existing.serverUrl !== request.serverUrl && !request.overwrite) {
    throw new CliError("install.conflict", `Windsurf already has an MCP entry named ${request.name} with a different URL.`, EXIT_CODES.installConflict, {
      nextStep: "Retry with --overwrite or choose a different --name."
    });
  }
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (!request.dryRun && changed) {
    await writeTextFileAtomic(location, JSON.stringify(next, null, 2) + "\n");
  }
  const notes: string[] = [];
  const legacyPath = windsurfLegacyConfigPath();
  const legacyExists = await readJsonFile<WindsurfConfig>(legacyPath, null as unknown as WindsurfConfig).catch(() => null);
  if (legacyExists && typeof legacyExists === "object") {
    notes.push(`Legacy Windsurf plugin config detected at ${legacyPath}.`);
  }
  return {
    client: "windsurf",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed,
    location,
    managed: true,
    nextStep: "Open Windsurf and refresh MCPs if needed.",
    ...(notes.length ? { notes } : {})
  };
}

export async function uninstallWindsurf(request: UninstallRequest, managedLocation?: string): Promise<InstallResult> {
  requireScope(request.scope, ["user"]);
  const location = managedLocation || (request.path ? join(request.path, "mcp_config.json") : windsurfUserConfigPath());
  const current = await readJsonFile<WindsurfConfig>(location, {});
  if (!current.mcpServers?.[request.name]) {
    return {
      client: "windsurf",
      scope: request.scope,
      name: request.name,
      method: "file",
      changed: false,
      location,
      managed: true,
      nextStep: "No managed Windsurf entry was present."
    };
  }
  const nextServers = { ...(current.mcpServers || {}) };
  delete nextServers[request.name];
  const next: WindsurfConfig = {
    ...current,
    mcpServers: Object.keys(nextServers).length ? nextServers : undefined
  };
  if (!request.dryRun) {
    await writeTextFileAtomic(location, JSON.stringify(next, null, 2) + "\n");
  }
  return {
    client: "windsurf",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed: true,
    location,
    managed: true,
    nextStep: "Windsurf config was updated. Windsurf-owned auth state is unchanged."
  };
}
