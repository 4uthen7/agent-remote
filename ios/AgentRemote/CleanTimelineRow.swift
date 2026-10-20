import SwiftUI

struct CleanTimelineRow: View {
    let item: TimelineItem

    @State private var showThought = false
    @State private var showOutput = false

    var body: some View {
        switch item.kind {
        case .user:
            HStack(alignment: .top) {
                Spacer(minLength: 48)
                Text(item.text)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        Color.blue.opacity(0.10),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                    )
            }
            .frame(maxWidth: .infinity, alignment: .trailing)

        case .assistant:
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.caption)
                    .foregroundStyle(.blue)
                    .padding(.top, 4)

                MarkdownView(text: item.text, isStreaming: item.isStreaming)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

        case .thought:
            DisclosureGroup(isExpanded: $showThought) {
                (Text(item.text) + Text(item.isStreaming ? " ▍" : "").foregroundColor(.blue))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(
                        Color(uiColor: .tertiarySystemFill),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
                    .padding(.top, 6)
            } label: {
                Label("思考", systemImage: "brain")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .tint(.secondary)

        case .tool:
            toolCard

        case .notice:
            Text(item.text)
                .font(.caption)
                .foregroundStyle(.secondary)

        case .error:
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
                Text(item.text)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var toolCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "terminal")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(item.text)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(CleanText.toolStatus(item.status))
                    .font(.caption2)
                    .foregroundStyle(toolColor)
            }

            if let command = item.command, !command.isEmpty {
                CleanCodeBlock(command: command)
            }

            if let cwd = item.cwd, !cwd.isEmpty {
                Label(cwd, systemImage: "folder")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            if let output = item.output, !output.isEmpty {
                DisclosureGroup(isExpanded: $showOutput) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(output)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } label: {
                    Text("出力")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .tint(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color(uiColor: .secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color(uiColor: .separator).opacity(0.35), lineWidth: 0.5)
        )
    }

    private var toolColor: Color {
        switch item.status {
        case "completed": return .green
        case "in_progress", "pending": return .blue
        case "failed", "error": return .red
        default: return Color(uiColor: .secondaryLabel)
        }
    }
}
