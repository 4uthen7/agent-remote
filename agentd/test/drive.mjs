import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const token = process.env.AGENT_REMOTE_TOKEN || fs.readFileSync(path.join(process.env.AGENT_REMOTE_HOME || path.join(os.homedir(), ".agent-remote"), "token"), "utf8").trim();
const [sessionId, text] = process.argv.slice(2);
const ws = new WebSocket(process.env.AGENT_REMOTE_URL || "ws://127.0.0.1:8787/ws");

ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token, deviceName: "driver" })));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "hello_ok") {
    console.log("connected");
    ws.send(JSON.stringify({ type: "prompt", sessionId, text }));
  } else if (m.type === "approval") {
    console.log("APPROVAL PENDING", JSON.stringify(m.approval, null, 2));
  } else if (m.type === "event") {
    console.log("event", m.event.type, (m.event.text ?? m.event.command ?? m.event.message ?? "").slice(0, 200));
  } else if (m.type === "error") {
    console.log("error", m.message);
  }
});
setTimeout(() => { console.log("done waiting"); ws.close(); }, 120000);
