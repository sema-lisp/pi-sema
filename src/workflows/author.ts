import { Type } from "typebox";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  AgentToolResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PiSemaRuntime } from "../index.js";
import { sanitizeName } from "../library/store.js";
import { workflowCheck, formatDiagnostics } from "./check.js";
import { SUBMIT_WORKFLOW_DESCRIPTION } from "../forge/prompts.js";

const params = Type.Object({
  name: Type.String({ description: "Workflow name, kebab-case" }),
  description: Type.String({ description: "One-line description" }),
  source: Type.String({
    description:
      "Complete Sema source containing exactly one (defworkflow …) form",
  }),
  args: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Example args map the workflow expects (documentation only)",
    }),
  ),
  tier: Type.Optional(
    Type.Union([Type.Literal("project"), Type.Literal("global")], {
      description:
        "Storage tier; workflows default to project (they are usually project artifacts)",
    }),
  ),
});

type SubmitParams = {
  name: string;
  description: string;
  source: string;
  args?: Record<string, unknown>;
  tier?: "project" | "global";
};

export function extractDefworkflowName(source: string): string | null {
  const matches = [...source.matchAll(/\(defworkflow\s+([^\s()]+)/g)];
  if (matches.length !== 1) return null;
  return matches[0][1];
}

/** Human-readable shape preview: phases, fan-out widths, budget, loads. */
export function summarizeWorkflow(source: string): string[] {
  const lines: string[] = [];
  const phases = /:phases\s*\[([^\]]*)\]/.exec(source)?.[1];
  if (phases) {
    const names = [...phases.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    lines.push(`Phases: ${names.join(" → ")}`);
  }
  const budget = /:budget\s*(\{[^}]*\})/.exec(source)?.[1];
  lines.push(
    budget ? `Budget: ${budget}` : "Budget: NONE — unbounded LLM spend",
  );
  const fanouts = [...source.matchAll(/\(parallel\b[\s\S]*?(\d+)\s*\)/g)].map(
    (m) => m[1],
  );
  if (fanouts.length > 0)
    lines.push(
      `Parallel fan-out caps: ${fanouts.join(", ")} (engine max 8 by default)`,
    );
  const steps = [...source.matchAll(/\(step\s/g)].length;
  lines.push(`LLM step leaves: ${steps}`);
  const loads = [...source.matchAll(/\(load\s+"([^"]+)"/g)].map((m) => m[1]);
  if (loads.length > 0) lines.push(`Loads: ${loads.join(", ")}`);
  return lines;
}

/**
 * The testable core of /sema:workflow submission:
 * static check (gated on error count) → preview + confirm → store.
 * Deliberately does NOT run the workflow — sema_workflow_run does that,
 * keeping all live-status logic in one place.
 */
export async function submitWorkflow(
  runtime: PiSemaRuntime,
  ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">,
  p: SubmitParams,
  rounds: Map<string, number>,
  signal?: AbortSignal,
): Promise<AgentToolResult<{ isError?: boolean }>> {
  let name: string;
  try {
    name = sanitizeName(p.name);
  } catch (err) {
    return fail(String(err instanceof Error ? err.message : err));
  }
  const declared = extractDefworkflowName(p.source);
  if (!declared) {
    return fail("source must contain exactly one (defworkflow …) form");
  }

  // Static validation — no LLM, no eval. Gate on error-level diagnostics only:
  // under --strict, warnings alone already flip the exit code.
  const scratch = join(
    mkdtempSync(join(tmpdir(), "pi-sema-wf-check-")),
    `${name.replace(/\//g, "_")}.sema`,
  );
  writeFileSync(scratch, p.source);
  const check = await workflowCheck(scratch, { cwd: ctx.cwd, signal });
  if (!check.ok) {
    const round = (rounds.get(name) ?? 0) + 1;
    rounds.set(name, round);
    const maxRounds = runtime.cfg.forge.maxRounds;
    if (round >= maxRounds) {
      rounds.delete(name);
      return fail(
        `status: gave_up after ${round} rounds.\n${formatDiagnostics(check.errors)}\nStop retrying; report the failure to the user.`,
      );
    }
    return fail(
      `status: check_failed (round ${round}/${maxRounds})\n${formatDiagnostics(check.errors)}\nFix the source and call submit_sema_workflow again.`,
    );
  }

  // Preview + the human gate.
  const summary = summarizeWorkflow(p.source);
  const warningText =
    check.warnings.length > 0
      ? `\nWarnings:\n${formatDiagnostics(check.warnings)}`
      : "";
  let approved = true;
  let runNow = false;
  if (ctx.hasUI) {
    approved = await ctx.ui.confirm(
      `Store Sema workflow "${name}"?`,
      `${p.description}\n\n${summary.join("\n")}${warningText}\n\n${truncate(p.source.trim(), 3000)}`,
    );
    if (!approved) {
      rounds.delete(name);
      return fail(
        "status: declined — the user rejected this workflow. Ask what to change; do not resubmit unchanged.",
      );
    }
    runNow = await ctx.ui.confirm(
      `Run "${name}" now?`,
      "Runs with live status. LLM steps spend real tokens (capped by the workflow's :budget).",
    );
  }

  const tier = p.tier ?? "project";
  const path = runtime.store.save(
    tier,
    "workflows",
    name,
    `; ${p.description}\n${p.source.trim()}`,
  );
  rounds.delete(name);

  const argsHint =
    p.args && Object.keys(p.args).length > 0
      ? ` args=${JSON.stringify(p.args)}`
      : "";
  return {
    content: [
      {
        type: "text",
        text: `status: stored\nPath: ${path} (${tier} tier)${warningText}\n${
          runNow
            ? `The user approved running it — call sema_workflow_run with workflow="${name}"${argsHint} now.`
            : `Not run. The user can run it later via sema_workflow_run or /sema:workflows.`
        }`,
      },
    ],
    details: {},
  };
}

export function registerWorkflowAuthoring(
  pi: ExtensionAPI,
  getRuntime: () => PiSemaRuntime | null,
): void {
  const rounds = new Map<string, number>();
  pi.registerTool({
    name: "submit_sema_workflow",
    label: "Submit Sema workflow",
    description: SUBMIT_WORKFLOW_DESCRIPTION,
    promptSnippet:
      "Validate + store an authored Sema workflow (checked, user-approved; run separately)",
    parameters: params,
    async execute(_id, p, signal, _onUpdate, ctx) {
      const runtime = getRuntime();
      if (!runtime) return fail("pi-sema is not initialized");
      return submitWorkflow(runtime, ctx, p as SubmitParams, rounds, signal);
    },
  });
}

function fail(text: string): AgentToolResult<{ isError?: boolean }> {
  return { content: [{ type: "text", text }], details: { isError: true } };
}

function truncate(text: string, max: number): string {
  return text.length <= max
    ? text
    : text.slice(0, max) + `\n… (${text.length - max} more chars)`;
}
