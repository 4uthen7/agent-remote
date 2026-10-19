import SwiftUI

struct CleanSettingsView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var appLock = AppLock.shared

    private var urlBinding: Binding<String> {
        Binding(get: { store.serverURL }, set: { store.serverURL = $0 })
    }

    private var tokenBinding: Binding<String> {
        Binding(get: { store.token }, set: { store.setToken($0) })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("接続先") {
                    TextField("WebSocket URL", text: urlBinding)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .font(.system(.subheadline, design: .monospaced))

                    SecureField("トークン", text: tokenBinding)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(.subheadline, design: .monospaced))
                }

                Section("ランタイム") {
                    Picker("デフォルト", selection: $store.selectedRuntime) {
                        Text("DeepSeek Harness").tag("dsh")
                        Text("Codex").tag("codex")
                        Text("Claude Code").tag("claude")
                    }
                }

                Section("状態") {
                    HStack {
                        Circle()
                            .fill(CleanText.connectionColor(store.connection))
                            .frame(width: 8, height: 8)
                        Text(CleanText.connection(store.connection))
                            .font(.subheadline)
                        Spacer()
                    }

                    if store.isConnected {
                        Button("切断", role: .destructive) {
                            store.disconnect()
                            dismiss()
                        }
                    } else {
                        Button("接続") {
                            store.connect()
                        }
                        .disabled(store.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

                if let host = store.host {
                    Section("ホスト") {
                        CleanInfoRow(label: "名前", value: host.name)
                        CleanInfoRow(label: "バージョン", value: host.version)
                        CleanInfoRow(label: "プラットフォーム", value: host.platform)
                    }
                }

                Section {
                    NavigationLink {
                        AppLockSettingsView(lock: appLock)
                    } label: {
                        Label("アプリロック", systemImage: "lock.shield")
                    }
                    Text("トークンは iOS の Keychain に保存されます。LAN 外から使う場合は、PC と iPhone の両方を Tailscale に接続し、tailnet の URL を使ってください。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } header: {
                    Text("セキュリティ")
                }

                Section("このアプリ") {
                    CleanInfoRow(label: "バージョン", value: CleanConfig.version)
                    CleanInfoRow(label: "ランタイム", value: "DeepSeek Harness / ACP")
                    CleanInfoRow(label: "配布", value: "AltStore / Sideloadly")
                }
            }
            .navigationTitle("設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完了") { dismiss() }
                }
            }
        }
    }
}
