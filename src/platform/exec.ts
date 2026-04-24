import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

function windowsSystemCommand(name: string): string {
  const systemRoot = process.env["SystemRoot"]?.trim() || "C:\\Windows";
  return join(systemRoot, "System32", name);
}

export function commandExists(command: string): boolean {
  const checker = process.platform === "win32" ? windowsSystemCommand("where.exe") : "which";
  const result = spawnSync(checker, [command], { stdio: "ignore" });
  return result.status === 0;
}

export function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
