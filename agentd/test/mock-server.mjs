import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_PORT || 8788);
const TOKEN = process.env.MOCK_TOKEN || "demo";

const now = Date.now();
const sessions = new Map();

function configOptions(model = '["deepseek-account","deepseek-flash"]') {
  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model,
      options: [
        {
          group: "DeepSeek",
          name: "DeepSeek",
          options: [
            { value: '["deepseek-account","deepseek-flash"]', name: "DeepSeek-V4.1-Flash" },
            { value: '["deepseek-account","deepseek-v4-pro"]', name: "DeepSeek-V4-Pro" },
          ],
        },
      ],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      type: "select",
      currentValue: "high",
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
        { value: "max", name: "Max" },
      ],
    },
  ];
}

function makeSession({ id, title, cwd, status = "idle", model = '["deepseek-account","deepseek-flash"]' }) {
  return {
    id,
    title,
    cwd,
    status,
    runtime: "dsh",
    model: model.includes("pro") ? "DeepSeek-V4-Pro" : "DeepSeek-V4.1-Flash",
    createdAt: now,
    updatedAt: now,
    events: [],
    seq: 0,
    configOptions: configOptions(model),
    pendingApprovals: [],
  };
}

function event(session, data) {
  session.seq += 1;
  session.updatedAt = Date.now();
  const value = { seq: session.seq, ...data };
  session.events.push(value);
  return value;
}

const core = makeSession({
  id: "core",
  title: "Refactor auth middleware",
  cwd: "/Users/demo/Projects/atlas",
  status: "awaiting_approval",
});
event(core, { type: "user_message", text: "Refactor the auth middleware. Keep the public API stable and run the test suite." });
event(core, { type: "assistant_delta", text: "I’ll trace the middleware and its call sites first, then make the smallest safe change." });
event(core, { type: "thought_delta", text: "Searching for the auth middleware, its consumers, and the session-expiry tests." });
event(core, {
  type: "tool_call",
  toolCallId: "exec-1",
  title: "bash",
  kind: "other",
  status: "completed",
  command: "rg -n \"authMiddleware|requireAuth\" src",
  cwd: "/Users/demo/Projects/atlas",
});
event(core, {
  type: "tool_update",
  toolCallId: "exec-1",
  status: "completed",
  output: "src/auth/middleware.ts:12: export function authMiddleware()\nsrc/routes/api.ts:8: requireAuth,\nsrc/routes/admin.ts:19: requireAuth,\n… 11 more",
});
event(core, {
  type: "assistant_delta",
  text: "Found the middleware in `src/auth/middleware.ts` and 14 call sites. Tests cover the happy path but not expired sessions.",
});
event(core, {
  type: "tool_call",
  toolCallId: "exec-2",
  title: "bash",
  kind: "other",
  status: "in_progress",
  command: "npm test -- --runInBand",
  cwd: "/Users/demo/Projects/atlas",
});
event(core, { type: "usage", used: 12840, size: 1048576 });
event(core, {
  type: "assistant_delta",
  text: "I need to update the shared auth package outside the workspace. Approve the escalation and I’ll finish the refactor and rerun the suite.",
});

const approval = {
  id: "approval-demo-1",
  sessionId: "core",
  toolCallId: "exec-3",
  title: "bash",
  command: "npm run build && cp dist/auth.js ../shared/auth.js",
  cwd: "/Users/demo/Projects/atlas",
  justification: "The shared auth package is outside the workspace sandbox. This exact command publishes the rebuilt middleware to the shared package and then reruns the test suite.",
  sandbox: "danger-full-access",
  kind: "other",
  options: [
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
    { optionId: "reject-once", name: "Reject", kind: "reject_once" },
  ],
  createdAt: now,
};
core.pendingApprovals.push(approval);
sessions.set(core.id, core);

const ops = makeSession({
  id: "ops",
  title: "Rotate staging credentials",
  cwd: "/Users/demo/Infra/ops",
  status: "running",
  model: '["deepseek-account","deepseek-v4-pro"]',
});
event(ops, { type: "user_message", text: "Rotate the staging deploy key and verify the pipeline." });
event(ops, { type: "assistant_delta", text: "Generating a new deploy key, updating the secret store, then triggering a dry-run deploy." });
event(ops, {
  type: "tool_call",
  toolCallId: "ops-1",
  title: "bash",
  kind: "other",
  status: "in_progress",
  command: "deployctl keys rotate --env staging",
  cwd: "/Users/demo/Infra/ops",
});
event(ops, { type: "usage", used: 4210, size: 1048576 });
sessions.set(ops.id, ops);

const notes = makeSession({
  id: "notes",
  title: "Design review notes",
  cwd: "/Users/demo/Notes",
  status: "idle",
});
event(notes, { type: "user_message", text: "Summarize the design review and list the open questions." });
event(notes, { type: "assistant_delta", text: "Three themes: navigation density, the empty-state story, and how approval risk is communicated." });
event(notes, { type: "usage", used: 1830, size: 1048576 });
sessions.set(notes.id, notes);

