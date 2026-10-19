# Agent Remote

**日本語** | [English](README.md)

[![Release](https://img.shields.io/github/v/release/4uthen7/agent-remote?display_name=tag)](https://github.com/4uthen7/agent-remote/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/iOS-17%2B-black)](https://developer.apple.com/ios/)
[![Node](https://img.shields.io/badge/Node-22%2B-339933)](https://nodejs.org/)

Mac 上で動くコーディングエージェントを、iPhone から操作するためのネイティブアプリです。
iPhone は Node 製の小さなデーモン `agentd` にトークン認証付き WebSocket で接続し、
エージェントの出力をリアルタイムで表示しながら、サンドボックス昇格の承認を
スマートフォンから行えます。

公開しているアプリは **日本語のクリーンなネイティブ UI** です。以前のサイバー調・3D の
実験 UI はこのリポジトリには含まれていません。

| セッション | タイムライン |
|---|---|
| ![Sessions](docs/screenshots/clean-sessions.png) | ![Timeline](docs/screenshots/clean-timeline.png) |

| 接続 | 承認 |
|---|---|
| ![Connect](docs/screenshots/clean-connect.png) | ![Approval](docs/screenshots/clean-approval.png) |

## 機能

- **セッション操作** — DeepSeek Harness のセッション一覧、作成、再開、終了
- **リアルタイム出力** — アシスタントの文章、思考、ツール呼び出し、コマンド出力、コンテキスト使用率
- **ワンタップ承認** — 実行コマンド、作業ディレクトリ、理由、`danger-full-access` 昇格を確認して一度だけ許可
- **モデル切替** — セッション画面から DSH のモデルを変更
- **ネイティブ iOS UI** — SwiftUI、grouped list、Large Title、SF Symbols、システムのライト/ダーク、日本語ラベル
- **安全なペアリング** — QR コードまたは URL + トークン。トークンは iOS の Keychain に保存
- **LAN / Tailscale** — Mac 側に inbound ポートを開けずに、tailnet 経由で外部から接続

## 構成

```
┌────────────────────┐        WebSocket (token)        ┌────────────────────┐
│ iPhone             │◀───────────────────────────────▶│ agentd             │
│ SwiftUI            │                                 │ Node + TypeScript  │
└────────────────────┘                                 └─────────┬──────────┘
                                                                 │ stdio JSON-RPC
                                                       ┌─────────▼──────────┐
                                                       │ dsh acp            │
                                                       │ DeepSeek Harness   │
                                                       └────────────────────┘
```

`agentd` が生成した **ACP** プロファイルで `dsh` を起動し、クライアントに依存しない
upstream プロセスとして維持します。iPhone アプリが DSH に直接接続することはありません。

メッセージフローと承認の相関処理は [docs/architecture.md](docs/architecture.md) を参照してください。

## 必要なもの

- macOS にインストール・ログイン済みの [DeepSeek Harness](https://github.com/deepseek-ai)
- Node.js 22 以上（開発は Node 24）
- Xcode 26 以上と [XcodeGen](https://github.com/yonaskolb/XcodeGen)
- Mac と同じ LAN、または両方を Tailscale に接続した iPhone

DSH `0.2.1-rc.2` / macOS で動作確認しています。

## クイックスタート

### 1. agentd を起動

```bash
cd agentd
npm install
npm start
```

WebSocket URL、トークン、ペアリング QR が表示されます。プロセスは起動したままにします。

- DSH のログインは `~/.dsh`
- 生成される ACP パッチとトークンは `~/.agent-remote`
- 権限モードは **workspace-write**。サンドボックス昇格は必ず iPhone に承認要求が届きます

### 2. iOS アプリをビルド

```bash
cd ios
xcodegen generate
open AgentRemote.xcodeproj
```

Team を設定し、必要なら Bundle ID を変更して実機で実行します。Sideloadly / AltStore 用の
署名なし IPA を作る場合:

```bash
cd ..
./scripts/build-ipa.sh
# build/ipa/AgentRemote.ipa
```

IPA は署名されていません。Sideloadly または AltStore が Apple ID で再署名します。
詳細は [docs/install.ja.md](docs/install.ja.md)。

### 3. ペアリング

アプリで **QR コードをスキャン** を開き、agentd のターミナルに出ている QR を読み取ります。
手入力する場合:

- URL: agentd が表示する LAN URL（例 `ws://192.168.1.10:8787/ws`）
- トークン: `cat ~/.agent-remote/token`

iPhone から見た `127.0.0.1` は iPhone 自身なので使えません。
LAN 外から使う場合は、Mac と iPhone の両方を Tailscale に入れ、tailnet の IP を使います:

```bash
AGENT_REMOTE_PUBLIC_URL="ws://$(tailscale ip -4):8787/ws" npm start
```

## セキュリティ

- `agentd` はすべての WebSocket 接続を bearer token で認証します
- トークンは iOS Keychain（`AfterFirstUnlockThisDeviceOnly`）に保存されます
- 承認は **一度だけ** 有効で、実際に要求したツール呼び出し・コマンドに紐づきます。
  `danger-full-access` は明示表示され、自動承認されません
- `agentd` はデフォルトで `0.0.0.0:8787` をリッスンします。インターネットに直接公開せず、
  Tailscale または認証付き TLS プロキシ経由で使用してください
- 現在の LAN 内 transport は `ws://` です。アプリ層の E2E と relay はロードマップにあります。
  `NSAllowsArbitraryLoads` はローカル開発用で、広く配布する前に `wss://` へ移行してください
- `agentd` は macOS ユーザーの権限で動きます。承認内容はターミナルで実行する場合と
  同じ強さで確認してください

脅威モデルと脆弱性の報告方法は [SECURITY.md](SECURITY.md) を参照してください。

## 設定

| 変数 | デフォルト | 用途 |
|---|---|---|
| `AGENT_REMOTE_PORT` | `8787` | WebSocket / HTTP ポート |
| `AGENT_REMOTE_BIND` | `0.0.0.0` | bind アドレス。プロキシ背後なら `127.0.0.1` |
| `AGENT_REMOTE_HOME` | `~/.agent-remote` | トークンと生成 ACP パッチ |
| `AGENT_REMOTE_TOKEN` | 自動生成 | 固定 bearer token |
| `AGENT_REMOTE_ROOTS` | `$HOME` | 許可する作業ディレクトリ（`:` 区切り） |
| `AGENT_REMOTE_PUBLIC_URL` | LAN URL | QR に埋め込む URL |
| `DSH_HOME` | `~/.dsh` | DeepSeek Harness の home |
| `AGENT_REMOTE_DSH_PROFILE` | `acp` | DSH プロファイル名 |
| `DSH_PROVIDER` | `deepseek-account` | DSH プロバイダ |
| `DSH_MODEL` | `deepseek-flash` | デフォルトモデル |
| `DSH_BIN` / `DSH_APP_PATH` | 自動 | DSH ランタイムの明示指定 |

## 開発

DSH を起動せずに UI を確認できるモックデーモン:

```bash
cd agentd
node test/mock-server.mjs
# ws://127.0.0.1:8788/ws, token "demo"
```

シミュレータでは `AGENT_REMOTE_URL=ws://127.0.0.1:8788/ws`、
`AGENT_REMOTE_TOKEN=demo` を環境変数で渡すか、アプリ内で入力します。

実 DSH に接続した状態での smoke test:

```bash
cd agentd
node test/smoke.mjs
```

セッション作成、prompt、モデル切替、一時ファイルを書き込むコマンドの承認までを確認します。

## ステータス / ロードマップ

- [x] DSH ACP アダプタ、ストリーミング、承認、モデル切替、resume
- [x] ネイティブ iOS クライアント、QR ペアリング、Keychain、Tailscale 対応
- [x] 日本語クリーン UI、署名なし IPA
- [ ] Codex `app-server` アダプタ
- [ ] Claude Agent SDK アダプタ
- [ ] アプリ層 E2E + relay
- [ ] APNs プッシュ通知
- [ ] アプリアイコン / App Store 向け hardening

## リポジトリ構成

```
agentd/                 Node デーモン（WebSocket + DSH ACP）
ios/                    SwiftUI アプリ（XcodeGen）
  AgentRemote/          クリーン UI + 共有クライアント
scripts/build-ipa.sh    署名なし実機 IPA
docs/                   インストール、構成、スクリーンショット
```

## ライセンス

MIT — [LICENSE](LICENSE) を参照してください。
