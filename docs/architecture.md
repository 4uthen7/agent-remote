# Architecture

## Components

| Component | Location | Responsibility |
|---|---|---|
| iOS app | `ios/AgentRemote` | Pairing, session list, timeline, approvals, model picker |
| Android app | `android/app` | Jetpack Compose client with the same protocol and UI |
| `agentd` | `agentd/src` | WebSocket API, token auth, runtime/session routing; runs on macOS, Windows and Linux |
| Runtime manager | `agentd/src/runtime` | Lazy adapter startup, session routing, normalized events |
| DSH ACP adapter | `agentd/src/acp` | JSON-RPC over stdio, permission requests, tool-call correlation |
| Codex adapter | `agentd/src/codex` | `codex app-server` JSON lines, thread/turn, approvals |
| Claude adapter | `agentd/src/claude` | Claude Agent SDK `query()`, `canUseTool`, streaming |
| DeepSeek Harness | external | Runs the agent with the generated `acp` profile |
| Codex CLI | external | Runs `codex app-server` |
| Claude Code | external | Runs the Claude Agent SDK's CLI process |

## Lifecycle

1. The app connects to `ws://<host>:8787/ws` and sends:

   ```json
   { "type": "hello", "token": "...", "deviceName": "iPhone" }
   ```

3. `agentd` replies with `hello_ok` and the session summaries.
4. `subscribe` returns a `snapshot` containing the session, events, pending approvals
   and config options.
5. `create_session` includes a `runtime` (`dsh`, `codex`, or `claude`). The runtime
   manager starts that adapter lazily and routes later `prompt`, `cancel`, `set_model`
   and `close_session` calls to it.
6. `prompt` starts a turn. The adapter normalizes its native events into:

   - `user_message`
   - `assistant_delta`
   - `thought_delta`
   - `tool_call` / `tool_update`
   - `usage`
   - `turn_end` / `error`

7. `approve` resolves a pending permission request. The approval is one-shot and
   correlated to the exact `toolCallId` and command that triggered it.
8. `set_model` maps to the runtime's model switch; `cancel` interrupts the turn;
   `close_session` closes the upstream session.

## Approval correlation

Each adapter builds the same approval shape:

- **DSH** — ACP's `session/request_permission` contains the `toolCallId` and allowed
  options, but not the command text. `agentd` joins the preceding `tool_call` update by
  `toolCallId`.
- **Codex** — `item/commandExecution/requestApproval` (or file-change approval) carries
  the command, cwd, reason and item id. `agentd` replies with `accept` or `decline`.
- **Claude** — the SDK's `canUseTool(toolName, input, options)` promise is parked until
  the app answers; allow maps to `{behavior:"allow"}`, reject to `{behavior:"deny"}`.

The iOS sheet therefore shows the exact command, working directory, model justification
and requested sandbox. The options are one-shot; there is no implicit "always allow".

## WebSocket messages

| Direction | Type | Purpose |
|---|---|---|
| app → daemon | `hello` | Token authentication |
| daemon → app | `hello_ok` | Host info + sessions |
| app → daemon | `list_sessions` | Refresh session list |
| app → daemon | `subscribe` | Attach to a session |
| daemon → app | `snapshot` | Session, events, approvals, config |
| app → daemon | `create_session` | Create a session at `cwd` with `runtime` |
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

## Runtime adapters

### DSH

`agentd` writes a small patch file under `~/.agent-remote` that selects the provider and
default model, then starts `dsh --profile acp --patch ~/.agent-remote/dsh-acp.patch.yml`
when a DSH session is created.

`DSH_PERMISSION_MODE` is forced to `workspace-write` so an inherited
`danger-full-access` from the parent shell cannot silently auto-approve tool calls.
The daemon uses the user's `~/.dsh` login and `$HOME` as the default allowed root.

### Codex

`codex app-server --listen stdio://` is started lazily. The adapter calls `initialize`,
`model/list`, `thread/start`, `turn/start`, and `turn/interrupt`, maps
`item/agentMessage/delta` and tool/command items to the normalized events, and parks
approval server requests until the app answers. Codex uses the user's `~/.codex` login
and configuration (including custom providers).

### Claude

The adapter uses `@anthropic-ai/claude-agent-sdk`'s `query()` per turn, resuming with
the Claude session id. `includePartialMessages` supplies text/thinking deltas;
`canUseTool` supplies approvals; `result` supplies usage and turn completion. It uses
the Claude Code login (`~/.claude`) or `ANTHROPIC_API_KEY`. If neither is present, the
session shows a login error without stopping the daemon.

## Security boundaries

- The daemon is not a sandbox. It runs with the host user's permissions on macOS,
  Windows, or Linux.
- The bearer token is the only application-level authentication.
- The transport is `ws://` on a trusted LAN or Tailscale. There is no application-layer
  E2E envelope or relay yet.
- Approval decisions are one-shot and scoped to a tool call.
- The iOS app stores the token in Keychain; the Android app stores it in
  Keystore-encrypted preferences; the daemon stores it in `~/.agent-remote/token`
  with user-only permissions.

## Cross-platform host

`agentd` uses Node's path/home APIs with Windows normalization (case-insensitive root
checks, `~\` and `%VAR%` expansion), `where`/`which` discovery, and `cross-spawn` so
npm-installed `.cmd` shims (Codex, DSH) launch correctly. LAN address selection prefers
Wi-Fi/Ethernet over WSL/Hyper-V/VirtualBox adapters and prints every candidate URL at
startup. Codex's Windows sandbox is allowed to fall back to the CLI's platform default
when a release rejects `workspace-write`.

## Android client

`android/app` is a Kotlin + Jetpack Compose implementation of the same protocol:
`OkHttp` WebSocket, `org.json` models, `EncryptedSharedPreferences` for the token, and
ZXing for QR pairing. It mirrors the clean iOS screens (sessions, new session, timeline,
approval card, settings). Debug builds are debuggable and signed with the standard
Android debug key.

## Adding another runtime

The app talks only to the normalized `agentd` protocol. A new runtime is an adapter in
`agentd/src/<runtime>` that implements `RuntimeAdapter`:

- `start` / `dispose`
- `newSession`, `resumeSession`, `closeSession`
- `prompt`, `cancel`, `setModel`
- `snapshot`, `listSessions`, `getSession`, `resolveApproval`
- `session`, `event`, `approval`, `approval_resolved` and `config` events

The runtime manager and iOS client do not need to change for a new adapter as long as
it preserves the same session/event/approval shape.
