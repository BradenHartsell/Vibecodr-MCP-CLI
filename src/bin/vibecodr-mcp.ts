#!/usr/bin/env node
import { reconcileEnv } from "../core/env.js";
import { migrateLegacyDirsOnce } from "../storage/migrate.js";
import { ConfigStore } from "../storage/config-store.js";
import { SecretStore } from "../storage/secret-store.js";
import { TokenManager } from "../auth/token-manager.js";
import { DefaultCredentialBroker } from "../auth/credential-broker.js";
import { CLIENT_INFO, McpRuntimeClient } from "../core/mcp-client.js";
import { Output } from "../cli/output.js";
import { isHelpToken, isVersionToken, parseGlobalOptions } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { AGENT_COMPUTER_COMMANDS } from "../app/command-registry.js";
import { commandSuggestion, rootHelpText } from "../app/help.js";
import { runLoginCommand } from "../commands/login.js";
import { runLogoutCommand } from "../commands/logout.js";
import { runStatusCommand } from "../commands/status.js";
import { runWhoamiCommand } from "../commands/whoami.js";
import { runToolsCommand } from "../commands/tools.js";
import { runCallCommand } from "../commands/call.js";
import { runMcpCommand } from "../commands/mcp.js";
import { runDoctorCommand } from "../commands/doctor.js";
import { runConfigCommand } from "../commands/config.js";
import { runFeedbackCommand } from "../commands/feedback.js";
import { runInstallCommand } from "../commands/install.js";
import { runUninstallCommand } from "../commands/uninstall.js";
import { runPulseSetupCommand } from "../commands/pulse-setup.js";
import { runPulsePublishCommand } from "../commands/pulse-publish.js";
import { runPulseCommand } from "../commands/pulse.js";
import { runUploadCommand } from "../commands/upload.js";
import { runUpdateCommand } from "../commands/update.js";
import { ConfigStore as VcToolsConfigStore } from "../legacy/config/store.js";

reconcileEnv();
await migrateLegacyDirsOnce();

function versionText(): string {
  return String(CLIENT_INFO.version);
}

const AGENT_COMPUTER_AUTH_SCOPES = new Set(["agent", "agent-computer", "computer"]);
const MCP_GATEWAY_AUTH_SCOPES = new Set(["mcp", "mcp-gateway", "gateway"]);

function legacyArgsWithSharedFlags(command: string, commandArgs: string[], globalOptions: { json: boolean; nonInteractive: boolean }): string[] {
  const args = [command, ...commandArgs];
  if (globalOptions.json && !args.includes("--json")) args.push("--json");
  if (globalOptions.nonInteractive && !args.includes("--no-input")) args.push("--no-input");
  return args;
}

function originalLegacyArgs(rawArgv: string[], globalOptions: { nonInteractive: boolean }): string[] {
  const args = rawArgv.filter((arg) => arg !== "--non-interactive");
  if (!globalOptions.nonInteractive || args.includes("--no-input")) return args;
  return [...args, "--no-input"];
}

