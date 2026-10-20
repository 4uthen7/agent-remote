import SwiftUI
import UIKit

enum CleanText {
    static func status(_ status: String) -> String {
        switch status {
        case "running": return "実行中"
        case "awaiting_approval": return "承認待ち"
        case "error": return "エラー"
        default: return "待機中"
        }
    }

    static func statusColor(_ status: String) -> Color {
        switch status {
        case "running": return .blue
        case "awaiting_approval": return .orange
        case "error": return .red
        default: return Color(uiColor: .secondaryLabel)
        }
    }

    static func statusIcon(_ status: String) -> String {
        switch status {
        case "running": return "bolt.fill"
        case "awaiting_approval": return "hand.raised.fill"
        case "error": return "exclamationmark.triangle.fill"
        default: return "terminal.fill"
        }
    }

    static func connection(_ connection: ConnectionState) -> String {
        switch connection {
        case .disconnected: return "未接続"
        case .connecting: return "接続中…"
        case .connected(let host): return "\(host.name) に接続中"
        case .failed: return "接続エラー"
        }
    }

    static func connectionColor(_ connection: ConnectionState) -> Color {
        switch connection {
        case .connected: return .green
        case .connecting: return .orange
        case .failed: return .red
        case .disconnected: return Color(uiColor: .secondaryLabel)
        }
    }

    static func optionLabel(_ option: ApprovalOption) -> String {
        option.isDestructive ? "拒否" : "一度だけ許可"
    }

    static func toolStatus(_ status: String?) -> String {
        switch status {
        case "completed": return "完了"
        case "in_progress", "pending": return "実行中"
        case "failed", "error": return "失敗"
        default: return "待機"
        }
    }

    static func relativeTime(_ milliseconds: Double) -> String {
        let date = Date(timeIntervalSince1970: Double(milliseconds) / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    static func contextPercent(_ fraction: Double) -> String {
        let percent = fraction * 100
        if percent < 1 {
            return String(format: "%.1f%%", percent)
        }
        return String(format: "%.0f%%", percent)
    }

    static func modelName(_ model: String?) -> String {
        guard let model, !model.isEmpty else { return "デフォルト" }
        return model.replacingOccurrences(of: "DeepSeek-", with: "")
    }

    static func runtime(_ runtime: String) -> String {
        switch runtime {
        case "codex": return "Codex"
        case "claude": return "Claude"
        default: return "DeepSeek"
        }
    }

    static func runtimeColor(_ runtime: String) -> Color {
        switch runtime {
        case "codex": return .green
        case "claude": return .orange
        default: return .blue
        }
    }
}

enum CleanConfig {
    static let bundleDisplayName = "Agent Remote"
    static let version = "0.1.0"
}
