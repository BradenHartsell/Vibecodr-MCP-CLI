import { join } from "node:path";
import { homedir } from "node:os";

function windowsAppDataPath(): string {
  return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
}

export function codexConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
}

export function cursorUserConfigPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

export function vscodeWorkspaceConfigPath(rootPath: string): string {
  return join(rootPath, ".vscode", "mcp.json");
}

export function windsurfUserConfigPath(): string {
  return join(homedir(), ".codeium", "windsurf", "mcp_config.json");
}

export function windsurfLegacyConfigPath(): string {
  return join(homedir(), ".codeium", "mcp_config.json");
}

export function projectCursorConfigPath(rootPath: string): string {
  return join(rootPath, ".cursor", "mcp.json");
}
