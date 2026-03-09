import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { CliError, EXIT_CODES } from "../cli/errors.js";

export async function promptText(message: string, options?: { allowEmpty?: boolean }): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const value = (await rl.question(message)).trim();
    if (!value && !options?.allowEmpty) {
      throw new CliError("input.required", "A value is required.", EXIT_CODES.usage);
    }
    return value;
  } finally {
    rl.close();
  }
}

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
