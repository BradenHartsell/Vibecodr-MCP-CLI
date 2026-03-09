import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { CliError, EXIT_CODES } from "../cli/errors.js";

function windowsSystemCommand(name: string): string {
  const systemRoot = process.env.SystemRoot?.trim() || "C:\\Windows";
  return join(systemRoot, "System32", name);
}

function commandBinaryAvailable(command: string): boolean {
  if (command.includes("\\") || command.includes("/")) {
    try {
      accessSync(command, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
  const checker = process.platform === "win32" ? windowsSystemCommand("where.exe") : "which";
  const result = spawnSync(checker, [command], { stdio: "ignore" });
  return result.status === 0;
}

export function browserOpenCommandForCurrentPlatform(): { command: string; args: string[] } | null {
  switch (process.platform) {
    case "win32":
      return { command: windowsSystemCommand("rundll32.exe"), args: ["url.dll,FileProtocolHandler"] };
    case "darwin":
      return { command: "open", args: [] };
    default:
      return { command: "xdg-open", args: [] };
  }
}

export function browserLauncherAvailable(): boolean {
  const launcher = browserOpenCommandForCurrentPlatform();
  if (!launcher) return false;
  if (process.platform === "win32") {
    return commandBinaryAvailable(launcher.command);
  }
  const check = spawnSync(launcher.command, ["--help"], { stdio: "ignore" });
  return check.status === 0 || check.status === 1;
}

export async function openExternalUrl(url: string): Promise<void> {
  const launcher = browserOpenCommandForCurrentPlatform();
  if (!launcher) {
    throw new CliError("auth.browser_unavailable", "No browser launcher is available on this platform.", EXIT_CODES.authRequired);
  }

  await new Promise<void>((resolve, reject) => {
    const args = [...launcher.args, url];
    const child = spawn(launcher.command, args, {
      detached: process.platform !== "win32",
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => resolve());
    child.unref();
  }).catch((error) => {
    throw new CliError("auth.browser_open_failed", `Failed to open a browser for ${url}.`, EXIT_CODES.authRequired, {
      nextStep: "Retry without --browser open so the CLI prints the URL for manual browser auth.",
      cause: error
    });
  });
}
