const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const QRCode = require("qrcode");
const treeKill = require("tree-kill");
const pkg = require("./package.json");

const APP_VERSION = pkg.version;
const MAX_LOGS = 500;
const SUPPORTED = [
  { id: "dsh", name: "DeepSeek Harness", short: "DSH", command: "dsh" },
  { id: "codex", name: "Codex", short: "Codex", command: "codex" },
  { id: "claude", name: "Claude Code", short: "Claude", command: "claude" },
];
const OTHER_TOOLS = [
  { id: "cursor", name: "Cursor", command: "cursor" },
  { id: "vscode", name: "VS Code", command: "code" },
  { id: "windsurf", name: "Windsurf", command: "windsurf" },
  { id: "aider", name: "Aider", command: "aider" },
  { id: "gemini", name: "Gemini CLI", command: "gemini" },
  { id: "opencode", name: "OpenCode", command: "opencode" },
];

let win = null;
let child = null;
let stopping = false;
let startGeneration = 0;
let state = {
  version: APP_VERSION,
  agentdVersion: "0.6.0",
  status: "stopped",
  error: null,
  port: 8787,
  ip: "",
  ips: [],
  token: "",
  pairUrl: "",
  qr: "",
  tools: [],
  otherTools: [],
  logs: [],
  settings: {},
  paths: {},
};
let settingsPath = "";
let tokenPath = "";
let settings = {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pushLog(line) {
  const text = String(line).replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
  if (!text) return;
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "agentd.log"), `${new Date().toISOString()} ${text}\n`);
  } catch {
    // Logging is best-effort.
  }
  for (const part of text.split(/\r?\n/)) {
    if (part.trim()) state.logs.push(part);
  }
  if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
  broadcast();
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("host:state", state);
}

function setState(patch) {
  state = { ...state, ...patch };
  broadcast();
}

function loadSettings() {
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  tokenPath = path.join(app.getPath("userData"), "token");
  const defaults = {
    roots: os.homedir(),
    port: 8787,
    ip: "auto",
    syncUrl: "",
    syncRoom: "default",
    syncKey: "",
    syncToken: "",
  };
  try {
    settings = { ...defaults, ...JSON.parse(fs.readFileSync(settingsPath, "utf8")) };
  } catch {
    settings = defaults;
  }
  state.settings = settings;
}

function saveSettings(next) {
  settings = {
    ...settings,
    ...next,
    roots: String(next.roots ?? settings.roots ?? "").trim() || os.homedir(),
    port: Number(next.port ?? settings.port) || 8787,
    syncRoom: String(next.syncRoom ?? settings.syncRoom ?? "default").trim() || "default",
  };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  state.settings = settings;
  return settings;
}

function readToken() {
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // generate below
  }
  const token = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

function toolPath() {
  const home = os.homedir();
  const extra =
    process.platform === "win32"
      ? [
          path.join(process.env.APPDATA || home, "npm"),
          path.join(process.env.LOCALAPPDATA || home, "Programs"),
          path.join(home, ".local", "bin"),
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          path.join(home, ".local", "bin"),
          path.join(home, ".npm-global", "bin"),
          path.join(home, ".bun", "bin"),
          path.join(home, ".cargo", "bin"),
        ];
  return [...extra, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
}

function which(command) {
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(finder, [command], {
      encoding: "utf8",
      env: { ...process.env, PATH: toolPath() },
      windowsHide: true,
      timeout: 5000,
    }).trim();
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

function versionOf(command) {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, ["--version"], {
        env: { ...process.env, PATH: toolPath() },
        windowsHide: true,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const done = () => resolve(output.trim().split(/\r?\n/)[0].slice(0, 160));
      proc.stdout.on("data", (chunk) => (output += chunk.toString()));
      proc.stderr.on("data", (chunk) => (output += chunk.toString()));
      proc.on("error", () => resolve(""));
      proc.on("close", done);
      setTimeout(() => {
        try { proc.kill(); } catch {}
        done();
      }, 3500).unref();
    } catch {
      resolve("");
    }
  });
}

