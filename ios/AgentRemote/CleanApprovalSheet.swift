import SwiftUI

struct CleanApprovalSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let approval: Approval

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header

                    if let sandbox = approval.sandbox, !sandbox.isEmpty, approval.isDangerous {
                        Text("\(sandbox) を要求しています")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.red)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.red.opacity(0.10), in: Capsule())
                    }

                    if let command = approval.command, !command.isEmpty {
                        CleanCodeBlock(command: command)
                    }

                    if let cwd = approval.cwd, !cwd.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("作業ディレクトリ")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(cwd)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                        }
                    }

                    if let justification = approval.justification, !justification.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("理由")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(justification)
                                .font(.subheadline)
                                .foregroundStyle(.primary)
                                .lineSpacing(2)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            Color(uiColor: .secondarySystemGroupedBackground),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                        )
                    }

                    if approval.isDangerous {
                        Label {
                            Text("ワークスペースのサンドボックス外にアクセスします。コマンドと理由が意図したものと一致する場合のみ許可してください。")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } icon: {
                            Image(systemName: "exclamationmark.octagon.fill")
                                .foregroundStyle(.red)
                        }
                        .padding(12)
                        .background(
                            Color.red.opacity(0.06),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                        )
                    }
                }
                .padding(20)
            }
            .navigationTitle("承認")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("後で") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                actions
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.orange.opacity(0.12))
                    .frame(width: 52, height: 52)
                Image(systemName: "hand.raised.fill")
                    .font(.title2)
                    .foregroundStyle(.orange)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("承認が必要です")
                    .font(.title2.weight(.bold))
                Text(approval.title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
    }

    private var actions: some View {
        VStack(spacing: 8) {
            ForEach(approval.options) { option in
                if option.isDestructive {
                    Button {
                        store.respond(to: approval, optionId: option.optionId)
                        dismiss()
                    } label: {
                        Text(CleanText.optionLabel(option))
                    }
                    .buttonStyle(CleanSecondaryButtonStyle(tint: .red))
                } else {
                    Button {
                        store.respond(to: approval, optionId: option.optionId)
                        dismiss()
                    } label: {
                        Text(CleanText.optionLabel(option))
                    }
                    .buttonStyle(CleanPrimaryButtonStyle(tint: approval.isDangerous ? .orange : .blue))
                }
            }

            Text("一度だけ有効です。コマンドはホストが承認を受け取った後に実行されます。")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
    }
}
