import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { asRecord, log, now, pickString, shortTitle } from "../util.js";
import type {
  AgentEvent,
  Approval,
  ConfigOption,
  ConfigOptionValue,
  SessionRecord,
  SessionSummary,
} from "../types.js";
import type { RuntimeAdapter, RuntimeSnapshot } from "../runtime/types.js";

const MAX_EVENTS = 2000;
const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MODELS: ConfigOptionValue[] = [
  { value: "sonnet", name: "Claude Sonnet" },
  { value: "opus", name: "Claude Opus" },
  { value: "haiku", name: "Claude Haiku" },
];

export interface ClaudeAdapterOptions {
  model?: string;
  logger?: (line: string) => void;
}

interface ClaudeSessionState {
  claudeSessionId?: string;
  model: string;
  configOptions: ConfigOption[];
  running: boolean;
  query?: { interrupt: () => Promise<unknown>; setModel?: (model?: string) => Promise<void> };
  controller?: AbortController;
  sawTextDelta: boolean;
  sawThinkingDelta: boolean;
  sawAssistantText: boolean;
  toolCalls: Set<string>;
  approvals: Set<string>;
  resultHandled: boolean;
}

interface PendingApproval {
  sessionId: string;
  resolve: (result: unknown) => void;
  timer: NodeJS.Timeout;
  resolved: boolean;
}

export class ClaudeAdapter extends EventEmitter implements RuntimeAdapter {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly states = new Map<string, ClaudeSessionState>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(private readonly options: ClaudeAdapterOptions = {}) {
    super();
  }

  async start(): Promise<void> {
    // The Agent SDK resolves and starts the Claude Code process per query.
    // No authentication check is performed here; a prompt surfaces a clear error.
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
    const model = this.options.model?.trim() || "sonnet";
    const configOptions = this.buildConfigOptions(model);
    const session: SessionRecord = {
      id: `claude-${randomUUID()}`,
      title: path.basename(cwd) || "Claude session",
      cwd,
      status: "idle",
      runtime: "claude",
      model: model,
      createdAt: now(),
      updatedAt: now(),
      events: [],
      seq: 0,
      configOptions,
      pendingApprovals: [],
    };
    this.sessions.set(session.id, session);
    this.states.set(session.id, {
      model,
      configOptions,
      running: false,
      sawTextDelta: false,
      sawThinkingDelta: false,
      sawAssistantText: false,
      toolCalls: new Set(),
      approvals: new Set(),
      resultHandled: false,
    });
    this.emit("session", this.summarize(session));
    return this.summarize(session);
  }