async function detectTools() {
  const tools = [];
  for (const tool of SUPPORTED) {
    let bin = which(tool.command);
    let note = "";
    if (tool.id === "dsh" && !bin && process.platform === "darwin") {
      const appPath = process.env.DSH_APP_PATH || "/Applications/DeepSeek Harness.app";
      if (fs.existsSync(appPath)) {
        bin = appPath;
        note = "アプリを検出";
      }
    }
    const version = bin ? await versionOf(bin) : "";
    tools.push({ ...tool, installed: Boolean(bin), path: bin || "", version, note });
  }
  const otherTools = [];
  for (const tool of OTHER_TOOLS) {
    const bin = which(tool.command);
    if (bin) otherTools.push({ ...tool, path: bin, version: await versionOf(bin) });
  }
  state.tools = tools;
  state.otherTools = otherTools;
  broadcast();
  return tools;
}

function lanAddresses() {
  const found = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal) continue;
      if (address.address.startsWith("169.254.")) continue;
      found.push({ name, address: address.address });
    }
  }
  const score = (ip) =>
    ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : ip.startsWith("100.") ? 3 : 4;
  return found.sort((a, b) => score(a.address) - score(b.address));
}

function chooseIp(ips) {
  const requested = String(settings.ip || "auto");
  if (requested !== "auto" && ips.some((item) => item.address === requested)) return requested;
  return ips[0]?.address || "127.0.0.1";
}

async function findFreePort(start) {
  for (let port = start; port < start + 40; port += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      // agentd binds 0.0.0.0. A loopback-only probe can succeed on macOS
      // while the wildcard port is already occupied, so probe all interfaces.
      server.listen(port, "0.0.0.0");
    });
    if (free) return port;
  }
  throw new Error(`No free port found from ${start}`);
}

function agentdEntry() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "agentd", "dist", "index.js");
  }
  return path.join(__dirname, "resources", "agentd", "dist", "index.js");
}

async function waitForHealth(port, generation) {
  for (let i = 0; i < 80; i += 1) {
    if (generation !== startGeneration) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return true;
    } catch {
      // keep waiting
    }
    await sleep(250);
  }
  return false;
}

