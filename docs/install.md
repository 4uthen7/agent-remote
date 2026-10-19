# Install on iPhone

## Host OS

agentd runs on macOS, Windows, or Linux; the iPhone and Android clients are host-agnostic.
This page covers the iOS app and pairing. For Windows, use
[windows.md](windows.md) for Node, firewall, `dsh`/Codex/Claude and WSL2 details.

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

## Android debug APK

Download `AgentRemote-android-debug.apk` from the release, or build it:

```bash
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The APK is debuggable and signed with the standard Android debug key. It installs as
`dev.fouruthent.agentremote`, separate from the iOS bundle ID. On an emulator, the Mac
is `ws://10.0.2.2:8787/ws`; on a phone use the LAN/Tailscale address printed by agentd.
QR pairing and manual URL + token work the same as iOS. The token is encrypted with
Android Keystore.

Host URL for Android:

| Situation | URL |
|---|---|
| Phone on the same Wi-Fi | `ws://<host LAN IP>:8787/ws` |
| Tailscale | `ws://<tailscale IP>:8787/ws` |
| Android emulator | `ws://10.0.2.2:8787/ws` |

Do not use `127.0.0.1`/`localhost` on the phone. The easiest path is to scan the QR code
printed by agentd; it fills both fields. The `?` button at the top-left opens a setup
guide whose advice changes with your progress.

For a **Windows host**, allow Node.js on Private networks, then use the Windows Wi-Fi
IPv4 (for example `ws://192.168.1.25:8787/ws`). On an Android emulator running on Windows,
`ws://10.0.2.2:8787/ws` still points at the Windows host.

## Session history and resume

`agentd` saves session history under `AGENT_REMOTE_SYNC_DIR` (default
`~/.agent-remote/sessions`). On startup it also imports existing Codex/Claude/DSH history,
so conversations created outside Agent Remote appear in the phone app. Set
`AGENT_REMOTE_IMPORT_HISTORY=0` to disable that scan. Tapping a saved session loads its
timeline and **再開** resumes the runtime.

For a lightweight cloud sync, point that variable at a cloud-synced folder on every host
(iCloud Drive, Dropbox, OneDrive, etc.), or run the bundled encrypted relay:

```bash
# always-on host
AGENT_REMOTE_SYNC_TOKEN="server-token" npm run sync-server
# each agentd
AGENT_REMOTE_SYNC_URL="https://sync.example.com" \
AGENT_REMOTE_SYNC_ROOM="my-team" \
AGENT_REMOTE_SYNC_KEY="a-long-private-room-key" \
AGENT_REMOTE_SYNC_TOKEN="server-token" npm start
```

The relay stores AES-256-GCM ciphertext only. Share the room key privately; it is not in
the public repository. History from another host is readable but can only be resumed on
the host that owns the native runtime state.

## App lock

Both clients support an optional app lock in **Settings → App lock**:

- iOS: Face ID / Touch ID / Optic ID, or the app-specific password.
- Android: fingerprint/face, or the app-specific password.
- Locks on cold launch and when returning from the background.
- The password is at least 6 characters. There is no recovery; reinstalling clears it.
- The password is stored as a salted PBKDF2-HMAC-SHA256 hash, not plaintext.

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

- **URL**: `ws://<host LAN IP>:8787/ws`
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
