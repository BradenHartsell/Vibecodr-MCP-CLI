import type { GlobalOptions } from "../types/config.js";
import { asCliError } from "./errors.js";

export interface JsonEnvelope {
  schemaVersion: 1;
  [key: string]: unknown;
}

export class Output {
  constructor(private readonly options: GlobalOptions) {}

  write(value: string): void {
    process.stdout.write(value + "\n");
  }

  info(message: string): void {
    if (!this.options.json) this.write(message);
  }

  warn(message: string): void {
    if (!this.options.json) process.stderr.write(message + "\n");
  }

  json(value: JsonEnvelope): void {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  }

  success(value: JsonEnvelope, humanLines: string[]): void {
    if (this.options.json) {
      this.json(value);
      return;
    }
    for (const line of humanLines) this.write(line);
  }

  failure(error: unknown): never {
    const cliError = asCliError(error);
    if (this.options.json) {
      this.json({
        schemaVersion: 1,
        ok: false,
        error: {
          code: cliError.machineCode,
          message: cliError.message,
          nextStep: cliError.nextStep
        }
      });
    } else {
      process.stderr.write(`${cliError.message}\n`);
      if (cliError.nextStep) process.stderr.write(`Next step: ${cliError.nextStep}\n`);
      if (this.options.verbose && cliError.debugDetails != null) {
        process.stderr.write(`${JSON.stringify(cliError.debugDetails, null, 2)}\n`);
      }
    }
    process.exit(cliError.exitCode);
  }
}
