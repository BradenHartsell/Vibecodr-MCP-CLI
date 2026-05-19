import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const SUPPORTED_VIA: ReadonlySet<PackageManager> = new Set(["npm", "pnpm", "yarn", "bun"]);
const REGISTRY_URL = "https://registry.npmjs.org/@vibecodr%2fcli/latest";

interface InstallChannel {
  manager: PackageManager;
  installCommand: string[];
  detectedFromGlobalRoot: string | undefined;
}

interface RegistryLatest {
  version: string;
}

export async function runUpdateCommand(args: string[], context: CommandContext): Promise<void> {
  if (
    showHelpIfRequested(
      args,
      context,
      [
        "Usage: vibecodr update [--check] [--yes] [--via <npm|pnpm|yarn|bun>]",
        "",
        "  --check         Print current and latest version; do not install.",
        "  --yes           Skip the confirmation prompt (also honored if --non-interactive is set).",
        "  --via <manager> Force the install channel instead of auto-detecting from the install location."
      ].join("\n")
    )
  ) {
    return;
  }
  const { flags } = parseFlags(args, {
    valueFlags: ["via"],
    booleanFlags: ["check", "yes"]
  });
  const viaFlag = typeof flags["via"] === "string" ? flags["via"] : undefined;
  if (viaFlag !== undefined && !SUPPORTED_VIA.has(viaFlag as PackageManager)) {
    throw new CliError(
      "update.unsupported_manager",
      `--via must be one of: ${[...SUPPORTED_VIA].join(", ")}.`,
      EXIT_CODES.usage
    );
  }

  const current = readInstalledVersion();
  const latest = await fetchLatestVersion();

  const upToDate = compareVersions(current, latest) >= 0;
  if (flags["check"] === true || upToDate) {
    context.output.success(
      {
        schemaVersion: 1,
        ok: true,
        current,
        latest,
        upToDate
      },
      upToDate
        ? [`Already on the latest @vibecodr/cli version: ${current}.`]
        : [`@vibecodr/cli ${current} → ${latest} is available. Re-run without --check to install.`]
    );
    return;
  }

  refuseIfRunningFromSource(context);
  refuseIfRunningFromNpx(context);

  const channel = resolveInstallChannel(viaFlag, context);

  const willPrompt = !context.globalOptions.nonInteractive && flags["yes"] !== true && !context.globalOptions.json;
  if (willPrompt) {
    process.stdout.write(`Update @vibecodr/cli ${current} → ${latest} via "${channel.installCommand.join(" ")}"? [Y/n] `);
    const answer = (await readLine()).trim();
    const accepted = answer === "" || /^y(es)?$/i.test(answer);
    if (!accepted) {
      throw new CliError("update.canceled", "Update canceled.", EXIT_CODES.canceled);
    }
  }

  if (context.globalOptions.json) {
    context.output.info(`@vibecodr/cli ${current} → ${latest} via ${channel.installCommand.join(" ")}`);
  } else {
    process.stdout.write(`@vibecodr/cli ${current} → ${latest} via ${channel.installCommand.join(" ")}\n`);
  }

  const code = await runInstall(channel);
  if (code !== 0) {
    throw new CliError(
      "update.install_failed",
      `Package manager exited with code ${code}.`,
      EXIT_CODES.runtime,
      {
        nextStep:
          "Re-run the install command directly to see the package-manager output, then retry. " +
          "If the failure is an EEXIST collision, see `vibecodr doctor` and the upgrade docs."
      }
    );
  }
  context.output.success(
    {
      schemaVersion: 1,
      ok: true,
      previousVersion: current,
      installedVersion: latest,
      via: channel.manager
    },
    [`@vibecodr/cli updated: ${current} → ${latest} via ${channel.manager}.`]
  );
}

function readInstalledVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here; ;) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@vibecodr/cli" && typeof pkg.version === "string") return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new CliError("update.version_lookup", "Could not determine the installed @vibecodr/cli version.", EXIT_CODES.runtime);
}

