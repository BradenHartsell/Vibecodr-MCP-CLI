import { spawn } from "node:child_process";
import { CliError, EXIT_CODES } from "../cli/errors.js";

export function browserOpenCommandForCurrentPlatform(): { command: string; args: string[] } | null {
  switch (process.platform) {
    case "win32":
      return { command: "cmd", args: ["/c", "start", "", ""] };
    case "darwin":
      return { command: "open", args: [] };
    default:
      return { command: "xdg-open", args: [] };
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  const launcher = browserOpenCommandForCurrentPlatform();
  if (!launcher) {
    throw new CliError("auth.browser_unavailable", "No browser launcher is available on this platform.", EXIT_CODES.authRequired);
  }

  await new Promise<void>((resolve, reject) => {
    const args = launcher.command === "cmd"
      ? ["/c", "start", "", url]
      : [...launcher.args, url];
    const child = spawn(launcher.command, args, {
      detached: process.platform !== "win32",
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => resolve());
    child.unref();
  }).catch((error) => {
    throw new CliError("auth.browser_open_failed", `Failed to open a browser for ${url}.`, EXIT_CODES.authRequired, {
      nextStep: "Retry with --browser print and open the URL manually.",
      cause: error
    });
  });
}
