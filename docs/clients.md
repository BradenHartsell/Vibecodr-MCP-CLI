# Clients

This matrix reflects current repo reality, not the full target spec.

| Client | Install status now | Uninstall status now | Scope support now | Auth owner |
| --- | --- | --- | --- | --- |
| Codex | Implemented | Implemented via CLI or TOML fallback | User | Codex |
| Cursor | Implemented | Implemented | User + project | Cursor |
| VS Code | Implemented | Project uninstall implemented, user uninstall not automated | User + project | VS Code |
| Windsurf | Implemented | Implemented | User | Windsurf |
| Direct CLI | Implemented | N/A | N/A | Vibecodr MCP CLI |

## Exact surfaces used now

### Codex

- primary install: `codex mcp add`
- primary uninstall: `codex mcp remove`
- fallback file: `~/.codex/config.toml`

### Cursor

- user file: `~/.cursor/mcp.json`
- project file: `.cursor/mcp.json`
- optional open-client deeplink

### VS Code

- user install: `code --add-mcp`
- user fallback when `--open-client` is present: `vscode:mcp/install?...`
- project file: `.vscode/mcp.json`

### Windsurf

- native file: `~/.codeium/windsurf/mcp_config.json`
- docs note for legacy plugin path: `~/.codeium/mcp_config.json`

## Current caveats

- installer adapters exist, but the direct CLI runtime remains the primary proofed surface
- VS Code user-scope uninstall still lacks a documented automated removal path in this repo
- enterprise allowlists, team policy blocks, and client-side OAuth behavior still need live validation in real environments
