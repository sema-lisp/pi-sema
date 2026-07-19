// Parsing + formatting for the JSON envelope `sema eval --json` emits:
// `{ok, value, stdout, stderr, elapsedMs, error: {message, hint, line, col}}`.
// The error object is NESTED — there are no flat error_* fields.
import { formatLineCol, tryParseJson } from "./util.js";

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

  // Try the whole output, then just the last line (tolerates leading program output).
  const candidates = trimmed.includes("\n")
    ? [trimmed, trimmed.slice(trimmed.lastIndexOf("\n") + 1)]
    : [trimmed];
  for (const candidate of candidates) {
    const parsed = tryParseJson<SemaJsonEnvelope>(candidate);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.ok === "boolean"
    ) {
      return parsed;
    }
  }
  return null;
}

export function formatSemaError(
  error: SemaError | undefined,
  fallback = "unknown error",
): string {
  if (!error) return fallback;
  const hint = error.hint ? `\nhint: ${error.hint}` : "";
  return `${error.message}${formatLineCol(error.line, error.col)}${hint}`;
}
