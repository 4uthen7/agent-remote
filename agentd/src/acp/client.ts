import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

export interface AcpClientOptions {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  logger?: (line: string) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export class AcpClient extends EventEmitter {
  private readonly proc: ChildProcess;
  private readonly pending = new Map<number, Pending>();
  private readonly reader: readline.Interface;
  private nextId = 1;
  private closed = false;

  constructor(private readonly options: AcpClientOptions) {
    super();
    this.proc = spawn(options.command, options.args, {
      env: options.env,
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!this.proc.stdout || !this.proc.stdin) {
      throw new Error("Failed to open ACP stdio pipes");
    }

    this.reader = readline.createInterface({ input: this.proc.stdout });
    this.reader.on("line", (line) => this.handleLine(line));

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim()) this.log(`[dsh] ${line.trimEnd()}`);
      }
    });

    this.proc.on("exit", (code, signal) => {
      this.closed = true;
      const reason = code ?? signal ?? "unknown";
      this.failAll(new Error(`DSH process exited (${reason})`));
      this.emit("exit", { code, signal });
    });

    this.proc.on("error", (error) => {
      this.closed = true;
      this.failAll(error instanceof Error ? error : new Error(String(error)));
      this.emit("error", error);
    });
  }

  private log(line: string): void {
    this.options.logger?.(line);
  }

  private handleLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;

    // DSH occasionally writes human-readable log lines to stdout. ACP must
    // tolerate them rather than treating the stream as corrupt.
    if (!line.startsWith("{")) {
      this.log(`[dsh stdout] ${line}`);
      return;
    }

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.log(`[dsh stdout non-json] ${line}`);
      return;
    }

    if (message.id !== undefined && message.method) {
      this.emit("serverRequest", message);
      return;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.log(`[acp] unmatched response id=${message.id}`);
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new Error(`${message.error.code ?? "error"}: ${message.error.message ?? "unknown"}`),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.emit("notification", message);
    }
  }

  request<T>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error("ACP connection is closed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`ACP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  respond(id: number, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: number, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private write(payload: unknown): void {
    if (this.closed || !this.proc.stdin?.writable) return;
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private failAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("ACP connection closed"));
    try {
      this.reader.close();
    } catch {
      // ignore
    }
    try {
      this.proc.stdin?.end();
    } catch {
      // ignore
    }
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      this.proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}
