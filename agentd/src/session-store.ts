import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  AgentEvent,
  RuntimeId,
  SessionRecord,
  SessionSummary,
} from "./types.js";
import type { RuntimeSnapshot } from "./runtime/types.js";

export interface ArchivedSession extends SessionRecord {
  archivedAt: number;
  originHost: string;
}

const MAX_EVENTS = 2_000;

/**
 * Durable session history. Files live in a plain directory so pointing
 * AGENT_REMOTE_SYNC_DIR at iCloud Drive / Dropbox / OneDrive gives a
 * lightweight, file-synced "cloud" archive.
 */
export class SessionStore {
  private readonly records = new Map<string, ArchivedSession>();

  constructor(
    private readonly dir: string,
    private readonly hostName: string,
  ) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.load();
  }

  private key(runtime: RuntimeId, id: string): string {
    return `${runtime}:${id}`;
  }

  private fileFor(runtime: RuntimeId, id: string): string {
    const digest = createHash("sha256")
      .update(`${this.hostName}\0${runtime}\0${id}`)
      .digest("hex")
      .slice(0, 40);
    return path.join(this.dir, `${digest}.json`);
  }

  private load(): void {
    if (!existsSync(this.dir)) return;
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(readFileSync(path.join(this.dir, entry), "utf8")) as ArchivedSession;
        if (!raw || typeof raw.id !== "string" || typeof raw.runtime !== "string") continue;
        const record: ArchivedSession = {
          ...raw,
          events: Array.isArray(raw.events) ? raw.events.slice(-MAX_EVENTS) : [],
          pendingApprovals: [],
          configOptions: Array.isArray(raw.configOptions) ? raw.configOptions : [],
          archivedAt: raw.archivedAt || Date.now(),
          originHost: raw.originHost || this.hostName,
          status: "idle",
        };
        this.records.set(this.key(record.runtime, record.id), record);
      } catch {
        // A partially synced/corrupt file should not prevent startup.
      }
    }
  }

  save(record: SessionRecord, archived = false): void {
    const key = this.key(record.runtime, record.id);
    const existing = this.records.get(key);
    const stored: ArchivedSession = {
      ...record,
      events: record.events.slice(-MAX_EVENTS),
      pendingApprovals: [],
      archivedAt: archived ? Date.now() : 0,
      originHost: existing?.originHost ?? this.hostName,
      status: archived ? "idle" : record.status,
    };
    this.records.set(key, stored);
    this.write(stored);
  }

  archive(record: SessionRecord): void {
    this.save(record, true);
  }

  markActive(runtime: RuntimeId, id: string): void {
    const record = this.get(runtime, id);
    if (!record) return;
    record.archivedAt = 0;
    this.records.set(this.key(runtime, id), record);
    this.write(record);
  }

  get(runtime: RuntimeId, id: string): ArchivedSession | undefined;
  get(id: string): ArchivedSession | undefined;
  get(first: RuntimeId | string, second?: string): ArchivedSession | undefined {
    if (second !== undefined) {
      return this.records.get(this.key(first as RuntimeId, second));
    }
    for (const record of this.records.values()) {
      if (record.id === first) return record;
    }
    return undefined;
  }

  list(): ArchivedSession[] {
    return [...this.records.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  canResume(id: string): boolean {
    const record = this.get(id);
    return Boolean(record && record.originHost === this.hostName);
  }

  summary(record: ArchivedSession): SessionSummary {
    const lastMessage = [...record.events]
      .reverse()
      .find((event) => (event.type === "assistant_delta" || event.type === "user_message") && Boolean(event.text?.trim()))
      ?.text?.trim()
      .slice(0, 140);
    return {
      id: record.id,
      title: record.title,
      cwd: record.cwd,
      status: "idle",
      runtime: record.runtime,
      model: record.model,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      archived: true,
      resumable: record.originHost === this.hostName,
      originHost: record.originHost,
      lastMessage,
    };
  }

  snapshot(record: ArchivedSession): RuntimeSnapshot {
    return {
      session: this.summary(record),
      events: record.events,
      approvals: [],
      configOptions: record.configOptions,
    };
  }

  private write(record: ArchivedSession): void {
    const file = this.fileFor(record.runtime, record.id);
    const temp = `${file}.${process.pid}.tmp`;
    const serialized = JSON.stringify(record);
    writeFileSync(temp, serialized, { mode: 0o600 });
    try {
      renameSync(temp, file);
    } catch {
      // Some Windows filesystems reject replacing an existing file with rename.
      writeFileSync(file, serialized, { mode: 0o600 });
      rmSync(temp, { force: true });
    }
  }
}
