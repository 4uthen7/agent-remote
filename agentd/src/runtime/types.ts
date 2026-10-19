import type { EventEmitter } from "node:events";
import type {
  AgentEvent,
  Approval,
  ConfigOption,
  SessionRecord,
  SessionSummary,
} from "../types.js";

export interface RuntimeSnapshot {
  session: SessionSummary;
  events: AgentEvent[];
  approvals: Approval[];
  configOptions: ConfigOption[];
}

export type RuntimeAdapter = EventEmitter & {
  start(): Promise<void>;
  dispose(): Promise<void>;
  listSessions(): SessionSummary[];
  getSession(sessionId: string): SessionRecord | undefined;
  snapshot(sessionId: string): RuntimeSnapshot | undefined;
  newSession(cwd: string): Promise<SessionSummary>;
  resumeSession(sessionId: string, cwd: string): Promise<SessionSummary>;
  prompt(sessionId: string, text: string): Promise<void>;
  cancel(sessionId: string): void;
  setModel(sessionId: string, value: string): Promise<ConfigOption[]>;
  closeSession(sessionId: string): Promise<void>;
  resolveApproval(approvalId: string, optionId: string): boolean;
};
