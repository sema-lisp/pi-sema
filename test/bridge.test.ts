import { describe, expect, it, vi } from "vitest";

const { tools, listTools } = vi.hoisted(() => {
  const tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }> = [];
  return { tools, listTools: vi.fn(async () => tools) };
});

vi.mock("../src/bridge/process.js", () => ({
  McpProcess: class {
    readonly client = {};
    readonly running = true;
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  },
}));

vi.mock("../src/bridge/jsonrpc.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/bridge/jsonrpc.js")>()),
  mcpListTools: listTools,
}));

import { SemaBridge } from "../src/bridge/bridge.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const config = { ...structuredClone(DEFAULT_CONFIG), excludeTools: [] };

describe("SemaBridge.refresh", () => {
  it("does not reactivate a manually deactivated tool when adding another", async () => {
    const definitions = new Map<string, { name: string }>();
    let active: string[] = [];
    const pi = {
      registerTool: (definition: { name: string }) => {
        definitions.set(definition.name, definition);
        if (!active.includes(definition.name)) active.push(definition.name);
      },
      getActiveTools: () => active,
      setActiveTools: (names: string[]) => {
        active = names;
      },
    };
    const store = { filePaths: () => [] };

    tools.splice(0, tools.length, {
      name: "eval",
      inputSchema: { type: "object", properties: {} },
    });
    const bridge = new SemaBridge(pi as never, config, store as never, vi.fn());
    await bridge.start(process.cwd(), true);
    active = active.filter((name) => name !== "sema_eval");

    tools.push({
      name: "new_tool",
      inputSchema: { type: "object", properties: {} },
    });
    await bridge.refresh();

    expect(definitions.size).toBe(2);
    expect(active).toContain("sema_new_tool");
    expect(active).not.toContain("sema_eval");
  });
});
