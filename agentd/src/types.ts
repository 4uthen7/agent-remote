export type SessionStatus = "idle" | "running" | "awaiting_approval" | "error";
export type RuntimeId = "dsh" | "codex" | "claude";

export interface HostInfo {
  name: string;
  version: string;
  platform: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  status: SessionStatus;
  runtime: RuntimeId;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export type AgentEventType =
  | "user_message"
  | "assistant_delta"
  | "thought_delta"
  | "tool_call"
  | "tool_update"
  | "usage"
  | "turn_end"
  | "notice"
  | "error";

export interface AgentEvent {
  seq: number;
  type: AgentEventType;
  text?: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  command?: string;
  cwd?: string;
  status?: string;
  output?: string;
  used?: number;
  size?: number;
  stopReason?: string;
  message?: string;
}

export interface ApprovalOption {
  optionId: string;
  name: string;
  kind?: string;
}

export interface Approval {
  id: string;
  sessionId: string;
  toolCallId?: string;
  title: string;
  command?: string;
  cwd?: string;
  justification?: string;
  sandbox?: string;
  kind?: string;
  options: ApprovalOption[];
  createdAt: number;
}

export interface ConfigOptionValue {
  value: string;
  name: string;
  description?: string;
}

export interface ConfigOptionGroup {
  group: string;
  name?: string;
  options: ConfigOptionValue[];
}

export type ConfigOptionEntry = ConfigOptionValue | ConfigOptionGroup;

export interface ConfigOption {
  id: string;
  name: string;
  category?: string;
  type: string;
  currentValue?: string;
  options?: ConfigOptionEntry[];
}

export interface SessionRecord extends SessionSummary {
  events: AgentEvent[];
  seq: number;
  configOptions: ConfigOption[];
  pendingApprovals: Approval[];
}

export function isConfigGroup(entry: ConfigOptionEntry): entry is ConfigOptionGroup {
  return "group" in entry && Array.isArray((entry as ConfigOptionGroup).options);
}

export function modelDisplayValue(option: ConfigOption | undefined): string | undefined {
  if (!option?.currentValue) return undefined;
  const seen = new Set<string>();
  const walk = (entries: ConfigOptionEntry[] | undefined): string | undefined => {
    for (const entry of entries ?? []) {
      if (isConfigGroup(entry)) {
        const found = walk(entry.options);
        if (found) return found;
      } else if (entry.value === option.currentValue) {
        return entry.name;
      } else if (!seen.has(entry.value)) {
        seen.add(entry.value);
      }
    }
    return undefined;
  };
  return walk(option.options) ?? option.currentValue;
}
