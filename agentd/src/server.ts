import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentConfig } from "./config.js";
import type { DshAdapter } from "./acp/dsh.js";
import { assertWithinRoots, log, now, tokenEquals } from "./util.js";
import type { HostInfo, SessionSummary } from "./types.js";

interface ClientState {
  ws: WebSocket;
  authed: boolean;
  sessionId?: string;
  deviceName?: string;
  helloTimeout: NodeJS.Timeout;
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export interface AgentServer {
  server: http.Server;
  close: () => Promise<void>;
  sessionCount: () => number;
}

export function createAgentServer(config: AgentConfig, adapter: DshAdapter): AgentServer {
  const clients = new Map<WebSocket, ClientState>();
  const startedAt = now();

  const host: HostInfo = {
    name: config.hostName,
    version: config.version,
    platform: process.platform,
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

  function broadcast(payload: unknown, predicate?: (client: ClientState) => boolean): void {
    for (const client of clients.values()) {
      if (!client.authed) continue;
      if (predicate && !predicate(client)) continue;
      send(client.ws, payload);
    }
  }

  function sendSessionList(): void {
    broadcast({ type: "sessions", sessions: adapter.listSessions() });
  }

  function handleMessage(client: ClientState, raw: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      send(client.ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    const type = String(message.type ?? "");

    if (type === "hello") {
      if (client.authed) return;
      const token = String(message.token ?? "");
      if (!tokenEquals(config.token, token)) {
        send(client.ws, { type: "error", message: "Invalid token" });
        client.ws.close(1008, "Invalid token");
        return;
      }
      client.authed = true;
      client.deviceName = typeof message.deviceName === "string" ? message.deviceName : undefined;
      clearTimeout(client.helloTimeout);
      send(client.ws, {
        type: "hello_ok",
        host,
        version: config.version,
        sessions: adapter.listSessions(),
      });
      return;
    }

    if (!client.authed) {
      send(client.ws, { type: "error", message: "Authenticate with hello first" });
      client.ws.close(1008, "Not authenticated");
      return;
    }

    switch (type) {
      case "list_sessions":
        send(client.ws, { type: "sessions", sessions: adapter.listSessions() });
        break;

      case "create_session": {
        try {
          const cwd = assertWithinRoots(String(message.cwd ?? ""), config.roots);
          void adapter
            .newSession(cwd)
            .then((session) => {
              client.sessionId = session.id;
              send(client.ws, { type: "session", session });
              sendSessionList();
              const snapshot = adapter.snapshot(session.id);
              if (snapshot) send(client.ws, { type: "snapshot", ...snapshot });
            })
            .catch((error: unknown) => {
              send(client.ws, {
                type: "error",
                message: error instanceof Error ? error.message : String(error),
              });
            });
        } catch (error) {
          send(client.ws, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case "resume_session": {
        try {
          const sessionId = String(message.sessionId ?? "");
          const existing = adapter.getSession(sessionId);
          const cwd = assertWithinRoots(
            String(message.cwd ?? existing?.cwd ?? ""),
            config.roots,
          );
          void adapter
            .resumeSession(sessionId, cwd)
            .then((session) => {
              client.sessionId = session.id;
              send(client.ws, { type: "session", session });
              sendSessionList();
              const snapshot = adapter.snapshot(session.id);
              if (snapshot) send(client.ws, { type: "snapshot", ...snapshot });
            })
            .catch((error: unknown) => {
              send(client.ws, {
                type: "error",
                message: error instanceof Error ? error.message : String(error),
              });
            });
        } catch (error) {
          send(client.ws, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case "subscribe": {
        const sessionId = String(message.sessionId ?? "");
        const snapshot = adapter.snapshot(sessionId);
        if (!snapshot) {
          send(client.ws, { type: "error", message: `Unknown session: ${sessionId}` });
          break;
        }
        client.sessionId = sessionId;
        send(client.ws, { type: "snapshot", ...snapshot });
        break;
      }

      case "close_session": {
        const sessionId = String(message.sessionId ?? "");
        void adapter.closeSession(sessionId).catch((error: unknown) => {
          send(client.ws, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        });
        break;
      }

      case "prompt": {
        const sessionId = String(message.sessionId ?? "");
        const text = String(message.text ?? "").trim();
        if (!text) {
          send(client.ws, { type: "error", message: "Prompt is empty" });
          break;
        }
        void adapter.prompt(sessionId, text).catch((error: unknown) => {
          send(client.ws, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        });
        break;
      }

      case "cancel": {
        adapter.cancel(String(message.sessionId ?? ""));
        break;
      }

      case "set_model": {
        const sessionId = String(message.sessionId ?? "");
        const value = String(message.value ?? "");
        void adapter
          .setModel(sessionId, value)
          .then((configOptions) => {
            send(client.ws, { type: "models", sessionId, configOptions });
          })
          .catch((error: unknown) => {
            send(client.ws, {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          });
        break;
      }

      case "approve": {
        const approvalId = String(message.approvalId ?? "");
        const optionId = String(message.optionId ?? "");
        if (!approvalId || !optionId) {
          send(client.ws, { type: "error", message: "approvalId and optionId are required" });
          break;
        }
        if (!adapter.resolveApproval(approvalId, optionId)) {
          send(client.ws, { type: "error", message: "Approval is no longer pending" });
        }
        break;
      }

      case "ping":
        send(client.ws, { type: "pong", at: now() });
        break;

      default:
        send(client.ws, { type: "error", message: `Unknown message type: ${type}` });
        break;
    }
  }

  wss.on("connection", (ws: WebSocket) => {
    const client: ClientState = {
      ws,
      authed: false,
      helloTimeout: setTimeout(() => {
        if (!client.authed) ws.close(1008, "Hello timeout");
      }, 10_000),
    };
    client.helloTimeout.unref?.();
    clients.set(ws, client);

    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      handleMessage(client, text);
    });

    ws.on("close", () => {
      clearTimeout(client.helloTimeout);
      clients.delete(ws);
    });

    ws.on("error", (error) => {
      log(`websocket error: ${error.message}`);
    });
  });

  // Adapter events are authoritative; the server fans them out.
  adapter.on("session", (session: SessionSummary) => {
    broadcast({ type: "session", session });
    sendSessionList();
  });
  adapter.on("event", ({ sessionId, event }) => {
    broadcast({ type: "event", sessionId, event });
  });
  adapter.on("approval", (approval) => {
    broadcast({ type: "approval", approval });
  });
  adapter.on("approval_resolved", (resolution) => {
    broadcast({ type: "approval_resolved", ...resolution });
  });
  adapter.on("config", ({ sessionId, configOptions, model }) => {
    broadcast({ type: "models", sessionId, configOptions, model });
  });
  adapter.on("session_removed", ({ sessionId }) => {
    broadcast({ type: "session_removed", sessionId });
    sendSessionList();
  });
  adapter.on("error", ({ message }) => {
    broadcast({ type: "error", message });
  });
  adapter.on("exit", ({ reason }) => {
    broadcast({ type: "error", message: reason });
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          version: config.version,
          host: config.hostName,
          sessions: adapter.listSessions().length,
          uptimeMs: now() - startedAt,
        }),
      );
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        `Agent Remote agentd ${config.version}\n\nConnect the iOS app to:\n${config.publicUrl}\n`,
      );
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  async function close(): Promise<void> {
    for (const client of clients.values()) {
      try {
        client.ws.close(1001, "Server shutting down");
      } catch {
        // ignore
      }
    }
    clients.clear();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return {
    server,
    close,
    sessionCount: () => adapter.listSessions().length,
  };
}