async function startHost() {
  if (state.status === "starting" || state.status === "running") await stopHost();
  const generation = ++startGeneration;
  stopping = false;
  setState({ status: "starting", error: null, qr: "", pairUrl: "" });

  try {
    const tools = await detectTools();
    const port = await findFreePort(Number(settings.port) || 8787);
    const ips = lanAddresses();
    const ip = chooseIp(ips);
    const token = readToken();
    setState({ port, ip, ips, token });
    const entry = agentdEntry();
    if (!fs.existsSync(entry)) throw new Error(`agentd が見つかりません: ${entry}`);
    const byId = Object.fromEntries(tools.map((tool) => [tool.id, tool]));
    const env = {
      ...process.env,
      PATH: toolPath(),
      ELECTRON_RUN_AS_NODE: "1",
      AGENT_REMOTE_HOME: app.getPath("userData"),
      AGENT_REMOTE_TOKEN: token,
      AGENT_REMOTE_PORT: String(port),
      AGENT_REMOTE_BIND: "0.0.0.0",
      AGENT_REMOTE_PUBLIC_URL: `ws://${ip}:${port}/ws`,
      AGENT_REMOTE_ROOTS: settings.roots || os.homedir(),
      AGENT_REMOTE_SYNC_DIR: path.join(app.getPath("userData"), "sessions"),
    };
    if (byId.dsh?.installed) {
      if (byId.dsh.path.endsWith(".app")) env.DSH_APP_PATH = byId.dsh.path;
      else env.DSH_BIN = byId.dsh.path;
    }
    if (byId.codex?.installed) env.CODEX_BIN = byId.codex.path;
    if (settings.syncUrl?.trim() && settings.syncKey?.trim()) {
      env.AGENT_REMOTE_SYNC_URL = settings.syncUrl.trim();
      env.AGENT_REMOTE_SYNC_ROOM = settings.syncRoom || "default";
      env.AGENT_REMOTE_SYNC_KEY = settings.syncKey;
      if (settings.syncToken) env.AGENT_REMOTE_SYNC_TOKEN = settings.syncToken;
    } else {
      delete env.AGENT_REMOTE_SYNC_URL;
      delete env.AGENT_REMOTE_SYNC_ROOM;
      delete env.AGENT_REMOTE_SYNC_KEY;
      delete env.AGENT_REMOTE_SYNC_TOKEN;
    }

    pushLog(`agentd starting on ${ip}:${port}`);
    child = spawn(process.execPath, [entry], {
      cwd: app.getPath("userData"),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => pushLog(chunk.toString()));
    child.stderr.on("data", (chunk) => pushLog(chunk.toString()));
    child.on("error", (error) => {
      if (generation === startGeneration) setState({ status: "error", error: error.message });
    });
    child.on("exit", (code, signal) => {
      child = null;
      if (generation !== startGeneration || stopping) return;
      setState({
        status: "error",
        error: `agentd が終了しました (${code ?? signal ?? "unknown"})`,
      });
    });

    const healthy = await waitForHealth(port, generation);
    if (!healthy || generation !== startGeneration) {
      throw new Error("agentd の起動がタイムアウトしました。ログを確認してください。");
    }
    const pairUrl = `agentremote://pair?url=${encodeURIComponent(`ws://${ip}:${port}/ws`)}&token=${encodeURIComponent(token)}`;
    const qr = await QRCode.toDataURL(pairUrl, {
      width: 360,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#071018", light: "#ffffff" },
    });
    setState({
      status: "running",
      error: null,
      port,
      ip,
      ips,
      token,
      pairUrl,
      qr,
      paths: { data: app.getPath("userData") },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushLog(`start failed: ${message}`);
    await stopHost();
    setState({ status: "error", error: message, qr: "", pairUrl: "" });
  }
}

async function stopHost() {
  startGeneration += 1;
  if (!child) {
    if (state.status !== "error") setState({ status: "stopped", qr: "", pairUrl: "" });
    return;
  }
  stopping = true;
  const pid = child.pid;
  child = null;
  setState({ status: "stopped", qr: "", pairUrl: "" });
  await new Promise((resolve) => {
    if (!pid) return resolve();
    treeKill(pid, "SIGTERM", () => resolve());
    setTimeout(resolve, 2500).unref();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 940,
    minHeight: 680,
    title: "Agent Remote",
    backgroundColor: "#071018",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => { win = null; });
}

ipcMain.handle("host:get-state", () => state);
ipcMain.handle("host:start", async () => { await startHost(); return state; });
ipcMain.handle("host:stop", async () => { await stopHost(); return state; });
ipcMain.handle("host:refresh-tools", async () => { await detectTools(); return state; });
ipcMain.handle("host:save-settings", async (_event, next) => {
  saveSettings(next || {});
  if (state.status === "running" || state.status === "starting") await startHost();
  return state;
});
ipcMain.handle("host:copy", (_event, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle("host:open-data", async () => { await shell.openPath(app.getPath("userData")); });
ipcMain.handle("host:open-docs", async () => {
  await shell.openExternal("https://github.com/4uthen7/agent-remote#readme");
});
ipcMain.handle("host:choose-folder", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("host:clear-logs", () => { state.logs = []; broadcast(); return true; });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    loadSettings();
    createWindow();
    await detectTools();
    await startHost();
  });
  app.on("activate", () => {
    if (!win) createWindow();
  });
  app.on("window-all-closed", () => { app.quit(); });
  app.on("before-quit", () => {
    stopping = true;
    if (child?.pid) treeKill(child.pid, "SIGTERM");
  });
}
