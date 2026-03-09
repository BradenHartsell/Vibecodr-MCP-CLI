import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { TokenManager } from "../src/auth/token-manager.js";
import type { ConfigFile, ProfileConfig } from "../src/types/config.js";
import type { SessionRecord } from "../src/types/auth.js";

class MemoryConfigStore {
  constructor(private readonly serverUrl: string) {}

  async load(): Promise<ConfigFile> {
    return {
      version: 1,
      currentProfile: "default",
      profiles: {
        default: {
          serverUrl: this.serverUrl,
          browserMode: "print",
          registrationMode: "dcr",
          defaultInstallScope: "user",
          logLevel: "normal"
        }
      }
    };
  }

  async save(): Promise<void> {}

  async getProfile(profileName?: string): Promise<{ name: string; profile: ProfileConfig; config: ConfigFile }> {
    const config = await this.load();
    return {
      name: profileName || config.currentProfile,
      profile: config.profiles[profileName || config.currentProfile],
      config
    };
  }

  path(): string {
    return "memory";
  }
}

class MemorySecretStore {
  private readonly map = new Map<string, SessionRecord>();

  async get(profile: string): Promise<SessionRecord | undefined> {
    return this.map.get(profile);
  }

  async set(profile: string, session: SessionRecord): Promise<void> {
    this.map.set(profile, session);
  }

  async delete(profile: string): Promise<boolean> {
    return this.map.delete(profile);
  }

  async checkAvailability(): Promise<{ ok: boolean; summary: string }> {
    return { ok: true, summary: "memory store available" };
  }
}

async function createMockAuthServer(): Promise<{
  serverUrl: string;
  close: () => Promise<void>;
}> {
  let rotatedRefreshToken = "refresh-initial";
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        resource: `${baseUrl()}/mcp`,
        authorization_servers: [baseUrl()]
      }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        issuer: baseUrl(),
        authorization_endpoint: `${baseUrl()}/authorize`,
        token_endpoint: `${baseUrl()}/token`,
        registration_endpoint: `${baseUrl()}/register`,
        revocation_endpoint: `${baseUrl()}/revoke`,
        response_types_supported: ["code"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        client_id_metadata_document_supported: true
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/register") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const parsed = JSON.parse(body) as { redirect_uris?: string[] };
        res.setHeader("content-type", "application/json");
        res.statusCode = 201;
        res.end(JSON.stringify({
          client_id: "mock-dcr-client",
          redirect_uris: parsed.redirect_uris,
          token_endpoint_auth_method: "none"
        }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/authorize") {
      const redirect = new URL(url.searchParams.get("redirect_uri") || "");
      redirect.searchParams.set("code", "auth-code");
      redirect.searchParams.set("state", url.searchParams.get("state") || "");
      res.statusCode = 302;
      res.setHeader("location", redirect.toString());
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/token") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        res.setHeader("content-type", "application/json");
        if (params.get("grant_type") === "authorization_code") {
          res.end(JSON.stringify({
            access_token: "access-token-1",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: rotatedRefreshToken,
            scope: "openid profile email offline_access"
          }));
          return;
        }
        if (params.get("grant_type") === "refresh_token") {
          rotatedRefreshToken = "refresh-rotated";
          res.end(JSON.stringify({
            access_token: "access-token-2",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: rotatedRefreshToken,
            scope: "openid profile email offline_access"
          }));
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/revoke") {
      res.statusCode = 200;
      res.end();
      return;
    }
    if (url.pathname === "/mcp") {
      res.statusCode = 405;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  function baseUrl(): string {
    return `http://127.0.0.1:${address.port}`;
  }
  return {
    serverUrl: `${baseUrl()}/mcp`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

test("token manager completes a loopback login with DCR and refreshes stored tokens", async () => {
  const mock = await createMockAuthServer();
  const configStore = new MemoryConfigStore(mock.serverUrl);
  const secretStore = new MemorySecretStore();
  const tokenManager = new TokenManager(configStore as never, secretStore as never);
  let authorizationUrl: string | undefined;

  try {
    let loginError: unknown;
    const loginPromise = tokenManager.login(
      {
        profile: "default",
        json: false,
        verbose: false,
        nonInteractive: false
      },
      {
        browserMode: "print",
        registrationMode: "dcr",
        timeoutSec: 5,
        onAuthorizationUrl: (url) => {
          authorizationUrl = url;
        }
      }
    ).catch((error) => {
      loginError = error;
      return null;
    });

    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (authorizationUrl) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!authorizationUrl) {
      await loginPromise;
      assert.fail(`authorization URL should be printed; login error: ${loginError instanceof Error ? loginError.message : String(loginError)}`);
    }
    const res = await fetch(authorizationUrl!, { redirect: "follow" });
    assert.equal(res.status, 200);

    const loginResult = await loginPromise;
    assert.equal(loginError, undefined);
    assert.ok(loginResult);
    assert.equal(loginResult.authenticated, true);
    const stored = await secretStore.get("default");
    assert.equal(stored?.accessToken, "access-token-1");
    assert.equal(stored?.refreshToken, "refresh-initial");

    const refreshed = await tokenManager.refresh("default", stored!);
    assert.equal(refreshed.session.accessToken, "access-token-2");
    assert.equal(refreshed.session.refreshToken, "refresh-rotated");

    const logout = await tokenManager.logout("default");
    assert.equal(logout.localTokensDeleted, true);
    assert.equal(logout.revocationAttempted, true);
  } finally {
    await mock.close();
  }
});
