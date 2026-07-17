/**
 * Pure fold over the frozen journal event vocabulary (sema-workflow event.rs).
 * Note the discriminator field is `event`, not `type`:
 *   {"event":"run.started","seq":0,"ts":"…","workflow":"…","run_id":"…","phases":[…]}
 */
export interface JournalEvent {
  event: string;
  seq: number;
  ts: string;
  [k: string]: unknown;
}

export type RunStatus = "live" | "success" | "failed" | "needs-auth";

export interface PhaseState {
  name: string;
  /** seq of phase.started; undefined while still pending (declared only). */
  seq?: number;
  status: "pending" | "running" | "success" | "failed";
  durMs?: number;
}

export interface AgentState {
  agentId: string;
  name: string;
  model?: string;
  status: "running" | "ok" | "failed";
  output?: string;
  durMs?: number;
  /** Open phase at the time the agent started (agent events carry no phase_seq). */
  phaseName?: string;
  toolCalls: { tool: string; ts: string }[];
}

export interface RunState {
  runId?: string;
  workflow?: string;
  status: RunStatus;
  reason?: string;
  phases: PhaseState[];
  agents: Map<string, AgentState>;
  checkpoints: { key: string; value?: string }[];
  budget: {
    inputTokens: number;
    outputTokens: number;
    /** null until a priced event arrives (cost_usd is absent for unpriced models). */
    costUsd: number | null;
    limit?: number;
  };
  authRequired: { server?: string; detail?: string }[];
  startedTs?: string;
  endedTs?: string;
  durMs?: number;
  lastSeq: number;
}

export function newRunState(): RunState {
  return {
    status: "live",
    phases: [],
    agents: new Map(),
    checkpoints: [],
    budget: { inputTokens: 0, outputTokens: 0, costUsd: null },
    authRequired: [],
    lastSeq: -1,
  };
}

export function reduceRun(state: RunState, ev: JournalEvent): RunState {
  state.lastSeq = ev.seq;
  switch (ev.event) {
    case "run.started": {
      state.runId = str(ev.run_id) ?? state.runId;
      state.workflow = str(ev.workflow) ?? state.workflow;
      state.startedTs ??= ev.ts;
      state.status = "live"; // a resume segment reopens the run
      // phases[] is serde-skipped when the workflow declares none — degrade to lazy discovery.
      if (Array.isArray(ev.phases)) {
        for (const name of ev.phases as string[]) {
          if (!state.phases.some((p) => p.name === name)) {
            state.phases.push({ name, status: "pending" });
          }
        }
      }
      break;
    }
    case "phase.started": {
      const name = str(ev.phase) ?? "?";
      const phase = state.phases.find((p) => p.name === name);
      if (phase) {
        phase.status = "running";
        phase.seq = ev.seq;
      } else {
        state.phases.push({ name, status: "running", seq: ev.seq });
      }
      break;
    }
    case "phase.ended": {
      const name = str(ev.phase) ?? "?";
      const phase = state.phases.find((p) => p.name === name);
      if (phase) {
        phase.status = ev.status === "success" ? "success" : "failed";
        phase.durMs = num(ev.dur_ms);
      }
      break;
    }
    case "agent.started": {
      const agentId = str(ev.agent_id) ?? `agent_${ev.seq}`;
      state.agents.set(agentId, {
        agentId,
        name: str(ev.agent_name) ?? agentId,
        model: str(ev.model),
        status: "running",
        phaseName: currentPhase(state)?.name,
        toolCalls: [],
      });
      break;
    }
    case "agent.result": {
      const agent = state.agents.get(str(ev.agent_id) ?? "");
      if (agent) {
        agent.status = ev.status === "ok" ? "ok" : "failed";
        agent.output = str(ev.output);
        agent.durMs = num(ev.dur_ms);
        agent.model = str(ev.model) ?? agent.model;
      }
      break;
    }
    case "agent.tool_call": {
      const agent = state.agents.get(str(ev.agent_id) ?? "");
      agent?.toolCalls.push({ tool: str(ev.tool_name) ?? "?", ts: ev.ts });
      break;
    }
    case "checkpoint": {
      state.checkpoints.push({ key: str(ev.key) ?? "?", value: str(ev.value) });
      break;
    }
    case "budget": {
      state.budget.inputTokens += num(ev.input_tokens) ?? 0;
      state.budget.outputTokens += num(ev.output_tokens) ?? 0;
      const cost = num(ev.cost_usd);
      if (cost != null) state.budget.costUsd = (state.budget.costUsd ?? 0) + cost;
      const limit = num(ev.budget_limit);
      if (limit != null) state.budget.limit = limit;
      break;
    }
    case "auth.required": {
      state.authRequired.push({ server: str(ev.server), detail: str(ev.reason) });
      break;
    }
    case "run.ended": {
      const status = str(ev.status);
      state.status = status === "success" ? "success" : status === "needs-auth" ? "needs-auth" : "failed";
      state.reason = str(ev.reason);
      state.endedTs = ev.ts;
      state.durMs = num(ev.dur_ms);
      break;
    }
    default:
      break; // frozen-but-append-only vocabulary: unknown events are skipped
  }
  return state;
}

export function foldEvents(events: JournalEvent[], state = newRunState()): RunState {
  for (const ev of events) reduceRun(state, ev);
  return state;
}

/** Most recently started phase still marked running, else last started. */
function currentPhase(state: RunState): PhaseState | undefined {
  const running = [...state.phases].reverse().find((p) => p.status === "running");
  return running ?? [...state.phases].reverse().find((p) => p.seq !== undefined);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
