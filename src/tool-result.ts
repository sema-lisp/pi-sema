import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

/**
 * Builders for the `AgentToolResult` text-block shape every tool returns, so
 * call sites read as `return toolError("…")` instead of re-typing the nested
 * `{ content: [{ type: "text", text }], details }` literal by hand.
 */

/** A success result carrying `text` and optional `details`. */
export function toolText<D = Record<string, never>>(
  text: string,
  details?: D,
): AgentToolResult<D> {
  return { content: [{ type: "text", text }], details: (details ?? {}) as D };
}

/** An error result — sets `details.isError` on top of any details passed. */
export function toolError<D = Record<string, never>>(
  text: string,
  details?: D,
): AgentToolResult<D & { isError: true }> {
  return {
    content: [{ type: "text", text }],
    details: { ...(details ?? {}), isError: true } as D & { isError: true },
  };
}
