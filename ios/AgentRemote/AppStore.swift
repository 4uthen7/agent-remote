import Foundation
import SwiftUI
import UIKit

@MainActor
final class AppStore: ObservableObject {
    @Published private(set) var connection: ConnectionState = .disconnected
    @Published private(set) var sessions: [SessionSummary] = []
    @Published private(set) var currentSession: SessionSummary?
    @Published private(set) var timeline: [TimelineItem] = []
    @Published private(set) var approvals: [Approval] = []
    @Published var activeApproval: Approval?
    @Published private(set) var configOptions: [ConfigOption] = []
    @Published private(set) var usage: String?
    @Published private(set) var contextFraction: Double = 0
    @Published var lastError: String?
    @Published var path: [String] = []

    @AppStorage("serverURL") var serverURL: String = "ws://127.0.0.1:8787/ws"
    @Published var token: String = ""
    @AppStorage("lastCwd") var lastCwd: String = "~/Documents"
    @AppStorage("selectedRuntime") var selectedRuntime: String = "dsh"

    private var client: AgentClient?
    private var pendingDemoCwd: String?
    private var pendingOpenSessionId: String?
    private var pendingOpenAfterCreate = false

    init() {
        // Development/simulator convenience: pass AGENT_REMOTE_URL and
        // AGENT_REMOTE_TOKEN through the launch environment.
        if let url = ProcessInfo.processInfo.environment["AGENT_REMOTE_URL"], !url.isEmpty {
            serverURL = url
        }
        if ProcessInfo.processInfo.environment["AGENT_REMOTE_RESET"] == "1" {
            Keychain.deleteToken()
        }
        if let envToken = ProcessInfo.processInfo.environment["AGENT_REMOTE_TOKEN"], !envToken.isEmpty {
            token = envToken
            Keychain.saveToken(envToken)
        } else {
            token = Keychain.readToken() ?? ""
        }
        if let cwd = ProcessInfo.processInfo.environment["AGENT_REMOTE_DEMO_CWD"], !cwd.isEmpty {
            pendingDemoCwd = cwd
        }
        if let sessionId = ProcessInfo.processInfo.environment["AGENT_REMOTE_OPEN_SESSION_ID"],
           !sessionId.isEmpty {
            pendingOpenSessionId = sessionId
        }
    }

    var isConnected: Bool { connection.isConnected }

    var host: HostInfo? {
        if case .connected(let host) = connection { return host }
        return nil
    }

    var modelOption: ConfigOption? {
        configOptions.first(where: { $0.id == "model" })
    }

    var reasoningOption: ConfigOption? {
        configOptions.first(where: { $0.id == "reasoning_effort" })
    }

    var isBusy: Bool {
        currentSession?.status == "running" || currentSession?.status == "awaiting_approval"
    }

    func connect() {
        guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme,
              scheme == "ws" || scheme == "wss" else {
            lastError = "Enter a valid ws:// or wss:// URL."
            return
        }
        guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            lastError = "Paste the token printed by agentd."
            return
        }

