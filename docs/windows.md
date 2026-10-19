# Windows host setup

`agentd` runs natively on Windows 10 1809+ and Windows 11. The iPhone and Android apps
connect to it exactly as they do to a Mac: QR code, or `ws://<Windows LAN IP>:8787/ws`
plus the token.

This is the **native Windows** path. A WSL2 fallback is at the end.

## 1. Install Node.js

Install Node.js 22.19+ (Node 24 LTS recommended) and Git for Windows:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Open a new PowerShell and check:

```powershell
node --version
npm --version
git --version
```

## 2. Install the agent CLIs you use

You do not need all three; install the ones you will select in the app.

### DeepSeek Harness (Windows x64 CLI)

```powershell
npm install -g @deepseek-ai/dsh
dsh --version
```

The first `dsh` run may ask you to sign in. The desktop DSH app is macOS-oriented; on
Windows agentd uses the CLI and the same `%USERPROFILE%\.dsh` home.

If `dsh` is not on PATH, set its absolute path:

```powershell
$env:DSH_BIN = "C:\Users\you\AppData\Roaming\npm\dsh.cmd"
```

### OpenAI Codex

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
codex login
```

Use a current Codex CLI. Codex app-server Windows support landed in September 2026; older
builds may fail with a server/daemon error. agentd starts `codex app-server` directly and
does not use the separate `codex remote-control` daemon.

### Claude Code

```powershell
irm https://claude.ai/install.ps1 | iex
claude auth login
```

Native Windows 10 1809+ is supported. Git for Windows is recommended so Claude can use its
Bash tool; without it Claude uses PowerShell. Native Windows sandboxing is limited compared
with macOS, so review approvals carefully.

## 3. Start agentd

```powershell
git clone https://github.com/4uthen7/agent-remote.git
cd agent-remote\agentd
npm ci
npm start
```

On the first start, Windows Defender Firewall asks for network access. Allow **Node.js**
on **Private networks**. If you miss the prompt, run this in an elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Agent Remote 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
```

agentd prints:

```text
WebSocket: ws://192.168.1.25:8787/ws
Host addresses (use one your phone can reach):
  Wi-Fi: ws://192.168.1.25:8787/ws
  Ethernet: ws://192.168.1.30:8787/ws
Token: ...
```

Find the Windows IPv4 address with:

```powershell
ipconfig
```

Use the address on the same network as the phone. If Windows has a WSL/Hyper-V virtual
adapter, do not use its `vEthernet` address — use Wi-Fi/Ethernet.

## 4. Connect iPhone or Android

- **iPhone/Android on the same Wi-Fi:** `ws://<Windows Wi-Fi IPv4>:8787/ws`
- **Android emulator on Windows:** `ws://10.0.2.2:8787/ws`
- **Tailscale:** install Tailscale on Windows and the phone; use `ws://<tailscale IPv4>:8787/ws`
- **QR:** scan the QR printed in the PowerShell window; it fills URL + token
- **Token:** the `Token:` line, or `Get-Content $HOME\.agent-remote\token`

Keep Windows' network profile set to **Private** for home/trusted networks. Do not expose
port 8787 to the public internet; use Tailscale or a TLS reverse proxy.

## WSL2 fallback

Use this only if a native CLI cannot run in your environment. Run agentd inside WSL2 and
forward the port to Windows.

Inside WSL (Ubuntu):

```bash
sudo apt update && sudo apt install -y nodejs npm
cd /path/to/agent-remote/agentd
npm ci
npm start
```

Find the WSL address:

```bash
hostname -I
```

In an elevated Windows PowerShell, forward a Windows port to WSL:

```powershell
$wsl = "<WSL IP from hostname -I>"
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8787 connectaddress=$wsl connectport=8787
New-NetFirewallRule -DisplayName "Agent Remote 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
```

Connect the phone to `ws://<Windows Wi-Fi IPv4>:8787/ws`. If the WSL IP changes after a
reboot, update the portproxy rule. Windows 11 mirrored networking may make the WSL service
reachable on `localhost`; the portproxy rule is the portable fallback.

## Troubleshooting

- **Health check on Windows:** open `http://127.0.0.1:8787/health` in a browser. From the
  phone, use `http://<Windows IP>:8787/health`.
- **`ECONNREFUSED` / timeout:** wrong IP, firewall profile is Public, agentd is not running,
  or the phone is on a different Wi-Fi/VLAN.
- **`127.0.0.1` from the phone:** that points at the phone itself. Use the Windows LAN or
  Tailscale address.
- **DSH not found:** `dsh --version` in the same terminal; otherwise set `DSH_BIN` to the
  absolute `dsh.cmd` path.
- **Codex app-server error:** update Codex; older Windows builds lack app-server support.
- **Claude Bash tool:** install Git for Windows, or set `CLAUDE_CODE_GIT_BASH_PATH` to
  `C:\Program Files\Git\bin\bash.exe`.
- **QR is hard to scan:** use the URL + token manually; the QR is only a convenience.

## Security

The bearer token is stored in `%USERPROFILE%\.agent-remote\token`. Anyone with the token
and network access can control agents with your Windows user's permissions. Keep it on a
trusted LAN or Tailscale, and use one-shot approvals for commands outside the workspace.
