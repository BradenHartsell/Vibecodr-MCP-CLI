import { parseFlags } from "../cli/parse.js";
import { InstallManifestStore } from "../storage/install-manifest.js";
import type { CommandContext } from "./context.js";

export async function runStatusCommand(args: string[], context: CommandContext): Promise<void> {
  const { flags } = parseFlags(args, {
    booleanFlags: ["probe", "show-installs"]
  });
  const { profileName, profile, serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const session = await context.tokenManager.getSession(profileName);
  const sessionState = context.tokenManager.sessionState(session);
  const installs = flags["show-installs"]
    ? await new InstallManifestStore().find(() => true)
    : [];

  let probe: Record<string, unknown> | undefined;
  if (flags.probe) {
    const discovery = await context.tokenManager.discover(serverUrl);
    probe = {
      authorizationServerUrl: discovery.authorizationServerUrl,
      pkceS256: Boolean(discovery.authorizationServerMetadata?.code_challenge_methods_supported?.includes("S256"))
    };
  }

  context.output.success(
    {
      schemaVersion: 1,
      profile: profileName,
      serverUrl,
      sessionState,
      registrationMode: session?.registrationMode || profile.registrationMode,
      expiresAt: session?.expiresAt,
      installs,
      ...(probe ? { probe } : {})
    },
    [
      `Profile: ${profileName}`,
      `Server URL: ${serverUrl}`,
      `Session state: ${sessionState}`,
      `Registration mode: ${session?.registrationMode || profile.registrationMode}`,
      `Expires at: ${session?.expiresAt || "not logged in"}`,
      ...(flags["show-installs"] ? [`Managed installs: ${installs.length}`] : []),
      ...(flags["show-installs"] ? installs.map((install) => `Install: ${install.client} ${install.scope} ${install.location}`) : []),
      ...(probe ? [`Authorization server: ${String(probe.authorizationServerUrl)}`, `PKCE S256: ${probe.pkceS256 ? "yes" : "no"}`] : [])
    ]
  );
}
