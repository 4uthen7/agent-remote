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

    /// Reconnection telemetry the UI renders instead of a blocking alert.
    @Published private(set) var nextRetryAt: Date?
    @Published private(set) var hostReachable: Bool?

    @AppStorage("serverURL") var serverURL: String = "ws://127.0.0.1:8787/ws"
    @Published var token: String = ""
    @AppStorage("lastCwd") var lastCwd: String = "~/Documents"
    @AppStorage("selectedRuntime") var selectedRuntime: String = "dsh"

    private var client: AgentClient?
    private var connectionGeneration = 0
    private var reconnectTask: Task<Void, Never>?
    private var watchdogTask: Task<Void, Never>?
    @Published private(set) var reconnectAttempt = 0
    private var hadConnected = false
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
        reconnectAttempt = 0
        openSocket(isReconnect: false)
    }

    var isReconnecting: Bool {
        switch connection {
        case .connecting, .failed: return true
        case .disconnected, .connected: return false
        }
    }

    var failureReason: String? {
        if case .failed(let reason) = connection { return reason }
        return nil
    }

    /// Skip the backoff wait and try again now.
    func retryNow() {
        reconnectTask?.cancel()
        reconnectTask = nil
        nextRetryAt = nil
        openSocket(isReconnect: true)
    }

    /// Foreground/background hook: retry immediately on return, stop timers
    /// while suspended.
    func setActive(_ active: Bool) {
        if active {
            if !token.isEmpty, case .failed = connection {
                retryNow()
            }
        } else {
            reconnectTask?.cancel()
            reconnectTask = nil
            nextRetryAt = nil
        }
    }

    /// Human-readable reachability result for the connect screen.
    func diagnose() async -> String {
        guard let health = Self.healthURL(serverURL) else { return "URL が不正です" }
        var request = URLRequest(url: health)
        request.timeoutInterval = 4
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            let body = String(data: data.prefix(160), encoding: .utf8) ?? ""
            return "HTTP \(code) \(body)"
        } catch {
            return "失敗: \(error.localizedDescription)"
        }
    }

    nonisolated private static func healthURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = url.scheme, scheme == "ws" || scheme == "wss" else { return nil }
        components.scheme = scheme == "wss" ? "https" : "http"
        components.path = "/health"
        components.query = nil
        return components.url
    }

    nonisolated private static func probeHealth(_ raw: String) async -> Bool {
        guard let url = healthURL(raw) else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2.5
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func openSocket(isReconnect: Bool) {
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

        connectionGeneration += 1
        let generation = connectionGeneration
        reconnectTask?.cancel()
        reconnectTask = nil
        client?.disconnect()
        lastError = nil
        connection = .connecting
        let client = AgentClient()
        self.client = client
        client.onEvent = { [weak self] event in
            guard let self, generation == self.connectionGeneration else { return }
            switch event {
            case .closed(let reason):
                self.lostConnection(reason, generation: generation)
            default:
                self.handle(event)
            }
        }
        nextRetryAt = nil

        // Reachability probe beside the socket: distinguishes "host down" from
        // "socket/auth failed" and reports it within ~2.5s.
        let rawURL = serverURL
        Task { [weak self] in
            let reachable = await Self.probeHealth(rawURL)
            guard let self, generation == self.connectionGeneration else { return }
            self.hostReachable = reachable
        }

        client.connect(url: url)

        // A socket that opens but never authenticates must not hang forever.
        watchdogTask?.cancel()
        watchdogTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled, let self, generation == self.connectionGeneration else { return }
            if case .connected = self.connection { return }
            self.lostConnection("ホストから応答がありません", generation: generation)
        }
    }

    private func lostConnection(_ reason: String?, generation: Int) {
        guard generation == connectionGeneration else { return }
        watchdogTask?.cancel()
        // A first connect that fails on a transient network should also retry a
        // few times; a wrong token stops after three attempts instead of looping.
        if hadConnected || !path.isEmpty || currentSession != nil || reconnectAttempt < 3 {
            scheduleReconnect(generation, reason: reason)
        } else {
            connection = .failed(reason ?? "Disconnected")
        }
    }

    private func scheduleReconnect(_ generation: Int, reason: String?) {
        guard generation == connectionGeneration else { return }
        reconnectTask?.cancel()
        let delay = min(2 << min(reconnectAttempt, 3), 15)
        reconnectAttempt += 1
        connection = .connecting
        nextRetryAt = Date().addingTimeInterval(Double(delay))
        // No alert: the root view renders a banner with this state.
        lastError = nil
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self, generation == self.connectionGeneration else { return }
            self.openSocket(isReconnect: true)
        }
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
        connectionGeneration += 1
        reconnectTask?.cancel()
        reconnectTask = nil
        watchdogTask?.cancel()
        watchdogTask = nil
        nextRetryAt = nil
        hadConnected = false
        reconnectAttempt = 0
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

    func resumeSession(_ session: SessionSummary) {
        guard session.canResume else {
            lastError = "This session belongs to \(session.originHost ?? "another host"). Connect to that host to resume it."
            return
        }
        currentSession = session
        timeline = []
        approvals = []
        activeApproval = nil
        pendingOpenAfterCreate = true
        send(ClientMessage(type: "resume_session", cwd: session.cwd, runtime: session.runtime, sessionId: session.id))
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
        guard !trimmed.isEmpty, let session = currentSession, !session.isArchived else { return }
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
            lostConnection(reason, generation: connectionGeneration)
        }
    }

    private func handle(_ message: ServerMessage) {
        switch message.type {
        case "hello_ok":
            watchdogTask?.cancel()
            reconnectTask?.cancel()
            reconnectTask = nil
            nextRetryAt = nil
            reconnectAttempt = 0
            hostReachable = true
            if let host = message.host {
                connection = .connected(host)
            }
            sessions = message.sessions ?? []
            lastError = nil
            hadConnected = true
            reconnectAttempt = 0
            if let session = currentSession {
                send(ClientMessage(type: "subscribe", sessionId: session.id))
            }
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