async function fetchLatestVersion(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(REGISTRY_URL, { headers: { accept: "application/json" } });
  } catch (error) {
    throw new CliError(
      "update.network",
      "Could not reach the npm registry to check the latest @vibecodr/cli version.",
      EXIT_CODES.network,
      {
        cause: error,
        nextStep: "Check your network connection and retry. Override with --via <manager> if the install channel is not npm."
      }
    );
  }
  if (!response.ok) {
    throw new CliError(
      "update.registry",
      `Registry responded with HTTP ${response.status}.`,
      EXIT_CODES.network,
      { nextStep: "Retry in a moment. The npm registry occasionally returns transient 5xx errors." }
    );
  }
  const body = (await response.json()) as RegistryLatest;
  if (typeof body.version !== "string" || body.version.length === 0) {
    throw new CliError("update.registry", "Registry response did not include a version.", EXIT_CODES.network);
  }
  return body.version;
}

export function compareVersions(a: string, b: string): number {
  const [aMain, aPre] = a.split("-", 2);
  const [bMain, bPre] = b.split("-", 2);
  const aParts = (aMain ?? "0").split(".").map((n) => Number.parseInt(n, 10));
  const bParts = (bMain ?? "0").split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    const ai = aParts[i] ?? 0;
    const bi = bParts[i] ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre && bPre) {
    if (aPre < bPre) return -1;
    if (aPre > bPre) return 1;
  }
  return 0;
}

function resolveInstallChannel(viaFlag: string | undefined, context: CommandContext): InstallChannel {
  if (viaFlag !== undefined) {
    if (!SUPPORTED_VIA.has(viaFlag as PackageManager)) {
      throw new CliError(
        "update.unsupported_manager",
        `--via must be one of: ${[...SUPPORTED_VIA].join(", ")}.`,
        EXIT_CODES.usage
      );
    }
    return buildChannel(viaFlag as PackageManager, undefined);
  }
  const detected = detectInstallChannel();
  if (detected) return detected;
  context.output.warn(
    "Could not auto-detect the package manager that installed @vibecodr/cli. Defaulting to npm; rerun with --via <pnpm|yarn|bun> if that's wrong."
  );
  return buildChannel("npm", undefined);
}

function detectInstallChannel(): InstallChannel | undefined {
  // Derive the install root from `here` directly — the CLI's own file location
  // is the authoritative source of where it lives, no shell commands required.
  // Layout: <root>/@vibecodr/cli/dist/commands/update.js → up 4 levels = <root>.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const installRoot = path.resolve(here, "..", "..", "..", "..");

  // Match installRoot against each manager's global root. Try the spawned
  // commands first (they reflect the live config); fall back to platform
  // defaults so detection still works when the manager isn't on PATH or
  // its command happens to fail in this shell.
  const checks: Array<{ manager: PackageManager; root: string | undefined }> = [
    { manager: "pnpm", root: tryRun("pnpm root -g") ?? pnpmDefaultRoot() },
    { manager: "yarn", root: tryRun("yarn global dir") ?? yarnDefaultRoot() },
    { manager: "bun", root: bunGlobalRoot() },
    { manager: "npm", root: tryRun("npm root -g") ?? npmDefaultRoot() }
  ];
  for (const { manager, root } of checks) {
    if (!root) continue;
    if (samePath(installRoot, root)) {
      return buildChannel(manager, path.resolve(root));
    }
  }
  return undefined;
}

export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const resolved = path.resolve(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return norm(a) === norm(b);
}

function npmDefaultRoot(): string | undefined {
  if (process.platform === "win32" && process.env["APPDATA"]) {
    return path.join(process.env["APPDATA"]!, "npm", "node_modules");
  }
  return undefined;
}

function pnpmDefaultRoot(): string | undefined {
  // pnpm uses versioned subdirs (pnpm/global/<major>/node_modules) on every
  // platform; we don't know the version up front, but the parent dir doesn't
  // change. The exact match comes from samePath against installRoot.
  if (process.platform === "win32" && process.env["LOCALAPPDATA"]) {
    return undefined; // pnpm's exact dir is versioned — let tryRun cover it.
  }
  return undefined;
}

