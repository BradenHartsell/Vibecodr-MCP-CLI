import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthProtectedResourceMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { RegistrationMode } from "./config.js";

export interface CallbackResult {
  code?: string;
  error?: string;
  errorDescription?: string;
  state?: string;
}

export interface SessionRecord {
  schemaVersion: 1;
  serverUrl: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
  registrationMode: RegistrationMode;
  authorizationServerUrl: string;
  resourceUrl?: string;
  resourceMetadataUrl?: string;
  clientInformation: OAuthClientInformationMixed;
  updatedAt: string;
}

export interface LoginResult {
  profile: string;
  serverUrl: string;
  registrationMode: RegistrationMode;
  authenticated: true;
  expiresAt?: string;
  hasRefreshToken: boolean;
  authorizationServerIssuer?: string;
}

export interface DiscoveryResult {
  authorizationServerUrl: string;
  authorizationServerMetadata?: AuthorizationServerMetadata;
  resourceMetadata?: OAuthProtectedResourceMetadata;
  resourceMetadataUrl?: string;
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
  expiresAt?: string;
}
