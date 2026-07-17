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
  schema.properties = Object.fromEntries(
    Object.entries(schema.properties as Record<string, unknown>).map(([key, prop]) => [
      key,
      normalizeProperty(prop),
    ]),
  );
  return schema as unknown as TSchema;
}

/**
 * Providers validate tool schemas against JSON Schema draft 2020-12 and reject
 * the WHOLE request on any invalid type name — one bad forged tool would kill
 * every turn. Sema's deftool type keywords leak through verbatim (`:list` →
 * "list"), so map the common aliases and strip anything unrecognized
 * (schema-less params are valid; wrong type names are not).
 */
const TYPE_ALIASES: Record<string, string> = {
  string: "string",
  str: "string",
  number: "number",
  float: "number",
  double: "number",
  integer: "integer",
  int: "integer",
  boolean: "boolean",
  bool: "boolean",
  array: "array",
  list: "array",
  vector: "array",
  object: "object",
  map: "object",
  dict: "object",
  null: "null",
  nil: "null",
};

function normalizeProperty(prop: unknown): unknown {
  if (!prop || typeof prop !== "object" || Array.isArray(prop)) return prop;
  const out = { ...(prop as Record<string, unknown>) };
  if (typeof out.type === "string") {
    const mapped = TYPE_ALIASES[out.type.toLowerCase()];
    if (mapped) out.type = mapped;
    else delete out.type; // unknown type name → untyped param, still valid
  }
  if (out.items) out.items = normalizeProperty(out.items);
  if (out.properties && typeof out.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(out.properties as Record<string, unknown>).map(([k, v]) => [k, normalizeProperty(v)]),
    );
  }
  return out;
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
