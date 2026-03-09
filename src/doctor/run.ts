import { spawnSync } from "node:child_process";
import { SecretStore } from "../storage/secret-store.js";
import { TokenManager } from "../auth/token-manager.js";
import type { GlobalOptions } from "../types/config.js";
import { codexConfigPath, cursorUserConfigPath, vscodeWorkspaceConfigPath, windsurfLegacyConfigPath, windsurfUserConfigPath } from "../platform/paths.js";
import { access } from "node:fs/promises";

export interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  summary: string;
}

function detectBrowserLauncher(): boolean {
  if (process.platform === "win32") return true;
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const check = spawnSync(command, ["--help"], { stdio: "ignore" });
  return check.status === 0 || check.status === 1;
}

function commandExists(command: string): boolean {
  const result = process.platform === "win32"
    ? spawnSync("cmd", ["/c", "where", command], { stdio: "ignore" })
    : spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(globalOptions: GlobalOptions, tokenManager: TokenManager, secretStore: SecretStore, targetClient?: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const majorVersion = Number(process.versions.node.split(".")[0] || "0");
  checks.push({
    id: "node-version",
    status: majorVersion >= 22 && majorVersion < 26 ? "pass" : "fail",
    summary: `Node ${process.versions.node} detected.`
  });

  checks.push({
    id: "browser-launcher",
    status: detectBrowserLauncher() ? "pass" : "warn",
    summary: detectBrowserLauncher() ? "A browser launcher is available." : "No browser launcher was detected."
  });

  const secretStoreCheck = await secretStore.checkAvailability();
  checks.push({
    id: "secret-store",
    status: secretStoreCheck.ok ? "pass" : "fail",
    summary: secretStoreCheck.summary
  });

  try {
    const { serverUrl } = await tokenManager.resolveProfile(globalOptions);
    const { profileName } = await tokenManager.resolveProfile(globalOptions);
    const session = await tokenManager.getSession(profileName);
    const discovery = await tokenManager.discover(serverUrl);
    checks.push({
      id: "server-reachability",
      status: "pass",
      summary: `Discovered authorization server ${discovery.authorizationServerUrl}.`
    });
    checks.push({
      id: "pkce-supported",
      status: Array.isArray(discovery.authorizationServerMetadata?.code_challenge_methods_supported)
        && discovery.authorizationServerMetadata.code_challenge_methods_supported.includes("S256")
        ? "pass"
        : "fail",
      summary: Array.isArray(discovery.authorizationServerMetadata?.code_challenge_methods_supported)
        && discovery.authorizationServerMetadata.code_challenge_methods_supported.includes("S256")
        ? "Authorization server advertises PKCE S256."
        : "Authorization server metadata does not advertise PKCE S256."
    });
    checks.push({
      id: "refresh-token",
      status: session?.refreshToken ? "pass" : "warn",
      summary: session?.refreshToken ? "A refresh token is available for the current profile." : "No refresh token is stored for the current profile."
    });
  } catch (error) {
    checks.push({
      id: "server-reachability",
      status: "fail",
      summary: error instanceof Error ? error.message : String(error)
    });
  }

  if (targetClient === "codex") {
    checks.push({
      id: "codex-cli",
      status: commandExists("codex") ? "pass" : "warn",
      summary: commandExists("codex") ? "Codex CLI is available." : "Codex CLI is not on PATH."
    });
    checks.push({
      id: "codex-config",
      status: await pathExists(codexConfigPath()) ? "pass" : "warn",
      summary: `Codex config path: ${codexConfigPath()}`
    });
  }
  if (targetClient === "cursor") {
    checks.push({
      id: "cursor-config",
      status: "pass",
      summary: `Cursor user config path: ${cursorUserConfigPath()}`
    });
  }
  if (targetClient === "vscode") {
    checks.push({
      id: "vscode-cli",
      status: commandExists("code") ? "pass" : "warn",
      summary: commandExists("code") ? "VS Code CLI is available." : "VS Code CLI is not on PATH."
    });
    checks.push({
      id: "vscode-workspace-config",
      status: "pass",
      summary: `VS Code workspace config path: ${vscodeWorkspaceConfigPath(process.cwd())}`
    });
  }
  if (targetClient === "windsurf") {
    checks.push({
      id: "windsurf-config",
      status: "pass",
      summary: `Windsurf user config path: ${windsurfUserConfigPath()}`
    });
    checks.push({
      id: "windsurf-legacy-config",
      status: await pathExists(windsurfLegacyConfigPath()) ? "warn" : "pass",
      summary: `Legacy Windsurf plugin path: ${windsurfLegacyConfigPath()}`
    });
  }

  return checks;
}
