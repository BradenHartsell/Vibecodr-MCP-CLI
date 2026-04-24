export const EXIT_CODES = {
  runtime: 1,
  usage: 2,
  config: 3,
  authRequired: 4,
  authFailed: 5,
  network: 6,
  protocol: 7,
  toolFailed: 8,
  unsupportedClient: 9,
  installConflict: 10,
  secretStoreUnavailable: 11,
  canceled: 12
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly machineCode: string;
  readonly nextStep?: string | undefined;
  readonly debugDetails?: unknown;

  constructor(
    machineCode: string,
    message: string,
    exitCode: ExitCode,
    options?: {
      nextStep?: string;
      debugDetails?: unknown;
      cause?: unknown;
    }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "CliError";
    this.machineCode = machineCode;
    this.exitCode = exitCode;
    this.nextStep = options?.nextStep;
    this.debugDetails = options?.debugDetails;
  }
}

export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error) {
    return new CliError("runtime.unexpected", error.message, EXIT_CODES.runtime, {
      cause: error
    });
  }
  return new CliError("runtime.unexpected", String(error), EXIT_CODES.runtime);
}
