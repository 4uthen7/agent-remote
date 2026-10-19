import { EventEmitter } from "node:events";
import type { RuntimeId, SessionRecord, SessionSummary, ConfigOption } from "../types.js";
import type { RuntimeAdapter, RuntimeSnapshot } from "./types.js";

export type RuntimeFactory = () => RuntimeAdapter;

export class RuntimeManager extends EventEmitter {
  private readonly adapters = new Map<RuntimeId, RuntimeAdapter>();
  private readonly sessionRuntime = new Map<string, RuntimeId>();
  private readonly starting = new Map<RuntimeId, Promise<RuntimeAdapter>>();

  constructor(private readonly factories: Partial<Record<RuntimeId, RuntimeFactory>>) {
    super();
  }

  private wire(runtime: RuntimeId, adapter: RuntimeAdapter): void {
    adapter.on("session", (session: SessionSummary) => {
      if (!this.sessionRuntime.has(session.id)) {
        this.sessionRuntime.set(session.id, runtime);
      }
      this.emit("session", session);
    });
    adapter.on("event", (event: unknown) => this.emit("event", event));
    adapter.on("approval", (approval: unknown) => this.emit("approval", approval));
    adapter.on("approval_resolved", (resolution: unknown) => this.emit("approval_resolved", resolution));
    adapter.on("config", (config: unknown) => this.emit("config", config));
    adapter.on("session_removed", (payload: { sessionId: string }) => {
      this.sessionRuntime.delete(payload.sessionId);
      this.emit("session_removed", payload);
    });
    adapter.on("error", (error: unknown) => this.emit("error", error));
    adapter.on("exit", (info: unknown) => this.emit("exit", { runtime, ...(info as object) }));
  }

  async ensure(runtime: RuntimeId): Promise<RuntimeAdapter> {
    const existing = this.adapters.get(runtime);
    if (existing) return existing;
    const pending = this.starting.get(runtime);
    if (pending) return pending;

    const factory = this.factories[runtime];
    if (!factory) throw new Error(`Runtime is not configured: ${runtime}`);

    const start = (async () => {
      const adapter = factory();
      this.wire(runtime, adapter);
      try {
        await adapter.start();
      } catch (error) {
        adapter.removeAllListeners();
        throw new Error(
          `${runtime} failed to start: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.adapters.set(runtime, adapter);
      return adapter;
    })();

    this.starting.set(runtime, start);
    try {
      return await start;
    } finally {
      this.starting.delete(runtime);
    }
  }

  listSessions(): SessionSummary[] {
    return [...this.adapters.values()]
      .flatMap((adapter) => adapter.listSessions())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(sessionId: string): SessionRecord | undefined {
    for (const adapter of this.adapters.values()) {
      const session = adapter.getSession(sessionId);
      if (session) return session;
    }
    return undefined;
  }

  snapshot(sessionId: string): RuntimeSnapshot | undefined {
    for (const adapter of this.adapters.values()) {
      const snapshot = adapter.snapshot(sessionId);
      if (snapshot) return snapshot;
    }
    return undefined;
  }

  async newSession(cwd: string, runtime: RuntimeId = "dsh"): Promise<SessionSummary> {
    const adapter = await this.ensure(runtime);
    const session = await adapter.newSession(cwd);
    this.sessionRuntime.set(session.id, runtime);
    return session;
  }

  async resumeSession(
    sessionId: string,
    cwd: string,
    runtime?: RuntimeId,
  ): Promise<SessionSummary> {
    const selected = runtime ?? this.sessionRuntime.get(sessionId) ?? "dsh";
    const adapter = await this.ensure(selected);
    const session = await adapter.resumeSession(sessionId, cwd);
    this.sessionRuntime.set(session.id, selected);
    return session;
  }

  private adapterFor(sessionId: string): RuntimeAdapter {
    const runtime = this.sessionRuntime.get(sessionId);
    if (runtime) {
      const adapter = this.adapters.get(runtime);
      if (adapter) return adapter;
    }
    for (const adapter of this.adapters.values()) {
      if (adapter.getSession(sessionId)) return adapter;
    }
    throw new Error(`Unknown session: ${sessionId}`);
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await this.adapterFor(sessionId).prompt(sessionId, text);
  }

  cancel(sessionId: string): void {
    try {
      this.adapterFor(sessionId).cancel(sessionId);
    } catch {
      // Unknown sessions are a no-op for cancellation.
    }
  }

  async setModel(sessionId: string, value: string): Promise<ConfigOption[]> {
    return this.adapterFor(sessionId).setModel(sessionId, value);
  }

  async closeSession(sessionId: string): Promise<void> {
    const adapter = this.adapterFor(sessionId);
    await adapter.closeSession(sessionId);
    this.sessionRuntime.delete(sessionId);
  }

  resolveApproval(approvalId: string, optionId: string): boolean {
    for (const adapter of this.adapters.values()) {
      if (adapter.resolveApproval(approvalId, optionId)) return true;
    }
    return false;
  }

  async dispose(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.dispose();
      } catch {
        // Best-effort shutdown.
      }
    }
    this.adapters.clear();
    this.sessionRuntime.clear();
  }
}
