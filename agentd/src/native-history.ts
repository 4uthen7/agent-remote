import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";
import path from "node:path";
import type { AgentEvent, SessionRecord } from "./types.js";

const MAX_HISTORY_FILES = 120;
const MAX_HISTORY_EVENTS = 1_500;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

function safeTime(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const item = entry as Record<string, unknown>;
      return typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function firstTitle(text: string, fallback: string): string {
  const line = text.trim().split(/\r?\n/)[0]?.trim();
  return line ? line.slice(0, 70) : fallback;
}

function listJsonl(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || files.length > 500) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
    }
  };
  walk(root, 0);
  return files
    .map((file) => {
      try {
        return { file, mtime: Math.round(statSync(file).mtimeMs), size: statSync(file).size };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { file: string; mtime: number; size: number } => Boolean(entry))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_HISTORY_FILES)
    .filter((entry) => entry.size <= MAX_HISTORY_BYTES)
    .map((entry) => entry.file);
}

/**
 * Claude Code writes one JSONL transcript per project under ~/.claude/projects.
 * Import text turns (not tool payloads) so the phone can browse and resume them.
 */
export function importClaudeHistory(): SessionRecord[] {
  const root = path.join(homedir(), ".claude", "projects");
  const records: SessionRecord[] = [];
  for (const file of listJsonl(root)) {
    const sessionId = path.basename(file, ".jsonl");
    if (!/^[0-9a-f-]{20,}$/i.test(sessionId)) continue;
    try {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      const events: AgentEvent[] = [];
      let seq = 0;
      let cwd = "";
      let createdAt = 0;
      let updatedAt = 0;
      let title = "";
      let model = "sonnet";
      const seenUser = new Set<string>();
      const add = (event: Omit<AgentEvent, "seq">) => {
        events.push({ ...event, seq: ++seq });
      };
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (typeof entry.cwd === "string" && entry.cwd) cwd = entry.cwd;
        if (typeof entry.timestamp === "string") {
          const time = safeTime(entry.timestamp, 0);
          if (time) {
            if (!createdAt) createdAt = time;
            updatedAt = time;
          }
        }
        if (typeof entry.model === "string") model = entry.model;
        if (entry.type === "summary" && typeof entry.summary === "string") {
          title = title || entry.summary;
        }
        if (entry.isSidechain === true) continue;
        const message = entry.message && typeof entry.message === "object"
          ? (entry.message as Record<string, unknown>)
          : undefined;
        if (!message) continue;
        if (entry.type === "user") {
          const text = textFromContent(message.content);
          if (!text.trim()) continue;
          const key = text.trim();
          if (seenUser.has(key)) continue;
          seenUser.add(key);
          if (!title) title = firstTitle(text, path.basename(cwd) || "Claude session");
          add({ type: "user_message", text });
        } else if (entry.type === "assistant") {
          const text = textFromContent(message.content);
          if (!text.trim()) continue;
          add({ type: "assistant_delta", text });
        }
      }
      if (!events.length) continue;
      const clipped = events.slice(-MAX_HISTORY_EVENTS);
      const id = `claude-${sessionId}`;
      records.push({
        id,
        title: title || path.basename(cwd) || "Claude session",
        cwd,
        status: "idle",
        runtime: "claude",
        model,
        createdAt: createdAt || Date.now(),
        updatedAt: updatedAt || createdAt || Date.now(),
        events: clipped,
        seq: clipped.length,
        configOptions: [],
        pendingApprovals: [],
      });
    } catch {
      // A corrupted transcript should not block the other sessions.
    }
  }
  return records;
}

/**
 * DSH's session cache does not expose transcript rows, but its title/cwd is
 * still useful for reopening the native session from the phone.
 */
// DSH appends one zstd frame per write, and Node's zstd API stops after the
// first frame. Split on the frame magic and decode each frame in turn.
function decodeZstdFrames(raw: Buffer): Buffer {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets: number[] = [];
  let cursor = 0;
  while ((cursor = raw.indexOf(magic, cursor)) !== -1) {
    offsets.push(cursor);
    cursor += 4;
  }
  if (!offsets.length) return zstdDecompressSync(raw);
  const parts: Buffer[] = [];
  for (let index = 0; index < offsets.length; index += 1) {
    const end = index + 1 < offsets.length ? offsets[index + 1] : raw.length;
    try {
      parts.push(zstdDecompressSync(raw.subarray(offsets[index], end)));
    } catch {
      // A payload byte sequence can look like a frame magic; skip it.
    }
  }
  return Buffer.concat(parts);
}

