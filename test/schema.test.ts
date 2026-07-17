import { describe, it, expect } from "vitest";
import {
  sanitizeSchema,
  toPiToolName,
  expandExcludes,
} from "../src/bridge/schema.js";

describe("sanitizeSchema", () => {
  it("passes through a normal MCP inputSchema", () => {
    const schema = sanitizeSchema({
      type: "object",
      properties: { code: { type: "string", description: "Code to evaluate" } },
      required: ["code"],
    }) as any;
    expect(schema.type).toBe("object");
    expect(schema.properties.code.type).toBe("string");
    expect(schema.required).toEqual(["code"]);
  });

  it("normalizes degenerate schemas", () => {
    const empty = sanitizeSchema(undefined) as any;
    expect(empty).toEqual({ type: "object", properties: {} });
    const noProps = sanitizeSchema({
      type: "object",
      $schema: "x",
      $id: "y",
    }) as any;
    expect(noProps.$schema).toBeUndefined();
    expect(noProps.properties).toEqual({});
  });

  it("drops a malformed required field", () => {
    const schema = sanitizeSchema({
      type: "object",
      properties: {},
      required: "code",
    }) as any;
    expect(schema.required).toBeUndefined();
  });
});

describe("toPiToolName", () => {
  it("prefixes and sanitizes", () => {
    expect(toPiToolName("eval")).toBe("sema_eval");
    expect(toPiToolName("notebook/read")).toBe("sema_notebook_read");
    expect(toPiToolName("docs_search")).toBe("sema_docs_search");
  });

  it("resolves collisions with numeric suffix", () => {
    const taken = new Set(["sema_notebook_read"]);
    expect(toPiToolName("notebook-read", taken)).toBe("sema_notebook_read_2");
  });
});

describe("expandExcludes", () => {
  const names = [
    "eval",
    "run_file",
    "docs",
    "notebook/read",
    "notebook/eval_cell",
  ];

  it("expands globs against real names", () => {
    expect(expandExcludes(["notebook/*"], names)).toEqual([
      "notebook/read",
      "notebook/eval_cell",
    ]);
  });

  it("matches literals exactly", () => {
    expect(expandExcludes(["eval"], names)).toEqual(["eval"]);
    expect(expandExcludes(["ev*"], names)).toEqual(["eval"]);
    expect(expandExcludes(["missing"], names)).toEqual([]);
  });
});

describe("sanitizeSchema draft-2020-12 type normalization", () => {
  // A single invalid type name ("list") in any tool schema makes the provider
  // 400 the ENTIRE request — this is the exact bug from the repo-annotations
  // forge session.
  it("maps sema type aliases to valid JSON Schema types", () => {
    const schema = sanitizeSchema({
      type: "object",
      properties: {
        tags: { type: "list", description: "annotation tags" },
        count: { type: "int" },
        deep: { type: "map", properties: { flag: { type: "bool" } } },
        items: { type: "array", items: { type: "str" } },
      },
    }) as any;
    expect(schema.properties.tags.type).toBe("array");
    expect(schema.properties.count.type).toBe("integer");
    expect(schema.properties.deep.type).toBe("object");
    expect(schema.properties.deep.properties.flag.type).toBe("boolean");
    expect(schema.properties.items.items.type).toBe("string");
  });

  it("strips unrecognized type names instead of passing them through", () => {
    const schema = sanitizeSchema({
      type: "object",
      properties: { weird: { type: "keyword", description: "kept" } },
    }) as any;
    expect(schema.properties.weird.type).toBeUndefined();
    expect(schema.properties.weird.description).toBe("kept");
  });

  it("leaves valid schemas untouched", () => {
    const schema = sanitizeSchema({
      type: "object",
      properties: { name: { type: "string" }, n: { type: "number" } },
      required: ["name"],
    }) as any;
    expect(schema.properties.name.type).toBe("string");
    expect(schema.required).toEqual(["name"]);
  });
});
