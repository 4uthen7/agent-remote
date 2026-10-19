import SwiftUI
import UIKit

struct CleanTimelineView: View {
    @EnvironmentObject private var store: AppStore
    let sessionId: String

    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    private var session: SessionSummary? {
        store.sessions.first(where: { $0.id == sessionId })
            ?? (store.currentSession?.id == sessionId ? store.currentSession : nil)
    }

    private var isBusy: Bool {
        session?.status == "running" || session?.status == "awaiting_approval"
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    header

                    if let approval = store.activeApproval {
                        approvalBanner(approval)
                    }

                    ForEach(store.timeline) { item in
                        CleanTimelineRow(item: item)
                    }

                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.timeline.count) { _, _ in
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            .onChange(of: store.timeline.last?.text) { _, _ in
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
        .background(Color(uiColor: .systemBackground))
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer
        }
        .navigationTitle("セッション")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                modelMenu
            }
        }
        .onAppear {
            if store.currentSession?.id != sessionId, let session {
                store.select(session)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(session?.title ?? "セッション")
                .font(.headline)
                .lineLimit(2)

            HStack(spacing: 8) {
                CleanStatusBadge(
                    text: CleanText.status(session?.status ?? "idle"),
                    color: CleanText.statusColor(session?.status ?? "idle")
                )

                Text(CleanText.modelName(session?.model))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                Text("コンテキスト \(CleanText.contextPercent(store.contextFraction))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if let cwd = session?.cwd, !cwd.isEmpty {
                Label(cwd, systemImage: "folder")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color(uiColor: .secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
    }

    private func approvalBanner(_ approval: Approval) -> some View {
        Button {
            store.activeApproval = approval
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.orange)

                VStack(alignment: .leading, spacing: 3) {
                    Text("承認が必要です")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(approval.command ?? approval.title)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 4)

                Text("確認")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }
            .padding(14)
            .background(
                Color.orange.opacity(0.09),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.orange.opacity(0.22), lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }

    private var composer: some View {
        VStack(spacing: 0) {
            Divider()

            HStack(alignment: .bottom, spacing: 8) {
                TextField("メッセージ", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.plain)
                    .font(.body)
                    .focused($composerFocused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        Color(uiColor: .secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(
                                composerFocused ? Color.blue.opacity(0.5) : Color(uiColor: .separator).opacity(0.4),
                                lineWidth: composerFocused ? 1 : 0.5
                            )
                    )

                if isBusy {
                    Button {
                        store.cancelTurn()
                    } label: {
                        Image(systemName: "stop.circle.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("停止")
                }

                Button {
                    let text = draft
                    draft = ""
                    store.sendPrompt(text)
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(canSend ? .blue : Color(uiColor: .tertiaryLabel))
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel("送信")
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 6)
        }
        .background(.bar)
    }

    @ViewBuilder
    private var modelMenu: some View {
        if let option = store.modelOption {
            Menu {
                ForEach(option.flatValues) { value in
                    Button {
                        store.setModel(value: value.value)
                    } label: {
                        if value.value == option.currentValue {
                            Label(value.name, systemImage: "checkmark")
                        } else {
                            Text(value.name)
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "cpu")
                    Text(CleanText.modelName(session?.model))
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                }
                .font(.caption)
            }
        }
    }
}
