import Foundation
import SwiftUI

struct HostInfo: Codable, Equatable {
    let name: String
    let version: String
    let platform: String
}

struct SessionSummary: Codable, Identifiable, Equatable {
    let id: String
    var title: String
    var cwd: String
    var status: String
    var runtime: String
    var model: String?
    var createdAt: Int
    var updatedAt: Int

    var statusLabel: String {
        switch status {
        case "running": return "Running"
        case "awaiting_approval": return "Needs approval"
        case "error": return "Error"
        default: return "Idle"
        }
    }

    var statusColor: Color {
        switch status {
        case "running": return .blue
        case "awaiting_approval": return .orange
        case "error": return .red
        default: return .secondary
        }
    }

    var displayModel: String {
        model ?? "default"
    }

    var runtimeLabel: String {
        switch runtime {
        case "codex": return "Codex"
        case "claude": return "Claude"
        default: return "DSH"
        }
    }

    var runtimeColor: Color {
        switch runtime {
        case "codex": return .green
        case "claude": return .orange
        default: return .blue
        }
    }

    var runtimeIcon: String {
        switch runtime {
        case "codex": return "chevron.left.forwardslash.chevron.right"
        case "claude": return "sparkles"
        default: return "bolt.horizontal.fill"
        }
    }

    var folderName: String {
        let trimmed = cwd.hasSuffix("/") ? String(cwd.dropLast()) : cwd
        return (trimmed as NSString).lastPathComponent
    }
}

struct AgentEvent: Codable, Identifiable, Equatable {
    var seq: Int
    var type: String
    var text: String?
    var toolCallId: String?
    var title: String?
    var kind: String?
    var command: String?
    var cwd: String?
    var status: String?
    var output: String?
    var used: Int?
    var size: Int?
    var stopReason: String?
    var message: String?

    var id: Int { seq }
}

struct ApprovalOption: Codable, Identifiable, Equatable {
    var optionId: String
    var name: String
    var kind: String?
    var id: String { optionId }

    var isDestructive: Bool {
        (kind ?? "").contains("reject") || optionId.contains("reject")
    }
}

struct Approval: Codable, Identifiable, Equatable {
    var id: String
    var sessionId: String
    var toolCallId: String?
    var title: String
    var command: String?
    var cwd: String?
    var justification: String?
    var sandbox: String?
    var kind: String?
    var options: [ApprovalOption]
    var createdAt: Int

    var isDangerous: Bool {
        (sandbox ?? "").contains("danger-full-access")
    }
}

struct ConfigOptionValue: Codable, Identifiable, Equatable {
    var value: String
    var name: String
    var description: String?
    var id: String { value }
}

struct ConfigOptionGroup: Codable, Equatable {
    var group: String
    var name: String?
    var options: [ConfigOptionValue]
}

enum ConfigOptionEntry: Codable, Equatable {
    case value(ConfigOptionValue)
    case group(ConfigOptionGroup)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let group = try? container.decode(ConfigOptionGroup.self), !group.group.isEmpty {
            self = .group(group)
        } else {
            self = .value(try container.decode(ConfigOptionValue.self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .value(let value):
            try container.encode(value)
        case .group(let group):
            try container.encode(group)
        }
    }
}

struct ConfigOption: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var category: String?
    var type: String
    var currentValue: String?
    var options: [ConfigOptionEntry]?

    var flatValues: [ConfigOptionValue] {
        (options ?? []).flatMap { entry -> [ConfigOptionValue] in
            switch entry {
            case .value(let value): return [value]
            case .group(let group): return group.options
            }
        }
    }

    var selectedLabel: String {
        flatValues.first(where: { $0.value == currentValue })?.name ?? currentValue ?? "default"
    }
}

struct ServerMessage: Decodable {
    let type: String
    let host: HostInfo?
    let version: String?
    let sessions: [SessionSummary]?
    let session: SessionSummary?
    let event: AgentEvent?
    let sessionId: String?
    let approval: Approval?
    let approvalId: String?
    let decision: String?
    let configOptions: [ConfigOption]?
    let model: String?
    let message: String?
    let reason: String?
    let events: [AgentEvent]?
    let approvals: [Approval]?
}

struct ClientMessage: Encodable {
    let type: String
    var token: String?
    var deviceName: String?
    var cwd: String?
    var runtime: String?
    var sessionId: String?
    var text: String?
    var approvalId: String?
    var optionId: String?
    var value: String?
}

struct TimelineItem: Identifiable, Equatable {
    enum Kind: Equatable {
        case user
        case assistant
        case thought
        case tool
        case notice
        case error
    }

    var id: String
    var kind: Kind
    var text: String
    var toolCallId: String?
    var command: String?
    var cwd: String?
    var status: String?
    var output: String?
    var isStreaming: Bool = false

    var isTool: Bool { kind == .tool }
}

enum ConnectionState: Equatable {
    case disconnected
    case connecting
    case connected(HostInfo)
    case failed(String)

    var label: String {
        switch self {
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting…"
        case .connected(let host): return "Connected to \(host.name)"
        case .failed(let message): return message
        }
    }

    var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }
}
