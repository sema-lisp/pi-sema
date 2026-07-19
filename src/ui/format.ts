import type { RunState } from "../workflows/model.js";
import { sanitizeDisplayText } from "./text.js";

/** Status → symbol maps, one per status vocabulary (phase, run, agent). */
const PHASE_GLYPH = {
  pending: "○",
  running: "◐",
  success: "●",
  failed: "✗",
} as const;

const RUN_MARK = {
  live: "▶",
  success: "✓",
  "needs-auth": "🔑",
  failed: "✗",
} as const;

const AGENT_MARK = {
  running: "◐",
  ok: "●",
  failed: "✗",
} as const;

export function statusGlyph(status: keyof typeof PHASE_GLYPH): string {
  return PHASE_GLYPH[status];
}

export function formatBudget(state: RunState): string {
  const { inputTokens, outputTokens, costUsd, limit } = state.budget;
  if (inputTokens === 0 && outputTokens === 0) return "";
  const tokens = `${compact(inputTokens)}→${compact(outputTokens)} tok`;
  const cost =
    costUsd != null
      ? ` · $${costUsd.toFixed(2)}${limit ? `/${limit}` : ""}`
      : "";
  return `${tokens}${cost}`;
}

/** One-line summary for the always-visible widget / status bar. */
export function formatRunSummary(state: RunState): string {
  const name = sanitizeDisplayText(state.workflow ?? state.runId ?? "workflow");
  const running = state.phases.find((p) => p.status === "running");
  const focused =
    running ??
    (state.status === "live"
      ? state.phases.find((p) => p.status === "pending")
      : state.phases.findLast(
          (p) => p.status === "success" || p.status === "failed",
        ));
  const done = state.phases.filter(
    (p) => p.status === "success" || p.status === "failed",
  ).length;
  const phasePart =
    state.phases.length > 0
      ? ` · ${focused ? sanitizeDisplayText(focused.name) : "pending"} (${done}/${state.phases.length})`
      : "";
  const agents = [...state.agents.values()];
  const liveAgents = agents.filter((a) => a.status === "running").length;
  const agentPart =
    agents.length > 0
      ? ` · ${liveAgents > 0 ? `${liveAgents} live/` : ""}${agents.length} agents`
      : "";
  const budget = formatBudget(state);
  return `${RUN_MARK[state.status]} ${name}${phasePart}${agentPart}${budget ? ` · ${budget}` : ""}`;
}

/** Multi-line render for the widget and the inline streaming tool result. */
export function formatRunLines(
  state: RunState,
  opts: { maxAgents?: number } = {},
): string[] {
  const lines: string[] = [formatRunSummary(state)];

  for (const phase of state.phases) {
    const dur = phase.durMs != null ? ` (${formatMs(phase.durMs)})` : "";
    lines.push(
      `  ${statusGlyph(phase.status)} ${sanitizeDisplayText(phase.name)}${dur}`,
    );
    if (phase.status === "running") {
      const agents = [...state.agents.values()].filter(
        (a) => a.phaseName === phase.name,
      );
      const shown = agents.slice(-(opts.maxAgents ?? 6));
      for (const agent of shown) {
        const mark = AGENT_MARK[agent.status];
        const lastTool = agent.toolCalls.at(-1);
        const tool =
          agent.status === "running" && lastTool ? ` → ${lastTool.tool}` : "";
        lines.push(
          `      ${mark} ${sanitizeDisplayText(agent.agentId)}${tool ? ` → ${sanitizeDisplayText(lastTool?.tool)}` : ""}`,
        );
      }
      if (agents.length > shown.length) {
        lines.push(`      … ${agents.length - shown.length} more`);
      }
    }
  }

  if (state.status === "needs-auth") {
    lines.push(
      `  🔑 auth required${state.authRequired[0]?.server ? `: sema mcp login ${sanitizeDisplayText(state.authRequired[0].server)}` : ""}`,
    );
  }
  if (state.status === "failed" && state.reason) {
    lines.push(`  ✗ ${sanitizeDisplayText(state.reason)}`);
  }
  return lines;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
