import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { AcpClient } from "./client.js";
import {
  asRecord,
  log,
  now,
  pickString,
  shortTitle,
} from "../util.js";
import type {
  AgentEvent,
  Approval,
  ApprovalOption,
  ConfigOption,
  SessionRecord,
  SessionSummary,
} from "../types.js";
import { modelDisplayValue } from "../types.js";

export interface DshAdapterOptions {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  logger?: (line: string) => void;
}

interface ToolState {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: Record<string, unknown>;
  output?: string;
}

interface PendingApproval {
  approval: Approval;
  requestId: number;
  sessionId: string;
  timer: NodeJS.Timeout;
}

const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_EVENTS = 2000;

function normalizeOptions(raw: unknown): ApprovalOption[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject-once", name: "Reject", kind: "reject_once" },
    ];
  }
  return raw.map((entry) => {
    const record = asRecord(entry);
    return {
      optionId: pickString(record.optionId, "reject-once"),
      name: pickString(record.name, pickString(record.optionId, "Option")),
      kind: pickString(record.kind) || undefined,
    };
  });
}

function toolOutput(update: Record<string, unknown>): string | undefined {
  const content = update.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const entry of content) {
      const record = asRecord(entry);
      const inner = asRecord(record.content);
      const text = pickString(inner.text) || pickString(record.text);
      if (text) parts.push(text);
    }
    if (parts.length > 0) return parts.join("\n");
  }
  const raw = pickString(update.rawOutput);
  return raw || undefined;
}

export class DshAdapter extends EventEmitter {
  private client?: AcpClient;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly toolCalls = new Map<string, ToolState>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private closed = false;

  constructor(private readonly options: DshAdapterOptions) {
    super();
  }

  async start(): Promise<void> {
    this.client = new AcpClient({
      command: this.options.command,
      args: this.options.args,
      env: this.options.env,
      logger: this.options.logger ?? ((line) => log(line)),
    });

    this.client.on("notification", (message: unknown) => {
      const record = asRecord(message);
      if (pickString(record.method) === "session/update") {
        this.handleSessionUpdate(asRecord(record.params));
      }
    });

    this.client.on("serverRequest", (message: unknown) => {
      this.handleServerRequest(asRecord(message));
    });

    this.client.on("exit", (info: unknown) => {
      this.closed = true;
      const record = asRecord(info);
      const reason = `DSH exited (${pickString(String(record.code ?? record.signal ?? "unknown"))})`;
      for (const session of this.sessions.values()) {
        if (session.status === "running" || session.status === "awaiting_approval") {
          session.status = "error";
        }
      }
      for (const [approvalId] of this.pendingApprovals) {
        this.cancelApproval(approvalId, "DSH process exited");
      }
      this.emit("exit", { reason });
    });

    this.client.on("error", (error: unknown) => {
      this.emit("error", { message: error instanceof Error ? error.message : String(error) });
    });

    const init = await this.client.request<Record<string, unknown>>(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
      20_000,
    );

    this.emit("ready", { agentInfo: init.agentInfo, capabilities: init.agentCapabilities });
  }

