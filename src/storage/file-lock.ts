import { copyFile, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CliError, EXIT_CODES } from "../cli/errors.js";

export class FileLock {
  constructor(private readonly lockPath: string) {}

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.lockPath), { recursive: true });
    let handle;
    try {
      handle = await open(this.lockPath, "wx");
    } catch (error) {
      throw new CliError("install.locked", `Another process is already modifying ${this.lockPath}.`, EXIT_CODES.installConflict, {
        cause: error
      });
    }
    try {
      return await fn();
    } finally {
      await handle?.close().catch(() => undefined);
      await unlink(this.lockPath).catch(() => undefined);
    }
  }
}

export async function writeFileWithBackup(path: string, content: string): Promise<void> {
  const lock = new FileLock(`${path}.lock`);
  await lock.withLock(async () => {
    await mkdir(dirname(path), { recursive: true });
    try {
      await copyFile(path, `${path}.bak`);
    } catch {}
    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, path);
  });
}
