# Contributors

## Runtime

- Node `>=22 <26`
- local development is currently exercised on Node 24

## Core commands

```bash
npm install
npm run check
npm test
npm run test:live-smoke
npm run build
npm run verify
node dist/bin/vibecodr-mcp.js help
```

## Useful smoke checks

```bash
node dist/bin/vibecodr-mcp.js status --json
node dist/bin/vibecodr-mcp.js doctor --json --non-interactive
node dist/bin/vibecodr-mcp.js tools --json --non-interactive
node dist/bin/vibecodr-mcp.js call get_vibecodr_platform_overview --json --non-interactive
```

`tools` does not force auth for public catalogs. Protected `call` flows will refresh or trigger login on challenge.

## Profiles

Create a staging profile:

```bash
node dist/bin/vibecodr-mcp.js config profile create staging --server-url https://staging-openai.vibecodr.space/mcp
node dist/bin/vibecodr-mcp.js config profile use staging
```

## Registration mode forcing

Examples:

```bash
node dist/bin/vibecodr-mcp.js login --registration dcr
node dist/bin/vibecodr-mcp.js login --registration manual
```

Current repo reality:

- the official production path uses the committed client metadata document URL `https://openai.vibecodr.space/.well-known/oauth-client/vibecodr-mcp.json`
- CIMD mode requires `VIBECDR_MCP_CIMD_CLIENT_ID`
- manual mode can use `VIBECDR_MCP_MANUAL_CLIENT_ID` or an interactive prompt

## Mock fixtures and deeper integration

Automated coverage now includes:

- parser and renderer behavior
- interactive schema prompting for nested objects and arrays
- command-level install smoke for Codex, Cursor, VS Code workspace scope, and Windsurf
- a mock OAuth/MCP fixture that exercises DCR login, loopback callback handling, protected tools/list, protected tools/call, refresh, invalid_grant clearing, and logout revocation behavior
- a live smoke suite that validates the official first-party auth bootstrap and public tool discovery/call against `https://openai.vibecodr.space/mcp`

Still not covered in automation:

- real live browser login against the hosted service with account credentials
- real client-application installs across Codex/Cursor/VS Code/Windsurf on CI hosts
