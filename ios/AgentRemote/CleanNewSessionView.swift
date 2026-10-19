import SwiftUI

struct CleanNewSessionView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var cwd = ""
    @State private var runtime = "dsh"
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("エージェント", selection: $runtime) {
                        Text("DeepSeek Harness").tag("dsh")
                        Text("Codex").tag("codex")
                        Text("Claude Code").tag("claude")
                    }
                    .pickerStyle(.inline)
                } header: {
                    Text("ランタイム")
                } footer: {
                    Text("各ランタイムのCLIにログインしている必要があります。")
                }

                Section {
                    TextField("~/Documents/project", text: $cwd)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(.body, design: .monospaced))
                        .focused($focused)
                } header: {
                    Text("作業ディレクトリ")
                } footer: {
                    Text("agentd の許可ルート内のパスを指定してください。通常はホームディレクトリ配下です。")
                }

                Section("候補") {
                    suggestion("ホーム", path: "~")
                    suggestion("書類", path: "~/Documents")
                    suggestion("デスクトップ", path: "~/Desktop")
                }

                Section {
                    Button {
                        store.createSession(cwd: cwd, runtime: runtime)
                        dismiss()
                    } label: {
                        Text("セッションを開始")
                    }
                    .buttonStyle(CleanPrimaryButtonStyle())
                    .disabled(cwd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
                }
            }
            .navigationTitle("新規セッション")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
            }
            .onAppear {
                cwd = store.lastCwd
                runtime = store.selectedRuntime
                focused = true
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func suggestion(_ title: String, path: String) -> some View {
        Button {
            cwd = path
        } label: {
            HStack {
                Text(title)
                Spacer()
                Text(path)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(.primary)
    }
}
