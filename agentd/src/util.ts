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
  let value = input;
  if (process.platform === "win32") {
    value = value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
  }
  if (value === "~") return homedir();
  if (/^~[\\/]/.test(value)) return path.join(homedir(), value.slice(2));
  return value;
}

function normalizeForCompare(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
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
  const targetCmp = normalizeForCompare(realTarget);
  const ok = allowed.some((root) => {
    const rootCmp = normalizeForCompare(root);
    return targetCmp === rootCmp || targetCmp.startsWith(`${rootCmp}${path.sep}`);
  });
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

export interface LanAddress {
  name: string;
  address: string;
}

function isPrivateIPv4(address: string): boolean {
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;
  const match = /^172\.(\d+)\./.exec(address);
  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function lanScore(name: string, address: string): number {
  let score = 0;
  if (isPrivateIPv4(address)) score += 100;
  if (/^(en\d+|eth\d+|wlan\d+|wi-?fi|ethernet|lan)/i.test(name)) score += 50;
  if (/tailscale/i.test(name)) score -= 10;
  if (/(vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|utun|bridge|awdl|llw)/i.test(name)) score -= 100;
  if (address.startsWith("169.254.")) score -= 200;
  return score;
}

export function lanAddresses(): LanAddress[] {
  const seen = new Set<string>();
  const candidates: Array<LanAddress & { score: number }> = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || seen.has(entry.address)) continue;
      seen.add(entry.address);
      candidates.push({
        name,
        address: entry.address,
        score: lanScore(name, entry.address),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return candidates.map(({ name, address }) => ({ name, address }));
}

export function lanAddress(): string {
  return lanAddresses()[0]?.address ?? "127.0.0.1";
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
