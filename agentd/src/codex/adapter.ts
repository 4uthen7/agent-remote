import type { ChildProcessWithoutNullStreams } from "node:child_process";
import spawn from "cross-spawn";
import { EventEmitter } from "node:events";
import path from "node:path";
import readline from "node:readline";
import { asRecord, log, now, pickString, shortTitle } from "../util.js";
import type {
  AgentEvent,
  Approval,
  ConfigOption,
  ConfigOptionValue,
  SessionRecord,
  SessionSummary,
} from "../types.js";
import { isConfigGroup, modelDisplayValue } from "../types.js";
import type { RuntimeAdapter, RuntimeSnapshot } from "../runtime/types.js";

const MAX_EVENTS = 2000;
const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;

export interface CodexAdapterOptions {
  command: string;
  logger?: (line: string) => void;
}

interface CodexSessionState {
  threadId: string;
  model: string;
  configOptions: ConfigOption[];
  turnId?: string;
  streamedMessages: Set<string>;
  reasonedByDelta: Set<string>;
  toolOutputs: Map<string, string>;
}

interface PendingApproval {
  sessionId: string;
  requestId: number | string;
  timer: NodeJS.Timeout;
}

class CodexClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly command: string,
    private readonly logger: (line: string) => void,
  ) {
    super();
  }

  start(): void {
    const child = spawn(this.command, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (data) => this.logger(data.toString().trim()));
    child.on("error", (error) => this.fail(error));
    child.on("exit", (code, signal) => {
      this.fail(new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`));
    });
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.logger(line);
      return;
    }

    if (message.id !== undefined && ("result" in message || "error" in message)) {
      const id = Number(message.id);
      const waiter = this.pending.get(id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(id);
      if (message.error) {
        waiter.reject(new Error(String(asRecord(message.error).message ?? "Codex request failed")));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string" && message.id !== undefined) {
      this.emit("serverRequest", message);
      return;
    }

    if (typeof message.method === "string") {
      this.emit("notification", message);
    }
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    const child = this.child;
    if (!child?.stdin.writable) {
      return Promise.reject(new Error("Codex app-server is not running"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  respond(id: number | string, result: unknown): void {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id: number | string, message: string): void {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(
      `${JSON.stringify({ id, error: { code: -32601, message } })}\n`,
    );
  }

  close(): void {
    this.fail(new Error("Codex adapter closed"));
    this.child?.kill();
    this.child = undefined;
  }

  private fail(error: Error): void {
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
      this.pending.delete(id);
    }
    this.emit("exit", { reason: error.message });
  }
}

export class CodexAdapter extends EventEmitter implements RuntimeAdapter {
  private client?: CodexClient;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly states = new Map<string, CodexSessionState>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private models: ConfigOption[] = [];

  constructor(private readonly options: CodexAdapterOptions) {
    super();
  }

  async start(): Promise<void> {
    if (this.client) return;
    const client = new CodexClient(this.options.command, this.options.logger ?? log);
    this.client = client;

    client.on("notification", (message: unknown) => this.handleNotification(asRecord(message)));
    client.on("serverRequest", (message: unknown) => this.handleServerRequest(asRecord(message)));
    client.on("exit", (info: unknown) => {
      const reason = pickString(asRecord(info).reason, "Codex app-server exited");
      for (const session of this.sessions.values()) {
        if (session.status === "running" || session.status === "awaiting_approval") {
          session.status = "error";
          this.emitSession(session);
        }
      }
      for (const [approvalId] of this.pendingApprovals) {
        this.cancelApproval(approvalId);
      }
      this.emit("exit", { reason });
    });
    client.on("error", (error: unknown) => {
      this.emit("error", { message: error instanceof Error ? error.message : String(error) });
    });

    client.start();
    await client.request(
      "initialize",
      {
        clientInfo: { name: "agent-remote", title: "Agent Remote", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
      20_000,
    );
    await this.loadModels();
  }

  private async loadModels(): Promise<void> {
    try {
      const result = await this.client?.request<Record<string, unknown>>(
        "model/list",
        { limit: 200 },
        20_000,
      );
      const data = Array.isArray(result?.data) ? result.data : [];
      const options = data
        .map((entry) => asRecord(entry))
        .filter((entry) => entry.hidden !== true)
        .map((entry) => ({
          value: pickString(entry.model, pickString(entry.id)),
          name: pickString(entry.displayName, pickString(entry.model, "Model")),
        }))
        .filter((entry) => entry.value);
      if (options.length > 0) {
        this.models = [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            options,
          },
        ];
      }
    } catch (error) {
      this.options.logger?.(
        `codex model/list failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  listSessions(): SessionSummary[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => this.summarize(session));
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  snapshot(sessionId: string): RuntimeSnapshot | undefined {
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
    const baseParams = {
      cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      serviceName: "agent-remote",
    };
    let result: Record<string, unknown>;
    try {
      result = await client.request<Record<string, unknown>>(
        "thread/start",
        { ...baseParams, sandbox: "workspace-write" },
        60_000,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Codex's Windows sandbox support varies by release. If the configured
      // sandbox is rejected, fall back to the CLI's own platform default.
      if (process.platform !== "win32" || !/sandbox|unsupported|not supported/i.test(message)) {
        throw error;
      }
      this.options.logger?.(`codex sandbox unavailable on Windows; using CLI default: ${message}`);
      result = await client.request<Record<string, unknown>>("thread/start", baseParams, 60_000);
    }
    const thread = asRecord(result.thread);
    const threadId = pickString(thread.id);
    if (!threadId) throw new Error("Codex did not return a thread id");
    const model = pickString(result.model, "default");
    const configOptions = this.buildConfigOptions(model);
    const session: SessionRecord = {
      id: threadId,
      title: shortTitle(pickString(thread.preview), path.basename(cwd) || "Codex session"),
      cwd,
      status: "idle",
      runtime: "codex",
      model: modelDisplayValue(configOptions.find((option) => option.id === "model")),
      createdAt: now(),
      updatedAt: now(),
      events: [],
      seq: 0,
      configOptions,
      pendingApprovals: [],
    };
    this.sessions.set(threadId, session);
    this.states.set(threadId, {
      threadId,
      model,
      configOptions,
      streamedMessages: new Set(),
      reasonedByDelta: new Set(),
      toolOutputs: new Map(),
    });
    this.emit("session", this.summarize(session));
    return this.summarize(session);
  }

  async resumeSession(sessionId: string, cwd: string): Promise<SessionSummary> {
    const result = await this.requireClient().request<Record<string, unknown>>(
      "thread/resume",
      { threadId: sessionId },
      60_000,
    );
    const thread = asRecord(result.thread);
    const threadId = pickString(thread.id, sessionId);
    const model = pickString(result.model, "default");
    const configOptions = this.buildConfigOptions(model);
    const session: SessionRecord = {
      id: threadId,
      title: shortTitle(pickString(thread.preview), path.basename(cwd) || "Codex session"),
      cwd,
      status: "idle",
      runtime: "codex",
      model: modelDisplayValue(configOptions.find((option) => option.id === "model")),
      createdAt: now(),
      updatedAt: now(),
      events: [],
      seq: 0,
      configOptions,
      pendingApprovals: [],
    };
    this.sessions.set(threadId, session);
    this.states.set(threadId, {
      threadId,
      model,
      configOptions,
      streamedMessages: new Set(),
      reasonedByDelta: new Set(),
      toolOutputs: new Map(),
    });
    this.emit("session", this.summarize(session));
    return this.summarize(session);
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const state = this.requireState(sessionId);
    if (session.status === "running" || session.status === "awaiting_approval") {
      throw new Error("Session is busy");
    }
    session.status = "running";
    session.updatedAt = now();
    this.addEvent(session, { type: "user_message", text });
    state.turnId = undefined;
    state.streamedMessages.clear();
    state.reasonedByDelta.clear();
    this.emitSession(session);

    try {
      const result = await this.requireClient().request<Record<string, unknown>>(
        "turn/start",
        {
          threadId: state.threadId,
          input: [{ type: "text", text, text_elements: [] }],
          model: state.model,
        },
        30_000,
      );
      const turn = asRecord(result.turn);
      state.turnId = pickString(turn.id);
    } catch (error) {
      session.status = "error";
      session.updatedAt = now();
      this.addEvent(session, {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      this.emitSession(session);
      throw error;
    }
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    const state = this.states.get(sessionId);
    if (!session || !state?.turnId) return;
    void this.requireClient()
      .request("turn/interrupt", { threadId: state.threadId }, 15_000)
      .catch(() => undefined);
    session.status = "idle";
    session.updatedAt = now();
    this.addEvent(session, { type: "notice", text: "Cancelled" });
    this.emitSession(session);
  }

  async setModel(sessionId: string, value: string): Promise<ConfigOption[]> {
    const session = this.requireSession(sessionId);
    const state = this.requireState(sessionId);
    const option = state.configOptions.find((entry) => entry.id === "model");
    if (!option) throw new Error("Codex model options are unavailable");
    const values = this.flatValues(option);
    if (!values.some((entry) => entry.value === value)) {
      throw new Error(`Unknown Codex model: ${value}`);
    }
    option.currentValue = value;
    state.model = value;
    session.model = modelDisplayValue(option);
    session.configOptions = state.configOptions;
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
      this.cancelApproval(approval.id);
    }
    try {
      await this.requireClient().request("thread/unsubscribe", { threadId: sessionId }, 10_000);
    } catch {
      // Best effort; the thread can remain on disk.
    }
    this.sessions.delete(sessionId);
    this.states.delete(sessionId);
    this.emit("session_removed", { sessionId });
  }

  resolveApproval(approvalId: string, optionId: string): boolean {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(approvalId);
    const session = this.sessions.get(pending.sessionId);
    if (session) {
      session.pendingApprovals = session.pendingApprovals.filter((item) => item.id !== approvalId);
      session.status = "running";
      session.updatedAt = now();
      this.emitSession(session);
    }
    const decision = optionId === "accept" || optionId === "allow-once" ? "accept" : "decline";
    this.requireClient().respond(pending.requestId, { decision });
    this.emit("approval_resolved", {
      approvalId,
      sessionId: pending.sessionId,
      optionId,
      decision,
    });
    return true;
  }

  async dispose(): Promise<void> {
    for (const [approvalId] of this.pendingApprovals) {
      this.cancelApproval(approvalId);
    }
    this.sessions.clear();
    this.states.clear();
    this.client?.close();
    this.client = undefined;
  }

  private handleNotification(message: Record<string, unknown>): void {
    const method = pickString(message.method);
    const params = asRecord(message.params);
    const threadId = pickString(params.threadId);
    const session = this.sessions.get(threadId);
    if (!session) return;
    const state = this.states.get(threadId);
    if (!state) return;
    const turnId = pickString(params.turnId);
    if (state.turnId && turnId && turnId !== state.turnId) return;

    switch (method) {
      case "turn/started": {
        state.turnId = pickString(asRecord(params.turn).id, state.turnId);
        session.status = "running";
        this.emitSession(session);
        break;
      }
      case "item/started":
        this.handleItemStarted(session, asRecord(params.item));
        break;
      case "item/completed":
        this.handleItemCompleted(session, state, asRecord(params.item));
        break;
      case "item/agentMessage/delta": {
        const itemId = pickString(params.itemId);
        const delta = pickString(params.delta);
        if (!delta) break;
        state.streamedMessages.add(itemId);
        this.addEvent(session, { type: "assistant_delta", text: delta });
        break;
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const itemId = pickString(params.itemId);
        const delta = pickString(params.delta);
        if (!delta) break;
        state.reasonedByDelta.add(itemId);
        this.addEvent(session, { type: "thought_delta", text: delta });
        break;
      }
      case "item/commandExecution/outputDelta": {
        const itemId = pickString(params.itemId);
        const delta = pickString(params.delta);
        if (!delta) break;
        state.toolOutputs.set(itemId, `${state.toolOutputs.get(itemId) ?? ""}${delta}`);
        break;
      }
      case "thread/tokenUsage/updated": {
        const usage = asRecord(params.tokenUsage);
        const total = asRecord(usage.total);
        const used = Number(total.totalTokens ?? 0);
        const size = Number(usage.modelContextWindow ?? 0);
        if (used > 0) {
          this.addEvent(session, { type: "usage", used, size });
        }
        break;
      }
      case "turn/completed": {
        const turn = asRecord(params.turn);
        const status = pickString(turn.status, "completed");
        const error = asRecord(turn.error);
        session.status = status === "failed" ? "error" : "idle";
        session.updatedAt = now();
        if (status === "failed") {
          this.addEvent(session, {
            type: "error",
            message: pickString(error.message, "Codex turn failed"),
          });
        }
        this.addEvent(session, { type: "turn_end", stopReason: status });
        state.turnId = undefined;
        this.emitSession(session);
        break;
      }
      case "error": {
        const error = asRecord(params.error);
        session.status = "error";
        this.addEvent(session, {
          type: "error",
          message: pickString(error.message, "Codex error"),
        });
        this.emitSession(session);
        break;
      }
      case "thread/status/changed": {
        const status = asRecord(params.status);
        if (pickString(status.type) === "active" && session.status === "idle") {
          session.status = "running";
          this.emitSession(session);
        }
        break;
      }
      default:
        break;
    }
  }

  private handleItemStarted(session: SessionRecord, item: Record<string, unknown>): void {
    const type = pickString(item.type);
    const itemId = pickString(item.id);
    if (!itemId) return;
    if (type === "commandExecution") {
      this.addEvent(session, {
        type: "tool_call",
        toolCallId: itemId,
        title: "bash",
        kind: "command",
        status: pickString(item.status, "in_progress"),
        command: pickString(item.command),
        cwd: pickString(item.cwd, session.cwd),
      });
    } else if (type === "fileChange") {
      this.addEvent(session, {
        type: "tool_call",
        toolCallId: itemId,
        title: "file change",
        kind: "edit",
        status: pickString(item.status, "in_progress"),
        cwd: session.cwd,
      });
    } else if (type === "mcpToolCall") {
      this.addEvent(session, {
        type: "tool_call",
        toolCallId: itemId,
        title: `${pickString(item.server, "mcp")}.${pickString(item.tool, "tool")}`,
        kind: "mcp",
        status: pickString(item.status, "in_progress"),
        command: JSON.stringify(item.arguments ?? {}).slice(0, 1000),
        cwd: session.cwd,
      });
    } else if (type === "webSearch") {
      this.addEvent(session, {
        type: "tool_call",
        toolCallId: itemId,
        title: "web search",
        kind: "search",
        status: "in_progress",
        command: JSON.stringify(item.query ?? item.action ?? {}).slice(0, 1000),
        cwd: session.cwd,
      });
    }
  }

  private handleItemCompleted(
    session: SessionRecord,
    state: CodexSessionState,
    item: Record<string, unknown>,
  ): void {
    const type = pickString(item.type);
    const itemId = pickString(item.id);
    if (!itemId) return;
    if (type === "agentMessage") {
      const text = pickString(item.text);
      if (text && !state.streamedMessages.has(itemId)) {
        this.addEvent(session, { type: "assistant_delta", text });
      }
    } else if (type === "reasoning") {
      if (state.reasonedByDelta.has(itemId)) return;
      const summary = Array.isArray(item.summary) ? item.summary.map(String) : [];
      const content = Array.isArray(item.content) ? item.content.map(String) : [];
      const text = [...summary, ...content].filter(Boolean).join("\n");
      if (text) this.addEvent(session, { type: "thought_delta", text });
    } else if (
      type === "commandExecution" ||
      type === "fileChange" ||
      type === "mcpToolCall" ||
      type === "webSearch"
    ) {
      const status = pickString(item.status, "completed");
      const output =
        pickString(item.aggregatedOutput) ||
        state.toolOutputs.get(itemId) ||
        (item.error ? JSON.stringify(item.error) : undefined);
      this.addEvent(session, {
        type: "tool_update",
        toolCallId: itemId,
        status,
        output,
      });
    }
  }

  private handleServerRequest(message: Record<string, unknown>): void {
    const method = pickString(message.method);
    const id = message.id;
    if (id === undefined || (typeof id !== "number" && typeof id !== "string")) return;
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval" ||
      method === "execCommandApproval"
    ) {
      this.requestApproval(method, id, asRecord(message.params));
      return;
    }
    this.requireClient().respondError(id, `Unsupported Codex request: ${method}`);
  }

  private requestApproval(
    method: string,
    requestId: number | string,
    params: Record<string, unknown>,
  ): void {
    const threadId = pickString(params.threadId);
    const session = this.sessions.get(threadId);
    if (!session) {
      this.requireClient().respond(requestId, { decision: "decline" });
      return;
    }
    const approvalId = `codex-${String(requestId)}-${now()}`;
    const command = pickString(params.command);
    const approval: Approval = {
      id: approvalId,
      sessionId: threadId,
      toolCallId: pickString(params.itemId),
      title: "Codex",
      command: command || undefined,
      cwd: pickString(params.cwd, session.cwd) || undefined,
      justification: pickString(params.reason) || undefined,
      sandbox: "workspace-write",
      kind: "command",
      options: [
        { optionId: "accept", name: "Allow once", kind: "allow_once" },
        { optionId: "decline", name: "Reject", kind: "reject_once" },
      ],
      createdAt: now(),
    };
    const timer = setTimeout(() => this.cancelApproval(approvalId), APPROVAL_TIMEOUT_MS);
    timer.unref?.();
    this.pendingApprovals.set(approvalId, { sessionId: threadId, requestId, timer });
    session.pendingApprovals.push(approval);
    session.status = "awaiting_approval";
    session.updatedAt = now();
    this.emit("approval", approval);
    this.emitSession(session);
  }

  private cancelApproval(approvalId: string): void {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(approvalId);
    const session = this.sessions.get(pending.sessionId);
    if (session) {
      session.pendingApprovals = session.pendingApprovals.filter((item) => item.id !== approvalId);
      session.status = "running";
      session.updatedAt = now();
      this.emitSession(session);
    }
    this.requireClient().respond(pending.requestId, { decision: "decline" });
  }

  private flatValues(option: ConfigOption): ConfigOptionValue[] {
    const values: ConfigOptionValue[] = [];
    for (const entry of option.options ?? []) {
      if (isConfigGroup(entry)) values.push(...entry.options);
      else values.push(entry);
    }
    return values;
  }

  private buildConfigOptions(model: string): ConfigOption[] {
    const flat = this.flatValues(this.models[0] ?? { id: "model", name: "Model", type: "select" });
    if (model && !flat.some((entry) => entry.value === model)) {
      flat.unshift({ value: model, name: model });
    }
    return [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: model,
        options: flat,
      },
    ];
  }

  private addEvent(session: SessionRecord, event: Omit<AgentEvent, "seq">): AgentEvent {
    session.seq += 1;
    const value: AgentEvent = { seq: session.seq, ...event };
    session.events.push(value);
    if (session.events.length > MAX_EVENTS) {
      session.events.splice(0, session.events.length - MAX_EVENTS);
    }
    session.updatedAt = now();
    this.emit("event", { sessionId: session.id, event: value });
    return value;
  }

  private emitSession(session: SessionRecord): void {
    session.updatedAt = now();
    this.emit("session", this.summarize(session));
  }

  private summarize(session: SessionRecord): SessionSummary {
    return {
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      status: session.status,
      runtime: "codex",
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private requireClient(): CodexClient {
    if (!this.client) throw new Error("Codex app-server is not running");
    return this.client;
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return session;
  }

  private requireState(sessionId: string): CodexSessionState {
    const state = this.states.get(sessionId);
    if (!state) throw new Error(`Unknown Codex session: ${sessionId}`);
    return state;
  }
}
