import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "../src/session-store.js";
import type { SessionRecord } from "../src/types.js";

const dir = mkdtempSync(path.join(tmpdir(), "agent-remote-archive-"));
try {
  const record: SessionRecord = {
    id: "session-test",
    title: "Archive test",
    cwd: "/tmp/project",
    status: "idle",
    runtime: "codex",
    model: "test-model",
    createdAt: 1,
    updatedAt: 2,
    events: [
      { seq: 1, type: "user_message", text: "hello" },
      { seq: 2, type: "assistant_delta", text: "world" },
    ],
    seq: 2,
    configOptions: [],
    pendingApprovals: [],
  };
  const store = new SessionStore(dir, "test-host");
  store.save(record, false);
  store.archive(record);
  const reloaded = new SessionStore(dir, "test-host");
  const summary = reloaded.list().map((item) => reloaded.summary(item))[0];
  if (!summary?.archived || summary.resumable !== true) {
    throw new Error(`unexpected archive summary: ${JSON.stringify(summary)}`);
  }
  const snapshot = reloaded.snapshot(reloaded.get("session-test")!);
  if (snapshot.events.length !== 2) throw new Error("events were not restored");
  console.log("session store ok", summary.archived, snapshot.events.length);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
