# スマホから使う手順（ビルド不要）

PC 上のコーディングエージェント（DSH / Codex / Claude Code）を、外出先の iPhone / Android から
操作するための**一般ユーザー向け**手順です。開発環境の構築は不要です。

- 同じ Wi-Fi は不要（Tailscale 経由）
- 自宅の PC は起動したままにする
- 通信は Tailscale（WireGuard）で暗号化される

> 開発者向けのビルド手順は [README](../README.ja.md#クイックスタート) を参照してください。

---

## 必要なもの

| 用意するもの | 補足 |
|---|---|
| macOS / Windows の PC | agentd が動くマシン。macOS を推奨 |
| iPhone（iOS 17+）または Android（8+） | アプリを入れます |
| Tailscale アカウント（無料） | PC とスマホで**同じアカウント** |
| 署名用の Apple ID（iOS のみ） | Sideloadly で使います。無料で可 |
| Agent Remote の IPA | [Releases](https://github.com/4uthen7/agent-remote/releases) またはビルドしたもの |

---

## 全体像

```
[PC] agentd (8787)
  └─ tailscale serve (https 8443)  ← TLS 終端
        └─ Tailscale（WireGuard）
              └─ [スマホ] Agent Remote アプリ
```

iOS は `ws://`（平文）を ATS でブロックするため、**必ず `wss://`** を使います。

---

## 手順 1: Tailscale を入れる

1. PC とスマホに Tailscale をインストール
2. **同じアカウント**でログイン
3. 管理画面 → **DNS** → **MagicDNS** と **HTTPS Certificates** を ON
4. スマホの Tailscale は **ON のまま**にする（VPN アイコンが出ている状態）

---

## 手順 2: PC 側でホストを起動する

### A. デスクトップアプリを使う場合（かんたん）

1. **Agent Remote Desktop** を起動する（agentd が 8787 で起動します）
2. ターミナルで TLS 終端を有効にする

```sh
tailscale serve --bg --https=8443 8787
```

3. 自分の tailnet 名を確認する

```sh
tailscale status
# 1列目がホスト名（例: 4uthentmacbook-pro）
# 正式名は 4uthentmacbook-pro.tail48b96c.ts.net
```

4. アプリに入力する URL はこれです

```
wss://<ホスト名>.<tailnet名>.ts.net:8443/ws
```

5. トークンを確認する（macOS / Linux）

```sh
cat ~/.agent-remote/token
```

Windows は `%USERPROFILE%\.agent-remote\token` を開いてください。

> デスクトップアプリが表示する QR は LAN 用の `ws://` です。iOS では使えないため、
> アプリには上の `wss://` URL を**手入力**してください。

### B. コマンドで起動する場合

デスクトップアプリを**終了**してから（ポート 8787 の競合を避ける）、リポジトリで:

```sh
./scripts/start-tailscale.sh
```

- `tailscale serve --https=8443` を設定
- `wss://...:8443/ws` を `AGENT_REMOTE_PUBLIC_URL` に設定
- ペアリング用の QR を表示

別ポートで動かす場合:

```sh
AGENT_REMOTE_PORT=8788 AGENT_REMOTE_TAILSCALE_HTTPS_PORT=8444 ./scripts/start-tailscale.sh
```

---

## 手順 3: アプリを入れる（iOS / Sideloadly）

公開ビルドは署名されていません。Sideloadly で自分の Apple ID で署名して入れます。

1. PC に [Sideloadly](https://sideloadly.io/) をインストール
2. iPhone を USB 接続
3. Sideloadly に **IPA をドラッグ＆ドロップ**
4. Apple ID を入力して **Start**
5. iPhone: **設定 → 一般 → VPN とデバイス管理 → デベロッパを信頼**
6. ホーム画面の **Agent Remote** を起動

補足:

- 無料の Apple ID は **7 日で署名が切れます**。切れたら Sideloadly で入れ直してください
- 同じ bundle ID なので、上書き更新になります（設定とトークンは残ります）
- Android は APK をインストールするだけです

---

## 手順 4: ペアリングする

### QR を使う場合（手順 2-B）

`start-tailscale.sh` が表示した QR を、アプリの **「QR コードをスキャン」** で読み取ります。

### 手入力する場合（手順 2-A）

アプリの接続画面に以下を入力します。

- **URL**: `wss://<ホスト名>.<tailnet名>.ts.net:8443/ws`
- **トークン**: `~/.agent-remote/token` の内容

入力したら **「接続テスト（ホストに届くか）」** を押してください。
`HTTP 200 {...}` と出れば到達できています。そのまま **「接続」** を押します。

---

## 手順 5: 使う

- **セッション**: 一覧から選ぶ、または新規作成
- **承認**: ツール実行の許可は承認シートから（危険度とコマンドを確認してから Allow）
- **モデル**: セッション画面から切替
- **切断**: アプリを閉じても PC 側のセッションは継続します。次回起動時に自動で再接続します

---

## 困ったとき

| 症状 | 原因 | 対処 |
|---|---|---|
| `The resource could not be loaded because the App Transport Security…` | `ws://` を使っている | **`wss://` に変更**（手順 2） |
| 「ホストに到達できません」 | Tailscale が OFF / 別アカウント / PC がスリープ | Tailscale を ON、アカウントを確認、PC を起こす |
| 「Invalid token」 | トークンが変わった | QR を読み直す / `~/.agent-remote/token` を再確認 |
| ずっと「接続しています」→ 再試行ループ | **0.4.3 未満**のアプリ | 最新 IPA に入れ替える（小数タイムスタンプのデコード不具合） |
| 7 日でアプリが開けない | 無料署名の期限切れ | Sideloadly で再署名 |
| モバイル回線だけ繋がらない | アプリのモバイル通信が OFF | 設定 → モバイル通信 → Agent Remote を ON |
| 数分で切れる | PC がスリープ | `caffeinate -dimsu` で起動するか、電源設定でスリープを無効化 |

接続できないときは、まず **「接続テスト」** を押して結果を確認してください。
`HTTP 200` なら認証・URL の問題、`失敗: ...` ならネットワークの問題です。

---

## セキュリティ

- トークンは**パスワードと同じ**です。QR 画像やトークンを他人に送らないでください
- `tailscale serve` は **tailnet 内のみ**に公開されます。`tailscale funnel` は使わないでください
- 端末をなくしたら:
  1. `~/.agent-remote/token` を削除して agentd を再起動（新しいトークンになる）
  2. Tailscale の管理画面で該当端末を削除
  3. スマホ側でアプリのトークンを消去

---

## 制限

- 現状は **PC とスマホの両方に Tailscale が必要**です（リレー + E2E は roadmap）
- プッシュ通知は未対応です（アプリを開いたときに同期）
- デスクトップアプリの QR は LAN 用 `ws://` のままです（Tailscale 連動は今後）
