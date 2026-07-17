import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { McpProcess } from "../src/bridge/process.js";
import { mcpListTools, mcpCallTool } from "../src/bridge/jsonrpc.js";

function semaAvailable(): boolean {
  try {
    execSync("sema --version", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Live integration against the real `sema mcp` server. Verifies the fact the
 * entire self-extension loop depends on: tools/list is recomputed from the
 * live env on every call, so a deftool injected via `eval` appears without
 * any restart or listChanged notification.
 */
describe.skipIf(!semaAvailable())("sema mcp live", () => {
  let proc: McpProcess;

  beforeAll(async () => {
    proc = new McpProcess({ toolFiles: [], cwd: process.cwd() });
    await proc.start();
  }, 20_000);

  afterAll(async () => {
    await proc?.stop();
  });

  it("initializes and lists the default tools", async () => {
    const tools = await mcpListTools(proc.client);
    const names = tools.map((t) => t.name);
    expect(names).toContain("eval");
    expect(names).toContain("run_file");
  });

  it("re-lists a deftool injected via eval (the self-extension linchpin)", async () => {
    const before = await mcpListTools(proc.client);
    expect(before.map((t) => t.name)).not.toContain("pi_sema_test_dyn");

    const result = await mcpCallTool(proc.client, "eval", {
      code: '(deftool pi_sema_test_dyn "Double a number" {:x {:type :number}} (lambda (x) (* x 2)))',
    });
    expect(result.isError).toBeFalsy();

    const after = await mcpListTools(proc.client);
    expect(after.map((t) => t.name)).toContain("pi_sema_test_dyn");

    const call = await mcpCallTool(proc.client, "pi_sema_test_dyn", { x: 21 });
    const text = call.content.map((c) => c.text ?? "").join("");
    expect(text).toContain("42");
  }, 30_000);
});
