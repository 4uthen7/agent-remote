import SwiftUI
import UIKit

enum MarkdownBlock {
    case heading(level: Int, text: String)
    case paragraph(String)
    case code(language: String, text: String)
    case listItem(marker: String, text: String)
    case quote(String)
    case rule
}

enum MarkdownParser {
    static func parse(_ source: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var codeLines: [String] = []
        var language = ""
        var inCode = false
        var fenceLength = 3

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            blocks.append(.paragraph(paragraph.joined(separator: "\n")))
            paragraph.removeAll()
        }

        for rawLine in source.components(separatedBy: "\n") {
            let line = rawLine
            if line.hasPrefix("```") {
                let ticks = line.prefix(while: { $0 == "`" }).count
                if inCode {
                    let rest = line.dropFirst(ticks).trimmingCharacters(in: .whitespaces)
                    if ticks >= fenceLength && rest.isEmpty {
                        blocks.append(.code(language: language, text: codeLines.joined(separator: "\n")))
                        codeLines.removeAll()
                        language = ""
                        inCode = false
                    } else {
                        codeLines.append(line)
                    }
                } else {
                    flushParagraph()
                    inCode = true
                    fenceLength = ticks
                    language = String(line.dropFirst(ticks)).trimmingCharacters(in: .whitespaces)
                }
                continue
            }
            if inCode {
                codeLines.append(line)
                continue
            }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                flushParagraph()
                continue
            }
            if trimmed.hasPrefix("#") {
                var level = 0
                for character in trimmed {
                    guard character == "#" else { break }
                    level += 1
                }
                if level > 0 && level <= 6 {
                    flushParagraph()
                    let title = String(trimmed.dropFirst(level)).trimmingCharacters(in: .whitespaces)
                    blocks.append(.heading(level: level, text: title))
                    continue
                }
            }
            if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                flushParagraph()
                blocks.append(.rule)
                continue
            }
            if trimmed.hasPrefix(">") {
                flushParagraph()
                let quote = String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)
                blocks.append(.quote(quote))
                continue
            }
            if let item = listPrefix(trimmed) {
                flushParagraph()
                blocks.append(.listItem(marker: item.marker, text: item.text))
                continue
            }
            paragraph.append(line)
        }

        if inCode {
            blocks.append(.code(language: language, text: codeLines.joined(separator: "\n")))
        }
        flushParagraph()
        return blocks
    }

    static func table(from paragraph: String) -> (headers: [String], rows: [[String]])? {
        let lines = paragraph
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard lines.count >= 2, lines[0].contains("|") else { return nil }
        let separator = cells(lines[1])
        guard !separator.isEmpty,
              separator.allSatisfy({
                  !$0.isEmpty && $0.allSatisfy { $0 == "-" || $0 == ":" || $0 == " " }
              }) else {
            return nil
        }
        let headers = cells(lines[0])
        guard !headers.isEmpty else { return nil }
        let rows = lines.dropFirst(2).map(cells)
        return (headers, rows)
    }

    private static func cells(_ line: String) -> [String] {
        var value = line
        if value.hasPrefix("|") { value.removeFirst() }
        if value.hasSuffix("|") { value.removeLast() }
        return value
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func listPrefix(_ line: String) -> (marker: String, text: String)? {
        for marker in ["- ", "* ", "+ "] {
            if line.hasPrefix(marker) {
                return ("•", String(line.dropFirst(marker.count)))
            }
        }
        guard let space = line.firstIndex(of: " ") else { return nil }
        let head = String(line[line.startIndex..<space])
        guard head.hasSuffix("."), Int(head.dropLast()) != nil else { return nil }
        return (head, String(line[line.index(after: space)...]))
    }
}

struct MarkdownView: View {
    let text: String
    var isStreaming: Bool = false

    private var blocks: [MarkdownBlock] {
        MarkdownParser.parse(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
            if isStreaming {
                Text("▍")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.blue)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock) -> some View {
        switch block {
        case let .heading(level, text):
            inline(text)
                .font(.system(size: headingSize(level), weight: .semibold))
                .padding(.top, level <= 2 ? 4 : 2)
                .fixedSize(horizontal: false, vertical: true)

        case let .paragraph(text):
            if let table = MarkdownParser.table(from: text) {
                MarkdownTable(headers: table.headers, rows: table.rows)
            } else {
                inline(text)
                    .font(.system(size: 15))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

        case let .code(language, text):
            MarkdownCodeBlock(language: language, code: text)

        case let .listItem(marker, text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(marker)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(width: 16, alignment: .trailing)
                inline(text)
                    .font(.system(size: 15))
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

        case let .quote(text):
            HStack(alignment: .top, spacing: 9) {
                Rectangle()
                    .fill(Color(uiColor: .separator))
                    .frame(width: 2)
                inline(text)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

        case .rule:
            Divider()
                .padding(.vertical, 2)
        }
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case 1: return 21
        case 2: return 18
        case 3: return 16
        default: return 15
        }
    }

    private func inline(_ source: String) -> Text {
        markdownInline(source)
    }
}

struct MarkdownCodeBlock: View {
    let language: String
    let code: String

    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(language.isEmpty ? "code" : language.lowercased())
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button {
                    UIPasteboard.general.string = code
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
                        copied = false
                    }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("コードをコピー")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)

            Divider()

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: 12, design: .monospaced))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(
            Color(uiColor: .secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color(uiColor: .separator).opacity(0.35), lineWidth: 0.5)
        )
    }
}


struct MarkdownTable: View {
    let headers: [String]
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                row(headers, isHeader: true)
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { index, cells in
                    row(cells, isHeader: false)
                    if index < rows.count - 1 {
                        Divider().opacity(0.5)
                    }
                }
            }
            .padding(.vertical, 2)
            .background(
                Color(uiColor: .secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Color(uiColor: .separator).opacity(0.35), lineWidth: 0.5)
            )
        }
    }

    private var widths: [CGFloat] {
        headers.indices.map { index in
            let values = [headers[index]] + rows.compactMap { row in
                index < row.count ? row[index] : nil
            }
            let longest = values.map(\.count).max() ?? 4
            return min(240, max(72, CGFloat(longest) * 9 + 24))
        }
    }

    private func row(_ cells: [String], isHeader: Bool) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(headers.indices), id: \.self) { index in
                markdownInline(index < cells.count ? cells[index] : "")
                    .font(.system(size: 12, weight: isHeader ? .semibold : .regular))
                    .foregroundStyle(isHeader ? .primary : .secondary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: widths[index], alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                if index < headers.count - 1 {
                    Rectangle()
                        .fill(Color(uiColor: .separator).opacity(0.25))
                        .frame(width: 0.5)
                }
            }
        }
    }
}


private func markdownInline(_ source: String) -> Text {
    guard var attributed = try? AttributedString(
        markdown: source,
        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    ) else {
        return Text(source)
    }
    for run in attributed.runs {
        guard run.inlinePresentationIntent?.contains(.code) == true else { continue }
        attributed[run.range].font = .system(size: 13, design: .monospaced)
    }
    return Text(attributed)
}
