import { Output } from "../cli/output.js";
import { TokenManager } from "../auth/token-manager.js";
import { ConfigStore } from "../storage/config-store.js";
import { SecretStore } from "../storage/secret-store.js";
import { McpRuntimeClient } from "../core/mcp-client.js";
import type { GlobalOptions } from "../types/config.js";

export interface CommandContext {
  globalOptions: GlobalOptions;
  output: Output;
  configStore: ConfigStore;
  secretStore: SecretStore;
  tokenManager: TokenManager;
  runtimeClient: McpRuntimeClient;
}
