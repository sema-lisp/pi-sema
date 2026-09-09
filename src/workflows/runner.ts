/**
 * Workflow execution — runs a stored workflow with live status.
 *
 * WHAT: registers `sema_workflow_run`, which shells out to `sema workflow run`
 * and streams progress. Companions: journal.ts (tail the run's event log),
 * model.ts (fold events → RunState), ../ui/format.ts (render), author.ts
 * (the separate authoring flow).
 *
 * HOW/WHY: the sema process is the source of truth; we observe it by tailing
 * its journal rather than parsing stdout, which is what makes runs resumable —
 * `resume=<run_id>` replays memoized steps for free. Authoring and running are
 * deliberately separate tools so all live-status logic lives here alone.
 */
import { Type } from "typebox";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  ExtensionAPI,
  AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import type { PiSemaRuntime } from "../index.js";
import { spawnSema } from "../sema.js";
import { readJsonFile } from "../util.js";
import { toolText, toolError } from "../tool-result.js";
import { JournalTailer } from "./journal.js";
import { newRunState, reduceRun, type RunState } from "./model.js";
import { formatRunLines, formatRunSummary } from "../ui/format.js";
import {
  toWorkflowRunDetails,
  type WorkflowToolDetails,
} from "../ui/workflow-view.js";
import {
  renderWorkflowCall,
  renderWorkflowResult,
} from "../ui/workflow-tool.js";
import { installWorkflowRunWidget } from "../ui/workflow-widget.js";
import { sanitizeDisplayText } from "../ui/text.js";

const params = Type.Object({
  workflow: Type.String({
    description: "Workflow name from the library, or a path to a .sema file",
  }),
  args: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Workflow args, passed as --args JSON",
    }),
  ),
  resume: Type.Optional(
    Type.String({
      description: "Run id to resume (memoized leaves replay for free)",
    }),
  ),
});

export interface RunOutcome {
  runId: string;
  runDir: string;
  state: RunState;
  exitCode: number | null;
  resultJson?: unknown;
}

export function defaultRunRoot(cwd: string, configured: string | null): string {
  return configured ? resolve(cwd, configured) : join(cwd, ".sema", "runs");
}

