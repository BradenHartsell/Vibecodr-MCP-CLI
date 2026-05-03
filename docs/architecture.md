# Architecture

The Vibecodr CLI is a client of the hosted Vibecodr MCP gateway.

## Boundary

- hosted MCP gateway/server repo: `Vibecodr-MCP`
- CLI client repo: `Vibecodr-MCP-CLI`
- CLI package: `@vibecodr/cli`
- primary executable: `vibecodr`
- compatibility executable: `vibecodr-mcp`
- legacy package compatibility: `@vibecodr/mcp`
- default MCP URL: `https://openai.vibecodr.space/mcp`

This repo does not run the hosted server. It installs client config, performs CLI-owned OAuth, discovers the live tool catalog, and calls tools over Streamable HTTP MCP.

## Auth Ownership

`vibecodr login` stores OAuth tokens for the CLI profile only.

Codex, Cursor, VS Code, Windsurf, ChatGPT, and other MCP clients own separate OAuth sessions. Installing MCP config into those clients points them at the same server, but it does not copy CLI tokens into them.

## Why The Repos Are Separate

The CLI is permissively licensed and safe to distribute as a public client package. The hosted gateway implementation is source-available under a different license because it contains server-side orchestration, OAuth gateway behavior, Cloudflare deployment wiring, and Vibecodr API integration code.

The package name is `@vibecodr/cli` because this repo distributes the user-facing command-line client. The older `@vibecodr/mcp` package name is kept only as a compatibility/deprecation surface; the bare `vibecodr` executable remains the canonical user command.

Local config directories and secure-token service names intentionally keep their historical `vibecodr-mcp` / `@vibecodr/mcp` identifiers during this migration. Those names are storage compatibility keys, not the public npm package identity.

Keeping the repos separate makes the contract clear:

- users can use the hosted service normally
- users can install and inspect the CLI freely under this repo license
- commercial reuse of the gateway implementation remains governed by the server repo license
