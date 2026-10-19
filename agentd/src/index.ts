import qrcode from "qrcode-terminal";
import { loadConfig } from "./config.js";
import { DshAdapter } from "./acp/dsh.js";
import { createAgentServer } from "./server.js";
import { log, sleep } from "./util.js";

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

  const adapter = new DshAdapter({
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

  await adapter.start();

  const app = createAgentServer(config, adapter);
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(config.port, config.bind, () => resolve());
  });

  const pairUrl = `agentremote://pair?url=${encodeURIComponent(config.publicUrl)}&token=${encodeURIComponent(config.token)}`;

  log("");
  log(`WebSocket: ${config.publicUrl}`);
  log(`Health:    http://${config.bind === "0.0.0.0" ? "127.0.0.1" : config.bind}:${config.port}/health`);
  log(`Token:     ${config.token}`);
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
      await adapter.dispose();
    } catch (error) {
      log(`adapter dispose failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  adapter.once("exit", () => {
    log("DSH exited; agentd will stop so the service manager can restart it.");
    void sleep(500).then(() => void shutdown("DSH exit"));
  });
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
