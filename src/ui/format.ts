import type { RunState } from "../workflows/model.js";

const GLYPH = {
  pending: "○",
  running: "◐",
  success: "●",
  failed: "✗",
} as const;

export function statusGlyph(status: keyof typeof GLYPH): string {
  return GLYPH[status] ?? "?";
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
  const name = state.workflow ?? state.runId ?? "workflow";
  const running = state.phases.find((p) => p.status === "running");
  const done = state.phases.filter(
    (p) => p.status === "success" || p.status === "failed",
  ).length;
  const phasePart =
    state.phases.length > 0
      ? ` · ${running ? running.name : "…"} (${done}/${state.phases.length})`
      : "";
  const agents = [...state.agents.values()];
  const liveAgents = agents.filter((a) => a.status === "running").length;
  const agentPart =
    agents.length > 0
      ? ` · ${liveAgents > 0 ? `${liveAgents} live/` : ""}${agents.length} agents`
      : "";
  const budget = formatBudget(state);
  const statusMark =
    state.status === "live"
      ? "▶"
      : state.status === "success"
        ? "✓"
        : state.status === "needs-auth"
          ? "🔑"
          : "✗";
  return `${statusMark} ${name}${phasePart}${agentPart}${budget ? ` · ${budget}` : ""}`;
}

/** Multi-line render for the widget and the inline streaming tool result. */
export function formatRunLines(
  state: RunState,
  opts: { maxAgents?: number } = {},
): string[] {
  const lines: string[] = [formatRunSummary(state)];

  for (const phase of state.phases) {
    const dur = phase.durMs != null ? ` (${formatMs(phase.durMs)})` : "";
    lines.push(`  ${statusGlyph(phase.status)} ${phase.name}${dur}`);
    if (phase.status === "running") {
      const agents = [...state.agents.values()].filter(
        (a) => a.phaseName === phase.name,
      );
      const shown = agents.slice(-(opts.maxAgents ?? 6));
      for (const agent of shown) {
        const mark =
          agent.status === "running" ? "◐" : agent.status === "ok" ? "●" : "✗";
        const lastTool = agent.toolCalls.at(-1);
        const tool =
          agent.status === "running" && lastTool ? ` → ${lastTool.tool}` : "";
        lines.push(`      ${mark} ${agent.agentId}${tool}`);
      }
      if (agents.length > shown.length) {
        lines.push(`      … ${agents.length - shown.length} more`);
      }
    }
  }

  if (state.status === "needs-auth") {
    lines.push(
      `  🔑 auth required${state.authRequired[0]?.server ? `: sema mcp login ${state.authRequired[0].server}` : ""}`,
    );
  }
  if (state.status === "failed" && state.reason) {
    lines.push(`  ✗ ${state.reason}`);
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
