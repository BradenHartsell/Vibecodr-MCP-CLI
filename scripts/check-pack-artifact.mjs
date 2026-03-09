import { execSync } from "node:child_process";
import { unlinkSync } from "node:fs";

const forbiddenPatterns = [
  /\.env/i,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.agent(s)?(\/|$)/,
  /(^|\/)tmp[-_]/i,
  /(^|\/).*scratch/i,
  /(^|\/).*bak$/i,
  /(^|\/).*log$/i
];

const packOutput = execSync(process.platform === "win32" ? "npm pack --json" : "npm pack --json", {
  encoding: "utf8"
});
const parsed = JSON.parse(packOutput);
const files = Array.isArray(parsed) && parsed[0]?.files ? parsed[0].files.map((file) => file.path) : [];
const filename = Array.isArray(parsed) ? parsed[0]?.filename : undefined;
const forbidden = files.filter((path) => forbiddenPatterns.some((pattern) => pattern.test(path)));

if (forbidden.length) {
  if (filename) {
    try { unlinkSync(filename); } catch {}
  }
  console.error("Forbidden files were included in the package artifact:");
  for (const path of forbidden) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

if (filename) {
  try { unlinkSync(filename); } catch {}
}
console.log(`Artifact check passed for ${files.length} packaged files.`);
