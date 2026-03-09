# Troubleshooting

## Browser did not open

Retry with:

```bash
vibecodr-mcp login --browser print
```

Then open the printed URL manually.

## Callback timed out

The loopback listener waits on `127.0.0.1` and expires after the configured timeout.

Try:

- rerun `login`
- complete the browser flow before the timeout
- ensure local security software is not blocking loopback callbacks

## Secure secret store unavailable

Run:

```bash
vibecodr-mcp doctor --json
```

If the `secret-store` check fails, the CLI cannot safely store tokens yet.

## Proxy or TLS issues

The CLI uses normal outbound HTTPS fetches for discovery and token operations.

Use:

```bash
vibecodr-mcp doctor --json
```

If `server-reachability` fails, verify:

- proxy environment variables
- local TLS interception policy
- outbound access to `https://openai.vibecodr.space/mcp`

## Client config conflict

If install fails with a conflict, the target config already contains an entry with the same name but a different URL.

Use either:

- a different `--name`
- `--overwrite` if the existing entry is meant to be replaced

## Windsurf legacy path confusion

Current native path:

- `~/.codeium/windsurf/mcp_config.json`

Older plugin references may still mention:

- `~/.codeium/mcp_config.json`

The CLI writes the native path.

## Codex auth-on-first-use caveat

Codex config install and CLI login are separate.

- `install codex` configures Codex
- `login` authenticates `vibecodr-mcp`
- Codex will still own its own OAuth behavior when you use the server inside Codex

## VS Code CLI not found

If `code --add-mcp` is unavailable:

- use project scope with `.vscode/mcp.json`
- or retry user scope with `--open-client`

## Step-up scope prompts

The repo does not yet have a dedicated step-up scope UX beyond the normal re-auth path. If a server requests a broader scope, rerun `login` with the needed `--scope`.
