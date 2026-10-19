# Install on iPhone

## Build the IPA

```bash
cd ios
xcodegen generate
cd ..
./scripts/build-ipa.sh
# build/ipa/AgentRemote.ipa
```

The IPA is **unsigned**. Sideloadly or AltStore signs it with your Apple ID.

If you fork the project, change `PRODUCT_BUNDLE_IDENTIFIER` in `ios/project.yml` to a
bundle identifier your team owns. The default is `com.4uthent.agentremote`.

## Option A — Sideloadly

1. Install [Sideloadly](https://sideloadly.io/) on the Mac.
2. Connect the iPhone by USB, unlock it, and choose **Trust This Computer**.
   Once paired, Sideloadly can also use Wi-Fi.
3. Enable **Settings → Privacy & Security → Developer Mode** on iOS 16+.
4. Drag `AgentRemote.ipa` into Sideloadly.
5. Enter your Apple ID. If 2FA is enabled, use an app-specific password.
6. Click **Start**.
7. On the iPhone, trust the developer profile under
   **Settings → General → VPN & Device Management**.

A free Apple ID signs for **7 days**. A paid Apple Developer Program membership signs
for **1 year** and is required for APNs/push later.

## Option B — AltStore

1. Install [AltServer](https://altstore.io/) on the Mac.
2. Use AltServer → **Install AltStore** → select the iPhone.
3. Sign in to AltStore on the iPhone.
4. AirDrop `AgentRemote.ipa` to the iPhone, or save it in Files.
5. AltStore → **My Apps** → **+** → select the IPA.
6. Keep AltServer running so AltStore can refresh the 7-day signature.

The app uses no special entitlements, so a free Apple ID works. Push notifications are
not part of this build.

## Runtime logins

The app can launch DeepSeek Harness, Codex, or Claude. Each runtime uses its own login:

```bash
dsh                      # DeepSeek Harness login (once)
codex login status       # should show ChatGPT
claude auth status       # should show loggedIn: true, or set ANTHROPIC_API_KEY
```

A missing login only affects that runtime; the session shows the error.

## Start agentd

On the Mac:

```bash
cd agentd
npm install
npm start
```

Keep the process running. It prints:

- a WebSocket URL (LAN IP)
- a bearer token
- a pairing QR code

`agentd` uses `~/.dsh` for the DeepSeek Harness login and writes its token and generated
ACP patch to `~/.agent-remote`.

## Pair

1. Open the app.
2. Tap **QR コードをスキャン** (Scan pairing QR).
3. Scan the QR printed by agentd.

Manual entry:

- **URL**: `ws://<Mac LAN IP>:8787/ws`
- **Token**: `cat ~/.agent-remote/token`

Do not use `127.0.0.1` on the iPhone; that is the phone itself.

For off-LAN use, install Tailscale on both devices and start agentd with the tailnet URL:

```bash
AGENT_REMOTE_PUBLIC_URL="ws://$(tailscale ip -4):8787/ws" npm start
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid token` | Re-scan the current QR, or compare with `cat ~/.agent-remote/token` |
| Cannot connect | Same Wi-Fi? macOS firewall allowing Node? iOS Local Network permission on? |
| `cwd` rejected | Use a directory under `$HOME` or add it to `AGENT_REMOTE_ROOTS` |
| Claude says `Not logged in` | Run `claude auth login`, or set `ANTHROPIC_API_KEY` |
| Codex says model not supported | Pick a model from the session model menu, or fix `~/.codex/config.toml` |
| App stops after 7 days | Re-sign with Sideloadly/AltStore; keep AltServer running |
| Sideloadly cannot see the iPhone | Unlock, trust the computer, enable Developer Mode |
| `iOS 27` install issue | Update Sideloadly/AltStore/Xcode; check device support |

## Security note

Do not expose `8787` to the public internet. Use Tailscale or an authenticated TLS
proxy. See [../SECURITY.md](../SECURITY.md).