  listSessions(): SessionSummary[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => this.summarize(session));
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  snapshot(sessionId: string): {
    session: SessionSummary;
    events: AgentEvent[];
    approvals: Approval[];
    configOptions: ConfigOption[];
  } | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return {
      session: this.summarize(session),
      events: session.events.slice(-500),
      approvals: [...session.pendingApprovals],
      configOptions: session.configOptions,
    };
  }

  async newSession(cwd: string): Promise<SessionSummary> {
    const client = this.requireClient();
    const result = await client.request<Record<string, unknown>>(
      "session/new",
      { cwd, mcpServers: [] },
      60_000,
    );
    const sessionId = pickString(result.sessionId);
    if (!sessionId) throw new Error("DSH did not return a sessionId");

    const configOptions = this.normalizeConfigOptions(result.configOptions);
    const session: SessionRecord = {
      id: sessionId,
      title: path.basename(cwd) || "Session",
      cwd,
      status: "idle",
      runtime: "dsh",
      model: modelDisplayValue(configOptions.find((option) => option.id === "model")),
      createdAt: now(),
      updatedAt: now(),
      events: [],
      seq: 0,
      configOptions,
      pendingApprovals: [],
    };
    this.sessions.set(sessionId, session);
    this.emit("session", this.summarize(session));
    return this.summarize(session);
  }

  async resumeSession(sessionId: string, cwd: string): Promise<SessionSummary> {
    const client = this.requireClient();
    const result = await client.request<Record<string, unknown>>(
      "session/resume",
      { sessionId, cwd, mcpServers: [] },
      60_000,
    );
    const configOptions = this.normalizeConfigOptions(result.configOptions);
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        title: path.basename(cwd) || "Session",
        cwd,
        status: "idle",
        runtime: "dsh",
        model: modelDisplayValue(configOptions.find((option) => option.id === "model")),
        createdAt: now(),
        updatedAt: now(),
        events: [],
        seq: 0,
        configOptions,
        pendingApprovals: [],
      };
      this.sessions.set(sessionId, session);
    } else {
      session.configOptions = configOptions;
      session.model = modelDisplayValue(configOptions.find((option) => option.id === "model"));
      session.status = "idle";
      session.updatedAt = now();
    }
    this.emit("session", this.summarize(session));
    return this.summarize(session);
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const session = this.requireSession(sessionId);
    if (session.status === "running" || session.status === "awaiting_approval") {
      throw new Error("Session is busy");
    }

    this.appendEvent(session, { type: "user_message", text });
    session.status = "running";
    session.updatedAt = now();
    if (!session.title || session.title === path.basename(session.cwd)) {
      session.title = shortTitle(text, session.title);
    }
    this.emit("session", this.summarize(session));

    try {
      const result = await this.requireClient().request<Record<string, unknown>>(
        "session/prompt",
        { sessionId, prompt: [{ type: "text", text }] },
        30 * 60 * 1000,
      );
      session.status = "idle";
      session.updatedAt = now();
      this.appendEvent(session, {
        type: "turn_end",
        stopReason: pickString(result.stopReason, "end_turn"),
      });
      this.emit("session", this.summarize(session));
    } catch (error) {
      session.status = "error";
      session.updatedAt = now();
      const message = error instanceof Error ? error.message : String(error);
      this.appendEvent(session, { type: "error", message });
      this.emit("session", this.summarize(session));
      throw error;
    }
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.requireClient().notify("session/cancel", { sessionId });
    session.status = "idle";
    session.updatedAt = now();
    this.appendEvent(session, { type: "notice", text: "Cancelled" });
    this.emit("session", this.summarize(session));
  }

  async setModel(sessionId: string, value: string): Promise<ConfigOption[]> {
    const session = this.requireSession(sessionId);
    const result = await this.requireClient().request<Record<string, unknown>>(
      "session/set_config_option",
      { sessionId, configId: "model", value },
      30_000,
    );
    session.configOptions = this.normalizeConfigOptions(result.configOptions);
    session.model = modelDisplayValue(session.configOptions.find((option) => option.id === "model"));
    session.updatedAt = now();
    this.emit("config", {
      sessionId,
      configOptions: session.configOptions,
      model: session.model,
    });
    return session.configOptions;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const approval of [...session.pendingApprovals]) {
      this.cancelApproval(approval.id, "Session closed");
    }
    try {
      await this.requireClient().request("session/close", { sessionId }, 15_000);
    } catch (error) {
      log(`session/close failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.sessions.delete(sessionId);
    this.emit("session_removed", { sessionId });
  }

  resolveApproval(approvalId: string, optionId: string): boolean {
    const entry = this.pendingApprovals.get(approvalId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pendingApprovals.delete(approvalId);

    const session = this.sessions.get(entry.sessionId);
    if (session) {
      session.pendingApprovals = session.pendingApprovals.filter((item) => item.id !== approvalId);
      session.status = "running";
      session.updatedAt = now();
      this.emit("session", this.summarize(session));
    }

    this.requireClient().respond(entry.requestId, {
      outcome: { outcome: "selected", optionId },
    });
    this.emit("approval_resolved", {
      approvalId,
      sessionId: entry.sessionId,
      optionId,
      decision: optionId,
    });
    return true;
  }

  private cancelApproval(approvalId: string, reason: string): void {
    const entry = this.pendingApprovals.get(approvalId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pendingApprovals.delete(approvalId);
    const session = this.sessions.get(entry.sessionId);
    if (session) {
      session.pendingApprovals = session.pendingApprovals.filter((item) => item.id !== approvalId);
      if (session.status === "awaiting_approval") session.status = "running";
      session.updatedAt = now();
      this.emit("session", this.summarize(session));
    }
    try {
      this.requireClient().respond(entry.requestId, { outcome: { outcome: "cancelled" } });
    } catch {
      // The process may already be gone.
    }
    this.emit("approval_resolved", {
      approvalId,
      sessionId: entry.sessionId,
      decision: "cancelled",
      reason,
    });
  }

  private handleServerRequest(message: Record<string, unknown>): void {
    const id = Number(message.id);
    const method = pickString(message.method);
    if (method !== "session/request_permission") {
      this.requireClient().respondError(id, -32601, `Unsupported client method: ${method}`);
      return;
    }

    const params = asRecord(message.params);
    const sessionId = pickString(params.sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.requireClient().respondError(id, -32602, "Unknown session");
      return;
    }

    const toolCall = asRecord(params.toolCall);
    const toolCallId = pickString(toolCall.toolCallId);
    const tool = toolCallId ? this.toolCalls.get(toolCallId) : undefined;
    const rawInput = tool?.rawInput ?? {};
    const approval: Approval = {
      id: randomUUID(),
      sessionId,
      toolCallId: toolCallId || undefined,
      title: tool?.title || "Tool action",
      command: pickString(rawInput.command) || undefined,
      cwd: pickString(rawInput.cwd) || session.cwd,
      justification:
        pickString(rawInput.justification) || pickString(rawInput.description) || undefined,
      sandbox: pickString(rawInput.sandbox_permissions) || undefined,
      kind: tool?.kind,
      options: normalizeOptions(params.options),
      createdAt: now(),
    };

    const timer = setTimeout(() => {
      this.cancelApproval(approval.id, "Approval timed out");
    }, APPROVAL_TIMEOUT_MS);
    timer.unref?.();

    this.pendingApprovals.set(approval.id, { approval, requestId: id, sessionId, timer });
    session.pendingApprovals.push(approval);
    session.status = "awaiting_approval";
    session.updatedAt = now();
    this.emit("approval", approval);
    this.emit("session", this.summarize(session));
  }

  private handleSessionUpdate(params: Record<string, unknown>): void {
    const sessionId = pickString(params.sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) {
      log(`update for unknown session ${sessionId}`);
      return;
    }
    const update = asRecord(params.update);
    const kind = pickString(update.sessionUpdate);

    switch (kind) {
      case "agent_message_chunk": {
        const text = pickString(asRecord(update.content).text);
        if (text) this.appendEvent(session, { type: "assistant_delta", text });
        break;
      }
      case "agent_thought_chunk": {
        const text = pickString(asRecord(update.content).text);
        if (text) this.appendEvent(session, { type: "thought_delta", text });
        break;
      }
      case "tool_call": {
        const toolCallId = pickString(update.toolCallId);
        if (!toolCallId) break;
        const rawInput = asRecord(update.rawInput);
        const tool: ToolState = {
          toolCallId,
          title: pickString(update.title) || undefined,
          kind: pickString(update.kind) || undefined,
          status: pickString(update.status) || undefined,
          rawInput,
        };
        this.toolCalls.set(toolCallId, tool);
        this.appendEvent(session, {
          type: "tool_call",
          toolCallId,
          title: tool.title,
          kind: tool.kind,
          status: tool.status,
          command: pickString(rawInput.command) || undefined,
          cwd: pickString(rawInput.cwd) || session.cwd,
        });
        break;
      }
      case "tool_call_update": {
        const toolCallId = pickString(update.toolCallId);
        if (!toolCallId) break;
        const previous = this.toolCalls.get(toolCallId) ?? { toolCallId };
        const tool: ToolState = {
          ...previous,
          status: pickString(update.status) || previous.status,
          output: toolOutput(update) ?? previous.output,
        };
        this.toolCalls.set(toolCallId, tool);
        this.appendEvent(session, {
          type: "tool_update",
          toolCallId,
          status: tool.status,
          output: tool.output,
        });
        break;
      }
      case "usage_update": {
        this.appendEvent(session, {
          type: "usage",
          used: typeof update.used === "number" ? update.used : undefined,
          size: typeof update.size === "number" ? update.size : undefined,
        });
        break;
      }
      case "config_option_update": {
        session.configOptions = this.normalizeConfigOptions(update.configOptions);
        session.model = modelDisplayValue(
          session.configOptions.find((option) => option.id === "model"),
        );
        this.emit("config", {
          sessionId,
          configOptions: session.configOptions,
          model: session.model,
        });
        break;
      }
      default:
        this.appendEvent(session, {
          type: "notice",
          text: `update: ${kind || "unknown"}`,
        });
        break;
    }
  }

  private normalizeConfigOptions(raw: unknown): ConfigOption[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const record = asRecord(entry);
      return {
        id: pickString(record.id),
        name: pickString(record.name, pickString(record.id)),
        category: pickString(record.category) || undefined,
        type: pickString(record.type, "select"),
        currentValue: pickString(record.currentValue) || undefined,
        options: Array.isArray(record.options)
          ? (record.options as ConfigOption["options"])
          : undefined,
      };
    });
  }

  private appendEvent(session: SessionRecord, data: Omit<AgentEvent, "seq">): void {
    const event: AgentEvent = { seq: ++session.seq, ...data };
    session.events.push(event);
    if (session.events.length > MAX_EVENTS) {
      session.events.splice(0, session.events.length - MAX_EVENTS);
    }
    session.updatedAt = now();
    this.emit("event", { sessionId: session.id, event });
  }

  private summarize(session: SessionRecord): SessionSummary {
    return {
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      status: session.status,
      runtime: session.runtime,
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private requireClient(): AcpClient {
    if (!this.client || this.closed) throw new Error("DSH is not running");
    return this.client;
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return session;
  }

  async dispose(): Promise<void> {
    this.closed = true;
    for (const [approvalId] of this.pendingApprovals) {
      this.cancelApproval(approvalId, "Shutting down");
    }
    await this.client?.close();
    this.client = undefined;
  }
}
