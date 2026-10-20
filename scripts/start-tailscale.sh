#!/usr/bin/env bash
# Start agentd with a Tailscale-reachable WSS URL, so the printed QR works from
# outside the LAN (phone on cellular, both devices on the same tailnet).
#
#   ./scripts/start-tailscale.sh
#   AGENT_REMOTE_PORT=8787 AGENT_REMOTE_TAILSCALE_HTTPS_PORT=8443 ./scripts/start-tailscale.sh
set -euo pipefail

PORT="${AGENT_REMOTE_PORT:-8787}"
HTTPS_PORT="${AGENT_REMOTE_TAILSCALE_HTTPS_PORT:-8443}"
TS="${TAILSCALE_BIN:-}"
if [ -z "$TS" ]; then
  TS="$(command -v tailscale || true)"
fi
if [ -z "$TS" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
  TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
fi
if [ -z "$TS" ] || ! "$TS" status >/dev/null 2>&1; then
  echo "Tailscale が見つからないか、ログインしていません。" >&2
  echo "Tailscale を入れて同じ tailnet にログインしてから再実行してください。" >&2
  exit 1
fi

DNS="$("$TS" status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"

# iOS blocks cleartext ws:// (ATS), so expose agentd over TLS on the tailnet.
"$TS" serve --bg --https="${HTTPS_PORT}" "${PORT}" >/dev/null
export AGENT_REMOTE_PUBLIC_URL="wss://${DNS}:${HTTPS_PORT}/ws"

echo "==> Tailscale URL: ${AGENT_REMOTE_PUBLIC_URL}"
echo "    スマホ側も Tailscale を ON にして、この URL の QR をスキャンしてください。"
cd "$(dirname "$0")/../agentd"
exec npm start
