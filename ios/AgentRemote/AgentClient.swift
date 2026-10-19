import Foundation

@MainActor
final class AgentClient {
    enum Event {
        case opened
        case message(ServerMessage)
        case closed(String?)
    }

    var onEvent: ((Event) -> Void)?

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?

    func connect(url: URL) {
        disconnect()

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 30
        let session = URLSession(configuration: configuration)
        let task = session.webSocketTask(with: url)
        self.session = session
        self.task = task

        task.resume()
        onEvent?(.opened)
        startReceiveLoop()
        startPingLoop()
    }

    func disconnect() {
        receiveTask?.cancel()
        pingTask?.cancel()
        receiveTask = nil
        pingTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }

    func send(_ message: ClientMessage) {
        guard let task else { return }
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(message),
              let text = String(data: data, encoding: .utf8) else { return }
        Task { [weak self] in
            do {
                try await task.send(.string(text))
            } catch {
                self?.onEvent?(.closed(error.localizedDescription))
            }
        }
    }

    private func startReceiveLoop() {
        receiveTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                guard let task = self.task else { break }
                do {
                    let message = try await task.receive()
                    switch message {
                    case .string(let text):
                        self.handle(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            self.handle(text)
                        }
                    @unknown default:
                        break
                    }
                } catch {
                    if !Task.isCancelled {
                        self.onEvent?(.closed(error.localizedDescription))
                    }
                    break
                }
            }
        }
    }

    private func startPingLoop() {
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                guard let task = self?.task else { break }
                task.sendPing { _ in }
            }
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        do {
            let message = try JSONDecoder().decode(ServerMessage.self, from: data)
            onEvent?(.message(message))
        } catch {
            // A stray log line or an incompatible server version should not
            // tear down the socket. Keep the connection and ignore the frame.
            print("AgentClient: ignored frame", error.localizedDescription)
        }
    }
}
