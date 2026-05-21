#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const gitCmd = process.platform === "win32" ? "git.exe" : "git";

const args = process.argv.slice(2);
let dryRun = false;
let skipVerify = false;
let tag = packageJson.version.includes("-") ? "next" : "latest";

function usage() {
  console.log(`Publish ${packageJson.name}@${packageJson.version} with a fresh npm OTP.

Usage:
  npm run publish:release -- [--tag <latest|next|custom>] [--dry-run] [--skip-verify]

Notes:
  - OTPs are not stored.
  - The helper prompts without echoing input when NPM_CONFIG_OTP is not set.
  - The OTP is passed to the child npm process through its environment, not argv.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  }
  if (arg === "--dry-run") {
    dryRun = true;
    continue;
  }
  if (arg === "--skip-verify") {
    skipVerify = true;
    continue;
  }
  if (arg === "--tag") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      fail("Missing value for --tag.");
    }
    tag = value;
    index += 1;
    continue;
  }
  fail(`Unknown option: ${arg}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function promptHidden(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail("A fresh npm OTP is required. Run this from an interactive terminal or set NPM_CONFIG_OTP for this command only.");
  }

  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  let value = "";

  return new Promise((resolve, reject) => {
    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
    }

    function onData(chunk) {
      const input = String(chunk);
      if (input === "\u0003") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("Publish cancelled."));
        return;
      }

      if (input === "\r" || input === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
        return;
      }

      if (input === "\u007f" || input === "\b") {
        value = value.slice(0, -1);
        return;
      }

      value += input;
    }

    process.stdin.on("data", onData);
  });
}

const gitRoot = capture(gitCmd, ["rev-parse", "--show-toplevel"]);
if (!gitRoot.ok || path.resolve(gitRoot.stdout) !== repoRoot) {
  fail(`Refusing to publish outside the CLI repository: ${repoRoot}`);
}

const npmUser = capture(npmCmd, ["whoami"]);
if (!npmUser.ok) {
  fail("npm is not authenticated. Run npm login, then try again.");
}

const publishedVersion = capture(npmCmd, ["view", packageJson.name, "version"]);
if (!dryRun && publishedVersion.ok && publishedVersion.stdout === packageJson.version) {
  fail(`${packageJson.name}@${packageJson.version} is already published.`);
}

if (!skipVerify) {
  run(npmCmd, ["run", "verify"]);
}

let otp = process.env.NPM_CONFIG_OTP || process.env.npm_config_otp || "";
if (!otp) {
  otp = await promptHidden("npm OTP: ");
}

if (!otp.trim()) {
  fail("A non-empty npm OTP is required.");
}

const publishEnv = {
  ...process.env,
  NPM_CONFIG_OTP: otp.trim(),
  npm_config_otp: otp.trim(),
};

try {
  run(npmCmd, ["publish", "--access", "public", "--tag", tag, ...(dryRun ? ["--dry-run"] : [])], {
    env: publishEnv,
  });
} finally {
  publishEnv.NPM_CONFIG_OTP = "";
  publishEnv.npm_config_otp = "";
  process.env.NPM_CONFIG_OTP = "";
  process.env.npm_config_otp = "";
  otp = "";
}

if (!dryRun) {
  const readback = capture(npmCmd, ["view", packageJson.name, "version"]);
  if (!readback.ok || readback.stdout !== packageJson.version) {
    fail(`Publish finished, but npm readback did not show ${packageJson.version}.`);
  }
  console.log(`Published ${packageJson.name}@${packageJson.version} to npm with tag ${tag}.`);
}
