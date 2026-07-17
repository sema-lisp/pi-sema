import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ExtensionAPI, AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiSemaRuntime } from "../index.js";
import { spawnSema } from "../sema.js";
import { JournalTailer } from "./journal.js";
import { newRunState, reduceRun, type RunState } from "./model.js";
import { formatRunLines } from "../ui/format.js";

const params = Type.Object({
  workflow: Type.String({ description: "Workflow name from the library, or a path to a .sema file" }),
  args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Workflow args, passed as --args JSON" })),
  resume: Type.Optional(Type.String({ description: "Run id to resume (memoized leaves replay for free)" })),
});

export interface RunOutcome {
  runId: string;
  runDir: string;
  state: RunState;
  exitCode: number | null;
  resultJson?: unknown;
}

export function defaultRunRoot(cwd: string, configured: string | null): string {
  return configured ?? join(cwd, ".sema", "runs");
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
    const args = ["workflow", "run", opts.file, "--args", JSON.stringify(opts.args), "--run-dir", opts.runRoot, "--no-auth-prompt"];
    if (opts.resume) args.push("--resume", opts.resume);
    const proc = await spawnSema(args, {
      cwd: opts.cwd,
      signal: opts.signal,
      env: { SEMA_WORKFLOW_RUN_ID: runId },
    });
    tailer.drain(); // pick up the final lines before stopping

    let resultJson: unknown;
    try {
      resultJson = JSON.parse(readFileSync(join(runDir, "result.json"), "utf-8"));
    } catch {
      // no result.json (crash / kill) — journal state is the source of truth
    }
    if (proc.killed && state.status === "live") state.status = "failed";
    return { runId, runDir, state, exitCode: proc.code, resultJson };
  } finally {
    tailer.stop();
  }
}

export function registerWorkflowRunTool(pi: ExtensionAPI, getRuntime: () => PiSemaRuntime | null): void {
  pi.registerTool({
    name: "sema_workflow_run",
    label: "Run Sema workflow",
    description:
      "Run a Sema workflow from the library (or a .sema file path) with live status. Journaled and resumable: pass resume=<run_id> to replay memoized steps for free after a failure. Workflows may spend real LLM tokens — their :budget meta caps spend. Exit status needs-auth means the user must run the printed `sema mcp login` command first.",
    promptSnippet: "Run a stored Sema workflow (journaled, resumable, live status)",
    parameters: params,
    async execute(_id, p, signal, onUpdate, ctx): Promise<AgentToolResult<{ isError?: boolean; runId?: string }>> {
      const runtime = getRuntime();
      if (!runtime) {
        return { content: [{ type: "text", text: "pi-sema is not initialized" }], details: { isError: true } };
      }
      const entry = runtime.store.resolve("workflows", p.workflow);
      if (!entry) {
        const known = runtime.store.list("workflows").map((e) => e.name);
        return {
          content: [{ type: "text", text: `unknown workflow "${p.workflow}". Known: ${known.join(", ") || "(none)"}` }],
          details: { isError: true },
        };
      }

      const runRoot = defaultRunRoot(ctx.cwd, runtime.cfg.workflows.runDir);
      const widgetKey = "sema-run";
      const outcome = await runWorkflow({
        file: entry.path,
        args: p.args ?? {},
        runRoot,
        resume: p.resume,
        cwd: ctx.cwd,
        signal,
        onState: (state) => {
          const lines = formatRunLines(state);
          onUpdate?.({ content: [{ type: "text", text: lines.join("\n") }], details: { runId: state.runId } });
          setWidgetSafe(ctx, widgetKey, lines);
        },
      });

      setWidgetSafe(ctx, widgetKey, undefined);
      return finalResult(outcome);
    },
  });
}

function setWidgetSafe(ctx: ExtensionContext, key: string, lines: string[] | undefined): void {
  try {
    ctx.ui.setWidget(key, lines);
  } catch {
    // non-TUI modes may not support widgets — streaming updates still flow
  }
}

export function finalResult(outcome: RunOutcome): AgentToolResult<{ isError?: boolean; runId?: string }> {
  const { state, runId } = outcome;
  const lines = formatRunLines(state);
  const details: { isError?: boolean; runId?: string } = { runId };

  if (state.status === "needs-auth") {
    const logins = state.authRequired.map((a) => `sema mcp login ${a.server ?? ""}`.trim());
    return {
      content: [
        {
          type: "text",
          text: `${lines.join("\n")}\n\nRun needs MCP auth. Ask the user to run:\n${logins.join("\n") || "sema mcp login <server>"}\nThen resume with resume="${runId}".`,
        },
      ],
      details: { ...details, isError: true },
    };
  }

  if (state.status !== "success") {
    return {
      content: [
        {
          type: "text",
          text: `${lines.join("\n")}\n\nRun failed${state.reason ? `: ${state.reason}` : ""} (exit ${outcome.exitCode}). Resumable: pass resume="${runId}" to replay completed steps for free.`,
        },
      ],
      details: { ...details, isError: true },
    };
  }

  const value =
    outcome.resultJson && typeof outcome.resultJson === "object" && "value" in (outcome.resultJson as object)
      ? JSON.stringify((outcome.resultJson as { value: unknown }).value, null, 2)
      : undefined;
  return {
    content: [{ type: "text", text: `${lines.join("\n")}${value ? `\n\nResult:\n${value}` : ""}` }],
    details,
  };
}
