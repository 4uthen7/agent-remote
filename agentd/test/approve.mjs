import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
const token = process.env.AGENT_REMOTE_TOKEN || fs.readFileSync(path.join(process.env.AGENT_REMOTE_HOME || path.join(os.homedir(), ".agent-remote"), "token"), "utf8").trim();
const [approvalId, optionId = "allow-once"] = process.argv.slice(2);
const ws = new WebSocket("ws://127.0.0.1:8787/ws");
ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token, deviceName: "approver" })));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "hello_ok") {
    ws.send(JSON.stringify({ type: "approve", approvalId, optionId }));
  } else if (m.type === "approval_resolved") {
    console.log("RESOLVED", JSON.stringify(m));
    ws.close();
  } else if (m.type === "error") {
    console.log("ERROR", m.message);
  }
});
setTimeout(() => ws.close(), 15000);
