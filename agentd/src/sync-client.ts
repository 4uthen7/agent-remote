import type { SessionStore, ArchivedSession } from "./session-store.js";
import { decryptSyncPayload, encryptSyncPayload } from "./sync-crypto.js";
import { log } from "./util.js";

export interface SyncClientOptions {
  url: string;
  room: string;
  key: string;
  token?: string;
  intervalMs?: number;
  onMerged?: () => void;
}

export class SyncClient {
  private timer?: NodeJS.Timeout;
  private pushTimer?: NodeJS.Timeout;
  private pulling = false;
  private pushing = false;
  private applyingRemote = false;
  private stopped = false;

  constructor(
    private readonly options: SyncClientOptions,
    private readonly store: SessionStore,
  ) {}

  private endpoint(): string {
    return `${this.options.url.replace(/\/+$/, "")}/v1/rooms/${encodeURIComponent(this.options.room)}`;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
    };
  }

  async start(): Promise<void> {
    const pulled = await this.pull();
    if (pulled) await this.push();
    if (this.stopped) return;
    this.timer = setInterval(() => void this.pull(), this.options.intervalMs ?? 30_000);
    this.timer.unref();
    log(`sync: room ${this.options.room} via ${this.options.url}`);
  }

  notifyLocalChange(): void {
    if (this.stopped || this.applyingRemote) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push(), 1_200);
    this.pushTimer.unref();
  }

  async pull(): Promise<boolean> {
    if (this.stopped || this.pulling) return false;
    this.pulling = true;
    try {
      const response = await fetch(this.endpoint(), {
        headers: this.headers(),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) return true;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { payload?: string };
      if (!body.payload) return true;
      const records = decryptSyncPayload(body.payload, this.options.key);
      if (!Array.isArray(records)) throw new Error("sync payload is not an array");
      this.applyingRemote = true;
      try {
        const imported = this.store.importRecords(records as ArchivedSession[]);
        if (imported > 0) {
          log(`sync: merged ${imported} session(s)`);
          this.options.onMerged?.();
        }
      } finally {
        this.applyingRemote = false;
      }
      return true;
    } catch (error) {
      log(`sync: pull failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      this.pulling = false;
    }
  }

  async push(): Promise<void> {
    if (this.stopped || this.pushing) return;
    this.pushing = true;
    try {
      const payload = encryptSyncPayload(this.store.list(), this.options.key);
      const response = await fetch(this.endpoint(), {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({ payload }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      log(`sync: push failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.pushing = false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
  }
}
