import { spawnSema } from "../sema.js";

export interface WorkflowDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  line?: number;
  col?: number;
  hint?: string | null;
}

export interface CheckResult {
  /** True when there are no error-level diagnostics. Warnings are advisory. */
  ok: boolean;
  errors: WorkflowDiagnostic[];
  warnings: WorkflowDiagnostic[];
}

/**
 * Static no-LLM validation via `sema workflow check --strict --json`.
 * IMPORTANT: under --strict, warnings alone give a non-zero exit — so we gate
 * on the parsed `errors` count, never the exit code.
 */
export async function workflowCheck(file: string, opts: { cwd?: string; signal?: AbortSignal } = {}): Promise<CheckResult> {
  const result = await spawnSema(["workflow", "check", file, "--strict", "--json"], {
    timeoutMs: 15_000,
    cwd: opts.cwd,
    signal: opts.signal,
  });

  let parsed: { diagnostics?: WorkflowDiagnostic[] } | null = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // fall through
  }
  if (!parsed || !Array.isArray(parsed.diagnostics)) {
    return {
      ok: false,
      errors: [
        {
          severity: "error",
          code: "E-CHECK-FAILED",
          message: `sema workflow check produced no JSON (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 500)}`,
        },
      ],
      warnings: [],
    };
  }

  const errors = parsed.diagnostics.filter((d) => d.severity === "error");
  const warnings = parsed.diagnostics.filter((d) => d.severity === "warning");
  return { ok: errors.length === 0, errors, warnings };
}

export function formatDiagnostics(diags: WorkflowDiagnostic[]): string {
  return diags
    .map((d) => {
      const loc = d.line != null ? ` (line ${d.line}${d.col != null ? `:${d.col}` : ""})` : "";
      const hint = d.hint ? `\n  hint: ${d.hint}` : "";
      return `[${d.code}] ${d.message}${loc}${hint}`;
    })
    .join("\n");
}
