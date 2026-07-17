import type { TSchema } from "typebox";

/**
 * Sema's MCP inputSchema is already JSON Schema, and pi's ToolDefinition
 * `parameters: TSchema` is structurally plain JSON Schema at runtime — so we
 * pass through with light normalization instead of rebuilding via TypeBox.
 */
export function sanitizeSchema(input: unknown): TSchema {
  const schema: Record<string, unknown> =
    input && typeof input === "object"
      ? { ...(input as Record<string, unknown>) }
      : {};
  delete schema.$schema;
  delete schema.$id;
  schema.type = "object";
  if (!schema.properties || typeof schema.properties !== "object") {
    schema.properties = {};
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    delete schema.required;
  }
  return schema as unknown as TSchema;
}

/**
 * Map an MCP tool name to a pi tool name: `sema_` prefix + [a-zA-Z0-9_].
 * The prefix guarantees we never shadow pi built-ins (extension tools override
 * built-ins of the same name) and namespaces forged tools (Amp's tb__ lesson).
 */
export function toPiToolName(mcpName: string, taken?: Set<string>): string {
  const base =
    "sema_" +
    mcpName
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  if (!taken || !taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Expand config exclude patterns (globs like `notebook/*`) against actual tool names. */
export function expandExcludes(
  patterns: string[],
  toolNames: string[],
): string[] {
  const regexes = patterns.map(globToRegex);
  return toolNames.filter((name) => regexes.some((re) => re.test(name)));
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
