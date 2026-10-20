import SwiftUI

struct CleanRootView: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject private var appLock = AppLock.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            NavigationStack(path: $store.path) {
            Group {
                if store.isConnected {
                    CleanSessionsView()
                } else {
                    CleanConnectView()
                }
            }
                .navigationDestination(for: String.self) { sessionId in
                    CleanTimelineView(sessionId: sessionId)
                }
            }

            if appLock.isLocked {
                AppLockView(lock: appLock)
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .overlay(alignment: .top) {
            if store.isReconnecting, !store.token.isEmpty {
                ReconnectBanner(store: store)
                    .padding(.top, 54)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(2)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: store.reconnectAttempt)
        .animation(.easeInOut(duration: 0.2), value: store.isReconnecting)
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .background {
                appLock.lockIfNeeded()
            }
            store.setActive(newPhase == .active)
        }
        .sheet(item: Binding(
            get: { appLock.isLocked ? nil : store.activeApproval },
            set: { store.activeApproval = $0 }
        )) { approval in
            CleanApprovalSheet(approval: approval)
                .environmentObject(store)
        }
        .onOpenURL { url in
            store.handleDeepLink(url)
        }
        .task {
            if store.connection == .disconnected, !store.token.isEmpty {
                store.connect()
            }
        }
        .alert(
            "Agent Remote",
            isPresented: Binding(
                get: { store.lastError != nil && !store.isReconnecting },
                set: { presented in
                    if !presented { store.lastError = nil }
                }
            )
        ) {
            Button("OK", role: .cancel) { store.lastError = nil }
        } message: {
            Text(store.lastError ?? "")
        }
    }
}

// MARK: - Reconnect banner

/// Compact, non-blocking reconnect status with a countdown, so a dropped
/// Tailscale/session link never becomes a dead-end error alert.
private struct ReconnectBanner: View {
    @ObservedObject var store: AppStore
    @State private var pulse = false

    private var tint: Color {
        if case .failed = store.connection { return .red }
        return .orange
    }

    private var title: String {
        if case .failed = store.connection { return "接続が切れました" }
        return "接続しています"
    }

    private var detail: String {
        if let at = store.nextRetryAt {
            let seconds = max(0, Int(ceil(at.timeIntervalSinceNow)))
            return "\(seconds) 秒後に再試行 ・ 試行 \(store.reconnectAttempt)"
        }
        if store.hostReachable == false {
            return "ホストに到達できません（Tailscale を確認）"
        }
        if store.hostReachable == true {
            return "ホストは応答しています。認証を確認中"
        }
        return "ホストの応答を確認しています"
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(tint.opacity(0.18)).frame(width: 20, height: 20)
                    Circle()
                        .fill(tint)
                        .frame(width: 7, height: 7)
                        .scaleEffect(pulse ? 1.5 : 0.85)
                        .opacity(pulse ? 0.55 : 1)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.footnote.weight(.semibold))
                    Text(detail).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    store.retryNow()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.footnote.weight(.semibold))
                        .padding(7)
                        .background(tint.opacity(0.12), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("今すぐ再試行")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(tint.opacity(0.18))
            )
            .shadow(color: .black.opacity(0.08), radius: 10, y: 3)
            .padding(.horizontal, 14)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}
