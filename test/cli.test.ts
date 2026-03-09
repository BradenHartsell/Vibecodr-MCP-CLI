import test from "node:test";
import assert from "node:assert/strict";
import { parseGlobalOptions } from "../src/cli/parse.js";
import { summarizeToolSchema, renderToolResult } from "../src/core/renderers.js";
import { OFFICIAL_CLIENT_METADATA_URL, OFFICIAL_SERVER_URL, officialClientInformation } from "../src/auth/official-client.js";
import { runLoginCommand } from "../src/commands/login.js";
import { Output } from "../src/cli/output.js";

test("parseGlobalOptions extracts shared flags around a command", () => {
  const parsed = parseGlobalOptions([
    "--profile",
    "staging",
    "tools",
    "--json",
    "--server-url",
    "https://example.com/mcp"
  ]);
  assert.equal(parsed.command, "tools");
  assert.equal(parsed.globalOptions.profile, "staging");
  assert.equal(parsed.globalOptions.json, true);
  assert.equal(parsed.globalOptions.serverUrl, "https://example.com/mcp");
});

test("summarizeToolSchema builds required and optional fields", () => {
  const summary = summarizeToolSchema({
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      published: { type: "boolean" },
      retries: { type: "number" }
    }
  });
  assert.deepEqual(summary.required, ["title"]);
  assert.deepEqual(summary.optional, ["published", "retries"]);
  assert.deepEqual(summary.skeleton, {
    title: "",
    published: false,
    retries: 0
  });
});

test("renderToolResult prefers text content when present", () => {
  const rendered = renderToolResult({
    content: [
      { type: "text", text: "Hello from a tool." }
    ],
    structuredContent: {
      ignored: true
    }
  });
  assert.equal(rendered, "Hello from a tool.");
});

test("official client identity is committed in package code", () => {
  assert.equal(OFFICIAL_SERVER_URL, "https://openai.vibecodr.space/mcp");
  assert.equal(OFFICIAL_CLIENT_METADATA_URL, "https://openai.vibecodr.space/.well-known/oauth-client/vibecodr-mcp.json");
  assert.deepEqual(officialClientInformation(), {
    client_id: "https://openai.vibecodr.space/.well-known/oauth-client/vibecodr-mcp.json"
  });
});

test("login --json emits only structured output when the default browser mode prints the URL", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await runLoginCommand([], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: false
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: false
      }),
      configStore: {} as never,
      secretStore: {} as never,
      runtimeClient: {} as never,
      tokenManager: {
        login: async (_globalOptions: unknown, options?: { onAuthorizationUrl?: (url: string) => void }) => {
          options?.onAuthorizationUrl?.("https://example.com/authorize");
          return {
            schemaVersion: 1,
            profile: "default",
            serverUrl: OFFICIAL_SERVER_URL,
            registrationMode: "cimd",
            authenticated: true as const,
            hasRefreshToken: true
          };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const output = writes.join("");
  assert.match(output, /^\{\n/);
  assert.ok(!output.startsWith("https://example.com/authorize"));
  const parsed = JSON.parse(output);
  assert.equal(parsed.authorizationUrl, "https://example.com/authorize");
});
