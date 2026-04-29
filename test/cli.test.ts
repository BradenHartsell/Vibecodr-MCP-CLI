import test from "node:test";
import assert from "node:assert/strict";
import { parseGlobalOptions } from "../src/cli/parse.js";
import { summarizeToolSchema, renderToolResult } from "../src/core/renderers.js";
import { OFFICIAL_CLIENT_METADATA_URL, OFFICIAL_SERVER_URL, officialClientInformation } from "../src/auth/official-client.js";
import { runLoginCommand } from "../src/commands/login.js";
import { runPulseSetupCommand } from "../src/commands/pulse-setup.js";
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

test("pulse-setup command reads general MCP setup guidance without descriptor input", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await runPulseSetupCommand([], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, _accessToken: string | undefined, name: string, input: Record<string, unknown>) => {
          assert.equal(name, "get_pulse_setup_guidance");
          assert.deepEqual(input, {});
          return {
            structuredContent: {
              descriptorMetadata: {
                sourceOfTruth: "PulseDescriptor",
                apiVersion: "pulse/v1",
                normalizedDescriptorVersion: 1,
                setupTaskKinds: ["pulse", "secret", "connection", "state"],
                activeSetupTaskKinds: [],
                requiresBackendSetup: false,
                guidanceSource: "general_contract",
                compatibility: {
                  blockerCount: 0,
                  warningCount: 0
                },
                runtimeEnv: {
                  fetch: "env.fetch",
                  secrets: "env.secrets.bearer/header/query/verifyHmac",
                  webhooks: 'env.webhooks.verify("stripe")',
                  connections: "env.connections.use(provider).fetch",
                  log: "env.log",
                  request: "env.request",
                  runtime: "env.runtime",
                  waitUntil: "env.waitUntil"
                },
                runtimeSemantics: {
                  fetch: "env.fetch is Vibecodr policy-mediated fetch.",
                  secrets: "env.secrets does not expose raw secret values.",
                  webhooks: "env.webhooks.verify(\"stripe\") verifies bounded raw bodies.",
                  connections: "env.connections.use(provider).fetch keeps provider tokens platform-owned.",
                  log: "env.log accepts structured event records.",
                  request: "env.request is sanitized request access.",
                  runtime: "env.runtime carries safe correlation metadata only.",
                  waitUntil: "env.waitUntil is best-effort after-response work."
                }
              },
              descriptorEvaluation: {
                status: "general_contract",
                guidanceSource: "general_contract",
                requiresBackendSetup: false,
                activeSetupTaskKinds: [],
                setupTasks: [],
                blockers: [],
                warnings: []
              }
            }
          };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.tool, "get_pulse_setup_guidance");
  assert.equal(parsed.result.structuredContent.descriptorMetadata.sourceOfTruth, "PulseDescriptor");
  assert.equal(parsed.result.structuredContent.descriptorMetadata.apiVersion, "pulse/v1");
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.fetch, /policy-mediated/);
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.secrets, /raw secret values/);
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.connections, /platform-owned/);
      const internalD1BindingName = ["Pro", "User_Binding"].join("_");
      assert.doesNotMatch(
        JSON.stringify(parsed.result),
        new RegExp(`${internalD1BindingName}|__VC_STATE_GATEWAY|grant header|delete_pulse|listClaims`, "i"),
      );
});

test("pulse-setup command passes descriptor setup projection into MCP guidance", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  const openAiSecretName = ["OPENAI", "API_KEY"].join("_");
  const descriptorSetup = {
    setupTasks: [
      { kind: "secret", name: openAiSecretName },
      { kind: "raw_body", label: "Webhook raw body" }
    ],
    compatibility: { blockers: [], warnings: [] }
  };

  try {
    await runPulseSetupCommand(["--descriptor-setup-json", JSON.stringify(descriptorSetup)], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, _accessToken: string | undefined, name: string, input: Record<string, unknown>) => {
          assert.equal(name, "get_pulse_setup_guidance");
          assert.deepEqual(input, { descriptorSetup });
          return {
            structuredContent: {
              descriptorMetadata: {
                sourceOfTruth: "PulseDescriptor",
                apiVersion: "pulse/v1",
                normalizedDescriptorVersion: 1,
                setupTaskKinds: ["pulse", "secret", "connection", "raw_body", "state"],
                activeSetupTaskKinds: ["secret", "raw_body"],
                requiresBackendSetup: true,
                guidanceSource: "descriptor_setup",
                compatibility: {
                  blockerCount: 0,
                  warningCount: 0
                },
                runtimeSemantics: {
                  fetch: "env.fetch is Vibecodr policy-mediated fetch.",
                  secrets: "env.secrets does not expose raw secret values.",
                  webhooks: "env.webhooks.verify(\"stripe\") verifies bounded raw bodies.",
                  connections: "env.connections.use(provider).fetch keeps provider tokens platform-owned."
                }
              },
              descriptorEvaluation: {
                status: "descriptor_evaluated",
                guidanceSource: "descriptor_setup",
                requiresBackendSetup: true,
                activeSetupTaskKinds: ["secret", "raw_body"],
                setupTasks: descriptorSetup.setupTasks,
                blockers: [],
                warnings: []
              }
            }
          };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.deepEqual(parsed.arguments, { descriptorSetup });
  assert.equal(parsed.result.structuredContent.descriptorEvaluation.guidanceSource, "descriptor_setup");
  assert.deepEqual(parsed.result.structuredContent.descriptorEvaluation.activeSetupTaskKinds, ["secret", "raw_body"]);
});
