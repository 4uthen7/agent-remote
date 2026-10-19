import qrcode from "qrcode-terminal";
import { loadConfig } from "./config.js";
import { DshAdapter } from "./acp/dsh.js";
import { CodexAdapter } from "./codex/adapter.js";
import { ClaudeAdapter } from "./claude/adapter.js";
import { RuntimeManager } from "./runtime/manager.js";
import { SessionStore } from "./session-store.js";
import { createAgentServer } from "./server.js";
import { lanAddresses, log, platformName, sleep } from "./util.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const dshArgs = [
    ...config.dshRuntime.argsPrefix,
    "--profile",
    config.dshProfile,
    "--patch",
    config.dshPatchPath,
  ];

  log(`Agent Remote agentd v${config.version}`);
  log(`DSH runtime: ${config.dshRuntime.description}`);
  log(`DSH profile: ${config.dshProfile} (provider=${config.dshProvider}, model=${config.dshModel})`);
  log(`Allowed roots: ${config.roots.join(", ")}`);
  log(`Platform: ${platformName()} (${process.platform}/${process.arch})`);
  log(`Session archive: ${config.syncDir}`);
  log("Runtimes: dsh, codex, claude (lazy)");

  const sessionStore = new SessionStore(config.syncDir, config.hostName);
  const manager = new RuntimeManager({
    dsh: () => {
      if (config.dshRuntimeError) throw new Error(config.dshRuntimeError);
      return new DshAdapter({
        command: config.dshRuntime.command,
        args: dshArgs,
        env: {
          ...process.env,
          ...config.dshRuntime.env,
          DSH_HOME: config.dshHome,
          DSH_PROFILE: config.dshProfile,
          // Never inherit a dangerous permission mode from the parent shell.
          DSH_PERMISSION_MODE: "workspace-write",
        },
        logger: (line) => log(line),
      });
    },
    codex: () =>
      new CodexAdapter({
        command: config.codexBin,
        logger: (line) => log(line),
      }),
    claude: () =>
      new ClaudeAdapter({
        model: config.claudeModel,
        logger: (line) => log(line),
      }),
  }, sessionStore);

  manager.on("exit", (info: unknown) => {
    const record = typeof info === "object" && info !== null ? (info as Record<string, unknown>) : {};
    log(`runtime exited: ${String(record.runtime ?? "unknown")} (${String(record.reason ?? "")})`);
  });

  const app = createAgentServer(config, manager);
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(config.port, config.bind, () => resolve());
  });

  const pairUrl = `agentremote://pair?url=${encodeURIComponent(config.publicUrl)}&token=${encodeURIComponent(config.token)}`;

  log("");
  log(`WebSocket: ${config.publicUrl}`);
  log(`Health:    http://${config.bind === "0.0.0.0" ? "127.0.0.1" : config.bind}:${config.port}/health`);
  log(`Token:     ${config.token}`);
  const addresses = lanAddresses();
  if (addresses.length > 0) {
    log("Host addresses (use one your phone can reach):");
    for (const item of addresses) {
      log(`  ${item.name}: ws://${item.address}:${config.port}/ws`);
    }
  }
  if (process.platform === "win32") {
    log("Windows: allow Node.js on Private networks when the firewall prompt appears.");
  }
  log("");
  log("Scan this with the Agent Remote iOS app:");
  qrcode.generate(pairUrl, { small: true });
  log("");
  log("Keep this process running. Ctrl+C to stop.");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}; shutting down...`);
    try {
      await app.close();
    } catch (error) {
      log(`server close failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await manager.dispose();
    } catch (error) {
      log(`runtime dispose failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  void sleep(0);
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
