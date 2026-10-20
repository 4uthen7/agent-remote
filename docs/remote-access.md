# Use it from your phone (no build required)

A non-developer guide to driving DSH / Codex / Claude Code on your PC from an
iPhone or Android phone. No same Wi-Fi required: traffic goes over Tailscale.

> Building from source is documented in the [README](../README.md#quick-start).

## What you need

- A macOS or Windows PC that stays on
- iPhone (iOS 17+) or Android (8+)
- A free Tailscale account, signed in on **both** devices
- An Apple ID for Sideloadly (iOS only)
- The Agent Remote IPA ([Releases](https://github.com/4uthen7/agent-remote/releases))

```
[PC] agentd (8787)
  └─ tailscale serve (https 8443)   ← TLS termination
        └─ Tailscale (WireGuard)
              └─ [Phone] Agent Remote
```

iOS blocks cleartext `ws://` through ATS, so always use **`wss://`**.

## 1. Install Tailscale

1. Install Tailscale on the PC and the phone, signing in with the **same account**.
2. In the admin console, enable **MagicDNS** and **HTTPS Certificates**.
3. Keep Tailscale **on** on the phone (VPN icon visible).

## 2. Start the host

### A. Desktop app (easiest)

1. Launch **Agent Remote Desktop** (agentd listens on 8787).
2. In a terminal, terminate TLS on the tailnet:

```sh
tailscale serve --bg --https=8443 8787
```

3. Find your tailnet host name:

```sh
tailscale status
# first column, e.g. 4uthentmacbook-pro
# full name: 4uthentmacbook-pro.tail48b96c.ts.net
```

4. Use this URL in the app:

```
wss://<host>.<tailnet>.ts.net:8443/ws
```

5. Read the token: `~/.agent-remote/token` (macOS/Linux) or
   `%USERPROFILE%\.agent-remote\token` (Windows).

> The desktop app's QR encodes a LAN `ws://` URL and will not work on iOS.
> Enter the `wss://` URL manually.

### B. From the CLI

Quit the desktop app first (it owns port 8787), then:

```sh
./scripts/start-tailscale.sh
```

This runs `tailscale serve --https=8443`, sets `AGENT_REMOTE_PUBLIC_URL` to the
`wss://` URL, and prints a pairing QR.

## 3. Install the iOS app (Sideloadly)

1. Install [Sideloadly](https://sideloadly.io/) on the PC.
2. Connect the iPhone over USB.
3. Drag the IPA into Sideloadly, enter your Apple ID, press **Start**.
4. On the iPhone: **Settings → General → VPN & Device Management → Trust**.
5. Open **Agent Remote**.

A free Apple ID signature expires after **7 days**; re-sign with Sideloadly when
that happens. Reinstalling over the same bundle ID keeps your settings.

## 4. Pair

- **QR** (CLI path): scan the QR printed by `start-tailscale.sh` from the app.
- **Manual** (desktop path): enter the `wss://` URL and the token.
- Press **接続テスト (connection test)** first: `HTTP 200` means the host is
  reachable; `失敗: …` shows the network error.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `App Transport Security …` | `ws://` URL | Use `wss://` |
| "Host unreachable" | Tailscale off / wrong account / PC asleep | Turn Tailscale on, check the account, wake the PC |
| "Invalid token" | Token rotated | Rescan the QR or re-read the token file |
| Stuck on "接続しています" and retrying | App older than **0.4.3** | Update the IPA (fractional timestamp decode bug) |
| App stops opening after 7 days | Free signing expired | Re-sign with Sideloadly |
| Cellular only fails | Per-app cellular disabled | Settings → Cellular → Agent Remote → on |
| Drops after a few minutes | PC sleeps | Run with `caffeinate -dimsu` or disable sleep |

## Security

- The token is a password. Never share the QR image or the token.
- `tailscale serve` exposes the host to **your tailnet only**. Do not use
  `tailscale funnel`.
- Lost phone: delete `~/.agent-remote/token`, restart agentd, remove the device
  from the Tailscale admin console, and clear the token in the app.

## Limitations

- Both devices currently need Tailscale (relay + E2E is on the roadmap).
- No push notifications yet; the app syncs when opened.
- The desktop app's QR still uses `ws://`; Tailscale integration is planned.
