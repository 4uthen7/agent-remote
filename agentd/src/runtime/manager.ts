import { EventEmitter } from "node:events";
import type { RuntimeId, SessionRecord, SessionSummary, ConfigOption } from "../types.js";
import type { RuntimeAdapter, RuntimeSnapshot } from "./types.js";
import type { SessionStore } from "../session-store.js";

export type RuntimeFactory = () => RuntimeAdapter;

export class RuntimeManager extends EventEmitter {
  private readonly adapters = new Map<RuntimeId, RuntimeAdapter>();
  private readonly sessionRuntime = new Map<string, RuntimeId>();
  private readonly starting = new Map<RuntimeId, Promise<RuntimeAdapter>>();
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly factories: Partial<Record<RuntimeId, RuntimeFactory>>,
    private readonly store?: SessionStore,
  ) {
    super();
  }

  private persist(runtime: RuntimeId, sessionId: string, immediate = false): void {
    if (!this.store) return;
    const key = `${runtime}:${sessionId}`;
    const existing = this.persistTimers.get(key);
    if (existing) clearTimeout(existing);
    const write = () => {
      this.persistTimers.delete(key);
      const adapter = this.adapters.get(runtime);
      const record = adapter?.getSession(sessionId);
      if (record) this.store?.save(record, false);
    };
    if (immediate) {
      write();
      return;
    }
    const timer = setTimeout(write, 250);
    timer.unref();
    this.persistTimers.set(key, timer);
  }

  private wire(runtime: RuntimeId, adapter: RuntimeAdapter): void {
    adapter.on("session", (session: SessionSummary) => {
      if (!this.sessionRuntime.has(session.id)) {
        this.sessionRuntime.set(session.id, runtime);
      }
      this.persist(runtime, session.id);
      this.emit("session", session);
    });
    adapter.on("event", (event: unknown) => {
      const sessionId = (event as { sessionId?: string }).sessionId;
      if (sessionId) this.persist(runtime, sessionId);
      this.emit("event", event);
    });
    adapter.on("approval", (approval: unknown) => {
      const sessionId = (approval as { sessionId?: string }).sessionId;
      if (sessionId) this.persist(runtime, sessionId);
      this.emit("approval", approval);
    });
    adapter.on("approval_resolved", (resolution: unknown) => {
      const sessionId = (resolution as { sessionId?: string }).sessionId;
      if (sessionId) this.persist(runtime, sessionId, true);
      this.emit("approval_resolved", resolution);
    });
    adapter.on("config", (config: unknown) => {
      const sessionId = (config as { sessionId?: string }).sessionId;
      if (sessionId) this.persist(runtime, sessionId);
      this.emit("config", config);
    });
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
    const live = [...this.adapters.values()].flatMap((adapter) => adapter.listSessions());
    const liveIds = new Set(live.map((session) => session.id));
    const archived = (this.store?.list() ?? [])
      .filter((record) => !liveIds.has(record.id))
      .map((record) => this.store!.summary(record));
    return [...live, ...archived].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(sessionId: string): SessionRecord | undefined {
    for (const adapter of this.adapters.values()) {
      const session = adapter.getSession(sessionId);
      if (session) return session;
    }
    return this.store?.get(sessionId);
  }

  snapshot(sessionId: string): RuntimeSnapshot | undefined {
    for (const adapter of this.adapters.values()) {
      const snapshot = adapter.snapshot(sessionId);
      if (snapshot) return snapshot;
    }
    const archived = this.store?.get(sessionId);
    return archived ? this.store?.snapshot(archived) : undefined;
  }

  async newSession(cwd: string, runtime: RuntimeId = "dsh"): Promise<SessionSummary> {
    const adapter = await this.ensure(runtime);
    const session = await adapter.newSession(cwd);
    this.sessionRuntime.set(session.id, runtime);
    const record = adapter.getSession(session.id);
    if (record) this.store?.save(record, false);
    return session;
  }

  async resumeSession(
    sessionId: string,
    cwd: string,
    runtime?: RuntimeId,
  ): Promise<SessionSummary> {
    const archived = this.store?.get(sessionId);
    if (archived && this.store && !this.store.canResume(sessionId)) {
      throw new Error(
        `This session belongs to ${archived.originHost}; connect to that host to resume it.`,
      );
    }
    const selected = runtime ?? this.sessionRuntime.get(sessionId) ?? archived?.runtime ?? "dsh";
    const adapter = await this.ensure(selected);
    const session = await adapter.resumeSession(sessionId, cwd || archived?.cwd || "");
    this.sessionRuntime.set(session.id, selected);
    if (archived) {
      // Restore the archived timeline into the now-live adapter so events
      // continue with a monotonically increasing sequence number.
      adapter.restoreSession?.(session.id, archived);
      this.store?.markActive(selected, session.id);
      this.persist(selected, session.id, true);
    }
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
    const record = adapter.getSession(sessionId);
    if (record) this.store?.archive(record);
    const key = `${this.sessionRuntime.get(sessionId) ?? "dsh"}:${sessionId}`;
    const timer = this.persistTimers.get(key);
    if (timer) clearTimeout(timer);
    this.persistTimers.delete(key);
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
    for (const [key, timer] of this.persistTimers) {
      clearTimeout(timer);
      this.persistTimers.delete(key);
    }
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
