import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthProtectedResourceMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { RegistrationMode } from "./config.js";

export interface CallbackResult {
  code?: string | undefined;
  error?: string | undefined;
  errorDescription?: string | undefined;
  state?: string | undefined;
}

export interface SessionRecord {
  schemaVersion: 1;
  serverUrl: string;
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt?: string | undefined;
  scope?: string | undefined;
  tokenType?: string | undefined;
  registrationMode: RegistrationMode;
  authorizationServerUrl: string;
  resourceUrl?: string | undefined;
  resourceMetadataUrl?: string | undefined;
  clientInformation: OAuthClientInformationMixed;
  updatedAt: string;
}

export interface LoginResult {
  profile: string;
  serverUrl: string;
  registrationMode: RegistrationMode;
  authenticated: true;
  expiresAt?: string | undefined;
  hasRefreshToken: boolean;
  authorizationServerIssuer?: string | undefined;
}

export interface DiscoveryResult {
  authorizationServerUrl: string;
  authorizationServerMetadata?: AuthorizationServerMetadata | undefined;
  resourceMetadata?: OAuthProtectedResourceMetadata | undefined;
  resourceMetadataUrl?: string | undefined;
}

export interface PreparedAuthorization {
  authorizationUrl: URL;
  codeVerifier: string;
  state: string;
  redirectUrl: URL;
  clientInformation: OAuthClientInformationMixed;
  registrationMode: RegistrationMode;
  discovery: DiscoveryResult;
}

export interface RefreshResult {
  session: SessionRecord;
  previousSession: SessionRecord;
}

export interface StoredTokens extends OAuthTokens {
  expiresAt?: string | undefined;
}
