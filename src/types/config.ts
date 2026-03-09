export type BrowserMode = "open" | "print";
export type RegistrationMode = "auto" | "preregistered" | "cimd" | "dcr" | "manual";
export type InstallScope = "user" | "project";
export type LogLevel = "normal" | "debug";
export type SessionState = "none" | "valid" | "refreshable" | "expired";

export interface ProfileConfig {
  serverUrl: string;
  browserMode: BrowserMode;
  registrationMode: RegistrationMode;
  defaultInstallScope: InstallScope;
  logLevel: LogLevel;
}

export interface ConfigFile {
  version: 1;
  currentProfile: string;
  profiles: Record<string, ProfileConfig>;
}

export interface GlobalOptions {
  profile: string;
  serverUrl?: string;
  json: boolean;
  verbose: boolean;
  nonInteractive: boolean;
}

export const CONFIG_VERSION = 1;
export const DEFAULT_PROFILE = "default";
export const DEFAULT_SERVER_URL = "https://openai.vibecodr.space/mcp";

export function defaultProfileConfig(): ProfileConfig {
  return {
    serverUrl: DEFAULT_SERVER_URL,
    browserMode: "print",
    registrationMode: "auto",
    defaultInstallScope: "user",
    logLevel: "normal"
  };
}

export function defaultConfigFile(): ConfigFile {
  return {
    version: CONFIG_VERSION,
    currentProfile: DEFAULT_PROFILE,
    profiles: {
      [DEFAULT_PROFILE]: defaultProfileConfig()
    }
  };
}
