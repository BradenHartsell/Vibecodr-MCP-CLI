import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionRecord } from "../types/auth.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { secretStoreDirectory } from "../platform/paths.js";
import { writeFileWithBackup } from "./file-lock.js";

const SERVICE_NAME = "@vibecodr/mcp";
const KEY_BYTES = 32;
const CURRENT_SECRET_FILE_VERSION = 1;

type StoredEnvelope = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

type AsyncEntryCtor = {
  new(service: string, username: string): {
    getPassword(): Promise<string | undefined>;
    setPassword(password: string): Promise<void>;
    deleteCredential(): Promise<boolean>;
  };
};

type SecretEntry = {
  getPassword(): Promise<string | undefined>;
  setPassword(password: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
};

type SecretEntryFactory = (service: string, username: string) => Promise<SecretEntry>;

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

function profileKeyAccount(profile: string): string {
  return `profile-key:${profile}`;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function sanitizeProfile(profile: string): string {
  return encodeURIComponent(profile);
}

function isSessionRecord(value: unknown): value is SessionRecord {
  return Boolean(value)
    && typeof value === "object"
    && (value as Record<string, unknown>).schemaVersion === 1
    && typeof (value as Record<string, unknown>).serverUrl === "string"
    && typeof (value as Record<string, unknown>).accessToken === "string";
}

function encryptSession(session: SessionRecord, key: Buffer): StoredEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: CURRENT_SECRET_FILE_VERSION,
    iv: base64UrlEncode(iv),
    tag: base64UrlEncode(tag),
    ciphertext: base64UrlEncode(ciphertext)
  };
}

function decryptSession(envelope: StoredEnvelope, key: Buffer): SessionRecord {
  if (envelope.version !== CURRENT_SECRET_FILE_VERSION) {
    throw new Error(`Unsupported secret file version: ${envelope.version}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, base64UrlDecode(envelope.iv));
  decipher.setAuthTag(base64UrlDecode(envelope.tag));
  const plaintext = Buffer.concat([
    decipher.update(base64UrlDecode(envelope.ciphertext)),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plaintext) as SessionRecord;
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
  private readonly fileStorePath: string | undefined;
  private readonly encryptedStoreDir: string;
  private readonly entryFactory: SecretEntryFactory;

  constructor(options?: {
    fileStorePath?: string;
    encryptedStoreDir?: string;
    entryFactory?: SecretEntryFactory;
  }) {
    this.fileStorePath = options?.fileStorePath ?? process.env.VIBECDR_MCP_INSECURE_SECRET_STORE_PATH;
    this.encryptedStoreDir = options?.encryptedStoreDir ?? secretStoreDirectory();
    this.entryFactory = options?.entryFactory ?? (async (service, username) => {
      const AsyncEntry = await loadAsyncEntryCtor();
      return new AsyncEntry(service, username);
    });
  }

  private async entry(profile: string) {
    return await this.entryFactory(SERVICE_NAME, profileAccount(profile));
  }

  private async keyEntry(profile: string) {
    return await this.entryFactory(SERVICE_NAME, profileKeyAccount(profile));
  }

  private encryptedSessionPath(profile: string): string {
    return join(this.encryptedStoreDir, `${sanitizeProfile(profile)}.json`);
  }

  private async loadLegacyInlineSession(profile: string): Promise<SessionRecord | undefined> {
    const entry = await this.entry(profile);
    const raw = await entry.getPassword();
    if (!raw) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    return isSessionRecord(parsed) ? parsed : undefined;
  }

  private async getOrCreateProfileKey(profile: string): Promise<Buffer> {
    const entry = await this.keyEntry(profile);
    const raw = await entry.getPassword();
    if (raw) return base64UrlDecode(raw);
    const generated = randomBytes(KEY_BYTES);
    await entry.setPassword(base64UrlEncode(generated));
    return generated;
  }

  private async readEncryptedSession(profile: string): Promise<SessionRecord | undefined> {
    const path = this.encryptedSessionPath(profile);
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as StoredEnvelope;
      const keyEntry = await this.keyEntry(profile);
      const encodedKey = await keyEntry.getPassword();
      if (!encodedKey) return undefined;
      const session = decryptSession(parsed, base64UrlDecode(encodedKey));
      return isSessionRecord(session) ? session : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async persistEncryptedSession(profile: string, session: SessionRecord): Promise<void> {
    const path = this.encryptedSessionPath(profile);
    await mkdir(dirname(path), { recursive: true });
    const key = await this.getOrCreateProfileKey(profile);
    const envelope = encryptSession(session, key);
    await writeFileWithBackup(path, JSON.stringify(envelope, null, 2) + "\n");
  }

  private async removeEncryptedSession(profile: string): Promise<boolean> {
    const path = this.encryptedSessionPath(profile);
    try {
      await readFile(path, "utf8");
      await rm(path, { force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async deleteCredentialBestEffort(loadEntry: Promise<SecretEntry>): Promise<boolean> {
    try {
      const entry = await loadEntry;
      return await entry.deleteCredential();
    } catch {
      return false;
    }
  }

  async get(profile: string): Promise<SessionRecord | undefined> {
    if (this.fileStorePath) {
      const data = await readFileStore(this.fileStorePath);
      return data[profile];
    }
    try {
      const encrypted = await this.readEncryptedSession(profile);
      if (encrypted) return encrypted;
      const legacy = await this.loadLegacyInlineSession(profile);
      if (legacy) {
        await this.persistEncryptedSession(profile, legacy);
        await (await this.entry(profile)).deleteCredential().catch(() => undefined);
        return legacy;
      }
      return undefined;
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
      await this.persistEncryptedSession(profile, session);
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
      const [encryptedRemoved, legacyRemoved, keyRemoved] = await Promise.all([
        this.removeEncryptedSession(profile),
        this.deleteCredentialBestEffort(this.entry(profile)),
        this.deleteCredentialBestEffort(this.keyEntry(profile))
      ]);
      return encryptedRemoved || legacyRemoved || keyRemoved;
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
