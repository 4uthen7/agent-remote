import SwiftUI

struct CleanRootView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
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
        .sheet(item: $store.activeApproval) { approval in
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
