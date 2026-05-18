import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { InstallManifestStore } from "../src/storage/install-manifest.js";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const v1FixturePath = path.join(fixtureDir, "fixtures", "install-manifests", "v1-mcp-cli.json");

async function withScratchManifest<T>(seed: string, fn: (manifestPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibecodr-install-manifest-"));
  const manifestPath = path.join(dir, "installs.json");
  await writeFile(manifestPath, seed, { encoding: "utf8" });
  try {
    return await fn(manifestPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("v1 MCP-CLI install manifest fixture loads back two entries", async () => {
  const seed = await readFile(v1FixturePath, "utf8");
  await withScratchManifest(seed, async (manifestPath) => {
    const store = new InstallManifestStore(manifestPath);
    const all = await store.find(() => true);
    assert.equal(all.length, 2);
    const clients = all.map((entry) => entry.client).sort();
    assert.deepEqual(clients, ["codex", "cursor"]);
    const cursor = all.find((entry) => entry.client === "cursor");
    assert.ok(cursor);
    assert.equal(cursor.scope, "user");
    assert.equal(cursor.name, "vibecodr");
    assert.equal(cursor.method, "file");
    assert.equal(cursor.serverUrl, "https://openai.vibecodr.space/mcp");
  });
});

test("upsert on a v1 manifest persists the new install without dropping existing entries", async () => {
  const seed = await readFile(v1FixturePath, "utf8");
  await withScratchManifest(seed, async (manifestPath) => {
    const store = new InstallManifestStore(manifestPath);
    await store.upsert({
      client: "claude-code",
      scope: "user",
      name: "vibecodr",
      location: "claude mcp add",
      method: "cli",
      serverUrl: "https://openai.vibecodr.space/mcp",
      installedAt: "2026-05-18T10:00:00.000Z"
    });
    const all = await store.find(() => true);
    assert.equal(all.length, 3);
    const claudeCode = all.find((entry) => entry.client === "claude-code");
    assert.ok(claudeCode);
    assert.equal(claudeCode.method, "cli");
    assert.equal(claudeCode.location, "claude mcp add");

    const persisted = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.installs.length, 3);
  });
});

test("loading a manifest with an empty installs array yields no entries", async () => {
  const seed = JSON.stringify({ version: 1, installs: [] });
  await withScratchManifest(seed, async (manifestPath) => {
    const store = new InstallManifestStore(manifestPath);
    const all = await store.find(() => true);
    assert.equal(all.length, 0);
  });
});

test("loading a malformed manifest (installs missing) recovers to an empty list", async () => {
  // WHY: a partial-shape v1 manifest can exist if a previous version of the CLI was
  // killed mid-write or an external tool truncated the file. The store must not throw
  // for the recoverable case; consumers re-create the manifest by upserting.
  const seed = JSON.stringify({ version: 1 });
  await withScratchManifest(seed, async (manifestPath) => {
    const store = new InstallManifestStore(manifestPath);
    const all = await store.find(() => true);
    assert.equal(all.length, 0);
  });
});

test("remove drops only matching entries; remaining entries persist", async () => {
  const seed = await readFile(v1FixturePath, "utf8");
  await withScratchManifest(seed, async (manifestPath) => {
    const store = new InstallManifestStore(manifestPath);
    const removed = await store.remove((entry) => entry.client === "cursor");
    assert.equal(removed.length, 1);
    const remaining = await store.find(() => true);
    assert.equal(remaining.length, 1);
    const survivor = remaining[0];
    assert.ok(survivor);
    assert.equal(survivor.client, "codex");
  });
});
