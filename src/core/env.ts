// VIBECDR_* canonical names with back-compat aliases for VC_TOOLS_* (formerly the
// @vibecodr/vc-tools surface) and VIBECDR_MCP_* (formerly the @vibecodr/cli@0.2.x
// surface). reconcileEnv() runs once per bin invocation and synchronizes the
// canonical and legacy names so both old and new code paths see the same value,
// then emits a one-time stderr deprecation notice for each legacy name that was
// actually used. Set VIBECDR_NO_DEPRECATION_NOTICE=1 to suppress the notice
// (useful in scripts / CI logs that already understand the migration).
//
// The legacy code paths under src/legacy/ continue to read VC_TOOLS_* directly,
// and the MCP-CLI code paths continue to read VIBECDR_MCP_* directly. reconcileEnv
// does not change which env names the consumers read; it only makes both names
// addressable so users can migrate their scripts to VIBECDR_* without breaking
// existing setups.

export const ENV_ALIAS_MAP: Readonly<Record<string, readonly string[]>> = {
  VIBECDR_CONFIG_DIR: ["VC_TOOLS_CONFIG_DIR", "VIBECDR_MCP_CONFIG_PATH"],
  VIBECDR_CREDENTIAL_STORE: ["VC_TOOLS_CREDENTIAL_STORE"],
  VIBECDR_CIMD_CLIENT_ID: ["VIBECDR_MCP_CIMD_CLIENT_ID"],
  VIBECDR_MANUAL_CLIENT_ID: ["VIBECDR_MCP_MANUAL_CLIENT_ID"],
  VIBECDR_INSTALL_MANIFEST_PATH: ["VIBECDR_MCP_INSTALL_MANIFEST_PATH"],
  VIBECDR_INSECURE_SECRET_STORE_PATH: ["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"],
  VIBECDR_ENABLE_INSECURE_SECRET_STORE: ["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"],
  VIBECDR_TEST_AUTH_URL_FILE: ["VIBECDR_MCP_TEST_AUTH_URL_FILE"]
};

export const DEPRECATION_OPT_OUT_ENV = "VIBECDR_NO_DEPRECATION_NOTICE";

interface ReconcileOptions {
  env?: NodeJS.ProcessEnv;
  stream?: { write(chunk: string): unknown };
  // Tests pass a fresh Set so deprecation-once state is scoped to the test run.
  // Production callers leave this undefined and share the module-level state.
  warned?: Set<string>;
}

const moduleWarned = new Set<string>();

export function reconcileEnv(options: ReconcileOptions = {}): void {
  const env = options.env ?? process.env;
  const stream = options.stream ?? process.stderr;
  const warned = options.warned ?? moduleWarned;
  const suppressNotice = env[DEPRECATION_OPT_OUT_ENV] === "1";

  for (const [canonical, legacyNames] of Object.entries(ENV_ALIAS_MAP)) {
    const canonicalValue = env[canonical];
    if (canonicalValue !== undefined && canonicalValue !== "") {
      // Canonical set; propagate to any legacy name that isn't set so legacy
      // code paths see the canonical value.
      for (const legacy of legacyNames) {
        if (env[legacy] === undefined) {
          env[legacy] = canonicalValue;
        }
      }
      continue;
    }
    // Canonical not set; find the first legacy name present.
    for (const legacy of legacyNames) {
      const legacyValue = env[legacy];
      if (legacyValue !== undefined && legacyValue !== "") {
        env[canonical] = legacyValue;
        if (!warned.has(legacy) && !suppressNotice) {
          warned.add(legacy);
          stream.write(`Notice: ${legacy} is accepted for back-compat; future releases will prefer ${canonical}. Set ${DEPRECATION_OPT_OUT_ENV}=1 to silence.\n`);
        }
        break;
      }
    }
  }
}

// Test-only helper. Production code never needs to reset the warned set; bin
// entries call reconcileEnv exactly once.
export function __resetDeprecationStateForTests(): void {
  moduleWarned.clear();
}
