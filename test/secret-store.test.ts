import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SecretStore, secureStoreHelpForPlatform } from "../src/storage/secret-store.js";
import type { SessionRecord } from "../src/types/auth.js";

type FakeSecretEntry = {
  getPassword(): Promise<string | undefined>;
  setPassword(password: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
};

function createFakeEntryFactory() {
  const values = new Map<string, string>();
  const key = (service: string, username: string) => `${service}::${username}`;
  return {
    values,
    factory: async (service: string, username: string): Promise<FakeSecretEntry> => ({
      async getPassword() {
        return values.get(key(service, username));
      },
      async setPassword(password: string) {
        values.set(key(service, username), password);
      },
      async deleteCredential() {
        return values.delete(key(service, username));
      }
    })
  };
}

function sampleSession(overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    schemaVersion: 1,
    serverUrl: "https://openai.vibecodr.space/mcp",
    accessToken: "access-" + "x".repeat(4096),
    refreshToken: "refresh-" + "y".repeat(256),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "openid profile email offline_access",
    tokenType: "Bearer",
    registrationMode: "cimd",
    authorizationServerUrl: "https://openai.vibecodr.space",
    clientInformation: {
      client_id: "https://openai.vibecodr.space/.well-known/oauth-client/vibecodr-mcp.json"
    },
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

test("secret store persists large sessions in encrypted files while keeping only a small key in the secure store", async () => {
  const temp = await mkdtemp(join(tmpdir(), "vibecodr-secret-store-"));
  const fake = createFakeEntryFactory();
  const store = new SecretStore({
    encryptedStoreDir: temp,
    entryFactory: fake.factory
  });
  const session = sampleSession();

  await store.set("default", session);

  const encryptedPath = join(temp, "default.json");
  const encryptedRaw = await readFile(encryptedPath, "utf8");
  assert.ok(encryptedRaw.includes("\"ciphertext\""));
  assert.ok(!encryptedRaw.includes(session.accessToken));

  const keyEntry = fake.values.get("@vibecodr/mcp::profile-key:default");
  assert.ok(keyEntry);
  assert.ok(keyEntry.length < session.accessToken.length);

  const loaded = await store.get("default");
  assert.deepEqual(loaded, session);
});

test("secret store migrates legacy inline keyring sessions into encrypted file storage", async () => {
  const temp = await mkdtemp(join(tmpdir(), "vibecodr-secret-store-migrate-"));
  const fake = createFakeEntryFactory();
  const session = sampleSession({ accessToken: "legacy-token" });
  fake.values.set("@vibecodr/mcp::profile:default", JSON.stringify(session));

  const store = new SecretStore({
    encryptedStoreDir: temp,
    entryFactory: fake.factory
  });

  const loaded = await store.get("default");
  assert.deepEqual(loaded, session);
  assert.equal(fake.values.has("@vibecodr/mcp::profile:default"), false);
  assert.ok(fake.values.has("@vibecodr/mcp::profile-key:default"));

  const encryptedPath = join(temp, "default.json");
  const encryptedRaw = await readFile(encryptedPath, "utf8");
  assert.ok(encryptedRaw.includes("\"ciphertext\""));
});

test("secret store delete still removes the encrypted session when keyring entry loading fails", async () => {
  const temp = await mkdtemp(join(tmpdir(), "vibecodr-secret-store-delete-"));
  let entryLoads = 0;
  const store = new SecretStore({
    encryptedStoreDir: temp,
    entryFactory: async () => {
      entryLoads += 1;
      throw new Error("keyring unavailable");
    }
  });
  const session = sampleSession({ accessToken: "delete-token" });

  await store.set("default", session).catch(() => undefined);

  const encryptedPath = join(temp, "default.json");
  const fallbackStore = new SecretStore({
    encryptedStoreDir: temp,
    entryFactory: createFakeEntryFactory().factory
  });
  await fallbackStore.set("default", session);

  const deleted = await store.delete("default");
  assert.equal(deleted, true);
  await assert.rejects(readFile(encryptedPath, "utf8"), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  assert.equal(entryLoads > 0, true);
});

test("env plaintext secret store requires explicit local-test opt-in", async () => {
  const temp = await mkdtemp(join(tmpdir(), "vibecodr-secret-store-env-"));
  const previousPath = process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"];
  const previousEnable = process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"];
  try {
    process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"] = join(temp, "secrets.json");
    delete process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"];
    assert.throws(() => new SecretStore(), /plaintext secret store without explicit opt-in/);

    process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"] = "true";
    const store = new SecretStore();
    await store.set("default", sampleSession({ accessToken: "plaintext-test-token" }));
    assert.equal((await store.get("default"))?.accessToken, "plaintext-test-token");
  } finally {
    if (previousPath === undefined) delete process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"];
    else process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"] = previousPath;
    if (previousEnable === undefined) delete process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"];
    else process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"] = previousEnable;
  }
});

test("literal undefined env value does not enable plaintext secret store mode", () => {
  const previousPath = process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"];
  const previousEnable = process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"];
  try {
    process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"] = "undefined";
    delete process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"];
    assert.doesNotThrow(() => new SecretStore({ entryFactory: createFakeEntryFactory().factory }));
  } finally {
    if (previousPath === undefined) delete process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"];
    else process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"] = previousPath;
    if (previousEnable === undefined) delete process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"];
    else process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"] = previousEnable;
  }
});

test("secure store help is platform-specific for macOS, Windows, and Linux", () => {
  assert.match(secureStoreHelpForPlatform("darwin"), /Keychain/);
  assert.match(secureStoreHelpForPlatform("win32"), /Credential Manager/);
  assert.match(secureStoreHelpForPlatform("linux"), /Secret Service/);
});

test("secure store availability failure includes platform guidance", async () => {
  const store = new SecretStore({
    entryFactory: async () => {
      throw new Error("native store unavailable");
    }
  });

  const check = await store.checkAvailability();

  assert.equal(check.ok, false);
  assert.match(check.summary, /credential store|Keychain|Credential Manager|Secret Service/);
  assert.match(check.summary, /plaintext file secret store is only for local automated tests/);
});

test("plaintext secret store availability check preserves existing sessions", async () => {
  const temp = await mkdtemp(join(tmpdir(), "vibecodr-secret-store-check-"));
  const storePath = join(temp, "secrets.json");
  const session = sampleSession({ accessToken: "keep-me" });
  await writeFile(storePath, JSON.stringify({ default: session }, null, 2) + "\n", "utf8");
  const store = new SecretStore({ fileStorePath: storePath });

  const check = await store.checkAvailability();

  assert.equal(check.ok, true);
  assert.deepEqual(await store.get("default"), session);
});
