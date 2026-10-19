# Agent Remote Desktop

A self-contained host app for Windows and macOS. It bundles Electron's Node runtime,
`agentd` and its dependencies, detects the coding tools installed on the PC, starts the
WebSocket host, and shows the pairing QR. **The target PC does not need Node.js or npm.**

## What it does

- Starts `agentd` on a free port (8787 or the next free one) and shows a QR for the
  existing iOS/Android client.
- **Sessions tab** with project grouping, imported native history, approvals, model
  selection, and resume. The desktop app shares `~/.agent-remote/sessions` with the CLI.
- Detects **DeepSeek Harness, Codex and Claude Code** and passes their paths to agentd.
- Shows other detected coding CLIs (Cursor, VS Code, Windsurf, Aider, Gemini CLI,
  OpenCode) for inventory; only DSH/Codex/Claude are driven by the current agentd
  adapters.
- Lets you choose the LAN/Tailscale interface, port and allowed project folders.
- Optional encrypted relay sync (same settings as agentd).

Coding tools themselves are **not** silently installed or authenticated. Install each
tool normally and sign in once; the desktop app discovers it on restart/re-scan.

## Build

```bash
cd agentd && npm ci
cd ../desktop && npm ci
npm run dist:mac    # macOS arm64 dmg + zip
npm run dist:win:x64 # Windows x64 NSIS + portable exe
```

The build copies agentd's compiled output and production dependencies into
`desktop/resources/agentd`; the packaged app includes them in its resources.

- macOS builds are unsigned. Right-click → Open the first time, or sign/notarize for
  distribution.
- Windows builds are unsigned; SmartScreen may ask for confirmation.
- The macOS artifact is Apple Silicon. Windows artifacts are x64.

## Security

- The bearer token is generated at `app.getPath("userData")/token` with mode `0600` and
  is included in the QR.
- Do not share the QR or token.
- If the desktop app is exposed off-LAN, use Tailscale or a TLS proxy; the app itself
  serves `ws://` on the LAN.
- Do not commit `resources/agentd`, `release/`, tokens or relay room keys.
