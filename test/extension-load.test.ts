import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DIST = join(__dirname, "..", "dist", "index.js");

/**
 * Smoke: load the BUILT extension exactly as pi would and drive the factory
 * with a stub ExtensionAPI. Catches wiring regressions (missing registration,
 * bad import paths in emitted JS) that unit tests on src/ can't.
 */
describe.skipIf(!existsSync(DIST))("built extension loads", () => {
  it("registers the expected commands, tools, flags and hooks", async () => {
    const commands: string[] = [];
    const tools: string[] = [];
    const flags: string[] = [];
    const events: string[] = [];
    const shortcuts: string[] = [];

    const pi = {
      registerCommand: (name: string) => commands.push(name),
      registerTool: (def: { name: string }) => tools.push(def.name),
      registerFlag: (name: string) => flags.push(name),
      registerShortcut: (key: string) => shortcuts.push(key),
      on: (event: string) => events.push(event),
      getFlag: () => undefined,
      getActiveTools: () => [],
      setActiveTools: () => {},
      sendMessage: () => {},
      appendEntry: () => {},
    };

    const factory = (await import(DIST)).default as (api: typeof pi) => void;
    factory(pi);

    expect(commands.sort()).toEqual([
      "sema:forge",
      "sema:tools",
      "sema:workflow",
      "sema:workflows",
    ]);
    expect(tools.sort()).toEqual([
      "create_sema_tool",
      "sema_workflow_run",
      "submit_sema_workflow",
    ]);
    expect(flags.sort()).toEqual([
      "sema-budget",
      "sema-exclude",
      "sema-sandbox",
    ]);
    expect(events).toContain("session_start");
    expect(events).toContain("session_shutdown");
    expect(events).toContain("before_agent_start");
    expect(shortcuts).toHaveLength(1);
  });
});