function readDshLog(file: string): Record<string, unknown>[] {
  try {
    const raw = readFileSync(file);
    const text = (file.endsWith(".zstd") ? decodeZstdFrames(raw) : raw).toString("utf8");
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function dshLogFiles(): { id: string; file: string }[] {
  const root = path.join(homedir(), ".dsh", "sessions");
  if (!existsSync(root)) return [];
  const files: { id: string; file: string }[] = [];
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(root, project.name);
    let sessions;
    try {
      sessions = readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const dir = path.join(projectDir, session.name);
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      const logs = names
        .filter((name) => /^session\.v\d+\.jsonl(\.zstd)?$/.test(name))
        .sort();
      const file = logs.at(-1);
      if (!file) continue;
      const full = path.join(dir, file);
      try {
        const stat = statSync(full);
        if (stat.size > MAX_HISTORY_BYTES) continue;
        files.push({ id: session.name, file: full });
      } catch {
        continue;
      }
    }
  }
  return files.slice(0, MAX_HISTORY_FILES);
}

function dshToolCommand(argumentsText: unknown): string | undefined {
  if (typeof argumentsText !== "string" || !argumentsText.trim()) return undefined;
  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    if (typeof parsed.command === "string" && parsed.command.trim()) return parsed.command;
    if (typeof parsed.cmd === "string" && parsed.cmd.trim()) return parsed.cmd;
  } catch {
    // Fall through to the raw arguments.
  }
  return argumentsText.slice(0, 1_000);
}

/**
 * DSH keeps the authoritative transcript as zstd-compressed JSONL under
 * ~/.dsh/sessions/<encoded-cwd>/<session-id>/session.vN.jsonl(.zstd). The
 * projection cache only carries a truncated turn outline, so read the log.
 */
export function importDshHistory(): SessionRecord[] {
  const records: SessionRecord[] = [];
  for (const entry of dshLogFiles()) {
    const lines = readDshLog(entry.file);
    if (!lines.length) continue;
    const header = lines.find((line) => line.type === "session") ?? {};
    const id = typeof header.id === "string" && header.id ? header.id : entry.id;
    const cwd = typeof header.cwd === "string" ? header.cwd : "";
    let createdAt = safeTime(header.createdAt, Date.now());
    let updatedAt = createdAt;
    let model = "deepseek";
    let title = "";
    const events: AgentEvent[] = [];
    let seq = 0;

    for (const line of lines) {
      if (typeof line.time === "number" && line.time > 0) {
        updatedAt = Math.max(updatedAt, line.time);
      }
      switch (line.type) {
        case "user/message": {
          const data = (line.data ?? {}) as Record<string, unknown>;
          const source = (data.source ?? {}) as Record<string, unknown>;
          if (source.kind !== "user") break;
          const text = textFromContent(data.content).trim();
          if (!text) break;
          if (!title) title = firstTitle(text, path.basename(cwd) || "DSH session");
          events.push({ type: "user_message", text, seq: ++seq });
          break;
        }
        case "assistant/message": {
          const data = (line.data ?? {}) as Record<string, unknown>;
          const message = (data.message ?? {}) as Record<string, unknown>;
          const source = (message.source ?? {}) as Record<string, unknown>;
          if (typeof source.model === "string" && source.model) model = source.model;
          const content = Array.isArray(message.content) ? message.content : [];
          for (const part of content) {
            if (!part || typeof part !== "object") continue;
            const block = part as Record<string, unknown>;
            if (block.type === "text" && typeof block.text === "string" && block.text) {
              events.push({ type: "assistant_delta", text: block.text, seq: ++seq });
            } else if (block.type === "reasoning" && typeof block.text === "string" && block.text) {
              events.push({ type: "thought_delta", text: block.text, seq: ++seq });
            } else if (block.type === "tool-call") {
              events.push({
                type: "tool_call",
                toolCallId: typeof block.id === "string" ? block.id : undefined,
                title: typeof block.name === "string" ? block.name : "tool",
                command: dshToolCommand(block.arguments),
                status: "in_progress",
                seq: ++seq,
              });
            }
          }
          break;
        }
        case "tool/result": {
          const data = (line.data ?? {}) as Record<string, unknown>;
          const message = (data.message ?? {}) as Record<string, unknown>;
          const output = textFromContent(message.content).trim();
          events.push({
            type: "tool_update",
            toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
            status: message.isError === true ? "failed" : "completed",
            output: output || "(no output)",
            seq: ++seq,
          });
          break;
        }
        case "turn/end": {
          const data = (line.data ?? {}) as Record<string, unknown>;
          const reason = (data.reason ?? {}) as Record<string, unknown>;
          events.push({
            type: "turn_end",
            stopReason: typeof reason.kind === "string" ? reason.kind : "completed",
            seq: ++seq,
          });
          break;
        }
      }
    }

    if (!events.length) continue;
    if (!createdAt) createdAt = updatedAt;
    const clipped = events.slice(-MAX_HISTORY_EVENTS);
    records.push({
      id,
      title: title || path.basename(cwd) || "DSH session",
      cwd: cwd || homedir(),
      status: "idle",
      runtime: "dsh",
      model,
      createdAt: Math.round(createdAt),
      updatedAt: Math.round(updatedAt),
      events: clipped,
      seq: clipped.length,
      configOptions: [],
      pendingApprovals: [],
    });
  }
  return records;
}
