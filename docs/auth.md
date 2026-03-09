# Auth

`vibecodr login` authenticates the CLI itself to the hosted Vibecodr MCP server. It does not log Codex, Cursor, VS Code, or Windsurf into MCP.

Compatibility alias:

- `vibecodr-mcp login`

## Implemented now

- protected-resource and authorization-server discovery against the MCP server
- PKCE S256 enforcement
- loopback callback on `127.0.0.1`
- secure token storage in the OS credential store via `@napi-rs/keyring`
- proactive refresh before protected runtime commands when a refresh token is available
- `logout` local token deletion plus best-effort revocation

## Registration modes

The CLI understands these internal modes:

- `auto`
- `preregistered`
- `cimd`
- `dcr`
- `manual`

Current repo reality:

- `auto` now uses the committed official client metadata document URL for `https://openai.vibecodr.space/mcp`
- `cimd` for non-official servers still requires a real `VIBECDR_MCP_CIMD_CLIENT_ID` URL
- `dcr` works when the authorization server advertises `registration_endpoint`
- `manual` works with `VIBECDR_MCP_MANUAL_CLIENT_ID` or an interactive prompt

## Runtime behavior

- `status` reads local session state without requiring the network unless `--probe` is used
- `tools` and `call` will attempt to reuse the stored session
- if the access token is close to expiry and a refresh token is present, the CLI refreshes before making the MCP request

## Verified now

- automated mock coverage exercises DCR login, loopback callback handling, refresh, and logout revocation behavior
- unauthenticated `tools` works against public server surfaces without forcing login first
- unauthenticated public `call` works for noauth tools, while protected flows retry with refresh or interactive login

## Remaining constraints

- CIMD for non-official servers still needs a real externally hosted client-id metadata document to be genuinely usable
- dedicated scope step-up UX is still folded into the normal re-auth path rather than a specialized prompt flow
