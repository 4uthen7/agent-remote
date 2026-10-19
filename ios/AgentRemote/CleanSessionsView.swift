import SwiftUI

struct CleanSessionsView: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject private var appLock = AppLock.shared
    @State private var showingNewSession = false
    @State private var showingSettings = false

    private var projectGroups: [ProjectGroup] {
        let grouped = Dictionary(grouping: store.sessions) { session in
            session.cwd.isEmpty ? "—" : session.cwd
        }
        return grouped.map { cwd, sessions in
            ProjectGroup(cwd: cwd, sessions: sessions.sorted { $0.updatedAt > $1.updatedAt })
        }
        .sorted { lhs, rhs in
            (lhs.sessions.first?.updatedAt ?? 0) > (rhs.sessions.first?.updatedAt ?? 0)
        }
    }

    var body: some View {
        Group {
            if store.sessions.isEmpty {
                emptyState
            } else {
                List {
                    Section {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(Color.green.opacity(0.14))
                                    .frame(width: 36, height: 36)
                                Image(systemName: "bolt.horizontal.fill")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.green)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(store.host?.name ?? "接続中のホスト")
                                    .font(.subheadline.weight(.semibold))
                                Text("DSH / Codex / Claude")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(store.sessions.count) 件")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }

                    ForEach(projectGroups) { group in
                        Section {
                            ForEach(group.sessions) { session in
                                NavigationLink(value: session.id) {
                                    CleanSessionRow(session: session)
                                }
                            }
                        } header: {
                            HStack(spacing: 6) {
                                Image(systemName: "folder")
                                    .font(.caption2)
                                Text(group.sessions.first?.folderName ?? group.cwd)
                                    .font(.caption.weight(.semibold))
                                Spacer()
                                Text("\(group.sessions.count) 件")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            .textCase(nil)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { store.refreshSessions() }
            }
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("セッション")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingNewSession = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("新規セッション")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingSettings = true
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("設定")
            }
        }
        .sheet(isPresented: $showingNewSession) {
            CleanNewSessionView()
                .environmentObject(store)
        }
        .sheet(isPresented: $showingSettings) {
            CleanSettingsView()
                .environmentObject(store)
        }
        .onAppear {
            if store.sessions.isEmpty {
                store.refreshSessions()
            }
        }
        .onChange(of: appLock.isLocked) { _, locked in
            if locked {
                showingNewSession = false
                showingSettings = false
            }
        }
    }

    private var emptyState: some View {
        ScrollView {
            ContentUnavailableView {
                Label("セッションがありません", systemImage: "bubble.left.and.bubble.right")
            } description: {
                Text("PC 上の DSH / Codex / Claude で新しいセッションを開始します。")
            } actions: {
                Button("新規セッション") {
                    showingNewSession = true
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.top, 80)
        }
        .background(Color(uiColor: .systemGroupedBackground))
    }
}

private struct ProjectGroup: Identifiable {
    var id: String { cwd }
    let cwd: String
    let sessions: [SessionSummary]
}

struct CleanSessionRow: View {
    let session: SessionSummary

    var body: some View {
        HStack(spacing: 12) {
            CleanSessionIcon(status: session.isArchived ? "archived" : session.status)

            VStack(alignment: .leading, spacing: 3) {
                Text(session.title)
                    .font(.body.weight(.medium))
                    .lineLimit(1)

                Text(session.cwd)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)

                HStack(spacing: 6) {
                    Circle()
                        .fill(CleanText.statusColor(session.status))
                        .frame(width: 6, height: 6)
                    Text(session.isArchived ? session.statusLabel : CleanText.status(session.status))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("·")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(CleanText.runtime(session.runtime))
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(CleanText.runtimeColor(session.runtime))
                    Text("·")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(CleanText.modelName(session.model))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(CleanText.relativeTime(session.updatedAt))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            if session.isArchived {
                Text(session.canResume ? "再開" : "別ホスト")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(session.canResume ? .blue : .secondary)
            }
        }
        .padding(.vertical, 3)
    }
}
