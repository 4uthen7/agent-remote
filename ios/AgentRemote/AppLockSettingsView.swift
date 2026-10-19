import SwiftUI

struct AppLockSettingsView: View {
    @ObservedObject var lock: AppLock
    @State private var showPasswordSheet = false
    @State private var showDisable = false

    var body: some View {
        Form {
            Section {
                if lock.isEnabled {
                    HStack {
                        Label("アプリロック", systemImage: "lock.shield")
                        Spacer()
                        Text("有効")
                            .foregroundStyle(.green)
                    }

                    Toggle("生体認証を使う", isOn: Binding(
                        get: { lock.biometricEnabled },
                        set: { lock.setBiometricEnabled($0) }
                    ))
                    .disabled(!lock.biometryAvailable)

                    if lock.biometryAvailable {
                        Text("\(lock.biometryName)で解除できます。生体認証が使えないときはアプリパスワードで解除します。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("この端末では生体認証を利用できません。アプリパスワードで解除します。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Button("アプリパスワードを変更") {
                        showPasswordSheet = true
                    }
                } else {
                    Button {
                        showPasswordSheet = true
                    } label: {
                        Label("アプリロックを有効にする", systemImage: "lock.shield")
                    }
                    Text("起動時とバックグラウンド復帰時に、\(lock.biometryName)またはアプリパスワードで解除します。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("アプリロック")
            } footer: {
                Text("アプリパスワードは6文字以上。忘れた場合の復旧はありません。")
            }

            if lock.isEnabled {
                Section {
                    Button("アプリロックを無効にする", role: .destructive) {
                        showDisable = true
                    }
                }
            }
        }
        .navigationTitle("アプリロック")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showPasswordSheet) {
            SetAppPasswordView(lock: lock, isChange: lock.isEnabled)
        }
        .alert("アプリロックを無効にしますか？", isPresented: $showDisable) {
            Button("無効にする", role: .destructive) {
                lock.disable()
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("次回から生体認証とアプリパスワードの画面は表示されません。")
        }
    }
}

private struct SetAppPasswordView: View {
    @ObservedObject var lock: AppLock
    let isChange: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirmation = ""
    @State private var errorMessage: String?

    private var canSave: Bool {
        password.count >= 6 && password == confirmation
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("新しいアプリパスワード", text: $password)
                        .textContentType(.newPassword)
                    SecureField("確認のためもう一度", text: $confirmation)
                        .textContentType(.newPassword)
                } footer: {
                    Text("6文字以上。忘れた場合の復旧はありません。")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(isChange ? "パスワード変更" : "アプリロック")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        do {
                            try lock.enable(password: password)
                            dismiss()
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                    .disabled(!canSave)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
