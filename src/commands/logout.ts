import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";

const MCP_GATEWAY_AUTH_SCOPES = new Set(["mcp", "mcp-gateway", "gateway"]);

function logoutHelpText(): string {
  return [
    "Usage: vibecodr logout [mcp] [--all] [--no-revoke]",
    "       vibecodr logout agent --yes",
    "",
    "Most people:",
    "  vibecodr logout       Sign out this CLI from publishing, uploads, Pulses, and MCP tools.",
    "",
    "Explicit lanes:",
    "  vibecodr logout mcp   Same as vibecodr logout; clears the MCP Gateway session.",
    "  vibecodr logout agent Clears the hosted Agent Computer credential.",
    "",
    "Tip: run `vibecodr status` after logout to confirm what remains connected."
  ].join("\n");
}

export async function runLogoutCommand(args: string[], context: CommandContext): Promise<void> {
  const scopedArgs = MCP_GATEWAY_AUTH_SCOPES.has(args[0] ?? "") ? args.slice(1) : args;
  if (showHelpIfRequested(scopedArgs, context, logoutHelpText())) return;
  const { flags, positionals } = parseFlags(scopedArgs, {
    booleanFlags: ["all", "no-revoke"]
  });
  if (positionals.length > 0) {
    throw new CliError(
      "usage.unknown_logout_scope",
      `Unknown logout target: ${positionals[0]}`,
      EXIT_CODES.usage,
      { nextStep: "Use `vibecodr logout` for the usual path, or `vibecodr logout agent --yes` for the hosted Agent Computer." }
    );
  }
  const config = await context.configStore.load();
  const targetProfiles = flags["all"]
    ? Object.keys(config.profiles)
    : [context.globalOptions.profile || config.currentProfile];

  const results = [];
  for (const profileName of targetProfiles) {
    results.push({
      profile: profileName,
      ...(await context.tokenManager.logout(profileName, {
        noRevoke: Boolean(flags["no-revoke"])
      }))
    });
  }

  context.output.success(
    {
      schemaVersion: 1,
      results
    },
    [
      "Signed out of the Vibecodr MCP Gateway session for this CLI.",
      ...results.map((result) => `${result.profile}: local tokens ${result.localTokensDeleted ? "deleted" : "not present"}, revocation ${result.revocationAttempted ? (result.revocationConfirmed ? "confirmed" : "attempted") : "skipped"}`),
      "Editor registrations are unchanged. Agent Computer credentials are unchanged unless you ran `vibecodr logout agent --yes`."
    ]
  );
}
