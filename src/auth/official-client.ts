import type { OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";

export const OFFICIAL_SERVER_URL = "https://openai.vibecodr.space/mcp";
export const OFFICIAL_CLIENT_METADATA_URL = "https://openai.vibecodr.space/.well-known/oauth-client/vibecodr-mcp.json";

export function isOfficialServer(serverUrl: string): boolean {
  return serverUrl.replace(/\/+$/, "") === OFFICIAL_SERVER_URL;
}

export function officialClientInformation(): OAuthClientInformationMixed {
  return {
    client_id: OFFICIAL_CLIENT_METADATA_URL
  };
}
