import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { promptText } from "../platform/prompt.js";
import { showHelpIfRequested } from "./help.js";
import { callToolWithRetry } from "./call.js";
import type { CommandContext } from "./context.js";

const FEEDBACK_CATEGORIES = new Set(["feedback", "idea", "bug", "question", "praise", "other"]);

function stringFlag(value: string | boolean | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CliError("usage.invalid_flag", `--${name} must have a text value.`, EXIT_CODES.usage);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseCategory(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (FEEDBACK_CATEGORIES.has(value)) return value;
  throw new CliError(
    "usage.feedback_category_invalid",
    `Unknown feedback category: ${value}`,
    EXIT_CODES.usage,
    { nextStep: "Use one of: feedback, idea, bug, question, praise, other." }
  );
}

function feedbackIdFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (!structured || typeof structured !== "object") return undefined;
  const feedbackId = (structured as Record<string, unknown>)["feedbackId"];
  return typeof feedbackId === "string" && feedbackId.trim() ? feedbackId : undefined;
}

function founderEmailQueuedFromResult(result: unknown): boolean | undefined {
  if (!result || typeof result !== "object") return undefined;
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (!structured || typeof structured !== "object") return undefined;
  const queued = (structured as Record<string, unknown>)["founderEmailQueued"];
  return typeof queued === "boolean" ? queued : undefined;
}

export async function runFeedbackCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(
    args,
    context,
    [
      "Usage: vibecodr feedback [message] [--message <text>] [--subject <text>] [--category <kind>] [--page-url <url>] [--no-login]",
      "",
      "Send product feedback straight to the Vibecodr dev. The note is saved for review and queues founder notification.",
      "",
      "Examples:",
      "  vibecodr feedback \"The publish form wording is confusing\"",
      "  vibecodr feedback --category idea --subject \"Better examples\" --message \"Show Codex and Claude install examples side by side\"",
      "",
      "Categories: feedback, idea, bug, question, praise, other"
    ].join("\n")
  )) return;

  const { flags, positionals } = parseFlags(args, {
    valueFlags: ["message", "subject", "category", "page-url", "client"],
    booleanFlags: ["no-login"]
  });
  const message = stringFlag(flags["message"], "message") || positionals.join(" ").trim() || (
    context.globalOptions.nonInteractive
      ? undefined
      : await promptText("What should Braden know? ")
  );
  if (!message) {
    throw new CliError(
      "usage.feedback_message_required",
      "A feedback message is required.",
      EXIT_CODES.usage,
      { nextStep: "Run `vibecodr feedback \"your note\"` or pass `--message <text>`." }
    );
  }

  const category = parseCategory(stringFlag(flags["category"], "category"));
  const subject = stringFlag(flags["subject"], "subject");
  const pageUrl = stringFlag(flags["page-url"], "page-url");
  const client = stringFlag(flags["client"], "client") || "vibecodr-cli";
  const input = {
    message,
    source: "cli",
    client,
    ...(category ? { category } : {}),
    ...(subject ? { subject } : {}),
    ...(pageUrl ? { pageUrl } : {})
  };
  const { result } = await callToolWithRetry(context, "submit_feedback", input, !flags["no-login"]);
  const feedbackId = feedbackIdFromResult(result);
  const founderEmailQueued = founderEmailQueuedFromResult(result);
  context.output.success(
    {
      schemaVersion: 1,
      ok: true,
      ...(feedbackId ? { feedbackId } : {}),
      ...(founderEmailQueued !== undefined ? { founderEmailQueued } : {})
    },
    [
      "Sent to Braden.",
      ...(feedbackId ? [`Saved as feedback ${feedbackId}.`] : ["Saved for review."]),
      ...(founderEmailQueued === undefined
        ? []
        : [founderEmailQueued ? "Founder notification was queued." : "Founder email was not queued by the server."])
    ]
  );
}
