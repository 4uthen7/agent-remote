import SwiftUI

@main
struct AgentRemoteApp: App {
    @StateObject private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            CleanRootView()
                .environmentObject(store)
                .tint(.blue)
        }
    }
}
