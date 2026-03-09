# Install

This repo now includes `install` and `uninstall` adapters, but the direct runtime core remains the primary product surface.

## Current recommended use

One-shot install without publishing:

```bash
npm install
npm run build
node dist/bin/vibecodr-mcp.js install codex --json
```

After the package is published:

```bash
npx -y @vibecodr/mcp install codex
```

Direct CLI-only usage:

```bash
npx -y @vibecodr/mcp login
npx -y @vibecodr/mcp tools --json
```

## Client commands

### Codex

```bash
vibecodr-mcp install codex
```

Behavior now:

- prefers `codex mcp add <name> --url <server-url>`
- falls back to TOML merge in `~/.codex/config.toml`
- user scope only

### Cursor

```bash
vibecodr-mcp install cursor --scope user
vibecodr-mcp install cursor --scope project --path .
```

Behavior now:

- writes `~/.cursor/mcp.json` for user scope
- writes `.cursor/mcp.json` for project scope
- `--open-client` also opens the current Cursor deeplink install URI

### VS Code

```bash
vibecodr-mcp install vscode --scope user
vibecodr-mcp install vscode --scope project --path .
```

Behavior now:

- user scope prefers `code --add-mcp`
- if `code` is unavailable and `--open-client` is set, opens the documented `vscode:mcp/install?...` URI
- project scope writes `.vscode/mcp.json`

### Windsurf

```bash
vibecodr-mcp install windsurf
```

Behavior now:

- writes `~/.codeium/windsurf/mcp_config.json`
- warns in docs about the legacy plugin path

## Important split

Install config is not runtime auth.

- `install` configures the client
- `login` authenticates the CLI itself
- each editor still owns its own MCP OAuth state

## Current limitations

- VS Code user-scope uninstall is not automated with a documented removal surface yet
- install adapters are implemented, but they are intentionally thin and never used for runtime `tools` or `call`
