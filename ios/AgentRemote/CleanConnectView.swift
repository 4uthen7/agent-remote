import SwiftUI
import UIKit

struct CleanConnectView: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject private var appLock = AppLock.shared
    @FocusState private var focusedField: Field?
    @State private var showingScanner = false
    @State private var diagnosing = false
    @State private var diagnosis: String?
    @State private var showingSettings = false
    @State private var showToken = false

    private enum Field {
        case url
        case token
    }

    private var urlBinding: Binding<String> {
        Binding(get: { store.serverURL }, set: { store.serverURL = $0 })
    }

    private var tokenBinding: Binding<String> {
        Binding(get: { store.token }, set: { store.setToken($0) })
    }

    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(.primary)
                            .frame(width: 64, height: 64)
                        Image(systemName: "terminal.fill")
                            .font(.system(size: 26, weight: .semibold))
                            .foregroundStyle(Color(uiColor: .systemBackground))
                    }

                    Text("DSH・Codex・Claude をリモート操作")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    HStack(spacing: 6) {
                        Circle()
                            .fill(CleanText.connectionColor(store.connection))
                            .frame(width: 7, height: 7)
                        Text(CleanText.connection(store.connection))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))

            Section {
                HStack(spacing: 8) {
                    TextField("ws://192.168.x.x:8787/ws", text: urlBinding)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .focused($focusedField, equals: .url)
                        .font(.system(.subheadline, design: .monospaced))

                    Button {
                        paste(into: urlBinding)
                    } label: {
                        Image(systemName: "doc.on.clipboard")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("ホストを貼り付け")
                }

                HStack(spacing: 8) {
                    Group {
                        if showToken {
                            TextField("トークン", text: tokenBinding)
                        } else {
                            SecureField("トークン", text: tokenBinding)
                        }
                    }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .token)
                    .font(.system(.subheadline, design: .monospaced))

                    Button {
                        showToken.toggle()
                    } label: {
                        Image(systemName: showToken ? "eye.slash" : "eye")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(showToken ? "トークンを隠す" : "トークンを表示")

                    Button {
                        paste(into: tokenBinding)
                    } label: {
                        Image(systemName: "doc.on.clipboard")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("トークンを貼り付け")
                }
            } header: {
                Text("接続情報")
            } footer: {
                Text("agentd が表示する URL とトークンを入力します。QR コードを使うと自動で入力されます。")
            }

            Section {
                VStack(spacing: 10) {
                    Button {
                        focusedField = nil
                        store.connect()
                    } label: {
                        HStack(spacing: 8) {
                            if store.connection == .connecting {
                                ProgressView()
                                    .tint(.white)
                            }
                            Text(store.connection == .connecting ? "接続中…" : "接続")
                        }
                    }
                    .buttonStyle(CleanPrimaryButtonStyle())
                    .disabled(store.connection == .connecting || store.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button {
                        showingScanner = true
                    } label: {
                        Label("QR コードをスキャン", systemImage: "qrcode.viewfinder")
                    }
                    .buttonStyle(CleanSecondaryButtonStyle())

                    Button {
                        diagnosing = true
                        Task {
                            diagnosis = await store.diagnose()
                            diagnosing = false
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if diagnosing { ProgressView() }
                            Text("接続テスト（ホストに届くか）")
                        }
                    }
                    .buttonStyle(CleanSecondaryButtonStyle())
                    .disabled(diagnosing)

                    if let diagnosis {
                        Text(diagnosis)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            Section("セキュリティ") {
                Label {
                    Text("トークンは iOS の Keychain に保存されます。LAN 外から使う場合は Tailscale 経由で接続してください。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "lock.shield.fill")
                        .foregroundStyle(.green)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Agent Remote")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingSettings = true
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("設定")
            }
        }
        .sheet(isPresented: $showingScanner) {
            scannerSheet
        }
        .sheet(isPresented: $showingSettings) {
            CleanSettingsView()
                .environmentObject(store)
        }
        .onChange(of: appLock.isLocked) { _, locked in
            if locked {
                showingScanner = false
                showingSettings = false
            }
        }
    }

    private var scannerSheet: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                QRScannerView { code in
                    handleScannedCode(code)
                }
                .ignoresSafeArea()

                Text("agentd のターミナルに表示された QR コードを読み取ります")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.55), in: Capsule())
                    .padding(.bottom, 28)
            }
            .navigationTitle("QR コードをスキャン")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("閉じる") { showingScanner = false }
                }
            }
        }
    }

    private func handleScannedCode(_ code: String) {
        showingScanner = false
        guard let url = URL(string: code),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return
        }
        let items = components.queryItems ?? []
        if let hostURL = items.first(where: { $0.name == "url" })?.value, !hostURL.isEmpty {
            store.serverURL = hostURL
        } else if components.scheme == "ws" || components.scheme == "wss" {
            store.serverURL = code
        }
        if let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty {
            store.setToken(token)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            store.connect()
        }
    }

    private func paste(into binding: Binding<String>) {
        guard let value = UIPasteboard.general.string, !value.isEmpty else { return }
        binding.wrappedValue = value
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}
