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

The Android client is distributed as a **debug build** for sideloading and inspection.
It stores the bearer token with Android Keystore-encrypted preferences and permits
cleartext `ws://` for LAN/Tailscale development. Do not treat the debug APK as a
hardened store build.

Assets:

- the bearer token
- the DSH login and `~/.dsh`
- the files the agent can read/write
- approval decisions

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
- Review approvals, especially `danger-full-access`, as carefully as a terminal command.
- The current transport is `ws://`; application-level E2E and a relay are not implemented.
  Before broad distribution, move to `wss://` and remove `NSAllowsArbitraryLoads`.

## Out of scope

- Attacks that require an already-compromised Mac or iPhone
- Malicious modifications to the DSH binary or the user's shell
- Denial of service against the local machine
