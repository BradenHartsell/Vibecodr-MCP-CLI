import { formatJson, summarizeToolSchema } from "../core/renderers.js";
import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";
import type { SessionRecord } from "../types/auth.js";
import type { ListedTool } from "../core/mcp-client.js";

function summarizeDescription(desc: string | undefined, maxWidth: number): string {
  if (!desc) return "";
  const trimmed = desc.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return "";
  const firstStop = trimmed.search(/[.!?](\s|$)/);
  const candidate = firstStop >= 0 ? trimmed.slice(0, firstStop + 1) : trimmed;
  if (candidate.length <= maxWidth) return candidate;
  const clipped = candidate.slice(0, maxWidth - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > maxWidth * 0.6 ? clipped.slice(0, lastSpace) : clipped) + "…";
}

function renderToolsList(tools: readonly ListedTool[], serverUrl: string, search: string): string[] {
  if (tools.length === 0) {
    return search
      ? [`No tools matched "${search}".`, "", `Try: vibecodr tools --search <other-text>  |  vibecodr tools --json`]
      : ["No tools available from the gateway."];
  }
  const columns = Math.max(60, process.stdout.columns ?? 100);
  const longestName = tools.reduce((acc, tool) => Math.max(acc, tool.name.length), 0);
  const nameWidth = Math.min(40, longestName) + 2;
  const indent = 2;
  const descWidth = Math.max(20, columns - indent - nameWidth - 1);
  const lines: string[] = [
    `Vibecodr MCP tools (${tools.length})${search ? ` matching "${search}"` : ""}`,
    `Server: ${serverUrl}`,
    ""
  ];
  let previousPrefix: string | undefined;
  for (const tool of tools) {
    const prefix = tool.name.split("_", 1)[0] ?? tool.name;
    if (previousPrefix && prefix !== previousPrefix) lines.push("");
    previousPrefix = prefix;
    const displayName = tool.name.length <= 40 ? tool.name : tool.name.slice(0, 39) + "…";
    const padded = displayName.padEnd(nameWidth);
    const summary = summarizeDescription(tool.description, descWidth);
    lines.push(`${" ".repeat(indent)}${padded}${summary}`);
  }
  lines.push(
    "",
    "Show details for one tool:   vibecodr tools <tool-name>",
    "Filter by text:              vibecodr tools --search <query>",
    "Machine-readable output:     vibecodr tools --json"
  );
  return lines;
}

function challengedScope(error: CliError): string | undefined {
  if (!error.debugDetails || typeof error.debugDetails !== "object") return undefined;
  const scope = (error.debugDetails as Record<string, unknown>)["scope"];
  return typeof scope === "string" && scope.trim() ? scope : undefined;
}

async function loadToolsWithRetry(
  context: CommandContext,
  allowLogin: boolean
): Promise<{ tools: Awaited<ReturnType<CommandContext["runtimeClient"]["listTools"]>>; session?: SessionRecord }> {
  const { profileName, serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const existingSession = await context.tokenManager.getSession(profileName, serverUrl);
  try {
    return {
      tools: await context.runtimeClient.listTools(serverUrl, existingSession?.accessToken),
      ...(existingSession ? { session: existingSession } : {})
    };
  } catch (error) {
    if (!(error instanceof CliError) || !["auth.required", "auth.insufficient_scope"].includes(error.machineCode)) throw error;
    if (error.machineCode === "auth.required" && existingSession?.refreshToken) {
      const refreshed = await context.tokenManager.refresh(profileName, existingSession);
      return {
        tools: await context.runtimeClient.listTools(serverUrl, refreshed.session.accessToken),
        session: refreshed.session
      };
    }
    if (allowLogin && !context.globalOptions.nonInteractive) {
      await context.tokenManager.login(context.globalOptions, {
        scope: challengedScope(error)
      });
      const nextSession = await context.tokenManager.getSession(profileName, serverUrl);
      return {
        tools: await context.runtimeClient.listTools(serverUrl, nextSession?.accessToken),
        ...(nextSession ? { session: nextSession } : {})
      };
    }
    throw error;
  }
}

export async function runToolsCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr tools [<tool-name>] [--search <text>] [--schema] [--no-login]")) return;
  const { flags, positionals } = parseFlags(args, {
    valueFlags: ["search"],
    booleanFlags: ["schema", "no-login"]
  });
  const toolName = positionals[0];
  const { tools, session } = await loadToolsWithRetry(context, !flags["no-login"]);
  const serverUrl = session?.serverUrl || (await context.tokenManager.resolveProfile(context.globalOptions)).serverUrl;
  const sortedTools = tools
    .sort((left, right) => left.name.localeCompare(right.name));
  const search = typeof flags["search"] === "string" ? flags["search"].toLowerCase() : "";
  const filtered = search
    ? sortedTools.filter((tool) =>
        tool.name.toLowerCase().includes(search) || (tool.description || "").toLowerCase().includes(search)
      )
    : sortedTools;

  if (!toolName) {
    context.output.success(
      {
        schemaVersion: 1,
        serverUrl,
        toolCount: filtered.length,
        tools: filtered
      },
      renderToolsList(filtered, serverUrl, search)
    );
    return;
  }

  const tool = sortedTools.find((item) => item.name === toolName);
  if (!tool) {
    throw new CliError("tool.not_found", `Tool not found: ${toolName}`, EXIT_CODES.toolFailed);
  }
  const summary = summarizeToolSchema(tool.inputSchema as Record<string, unknown> | undefined);
  context.output.success(
    {
      schemaVersion: 1,
      tool
    },
    [
      `Name: ${tool.name}`,
      `Description: ${tool.description || ""}`,
      `Required: ${summary.required.join(", ") || "none"}`,
      `Optional: ${summary.optional.join(", ") || "none"}`,
      "Input skeleton:",
      formatJson(summary.skeleton),
      ...(flags["schema"] ? ["Schema:", formatJson(tool.inputSchema)] : [])
    ]
  );
}
