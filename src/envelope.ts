/**
 * The JSON envelope emitted by `sema eval --json` (main.rs run_eval):
 * `{ok, value, stdout, stderr, elapsedMs, error: {message, hint, line, col}}`.
 * Note the error object is NESTED — there are no flat error_* fields.
 */
export interface SemaError {
  message: string;
  hint?: string;
  line?: number;
  col?: number;
}

export interface SemaJsonEnvelope {
  ok: boolean;
  value?: unknown;
  stdout?: string;
  stderr?: string;
  elapsedMs?: number;
  error?: SemaError;
}

/** Parse an envelope from process stdout. Tolerates leading program output. */
export function parseEnvelope(stdout: string): SemaJsonEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const candidates = [trimmed, trimmed.slice(trimmed.lastIndexOf("\n") + 1)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && typeof parsed.ok === "boolean") {
        return parsed as SemaJsonEnvelope;
      }
    } catch {
      // fall through to next candidate
    }
  }
  return null;
}

export function formatSemaError(error: SemaError | undefined, fallback = "unknown error"): string {
  if (!error) return fallback;
  const location = error.line != null ? ` (line ${error.line}${error.col != null ? `:${error.col}` : ""})` : "";
  const hint = error.hint ? `\nhint: ${error.hint}` : "";
  return `${error.message}${location}${hint}`;
}
