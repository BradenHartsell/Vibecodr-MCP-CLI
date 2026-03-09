import { readFile } from "node:fs/promises";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { writeFileWithBackup } from "../storage/file-lock.js";

export interface InstallRequest {
  serverUrl: string;
  name: string;
  scope: "user" | "project";
  path?: string;
  openClient?: boolean;
  overwrite?: boolean;
  dryRun?: boolean;
}

export interface UninstallRequest {
  serverUrl: string;
  name: string;
  scope: "user" | "project";
  path?: string;
  dryRun?: boolean;
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new CliError("install.config_parse", `Existing config at ${path} is not valid JSON.`, EXIT_CODES.installConflict, {
        cause: error,
        nextStep: "Repair the existing config file before retrying."
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeTextFileAtomic(path: string, content: string): Promise<void> {
  await writeFileWithBackup(path, content);
}

export function requireScope(actual: "user" | "project", supported: Array<"user" | "project">): void {
  if (!supported.includes(actual)) {
    throw new CliError("install.unsupported_scope", `Scope ${actual} is not supported for this client.`, EXIT_CODES.unsupportedClient);
  }
}
