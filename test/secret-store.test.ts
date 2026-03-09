import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SecretStore } from "../src/storage/secret-store.js";
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