  restoreSession(sessionId: string, record: SessionRecord): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.events = record.events.slice();
    session.seq = Math.max(record.seq, ...record.events.map((event) => event.seq), 0);
    session.title = record.title;
    session.createdAt = record.createdAt;
    session.updatedAt = record.updatedAt;
    session.configOptions = record.configOptions;
    session.model = record.model;
    session.status = "idle";
    session.pendingApprovals = [];
  }

  async resumeSession(sessionId: string, cwd: string): Promise<SessionSummary> {
    const model = this.options.model?.trim() || "sonnet";
    const configOptions = this.buildConfigOptions(model);
    const session: SessionRecord = {
      id: sessionId.startsWith("claude-") ? sessionId : `claude-${sessionId}`,
      title: path.basename(cwd) || "Claude session",
      cwd,
      status: "idle",
      runtime: "claude",
      model,
      createdAt: now(),
      updatedAt: now(),
      events: [],
      seq: 0,
      configOptions,
      pendingApprovals: [],
    };
    this.sessions.set(session.id, session);
    this.states.set(session.id, {
      claudeSessionId: sessionId.replace(/^claude-/, ""),
      model,
      configOptions,
      running: false,
      sawTextDelta: false,
      sawThinkingDelta: false,
      sawAssistantText: false,
      toolCalls: new Set(),
      approvals: new Set(),
      resultHandled: false,
    });
    this.emit("session", this.summarize(session));
    return this.summarize(session);
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const state = this.requireState(sessionId);
    if (state.running) throw new Error("Session is busy");

    state.running = true;
    state.sawTextDelta = false;
    state.sawThinkingDelta = false;
    state.sawAssistantText = false;
    state.toolCalls.clear();
    state.resultHandled = false;
    session.status = "running";
    session.updatedAt = now();
    if (session.title === path.basename(session.cwd)) {
      session.title = shortTitle(text, session.title);
    }
    this.addEvent(session, { type: "user_message", text });
    this.emitSession(session);

    const controller = new AbortController();
    state.controller = controller;

    try {
      const q = query({
        prompt: text,
        options: {
          cwd: session.cwd,
          model: state.model,
          resume: state.claudeSessionId,
          abortController: controller,
          includePartialMessages: true,
          permissionMode: "default",
          env: {
            ...process.env,
            CLAUDE_AGENT_SDK_CLIENT_APP: "agent-remote/0.1.0",
          },
          canUseTool: (toolName, input, opts) =>
            this.requestPermission(session, state, toolName, input, opts),
        },
      });
      state.query = q as unknown as ClaudeSessionState["query"];

      for await (const message of q) {
        await this.handleMessage(session, state, message as unknown as Record<string, unknown>);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.status = "error";
      if (!state.resultHandled) {
        state.resultHandled = true;
        this.addEvent(session, { type: "error", message: this.friendlyError(message) });
        this.addEvent(session, { type: "turn_end", stopReason: "error" });
      }
      this.emitSession(session);
    } finally {
      state.running = false;
      state.query = undefined;
      state.controller = undefined;
      this.denyPendingApprovals(sessionId);
      if (!["idle", "error"].includes(session.status)) {
        session.status = "idle";
        this.emitSession(session);
      }
    }
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    const state = this.states.get(sessionId);
    if (!session || !state) return;
    state.controller?.abort();
    void state.query?.interrupt().catch(() => undefined);
    this.denyPendingApprovals(sessionId);
    state.running = false;
    session.status = "idle";
    session.updatedAt = now();
    this.addEvent(session, { type: "notice", text: "Cancelled" });
    this.emitSession(session);
  }

  async setModel(sessionId: string, value: string): Promise<ConfigOption[]> {
    const session = this.requireSession(sessionId);
    const state = this.requireState(sessionId);
    if (!DEFAULT_MODELS.some((model) => model.value === value)) {
      throw new Error(`Unknown Claude model: ${value}`);
    }
    state.model = value;
    const option = state.configOptions.find((entry) => entry.id === "model");
    if (option) option.currentValue = value;
    session.model = value;
    session.updatedAt = now();
    try {
      await state.query?.setModel?.(value);
    } catch {
      // Per-turn queries apply the model on the next prompt.
    }
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
    this.cancel(sessionId);
    for (const approval of [...session.pendingApprovals]) {
      this.denyApproval(approval.id);
    }
    this.sessions.delete(sessionId);
    this.states.delete(sessionId);
    this.emit("session_removed", { sessionId });
  }

  resolveApproval(approvalId: string, optionId: string): boolean {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || pending.resolved) return false;
    pending.resolved = true;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(approvalId);

    const session = this.sessions.get(pending.sessionId);
    if (session) {
      session.pendingApprovals = session.pendingApprovals.filter((item) => item.id !== approvalId);
      session.status = "running";
      session.updatedAt = now();
      this.emitSession(session);
    }
    const allow = optionId === "allow" || optionId === "allow-once" || optionId === "accept";
    pending.resolve(
      allow
        ? { behavior: "allow", updatedInput: undefined }
        : { behavior: "deny", message: "Rejected from Agent Remote" },
    );
    this.emit("approval_resolved", {
      approvalId,
      sessionId: pending.sessionId,
      optionId,
      decision: allow ? "allow" : "deny",
    });
    return true;
  }

  async dispose(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      this.cancel(sessionId);
    }
    this.pendingApprovals.clear();
    this.sessions.clear();
    this.states.clear();
  }

  private async handleMessage(
    session: SessionRecord,
    state: ClaudeSessionState,
    message: Record<string, unknown>,
  ): Promise<void> {
    const type = pickString(message.type);
    if (pickString(message.session_id)) {
      state.claudeSessionId = pickString(message.session_id);
    }

    if (type === "system") {
      if (pickString(message.subtype) === "init") {
        const model = pickString(message.model, state.model);
        if (model) {
          state.model = model;
          session.model = model;
          const option = state.configOptions.find((entry) => entry.id === "model");
          if (option) option.currentValue = model;
        }
        this.emitSession(session);
      } else if (pickString(message.subtype) === "permission_denied") {
        this.addEvent(session, {
          type: "error",
          message: pickString(message.message, "Claude permission denied"),
        });
      }
      return;
    }

    if (type === "stream_event") {
      this.handleStreamEvent(session, state, asRecord(message.event));
      return;
    }

    if (type === "assistant") {
      this.handleAssistant(session, state, asRecord(message.message));
      return;
    }

    if (type === "user") {
      this.handleUser(session, asRecord(message.message));
      return;
    }

    if (type === "result") {
      this.handleResult(session, state, message);
      return;
    }
  }

  private handleStreamEvent(
    session: SessionRecord,
    state: ClaudeSessionState,
    event: Record<string, unknown>,
  ): void {
    const eventType = pickString(event.type);
    if (eventType === "content_block_delta") {
      const delta = asRecord(event.delta);
      const deltaType = pickString(delta.type);
      const text = pickString(delta.text);
      const thinking = pickString(delta.thinking);
      if (deltaType === "text_delta" && text) {
        state.sawTextDelta = true;
        this.addEvent(session, { type: "assistant_delta", text });
      } else if (deltaType === "thinking_delta" && thinking) {
        state.sawThinkingDelta = true;
        this.addEvent(session, { type: "thought_delta", text: thinking });
      }
    }
  }

  private handleAssistant(
    session: SessionRecord,
    state: ClaudeSessionState,
    message: Record<string, unknown>,
  ): void {
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      const record = asRecord(block);
      const kind = pickString(record.type);
      if (kind === "text") {
        const text = pickString(record.text);
        if (text && !state.sawTextDelta) {
          state.sawAssistantText = true;
          if (!/not logged in|please run \/login|authentication/i.test(text)) {
            this.addEvent(session, { type: "assistant_delta", text });
          }
        }
      } else if (kind === "thinking") {
        const thinking = pickString(record.thinking);
        if (thinking && !state.sawThinkingDelta) {
          this.addEvent(session, { type: "thought_delta", text: thinking });
        }
      } else if (kind === "tool_use") {
        const id = pickString(record.id);
        const name = pickString(record.name, "tool");
        const input = asRecord(record.input);
        if (id && !state.toolCalls.has(id)) {
          state.toolCalls.add(id);
          this.addEvent(session, {
            type: "tool_call",
            toolCallId: id,
            title: name,
            kind: "tool",
            status: "in_progress",
            command: this.toolCommand(name, input),
            cwd: pickString(input.cwd, session.cwd),
          });
        }
      }
    }
  }

  private handleUser(session: SessionRecord, message: Record<string, unknown>): void {
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      const record = asRecord(block);
      if (pickString(record.type) !== "tool_result") continue;
      const id = pickString(record.tool_use_id);
      if (!id) continue;
      const output = this.toolOutput(record.content);
      const isError = record.is_error === true;
      this.addEvent(session, {
        type: "tool_update",
        toolCallId: id,
        status: isError ? "failed" : "completed",
        output,
      });
    }
  }

  private handleResult(
    session: SessionRecord,
    state: ClaudeSessionState,
    message: Record<string, unknown>,
  ): void {
    const subtype = pickString(message.subtype, "success");
    const resultText = pickString(message.result);
    const isError =
      message.is_error === true ||
      subtype !== "success" ||
      /not logged in|authentication|api key|login required/i.test(resultText);

    if (!isError && resultText && !state.sawAssistantText && !state.sawTextDelta) {
      state.sawAssistantText = true;
      this.addEvent(session, { type: "assistant_delta", text: resultText });
    }

    const usage = asRecord(message.usage);
    const input = Number(usage.input_tokens ?? 0);
    const output = Number(usage.output_tokens ?? 0);
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
    const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);
    const used = input + output + cacheRead + cacheCreation;
    if (used > 0) {
      this.addEvent(session, { type: "usage", used, size: 200_000 });
    }

    session.status = isError ? "error" : "idle";
    session.updatedAt = now();
    if (isError) {
      this.addEvent(session, {
        type: "error",
        message: this.friendlyError(resultText || "Claude turn failed"),
      });
    }
    this.addEvent(session, { type: "turn_end", stopReason: isError ? "error" : subtype });
    state.resultHandled = true;
    state.running = false;
    this.emitSession(session);
  }

  private requestPermission(
    session: SessionRecord,
    state: ClaudeSessionState,
    toolName: string,
    input: Record<string, unknown>,
    options: any,
  ): Promise<any> {
    const requestId = pickString(options.requestId, randomUUID());
    const toolUseId = pickString(options.toolUseID);
    const approvalId = `claude-${requestId}`;
    const command = this.toolCommand(toolName, input);
    const approval: Approval = {
      id: approvalId,
      sessionId: session.id,
      toolCallId: toolUseId || undefined,
      title: pickString(options.displayName, toolName),
      command: command || undefined,
      cwd: pickString(input.cwd, session.cwd) || undefined,
      justification:
        pickString(options.description) ||
        pickString(options.decisionReason) ||
        pickString(options.title) ||
        undefined,
      sandbox: "workspace-write",
      kind: "tool",
      options: [
        { optionId: "allow", name: "Allow once", kind: "allow_once" },
        { optionId: "deny", name: "Reject", kind: "reject_once" },
      ],
      createdAt: now(),
    };

    if (toolUseId && !state.toolCalls.has(toolUseId)) {
      state.toolCalls.add(toolUseId);
      this.addEvent(session, {
        type: "tool_call",
        toolCallId: toolUseId,
        title: toolName,
        kind: "tool",
        status: "in_progress",
        command: command || undefined,
        cwd: pickString(input.cwd, session.cwd),
      });
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => this.denyApproval(approvalId), APPROVAL_TIMEOUT_MS);
      timer.unref?.();
      this.pendingApprovals.set(approvalId, {
        sessionId: session.id,
        resolve,
        timer,
        resolved: false,
      });
      state.approvals.add(approvalId);
      session.pendingApprovals.push(approval);
      session.status = "awaiting_approval";
      session.updatedAt = now();
      this.emit("approval", approval);
      this.emitSession(session);

      const signal = options.signal;
      if (signal instanceof AbortSignal) {
        signal.addEventListener(
          "abort",
          () => {
            const pending = this.pendingApprovals.get(approvalId);
            if (!pending || pending.resolved) return;
            pending.resolved = true;
            clearTimeout(pending.timer);
            this.pendingApprovals.delete(approvalId);
            pending.resolve({ behavior: "deny", message: "Cancelled" });
          },
          { once: true },
        );
      }
    });
  }

  private denyApproval(approvalId: string): void {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || pending.resolved) return;
    pending.resolved = true;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(approvalId);
    const session = this.sessions.get(pending.sessionId);
    if (session) {
      session.pendingApprovals = session.pendingApprovals.filter((item) => item.id !== approvalId);
      session.updatedAt = now();
      this.emitSession(session);
    }
    pending.resolve({ behavior: "deny", message: "Timed out or cancelled" });
  }

  private denyPendingApprovals(sessionId: string): void {
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.sessionId === sessionId) this.denyApproval(approvalId);
    }
  }

  private toolCommand(toolName: string, input: Record<string, unknown>): string {
    const command = pickString(input.command);
    if (command) return command;
    const filePath = pickString(input.file_path) || pickString(input.path);
    if (filePath) return `${toolName} ${filePath}`;
    if (Object.keys(input).length === 0) return "";
    try {
      return `${toolName} ${JSON.stringify(input).slice(0, 800)}`;
    } catch {
      return toolName;
    }
  }

  private toolOutput(content: unknown): string | undefined {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const parts = content
        .map((entry) => {
          const record = asRecord(entry);
          return pickString(record.text);
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join("\n");
    }
    if (content !== undefined) {
      try {
        return JSON.stringify(content);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private friendlyError(message: string): string {
    if (/auth|login|api key|credential/i.test(message)) {
      return `${message} — Claude Code にログインするか、ANTHROPIC_API_KEY を設定してください。`;
    }
    return message;
  }

  private buildConfigOptions(model: string): ConfigOption[] {
    return [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: model,
        options: DEFAULT_MODELS,
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
      runtime: "claude",
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return session;
  }

  private requireState(sessionId: string): ClaudeSessionState {
    const state = this.states.get(sessionId);
    if (!state) throw new Error(`Unknown Claude session: ${sessionId}`);
    return state;
  }
}
