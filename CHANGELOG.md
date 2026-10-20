# Changelog

## v1.1.1 — 2026-10-20

- **Full DSH transcripts**: agentd now reads the authoritative
  `~/.dsh/sessions/**/session.vN.jsonl(.zstd)` log, decoding every zstd frame,
  so history and live chat show complete user/assistant text and tool calls
  instead of the truncated projection-cache outline.
- **Markdown on iOS**: assistant replies render headings, bold and inline code,
  bullet/numbered lists, quotes, tables and fenced code blocks, each code block
  with a copy button.
- iOS **0.4.4**, Desktop **1.0.6**, agentd **0.6.1**.

## v1.1.0 — 2026-10-20

- **Desktop 1.0.4 — same visual language as the phone app**: the neon dark
  dashboard is replaced by a neutral paper/ink layout with hairline rules,
  monospaced labels, underlined tabs, dot status and a flat QR frame. Light and
  dark schemes share one palette.
- **Tailscale-aware desktop host**: when Tailscale is present, the desktop app
  runs `tailscale serve --https=8443` and publishes `wss://<host>:8443/ws`, so
  the QR works on iOS (ATS rejects `ws://`). Without Tailscale it falls back to
  the LAN `ws://` URL.
- **Integer session timestamps**: `agentd` now rounds `createdAt`/`updatedAt`
  for every listed session, so strict Int decoders no longer fail `hello_ok`.
- iOS **0.4.3** (unchanged), agentd **0.6.1**, Desktop **1.0.5**.

All notable changes are published as Git tags and GitHub Releases.
The format follows a simple semantic versioning scheme; app and daemon versions can differ
within one release.

## v1.0.2 — 2026-10-19

- **Mobile reconnect**: when the WebSocket drops (network switch, Tailscale reconnect,
  laptop sleep), iOS/Android keep the current project/chat, reconnect with backoff, and
  re-subscribe to the session instead of returning to the connect screen.
- Composer is disabled while reconnecting; history remains visible.
- Native Codex/Claude/DSH history import from v1.0.1 is included in the host update.
- Off-LAN use still requires Tailscale or another reachable endpoint; LAN URLs cannot be
  used over cellular.
- iOS **0.4.1**, Android **0.5.1**, agentd **0.6.1**.

## v1.0.1 — 2026-10-19

- **Native history import**: on startup agentd imports existing Codex threads, Claude
  Code transcripts, and DSH turn outlines into the archive. The phone app now shows
  conversations that were created outside Agent Remote.
- Native imports are local by default; cross-host relay/folder sync remains opt-in.
- **Desktop 1.0.1**: shared `~/.agent-remote/sessions` archive, native import, and a
  Sessions tab with project list, history, approvals, model selection and resume.
- agentd **0.6.1**; iOS **0.4.0** and Android **0.5.0** unchanged.

## v1.0.0 — 2026-10-19

- **Agent Remote Desktop** for Windows and macOS. Electron + bundled agentd and
  production dependencies; the target PC needs no Node.js/npm.
- Detects DSH, Codex and Claude Code (plus Cursor, VS Code, Windsurf, Aider, Gemini CLI
  and OpenCode for inventory), starts the host, and shows the pairing QR.
- Optional port/interface/allowed-folder settings and encrypted relay sync.
- Phone apps are unchanged and protocol-compatible (iOS 0.4.0 / Android 0.5.0).
- agentd **0.6.0** unchanged.
- Desktop builds are unsigned; Windows x64 and macOS arm64 artifacts.

## v0.7.0 — 2026-10-19

- **Encrypted relay sync**: `npm run sync-server` serves room-scoped archives as
  AES-256-GCM ciphertext. agentd pulls and merges them with `AGENT_REMOTE_SYNC_URL`,
  `_ROOM`, `_KEY` and `_TOKEN`.
- GitHub installers get the same feature; joining the same room requires the private
  room key and relay token, which are never committed.
- Cross-host archives remain read-only; native resume stays on the owning host.
- agentd **0.6.0**; iOS **0.4.0** and Android **0.5.0** unchanged.

## v0.6.0 — 2026-10-19

- **Durable session archive**: agentd persists summaries, native runtime ids, config and
  timeline under `AGENT_REMOTE_SYNC_DIR`; restarts no longer erase conversations.
- **Projects and resume**: both apps group sessions by working directory, show ended
  sessions with their last message, and resume the native DSH/Codex/Claude session with
  its timeline restored.
- **Pseudo cloud sync**: point the sync directory at iCloud Drive / Dropbox / OneDrive to
  share archives between hosts. History from another host is read-only until you connect
  to the owning host.
- agentd **0.5.0**, iOS **0.4.0**, Android **0.5.0**.

## v0.5.0 — 2026-10-19

- **App lock on both clients**: Face ID / Touch ID / Optic ID (iOS), fingerprint/face
  (Android), with an app-specific password fallback.
- Locks automatically on launch and when returning from the background; enable it in
  **Settings → App lock**.
- Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes (120,000 iterations);
  iOS uses Keychain, Android stores only the hash in app-private preferences.
- iOS **0.3.0**, Android **0.4.0**, agentd **0.4.0** (unchanged).

## v0.4.0 — 2026-10-19

- **Windows host support**: agentd now runs natively on Windows 10 1809+/11 with
  `where`-based CLI discovery, `cross-spawn` for `.cmd`/`.exe` launch, Windows path
  normalization and Windows-aware LAN address selection.
- **All host/client combinations**: macOS/Windows/Linux host × iPhone/Android client.
- **Cross-platform CI**: `windows-latest`, `macos-latest` and `ubuntu-latest` run typecheck
  and a real agentd startup/health smoke test; Android and iOS builds are also checked.
- **Windows docs**: native setup, firewall, host URLs, runtime logins and WSL2 fallback.
- Android **0.3.2** (PC/Mac/Windows-neutral setup guide) and iOS **0.2.2** (neutral host
  wording) accompany **agentd 0.4.0**.

## v0.3.1 — 2026-10-19

- Android progressive setup guide (`?` button), host URL/QR advice and progress-aware steps.
- Android 0.3.1.

## v0.3.0 — 2026-10-19

- Native Android Jetpack Compose client with the same protocol and clean Japanese UI.
- Android 0.3.0.

## v0.2.1 — 2026-10-19

- Black terminal app icon; clean public UI and unsigned IPA.
- iOS 0.2.1.

## v0.2.0 — 2026-10-19

- DSH / Codex / Claude runtime picker, per-runtime model menu, approvals, sessions.
- iOS 0.2.0.

## v0.1.0 — 2026-10-19

- Initial clean iOS client and agentd (DSH over ACP).
