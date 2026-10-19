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
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .background {
                appLock.lockIfNeeded()
            }
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
                get: { store.lastError != nil },
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
