# Supported platforms

Agent Remote is split into a host daemon (`agentd`) and thin mobile clients. The clients
only need a WebSocket URL and token, so **the host OS and the phone OS are independent**.
All four common combinations are supported:

| Host | iPhone | Android |
|---|---|---|
| macOS 13+ | ✅ | ✅ |
| Windows 10 1809+ / Windows 11 | ✅ | ✅ |
| Linux (x64/arm64) | ✅ | ✅ |

The same pairing QR, URL + token, approvals, model menu and session protocol are used on
every combination. The iPhone app is not tied to a Mac, and the Android app is not tied
to macOS.

## Agent runtimes

| Runtime | macOS | Windows | Linux | Notes |
|---|---|---|---|---|
| DeepSeek Harness (DSH) | ✅ app or CLI | ✅ CLI (x64) | ✅ CLI | Windows uses the `dsh` CLI; the desktop app is macOS-oriented. |
| OpenAI Codex | ✅ | ✅ native | ✅ | Codex app-server gained Windows support in Sep 2026; use a current Codex CLI. Native Windows sandbox support varies, so agentd falls back to the CLI's platform default if needed. |
| Claude Code | ✅ | ✅ native | ✅ | Native Windows 10 1809+; Git for Windows is optional (PowerShell is used otherwise). |

The runtime CLIs are separate products. Install each one on the host and sign in there;
agentd starts them lazily when you create a session for that runtime.

## Host URL by combination

| Host / client | URL |
|---|---|
| iPhone or Android → macOS/Linux host | `ws://<host LAN IP>:8787/ws` or Tailscale IP |
| iPhone or Android → Windows host | `ws://<Windows LAN IP>:8787/ws` or Tailscale IP |
| Android emulator → any host | `ws://10.0.2.2:8787/ws` |

`agentd` prints every detected host address at startup. On Windows, allow Node.js on
**Private** networks when the firewall prompt appears (or add a rule for TCP 8787).

## Windows status

Windows support is implemented in **agentd 0.4.0**. CI runs on `windows-latest`:

- `npm ci`
- TypeScript typecheck
- a real agentd startup + HTTP health smoke test

CI does not sign in to DSH/Codex/Claude, so runtime end-to-end execution is verified on a
machine where those CLIs are installed and authenticated. The Windows-specific code paths
are `where`-based CLI discovery, `.cmd`/`.exe` launch through `cross-spawn`, Windows path
normalization, and Windows-aware LAN address selection.

See [windows.md](windows.md) for native Windows setup and the WSL2 fallback.

## Version matrix

| Release | agentd | iOS | Android | Highlights |
|---|---|---|---|---|
| v1.0.1 | 0.6.1 | 0.4.0 | 0.5.0 | Native CLI history import + desktop Sessions tab |
| v1.0.0 | 0.6.0 | 0.4.0 | 0.5.0 | Desktop host app (Windows/macOS, Node bundled, tool detection, QR) |
| v0.7.0 | 0.6.0 | 0.4.0 | 0.5.0 | Encrypted relay sync for shared session archives |
| v0.6.0 | 0.5.0 | 0.4.0 | 0.5.0 | Durable session history, project grouping, resume, pseudo cloud sync |
| v0.5.0 | 0.4.0 | 0.3.0 | 0.4.0 | Face ID / Touch ID / Android biometrics + app-password lock |
| v0.4.0 | 0.4.0 | 0.2.2 | 0.3.2 | Windows host support, all host/client combinations |
| v0.3.1 | 0.2.1 | 0.2.1 | 0.3.1 | Android progressive setup guide |
| v0.3.0 | 0.2.1 | 0.2.1 | 0.3.0 | Native Android client |
| v0.2.1 | 0.2.1 | 0.2.1 | — | App icon, clean public UI |
| v0.2.0 | 0.2.0 | 0.2.0 | — | DSH / Codex / Claude, models, approvals |

Each row is a Git tag and GitHub Release. See [CHANGELOG.md](../CHANGELOG.md).

## Requirements

- Host: macOS 13+, Windows 10 1809+, or Linux; Node.js 22.19+ (Node 24 recommended)
- Phone: iOS 17+ or Android 8+
- Network: same LAN, or both devices on Tailscale
- Runtime: at least one of DSH, Codex, Claude installed and logged in on the host
