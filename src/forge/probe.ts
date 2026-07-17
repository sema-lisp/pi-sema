import { spawnSema } from "../sema.js";
import { parseEnvelope, formatSemaError, type SemaError } from "../envelope.js";

export type ProbeResult =
  | { ok: true; elapsedMs?: number }
  | { ok: false; error: SemaError; stderr?: string };

/**
 * Verify a candidate (deftool …) source before it touches the live server:
 * evaluate under `--sandbox strict --no-llm` (deny shell/fs-write/network/LLM)
 * and assert the tool actually registered via (tool? "name").
 *
 * strict + --no-llm apply ONLY here — real execution runs under the user's
 * configured sandbox (default allow-all). The timeout is enforced by us
 * because sema's own --timeout flag is a no-op.
 */
export async function verifyToolSource(
  source: string,
  name: string,
  opts: { timeoutMs: number; cwd?: string; signal?: AbortSignal },
): Promise<ProbeResult> {
  // Sema resolves free variables at CALL time, so an unbound stdlib name
  // inside the lambda body (e.g. string/concat) evaluates fine at deftool
  // time and only explodes on first real use. Force resolution now: reference
  // every slash-namespaced symbol the source mentions as a bare top-level
  // expression — bound builtins are no-op value references, unbound ones fail
  // the probe with the exact "Unbound variable: X" the model needs.
  const symbolChecks = collectNamespacedSymbols(source)
    .map((sym) => sym + "\n")
    .join("");
  // tool? is a VALUE predicate: pass the symbol deftool bound, not a string.
  // An unbound symbol errors with a clear "unbound symbol" diagnostic, which
  // is exactly the right feedback when the deftool name doesn't match.
  const probeSuffix = `\n${symbolChecks}(if (tool? ${name}) :probe-ok (error "symbol ${name} is bound but is not a tool — did deftool get shadowed?"))\n`;
  const result = await spawnSema(["eval", "--stdin", "--json", "--sandbox", "strict", "--no-llm"], {
    stdin: source + probeSuffix,
    timeoutMs: opts.timeoutMs,
    cwd: opts.cwd,
    signal: opts.signal,
  });

  if (result.killed) {
    return {
      ok: false,
      error: { message: `verification timed out after ${opts.timeoutMs}ms — does the tool body loop or block at load time?` },
    };
  }

  const envelope = parseEnvelope(result.stdout);
  if (!envelope) {
    return {
      ok: false,
      error: { message: `sema eval produced no JSON envelope (exit ${result.code})` },
      stderr: result.stderr.trim() || undefined,
    };
  }
  if (!envelope.ok) {
    return {
      ok: false,
      error: envelope.error ?? { message: "evaluation failed with no error detail" },
      stderr: (envelope.stderr || result.stderr).trim() || undefined,
    };
  }
  return { ok: true, elapsedMs: envelope.elapsedMs };
}

/**
 * Slash-namespaced symbols referenced by the source (string literals, line
 * comments, keywords, and regex literals stripped first). Deduped, order kept.
 */
export function collectNamespacedSymbols(source: string): string[] {
  const stripped = source
    .replace(/#"(?:[^"\\]|\\.)*"/g, " ") // regex literals before strings
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/;[^\n]*/g, " ");
  const seen = new Set<string>();
  for (const match of stripped.matchAll(/(?<![:\w/#-])([A-Za-z*+!?<>=_-][\w*+!?<>=.-]*\/[\w*+!?<>=./-]+)/g)) {
    seen.add(match[1]);
  }
  return [...seen];
}

export function describeProbeFailure(result: Extract<ProbeResult, { ok: false }>): string {
  const parts = [formatSemaError(result.error)];
  if (result.stderr) parts.push(`stderr: ${result.stderr}`);
  return parts.join("\n");
}
