# iPhone へのインストール

## IPA をビルド

```bash
cd ios
xcodegen generate
cd ..
./scripts/build-ipa.sh
# build/ipa/AgentRemote.ipa
```

IPA は **署名なし** です。Sideloadly または AltStore が Apple ID で再署名します。

fork して使う場合は `ios/project.yml` の `PRODUCT_BUNDLE_IDENTIFIER` を、自分の Team が
所有する Bundle ID に変更してください。デフォルトは `com.4uthent.agentremote` です。

## 方法 A — Sideloadly

1. Mac に [Sideloadly](https://sideloadly.io/) をインストール
2. iPhone を USB 接続し、ロック解除して「このコンピュータを信頼」
   （一度ペアリングすれば Wi-Fi でも署名できます）
3. iOS 16 以上は **設定 → プライバシーとセキュリティ → 開発者モード** を ON
4. `AgentRemote.ipa` を Sideloadly にドラッグ
5. Apple ID を入力（2FA 有効なら App-specific password）
6. **Start**
7. iPhone の **設定 → 一般 → VPN とデバイス管理** で開発者プロファイルを信頼

無料の Apple ID は **7日**、有料の Apple Developer Program は **1年** 署名が持ります。
APNs（プッシュ通知）は有料アカウントが必要です。

## 方法 B — AltStore

1. Mac に [AltServer](https://altstore.io/) をインストール
2. AltServer → **Install AltStore** → iPhone を選択
3. iPhone の AltStore に Apple ID でサインイン
4. `AgentRemote.ipa` を AirDrop かファイル App で iPhone に送る
5. AltStore → **My Apps** → **+** → IPA を選択
6. AltServer を起動したままにして、7日以内に自動更新させる

このアプリは特別な entitlement を使わないため、無料の Apple ID でもインストールできます。
このビルドにプッシュ通知は含まれていません。

## agentd を起動

Mac 側:

```bash
cd agentd
npm install
npm start
```

プロセスは起動したままにします。表示されるもの:

- WebSocket URL（LAN IP）
- bearer token
- ペアリング QR コード

`agentd` は DSH のログインに `~/.dsh` を使い、トークンと生成した ACP パッチを
`~/.agent-remote` に保存します。

## ペアリング

1. アプリを開く
2. **QR コードをスキャン** をタップ
3. agentd のターミナルに出ている QR を読み取る

手入力する場合:

- **URL**: `ws://<Mac の LAN IP>:8787/ws`
- **トークン**: `cat ~/.agent-remote/token`

iPhone から見た `127.0.0.1` は iPhone 自身なので使えません。

LAN 外から使う場合は、Mac と iPhone の両方を Tailscale に入れ、tailnet の URL で起動します:

```bash
AGENT_REMOTE_PUBLIC_URL="ws://$(tailscale ip -4):8787/ws" npm start
```

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `Invalid token` | 現在の QR を再スキャン。`cat ~/.agent-remote/token` と比較 |
| 接続できない | 同じ Wi-Fi か、macOS ファイアウォールが Node を許可しているか、iOS のローカルネットワーク許可を確認 |
| `cwd` が拒否される | `$HOME` 配下を指定するか、`AGENT_REMOTE_ROOTS` に追加 |
| 7日で起動しなくなる | Sideloadly / AltStore で再署名。AltStore は AltServer を起動したままにする |
| Sideloadly が iPhone を認識しない | ロック解除、コンピュータを信頼、開発者モードを確認 |
| iOS 27 でインストールできない | Sideloadly / AltStore / Xcode を更新し、対応状況を確認 |

## セキュリティ

`8787` をインターネットに直接公開しないでください。Tailscale か認証付き TLS プロキシを
使ってください。詳細は [../SECURITY.md](../SECURITY.md)。
