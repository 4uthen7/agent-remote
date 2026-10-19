import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const phase = process.argv[2];
const url = process.env.AGENT_REMOTE_URL || "ws://127.0.0.1:8792/ws";
const token = fs.readFileSync(path.join(os.homedir(), ".agent-remote/token"), "utf8").trim();
const cwd = "/tmp/agent-remote-smoke-cwd";
const ws = new WebSocket(url);
const queue = [];
const waiters = [];

function send(message) { ws.send(JSON.stringify(message)); }
function waitFor(predicate, label, timeout = 90000) {
  for (let i = 0; i < queue.length; i += 1) {
    if (predicate(queue[i])) return Promise.resolve(queue.splice(i, 1)[0]);
  }
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject };
    waiters.push(waiter);
    waiter.timer = setTimeout(() => {
      waiters.splice(waiters.indexOf(waiter), 1);
      reject(new Error(`timeout ${label}`));
    }, timeout);
  });
}
ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  for (let i = 0; i < waiters.length; i += 1) {
    if (waiters[i].predicate(message)) {
      const waiter = waiters.splice(i, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
  }
  queue.push(message);
});
await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
send({ type: "hello", token, deviceName: "archive-test" });
const hello = await waitFor((m) => m.type === "hello_ok", "hello");
console.log("HELLO", hello.host?.version, hello.sessions?.length);

if (phase === "create") {
  send({ type: "create_session", cwd, runtime: "codex" });
  const created = await waitFor((m) => m.type === "session", "create");
  console.log("SESSION", created.session.id, created.session.runtime);
  send({ type: "prompt", sessionId: created.session.id, text: "Reply ARCHIVE-OK only." });
  const finished = await waitFor(
    (m) => m.type === "event" && m.event?.type === "turn_end" && m.sessionId === created.session.id,
    "turn_end",
  );
  console.log("TURN", finished.event.stopReason);
  send({ type: "close_session", sessionId: created.session.id });
  await new Promise((resolve) => setTimeout(resolve, 600));
  send({ type: "list_sessions" });
  const list = await waitFor(
    (m) => m.type === "sessions" && m.sessions.some((s) => s.id === created.session.id && s.archived),
    "archived session list",
  );
  const saved = list.sessions.find((s) => s.id === created.session.id);
  console.log("ARCHIVED", Boolean(saved?.archived), saved?.resumable, saved?.title);
  if (!saved?.archived) throw new Error("session was not archived");
  ws.close();
} else {
  send({ type: "list_sessions" });
  const list = await waitFor((m) => m.type === "sessions", "sessions after restart");
  const saved = list.sessions.find((s) => s.archived && s.runtime === "codex");
  if (!saved) throw new Error("no archived codex session after restart");
  console.log("FOUND", saved.id, saved.title, "events", saved.lastMessage);
  send({ type: "subscribe", sessionId: saved.id });
  const snapshot = await waitFor((m) => m.type === "snapshot", "archived snapshot");
  console.log("SNAPSHOT", snapshot.session.archived, snapshot.events.length);
  if (!snapshot.events.length) throw new Error("archived snapshot had no events");
  send({ type: "resume_session", sessionId: saved.id, cwd: saved.cwd, runtime: saved.runtime });
  const resumed = await waitFor((m) => m.type === "session", "resume");
  console.log("RESUMED", resumed.session.id, resumed.session.status);
  const snapshot2 = await waitFor((m) => m.type === "snapshot", "resumed snapshot");
  console.log("RESUMED_EVENTS", snapshot2.events.length);
  if (snapshot2.events.length < snapshot.events.length) throw new Error("resume lost events");
  send({ type: "prompt", sessionId: resumed.session.id, text: "Reply RESUME-OK only." });
  await waitFor(
    (m) => m.type === "event" && m.event?.type === "turn_end" && m.sessionId === resumed.session.id,
    "resumed turn",
  );
  console.log("RESUMED_TURN_OK");
  ws.close();
}
