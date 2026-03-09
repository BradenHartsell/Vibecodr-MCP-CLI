# ACTIVE DEVELOPMENT - USE AT YOUR OWN RISK #




# Vibecodr MCP CLI

Direct terminal client for the hosted Vibecodr MCP server.

This repository is intentionally separate from the PolyForm-licensed server implementation. The CLI is the permissively licensed public client surface for:

- direct CLI OAuth login
- live MCP tool discovery
- live MCP tool invocation
- environment and auth diagnostics
- thin client install and uninstall adapters

Currently implemented command surface:

- `login`
- `logout`
- `status`
- `tools`
- `call`
- `doctor`
- `config`
- `install`
- `uninstall`

The runtime path talks directly to `https://openai.vibecodr.space/mcp`. Editor installers are not part of the runtime path.

The official production auth path is now committed in package code through the server-hosted client metadata document:

- `https://openai.vibecodr.space/.well-known/oauth-client/vibecodr-mcp.json`

Documentation:

- [docs/auth.md](docs/auth.md)
- [docs/install.md](docs/install.md)
- [docs/clients.md](docs/clients.md)
- [docs/commands.md](docs/commands.md)
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/contributors.md](docs/contributors.md)
- [docs/licensing.md](docs/licensing.md)
