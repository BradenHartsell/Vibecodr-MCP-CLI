# Architecture

The Vibecodr CLI is the unified user-facing command surface for the hosted MCP Gateway and the hosted Agent Computer.

## Boundary

- hosted MCP gateway/server repo: `Vibecodr-MCP`
- CLI and hosted Agent Computer worker repo: `Vibecodr-CLI`
- CLI package: `@vibecodr/cli`
- primary executable: `vibecodr`
- compatibility executables: `vibecodr-mcp`, `vc-tools`
- legacy package compatibility: `@vibecodr/mcp`
- default MCP URL: `https://openai.vibecodr.space/mcp`
- Agent Computer API URL: `https://tools.vibecodr.space`

This repo does not run the hosted MCP gateway. It does own the distributable CLI and the hosted Agent Computer worker source. The CLI installs client config, performs CLI-owned OAuth for the MCP Gateway, discovers the live gateway tool catalog, calls tools over Streamable HTTP MCP, and routes Agent Computer commands to `tools.vibecodr.space`.

## Auth Ownership

`vibecodr login` and `vibecodr login mcp` store OAuth tokens for the CLI profile only.

`vibecodr login agent` and `vibecodr start` store the hosted Agent Computer credential only.

Codex, Cursor, VS Code, Windsurf, ChatGPT, and other MCP clients own separate OAuth sessions. Installing MCP config into those clients points them at the same server, but it does not copy CLI tokens into them.

## Why The Repos Are Separate

The CLI is permissively licensed and safe to distribute as a public client package. The hosted gateway implementation is source-available under a different license because it contains server-side orchestration, OAuth gateway behavior, Cloudflare deployment wiring, and Vibecodr API integration code.

The package name is `@vibecodr/cli` because this repo distributes the user-facing command-line client. The older `@vibecodr/mcp` package name is kept only as a compatibility/deprecation surface; the bare `vibecodr` executable remains the canonical user command.

Local config directories and secure-token service names intentionally keep their historical `vibecodr-mcp`, `vc-tools`, `@vibecodr/mcp`, and `@vibecodr/vc-tools` identifiers during this migration. Those names are storage compatibility keys, not the public npm package identity.

Keeping the repos separate makes the contract clear:

- users can use the hosted service normally
- users can install and inspect the CLI freely under this repo license
- commercial reuse of the gateway implementation remains governed by the server repo license
