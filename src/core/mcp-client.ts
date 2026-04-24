import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";

const CLIENT_INFO = {
  name: "vibecodr-mcp",
  version: "0.1.0"
};

export type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
export type CalledToolResult = Awaited<ReturnType<Client["callTool"]>>;

type CapturedAuthChallenge = {
  status: number;
  scope?: string | undefined;
  error?: string | undefined;
  resourceMetadataUrl?: string | undefined;
};

export class McpRuntimeClient {
  async listTools(serverUrl: string, accessToken?: string): Promise<ListedTool[]> {
    return await this.withClient(serverUrl, accessToken, async (client) => {
      const result = await client.listTools();
      return result.tools;
    });
  }

  async callTool(serverUrl: string, accessToken: string | undefined, name: string, args: Record<string, unknown>): Promise<CalledToolResult> {
    return await this.withClient(serverUrl, accessToken, async (client) => {
      return await client.callTool({
        name,
        arguments: args
      });
    });
  }

  private async withClient<T>(serverUrl: string, accessToken: string | undefined, fn: (client: Client) => Promise<T>): Promise<T> {
    let authChallenge: CapturedAuthChallenge | undefined;
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      ...(accessToken ? { requestInit: {
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      } } : {}),
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (response.status === 401 || response.status === 403) {
          const challenge = extractWWWAuthenticateParams(response);
          authChallenge = {
            status: response.status,
            scope: challenge.scope,
            error: challenge.error,
            resourceMetadataUrl: challenge.resourceMetadataUrl?.toString()
          };
        }
        return response;
      }
    });
    const client = new Client(CLIENT_INFO, {
      capabilities: {}
    });
    try {
      await client.connect(transport as Parameters<Client["connect"]>[0]);
      return await fn(client);
    } catch (error) {
      if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) {
        const requiredScope = authChallenge?.scope;
        const isScopeStepUp = authChallenge?.error === "insufficient_scope" || error.code === 403;
        throw new CliError(
          isScopeStepUp ? "auth.insufficient_scope" : "auth.required",
          isScopeStepUp
            ? "The MCP server requires a broader OAuth scope for this operation."
            : "The MCP server requires authentication for this operation.",
          EXIT_CODES.authRequired,
          {
            cause: error,
            debugDetails: authChallenge,
            nextStep: requiredScope
              ? `Run vibecodr login --scope "${requiredScope}", or retry interactively to complete CLI MCP OAuth. CLI auth is separate from editor auth and widget auth.`
              : "Run vibecodr login, or retry interactively to complete CLI MCP OAuth. CLI auth is separate from editor auth and widget auth."
          }
        );
      }
      throw new CliError("mcp.protocol", "Failed to complete the MCP request.", EXIT_CODES.protocol, {
        cause: error,
        nextStep: "Run vibecodr doctor to inspect auth, discovery, and connectivity."
      });
    } finally {
      await transport.close().catch(() => undefined);
    }
  }
}
