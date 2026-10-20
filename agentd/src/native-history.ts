import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
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
export function importDshHistory(): SessionRecord[] {
  const root = path.join(homedir(), ".dsh", "storages", "session_projcache", "sessions");
  if (!existsSync(root)) return [];
  const records: SessionRecord[] = [];
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith(".json")) continue;
    const file = path.join(root, entry);
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const record = parsed.record as Record<string, unknown> | undefined;
      if (!record) continue;
      const identity = (record.identity ?? {}) as Record<string, unknown>;
      const rows = (record.rows ?? {}) as Record<string, unknown>;
      const titleRow = (rows.title ?? {}) as Record<string, unknown>;
      const title = typeof titleRow.val === "string" ? titleRow.val : "";
      const cwd = typeof identity.cwd === "string" ? identity.cwd : "";
      const createdAt = safeTime(identity.createdAt, Date.now());
      const updatedAt = Math.round(statSync(file).mtimeMs);
      const id = path.basename(entry, ".json");
      const events: AgentEvent[] = [];
      const outline = (rows.turnOutline ?? {}) as Record<string, unknown>;
      const outlineValue = (outline.val ?? {}) as Record<string, unknown>;
      const turns = Array.isArray(outlineValue.turns) ? outlineValue.turns : [];
      let seq = 0;
      for (const raw of turns) {
        if (!raw || typeof raw !== "object") continue;
        const turn = raw as Record<string, unknown>;
        const prompt = typeof turn.prompt === "string" ? turn.prompt.trim() : "";
        const response = typeof turn.response === "string" ? turn.response.trim() : "";
        if (prompt) events.push({ type: "user_message", text: prompt, seq: ++seq });
        if (response) events.push({ type: "assistant_delta", text: response, seq: ++seq });
      }
      const selection = (rows.modelSelection ?? {}) as Record<string, unknown>;
      const selectionValue = (selection.val ?? {}) as Record<string, unknown>;
      const lastUsed = (selectionValue.lastUsed ?? {}) as Record<string, unknown>;
      const model = typeof lastUsed.model === "string" ? lastUsed.model : "deepseek";
      const clipped = events.slice(-MAX_HISTORY_EVENTS);
      records.push({
        id,
        title: title || path.basename(cwd) || "DSH session",
        cwd,
        status: "idle",
        runtime: "dsh",
        model,
        createdAt,
        updatedAt,
        events: clipped,
        seq: clipped.length,
        configOptions: [],
        pendingApprovals: [],
      });
    } catch {
      // Ignore corrupt caches.
    }
  }
  return records;
}