        lastError = nil
        connection = .connecting
        let client = AgentClient()
        self.client = client
        client.onEvent = { [weak self] event in
            self?.handle(event)
        }
        client.connect(url: url)
    }

    func setToken(_ value: String) {
        token = value
        if value.isEmpty {
            Keychain.deleteToken()
        } else {
            Keychain.saveToken(value)
        }
    }

    func disconnect() {
        client?.disconnect()
        client = nil
        connection = .disconnected
        currentSession = nil
        timeline = []
        approvals = []
        activeApproval = nil
    }

    func handleDeepLink(_ url: URL) {
        guard url.scheme == "agentremote" || url.scheme == "agentremote-clean" else { return }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = components?.queryItems ?? []
        func value(_ name: String) -> String? {
            items.first(where: { $0.name == name })?.value
        }

        switch url.host {
        case "pair":
            if let urlValue = value("url"), !urlValue.isEmpty {
                serverURL = urlValue
            }
            if let tokenValue = value("token"), !tokenValue.isEmpty {
                setToken(tokenValue)
            }
            connect()
        case "new":
            createSession(cwd: value("cwd") ?? lastCwd)
        case "open":
            guard let sessionId = value("sessionId") else { break }
            if let session = sessions.first(where: { $0.id == sessionId }) {
                select(session)
                path = [session.id]
            } else {
                pendingOpenSessionId = sessionId
                refreshSessions()
            }
        default:
            break
        }
    }

    func refreshSessions() {
        send(ClientMessage(type: "list_sessions"))
    }

    func createSession(cwd: String, runtime: String? = nil) {
        let trimmed = cwd.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            lastError = "Enter a working directory."
            return
        }
        let selected = runtime ?? selectedRuntime
        selectedRuntime = selected
        lastCwd = trimmed
        currentSession = nil
        timeline = []
        approvals = []
        activeApproval = nil
        pendingOpenAfterCreate = true
        send(ClientMessage(type: "create_session", cwd: trimmed, runtime: selected))
    }

    func select(_ session: SessionSummary) {
        currentSession = session
        timeline = []
        approvals = []
        activeApproval = nil
        configOptions = []
        usage = nil
        send(ClientMessage(type: "subscribe", sessionId: session.id))
    }

    func sendPrompt(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let session = currentSession else { return }
        send(ClientMessage(type: "prompt", sessionId: session.id, text: trimmed))
    }

    func cancelTurn() {
        guard let session = currentSession else { return }
        send(ClientMessage(type: "cancel", sessionId: session.id))
    }

    func setModel(value: String) {
        guard let session = currentSession else { return }
        send(ClientMessage(type: "set_model", sessionId: session.id, value: value))
    }

    func closeCurrentSession() {
        guard let session = currentSession else { return }
        send(ClientMessage(type: "close_session", sessionId: session.id))
    }

    func respond(to approval: Approval, optionId: String) {
        send(
            ClientMessage(
                type: "approve",
                approvalId: approval.id,
                optionId: optionId
            )
        )
        activeApproval = nil
        approvals.removeAll(where: { $0.id == approval.id })
    }

    private func send(_ message: ClientMessage) {
        guard let client else {
            lastError = "Not connected."
            return
        }
        client.send(message)
    }

    private func handle(_ event: AgentClient.Event) {
        switch event {
        case .opened:
            send(
                ClientMessage(
                    type: "hello",
                    token: token,
                    deviceName: UIDevice.current.name
                )
            )
        case .message(let message):
            handle(message)
        case .closed(let reason):
            connection = .failed(reason ?? "Disconnected")
        }
    }

    private func handle(_ message: ServerMessage) {
        switch message.type {
        case "hello_ok":
            if let host = message.host {
                connection = .connected(host)
            }
            sessions = message.sessions ?? []
            lastError = nil
            if let sessionId = pendingOpenSessionId,
               let session = sessions.first(where: { $0.id == sessionId }) {
                pendingOpenSessionId = nil
                select(session)
                path = [session.id]
            } else if let cwd = pendingDemoCwd {
                pendingDemoCwd = nil
                createSession(cwd: cwd)
            }

        case "sessions":
            sessions = message.sessions ?? []

        case "session":
            guard let session = message.session else { break }
            upsert(session)
            if currentSession == nil {
                currentSession = session
            }

        case "snapshot":
            if let session = message.session {
                currentSession = session
                upsert(session)
            }
            if let events = message.events {
                timeline = buildTimeline(events)
            }
            approvals = message.approvals ?? []
            activeApproval = approvals.first
            configOptions = message.configOptions ?? []
            if pendingOpenAfterCreate, let session = currentSession {
                pendingOpenAfterCreate = false
                path = [session.id]
            }

        case "event":
            guard let sessionId = message.sessionId,
                  let event = message.event,
                  sessionId == currentSession?.id else { break }
            apply(event)

        case "approval":
            guard let approval = message.approval else { break }
            if !approvals.contains(where: { $0.id == approval.id }) {
                approvals.append(approval)
            }
            if activeApproval == nil {
                activeApproval = approval
            }
            currentSession?.status = "awaiting_approval"

        case "approval_resolved":
            if let approvalId = message.approvalId {
                approvals.removeAll(where: { $0.id == approvalId })
            }
            activeApproval = approvals.first
            if currentSession?.status == "awaiting_approval" {
                currentSession?.status = "running"
            }

        case "models":
            configOptions = message.configOptions ?? []
            if let model = message.model {
                currentSession?.model = model
            } else if let option = modelOption {
                currentSession?.model = option.selectedLabel
            }

        case "session_removed":
            guard let sessionId = message.sessionId else { break }
            sessions.removeAll(where: { $0.id == sessionId })
            if currentSession?.id == sessionId {
                currentSession = nil
                timeline = []
                approvals = []
                activeApproval = nil
            }

        case "error":
            lastError = message.message ?? "Unknown error"

        default:
            break
        }
    }

    private func upsert(_ session: SessionSummary) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.append(session)
        }
        sessions.sort { $0.updatedAt > $1.updatedAt }
        if currentSession?.id == session.id {
            currentSession = session
        }
    }

    private func apply(_ event: AgentEvent) {
        switch event.type {
        case "user_message":
            timeline.append(
                TimelineItem(
                    id: "user-\(event.seq)",
                    kind: .user,
                    text: event.text ?? ""
                )
            )
            currentSession?.status = "running"

        case "assistant_delta":
            appendDelta(event, kind: .assistant)

        case "thought_delta":
            appendDelta(event, kind: .thought)

        case "tool_call", "tool_update":
            upsertTool(&timeline, event: event)

        case "usage":
            if let used = event.used, let size = event.size, size > 0 {
                contextFraction = Double(used) / Double(size)
            }
            usage = usageText(used: event.used, size: event.size)

        case "turn_end":
            for index in timeline.indices {
                timeline[index].isStreaming = false
            }
            currentSession?.status = "idle"
            currentSession?.updatedAt = Int(Date().timeIntervalSince1970 * 1000)

        case "notice":
            timeline.append(
                TimelineItem(
                    id: "notice-\(event.seq)",
                    kind: .notice,
                    text: event.text ?? ""
                )
            )

        case "error":
            timeline.append(
                TimelineItem(
                    id: "error-\(event.seq)",
                    kind: .error,
                    text: event.message ?? "Unknown error"
                )
            )
            currentSession?.status = "error"

        default:
            break
        }
    }

    private func appendDelta(_ event: AgentEvent, kind: TimelineItem.Kind) {
        let text = event.text ?? ""
        if let last = timeline.last, last.kind == kind, last.isStreaming {
            timeline[timeline.count - 1].text += text
        } else {
            timeline.append(
                TimelineItem(
                    id: "\(kind == .assistant ? "assistant" : "thought")-\(event.seq)",
                    kind: kind,
                    text: text,
                    isStreaming: true
                )
            )
        }
    }

    private func buildTimeline(_ events: [AgentEvent]) -> [TimelineItem] {
        var items: [TimelineItem] = []
        var usageLine: String?
        var fraction: Double = 0

        for event in events.sorted(by: { $0.seq < $1.seq }) {
            switch event.type {
            case "user_message":
                items.append(
                    TimelineItem(
                        id: "user-\(event.seq)",
                        kind: .user,
                        text: event.text ?? ""
                    )
                )
            case "assistant_delta":
                let text = event.text ?? ""
                if let last = items.last, last.kind == .assistant, last.isStreaming {
                    items[items.count - 1].text += text
                } else {
                    items.append(
                        TimelineItem(
                            id: "assistant-\(event.seq)",
                            kind: .assistant,
                            text: text,
                            isStreaming: true
                        )
                    )
                }
            case "thought_delta":
                let text = event.text ?? ""
                if let last = items.last, last.kind == .thought, last.isStreaming {
                    items[items.count - 1].text += text
                } else {
                    items.append(
                        TimelineItem(
                            id: "thought-\(event.seq)",
                            kind: .thought,
                            text: text,
                            isStreaming: true
                        )
                    )
                }
            case "tool_call", "tool_update":
                upsertTool(&items, event: event)
            case "usage":
                if let used = event.used, let size = event.size, size > 0 {
                    fraction = Double(used) / Double(size)
                }
                usageLine = usageText(used: event.used, size: event.size)
            case "turn_end":
                for index in items.indices {
                    items[index].isStreaming = false
                }
            case "notice":
                items.append(
                    TimelineItem(
                        id: "notice-\(event.seq)",
                        kind: .notice,
                        text: event.text ?? ""
                    )
                )
            case "error":
                items.append(
                    TimelineItem(
                        id: "error-\(event.seq)",
                        kind: .error,
                        text: event.message ?? "Unknown error"
                    )
                )
            default:
                break
            }
        }

        self.usage = usageLine
        self.contextFraction = fraction
        return items
    }

    private func upsertTool(_ items: inout [TimelineItem], event: AgentEvent) {
        guard let toolCallId = event.toolCallId else { return }
        let id = "tool-\(toolCallId)"
        if let index = items.firstIndex(where: { $0.id == id }) {
            if let status = event.status { items[index].status = status }
            if let output = event.output { items[index].output = output }
            if let command = event.command { items[index].command = command }
            if let cwd = event.cwd { items[index].cwd = cwd }
            if let text = event.title, !text.isEmpty { items[index].text = text }
        } else {
            items.append(
                TimelineItem(
                    id: id,
                    kind: .tool,
                    text: event.title ?? "Tool",
                    toolCallId: toolCallId,
                    command: event.command,
                    cwd: event.cwd,
                    status: event.status,
                    output: event.output
                )
            )
        }
    }

    private func usageText(used: Int?, size: Int?) -> String? {
        guard let used else { return nil }
        if let size, size > 0 {
            let percent = Double(used) / Double(size) * 100
            return String(format: "%.1f%% context (%@ / %@)", percent, format(used), format(size))
        }
        return "\(format(used)) tokens"
    }

    private func format(_ value: Int) -> String {
        NumberFormatter.localizedString(from: NSNumber(value: value), number: .decimal)
    }
}