export function newRunId(): string {
  return `wfpi_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

/**
 * Run a workflow with live journal tailing. `onState` fires on every event
 * batch — the tool streams it via onUpdate AND the widget; the dashboard
 * attaches its own tailer instead.
 */
export async function runWorkflow(opts: {
  file: string;
  args: Record<string, unknown>;
  runRoot: string;
  runId?: string;
  resume?: string;
  cwd: string;
  signal?: AbortSignal;
  onState?: (state: RunState) => void;
}): Promise<RunOutcome> {
  const runId = opts.resume ?? opts.runId ?? newRunId();
  const runDir = join(opts.runRoot, runId);

  const state = newRunState();
  const tailer = new JournalTailer(runDir, { pollMs: 500 });
  tailer.on((events) => {
    for (const ev of events) reduceRun(state, ev);
    opts.onState?.(state);
  });
  tailer.start();

  try {
    const args = [
      "workflow",
      "run",
      opts.file,
      "--args",
      JSON.stringify(opts.args),
      "--run-dir",
      opts.runRoot,
      "--no-auth-prompt",
    ];
    if (opts.resume) args.push("--resume", opts.resume);
    const proc = await spawnSema(args, {
      cwd: opts.cwd,
      signal: opts.signal,
      env: { SEMA_WORKFLOW_RUN_ID: runId },
    });
    tailer.drain(); // pick up the final lines before stopping

    // No result.json (crash / kill) — journal state is the source of truth.
    const resultJson = readJsonFile(join(runDir, "result.json")) ?? undefined;
    if (proc.killed && state.status === "live") state.status = "failed";
    return { runId, runDir, state, exitCode: proc.code, resultJson };
  } finally {
    tailer.stop();
  }
}

export function registerWorkflowRunTool(
  pi: ExtensionAPI,
  getRuntime: () => PiSemaRuntime | null,
): void {
  pi.registerTool({
    name: "sema_workflow_run",
    label: "Run Sema workflow",
    description:
      "Run a Sema workflow from the library (or a .sema file path) with live status. Journaled and resumable: pass resume=<run_id> to replay memoized steps for free after a failure. Workflows may spend real LLM tokens — their :budget meta caps spend. Exit status needs-auth means the user must run the printed `sema mcp login` command first.",
    promptSnippet:
      "Run a stored Sema workflow (journaled, resumable, live status)",
    parameters: params,
    renderCall: renderWorkflowCall,
    renderResult: renderWorkflowResult,
    async execute(
      id,
      p,
      signal,
      onUpdate,
      ctx,
    ): Promise<AgentToolResult<WorkflowToolDetails>> {
      const runtime = getRuntime();
      if (!runtime) {
        return toolError<WorkflowToolDetails>("pi-sema is not initialized");
      }
      const entry = runtime.store.resolve("workflows", p.workflow);
      if (!entry) {
        const known = runtime.store.list("workflows").map((e) => e.name);
        return toolError<WorkflowToolDetails>(
          `unknown workflow "${p.workflow}". Known: ${known.join(", ") || "(none)"}`,
        );
      }

      const runRoot = defaultRunRoot(ctx.cwd, runtime.cfg.workflows.runDir);
      const widget = installWorkflowRunWidget(ctx, `sema-run-${id}`);
      try {
        const outcome = await runWorkflow({
          file: entry.path,
          args: p.args ?? {},
          runRoot,
          resume: p.resume,
          cwd: ctx.cwd,
          signal,
          onState: (state) => {
            const run = toWorkflowRunDetails(state);
            onUpdate?.({
              content: [{ type: "text", text: formatRunSummary(state) }],
              details: { runId: state.runId, run },
            });
            widget.update(run);
          },
        });
        return finalResult(outcome);
      } finally {
        widget.clear();
      }
    },
  });
}

export function finalResult(
  outcome: RunOutcome,
): AgentToolResult<WorkflowToolDetails> {
  const { state, runId } = outcome;
  const lines = formatRunLines(state);
  const details: WorkflowToolDetails = {
    runId,
    run: toWorkflowRunDetails(state),
    exitCode: outcome.exitCode,
  };

  if (state.status === "needs-auth") {
    const logins = state.authRequired.map((a) =>
      `sema mcp login ${sanitizeDisplayText(a.server)}`.trim(),
    );
    return toolError<WorkflowToolDetails>(
      `${lines.join("\n")}\n\nRun needs MCP auth. Ask the user to run:\n${logins.join("\n") || "sema mcp login <server>"}\nThen resume with resume="${runId}".`,
      details,
    );
  }

  if (state.status === "needs-approval") {
    const approvalId = state.approval?.id;
    return toolError<WorkflowToolDetails>(
      `${lines.join("\n")}\n\nRun paused for human approval${approvalId ? ` (${sanitizeDisplayText(approvalId)})` : ""}. Pi did not start this run with durable approval credentials, so it cannot be resumed here. Ask the user to configure their approval flow and start a new run.`,
      details,
    );
  }

  if (state.status === "rejected") {
    const reason = sanitizeDisplayText(state.reason);
    return toolError<WorkflowToolDetails>(
      `${lines.join("\n")}\n\nRun approval was rejected${reason ? `: ${reason}` : ""}. Revise the workflow or approval request, then start a new run.`,
      details,
    );
  }

  if (state.status !== "success") {
    const reason = sanitizeDisplayText(state.reason);
    return toolError<WorkflowToolDetails>(
      `${lines.join("\n")}\n\nRun failed${reason ? `: ${reason}` : ""} (exit ${outcome.exitCode}). Resumable: pass resume="${runId}" to replay completed steps for free.`,
      details,
    );
  }

  const value =
    outcome.resultJson &&
    typeof outcome.resultJson === "object" &&
    "value" in (outcome.resultJson as object)
      ? JSON.stringify(
          (outcome.resultJson as { value: unknown }).value,
          null,
          2,
        )
      : undefined;
  return toolText(
    `${lines.join("\n")}${value ? `\n\nResult:\n${value}` : ""}`,
    details,
  );
}
