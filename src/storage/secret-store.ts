import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SessionRecord } from "../types/auth.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";

const SERVICE_NAME = "@vibecodr/mcp";

type AsyncEntryCtor = {
  new(service: string, username: string): {
    getPassword(): Promise<string | undefined>;
    setPassword(password: string): Promise<void>;
    deleteCredential(): Promise<boolean>;
  };
};

let asyncEntryCtorPromise: Promise<AsyncEntryCtor> | undefined;

async function loadAsyncEntryCtor(): Promise<AsyncEntryCtor> {
  if (!asyncEntryCtorPromise) {
    asyncEntryCtorPromise = import("@napi-rs/keyring")
      .then((mod) => mod.AsyncEntry as AsyncEntryCtor)
      .catch((error) => {
        throw new CliError("storage.secret_store_unavailable", "The native secure credential store binding is unavailable.", EXIT_CODES.secretStoreUnavailable, {
          cause: error,
          nextStep: "Install a supported keyring backend or use non-auth commands only until the secure store is available."
        });
      });
  }
  return await asyncEntryCtorPromise;
}

function profileAccount(profile: string): string {
  return `profile:${profile}`;
}

async function readFileStore(path: string): Promise<Record<string, SessionRecord>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, SessionRecord>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeFileStore(path: string, data: Record<string, SessionRecord>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tempPath, path);
}

export class SecretStore {
  private readonly fileStorePath = process.env.VIBECDR_MCP_INSECURE_SECRET_STORE_PATH;

  private async entry(profile: string) {
    const AsyncEntry = await loadAsyncEntryCtor();
    return new AsyncEntry(SERVICE_NAME, profileAccount(profile));
  }

  async get(profile: string): Promise<SessionRecord | undefined> {
    if (this.fileStorePath) {
      const data = await readFileStore(this.fileStorePath);
      return data[profile];
    }
    try {
      const entry = await this.entry(profile);
      const raw = await entry.getPassword();
      return raw ? JSON.parse(raw) as SessionRecord : undefined;
    } catch (error) {
      throw new CliError("storage.secret_store_read_failed", "Unable to read the secure credential store.", EXIT_CODES.secretStoreUnavailable, {
        cause: error,
        nextStep: "Confirm the OS credential store is available, then retry."
      });
    }
  }

  async set(profile: string, session: SessionRecord): Promise<void> {
    if (this.fileStorePath) {
      const data = await readFileStore(this.fileStorePath);
      data[profile] = session;
      await writeFileStore(this.fileStorePath, data);
      return;
    }
    try {
      const entry = await this.entry(profile);
      await entry.setPassword(JSON.stringify(session));
    } catch (error) {
      throw new CliError("storage.secret_store_write_failed", "Unable to write to the secure credential store.", EXIT_CODES.secretStoreUnavailable, {
        cause: error,
        nextStep: "Confirm the OS credential store is available, then retry."
      });
    }
  }

  async delete(profile: string): Promise<boolean> {
    if (this.fileStorePath) {
      const data = await readFileStore(this.fileStorePath);
      const existed = Boolean(data[profile]);
      delete data[profile];
      await writeFileStore(this.fileStorePath, data);
      return existed;
    }
    try {
      const entry = await this.entry(profile);
      return await entry.deleteCredential();
    } catch (error) {
      throw new CliError("storage.secret_store_delete_failed", "Unable to update the secure credential store.", EXIT_CODES.secretStoreUnavailable, {
        cause: error,
        nextStep: "Confirm the OS credential store is available, then retry."
      });
    }
  }

  async checkAvailability(): Promise<{ ok: boolean; summary: string }> {
    if (this.fileStorePath) {
      await writeFileStore(this.fileStorePath, {});
      return { ok: true, summary: "Contributor-only file secret store is enabled." };
    }
    const profile = `doctor:${randomUUID()}`;
    try {
      await this.set(profile, {
        schemaVersion: 1,
        serverUrl: "https://example.com/mcp",
        accessToken: "test",
        registrationMode: "manual",
        authorizationServerUrl: "https://example.com",
        clientInformation: { client_id: "test" },
        updatedAt: new Date().toISOString()
      });
      await this.delete(profile);
      return { ok: true, summary: "Secure credential store is available." };
    } catch (error) {
      if (error instanceof CliError) {
        return { ok: false, summary: error.message };
      }
      return { ok: false, summary: String(error) };
    }
  }
}
