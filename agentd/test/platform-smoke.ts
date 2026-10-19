import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { RuntimeManager } from "../src/runtime/manager.js";
import { createAgentServer } from "../src/server.js";

const root = mkdtempSync(path.join(tmpdir(), "agent-remote-platform-"));
const port = 18000 + Math.floor(Math.random() * 2000);
process.env.AGENT_REMOTE_HOME = path.join(root, "home");
process.env.AGENT_REMOTE_ROOTS = root;
process.env.AGENT_REMOTE_PORT = String(port);
process.env.AGENT_REMOTE_BIND = "127.0.0.1";
process.env.AGENT_REMOTE_PUBLIC_URL = `ws://127.0.0.1:${port}/ws`;

const manager = new RuntimeManager({});
let app: ReturnType<typeof createAgentServer> | undefined;

try {
  const config = loadConfig();
  app = createAgentServer(config, manager);
  await new Promise<void>((resolve, reject) => {
    app!.server.once("error", reject);
    app!.server.listen(config.port, "127.0.0.1", () => resolve());
  });
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) throw new Error(`health returned ${response.status}`);
  const body = (await response.json()) as { ok?: boolean; sessions?: number };
  if (body.ok !== true) throw new Error("health did not return ok=true");
  console.log(`platform smoke ok: ${process.platform}/${process.arch}, sessions=${body.sessions ?? 0}`);
} finally {
  await app?.close().catch(() => undefined);
  await manager.dispose().catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
}
