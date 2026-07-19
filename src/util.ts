import { readFileSync } from "node:fs";

/** Small shared helpers used across subsystems — no domain logic lives here. */

/** Parse JSON, returning null instead of throwing on malformed input. */
export function tryParseJson<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Read + parse a JSON file; null on any read or parse failure. */
export function readJsonFile<T = unknown>(path: string): T | null {
  try {
    return tryParseJson<T>(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** A ` (line N:col)` suffix, or "" when no line is known. Shared by error/diagnostic formatters. */
export function formatLineCol(
  line?: number | null,
  col?: number | null,
): string {
  if (line == null) return "";
  return ` (line ${line}${col != null ? `:${col}` : ""})`;
}

/** Name from the sole `(<keyword> <name> …)` form in `source`; null when absent or ambiguous. */
export function extractSingleFormName(
  source: string,
  keyword: string,
): string | null {
  const matches = [
    ...source.matchAll(new RegExp(`\\(${keyword}\\s+([^\\s()]+)`, "g")),
  ];
  return matches.length === 1 ? matches[0][1] : null;
}
