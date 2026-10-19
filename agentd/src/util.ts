import { randomBytes, timingSafeEqual } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir, networkInterfaces, platform } from "node:os";
import path from "node:path";

export function now(): number {
  return Date.now();
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function shortTitle(text: string, fallback: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.length > 48 ? `${cleaned.slice(0, 47)}…` : cleaned;
}

export function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
}

export function realDirectory(input: string): string {
  const resolved = path.resolve(expandHome(input));
  const real = realpathSync(resolved);
  const stat = statSync(real);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${real}`);
  return real;
}

export function assertWithinRoots(target: string, roots: string[]): string {
  const realTarget = realDirectory(target);
  const allowed = roots.map((root) => {
    try {
      return realpathSync(expandHome(root));
    } catch {
      return path.resolve(expandHome(root));
    }
  });
  const ok = allowed.some((root) => realTarget === root || realTarget.startsWith(`${root}${path.sep}`));
  if (!ok) {
    throw new Error(`Path is outside allowed roots: ${realTarget}`);
  }
  return realTarget;
}

export function tokenEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function lanAddress(): string {
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "127.0.0.1";
}

export function platformName(): string {
  switch (platform()) {
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    case "win32":
      return "Windows";
    default:
      return platform();
  }
}

export function log(message: string): void {
  const time = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[${time}] ${message}\n`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pickString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
