import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const url = process.env.AGENT_REMOTE_URL || "ws://127.0.0.1:8787/ws";
const token = process.env.AGENT_REMOTE_TOKEN || fs.readFileSync(path.join(process.env.AGENT_REMOTE_HOME || path.join(os.homedir(), ".agent-remote"), "token"), "utf8").trim();
const cwd = process.env.AGENT_REMOTE_CWD || process.cwd();

const ws = new WebSocket(url);
const queue = [];
const waiters = [];

function send(message) {
  ws.send(JSON.stringify(message));
}

function waitFor(predicate, label, timeoutMs = 120000) {
  for (let i = 0; i < queue.length; i += 1) {
    if (predicate(queue[i])) return Promise.resolve(queue.splice(i, 1)[0]);
  }
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject, label };
    waiters.push(waiter);
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error(`timeout waiting for ${label}`));
    }, timeoutMs);
    waiter.timer = timer;
  });
}

ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  console.log("<<", message.type, message.event?.type ?? message.session?.status ?? message.model ?? message.message ?? "");
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

ws.on("error", (error) => console.error("WS ERROR", error.message));

await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});

send({ type: "hello", token, deviceName: "smoke-test" });
const hello = await waitFor((m) => m.type === "hello_ok", "hello_ok");
console.log("HOST", hello.host);

send({ type: "create_session", cwd });
const sessionMessage = await waitFor((m) => m.type === "session" || m.type === "error", "session", 60000);
if (sessionMessage.type === "error") throw new Error(sessionMessage.message);
const session = sessionMessage.session;
console.log("SESSION", session.id, session.model);
await waitFor((m) => m.type === "snapshot", "snapshot", 60000);

send({ type: "prompt", sessionId: session.id, text: "Reply with exactly AGENT-OK. Do not use tools." });
await waitFor((m) => m.type === "event" && m.sessionId === session.id && m.event.type === "turn_end", "first turn_end", 180000);
console.log("FIRST TURN OK");

send({ type: "set_model", sessionId: session.id, value: '["deepseek-account","deepseek-v4-pro"]' });
const models = await waitFor((m) => m.type === "models", "models", 30000);
console.log("MODEL", models.configOptions?.find((o) => o.id === "model")?.currentValue);

const testFile = path.join(os.tmpdir(), `agent-remote-approval-${Date.now()}.txt`);
try { fs.unlinkSync(testFile); } catch {}
send({
  type: "prompt",
  sessionId: session.id,
  text: `Use the shell tool to run exactly: echo agent-remote > ${testFile} . Then confirm.`,
});
const approval = await waitFor((m) => m.type === "approval", "approval", 180000);
console.log("APPROVAL", JSON.stringify(approval.approval, null, 2));
send({ type: "approve", approvalId: approval.approval.id, optionId: "allow-once" });
await waitFor((m) => m.type === "approval_resolved", "approval_resolved", 30000);
await waitFor((m) => m.type === "event" && m.sessionId === session.id && m.event.type === "turn_end", "second turn_end", 180000);
console.log("FILE", fs.existsSync(testFile) ? fs.readFileSync(testFile, "utf8").trim() : "MISSING");

send({ type: "close_session", sessionId: session.id });
await new Promise((resolve) => setTimeout(resolve, 500));
ws.close();