async function runLegacyAgentComputer(args: string[]): Promise<void> {
  const { runCli } = await import("../legacy/cli/run.js");
  const code = await runCli(args);
  process.exitCode = code;
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);
  let { command, commandArgs, globalOptions } = parseGlobalOptions(rawArgv);
  let helpRerouted = false;
  if (command === "help") {
    if (commandArgs.length === 0) {
      process.stdout.write(rootHelpText() + "\n");
      return;
    }
    const [helpTarget, ...helpRest] = commandArgs;
    command = helpTarget;
    commandArgs = [...helpRest, "--help"];
    helpRerouted = true;
  }
  if (!command || isHelpToken(command)) {
    process.stdout.write(rootHelpText() + "\n");
    return;
  }
  if (isVersionToken(command)) {
    process.stdout.write(versionText() + "\n");
    return;
  }

  const configStore = new ConfigStore();
  const secretStore = new SecretStore();
  const tokenManager = new TokenManager(configStore, secretStore);
  const runtimeClient = new McpRuntimeClient();
  const output = new Output(globalOptions);
  const vcToolsStore = VcToolsConfigStore.resolve(process.env);
  const credentialBroker = new DefaultCredentialBroker({
    vcToolsStore,
    mcpSecretStore: secretStore,
    mcpConfigStore: configStore
  });
  const context = {
    globalOptions,
    output,
    configStore,
    secretStore,
    tokenManager,
    runtimeClient,
    credentialBroker
  };

  switch (command) {
    case "login":
      if (AGENT_COMPUTER_AUTH_SCOPES.has(commandArgs[0] ?? "")) {
        await runLegacyAgentComputer(legacyArgsWithSharedFlags(command, commandArgs.slice(1), globalOptions));
        return;
      }
      if (MCP_GATEWAY_AUTH_SCOPES.has(commandArgs[0] ?? "")) {
        await runLoginCommand(commandArgs.slice(1), context);
        return;
      }
      await runLoginCommand(commandArgs, context);
      return;
    case "logout":
      if (AGENT_COMPUTER_AUTH_SCOPES.has(commandArgs[0] ?? "")) {
        await runLegacyAgentComputer(legacyArgsWithSharedFlags(command, commandArgs.slice(1), globalOptions));
        return;
      }
      if (MCP_GATEWAY_AUTH_SCOPES.has(commandArgs[0] ?? "")) {
        await runLogoutCommand(commandArgs.slice(1), context);
        return;
      }
      await runLogoutCommand(commandArgs, context);
      return;
    case "status":
      await runStatusCommand(commandArgs, context);
      return;
    case "whoami":
      await runWhoamiCommand(commandArgs, context);
      return;
    case "tools":
      if (commandArgs[0] === "test") {
        await runLegacyAgentComputer(helpRerouted
          ? legacyArgsWithSharedFlags(command, commandArgs, globalOptions)
          : originalLegacyArgs(rawArgv, globalOptions));
        return;
      }
      await runToolsCommand(commandArgs, context);
      return;
    case "call":
      await runCallCommand(commandArgs, context);
      return;
    case "mcp":
      await runMcpCommand(commandArgs, context);
      return;
    case "upload":
      await runUploadCommand(commandArgs, context);
      return;
    case "doctor":
      await runDoctorCommand(commandArgs, context);
      return;
    case "install":
      await runInstallCommand(commandArgs, context);
      return;
    case "uninstall":
      await runUninstallCommand(commandArgs, context);
      return;
    case "config":
      await runConfigCommand(commandArgs, context);
      return;
    case "feedback":
      await runFeedbackCommand(commandArgs, context);
      return;
    case "pulse-setup":
      await runPulseSetupCommand(commandArgs, context);
      return;
    case "pulse-publish":
      await runPulsePublishCommand(commandArgs, context);
      return;
    case "pulse":
      await runPulseCommand(commandArgs, context);
      return;
    case "update":
      await runUpdateCommand(commandArgs, context);
      return;
    default:
      if (AGENT_COMPUTER_COMMANDS.has(command)) {
        // Vibecodr v1 surfaces the hosted Agent Computer commands (browser, computer,
        // work, etc.) through both the vibecodr and vc-tools bin names. The legacy
        // vc-tools dispatcher owns the byte-equivalent output, so delegate to it.
        await runLegacyAgentComputer(helpRerouted
          ? legacyArgsWithSharedFlags(command, commandArgs, globalOptions)
          : originalLegacyArgs(rawArgv, globalOptions));
        return;
      }
      throw new CliError(
        "usage.command",
        `Unknown command: ${command}`,
        EXIT_CODES.usage,
        { nextStep: commandSuggestion(command) }
      );
  }
}

main().catch((error) => {
  const { globalOptions } = parseGlobalOptions(process.argv.slice(2));
  new Output(globalOptions).failure(error);
});
