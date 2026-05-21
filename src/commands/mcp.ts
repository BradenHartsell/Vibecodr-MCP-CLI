import { CliError, EXIT_CODES } from "../cli/errors.js";
import { isHelpToken } from "../cli/parse.js";
import { mcpCommandSuggestion, mcpHelpText } from "../app/help.js";
import { runCallCommand } from "./call.js";
import { runToolsCommand } from "./tools.js";
import type { CommandContext } from "./context.js";

export async function runMcpCommand(args: string[], context: CommandContext): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || isHelpToken(subcommand)) {
    process.stdout.write(`${mcpHelpText()}\n`);
    return;
  }

  switch (subcommand) {
    case "tools":
      await runToolsCommand(rest, context);
      return;
    case "call":
      await runCallCommand(rest, context);
      return;
    case "help":
      await runMcpCommand(rest, context);
      return;
    default:
      throw new CliError(
        "usage.unknown_mcp_command",
        `Unknown MCP Gateway command: ${subcommand}`,
        EXIT_CODES.usage,
        { nextStep: mcpCommandSuggestion(subcommand) }
      );
  }
}
