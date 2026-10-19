# Architecture

## Components

| Component | Location | Responsibility |
|---|---|---|
| iOS app | `ios/AgentRemote` | Pairing, session list, timeline, approvals, model picker |
| `agentd` | `agentd/src` | WebSocket API, token auth, session state, DSH lifecycle |
| DSH ACP adapter | `agentd/src/acp` | JSON-RPC over stdio, permission requests, tool-call correlation |
| DeepSeek Harness | external | Runs the agent with the generated `acp` profile |

## Lifecycle

1. `agentd` resolves the DSH runtime and starts `dsh --profile acp --patch <generated>`.
2. The app connects to `ws://<host>:8787/ws` and sends:

   ```json
   { "type": "hello", "token": "...", "deviceName": "iPhone" }
   ```

3. `agentd` replies with `hello_ok` and the session summaries.
4. `subscribe` returns a `snapshot` containing the session, events, pending approvals
   and config options.
5. `prompt` starts a turn. `agentd` normalizes ACP notifications into:

   - `user_message`
   - `assistant_delta`
   - `thought_delta`
   - `tool_call` / `tool_update`
   - `usage`
   - `turn_end` / `error`

6. `approve` resolves a pending permission request. The approval is one-shot and
   correlated to the exact `toolCallId` and command that triggered it.
7. `set_model` maps to `session/set_config_option`; `cancel` maps to
   `session/cancel`; `close_session` closes the upstream session.

## Approval correlation

ACP's `session/request_permission` contains the `toolCallId` and the allowed options,
but not the command text. `agentd` keeps the preceding `tool_call` update keyed by
`toolCallId` and joins it with the permission request. The iOS sheet therefore shows:

- the exact command
- the working directory
- the model's justification
- the requested sandbox (`danger-full-access` is highlighted)

The allowed options are only `allow-once` and `reject-once`; there is no implicit
"always allow".

## WebSocket messages

| Direction | Type | Purpose |
|---|---|---|
| app → daemon | `hello` | Token authentication |
| daemon → app | `hello_ok` | Host info + sessions |
| app → daemon | `list_sessions` | Refresh session list |
| app → daemon | `subscribe` | Attach to a session |
| daemon → app | `snapshot` | Session, events, approvals, config |
| app → daemon | `create_session` | Create a DSH session at `cwd` |
| app → daemon | `prompt` | Start a turn |
| daemon → app | `event` | Normalized agent event |
| daemon → app | `approval` | Permission request |
| app → daemon | `approve` | `allow-once` / `reject-once` |
| daemon → app | `approval_resolved` | Decision acknowledged |
| app → daemon | `set_model` | Change model |
| app → daemon | `cancel` | Cancel the current turn |
| app → daemon | `close_session` | Close a session |
| daemon → app | `error` | Recoverable protocol error |

The canonical TypeScript types live in `agentd/src/types.ts`; the Swift mirrors are in
`ios/AgentRemote/Models.swift`.

## DSH profile

`agentd` writes a small patch file under `~/.agent-remote` that selects the provider and
default model, then starts:

```text
dsh --profile acp --patch ~/.agent-remote/dsh-acp.patch.yml
```

`DSH_PERMISSION_MODE` is forced to `workspace-write` so an inherited
`danger-full-access` from the parent shell cannot silently auto-approve tool calls.
The daemon uses the user's `~/.dsh` login and `$HOME` as the default allowed root.

## Security boundaries

- The daemon is not a sandbox. It runs with the macOS user's permissions.
- The bearer token is the only application-level authentication.
- The transport is `ws://` on a trusted LAN or Tailscale. There is no application-layer
  E2E envelope or relay yet.
- Approval decisions are one-shot and scoped to a tool call.
- The iOS app stores the token in Keychain; the daemon stores it in
  `~/.agent-remote/token` with user-only permissions.

## Extending to Codex and Claude

The app talks only to the normalized `agentd` protocol. New runtimes can be added as
adapters that translate their native approval/turn events into the same messages:

- **Codex** — `codex app-server --listen stdio://` and its `thread/start`,
  `turn/start` and approval server requests.
- **Claude** — `@anthropic-ai/claude-agent-sdk` with `canUseTool`, resume/fork and
  `setModel`.

The iOS client does not need to change for a new runtime as long as the adapter
preserves the session/event/approval shape.
