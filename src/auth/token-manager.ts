import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { openExternalUrl } from "../platform/browser.js";
import { isInteractiveTerminal, promptText } from "../platform/prompt.js";
import { ConfigStore } from "../storage/config-store.js";
import { SecretStore } from "../storage/secret-store.js";
import { isOfficialServer, officialClientInformation } from "./official-client.js";
import type {
  CallbackResult,
  DiscoveryResult,
  LoginResult,
  PreparedAuthorization,
  RefreshResult,
  SessionRecord
} from "../types/auth.js";
import type { BrowserMode, GlobalOptions, ProfileConfig, RegistrationMode, SessionState } from "../types/config.js";

const CIMD_CLIENT_ID = (process.env.VIBECDR_MCP_CIMD_CLIENT_ID || "").trim();
const MANUAL_CLIENT_ID = (process.env.VIBECDR_MCP_MANUAL_CLIENT_ID || "").trim();

function randomState(): string {
  return randomBytes(32).toString("base64url");
}

function isExpiringSoon(session: SessionRecord): boolean {
  if (!session.expiresAt) return false;
  return Date.parse(session.expiresAt) - Date.now() < 60_000;
}

function computeExpiresAt(expiresIn?: number): string | undefined {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return undefined;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

async function startLoopbackListener(timeoutSec: number): Promise<{
  redirectUrl: URL;
  awaitCallback: () => Promise<CallbackResult>;
  close: () => Promise<void>;
}> {
  const callbackPath = "/oauth/callback/vibecodr";
  const server = createServer();
  let callbackResolve: ((value: CallbackResult) => void) | undefined;
  let callbackReject: ((reason?: unknown) => void) | undefined;
  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    callbackResolve = resolve;
    callbackReject = reject;
  });

  server.on("request", (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== callbackPath) {
      res.statusCode = 404;
      res.end("Not found.");
      return;
    }
    const result: CallbackResult = {
      code: url.searchParams.get("code") || undefined,
      error: url.searchParams.get("error") || undefined,
      errorDescription: url.searchParams.get("error_description") || undefined,
      state: url.searchParams.get("state") || undefined
    };
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Vibecodr MCP CLI login complete. You can close this tab.");
    callbackResolve?.(result);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  }).catch((error) => {
    throw new CliError("auth.loopback_bind_failed", "Failed to open a local loopback callback listener.", EXIT_CODES.authFailed, {
      cause: error,
      nextStep: "Close any conflicting local listener and retry."
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new CliError("auth.loopback_bind_failed", "Failed to determine the loopback callback address.", EXIT_CODES.authFailed);
  }
  const redirectUrl = new URL(`http://127.0.0.1:${address.port}${callbackPath}`);
  const timer = setTimeout(() => {
    callbackReject?.(
      new CliError("auth.timeout", "Timed out waiting for the OAuth callback.", EXIT_CODES.canceled, {
        nextStep: "Retry login and complete the browser flow before the timeout expires."
      })
    );
  }, timeoutSec * 1000);

  return {
    redirectUrl,
    awaitCallback: async () => {
      try {
        return await callbackPromise;
      } finally {
        clearTimeout(timer);
      }
    },
    close: async () => {
      clearTimeout(timer);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

function assertPkceSupport(metadata?: AuthorizationServerMetadata): void {
  const methods = metadata?.code_challenge_methods_supported;
  if (!Array.isArray(methods) || !methods.includes("S256")) {
    throw new CliError("auth.pkce_missing", "Authorization server metadata does not advertise PKCE S256 support.", EXIT_CODES.protocol, {
      nextStep: "Verify the MCP authorization server metadata includes code_challenge_methods_supported with S256."
    });
  }
}

function resolveBrowserMode(profile: ProfileConfig, override?: BrowserMode): BrowserMode {
  return override || profile.browserMode;
}

export class TokenManager {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly secretStore: SecretStore
  ) {}

  async resolveProfile(globalOptions: GlobalOptions): Promise<{ profileName: string; profile: ProfileConfig; serverUrl: string }> {
    const { name, profile } = await this.configStore.getProfile(globalOptions.profile);
    return {
      profileName: name,
      profile,
      serverUrl: globalOptions.serverUrl || profile.serverUrl
    };
  }

  async getSession(profileName: string): Promise<SessionRecord | undefined> {
    return await this.secretStore.get(profileName);
  }

  sessionState(session: SessionRecord | undefined): SessionState {
    if (!session) return "none";
    if (!session.expiresAt) return session.refreshToken ? "refreshable" : "valid";
    const expiresAt = Date.parse(session.expiresAt);
    if (Number.isNaN(expiresAt)) return session.refreshToken ? "refreshable" : "valid";
    if (expiresAt > Date.now()) return "valid";
    return session.refreshToken ? "refreshable" : "expired";
  }

  async discover(serverUrl: string): Promise<DiscoveryResult> {
    try {
      const result = await discoverOAuthServerInfo(serverUrl);
      return {
        authorizationServerUrl: result.authorizationServerUrl,
        authorizationServerMetadata: result.authorizationServerMetadata,
        resourceMetadata: result.resourceMetadata
      };
    } catch (error) {
      throw new CliError("network.discovery_failed", "Failed to discover MCP OAuth metadata.", EXIT_CODES.network, {
        cause: error,
        nextStep: `Verify ${serverUrl} is reachable and its auth metadata endpoints are healthy.`
      });
    }
  }

  async login(
    globalOptions: GlobalOptions,
    options?: {
      scope?: string;
      registrationMode?: RegistrationMode;
      browserMode?: BrowserMode;
      timeoutSec?: number;
      onAuthorizationUrl?: (url: string) => void;
    }
  ): Promise<LoginResult> {
    const { profileName, profile, serverUrl } = await this.resolveProfile(globalOptions);
    const timeoutSec = options?.timeoutSec || 300;
    const loopback = await startLoopbackListener(timeoutSec);
    try {
      const prepared = await this.prepareAuthorization({
        serverUrl,
        profile,
        requestedMode: options?.registrationMode || profile.registrationMode,
        scope: options?.scope,
        globalOptions,
        redirectUrl: loopback.redirectUrl
      });
      const browserMode = resolveBrowserMode(profile, options?.browserMode);
      if (browserMode === "print" || globalOptions.nonInteractive) {
        options?.onAuthorizationUrl?.(prepared.authorizationUrl.toString());
        if (process.env.VIBECDR_MCP_TEST_AUTH_URL_FILE) {
          await writeFile(process.env.VIBECDR_MCP_TEST_AUTH_URL_FILE, prepared.authorizationUrl.toString(), "utf8");
        }
      } else {
        await openExternalUrl(prepared.authorizationUrl.toString());
      }

      const callback = await loopback.awaitCallback();
      if (callback.error) {
        throw new CliError("auth.authorization_failed", callback.errorDescription || callback.error, EXIT_CODES.authFailed);
      }
      if (!callback.code || callback.state !== prepared.state) {
        throw new CliError("auth.state_mismatch", "OAuth callback state did not match the pending login session.", EXIT_CODES.authFailed, {
          nextStep: "Retry login and complete only the most recent browser flow."
        });
      }

      const resource = new URL(prepared.discovery.resourceMetadata?.resource || serverUrl);
      const tokens = await exchangeAuthorization(prepared.discovery.authorizationServerUrl, {
        metadata: prepared.discovery.authorizationServerMetadata,
        clientInformation: prepared.clientInformation,
        authorizationCode: callback.code,
        codeVerifier: prepared.codeVerifier,
        redirectUri: prepared.redirectUrl,
        resource
      }).catch((error) => {
        throw new CliError("auth.exchange_failed", "Failed to exchange the authorization code for tokens.", EXIT_CODES.authFailed, {
          cause: error
        });
      });

      const session: SessionRecord = {
        schemaVersion: 1,
        serverUrl,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: computeExpiresAt(tokens.expires_in),
        scope: tokens.scope || options?.scope,
        tokenType: tokens.token_type,
        registrationMode: prepared.registrationMode,
        authorizationServerUrl: prepared.discovery.authorizationServerUrl,
        resourceUrl: resource.toString(),
        clientInformation: prepared.clientInformation,
        updatedAt: new Date().toISOString()
      };
      await this.secretStore.set(profileName, session);

      return {
        profile: profileName,
        serverUrl,
        registrationMode: prepared.registrationMode,
        authenticated: true,
        expiresAt: session.expiresAt,
        hasRefreshToken: Boolean(session.refreshToken),
        authorizationServerIssuer: prepared.discovery.authorizationServerMetadata?.issuer
      };
    } finally {
      await loopback.close();
    }
  }

  async ensureSession(globalOptions: GlobalOptions, options?: { allowInteractiveLogin?: boolean }): Promise<SessionRecord> {
    const { profileName } = await this.resolveProfile(globalOptions);
    const current = await this.secretStore.get(profileName);
    if (current && !isExpiringSoon(current)) return current;
    if (current?.refreshToken) {
      try {
        const refresh = await this.refresh(profileName, current);
        return refresh.session;
      } catch (error) {
        if (!(error instanceof CliError) || (error.exitCode !== EXIT_CODES.authFailed && error.exitCode !== EXIT_CODES.authRequired)) {
          throw error;
        }
      }
    }
    if (options?.allowInteractiveLogin && !globalOptions.nonInteractive && isInteractiveTerminal()) {
      const result = await this.login(globalOptions);
      const next = await this.secretStore.get(profileName);
      if (!next) {
        throw new CliError("auth.missing_session", "Login completed but no local session was stored.", EXIT_CODES.authFailed);
      }
      return next;
    }
    throw new CliError("auth.required", "Authentication is required for this command.", EXIT_CODES.authRequired, {
      nextStep: "Run vibecodr-mcp login, then retry. CLI auth is separate from editor auth and widget auth."
    });
  }

  async refresh(profileName: string, session: SessionRecord): Promise<RefreshResult> {
    if (!session.refreshToken) {
      throw new CliError("auth.refresh_unavailable", "No refresh token is available for this profile.", EXIT_CODES.authRequired);
    }
    const discovery = await this.discover(session.serverUrl);
    const resource = session.resourceUrl ? new URL(session.resourceUrl) : new URL(session.serverUrl);
    const tokens = await refreshAuthorization(discovery.authorizationServerUrl, {
      metadata: discovery.authorizationServerMetadata,
      clientInformation: session.clientInformation,
      refreshToken: session.refreshToken,
      resource
    }).catch(async (error) => {
      await this.secretStore.delete(profileName).catch(() => undefined);
      throw new CliError("auth.refresh_failed", "Failed to refresh the stored session.", EXIT_CODES.authFailed, {
        cause: error,
        nextStep: "Run vibecodr-mcp login to re-authenticate."
      });
    });

    const updated: SessionRecord = {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || session.refreshToken,
      expiresAt: computeExpiresAt(tokens.expires_in),
      scope: tokens.scope || session.scope,
      tokenType: tokens.token_type || session.tokenType,
      authorizationServerUrl: discovery.authorizationServerUrl,
      updatedAt: new Date().toISOString()
    };
    await this.secretStore.set(profileName, updated);
    return { session: updated, previousSession: session };
  }

  async logout(profileName: string, options?: { noRevoke?: boolean }): Promise<{ localTokensDeleted: boolean; revocationAttempted: boolean; revocationConfirmed: boolean }> {
    const session = await this.secretStore.get(profileName);
    if (!session) {
      return {
        localTokensDeleted: false,
        revocationAttempted: false,
        revocationConfirmed: false
      };
    }

    let revocationAttempted = false;
    let revocationConfirmed = false;
    if (!options?.noRevoke && session.refreshToken) {
      revocationAttempted = true;
      try {
        const discovery = await this.discover(session.serverUrl);
        const endpoint = discovery.authorizationServerMetadata && "revocation_endpoint" in discovery.authorizationServerMetadata
          ? discovery.authorizationServerMetadata.revocation_endpoint
          : undefined;
        if (endpoint) {
          const form = new URLSearchParams({
            token: session.refreshToken,
            client_id: session.clientInformation.client_id
          });
          const clientSecret = "client_secret" in session.clientInformation ? session.clientInformation.client_secret : undefined;
          if (typeof clientSecret === "string" && clientSecret) form.set("client_secret", clientSecret);
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded"
            },
            body: form.toString()
          });
          revocationConfirmed = res.ok;
        }
      } catch {
        revocationConfirmed = false;
      }
    }

    const localTokensDeleted = await this.secretStore.delete(profileName);
    return {
      localTokensDeleted,
      revocationAttempted,
      revocationConfirmed
    };
  }

  private async prepareAuthorization(args: {
    serverUrl: string;
    profile: ProfileConfig;
    requestedMode: RegistrationMode;
    scope?: string;
    globalOptions: GlobalOptions;
    redirectUrl: URL;
  }): Promise<PreparedAuthorization> {
    const discovery = await this.discover(args.serverUrl);
    assertPkceSupport(discovery.authorizationServerMetadata);

    const registrationMode = await this.resolveRegistrationMode(
      args.requestedMode,
      args.serverUrl,
      discovery.authorizationServerMetadata,
      args.globalOptions
    );
    const clientInformation = await this.resolveClientInformation({
      serverUrl: args.serverUrl,
      registrationMode,
      metadata: discovery.authorizationServerMetadata,
      authorizationServerUrl: discovery.authorizationServerUrl,
      redirectUrl: args.redirectUrl,
      scope: args.scope
    });
    const resource = new URL(discovery.resourceMetadata?.resource || args.serverUrl);
    const state = randomState();
    const { authorizationUrl, codeVerifier } = await startAuthorization(discovery.authorizationServerUrl, {
      metadata: discovery.authorizationServerMetadata,
      clientInformation,
      redirectUrl: args.redirectUrl,
      scope: args.scope,
      state,
      resource
    });
    return {
      authorizationUrl,
      codeVerifier,
      state,
      redirectUrl: args.redirectUrl,
      clientInformation,
      registrationMode,
      discovery
    };
  }

  private async resolveRegistrationMode(
    requestedMode: RegistrationMode,
    serverUrl: string,
    metadata: AuthorizationServerMetadata | undefined,
    globalOptions: GlobalOptions
  ): Promise<RegistrationMode> {
    if (requestedMode !== "auto") return requestedMode;
    if (isOfficialServer(serverUrl)) return "cimd";
    if (metadata?.client_id_metadata_document_supported && CIMD_CLIENT_ID) return "cimd";
    if (metadata?.registration_endpoint) return "dcr";
    if (MANUAL_CLIENT_ID) return "manual";
    if (!globalOptions.nonInteractive && isInteractiveTerminal()) return "manual";
    throw new CliError("auth.registration_unavailable", "No supported OAuth client registration mode is available for this server.", EXIT_CODES.protocol, {
      nextStep: "Configure a preregistered client, CIMD client ID, or dynamic registration endpoint."
    });
  }

  private async resolveClientInformation(args: {
    serverUrl: string;
    registrationMode: RegistrationMode;
    metadata: AuthorizationServerMetadata | undefined;
    authorizationServerUrl: string;
    redirectUrl: URL;
    scope?: string;
  }): Promise<OAuthClientInformationMixed> {
    switch (args.registrationMode) {
      case "preregistered":
        if (isOfficialServer(args.serverUrl)) {
          return officialClientInformation();
        }
        throw new CliError("auth.preregistered_missing", "No preregistered client is configured for this server.", EXIT_CODES.protocol);
      case "cimd":
        if (isOfficialServer(args.serverUrl)) {
          return officialClientInformation();
        }
        if (!CIMD_CLIENT_ID) {
          throw new CliError("auth.cimd_missing", "No Client ID Metadata Document URL is configured.", EXIT_CODES.protocol);
        }
        return {
          client_id: CIMD_CLIENT_ID
        };
      case "dcr":
        if (!args.metadata?.registration_endpoint) {
          throw new CliError("auth.dcr_missing", "Authorization server metadata does not advertise a registration endpoint.", EXIT_CODES.protocol);
        }
        return await registerClient(args.authorizationServerUrl, {
          metadata: args.metadata,
          clientMetadata: {
            redirect_uris: [args.redirectUrl.toString()],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            client_name: "Vibecodr MCP CLI",
            scope: args.scope
          }
        }).catch((error) => {
          throw new CliError("auth.dcr_failed", "Dynamic client registration failed.", EXIT_CODES.protocol, {
            cause: error
          });
        });
      case "manual": {
        const clientId = MANUAL_CLIENT_ID || (isInteractiveTerminal() ? await promptText("Public client_id: ") : "");
        if (!clientId) {
          throw new CliError("auth.manual_client_missing", "A public client_id is required for manual registration mode.", EXIT_CODES.authRequired, {
            nextStep: "Provide a manual client_id or choose a different registration mode."
          });
        }
        return { client_id: clientId };
      }
      default:
        throw new CliError("auth.unsupported_mode", `Unsupported registration mode: ${args.registrationMode}`, EXIT_CODES.usage);
    }
  }
}
