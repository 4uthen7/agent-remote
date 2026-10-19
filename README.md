# Agent Remote

[日本語](README.ja.md) | **English**

[![Release](https://img.shields.io/github/v/release/4uthen7/agent-remote?display_name=tag)](https://github.com/4uthen7/agent-remote/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/iOS-17%2B-black)](https://developer.apple.com/ios/)
[![Node](https://img.shields.io/badge/Node-22%2B-339933)](https://nodejs.org/)

A native iOS remote for coding agents running on your own Mac. The iPhone app pairs
with a small Node daemon (`agentd`) over a token-authenticated WebSocket, streams the
agent's output, and lets you approve sandbox escalations from your phone.

The public app uses the **clean native UI** with Japanese labels. The earlier
cyber/3D visual experiment is not part of this repository.

| Sessions | Timeline |
|---|---|
| ![Sessions](docs/screenshots/clean-sessions.png) | ![Timeline](docs/screenshots/clean-timeline.png) |

| Connect | Approval |
|---|---|
| ![Connect](docs/screenshots/clean-connect.png) | ![Approval](docs/screenshots/clean-approval.png) |

## Features

- **Session control** — list, create, resume and close DeepSeek Harness sessions.
- **Live output** — streamed assistant text, thinking, tool calls, command output and context usage.
- **One-tap approvals** — review the exact command, working directory, justification and
  `danger-full-access` escalation before allowing it once.
- **Model switching** — change the DSH model from the session screen.
- **Native iOS UI** — SwiftUI, grouped lists, large titles, SF Symbols, system light/dark,
  Japanese labels, and a chat layout that stays out of the way.
- **Secure pairing** — QR code or URL + bearer token; the token is stored in the iOS Keychain.
- **LAN or Tailscale** — no inbound ports on the Mac; put both devices on a tailnet for
  off-LAN use.

## Architecture

```
┌────────────────────┐        WebSocket (token)        ┌────────────────────┐
│ iPhone             │◀───────────────────────────────▶│ agentd             │
│ SwiftUI            │                                 │ Node + TypeScript  │
└────────────────────┘                                 └─────────┬──────────┘
                                                                 │ stdio JSON-RPC
                                                       ┌─────────▼──────────┐
                                                       │ dsh acp            │
                                                       │ DeepSeek Harness   │
                                                       └────────────────────┘
```

`agentd` starts `dsh` with the generated **ACP** profile, keeps the upstream process
independent of any one client, and exposes a small normalized protocol to the app.
The app never talks to DSH directly.

See [docs/architecture.md](docs/architecture.md) for the message flow and approval
correlation details.

## Requirements

- macOS with [DeepSeek Harness](https://github.com/deepseek-ai) installed and logged in
- Node.js 22+ (developed on Node 24)
- Xcode 26+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen) for the iOS app
- An iPhone on the same LAN as the Mac, or both devices on a Tailscale tailnet

Tested against DSH `0.2.1-rc.2` on macOS.

## Quick start

### 1. Run agentd

```bash
cd agentd
npm install
npm start
```

`agentd` prints a WebSocket URL, a bearer token and a pairing QR code. Keep it
running. It uses:

- `~/.dsh` for the DeepSeek Harness login
- `~/.agent-remote` for the generated ACP patch and token
- the **workspace-write** permission mode, so escalation requests still reach your phone

### 2. Build the iOS app

```bash
cd ios
xcodegen generate
open AgentRemote.xcodeproj
```

Select your team, set a unique bundle identifier if needed, and run on your iPhone.
For a sideloaded build:

```bash
cd ..
./scripts/build-ipa.sh
# build/ipa/AgentRemote.ipa
```

The IPA is unsigned; Sideloadly or AltStore signs it with your Apple ID. See
[docs/install.md](docs/install.md).

### 3. Pair

Open the app, tap **QR コードをスキャン** and scan the QR in the agentd terminal.
Manual pairing also works:

- URL: the LAN URL printed by agentd, e.g. `ws://192.168.1.10:8787/ws`
- Token: `cat ~/.agent-remote/token`

Do **not** use `127.0.0.1` on the iPhone — that points at the phone itself.
For off-LAN use, run both devices on Tailscale and use the tailnet IP:

```bash
AGENT_REMOTE_PUBLIC_URL="ws://$(tailscale ip -4):8787/ws" npm start
```

## Security model

- `agentd` authenticates every WebSocket connection with a bearer token.
- The token is stored in the iOS Keychain (`AfterFirstUnlockThisDeviceOnly`).
- Approvals are **one-shot** and correlated to the exact tool call and command that
  requested them. `danger-full-access` is shown explicitly and never auto-approved.
- The daemon binds `0.0.0.0:8787` by default so a phone on the LAN can reach it. Do not
  expose that port to the public internet; use Tailscale or an authenticated TLS proxy.
- The current transport is `ws://` on the LAN (or Tailscale). An application-level E2E
  envelope and relay are on the roadmap. `NSAllowsArbitraryLoads` is enabled for local
  development; move to `wss://` before shipping broadly.
- `agentd` runs with your macOS user's permissions. Review approvals as carefully as
  you would review a terminal command.

See [SECURITY.md](SECURITY.md) for the threat model and reporting instructions.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_REMOTE_PORT` | `8787` | WebSocket/HTTP port |
| `AGENT_REMOTE_BIND` | `0.0.0.0` | Bind address; use `127.0.0.1` behind a proxy |
| `AGENT_REMOTE_HOME` | `~/.agent-remote` | Token and generated ACP patch |
| `AGENT_REMOTE_TOKEN` | generated | Fixed bearer token |
| `AGENT_REMOTE_ROOTS` | `$HOME` | Allowed working directories (`:` separated) |
| `AGENT_REMOTE_PUBLIC_URL` | LAN URL | URL embedded in the pairing QR |
| `DSH_HOME` | `~/.dsh` | DeepSeek Harness home |
| `AGENT_REMOTE_DSH_PROFILE` | `acp` | DSH profile name |
| `DSH_PROVIDER` | `deepseek-account` | DSH provider |
| `DSH_MODEL` | `deepseek-flash` | Default model |
| `DSH_BIN` / `DSH_APP_PATH` | auto | Override the DSH runtime |

## Development

Run the mock daemon for UI work — it serves sample sessions, tool calls and a pending
approval without starting DSH:

```bash
cd agentd
node test/mock-server.mjs
# ws://127.0.0.1:8788/ws, token "demo"
```

Launch the simulator app with `AGENT_REMOTE_URL=ws://127.0.0.1:8788/ws` and
`AGENT_REMOTE_TOKEN=demo`, or enter the values in the app.

With a live `agentd` and DSH login, run the end-to-end smoke test:

```bash
cd agentd
node test/smoke.mjs
```

The smoke test creates a session, sends a prompt, exercises model switching and
approves one command that writes a temporary file.

## Status and roadmap

- [x] DSH ACP adapter, streaming, approvals, model switching, resume
- [x] Native iOS client, QR pairing, Keychain, Tailscale-ready transport
- [x] Clean Japanese UI, unsigned IPA packaging
- [ ] Codex `app-server` adapter
- [ ] Claude Agent SDK adapter
- [ ] Application-level E2E + relay
- [ ] APNs push notifications
- [ ] App icon and App Store hardening

## Repository layout

```
agentd/                 Node daemon (WebSocket + DSH ACP)
ios/                    SwiftUI app (XcodeGen)
  AgentRemote/          clean UI + shared client
scripts/build-ipa.sh    unsigned device IPA
docs/                   install, architecture, screenshots
```

## License

MIT — see [LICENSE](LICENSE).
