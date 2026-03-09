# Licensing

This repository is the public Vibecodr MCP CLI surface.

- Package name: `@vibecodr/mcp`
- Executable name: `vibecodr-mcp`
- Repo scope: direct CLI runtime, auth, diagnostics, and later thin installer adapters
- License: Apache-2.0

The hosted MCP server and ChatGPT app gateway remain separate from this repo. That separation keeps hosted-service use distinct from any source-code reuse terms applied to the server implementation repo.

Practical split:

- this CLI repo governs distribution, modification, and reuse of the public client code
- the hosted Vibecodr MCP service remains governed by Vibecodr service terms for account holders
- the server implementation repo can carry different source-available terms without changing whether a commercial team may use the hosted service
