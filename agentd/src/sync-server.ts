import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { log } from "./util.js";

const port = Number(process.env.AGENT_REMOTE_SYNC_PORT ?? 8788);
const bind = process.env.AGENT_REMOTE_SYNC_BIND?.trim() || "0.0.0.0";
const token = process.env.AGENT_REMOTE_SYNC_TOKEN?.trim();
const storeDir = process.env.AGENT_REMOTE_SYNC_STORE?.trim() || path.join(homedir(), ".agent-remote-sync");
const maxBytes = 16 * 1024 * 1024;

if (!token) {
  console.error("AGENT_REMOTE_SYNC_TOKEN is required");
  process.exit(1);
}
mkdirSync(storeDir, { recursive: true, mode: 0o700 });

function authorized(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token!);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function roomFile(room: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(room)) return undefined;
  return path.join(storeDir, `${createHash("sha256").update(room).digest("hex")}.json`);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeFile(file: string, data: string): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, data, { mode: 0o600 });
  try {
    renameSync(temp, file);
  } catch {
    writeFileSync(file, data, { mode: 0o600 });
    rmSync(temp, { force: true });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: "encrypted", version: 1 }));
    return;
  }
  if (!authorized(req.headers.authorization)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  const match = url.pathname.match(/^\/v1\/rooms\/([A-Za-z0-9_-]{1,64})$/);
  const file = match ? roomFile(match[1]) : undefined;
  if (!file) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  try {
    if (req.method === "GET") {
      if (!existsSync(file)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "empty" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(readFileSync(file, "utf8"));
      return;
    }
    if (req.method === "PUT") {
      const body = JSON.parse(await readBody(req)) as { payload?: unknown };
      if (typeof body.payload !== "string" || !body.payload) throw new Error("payload is required");
      const record = JSON.stringify({ payload: body.payload, updatedAt: Date.now() });
      writeFile(file, record);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(message === "payload too large" ? 413 : 400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(port, bind, () => {
  log(`Agent Remote sync server listening on ${bind}:${port}`);
  log(`Encrypted room store: ${storeDir}`);
  log("Use AGENT_REMOTE_SYNC_URL, _ROOM, _KEY and _TOKEN on each agentd.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
