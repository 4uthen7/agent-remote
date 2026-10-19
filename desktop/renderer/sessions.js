(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let socket = null;
  let socketKey = "";
  let reconnectTimer = null;
  let sessions = [];
  let current = null;
  let timeline = [];
  let approvals = [];
  let lastStreamingAssistant = false;
  let view = "host";

  function hostState() { return window.hostState || {}; }

  function setView(next) {
    view = next;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === next));
    $("host-view").classList.toggle("hidden", next !== "host");
    $("sessions-view").classList.toggle("hidden", next !== "sessions");
    if (next === "sessions") renderSessions();
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

  function wsUrl() {
    const state = hostState();
    return `ws://127.0.0.1:${state.port}/ws`;
  }

  function connect() {
    const state = hostState();
    if (state.status !== "running" || !state.port || !state.token) {
      closeSocket();
      return;
    }
    const key = `${state.port}:${state.token}`;
    if (socket && socketKey === key && socket.readyState <= 1) return;
    closeSocket();
    socketKey = key;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      scheduleReconnect();
      return;
    }
    socket.addEventListener("open", () => {
      send({ type: "hello", token: state.token, deviceName: "desktop" });
    });
    socket.addEventListener("message", (event) => {
      try { handle(JSON.parse(event.data)); } catch { /* ignore malformed */ }
    });
    socket.addEventListener("close", () => {
      if (socketKey === key) socket = null;
      scheduleReconnect();
    });
    socket.addEventListener("error", () => { /* close follows */ });
  }

  function closeSocket() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      try { socket.close(); } catch {}
      socket = null;
    }
    socketKey = "";
  }

  function scheduleReconnect() {
    if (hostState().status !== "running" || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1200);
  }

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  function handle(message) {
    switch (message.type) {
      case "hello_ok":
        sessions = message.sessions || [];
        renderSessions();
        break;
      case "sessions":
        sessions = message.sessions || [];
        renderSessions();
        break;
      case "session":
        if (message.session) {
          const index = sessions.findIndex((item) => item.id === message.session.id);
          if (index >= 0) sessions[index] = message.session;
          else sessions.push(message.session);
          if (current?.id === message.session.id) current = message.session;
          renderSessions();
          renderChat();
        }
        break;
      case "snapshot":
        if (message.session) {
          current = message.session;
          const index = sessions.findIndex((item) => item.id === current.id);
          if (index >= 0) sessions[index] = current;
          else sessions.push(current);
        }
        timeline = [];
        lastStreamingAssistant = false;
        for (const event of message.events || []) applyEvent(event, true);
        approvals = message.approvals || [];
        renderSessions();
        renderChat();
        break;
      case "event":
        if (message.sessionId && current?.id === message.sessionId) {
          applyEvent(message.event, false);
          renderChat();
        }
        break;
      case "approval":
        if (message.approval && current?.id === message.approval.sessionId) {
          approvals = [message.approval];
          renderChat();
        }
        break;
      case "approval_resolved":
        approvals = approvals.filter((item) => item.id !== message.approvalId);
        renderChat();
        break;
      case "models":
        if (current) {
          current.configOptions = message.configOptions || [];
          renderChat();
        }
        break;
      case "config":
        if (message.configOptions && current) {
          current.configOptions = message.configOptions;
          renderChat();
        }
        break;
      case "session_removed":
        sessions = sessions.filter((item) => item.id !== message.sessionId);
        if (current?.id === message.sessionId) {
          current = null;
          timeline = [];
          approvals = [];
        }
        renderSessions();
        renderChat();
        break;
      case "error":
        if (message.message) {
          timeline.push({ kind: "error", text: message.message });
          renderChat();
        }
        break;
      default:
        break;
    }
  }

  function applyEvent(event, historical) {
    if (!event) return;
    switch (event.type) {
      case "user_message":
        timeline.push({ kind: "user", text: event.text || "" });
        lastStreamingAssistant = false;
        break;
      case "assistant_delta": {
        const text = event.text || "";
        if (!text) break;
        const last = timeline[timeline.length - 1];
        if (last && last.kind === "assistant" && lastStreamingAssistant) last.text += text;
        else timeline.push({ kind: "assistant", text });
        lastStreamingAssistant = true;
        break;
      }
      case "thought_delta": {
        const text = event.text || "";
        if (!text) break;
        const last = timeline[timeline.length - 1];
        if (last && last.kind === "thought" && lastStreamingAssistant) last.text += text;
        else timeline.push({ kind: "thought", text });
        lastStreamingAssistant = true;
        break;
      }
      case "tool_call":
        timeline.push({
          kind: "tool",
          toolCallId: event.toolCallId,
          text: `${event.title || event.kind || "tool"}${event.command ? `\n$ ${event.command}` : ""}${event.output ? `\n${event.output}` : ""}`,
        });
        lastStreamingAssistant = false;
        break;
      case "tool_update": {
        const item = [...timeline].reverse().find((entry) => entry.kind === "tool" && entry.toolCallId === event.toolCallId);
        if (item) {
          if (event.output) item.text += `\n${event.output}`;
          if (event.status) item.text += `\n[${event.status}]`;
        }
        break;
      }
      case "turn_end":
        lastStreamingAssistant = false;
        if (current?.status === "running") current.status = "idle";
        break;
      case "usage":
        break;
      case "notice":
        timeline.push({ kind: "notice", text: event.text || event.message || "" });
        break;
      case "error":
        timeline.push({ kind: "error", text: event.message || event.text || "エラー" });
        lastStreamingAssistant = false;
        break;
      default:
        break;
    }
    if (historical && event.type === "turn_end") lastStreamingAssistant = false;
  }

  function projectGroups() {
    const groups = new Map();
    for (const session of sessions) {
      const cwd = session.cwd || "—";
      if (!groups.has(cwd)) groups.set(cwd, []);
      groups.get(cwd).push(session);
    }
    return [...groups.entries()]
      .map(([cwd, items]) => ({ cwd, sessions: items.sort((a, b) => b.updatedAt - a.updatedAt) }))
      .sort((a, b) => (b.sessions[0]?.updatedAt || 0) - (a.sessions[0]?.updatedAt || 0));
  }

  function renderSessions() {
    if (view !== "sessions") return;
    const list = $("session-list");
    list.replaceChildren();
    if (!sessions.length) {
      list.append(el("p", "muted", "セッションがありません。右上の「新規」から開始できます。"));
      return;
    }
    for (const project of projectGroups()) {
      const group = el("div", "project");
      const head = el("div", "project-head");
      const name = project.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || project.cwd;
      head.append(el("span", "project-name", name), el("span", "muted", `${project.sessions.length}`));
      group.append(head, el("div", "project-path", project.cwd));
      for (const session of project.sessions) {
        const button = el("button", `session-item${current?.id === session.id ? " active" : ""}`);
        button.type = "button";
        const title = el("div", "session-item-title", session.title || "Session");
        const meta = el("div", "session-item-meta");
        meta.append(
          el("span", `pill ${session.archived ? "archived" : "live"}`, session.archived ? (session.resumable ? "終了・再開可能" : "別ホスト") : statusText(session.status)),
          el("span", "", runtimeText(session.runtime)),
        );
        const last = el("div", "session-item-last", session.lastMessage || session.cwd || "");
        button.append(title, meta, last);
        button.addEventListener("click", () => openSession(session));
        group.append(button);
      }
      list.append(group);
    }
  }

  function statusText(status) {
    return { running: "実行中", awaiting_approval: "承認待ち", error: "エラー" }[status] || "待機中";
  }
  function runtimeText(runtime) {
    return { codex: "Codex", claude: "Claude", dsh: "DSH" }[runtime] || runtime;
  }

  function openSession(session) {
    current = session;
    timeline = [];
    approvals = [];
    lastStreamingAssistant = false;
    renderSessions();
    renderChat();
    send({ type: "subscribe", sessionId: session.id });
  }

  function renderChat() {
    if (view !== "sessions") return;
    const empty = $("chat-empty");
    const chat = $("chat-view");
    if (!current) {
      empty.classList.remove("hidden");
      chat.classList.add("hidden");
      return;
    }
    empty.classList.add("hidden");
    chat.classList.remove("hidden");
    $("chat-title").textContent = current.title || "Session";
    $("chat-meta").textContent = `${current.cwd || ""} · ${runtimeText(current.runtime)} · ${current.archived ? (current.resumable ? "終了・再開可能" : "別ホストの履歴") : statusText(current.status)}`;
    $("chat-model").disabled = Boolean(current.archived);
    $("chat-cancel").classList.toggle("hidden", current.archived || !(current.status === "running" || current.status === "awaiting_approval"));
    $("composer").classList.toggle("hidden", Boolean(current.archived));
    const banner = $("archived-banner");
    banner.classList.toggle("hidden", !current.archived);
    if (current.archived) {
      $("archived-text").textContent = current.resumable
        ? "履歴を表示中。再開すると続きから話せます。"
        : `この履歴は ${current.originHost || "別のホスト"} のものです。`;
      $("resume-session").classList.toggle("hidden", !current.resumable);
    }
    renderModel();
    renderApproval();
    renderTimeline();
  }

  function renderModel() {
    const select = $("chat-model");
    const options = [];
    const model = (current?.configOptions || []).find((option) => option.id === "model");
    const walk = (entries) => {
      for (const entry of entries || []) {
        if (entry.options) walk(entry.options);
        else if (entry.value) options.push(entry);
      }
    };
    walk(model?.options);
    if (!options.length) {
      select.replaceChildren();
      select.classList.add("hidden");
      return;
    }
    select.classList.remove("hidden");
    select.replaceChildren();
    for (const option of options) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.name || option.value;
      node.selected = option.value === model.currentValue;
      select.append(node);
    }
  }

  function renderApproval() {
    const banner = $("approval-banner");
    const approval = approvals[0];
    if (!approval) {
      banner.classList.add("hidden");
      return;
    }
    banner.classList.remove("hidden");
    $("approval-command").textContent = [approval.title, approval.command, approval.cwd].filter(Boolean).join("\n");
    const options = $("approval-options");
    options.replaceChildren();
    for (const option of approval.options || []) {
      const button = el("button", "", option.name || option.optionId);
      button.type = "button";
      button.addEventListener("click", () => {
        send({ type: "approve", approvalId: approval.id, optionId: option.optionId });
      });
      options.append(button);
    }
  }

  function renderTimeline() {
    const list = $("chat-timeline");
    list.replaceChildren();
    for (const item of timeline) {
      if (!item.text) continue;
      list.append(el("div", `msg ${item.kind}`, item.text));
    }
    list.scrollTop = list.scrollHeight;
  }

  $("new-session").addEventListener("click", () => {
    const form = $("new-session-form");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden") && !$("new-session-cwd").value) {
      const roots = (hostState().settings?.roots || "").split(processPathSeparator());
      $("new-session-cwd").value = roots[0] || "";
    }
  });
  $("create-session").addEventListener("click", () => {
    const cwd = $("new-session-cwd").value.trim();
    if (!cwd) return;
    send({ type: "create_session", cwd, runtime: $("new-session-runtime").value });
    $("new-session-form").classList.add("hidden");
  });
  $("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("draft");
    const text = input.value.trim();
    if (!text || !current || current.archived) return;
    send({ type: "prompt", sessionId: current.id, text });
    input.value = "";
    input.style.height = "auto";
  });
  $("draft").addEventListener("input", () => {
    const input = $("draft");
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });
  $("draft").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("chat-cancel").addEventListener("click", () => {
    if (current) send({ type: "cancel", sessionId: current.id });
  });
  $("resume-session").addEventListener("click", () => {
    if (!current) return;
    send({ type: "resume_session", sessionId: current.id, cwd: current.cwd, runtime: current.runtime });
  });
  $("chat-model").addEventListener("change", () => {
    if (current) send({ type: "set_model", sessionId: current.id, value: $("chat-model").value });
  });
  $("chat-back").addEventListener("click", () => {
    current = null;
    timeline = [];
    approvals = [];
    renderChat();
    renderSessions();
  });

  function processPathSeparator() {
    return navigator.platform.toLowerCase().includes("win") ? ";" : ":";
  }

  window.updateSessionView = (state) => {
    connect();
    renderSessions();
    renderChat();
  };

  setInterval(() => {
    if (hostState().status === "running" && (!socket || socket.readyState > 1)) connect();
  }, 2000);
})();