function summary(session) {
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    status: session.status,
    runtime: session.runtime,
    model: session.model,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function allSummaries() {
  return [...sessions.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summary);
}

const wss = new WebSocketServer({ port: PORT, path: "/ws" });
console.log(`mock agentd on ws://127.0.0.1:${PORT}/ws token=${TOKEN}`);

wss.on("connection", (ws) => {
  let authed = false;
  let subscribed = null;

  const send = (payload) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "hello") {
      if (message.token !== TOKEN) {
        send({ type: "error", message: "Invalid token" });
        return;
      }
      authed = true;
      send({
        type: "hello_ok",
        host: { name: "studio-mac", version: "0.1.0", platform: "darwin" },
        sessions: allSummaries(),
      });
      return;
    }

    if (!authed) return;

    switch (message.type) {
      case "list_sessions":
        send({ type: "sessions", sessions: allSummaries() });
        break;

      case "subscribe": {
        const session = sessions.get(message.sessionId);
        if (!session) {
          send({ type: "error", message: "Unknown session" });
          break;
        }
        subscribed = session.id;
        send({
          type: "snapshot",
          session: summary(session),
          events: session.events,
          approvals: session.pendingApprovals,
          configOptions: session.configOptions,
        });
        break;
      }

      case "create_session": {
        const id = `session-${Math.random().toString(36).slice(2, 8)}`;
        const session = makeSession({
          id,
          title: "New session",
          cwd: message.cwd || "/Users/demo/Projects/atlas",
        });
        sessions.set(id, session);
        subscribed = id;
        send({ type: "session", session: summary(session) });
        send({ type: "sessions", sessions: allSummaries() });
        send({
          type: "snapshot",
          session: summary(session),
          events: [],
          approvals: [],
          configOptions: session.configOptions,
        });
        break;
      }

      case "prompt": {
        const session = sessions.get(message.sessionId);
        if (!session) break;
        session.status = "running";
        const userEvent = event(session, { type: "user_message", text: message.text });
        send({ type: "event", sessionId: session.id, event: userEvent });
        send({ type: "session", session: summary(session) });
        const assistantEvent = event(session, {
          type: "assistant_delta",
          text: "Working on it. I’ll inspect the workspace, make the change, and report back with the result.",
        });
        setTimeout(() => {
          send({ type: "event", sessionId: session.id, event: assistantEvent });
          const end = event(session, { type: "turn_end", stopReason: "end_turn" });
          session.status = "idle";
          send({ type: "event", sessionId: session.id, event: end });
          send({ type: "session", session: summary(session) });
          send({ type: "sessions", sessions: allSummaries() });
        }, 900);
        break;
      }

      case "approve": {
        const session = [...sessions.values()].find((candidate) =>
          candidate.pendingApprovals.some((item) => item.id === message.approvalId)
        );
        if (!session) {
          send({ type: "error", message: "Approval is no longer pending" });
          break;
        }
        session.pendingApprovals = [];
        session.status = "running";
        send({
          type: "approval_resolved",
          approvalId: message.approvalId,
          sessionId: session.id,
          optionId: message.optionId,
          decision: message.optionId,
        });
        const tool = event(session, {
          type: "tool_update",
          toolCallId: "exec-3",
          status: "completed",
          output: "build: ok\nshared/auth.js updated\ntests: 42 passed",
        });
        send({ type: "event", sessionId: session.id, event: tool });
        const done = event(session, {
          type: "assistant_delta",
          text: "Done. The middleware now rejects expired sessions, the shared package is updated, and all 42 tests pass.",
        });
        send({ type: "event", sessionId: session.id, event: done });
        const end = event(session, { type: "turn_end", stopReason: "end_turn" });
        session.status = "idle";
        send({ type: "event", sessionId: session.id, event: end });
        send({ type: "session", session: summary(session) });
        send({ type: "sessions", sessions: allSummaries() });
        break;
      }

      case "set_model": {
        const session = sessions.get(message.sessionId);
        if (!session) break;
        session.configOptions = configOptions(message.value);
        session.model = String(message.value).includes("pro") ? "DeepSeek-V4-Pro" : "DeepSeek-V4.1-Flash";
        send({
          type: "models",
          sessionId: session.id,
          configOptions: session.configOptions,
          model: session.model,
        });
        break;
      }

      case "cancel": {
        const session = sessions.get(message.sessionId);
        if (!session) break;
        session.status = "idle";
        const notice = event(session, { type: "notice", text: "Cancelled" });
        send({ type: "event", sessionId: session.id, event: notice });
        send({ type: "session", session: summary(session) });
        break;
      }

      case "close_session": {
        sessions.delete(message.sessionId);
        send({ type: "session_removed", sessionId: message.sessionId });
        send({ type: "sessions", sessions: allSummaries() });
        break;
      }

      case "ping":
        send({ type: "pong", at: Date.now() });
        break;

      default:
        break;
    }
  });

  setTimeout(() => {
    if (subscribed === null && authed) {
      // no-op; the client chooses a session
    }
  }, 100);
});
