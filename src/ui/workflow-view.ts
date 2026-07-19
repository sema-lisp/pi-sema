import type { AgentState, RunState, RunStatus } from "../workflows/model.js";
import { formatMs, statusGlyph } from "./format.js";
import { sanitizeDisplayText } from "./text.js";

export interface WorkflowAgentDetails {
  agentId: string;
  name: string;
  model?: string;
  status: AgentState["status"];
  durMs?: number;
  phaseName?: string;
  toolCalls: { tool: string; ts: string }[];
}

export interface WorkflowRunDetails {
  runId?: string;
  workflow?: string;
  status: RunStatus;
  reason?: string;
  phases: RunState["phases"];
  agents: WorkflowAgentDetails[];
  checkpointCount: number;
  budget: RunState["budget"];
  authRequired: RunState["authRequired"];
  durMs?: number;
}

export interface WorkflowToolDetails {
  isError?: boolean;
  runId?: string;
  run?: WorkflowRunDetails;
  exitCode?: number | null;
}

const RUN_MARK: Record<RunStatus, string> = {
  live: "▶",
  success: "✓",
  "needs-auth": "🔑",
  failed: "✗",
};

const AGENT_MARK: Record<AgentState["status"], string> = {
  running: "◐",
  ok: "●",
  failed: "✗",
};

/** Copy mutable RunState into tool-result-safe JSON data. */
export function toWorkflowRunDetails(state: RunState): WorkflowRunDetails {
  return {
    runId: state.runId,
    workflow: state.workflow,
    status: state.status,
    reason: state.reason,
    phases: state.phases.map((phase) => ({ ...phase })),
    agents: [...state.agents.values()].map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      model: agent.model,
      status: agent.status,
      durMs: agent.durMs,
      phaseName: agent.phaseName,
      toolCalls: agent.toolCalls.map((call) => ({ ...call })),
    })),
    checkpointCount: state.checkpoints.length,
    budget: { ...state.budget },
    authRequired: state.authRequired.map((auth) => ({ ...auth })),
    durMs: state.durMs,
  };
}

export function focusedWorkflowPhase(details: WorkflowRunDetails) {
  return (
    details.phases.find((phase) => phase.status === "running") ??
    (details.status === "live"
      ? details.phases.find((phase) => phase.status === "pending")
      : details.phases.findLast(
          (phase) => phase.status === "success" || phase.status === "failed",
        ))
  );
}

export function formatWorkflowDetailsSummary(
  details: WorkflowRunDetails,
): string {
  const name = sanitizeDisplayText(
    details.workflow ?? details.runId ?? "workflow",
  );
  const focused = focusedWorkflowPhase(details);
  const done = details.phases.filter(
    (phase) => phase.status === "success" || phase.status === "failed",
  ).length;
  const phase = focused
    ? ` · ${sanitizeDisplayText(focused.name)} (${done}/${details.phases.length})`
    : details.phases.length > 0
      ? ` · pending (${done}/${details.phases.length})`
      : "";
  const runningAgents = details.agents.filter(
    (agent) => agent.status === "running",
  ).length;
  const agents =
    details.agents.length > 0
      ? ` · ${runningAgents > 0 ? `${runningAgents} live/` : ""}${details.agents.length} agents`
      : "";
  const budget = formatDetailsBudget(details);
  return `${RUN_MARK[details.status]} ${name}${phase}${agents}${budget ? ` · ${budget}` : ""}`;
}

export function formatWorkflowDetailsRows(
  details: WorkflowRunDetails,
  opts: { expanded?: boolean; maxAgents?: number } = {},
): string[] {
  const rows = [formatWorkflowDetailsSummary(details)];
  const focused = focusedWorkflowPhase(details);
  const phases = opts.expanded ? details.phases : focused ? [focused] : [];

  for (const phase of phases) {
    const dur = phase.durMs == null ? "" : ` (${formatMs(phase.durMs)})`;
    rows.push(
      `  ${statusGlyph(phase.status)} ${sanitizeDisplayText(phase.name)}${dur}`,
    );
    if (phase === focused) {
      const agents = details.agents.filter(
        (agent) => agent.phaseName === phase.name,
      );
      const shown = agents.slice(-(opts.maxAgents ?? 3));
      for (const agent of shown) {
        const lastTool = agent.toolCalls.at(-1)?.tool;
        const tool =
          agent.status === "running" && lastTool
            ? ` → ${sanitizeDisplayText(lastTool)}`
            : "";
        rows.push(
          `      ${AGENT_MARK[agent.status]} ${sanitizeDisplayText(agent.agentId)}${tool}`,
        );
      }
      if (opts.expanded && agents.length > shown.length) {
        rows.push(`      … ${agents.length - shown.length} earlier agents`);
      }
    }
  }

  if (details.status === "needs-auth") {
    const server = sanitizeDisplayText(details.authRequired[0]?.server);
    rows.push(
      `  🔑 auth required${server ? `: sema mcp login ${server}` : ""}`,
    );
  } else if (details.status === "failed" && details.reason) {
    rows.push(`  ✗ ${sanitizeDisplayText(details.reason)}`);
  }
  return rows;
}

function formatDetailsBudget(details: WorkflowRunDetails): string {
  const { inputTokens, outputTokens, costUsd, limit } = details.budget;
  if (inputTokens === 0 && outputTokens === 0) return "";
  const cost =
    costUsd == null
      ? ""
      : ` · $${costUsd.toFixed(2)}${limit == null ? "" : `/${limit}`}`;
  return `${compact(inputTokens)}→${compact(outputTokens)} tok${cost}`;
}

function compact(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