function yarnDefaultRoot(): string | undefined {
  if (process.platform === "win32" && process.env["LOCALAPPDATA"]) {
    return path.join(process.env["LOCALAPPDATA"]!, "Yarn", "Data", "global", "node_modules");
  }
  return undefined;
}

function buildChannel(manager: PackageManager, root: string | undefined): InstallChannel {
  const target = "@vibecodr/cli@latest";
  switch (manager) {
    case "pnpm":
      return { manager, installCommand: ["pnpm", "add", "-g", target], detectedFromGlobalRoot: root };
    case "yarn":
      return { manager, installCommand: ["yarn", "global", "add", target], detectedFromGlobalRoot: root };
    case "bun":
      return { manager, installCommand: ["bun", "add", "-g", target], detectedFromGlobalRoot: root };
    case "npm":
    default:
      return { manager: "npm", installCommand: ["npm", "install", "-g", target], detectedFromGlobalRoot: root };
  }
}

function tryRun(cmd: string): string | undefined {
  try {
    const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh" }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function bunGlobalRoot(): string | undefined {
  const candidates = [
    process.env["BUN_INSTALL"] ? path.join(process.env["BUN_INSTALL"]!, "install", "global", "node_modules") : undefined,
    path.join(process.env["HOME"] ?? "", ".bun", "install", "global", "node_modules"),
    process.env["LOCALAPPDATA"] ? path.join(process.env["LOCALAPPDATA"]!, "bun", "install", "global", "node_modules") : undefined
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return undefined;
}

function refuseIfRunningFromSource(context: CommandContext): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here; ;) {
    const pkgPath = path.join(dir, "package.json");
    const srcPath = path.join(dir, "src");
    if (existsSync(pkgPath) && existsSync(srcPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
      if (pkg.name === "@vibecodr/cli") {
        throw new CliError(
          "update.source_install",
          "Refusing to update: this is a source-tree install of @vibecodr/cli.",
          EXIT_CODES.usage,
          {
            nextStep: `Update the source repo with git instead (cwd: ${dir}). The auto-update path is only for global package installs.`
          }
        );
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  void context;
}

function refuseIfRunningFromNpx(context: CommandContext): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (here.includes(`${path.sep}_npx${path.sep}`) || here.includes(`${path.sep}.npx${path.sep}`)) {
    throw new CliError(
      "update.ephemeral_install",
      "Refusing to update: this CLI is running from an npx ephemeral cache.",
      EXIT_CODES.usage,
      {
        nextStep: "Run `npm install -g @vibecodr/cli` (or `pnpm add -g @vibecodr/cli`) to get a persistent install, then `vibecodr update` will work."
      }
    );
  }
  void context;
}

async function readLine(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  try {
    return await new Promise<string>((resolve) => {
      rl.once("line", (line) => resolve(line));
      rl.once("close", () => resolve(""));
    });
  } finally {
    rl.close();
  }
}

function runInstall(channel: InstallChannel): Promise<number> {
  return new Promise((resolve, reject) => {
    const [cmd, ...rest] = channel.installCommand;
    if (!cmd) {
      reject(new CliError("update.invalid_command", "No install command resolved.", EXIT_CODES.runtime));
      return;
    }
    // Windows: spawn cmd.exe explicitly with a properly-quoted command line.
    // Using `shell: true` with args is deprecated (DEP0190) because the shell
    // concatenates args without escaping. Args here are bounded (manager flags
    // plus `@vibecodr/cli@latest`), so a simple quoter is sufficient.
    let child;
    if (process.platform === "win32") {
      const line = [cmd, ...rest].map(quoteWindowsArg).join(" ");
      child = spawn("cmd.exe", ["/d", "/s", "/c", line], { stdio: "inherit", windowsVerbatimArguments: true });
    } else {
      child = spawn(cmd, rest, { stdio: "inherit" });
    }
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export function quoteWindowsArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"&|<>^()%!,;=]/.test(arg)) return arg;
  return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}
