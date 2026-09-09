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

/**
 * Name from the sole top-level `(<keyword> <name> …)` form in `source`; null
 * when absent or ambiguous. Strings, regex literals, line comments, and quoted
 * forms are skipped so examples in prose do not count as declarations.
 */
export function extractSingleFormName(
  source: string,
  keyword: string,
): string | null {
  const matches: string[] = [];
  let index = 0;
  while (index < source.length) {
    index = skipTrivia(source, index);
    if (source[index] === "(") {
      const { head, name, end } = readList(source, index);
      if (head === keyword && name) matches.push(name);
      index = end;
    } else {
      index = skipDatum(source, index);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function readList(
  source: string,
  start: number,
): { head: string | null; name: string | null; end: number } {
  let index = skipTrivia(source, start + 1);
  const head = readToken(source, index);
  if (!head) return { head: null, name: null, end: skipList(source, start) };
  index = skipTrivia(source, head.end);
  const name = readToken(source, index);
  return {
    head: head.value,
    name: name?.value ?? null,
    end: skipList(source, start),
  };
}

function skipDatum(source: string, start: number): number {
  const index = skipTrivia(source, start);
  if (index >= source.length) return index;
  const char = source[index];
  if (char === "'" || char === "`") return skipDatum(source, index + 1);
  if (char === '"') return skipString(source, index);
  if (char === "#" && source[index + 1] === '"')
    return skipString(source, index + 1);
  if (char === "#" && source[index + 1] === "(")
    return skipList(source, index + 1);
  if (char === "(") return skipList(source, index);
  if (char === "[") return skipDelimited(source, index, "[", "]");
  if (char === "{") return skipDelimited(source, index, "{", "}");
  let end = index;
  while (end < source.length && !isDelimiter(source[end])) end++;
  return end + (end === index ? 1 : 0);
}

function skipList(source: string, start: number): number {
  return skipDelimited(source, start, "(", ")");
}

function skipDelimited(
  source: string,
  start: number,
  open: string,
  close: string,
): number {
  let index = start + 1;
  while (index < source.length) {
    index = skipTrivia(source, index);
    if (source[index] === close) return index + 1;
    if (source[index] === open)
      index = skipDelimited(source, index, open, close);
    else index = skipDatum(source, index);
  }
  return index;
}

function skipTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) index++;
    else if (source[index] === ";") {
      const newline = source.indexOf("\n", index);
      index = newline === -1 ? source.length : newline + 1;
    } else break;
  }
  return index;
}

function skipString(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") index += 2;
    else if (source[index++] === '"') break;
  }
  return index;
}

function readToken(
  source: string,
  start: number,
): { value: string; end: number } | null {
  if (start >= source.length || isDelimiter(source[start])) return null;
  let end = start;
  while (end < source.length && !isDelimiter(source[end])) end++;
  return { value: source.slice(start, end), end };
}

function isDelimiter(char: string): boolean {
  return /\s/.test(char) || "()[]{}\"';`".includes(char);
}
