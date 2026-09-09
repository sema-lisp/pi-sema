import type {
  AgentToolResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

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

const PI_SEMA_NON_PREFIXED_TOOLS = new Set([
  "create_sema_tool",
  "submit_sema_workflow",
]);

function isPiSemaTool(name: string): boolean {
  return name.startsWith("sema_") || PI_SEMA_NON_PREFIXED_TOOLS.has(name);
}

function hasToolErrorDetails(details: unknown): boolean {
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { isError?: unknown }).isError === true
  );
}

/**
 * Pi marks a resolved tool execution as successful unless the tool-result hook
 * overrides it. Preserve toolError()'s status for this extension's tools.
 */
export function registerToolResultErrorHook(pi: ExtensionAPI): void {
  pi.on("tool_result", (event) => {
    if (!isPiSemaTool(event.toolName) || !hasToolErrorDetails(event.details)) {
      return undefined;
    }
    return { isError: true };
  });
}
