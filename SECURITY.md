# Security

## Reporting a vulnerability

Please do not open a public issue for a token leak, authentication bypass, command
execution path, or approval-spoofing finding. Use GitHub's **Security → Report a
vulnerability** flow for this repository, or contact the maintainer privately.

Include the affected version/commit, the platform, and a minimal reproduction. Do not
include a live bearer token or private source code in the report.

## Threat model

`agentd` is a remote-control bridge for coding agents (DeepSeek Harness, Codex, or
Claude) running with your host user's permissions on macOS, Windows, or Linux. It is
**not** a sandbox and it is not hardened to be exposed directly to the public internet.

On Windows, allow agentd only on **Private** networks and keep the bearer token in
`%USERPROFILE%\.agent-remote\token`. Use Tailscale for off-LAN access instead of exposing
TCP 8787 to the internet.

The optional app lock gates the UI on launch and after backgrounding. It accepts device
biometrics or an app-specific password; the password is stored only as a salted
PBKDF2-HMAC-SHA256 hash (120,000 iterations), in iOS Keychain or Android app-private
preferences. It does not change the WebSocket token's Keychain/Keystore storage.
There is no password recovery; uninstalling the app clears the lock and local token.

On startup agentd reads local Codex/Claude/DSH history stores to import conversations.
That read is local; it is uploaded only when relay/folder sync is configured.

Session archives under `AGENT_REMOTE_SYNC_DIR` contain prompts, tool output and directory
paths. If that directory is cloud-synced, protect it with the cloud account. Relay sync
encrypts the archive with AES-256-GCM before upload; the relay stores only ciphertext and
authenticates clients with `AGENT_REMOTE_SYNC_TOKEN`. The room key
(`AGENT_REMOTE_SYNC_KEY`) is separate and must never be committed. Anyone with both the
relay token and the room key can read the shared archive.

The desktop host bundles its own Node runtime and agentd. It stores the bearer token in
`~/.agent-remote/token` with mode `0600`. The desktop UI shows the token in the QR;
treat the screen and QR as secrets. Unsigned macOS/Windows builds may require an
explicit first-run confirmation.

The Android client is distributed as a **debug build** for sideloading and inspection.
It stores the bearer token with Android Keystore-encrypted preferences and permits
cleartext `ws://` for LAN/Tailscale development. Do not treat the debug APK as a
hardened store build.

Assets:

- the bearer token
- the DSH login and `~/.dsh`
- the files the agent can read/write
- approval decisions
- session archives, the relay token, and the room encryption key

Trust boundaries:

- The iPhone and the Mac are trusted devices.
- The LAN or Tailscale tailnet is the network boundary.
- The agent's tool calls are untrusted until approved.

## Deployment guidance

- Keep `agentd` on `0.0.0.0:8787` only on a trusted LAN, or bind `127.0.0.1` behind an
  authenticated TLS proxy.
- Prefer Tailscale for off-LAN access. Do not port-forward 8787.
- Treat the pairing QR and token as secrets. Rotate by deleting
  `~/.agent-remote/token` and restarting `agentd`.
- Keep the iOS token in Keychain; do not paste it into screenshots or issues.
- Put the sync relay behind HTTPS, require `AGENT_REMOTE_SYNC_TOKEN`, and share the room
  key only with people who should read the archive.
- Review approvals, especially `danger-full-access`, as carefully as a terminal command.
- The app transport is `ws://`; use Tailscale or a TLS proxy for off-LAN access. The
  optional sync relay encrypts its archive at rest and in transit when served over HTTPS,
  but it is not a replacement for transport security.

## Out of scope

- Attacks that require an already-compromised Mac or iPhone
- Malicious modifications to the DSH binary or the user's shell
- Denial of service against the local machine
