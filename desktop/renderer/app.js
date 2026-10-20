const $ = (id) => document.getElementById(id);
let state = null;
let busy = false;

const statusText = { stopped: "停止中", starting: "起動中…", running: "接続受付中", error: "エラー" };

function text(id, value) {
  const element = $(id);
  if (element) element.textContent = value ?? "";
}

function render(next) {
  state = next;
  const running = state.status === "running";
  const starting = state.status === "starting";
  const pill = $("status-pill");
  pill.className = `status status-${state.status}`;
  pill.textContent = statusText[state.status] || state.status;

  text("version", state.version || "");
  const startStop = $("start-stop");
  startStop.textContent = running || starting ? "停止" : "起動";
  startStop.disabled = busy || starting;
  startStop.classList.toggle("primary", !running && !starting);
  startStop.classList.toggle("ghost", running || starting);

  const qr = $("qr");
  if (running && state.qr) {
    qr.src = state.qr;
    qr.classList.add("ready");
    $("qr-placeholder").classList.add("hidden");
  } else {
    qr.removeAttribute("src");
    qr.classList.remove("ready");
    $("qr-placeholder").classList.remove("hidden");
    $("qr-placeholder").lastElementChild.textContent =
      state.status === "error" ? "起動に失敗しました" : "ホストを起動しています…";
  }

  const error = $("error");
  if (state.error) {
    error.textContent = state.error;
    error.classList.remove("hidden");
  } else {
    error.classList.add("hidden");
  }

  const port = state.port || 8787;
  text("host-url", state.publicUrl || (state.ip ? `ws://${state.ip}:${port}/ws` : "—"));
  text("token", state.token || "—");
  $("copy-url").disabled = !running;
  $("copy-token").disabled = !running;

  renderTools();
  renderForm();
  renderLogs();
  window.hostState = state;
  window.updateSessionView?.(state);
}

function renderTools() {
  const list = $("tools");
  list.replaceChildren();
  for (const tool of state.tools || []) {
    const row = document.createElement("div");
    row.className = "tool";
    const dot = document.createElement("div");
    dot.className = `tool-dot ${tool.installed ? "ok" : ""}`;
    const main = document.createElement("div");
    main.className = "tool-main";
    const name = document.createElement("div");
    name.className = "tool-name";
    name.textContent = tool.name;
    const path = document.createElement("div");
    path.className = "tool-path";
    path.textContent = tool.installed ? (tool.path || "検出済み") : "未検出";
    main.append(name, path);
    const right = document.createElement("div");
    right.className = "tool-version";
    if (tool.installed) {
      right.textContent = tool.version || tool.note || "ready";
    } else {
      right.className = "tool-missing";
      right.textContent = "未検出";
    }
    row.append(dot, main, right);
    list.append(row);
  }
  const others = state.otherTools || [];
  $("other-tools-wrap").classList.toggle("hidden", others.length === 0);
  const chips = $("other-tools");
  chips.replaceChildren();
  for (const tool of others) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${tool.name}${tool.version ? ` · ${tool.version}` : ""}`;
    chips.append(chip);
  }
}

let lastSettingsKey = "";
function renderForm() {
  const settings = state.settings || {};
  const key = JSON.stringify({
    ips: state.ips,
    settings,
  });
  const select = $("ip");
  if (select.options.length !== (state.ips || []).length + 1) {
    select.replaceChildren();
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = "自動";
    select.append(auto);
    for (const item of state.ips || []) {
      const option = document.createElement("option");
      option.value = item.address;
      option.textContent = `${item.address} (${item.name})`;
      select.append(option);
    }
  }
  if (document.activeElement !== select) select.value = settings.ip || "auto";
  const displayPort = state.status === "running" || state.status === "starting" ? state.port : settings.port;
  if (document.activeElement !== $("port")) $("port").value = displayPort || 8787;
  if (document.activeElement !== $("roots")) $("roots").value = settings.roots || "";
  if (document.activeElement !== $("syncUrl")) $("syncUrl").value = settings.syncUrl || "";
  if (document.activeElement !== $("syncRoom")) $("syncRoom").value = settings.syncRoom || "default";
  if (document.activeElement !== $("syncKey")) $("syncKey").value = settings.syncKey || "";
  if (document.activeElement !== $("syncToken")) $("syncToken").value = settings.syncToken || "";
  lastSettingsKey = key;
}

function renderLogs() {
  const logs = $("logs");
  const atBottom = logs.scrollTop + logs.clientHeight >= logs.scrollHeight - 24;
  logs.textContent = (state.logs || []).join("\n");
  if (atBottom) logs.scrollTop = logs.scrollHeight;
}

async function action(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (error) {
    console.error(error);
  } finally {
    busy = false;
    if (state) render(state);
  }
}

$("start-stop").addEventListener("click", () => action(async () => {
  if (state.status === "running" || state.status === "starting") await window.hostApi.stop();
  else await window.hostApi.start();
}));

$("refresh-tools").addEventListener("click", () => action(() => window.hostApi.refreshTools()));

$("copy-url").addEventListener("click", () => action(() => window.hostApi.copy($("host-url").textContent)));
$("copy-token").addEventListener("click", () => action(() => window.hostApi.copy($("token").textContent)));

$("clear-logs").addEventListener("click", () => action(() => window.hostApi.clearLogs()));
$("open-data").addEventListener("click", () => action(() => window.hostApi.openData()));
$("open-docs").addEventListener("click", () => action(() => window.hostApi.openDocs()));

$("choose-folder").addEventListener("click", () => action(async () => {
  const folder = await window.hostApi.chooseFolder();
  if (!folder) return;
  const current = $("roots").value.trim();
  const separator = navigator.platform.toLowerCase().includes("win") ? ";" : ":";
  $("roots").value = current ? `${current}${separator}${folder}` : folder;
}));

$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(async () => {
    const next = {
      ip: $("ip").value,
      port: Number($("port").value) || 8787,
      roots: $("roots").value.trim(),
      syncUrl: $("syncUrl").value.trim(),
      syncRoom: $("syncRoom").value.trim() || "default",
      syncKey: $("syncKey").value,
      syncToken: $("syncToken").value,
    };
    await window.hostApi.saveSettings(next);
  });
});

window.hostApi.onState((next) => {
  if (!state) {
    render(next);
    return;
  }
  const atBottom = $("logs").scrollTop + $("logs").clientHeight >= $("logs").scrollHeight - 24;
  const oldLogs = (state.logs || []).length;
  state = next;
  render(next);
  if (!atBottom && oldLogs > 0) {
    // Keep the user's scroll position when they are reading older output.
    $("logs").scrollTop = Math.max(0, $("logs").scrollHeight - $("logs").clientHeight - 100);
  }
});

window.hostApi.getState().then(render).catch((error) => {
  console.error(error);
  text("error", String(error));
  $("error").classList.remove("hidden");
});
