# Changelog

All notable changes are published as Git tags and GitHub Releases.
The format follows a simple semantic versioning scheme; app and daemon versions can differ
within one release.

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
