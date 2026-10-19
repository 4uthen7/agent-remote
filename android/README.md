# Agent Remote for Android

Native **Kotlin + Jetpack Compose** client for the same `agentd` protocol as the iOS
app. The UI follows the clean iOS design: grouped cards, large titles, Japanese labels,
blue accent, chat timeline, model menu and one-shot approval cards.

## Features

- DeepSeek Harness, Codex, and Claude Code runtime picker
- Session list, create, subscribe, close
- Streaming assistant text, thinking, tool calls and command output
- One-shot approvals with command, working directory and justification
- Per-runtime model menu, cancel, context usage ring
- QR pairing and manual URL + token
- **Setup guide** (? button, top-left) with advice that changes with progress
- Token stored with Android Keystore (`EncryptedSharedPreferences`)
- Debug build: debuggable, signed with the standard Android debug key

## Build

Requirements: JDK 17, Android SDK platform 35, build-tools 35.

```bash
./gradlew assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

If the SDK is not at `ANDROID_HOME`, create `local.properties`:

```properties
sdk.dir=/path/to/Android/sdk
```

Install on a device:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The APK is a **debug** build, so it is debuggable and does not need store signing.
For an emulator, the host PC (macOS or Windows) is reachable at `ws://10.0.2.2:8787/ws`; on a phone use
the LAN or Tailscale address printed by `agentd`.

## Pairing and host URL

The easiest path is to scan the QR code in the `agentd` terminal. It fills both the
host URL and token automatically.

If you enter the URL manually, use the `WebSocket:` line printed by `agentd`:

| Situation | Host URL |
|---|---|
| Phone on the same Wi-Fi | `ws://<host LAN IP>:8787/ws` (e.g. `ws://192.168.1.10:8787/ws`) |
| Tailscale | `ws://<tailscale IP>:8787/ws` |
| Android emulator | `ws://10.0.2.2:8787/ws` |

Do **not** use `127.0.0.1` or `localhost` on a phone: that points at the phone itself.
The token is the `Token:` line, or `~/.agent-remote/token` on the host
(macOS/Linux: `cat ~/.agent-remote/token`; Windows: `Get-Content $HOME\.agent-remote\token`).

The `?` button at the top-left opens a setup guide. Its advice follows your progress:
start agentd → scan QR / enter host → enter token → connect → create a session →
approve or troubleshoot.

## Runtime logins

```bash
dsh
codex login status
claude auth status    # or export ANTHROPIC_API_KEY
```

A runtime that is not logged in only affects its own session.

## Security

- The token is stored in Android Keystore, not in source or the APK.
- Cleartext `ws://` is allowed for LAN/Tailscale development. Do not expose port 8787
  directly to the public internet; use Tailscale or a TLS proxy.
- Approvals are one-shot. `danger-full-access` is shown explicitly.
- This is a debug build for development, not a hardened store release.

## Package

`dev.fouruthent.agentremote` — this is separate from the iOS bundle ID, so both can be
installed side by side.
