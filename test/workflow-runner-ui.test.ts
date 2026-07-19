import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PiSemaRuntime } from "../src/index.js";

vi.mock("../src/sema.js", () => ({
  spawnSema: vi.fn(async () => {
    throw new Error("spawn failed");
  }),
}));
import {
  finalResult,
  registerWorkflowRunTool,
} from "../src/workflows/runner.js";
import { foldEvents } from "../src/workflows/model.js";

describe("workflow runner UI integration", () => {
  it("registers custom call and result renderers", () => {
    let definition: Record<string, unknown> | undefined;
    const pi = {
      registerTool(value: Record<string, unknown>) {
        definition = value;
      },
    } as unknown as ExtensionAPI;

    registerWorkflowRunTool(pi, () => null);

    expect(definition?.renderCall).toEqual(expect.any(Function));
    expect(definition?.renderResult).toEqual(expect.any(Function));
  });

  it("stores a serializable run snapshot in final result details", () => {
    const state = foldEvents([
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "publish",
        run_id: "run-1",
        phases: ["Verify"],
      },
      { event: "phase.started", seq: 1, ts: "t", phase: "Verify" },
      {
        event: "phase.ended",
        seq: 2,
        ts: "t",
        phase: "Verify",
        status: "success",
      },
      { event: "run.ended", seq: 3, ts: "t", status: "success" },
    ]);

    const result = finalResult({
      runId: "run-1",
      runDir: "/tmp/run-1",
      state,
      exitCode: 0,
    });

    expect(result.details.run?.status).toBe("success");
    expect(Array.isArray(result.details.run?.agents)).toBe(true);
    expect(() => JSON.stringify(result.details)).not.toThrow();
  });

  it("keeps failure fallback text free of terminal control payloads", () => {
    const state = foldEvents([
      {
        event: "run.started",
        seq: 0,
        ts: "t",
        workflow: "publish",
        run_id: "run-1",
      },
      {
        event: "run.ended",
        seq: 1,
        ts: "t",
        status: "failed",
        reason: "failed\u001b]52;c;secret\u0007\nsecond row",
      },
    ]);

    const result = finalResult({
      runId: "run-1",
      runDir: "/tmp/run-1",
      state,
      exitCode: 1,
    });
    const text = result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    expect(text).not.toContain("secret");
    expect(text).not.toContain("\u001b");
  });

  it("clears its unique widget when workflow execution throws", async () => {
    let definition:
      | {
          execute: (
            id: string,
            params: { workflow: string },
            signal: AbortSignal | undefined,
            onUpdate: undefined,
            ctx: ExtensionContext,
          ) => Promise<unknown>;
        }
      | undefined;
    const pi = {
      registerTool(value: typeof definition) {
        definition = value;
      },
    } as unknown as ExtensionAPI;
    const runtime = {
      cfg: { workflows: { runDir: null } },
      store: {
        resolve: () => ({ path: "/tmp/publish.sema" }),
        list: () => [],
      },
    } as unknown as PiSemaRuntime;
    const widgets: { key: string; content: unknown }[] = [];
    const ctx = {
      cwd: "/tmp",
      mode: "tui",
      ui: {
        setWidget(key: string, content: unknown) {
          widgets.push({ key, content });
        },
      },
    } as unknown as ExtensionContext;

    registerWorkflowRunTool(pi, () => runtime);

    await expect(
      definition!.execute(
        "call-7",
        { workflow: "publish" },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow("spawn failed");
    expect(widgets.map((widget) => widget.key)).toEqual([
      "sema-run-call-7",
      "sema-run-call-7",
    ]);
    expect(widgets[0].content).toEqual(expect.any(Function));
    expect(widgets[1].content).toBeUndefined();
  });
});
